/** Shared archive contract + simulated JSON store. No startup host/network/storage calls. */
import { z } from 'zod';
import { cloneT2Json, type T2Json } from './t2-template';
import {
  canonicalT4Json,
  createT4Archive,
  normalizeT4Anchor,
  normalizeT4Scope,
  validateT4Archive,
  validateT4Commit,
  type T4Anchor,
  type T4Archive,
  type T4Commit,
  type T4Origin,
  type T4Scope,
  type T4State,
} from './t4-protocol';

export type T4StoreCode = 'SAVE_FAILED' | 'ACK_LOST' | 'READ_FAILED' | 'CONFLICT' | 'IDENTITY' | 'ANCHOR' | 'ABORTED';
export class T4StoreError extends Error {
  constructor(readonly code: T4StoreCode) {
    super(`世界演变存档：${code}`);
    this.name = 'T4StoreError';
  }
}
export interface T4HeadToken {
  commitId: string | null;
  seq: number;
  revision: number;
  stateFingerprint: string;
}
export interface T4SaveInput {
  scope: T4Scope;
  expected: T4HeadToken;
  commit: T4Commit;
  signal?: AbortSignal;
  /** Trusted synchronous capability, never serialized. T10 rechecks at its selected write boundary. */
  authorize?: () => void;
}
/** Independent persisted reads are mandatory, not cached getters. compareAndSwap is the legacy
 * conditional-submit method name: strict T10 uses atomic CAS, explicitly selected compatibility
 * T10 uses optimistic checks + readback and makes NO cross-writer atomic guarantee. */
export interface T4ArchiveGateway {
  readonly mode: T4Scope['mode'];
  read(scope: T4Scope): Promise<T4Archive>;
  compareAndSwap(input: T4SaveInput): Promise<void>;
}
interface ChatFixture {
  chatId: string;
  otherData: T2Json;
  anchors: T4Anchor[];
  activeAnchor: T4Anchor | null;
  /** This is the only mutable authority: serialized JSON, not a cached SQLite database. */
  archives: Record<string, string>;
}
export interface T4SandboxStore extends T4ArchiveGateway {
  initialize(scope: T4Scope, state: T4State, origin?: T4Origin): Promise<void>;
  registerAnchor(anchor: T4Anchor, otherData?: T2Json): void;
  selectAnchor(chatId: string, anchor: T4Anchor | null): void;
  readOtherData(chatId: string): T2Json;
  queueWriteFault(fault: 'save-failed' | 'ack-lost'): void;
  queueReadFailure(count?: number): void;
  exportStorage(): string;
  readonly statistics: { writes: number; reads: number };
}
const chatIdShape = z.string().regex(/^sandbox-[a-z0-9_-]{1,64}$/);
const fixtureShape = z.strictObject({
  format: z.literal('world-evolution-t4-fixture'),
  version: z.literal(1),
  chats: z
    .array(
      z.strictObject({
        chatId: chatIdShape,
        otherData: z.unknown(),
        anchors: z.array(z.unknown()).max(256),
        activeAnchor: z.unknown().nullable(),
        archives: z.record(z.string().max(130), z.string().max(8_000_000)),
      }),
    )
    .max(64),
});
const same = (left: unknown, right: unknown) => canonicalT4Json(left) === canonicalT4Json(right);
const branchKey = (scope: T4Scope) => `${scope.worldId}/${scope.branchId}`;
const anchorKey = (anchor: T4Anchor) => `${anchor.messageId}/${anchor.swipeId}`;
export function headT4Token(archive: T4Archive): T4HeadToken {
  const head = archive.commits.at(-1);
  return {
    commitId: head?.commitId ?? null,
    seq: head?.seq ?? 0,
    revision: head?.snapshot.state.data.revision ?? archive.genesis.data.revision,
    stateFingerprint: head?.afterStateFingerprint ?? archive.genesisFingerprint,
  };
}

