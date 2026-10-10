/** Explicit read-only input adapters. No host listeners, guessed completion, or full external dump. */
import { z } from 'zod';
import { cloneT2Json, type T2Json, type T2Reference } from './t2-template';
import { fingerprintT4, type T4Anchor } from './t4-protocol';
import { readT5Sheets } from './t5-import';

export type T7Source = 'story' | 'mvu' | 'database' | 'worldbook';
export interface T7Segment {
  source: T7Source;
  sourceId: string;
  label: string;
  text: string;
  tableIds: string[];
}
export interface T7Proof {
  sourceId: string;
  required: boolean;
  state: 'not-installed' | 'disabled' | 'frequency-skipped' | 'waiting' | 'success' | 'failure' | 'unverifiable';
  identity: (T4Anchor & { worldId: string; branchId: string }) | null;
  sourceCommitId: string | null;
  resultFingerprint: string | null;
  persisted: boolean;
  requirePersisted: boolean;
  reason: string;
}
export interface T7Input {
  anchor: T4Anchor;
  worldId: string;
  branchId: string;
  eligibleRound: number;
  story: { messageId: string; role: 'user' | 'assistant'; text: string }[];
  segments: T7Segment[];
  proofs: T7Proof[];
  selected: T2Reference[];
  progress: Record<string, { lastSuccessfulRound: number | null; rotation: number }>;
  now: { calendarId: string; ordinalMinute: number } | null;
}
const text = z.string().max(100000);
const short = z.string().min(1).max(160);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const anchor = z.strictObject({ chatId: short, messageId: short, swipeId: short, inputFingerprint: digest });
const reference = z.strictObject({ tableId: z.string().min(1).max(64), rowId: z.string().min(1).max(64) });
const schema = z.strictObject({
  anchor,
  worldId: short,
  branchId: short,
  eligibleRound: z.number().int().min(0),
  story: z
    .array(z.strictObject({ messageId: short, role: z.enum(['user', 'assistant']), text }))
    .min(1)
    .max(200),
  segments: z
    .array(
      z.strictObject({
        source: z.enum(['story', 'mvu', 'database', 'worldbook']),
        sourceId: short,
        label: short,
        text,
        tableIds: z.array(z.string().min(1).max(64)).max(256),
      }),
    )
    .max(256),
  proofs: z
    .array(
      z.strictObject({
        sourceId: short,
        required: z.boolean(),
        state: z.enum([
          'not-installed',
          'disabled',
          'frequency-skipped',
          'waiting',
          'success',
          'failure',
          'unverifiable',
        ]),
        identity: anchor.extend({ worldId: short, branchId: short }).nullable(),
        sourceCommitId: short.nullable(),
        resultFingerprint: digest.nullable(),
        persisted: z.boolean(),
        requirePersisted: z.boolean(),
        reason: text,
      }),
    )
    .max(256),
  selected: z.array(reference).max(10000),
  progress: z.record(
    z.string(),
    z.strictObject({ lastSuccessfulRound: z.number().int().min(0).nullable(), rotation: z.number().int().min(0) }),
  ),
  now: z.strictObject({ calendarId: short, ordinalMinute: z.number().int().safe() }).nullable(),
});
export function normalizeT7Input(input: unknown): T7Input {
  const safe = schema.parse(cloneT2Json(input)) as T7Input;
  const ids = safe.proofs.map(p => p.sourceId);
  if (
    new Set(ids).size !== ids.length ||
    safe.story.at(-1)?.role !== 'assistant' ||
    safe.story.at(-1)?.messageId !== safe.anchor.messageId
  )
    throw new Error('前置来源重复或当前助手消息锚点不一致');
  if (safe.segments.some(s => s.source !== 'story' && !ids.includes(s.sourceId)))
    throw new Error('外部资料缺少独立前置状态');
  return safe;
}
export async function inspectT7Prerequisites(input: T7Input) {
  const expected = { ...input.anchor, worldId: input.worldId, branchId: input.branchId };
  const reports = [];
  for (const proof of input.proofs) {
    const same =
      proof.identity !== null &&
      JSON.stringify(Object.entries(proof.identity).sort()) === JSON.stringify(Object.entries(expected).sort());
    const skipped = ['disabled', 'frequency-skipped'].includes(proof.state) && proof.reason.trim().length > 0;
    const result = input.segments.filter(s => s.sourceId === proof.sourceId);
    const hash = await fingerprintT4(result);
    const valid =
      same &&
      !!proof.sourceCommitId &&
      (skipped ||
        (proof.state === 'success' &&
          hash === proof.resultFingerprint &&
          (!proof.requirePersisted || proof.persisted)));
    reports.push({
      sourceId: proof.sourceId,
      state: proof.state,
      required: proof.required,
      valid,
      allowedRead: valid && proof.state === 'success',
      reason: valid
        ? skipped
          ? '本轮明确跳过，不读取旧结果'
          : '本轮身份、结果与保存证据一致'
        : '未能证明当前消息/swipe 的必要完成与保存状态',
    });
  }
  return { ready: reports.every(p => !p.required || p.valid), reports };
}
/** Exact source column/row selection; sheet_*.content is header plus 2-D rows, not objects. */
export function adaptT7Database(
  input: unknown,
  selection: { sourceId: string; sheetId: string; rowIndices: number[]; columns: number[]; tableIds: string[] },
): T7Segment {
  const safe = cloneT2Json(selection) as unknown as typeof selection;
  const sheet = readT5Sheets(input).find(s => s.id === safe.sheetId);
  if (
    !sheet ||
    !safe.columns.length ||
    new Set(safe.columns).size !== safe.columns.length ||
    new Set(safe.rowIndices).size !== safe.rowIndices.length ||
    safe.columns.some(c => !Number.isSafeInteger(c) || c < 0 || c >= sheet.headers.length) ||
    safe.rowIndices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= sheet.rows.length)
  )
    throw new Error('数据库选定列或行无效');
  return {
    source: 'database',
    sourceId: safe.sourceId,
    label: sheet.name,
    tableIds: safe.tableIds,
    text: JSON.stringify({
      headers: safe.columns.map(c => sheet.headers[c]),
      rows: safe.rowIndices.map(i => safe.columns.map(c => sheet.rows[i][c])),
    }),
  };
}
export function adaptT7Mvu(
  input: unknown,
  sourceId: string,
  selections: { path: string[]; label: string; tableIds: string[] }[],
): T7Segment[] {
  const safe = cloneT2Json(input);
  const selected = cloneT2Json(selections) as unknown as typeof selections;
  return selected.map(selection => {
    let value: T2Json = safe;
    if (!selection.path.length || selection.path.some(p => !p || ['__proto__', 'constructor', 'prototype'].includes(p)))
      throw new Error('MVU 路径无效');
    for (const key of selection.path) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key))
        throw new Error('选定 MVU 路径不存在');
      value = value[key];
    }
    return {
      source: 'mvu',
      sourceId,
      label: selection.label,
      tableIds: selection.tableIds,
      text: JSON.stringify(value),
    };
  });
}
export function adaptT7Worldbook(
  entries: { name: string; content: string; enabled: boolean }[],
  sourceId: string,
  names: string[],
  tableIds: string[],
): T7Segment[] {
  const safe = cloneT2Json(entries) as unknown as typeof entries;
  const selectedNames = cloneT2Json(names) as string[];
  const selectedTables = cloneT2Json(tableIds) as string[];
  return safe
    .filter(e => e.enabled && selectedNames.includes(e.name) && !e.name.startsWith('WorldEvolution-'))
    .map(e => ({ source: 'worldbook', sourceId, label: e.name, text: e.content, tableIds: selectedTables }));
}
