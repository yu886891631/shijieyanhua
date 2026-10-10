/** Bounded, versioned files. No API credentials, executing imports, storage or automatic restore. */
import { z } from 'zod';
import { cloneT2Json, normalizeT2Template, type T2Json, type T2Template } from './t2-template';
import {
  canonicalT4Json,
  fingerprintT4,
  normalizeT4Scope,
  normalizeT4State,
  validateT4Archive,
  type T4Archive,
  type T4State,
} from './t4-protocol';
import { recoverT9Ledger, normalizeT9Ledger } from './t9-ledger';
export const T13_FILE_LIMIT = 4_000_000;
export type T13Kind = 'world' | 'data' | 'template' | 'history' | 'legacy';
export class T13Error extends Error {
  constructor(
    readonly code:
      | 'FORMAT'
      | 'SIZE'
      | 'INTEGRITY'
      | 'SECRET'
      | 'PRIVATE'
      | 'CONFLICT'
      | 'REFERENCE'
      | 'STALE'
      | 'CONFIRM'
      | 'BUSY'
      | 'PENDING'
      | 'CLOSED'
      | 'TARGET'
      | 'READ'
      | 'SOURCE',
  ) {
    super(`备份与迁移：${code}`);
    this.name = 'T13Error';
  }
}
export const copyT13 = <T>(x: T): T => cloneT2Json(x) as unknown as T;
export const sameT13 = (a: unknown, b: unknown) => canonicalT4Json(a) === canonicalT4Json(b);
export function parseT13Text(text: string): T2Json {
  if (typeof text !== 'string' || text.length > T13_FILE_LIMIT) throw new T13Error('SIZE');
  try {
    return cloneT2Json(JSON.parse(text));
  } catch {
    throw new T13Error('FORMAT');
  }
}
const credential =
  /^(?:api[-_]?key|secret[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|credential|credentials)$/i;
/** Unknown raw fields are retained except credential-shaped keys and trusted known-secret values. */
export function redactT13(input: unknown, secrets: readonly string[] = []): { value: T2Json; redactions: number } {
  const frozen = cloneT2Json(input),
    protectedStrings = [...secrets].filter(v => v.length > 0);
  let redactions = 0;
  const walk = (v: T2Json): T2Json => {
    if (typeof v === 'string') {
      let s = v;
      for (const secret of protectedStrings)
        if (s.includes(secret)) {
          redactions++;
          s = s.replaceAll(secret, '[凭据已移除]');
        }
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          if (credential.test(k) && x !== '[凭据已移除]') {
            redactions++;
            return [k, '[凭据已移除]'];
          }
          // Secret-bearing property names cannot bypass the known-secret fence.
          return [String(walk(k)), walk(x)];
        }),
      );
    return v;
  };
  return { value: walk(frozen), redactions };
}
export function fenceT13(input: unknown, secrets: readonly string[] = []): void {
  if (redactT13(input, secrets).redactions) throw new T13Error('SECRET');
}
const envelopeSchema = z.strictObject({
  format: z.literal('world-evolution-transfer'),
  version: z.literal(1),
  kind: z.enum(['world', 'data', 'template', 'history', 'legacy']),
  payload: z.unknown(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export interface T13File {
  format: 'world-evolution-transfer';
  version: 1;
  kind: T13Kind;
  payload: T2Json;
  fingerprint: string;
}
export async function sealT13File(kind: T13Kind, input: unknown, secrets: readonly string[] = []): Promise<T13File> {
  const payload = cloneT2Json(input);
  fenceT13(payload, secrets);
  const core = { format: 'world-evolution-transfer' as const, version: 1 as const, kind, payload };
  const file = { ...core, fingerprint: await fingerprintT4(core) };
  if (JSON.stringify(file, null, 2).length > T13_FILE_LIMIT) throw new T13Error('SIZE');
  return file;
}
export async function readT13File(input: unknown, secrets: readonly string[] = []): Promise<T13File> {
  let file: T13File;
  try {
    file = envelopeSchema.parse(cloneT2Json(input)) as T13File;
  } catch {
    throw new T13Error('FORMAT');
  }
  fenceT13(file, secrets);
  const { fingerprint, ...core } = file;
  if ((await fingerprintT4(core)) !== fingerprint) throw new T13Error('INTEGRITY');
  if (file.kind === 'world' || file.kind === 'history') await validateT4Archive(file.payload);
  else if (file.kind === 'data') {
    const p = z
      .strictObject({ scope: z.unknown(), state: z.unknown(), ledger: z.unknown().nullable() })
      .parse(file.payload);
    const scope = normalizeT4Scope(p.scope),
      state = normalizeT4State(p.state);
    if (scope.worldId !== state.data.worldId || scope.branchId !== state.data.branchId) throw new T13Error('TARGET');
    normalizeT4State(p.state);
    if (p.ledger !== null) normalizeT9Ledger(p.ledger, normalizeT4State(p.state));
  } else if (file.kind === 'template') normalizeT2Template(file.payload);
  else if (file.kind === 'legacy')
    z.strictObject({
      sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      material: z.unknown(),
      redactions: z.number().int().min(0),
    }).parse(file.payload);
  return file;
}
/** Complete recovery archives necessarily contain private history; caller must have trusted authority AND consent. */
export async function exportT13Archive(
  archiveInput: T4Archive,
  kind: Exclude<T13Kind, 'legacy'>,
  privateAuthorized: boolean,
  consent: boolean,
  secrets: readonly string[] = [],
): Promise<T13File> {
  const archive = await validateT4Archive(copyT13(archiveInput));
  if (!privateAuthorized || !consent) throw new T13Error('PRIVATE');
  const state = archive.commits.at(-1)?.snapshot.state ?? archive.genesis;
  const payload =
    kind === 'template'
      ? state.template
      : kind === 'data'
        ? { scope: archive.scope, state, ledger: recoverT9Ledger(archive) }
        : archive;
  return sealT13File(kind, payload, secrets);
}
export async function stateT13File(file: T13File): Promise<{ state: T4State; archive: T4Archive | null }> {
  if (file.kind === 'world') {
    const archive = await validateT4Archive(file.payload);
    return { state: copyT13(archive.commits.at(-1)?.snapshot.state ?? archive.genesis), archive };
  }
  if (file.kind === 'data')
    return { state: normalizeT4State((file.payload as { state: T2Json }).state), archive: null };
  throw new T13Error('FORMAT');
}
export function templateT13File(file: T13File): T2Template {
  if (file.kind !== 'template') throw new T13Error('FORMAT');
  return normalizeT2Template(file.payload);
}
