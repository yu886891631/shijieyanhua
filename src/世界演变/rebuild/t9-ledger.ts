/** Versioned, credential-free round bookkeeping sealed inside the single T4 commit. */
import { z } from 'zod';
import { cloneT2Json, T2_ID_PATTERN } from './t2-template';
import type { T4Archive, T4State } from './t4-protocol';
const id = z
  .string()
  .regex(T2_ID_PATTERN)
  .refine(v => !['constructor', 'prototype'].includes(v));
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const t9LedgerSchema = z.strictObject({
  version: z.literal(1),
  frozenInputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  eligibleRound: integer,
  worldTime: z.strictObject({ calendarId: id, ordinalMinute: z.number().int().safe() }).nullable(),
  progress: z.record(id, z.strictObject({ lastSuccessfulRound: integer.nullable(), rotation: integer })),
  processedTableIds: z.array(id).max(256),
  sent: integer,
  maxRequests: integer,
});
export type T9Ledger = z.infer<typeof t9LedgerSchema>;
export function normalizeT9Ledger(input: unknown, state: T4State): T9Ledger {
  const value = t9LedgerSchema.parse(cloneT2Json(input));
  const tables = new Set(state.template.tables.map(t => t.id));
  if (
    new Set(value.processedTableIds).size !== value.processedTableIds.length ||
    value.processedTableIds.some(
      id => !tables.has(id) || value.progress[id]?.lastSuccessfulRound !== value.eligibleRound,
    ) ||
    Object.entries(value.progress).some(
      ([id, p]) => !tables.has(id) || (p.lastSuccessfulRound ?? 0) > value.eligibleRound,
    ) ||
    (value.worldTime && !state.template.calendars.some(c => c.id === value.worldTime?.calendarId)) ||
    value.maxRequests !== Math.min(state.template.defaults.budget.maxRequests, state.template.hardLimits.maxRequests) ||
    value.sent > value.maxRequests
  )
    throw new Error('整轮时间、进度或请求账本无效');
  return value;
}
/** Pure checkpoint recovery: no model, SQL, timer, storage write or resume side effect. */
export function recoverT9Ledger(archive: T4Archive): T9Ledger | null {
  const checkpoints = new Map<string, T9Ledger | null>();
  let value: T9Ledger | null = archive.origin.kind === 'new' ? null : recoverT9Ledger(archive.origin.sourceHistory);
  for (const commit of archive.commits) {
    if (commit.kind === 'restore')
      value = commit.sourceCommitId === null ? null : (checkpoints.get(commit.sourceCommitId) ?? null);
    else if (commit.transfer && Object.hasOwn(commit.transfer, 'ledger')) value = commit.transfer.ledger ?? null;
    else if (commit.evolution) value = commit.evolution;
    if (value) {
      value = t9LedgerSchema.parse(cloneT2Json(value));
      const ids = new Set(commit.snapshot.state.template.tables.map(t => t.id));
      value.progress = Object.fromEntries(Object.entries(value.progress).filter(([id]) => ids.has(id)));
      value.processedTableIds = value.processedTableIds.filter(id => ids.has(id));
    }
    checkpoints.set(commit.commitId, value);
  }
  return value === null ? null : t9LedgerSchema.parse(cloneT2Json(value));
}