/** Recreate with exportStorage() to simulate closing and reopening a saved JSON file. */
export function createT4SandboxStore(serialized?: string): T4SandboxStore {
  const chats = new Map<string, ChatFixture>();
  if (serialized !== undefined) {
    if (typeof serialized !== 'string' || serialized.length > 16_000_000) throw new T4StoreError('IDENTITY');
    const fixture = fixtureShape.parse(cloneT2Json(JSON.parse(serialized)));
    for (const item of fixture.chats) {
      if (chats.has(item.chatId)) throw new T4StoreError('IDENTITY');
      const anchors = item.anchors.map(normalizeT4Anchor);
      if (new Set(anchors.map(anchorKey)).size !== anchors.length || anchors.some(a => a.chatId !== item.chatId))
        throw new T4StoreError('ANCHOR');
      const activeAnchor = item.activeAnchor === null ? null : normalizeT4Anchor(item.activeAnchor);
      if (activeAnchor && !anchors.some(a => same(a, activeAnchor))) throw new T4StoreError('ANCHOR');
      for (const key of Object.keys(item.archives))
        if (!/^[a-z][a-z0-9_-]{0,63}\/[a-z][a-z0-9_-]{0,63}$/.test(key)) throw new T4StoreError('IDENTITY');
      chats.set(item.chatId, {
        chatId: item.chatId,
        otherData: cloneT2Json(item.otherData),
        anchors,
        activeAnchor,
        archives: item.archives,
      });
    }
  }
  const writeFaults: ('save-failed' | 'ack-lost')[] = [];
  let failedReads = 0;
  const counters = { writes: 0, reads: 0 };
  const chat = (id: string, create = false): ChatFixture => {
    chatIdShape.parse(id);
    let value = chats.get(id);
    if (!value && create) {
      value = { chatId: id, otherData: {}, anchors: [], activeAnchor: null, archives: {} };
      chats.set(id, value);
    }
    if (!value) throw new T4StoreError('IDENTITY');
    return value;
  };
  const rawRead = async (scope: T4Scope) => {
    const normalized = normalizeT4Scope(scope);
    const raw = chat(normalized.chatId).archives[branchKey(normalized)];
    if (!raw) throw new T4StoreError('IDENTITY');
    const archive = await validateT4Archive(JSON.parse(raw));
    if (!same(archive.scope, normalized)) throw new T4StoreError('IDENTITY');
    return archive;
  };
  return Object.freeze({
    mode: 't4-sandbox' as const,
    get statistics() {
      return Object.freeze({ ...counters });
    },
    async initialize(scope: T4Scope, state: T4State, origin?: T4Origin) {
      const normalized = normalizeT4Scope(scope);
      if (normalized.mode !== 't4-sandbox') throw new T4StoreError('IDENTITY');
      const archive = await createT4Archive(normalized, state, origin);
      const existingTarget = chats.get(normalized.chatId);
      if (archive.origin.kind !== 'new') {
        for (const mapping of archive.origin.anchorMapping) {
          const source = chat(archive.origin.sourceScope.chatId);
          if (
            !source.anchors.some(a => same(a, mapping.source)) ||
            !existingTarget?.anchors.some(a => same(a, mapping.target))
          )
            throw new T4StoreError('ANCHOR');
        }
      }
      const key = branchKey(normalized);
      if (existingTarget && Object.hasOwn(existingTarget.archives, key)) throw new T4StoreError('CONFLICT');
      const target = chat(normalized.chatId, true);
      target.archives[key] = JSON.stringify(archive);
    },
    registerAnchor(input: T4Anchor, otherData?: T2Json) {
      const anchor = normalizeT4Anchor(input);
      const data = otherData === undefined ? undefined : cloneT2Json(otherData);
      const target = chat(anchor.chatId, true);
      const index = target.anchors.findIndex(a => anchorKey(a) === anchorKey(anchor));
      if (index < 0) target.anchors.push(anchor);
      else target.anchors[index] = anchor;
      target.activeAnchor = anchor;
      if (data !== undefined) target.otherData = data;
    },
    selectAnchor(id: string, input: T4Anchor | null) {
      const target = chat(id);
      const anchor = input === null ? null : normalizeT4Anchor(input);
      if (anchor && (anchor.chatId !== id || !target.anchors.some(a => same(a, anchor))))
        throw new T4StoreError('ANCHOR');
      target.activeAnchor = anchor;
    },
    readOtherData(id: string) {
      return cloneT2Json(chat(id).otherData);
    },
    queueWriteFault(fault: 'save-failed' | 'ack-lost') {
      if (!['save-failed', 'ack-lost'].includes(fault)) throw new T4StoreError('IDENTITY');
      writeFaults.push(fault);
    },
    queueReadFailure(count = 1) {
      if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new T4StoreError('IDENTITY');
      failedReads += count;
    },
    exportStorage() {
      return JSON.stringify({ format: 'world-evolution-t4-fixture', version: 1, chats: [...chats.values()] });
    },
    async read(input: T4Scope) {
      const scope = normalizeT4Scope(input);
      counters.reads += 1;
      if (failedReads > 0) {
        failedReads -= 1;
        throw new T4StoreError('READ_FAILED');
      }
      return rawRead(scope);
    },
    async compareAndSwap(input: T4SaveInput) {
      // Clone everything before the first await. AbortSignal is a capability, not JSON payload.
      const frozen = cloneT2Json({
        scope: input.scope,
        expected: input.expected,
        commit: input.commit,
      }) as unknown as Omit<T4SaveInput, 'signal'>;
      const signal = input.signal;
      const authorize = input.authorize;
      const scope = normalizeT4Scope(frozen.scope);
      const expected = z
        .strictObject({
          commitId: z.string().nullable(),
          seq: z.number().int().min(0),
          revision: z.number().int().min(0),
          stateFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(frozen.expected);
      if (signal?.aborted) throw new T4StoreError('ABORTED');
      const observedRaw = chat(scope.chatId).archives[branchKey(scope)];
      const previous = await rawRead(scope);
      const previousHead = headT4Token(previous);
      const prior = previous.commits.find(
        c => c.commitId === frozen.commit.commitId || c.runId === frozen.commit.runId,
      );
      if (prior) {
        if (!same(prior, frozen.commit)) throw new T4StoreError('CONFLICT');
        return; // Exactly the same immutable payload: no SQL, write, anchor mutation or head reset.
      }
      if (!same(previousHead, expected)) throw new T4StoreError('CONFLICT');
      const base = previous.commits.at(-1)?.snapshot.state ?? previous.genesis;
      const commit = await validateT4Commit(frozen.commit, base, scope, expected.commitId, expected.seq + 1);
      const next = await validateT4Archive({ ...previous, commits: [...previous.commits, commit] });
      const target = chat(scope.chatId);
      const key = branchKey(scope);
      // In this fake gateway only, this check + assignment is the synchronous atomic CAS point.
      // T10 must prove an equivalent host boundary; read-back alone cannot replace it.
      try {
        if (authorize?.() !== undefined) throw new Error('authorization must be synchronous');
      } catch {
        throw new T4StoreError('ABORTED');
      }
      if (target.archives[key] !== observedRaw) throw new T4StoreError('CONFLICT');
      if (!target.activeAnchor || !same(target.activeAnchor, commit.anchor)) throw new T4StoreError('ANCHOR');
      if (signal?.aborted) throw new T4StoreError('ABORTED');
      const fault = writeFaults.shift();
      if (fault === 'save-failed') throw new T4StoreError('SAVE_FAILED');
      target.archives[key] = JSON.stringify(next);
      counters.writes += 1;
      if (fault === 'ack-lost') throw new T4StoreError('ACK_LOST');
    },
  });
}
