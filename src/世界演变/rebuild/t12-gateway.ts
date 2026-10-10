/** T12 guarded worldbook port. A Promise updater or a module-local lock is NOT this capability. */
import { z } from 'zod';
import type { T2Json } from './t2-template';
import { fingerprintT4, normalizeT4Scope, type T4Scope } from './t4-protocol';
import {
  T12_NS,
  T12Error,
  copyT12,
  keyT12,
  normalizeT12Binding,
  sameT12,
  type T12Binding,
  type T12Generation,
  type T12Payload,
  type T12Projection,
} from './t12-projection';
export interface T12BookEntry {
  uid: number;
  [key: string]: T2Json;
}
export interface T12Activation {
  binding: T12Binding;
  generationId: string;
  head: T12Generation['head'];
}
export interface T12Book {
  entries: T12BookEntry[];
  active: T12Activation | null;
  blocked: boolean;
}
export interface T12Owner {
  format: 'world-evolution-sql-t12';
  version: 1;
  scope: T4Scope;
  characterId: string;
  key: string;
  tableId: string;
  rowId: string | null;
  generationId: string;
  source: T12Generation['head'];
  contentFingerprint: string;
}
export interface T12Capabilities {
  environment: 'simulated' | 'verified-host' | 'unverified-host' | 'compatibility-host';
  consistency?: 'optimistic-single-page';
  evidence: string[];
  durableRead: boolean;
  guardedWrites: boolean;
  guardedCapture: boolean;
  sourceFence: boolean;
  scope: 'fixture' | 'single-server-book' | 'none';
}
export interface T12Guard {
  /** Revalidate independent confirmed source + current target inside the trusted boundary. */
  authorize: () => Promise<void>;
  /** Final synchronous local revocation check, in addition to the driver's source fence. */
  assertCurrent: () => void;
  signal?: AbortSignal;
}
export interface T12Driver {
  readonly capabilities: T12Capabilities;
  writableNow?(): boolean;
  current(): Promise<T12Binding>;
  read(book: string): Promise<T12Book>;
  subscribe?(listener: (event: 'binding' | 'book') => void): () => void;
  synchronize(
    input: T12Guard & {
      generation: T12Generation;
      expectedBookFingerprint: string;
      operation: 'sync' | 'repair' | 'rebuild';
    },
  ): Promise<void>;
  /** Lock remains held until prompt capture finishes; no live plugin hook is implied. */
  capture<T>(
    input: T12Guard & { generation: T12Generation },
    consume: (entries: T12BookEntry[]) => Promise<T>,
  ): Promise<T>;
}
export function canWriteT12(c: T12Capabilities): boolean {
  return (
    ((c.environment === 'simulated' && c.scope === 'fixture') ||
      (c.environment === 'verified-host' && c.scope === 'single-server-book')) &&
    c.evidence.length > 0 &&
    c.durableRead &&
    c.guardedWrites &&
    c.guardedCapture &&
    c.sourceFence
  );
}
/** Synchronization only. Does NOT grant the strict prompt-capture/source-fence capability. */
export function canSynchronizeT12Compatibility(driver: T12Driver): boolean {
  const c = driver.capabilities;
  return (
    c.environment === 'compatibility-host' &&
    c.consistency === 'optimistic-single-page' &&
    c.scope === 'single-server-book' &&
    c.evidence.length > 0 &&
    c.durableRead &&
    !c.guardedWrites &&
    !c.guardedCapture &&
    !c.sourceFence &&
    driver.writableNow?.() === true
  );
}
/** Ordinary getters/updaters have no proven capture/source fence. This adapter is preview-only. */
export function createT12ReadOnlyDriver(port: Pick<T12Driver, 'current' | 'read' | 'subscribe'>): T12Driver {
  return {
    ...port,
    capabilities: {
      environment: 'unverified-host',
      evidence: ['未验证持久读回、世界隔离与主 AI 捕获门控'],
      durableRead: false,
      guardedWrites: false,
      guardedCapture: false,
      sourceFence: false,
      scope: 'none',
    },
    synchronize: async () => {
      throw new T12Error('ISOLATION');
    },
    capture: async () => {
      throw new T12Error('ISOLATION');
    },
  };
}
const isObject = (v: T2Json | undefined): v is Record<string, T2Json> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const ownerSchema = z.strictObject({
  format: z.literal('world-evolution-sql-t12'),
  version: z.literal(1),
  scope: z.unknown(),
  characterId: z.string().min(1).max(512),
  key: z.string().min(1).max(512),
  tableId: id,
  rowId: id.nullable(),
  generationId: hash,
  source: z.strictObject({
    commitId: id.nullable(),
    seq: z.number().int().min(0),
    revision: z.number().int().min(0),
    stateFingerprint: hash,
  }),
  contentFingerprint: hash,
});
/** Prefix/name/old managedBy never grants deletion rights. Corrupt new ownership fails closed. */
export function ownerT12(e: T12BookEntry): T12Owner | null {
  if (!isObject(e.extra) || !Object.hasOwn(e.extra, T12_NS)) return null;
  try {
    const raw = ownerSchema.parse(e.extra[T12_NS]),
      scope = normalizeT4Scope(raw.scope);
    if (raw.key !== keyT12(scope, raw.tableId, raw.rowId)) throw new Error();
    return { ...raw, scope };
  } catch {
    throw new T12Error('INTEGRITY');
  }
}
export function normalizeT12Book(input: unknown): T12Book {
  try {
    const raw = z
      .strictObject({
        entries: z.array(z.record(z.string(), z.unknown())).max(5000),
        active: z.unknown().nullable(),
        blocked: z.boolean(),
      })
      .parse(copyT12(input));
    const entries = raw.entries.map(e => {
      z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(e.uid);
      return e as T12BookEntry;
    });
    if (new Set(entries.map(e => e.uid)).size !== entries.length) throw new Error();
    let active: T12Activation | null = null;
    if (raw.active !== null) {
      const a = z
        .strictObject({ binding: z.unknown(), generationId: hash, head: ownerSchema.shape.source })
        .parse(raw.active);
      active = { ...a, binding: normalizeT12Binding(a.binding) };
    }
    const book = { entries, active, blocked: raw.blocked };
    for (const e of entries) ownerT12(e);
    return book;
  } catch {
    throw new T12Error('INTEGRITY');
  }
}
export const activationT12 = (g: T12Generation): T12Activation => ({
  binding: copyT12(g.binding),
  generationId: g.fingerprint,
  head: copyT12(g.head),
});
function ownedBy(g: T12Generation, o: T12Owner) {
  return sameT12(g.scope, o.scope) && g.binding.characterId === o.characterId;
}
export function materializeT12(g: T12Generation, p: T12Projection, uid: number, existing?: T12BookEntry): T12BookEntry {
  const owner: T12Owner = {
    format: 'world-evolution-sql-t12',
    version: 1,
    scope: g.scope,
    characterId: g.binding.characterId,
    key: p.key,
    tableId: p.tableId,
    rowId: p.rowId,
    generationId: g.fingerprint,
    source: g.head,
    contentFingerprint: p.fingerprint,
  };
  const extra = existing && isObject(existing.extra) ? existing.extra : {};
  return copyT12({
    ...existing,
    ...p.payload,
    uid,
    enabled: true,
    extra: { ...extra, [T12_NS]: owner },
  }) as unknown as T12BookEntry;
}
export async function matchesT12(g: T12Generation, p: T12Projection, e: T12BookEntry): Promise<boolean> {
  const o = ownerT12(e);
  if (
    !o ||
    !ownedBy(g, o) ||
    e.enabled !== true ||
    o.key !== p.key ||
    o.generationId !== g.fingerprint ||
    !sameT12(o.source, g.head) ||
    o.contentFingerprint !== p.fingerprint
  )
    return false;
  if (Object.keys(p.payload).some(k => !Object.hasOwn(e, k))) return false;
  const payload = Object.fromEntries(Object.keys(p.payload).map(k => [k, e[k]])) as unknown as T12Payload;
  return (await fingerprintT4(payload)) === p.fingerprint;
}
export interface T12Diff {
  kind: 'create' | 'update' | 'delete' | 'deactivate' | 'keep';
  key: string | null;
  uid: number | null;
  reason: string;
}
export async function diffT12Book(g: T12Generation, input: T12Book): Promise<T12Diff[]> {
  const book = normalizeT12Book(input),
    desired = new Map(g.entries.map(e => [e.key, e])),
    matched = new Map<string, T12BookEntry>();
  const diff: T12Diff[] = [];
  for (const e of [...book.entries].sort((a, b) => a.uid - b.uid)) {
    const o = ownerT12(e);
    if (!o) continue;
    if (!ownedBy(g, o)) {
      if (e.enabled === true)
        diff.push({
          kind: 'deactivate',
          key: null,
          uid: e.uid,
          reason: '停用同书其他世界/分支的本插件条目；保留内容，不删除',
        });
      continue;
    }
    const p = desired.get(o.key);
    if (!p || matched.has(o.key)) {
      diff.push({
        kind: 'delete',
        key: o.key,
        uid: e.uid,
        reason: p ? '移除当前世界的重复托管条目' : '当前正式模板/数据已不再导出该托管条目',
      });
      continue;
    }
    matched.set(o.key, e);
    const equal = await matchesT12(g, p, e);
    diff.push({
      kind: equal ? 'keep' : 'update',
      key: o.key,
      uid: e.uid,
      reason: equal ? '内容、策略与源版本一致' : '正文、标题、关键词、策略或源版本发生变化',
    });
  }
  for (const p of g.entries)
    if (!matched.has(p.key)) diff.push({ kind: 'create', key: p.key, uid: null, reason: '新增当前世界允许导出的资料' });
  return diff;
}
export function assertT12NoAmbiguousActive(book: T12Book): void {
  if (
    book.entries.some(
      e => !ownerT12(e) && e.enabled === true && typeof e.name === 'string' && e.name.startsWith('WorldEvolution-'),
    )
  )
    throw new T12Error('ISOLATION');
}
/** Synced requires live readback of all payloads and the complete active generation, not a cached ledger. */
export async function confirmedT12Book(g: T12Generation, input: T12Book): Promise<boolean> {
  const book = normalizeT12Book(input);
  assertT12NoAmbiguousActive(book);
  if (book.blocked || !sameT12(book.active, activationT12(g))) return false;
  return (await diffT12Book(g, book)).every(d => d.kind === 'keep');
}
