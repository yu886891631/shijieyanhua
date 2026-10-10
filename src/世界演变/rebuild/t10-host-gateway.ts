/** Injectable host boundary. No silent use of local getters as durable storage or cross-instance CAS. */
import { cloneT2Json, type T2Json } from './t2-template';
import {
  fingerprintT4,
  normalizeT4Scope,
  validateT4Archive,
  validateT4Commit,
  type T4Anchor,
  type T4Origin,
  type T4Scope,
  type T4State,
} from './t4-protocol';
import { headT4Token, T4StoreError, type T4ArchiveGateway, type T4SaveInput } from './t4-store';
import {
  T10Error,
  T10_NAMESPACE,
  captureT10Anchor,
  copyT10,
  initializeT10Document,
  normalizeT10Document,
  registerT10Messages,
  sameT10,
  sealT10RunRecord,
  validT10Dependencies,
  validateT10Envelope,
  type T10Binding,
  type T10Dependency,
  type T10Document,
  type T10Envelope,
  type T10RunRecord,
} from './t10-host-protocol';
export type T10Event =
  | 'refresh'
  | 'chat-changed'
  | 'copied'
  | 'branched'
  | 'deleted'
  | 'edited'
  | 'updated'
  | 'swiped'
  | 'swipe-deleted'
  | 'regenerated'
  | 'cancelled';
