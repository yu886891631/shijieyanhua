/** Chat JSON is authority. This codec has no host calls, AI, storage or startup effects. */
import { z } from 'zod';
import { cloneT2Json, type T2Json } from './t2-template';
import {
  canonicalT4Json,
  createT4Archive,
  fingerprintT4,
  normalizeT4Anchor,
  normalizeT4Scope,
  validateT4Archive,
  type T4Anchor,
  type T4Archive,
  type T4Scope,
  type T4State,
} from './t4-protocol';
import { headT4Token, type T4HeadToken } from './t4-store';
export const T10_NAMESPACE = 'world_evolution_sql_t10';
const id = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/)
  .refine(v => !['constructor', 'prototype'].includes(v));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const bindingShape = z.strictObject({
  hostChatId: z
    .string()
    .min(1)
    .max(256)
    .refine(v => v !== 'unknown_chat'),
  characterId: z.string().min(1).max(256),
});
export type T10Binding = z.infer<typeof bindingShape>;
/** Lossless normalized TavernHelper include_swipes view. Unknown JSON fields are preserved. */
export interface T10Message {
  message_id: number;
  name: string;
  role: 'user' | 'assistant' | 'system';
  is_hidden: boolean;
  swipe_id: number;
  swipes: string[];
  swipes_data: Record<string, T2Json>[];
  swipes_info: Record<string, T2Json>[];
  [key: string]: T2Json;
}
export interface T10Document {
  binding: T10Binding;
  variables: Record<string, T2Json>;
  messages: T10Message[];
}
export interface T10Dependency {
  messageId: string;
  swipeId: string;
  bodyFingerprint: string;
}
export interface T10Receipt {
  commitId: string;
  anchor: T4Anchor;
  dependencies: T10Dependency[];
  fingerprint: string;
}
export interface T10RunRecord {
  runId: string;
  ownerId: string;
  base: T4HeadToken;
  anchor: T4Anchor;
  resolution: 'active' | 'abandoned';
  phase: 'macro' | 'micro';
  sent: number;
  maxRequests: number;
  dependencies: T10Dependency[];
  fingerprint: string;
}
export interface T10Envelope {
  format: 'world-evolution-t10-chat';
  version: 1;
  binding: T10Binding;
  scope: T4Scope;
  archive: T4Archive;
  receipts: T10Receipt[];
  inheritedDependencies: T10Dependency[];
  inheritedFingerprint: string;
  runs: T10RunRecord[];
}
const dependencyShape = z.strictObject({ messageId: id, swipeId: id, bodyFingerprint: hash });
const headShape = z.strictObject({ commitId: id.nullable(), seq: integer, revision: integer, stateFingerprint: hash });
const stampShape = z.strictObject({ messageId: id, swipeId: id });
const envelopeShape = z.strictObject({
  format: z.literal('world-evolution-t10-chat'),
  version: z.literal(1),
  binding: bindingShape,
  scope: z.unknown(),
  archive: z.unknown(),
  receipts: z
    .array(
      z.strictObject({
        commitId: id,
        anchor: z.unknown(),
        dependencies: z.array(dependencyShape).max(2000),
        fingerprint: hash,
      }),
    )
    .max(32),
  inheritedDependencies: z.array(dependencyShape).max(2000),
  inheritedFingerprint: hash,
  runs: z
    .array(
      z.strictObject({
        runId: id,
        ownerId: id,
        resolution: z.enum(['active', 'abandoned']),
        base: headShape,
        anchor: z.unknown(),
        phase: z.enum(['macro', 'micro']),
        sent: integer.min(1).max(10),
        maxRequests: integer.min(1).max(10),
        dependencies: z.array(dependencyShape).max(2000),
        fingerprint: hash,
      }),
    )
    .max(64),
});
const documentShape = z.strictObject({
  binding: bindingShape,
  variables: z.record(z.string(), z.unknown()),
  messages: z
    .array(
      z.looseObject({
        message_id: integer,
        name: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        is_hidden: z.boolean(),
        swipe_id: integer,
        swipes: z.array(z.string()).min(1).max(256),
        swipes_data: z.array(z.record(z.string(), z.unknown())),
        swipes_info: z.array(z.record(z.string(), z.unknown())),
      }),
    )
    .max(2000),
});
export class T10Error extends Error {
  constructor(
    readonly code:
      | 'CAPABILITY'
      | 'IDENTITY'
      | 'ANCHOR'
      | 'ARCHIVE'
      | 'DEPENDENCY'
      | 'CONFLICT'
      | 'LIMIT'
      | 'READ'
      | 'ABORTED',
  ) {
    super(`酒馆存档：${code}`);
    this.name = 'T10Error';
  }
}
export const sameT10 = (a: unknown, b: unknown) => canonicalT4Json(a) === canonicalT4Json(b);
export const copyT10 = <T>(v: T): T => cloneT2Json(v) as unknown as T;
export function normalizeT10Document(input: unknown): T10Document {
  try {
    const doc = documentShape.parse(cloneT2Json(input)) as T10Document;
    if (
      doc.messages.some(
        (m, i) =>
          m.message_id !== i ||
          m.swipe_id >= m.swipes.length ||
          m.swipes_data.length !== m.swipes.length ||
          m.swipes_info.length !== m.swipes.length,
      )
    )
      throw new Error();
    return doc;
  } catch {
    throw new T10Error('IDENTITY');
  }
}
/** Parse only framing first; recovery may retain a validated prefix of a damaged archive. */
export function frameT10Envelope(input: unknown): T10Envelope {
  try {
    const frame = envelopeShape.parse(cloneT2Json(input));
    const scope = normalizeT4Scope(frame.scope);
    if (scope.mode !== 't10-host') throw new Error();
    const receipts = frame.receipts.map(r => ({ ...r, anchor: normalizeT4Anchor(r.anchor) }));
    const runs = frame.runs.map(r => ({ ...r, anchor: normalizeT4Anchor(r.anchor) }));
    if (
      new Set(receipts.map(r => r.commitId)).size !== receipts.length ||
      new Set(runs.map(r => r.runId)).size !== runs.length ||
      runs.some(r => r.sent > r.maxRequests)
    )
      throw new Error();
    return { ...frame, scope, receipts, runs } as T10Envelope;
  } catch {
    throw new T10Error('ARCHIVE');
  }
}
export function stampedT10Messages(doc: T10Document, throughIndex = doc.messages.length - 1) {
  const seenMessages = new Set<string>(),
    seenSwipes = new Set<string>();
  return doc.messages.slice(0, throughIndex + 1).map(message => {
    const stamps = message.swipes_data.map(data => {
      if (!Object.hasOwn(data, T10_NAMESPACE)) return null;
      try {
        return stampShape.parse(data[T10_NAMESPACE]);
      } catch {
        throw new T10Error('ANCHOR');
      }
    });
    const active = stamps[message.swipe_id];
    if (!active) throw new T10Error('ANCHOR');
    const messageId = active.messageId;
    if (seenMessages.has(messageId) || stamps.some(s => s && s.messageId !== messageId)) throw new T10Error('ANCHOR');
    seenMessages.add(messageId);
    for (const s of stamps) {
      if (!s) continue;
      if (seenSwipes.has(s.swipeId)) throw new T10Error('ANCHOR');
      seenSwipes.add(s.swipeId);
    }
    return { message, stamps, active };
  });
}
export async function dependenciesT10(doc: T10Document, messageIndex: number): Promise<T10Dependency[]> {
  if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= doc.messages.length)
    throw new T10Error('ANCHOR');
  const stamped = stampedT10Messages(doc, messageIndex);
  return Promise.all(
    stamped.map(async ({ message: m, active }) => ({
      ...active,
      bodyFingerprint: await fingerprintT4({
        name: m.name,
        role: m.role,
        hidden: m.is_hidden,
        body: m.swipes[m.swipe_id],
      }),
    })),
  );
}
export async function captureT10Anchor(
  doc: T10Document,
  scope: T4Scope,
  messageIndex: number,
  inputFingerprint: string,
): Promise<{ anchor: T4Anchor; dependencies: T10Dependency[] }> {
  const messages = stampedT10Messages(doc, messageIndex),
    m = messages[messageIndex];
  if (!m || m.message.role !== 'assistant') throw new T10Error('ANCHOR');
  return {
    anchor: normalizeT4Anchor({ chatId: scope.chatId, ...m.active, inputFingerprint }),
    dependencies: await dependenciesT10(doc, messageIndex),
  };
}
/** Current prefix/order and active swipe must match. Numeric positions never become identities. */
export async function validT10Dependencies(doc: T10Document, dependencies: T10Dependency[]): Promise<boolean> {
  if (!dependencies.length) return true;
  try {
    const index = doc.messages.findIndex(m => {
      const stamp = m.swipes_data[m.swipe_id][T10_NAMESPACE];
      return (
        stamp &&
        typeof stamp === 'object' &&
        !Array.isArray(stamp) &&
        stamp.messageId === dependencies.at(-1)!.messageId
      );
    });
    return index >= 0 && sameT10(await dependenciesT10(doc, index), dependencies);
  } catch {
    return false;
  }
}
/** Explicitly propose IDs for newly appended messages/swipes; existing IDs are not renumbered. */
export function registerT10Messages(input: T10Document, allocate: (kind: 'message' | 'swipe') => string): T10Document {
  const doc = normalizeT10Document(input);
  for (const m of doc.messages) {
    const existing = m.swipes_data
      .filter(d => Object.hasOwn(d, T10_NAMESPACE))
      .map(d => stampShape.parse(d[T10_NAMESPACE]));
    const messageId = existing[0]?.messageId ?? id.parse(allocate('message'));
    if (existing.some(s => s.messageId !== messageId)) throw new T10Error('ANCHOR');
    for (const data of m.swipes_data)
      if (!Object.hasOwn(data, T10_NAMESPACE))
        data[T10_NAMESPACE] = { messageId, swipeId: id.parse(allocate('swipe')) };
  }
  stampedT10Messages(doc);
  return doc;
}
export async function validateT10Envelope(input: unknown, doc: T10Document): Promise<T10Envelope> {
  const e = frameT10Envelope(input),
    archive = await validateT4Archive(e.archive);
  if (
    e.inheritedFingerprint !==
    (await fingerprintT4({
      scope: e.scope,
      genesisFingerprint: archive.genesisFingerprint,
      origin: archive.origin,
      dependencies: e.inheritedDependencies,
    }))
  )
    throw new T10Error('ARCHIVE');
  if (!sameT10(e.binding, doc.binding) || !sameT10(archive.scope, e.scope)) throw new T10Error('IDENTITY');
  if (e.receipts.length !== archive.commits.length) throw new T10Error('ARCHIVE');
  for (const [i, c] of archive.commits.entries()) {
    const r = e.receipts[i];
    const { fingerprint, ...unsigned } = r;
    if (fingerprint !== (await fingerprintT4({ scope: e.scope, receipt: unsigned, commitFingerprint: c.fingerprint })))
      throw new T10Error('ARCHIVE');
    if (
      r.commitId !== c.commitId ||
      !sameT10(r.anchor, c.anchor) ||
      !r.dependencies.length ||
      !sameT10(
        r.dependencies.at(-1) && {
          messageId: r.dependencies.at(-1)!.messageId,
          swipeId: r.dependencies.at(-1)!.swipeId,
        },
        { messageId: c.anchor.messageId, swipeId: c.anchor.swipeId },
      )
    )
      throw new T10Error('ARCHIVE');
    if (!(await validT10Dependencies(doc, r.dependencies))) throw new T10Error('DEPENDENCY');
  }
  if (!(await validT10Dependencies(doc, e.inheritedDependencies))) throw new T10Error('DEPENDENCY');
  for (const r of e.runs) {
    await validateT10RunRecord(e.scope, r);
    if (
      r.anchor.chatId !== e.scope.chatId ||
      !r.dependencies.length ||
      !sameT10(
        { messageId: r.anchor.messageId, swipeId: r.anchor.swipeId },
        { messageId: r.dependencies.at(-1)!.messageId, swipeId: r.dependencies.at(-1)!.swipeId },
      )
    )
      throw new T10Error('ARCHIVE');
  }
  return { ...e, archive };
}
export async function sealT10RunRecord(
  scope: T4Scope,
  record: Omit<T10RunRecord, 'fingerprint'>,
): Promise<T10RunRecord> {
  const unsigned = copyT10(record);
  return { ...unsigned, fingerprint: await fingerprintT4({ scope, record: unsigned }) };
}
export async function validateT10RunRecord(scope: T4Scope, record: T10RunRecord): Promise<void> {
  const { fingerprint, ...unsigned } = record;
  if (fingerprint !== (await fingerprintT4({ scope, record: unsigned }))) throw new T10Error('ARCHIVE');
}
/** Explicit initialization only. Returns a proposed document; never writes or migrates old data. */
export async function initializeT10Document(
  input: T10Document,
  scopeInput: T4Scope,
  state: T4State,
  allocate: (kind: 'message' | 'swipe') => string,
): Promise<T10Document> {
  const doc = normalizeT10Document(input),
    scope = normalizeT4Scope(scopeInput);
  if (scope.mode !== 't10-host' || Object.hasOwn(doc.variables, T10_NAMESPACE)) throw new T10Error('IDENTITY');
  const archive = await createT4Archive(scope, state);
  for (const m of doc.messages) {
    const messageId = id.parse(allocate('message'));
    for (const data of m.swipes_data) {
      if (Object.hasOwn(data, T10_NAMESPACE)) throw new T10Error('IDENTITY');
      data[T10_NAMESPACE] = { messageId, swipeId: id.parse(allocate('swipe')) };
    }
  }
  stampedT10Messages(doc);
  doc.variables[T10_NAMESPACE] = copyT10({
    format: 'world-evolution-t10-chat',
    version: 1,
    binding: doc.binding,
    scope,
    archive,
    receipts: [],
    inheritedDependencies: [],
    inheritedFingerprint: await fingerprintT4({
      scope,
      genesisFingerprint: archive.genesisFingerprint,
      origin: archive.origin,
      dependencies: [],
    }),
    runs: [],
  }) as unknown as T2Json;
  return doc;
}
export function tokenT10Envelope(e: T10Envelope) {
  return headT4Token(e.archive);
}