export interface T10Capabilities {
  environment: 'simulated-host' | 'verified-host' | 'unverified-host' | 'compatibility-host';
  version: string;
  evidence: string;
  durableRead: boolean;
  /** Atomic whole-document compare protects other writers too, not just this plugin's revision. */
  atomicDocumentCas: boolean;
  /** Explicit front-end opt-in, never equivalent to a server CAS. */
  consistency?: 'optimistic-single-page';
  writeScope: 'fixture' | 'single-server-chat' | 'none';
}
export interface T10Driver {
  readonly capabilities: T10Capabilities;
  currentBinding(): T10Binding;
  /** Compatibility drivers must revoke writes after uncertainty, invalidation or lost ownership. */
  writableNow?(): boolean;
  /** Must read persisted JSON through an independent boundary, not cached helper getters. */
  readDurable(binding: T10Binding): Promise<T10Document>;
  /** The driver must invoke synchronous authorize immediately at its write boundary.
   * It must reject changed current binding and changed full document. Timeout/unknown result
   * must NOT be reported SAVE_FAILED unless absence of the write is established.
   * A compatibility driver only checks optimistically; the server has no atomic compare. */
  compareDocument(input: {
    binding: T10Binding;
    expectedFingerprint: string;
    document: T10Document;
    signal?: AbortSignal;
    authorize: () => void;
  }): Promise<void>;
  subscribe?(listener: (event: T10Event) => void): () => void;
}
export interface T10Gateway extends T4ArchiveGateway {
  readonly mode: 't10-host';
  readonly driver: T10Driver;
  initialize(scope: T4Scope, state: T4State, allocate: (kind: 'message' | 'swipe') => string): Promise<void>;
  capture(scope: T4Scope, messageIndex: number, inputFingerprint: string): Promise<T4Anchor>;
  registerMessages(scope: T4Scope, allocate: (kind: 'message' | 'swipe') => string): Promise<void>;
  reserveSend(
    scope: T4Scope,
    ownerId: string,
    input: {
      runId: string;
      stage: 'macro' | 'micro';
      sent: number;
      maxRequests: number;
      anchor: T4Anchor;
      signal: AbortSignal;
    },
  ): Promise<void>;
  abandonRun(scope: T4Scope, runId: string): Promise<void>;
  installFork(
    scope: T4Scope,
    origin: T4Origin,
    state: T4State,
    target: T10Document,
    inherited: T10Dependency[],
  ): Promise<void>;
}
export function canWriteT10(driver: T10Driver): boolean {
  const c = driver.capabilities;
  return (
    !!c.version &&
    !!c.evidence &&
    (c.environment === 'simulated-host' || c.environment === 'verified-host') &&
    c.durableRead &&
    c.atomicDocumentCas &&
    (c.environment === 'simulated-host' ? c.writeScope === 'fixture' : c.writeScope === 'single-server-chat')
  );
}
/** Kept separate: JSON/import flags cannot turn the strict gateway into a compatible one. */
export function canWriteT10Compatibility(driver: T10Driver): boolean {
  const c = driver.capabilities;
  return (
    c.environment === 'compatibility-host' &&
    !!c.version &&
    !!c.evidence &&
    c.durableRead &&
    !c.atomicDocumentCas &&
    c.consistency === 'optimistic-single-page' &&
    c.writeScope === 'single-server-chat' &&
    driver.writableNow?.() === true
  );
}
export function createT10Gateway(driver: T10Driver): T10Gateway {
  return gatewayT10(driver, canWriteT10);
}
/** Explicitly selected single-page mode. Same validation/recovery, weaker host concurrency. */
export function createT10CompatibilityGateway(driver: T10Driver): T10Gateway {
  return gatewayT10(driver, canWriteT10Compatibility);
}
function gatewayT10(driver: T10Driver, canWrite: (driver: T10Driver) => boolean): T10Gateway {
  const frozenCapabilities = copyT10(driver.capabilities);
  // Capability declarations are an integration gate, NOT a proof supplied by JSON/imports.
  const binding = copyT10(driver.currentBinding());
  const captures = new Map<string, { anchor: T4Anchor; dependencies: T10Dependency[] }>();
  const key = (a: T4Anchor) => `${a.chatId}/${a.messageId}/${a.swipeId}/${a.inputFingerprint}`;
  function current() {
    if (!sameT10(driver.currentBinding(), binding)) throw new T10Error('IDENTITY');
  }
  function writeAllowed() {
    current();
    if (!sameT10(driver.capabilities, frozenCapabilities) || !canWrite(driver)) throw new T10Error('CAPABILITY');
  }
  async function document() {
    current();
    const doc = normalizeT10Document(await driver.readDurable(binding));
    current();
    if (!sameT10(doc.binding, binding)) throw new T10Error('IDENTITY');
    return doc;
  }
  async function envelope(doc: T10Document, input: T4Scope) {
    const scope = normalizeT4Scope(input),
      e = await validateT10Envelope(doc.variables[T10_NAMESPACE], doc);
    if (!sameT10(e.scope, scope)) throw new T10Error('IDENTITY');
    return e;
  }
  async function write(previous: T10Document, next: T10Document, signal?: AbortSignal, authorize?: () => void) {
    writeAllowed();
    const expectedFingerprint = await fingerprintT4(previous);
    // This refuses a malformed/over-budget proposal before the durable write, not afterwards.
    const frozen = normalizeT10Document(next);
    await driver.compareDocument({
      binding,
      expectedFingerprint,
      document: frozen,
      signal,
      authorize() {
        writeAllowed();
        if (signal?.aborted) throw new T4StoreError('ABORTED');
        if (authorize?.() !== undefined) throw new T4StoreError('ABORTED');
      },
    });
  }
  function put(doc: T10Document, e: T10Envelope) {
    doc.variables[T10_NAMESPACE] = cloneT2Json(e);
  }
  async function confirmed(scope: T4Scope) {
    return envelope(await document(), scope);
  }
  const unfinished = (e: T10Envelope, runId: string) =>
    e.runs.some(
      r => r.resolution === 'active' && r.runId !== runId && !e.archive.commits.some(c => c.runId === r.runId),
    );
  return Object.freeze({
    mode: 't10-host' as const,
    driver,
    async read(scope: T4Scope) {
      return (await confirmed(scope)).archive;
    },
    async initialize(scope: T4Scope, state: T4State, allocate: (kind: 'message' | 'swipe') => string) {
      writeAllowed();
      const previous = await document(),
        next = await initializeT10Document(previous, scope, state, allocate);
      if (!previous.messages.some(m => m.role === 'assistant')) throw new T10Error('ANCHOR');
      await write(previous, next);
      await confirmed(scope);
    },
    async installFork(
      scope: T4Scope,
      origin: T4Origin,
      state: T4State,
      target: T10Document,
      inherited: T10Dependency[],
    ) {
      writeAllowed();
      const previous = await document(),
        next = normalizeT10Document(target);
      if (!next.messages.some(m => m.role === 'assistant')) throw new T10Error('ANCHOR');
      // The pure fork preparation owns the explicit namespace replacement only.
      const stripped = copyT10(next);
      delete stripped.variables[T10_NAMESPACE];
      const old = copyT10(previous);
      delete old.variables[T10_NAMESPACE];
      for (const d of [stripped, old])
        for (const m of d.messages) for (const data of m.swipes_data) delete data[T10_NAMESPACE];
      if (!sameT10(stripped, old)) throw new T10Error('IDENTITY');
      const e = await envelope(next, scope);
      if (
        !sameT10(e.archive.origin, origin) ||
        !sameT10(e.archive.genesis, state) ||
        !sameT10(e.inheritedDependencies, inherited)
      )
        throw new T10Error('ARCHIVE');
      await write(previous, next);
      await confirmed(scope);
    },
    async capture(scope: T4Scope, index: number, hash: string) {
      const doc = await document();
      await envelope(doc, scope);
      const value = await captureT10Anchor(doc, scope, index, hash);
      captures.set(key(value.anchor), copyT10(value));
      return copyT10(value.anchor);
    },
    async registerMessages(scope: T4Scope, allocate: (kind: 'message' | 'swipe') => string) {
      writeAllowed();
      const previous = await document();
      await envelope(previous, scope);
      const next = registerT10Messages(previous, allocate);
      if (!sameT10(previous, next)) await write(previous, next);
      await confirmed(scope);
    },
    async reserveSend(
      scope: T4Scope,
      ownerId: string,
      input: {
        runId: string;
        stage: 'macro' | 'micro';
        sent: number;
        maxRequests: number;
        anchor: T4Anchor;
        signal: AbortSignal;
      },
    ) {
      const frozen = copyT10({ ownerId, ...input, signal: null });
      const signal = input.signal;
      writeAllowed();
      const doc = await document(),
        e = await envelope(doc, scope);
      const previous = copyT10(doc);
      const proof = captures.get(key(frozen.anchor));
      if (!proof || !(await validT10Dependencies(doc, proof.dependencies))) throw new T10Error('ANCHOR');
      if (e.archive.commits.some(c => c.runId === frozen.runId)) throw new T10Error('CONFLICT');
      const old = e.runs.find(r => r.runId === frozen.runId);
      if (unfinished(e, frozen.runId)) throw new T10Error('CONFLICT');
      const base = headT4Token(e.archive);
      if (
        old &&
        (old.resolution !== 'active' ||
          old.ownerId !== ownerId ||
          !sameT10(old.base, base) ||
          !sameT10(old.anchor, frozen.anchor) ||
          old.maxRequests !== frozen.maxRequests ||
          old.sent + 1 !== frozen.sent ||
          (old.phase === 'micro' && frozen.stage === 'macro'))
      )
        throw new T10Error('CONFLICT');
      if (!old && frozen.sent !== 1) throw new T10Error('CONFLICT');
      const state = e.archive.commits.at(-1)?.snapshot.state ?? e.archive.genesis;
      if (
        frozen.maxRequests > Math.min(state.template.defaults.budget.maxRequests, state.template.hardLimits.maxRequests)
      )
        throw new T10Error('LIMIT');
      const record: T10RunRecord = await sealT10RunRecord(e.scope, {
        runId: frozen.runId,
        ownerId,
        resolution: 'active',
        base,
        anchor: frozen.anchor,
        phase: frozen.stage,
        sent: frozen.sent,
        maxRequests: frozen.maxRequests,
        dependencies: proof.dependencies,
      });
      if (old) e.runs[e.runs.indexOf(old)] = record;
      else e.runs.push(record);
      // Strict framing refuses credentials, arbitrary payloads, and overflowed counters.
      await validateT10Envelope(e, doc);
      put(doc, e);
      await write(previous, doc, signal);
      const saved = await confirmed(scope);
      if (
        !sameT10(
          saved.runs.find(r => r.runId === frozen.runId),
          record,
        )
      )
        throw new T10Error('READ');
    },
    async abandonRun(scope: T4Scope, runId: string) {
      writeAllowed();
      const doc = await document(),
        e = await envelope(doc, scope),
        previous = copyT10(doc);
      const record = e.runs.find(r => r.runId === runId);
      if (!record || e.archive.commits.some(c => c.runId === runId)) throw new T10Error('CONFLICT');
      record.resolution = 'abandoned';
      const { fingerprint: _fingerprint, ...unsigned } = record;
      record.fingerprint = (await sealT10RunRecord(e.scope, unsigned)).fingerprint;
      put(doc, e);
      await write(previous, doc);
      await confirmed(scope);
    },
    async compareAndSwap(input: T4SaveInput) {
      const signal = input.signal,
        authorize = input.authorize;
      try {
        const frozen = copyT10({ scope: input.scope, expected: input.expected, commit: input.commit });
        writeAllowed();
        const doc = await document(),
          e = await envelope(doc, frozen.scope);
        const previous = copyT10(doc),
          prior = e.archive.commits.find(c => c.commitId === frozen.commit.commitId || c.runId === frozen.commit.runId);
        if (prior) {
          if (!sameT10(prior, frozen.commit)) throw new T4StoreError('CONFLICT');
          return;
        }
        if (!sameT10(headT4Token(e.archive), frozen.expected)) throw new T4StoreError('CONFLICT');
        const proof = captures.get(key(frozen.commit.anchor));
        if (!proof || !(await validT10Dependencies(doc, proof.dependencies))) throw new T4StoreError('ANCHOR');
        const commit = await validateT4Commit(
          frozen.commit,
          e.archive.commits.at(-1)?.snapshot.state ?? e.archive.genesis,
          e.scope,
          frozen.expected.commitId,
          frozen.expected.seq + 1,
        );
        const activeRun = e.runs.find(r => r.runId === commit.runId);
        if (
          commit.evolution &&
          commit.evolution.sent > 0 &&
          (!activeRun ||
            activeRun.sent !== commit.evolution.sent ||
            activeRun.maxRequests !== commit.evolution.maxRequests ||
            !sameT10(activeRun.base, frozen.expected))
        )
          throw new T4StoreError('CONFLICT');
        if (unfinished(e, commit.runId) || activeRun?.resolution === 'abandoned') throw new T4StoreError('CONFLICT');
        e.archive = await validateT4Archive({ ...e.archive, commits: [...e.archive.commits, commit] });
        const receipt = { commitId: commit.commitId, anchor: commit.anchor, dependencies: proof.dependencies };
        e.receipts.push({
          ...receipt,
          fingerprint: await fingerprintT4({ scope: e.scope, receipt, commitFingerprint: commit.fingerprint }),
        });
        put(doc, e);
        await write(previous, doc, signal, authorize);
        // T4 independently queries confirmation before switching formal state/cache.
      } catch (error) {
        if (error instanceof T10Error)
          throw new T4StoreError(
            error.code === 'CAPABILITY'
              ? 'SAVE_FAILED'
              : error.code === 'CONFLICT'
                ? 'CONFLICT'
                : error.code === 'ABORTED'
                  ? 'ABORTED'
                  : ['ANCHOR', 'DEPENDENCY'].includes(error.code)
                    ? 'ANCHOR'
                    : error.code === 'READ'
                      ? 'READ_FAILED'
                      : 'IDENTITY',
          );
        throw error;
      }
    },
  });
}
