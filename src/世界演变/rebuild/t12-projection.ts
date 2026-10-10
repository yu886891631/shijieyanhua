/** T12 pure, immutable projection of a confirmed T4 archive. No host calls or AI. */
import { z } from 'zod';
import { cloneT2Json, T2_ID_PATTERN, type T2Cell, type T2Field, type T2Row, type T2Table } from './t2-template';
import {
  canonicalT4Json,
  fingerprintT4,
  normalizeT4Scope,
  validateT4Archive,
  type T4Archive,
  type T4Scope,
  type T4State,
} from './t4-protocol';
import { headT4Token, type T4HeadToken } from './t4-store';

export const T12_NS = 'world_evolution_sql_t12';
export const T12_MAX_ENTRIES = 1000;
export const T12_MAX_CHARS = 1_000_000;
export const copyT12 = <T>(v: T): T => cloneT2Json(v) as unknown as T;
export const sameT12 = (a: unknown, b: unknown) => canonicalT4Json(a) === canonicalT4Json(b);
export type T12Code =
  | 'SOURCE'
  | 'TARGET'
  | 'ISOLATION'
  | 'PERMISSION'
  | 'CONTENT'
  | 'STALE'
  | 'SIZE'
  | 'KEYS'
  | 'INTEGRITY'
  | 'CONFLICT'
  | 'READ'
  | 'WRITE'
  | 'PENDING'
  | 'CONFIRM'
  | 'CLOSED';
export class T12Error extends Error {
  constructor(readonly code: T12Code) {
    super(`世界书投影：${code}`);
    this.name = 'T12Error';
  }
}
export interface T12Binding {
  chatId: string;
  characterId: string;
  worldId: string;
  branchId: string;
  primaryBook: string | null;
}
const id = z
  .string()
  .regex(T2_ID_PATTERN)
  .refine(v => !['constructor', 'prototype'].includes(v));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(512);
const bindingSchema = z.strictObject({
  chatId: id,
  characterId: text,
  worldId: id,
  branchId: id,
  primaryBook: text.nullable(),
});
export function normalizeT12Binding(v: unknown): T12Binding {
  try {
    return bindingSchema.parse(cloneT2Json(v));
  } catch {
    throw new T12Error('TARGET');
  }
}
/** Only the character card's primary. No additional/global/chat book fallback or rebind. */
export function resolveT12Primary(read: () => { primary: string | null; additional: string[] }): string | null {
  try {
    const name = read().primary;
    return typeof name === 'string' && name.trim() && name.length <= 512 ? name : null;
  } catch {
    return null;
  }
}
export interface T12Payload {
  name: string;
  content: string;
  strategy: {
    type: 'constant' | 'selective';
    keys: string[];
    keys_secondary: { logic: 'and_any'; keys: string[] };
    scan_depth: 'same_as_global';
  };
  position: { type: 'at_depth'; role: 'system'; depth: 2; order: 9800 };
  probability: 100;
  recursion: { prevent_incoming: true; prevent_outgoing: true; delay_until: null };
  effect: { sticky: null; cooldown: null; delay: null };
}
export interface T12Projection {
  key: string;
  tableId: string;
  rowId: string | null;
  payload: T12Payload;
  fingerprint: string;
}
export interface T12Generation {
  format: 'world-evolution-sql-projection';
  version: 1;
  binding: T12Binding;
  scope: T4Scope;
  head: T4HeadToken;
  entries: T12Projection[];
  fingerprint: string;
}
/** Public preview is generated separately: main-AI permissions do not grant user permissions. */
export interface T12PublicEntry {
  key: string;
  name: string;
  content: string;
  keys: string[];
  constant: boolean;
  table: string;
}
export interface T12Built {
  generation: T12Generation;
  preview: T12PublicEntry[];
  tables: { name: string; enabled: boolean; mode: string; fields: string[] }[];
}
export const keyT12 = (scope: T4Scope, tableId: string, rowId: string | null) =>
  JSON.stringify([scope.chatId, scope.worldId, scope.branchId, tableId, rowId]);
const allowed = (v: { mainAi: boolean; user: boolean }, audience: 'main' | 'user') =>
  v.mainAi && (audience === 'main' || v.user);

function render(state: T4State, scope: T4Scope, audience: 'main' | 'user'): Omit<T12Projection, 'fingerprint'>[] {
  const output: Omit<T12Projection, 'fingerprint'>[] = [];
  const fieldAllowed = (f: T2Field) => allowed(f.visibility, audience) && (audience === 'main' || !f.hiddenUi);
  const rowAllowed = (t: T2Table, r: T2Row) => allowed(t.visibility, audience) && allowed(r.meta.visibility, audience);
  const valueText = (field: T2Field, value: T2Cell, visited = new Set<string>()): string | null => {
    if (value === null) return '未指定';
    if (field.type === 'reference' || field.type === 'reference-list') {
      const refs = Array.isArray(value) ? value : [value];
      const names: string[] = [];
      for (const ref of refs) {
        if (typeof ref !== 'object' || ref === null || !('tableId' in ref) || !('rowId' in ref)) continue;
        const target = state.template.tables.find(t => t.id === ref.tableId);
        const row = state.data.tables[ref.tableId]?.find(r => r.meta.id === ref.rowId);
        if (!target || !row || !rowAllowed(target, row)) continue;
        const title = target.fields.find(f => f.id === target.export.titleFieldId);
        if (!title || !fieldAllowed(title) || !Object.hasOwn(row.values, title.id)) continue;
        const address = `${target.id}/${row.meta.id}/${title.id}`;
        if (visited.has(address) || visited.size >= 8) continue;
        const label = valueText(title, row.values[title.id], new Set([...visited, address]));
        if (label) names.push(label);
      }
      // No hidden IDs, counts, table labels or placeholder names for suppressed targets.
      return names.length ? names.join('、') : null;
    }
    if (field.type === 'world-time' && typeof value === 'object' && !Array.isArray(value))
      return 'display' in value ? value.display : null;
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (Array.isArray(value)) return value.length ? value.join('、') : '无';
    return String(value);
  };
  const cell = (table: T2Table, row: T2Row, fieldId: string) => {
    const f = table.fields.find(f => f.id === fieldId);
    return f && fieldAllowed(f) && Object.hasOwn(row.values, fieldId) ? valueText(f, row.values[fieldId]) : null;
  };
  for (const table of state.template.tables) {
    if (!table.export.enabled || !allowed(table.visibility, audience)) continue;
    const fields = table.fields.filter(f => table.export.fieldIds.includes(f.id) && fieldAllowed(f));
    const rows = state.data.tables[table.id]
      .filter(r => rowAllowed(table, r) && (!r.meta.archived || table.export.includeArchived))
      .sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
    const records = rows
      .map(row => {
        const label = (table.export.titleFieldId && cell(table, row, table.export.titleFieldId)) || '资料';
        const lines = fields.flatMap(f => {
          const v = cell(table, row, f.id);
          return v === null ? [] : [`${f.name}：${v}`];
        });
        const keys = [
          ...new Set(
            table.export.keyFieldIds.flatMap(fid => {
              const f = table.fields.find(f => f.id === fid);
              if (!f || !fieldAllowed(f) || !Object.hasOwn(row.values, fid) || row.values[fid] === null) return [];
              if (f.type === 'string-list') return (row.values[fid] as string[]).filter(v => v.trim());
              const v = cell(table, row, fid);
              return v?.trim() ? [v] : [];
            }),
          ),
        ];
        return { row, label, lines, keys };
      })
      .filter(r => r.lines.length);
    const add = (rowId: string | null, name: string, content: string, keys: string[], constant: boolean) => {
      if (audience === 'main' && !constant && !keys.length) throw new T12Error('KEYS');
      // Do not let host template/macro plugins execute data as code at prompt expansion time.
      if (audience === 'main' && [name, content, ...keys].some(v => /<%|\{\{/.test(v))) throw new T12Error('CONTENT');
      if (
        audience === 'main' &&
        (content.length > table.export.maxChars ||
          name.length > 512 ||
          keys.length > 256 ||
          keys.some(k => k.length > 512))
      )
        throw new T12Error('SIZE');
      output.push({
        key: keyT12(scope, table.id, rowId),
        tableId: table.id,
        rowId,
        payload: {
          name,
          content,
          strategy: {
            type: constant ? 'constant' : 'selective',
            keys: constant ? [] : keys,
            keys_secondary: { logic: 'and_any', keys: [] },
            scan_depth: 'same_as_global',
          },
          position: { type: 'at_depth', role: 'system', depth: 2, order: 9800 },
          probability: 100,
          recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
          effect: { sticky: null, cooldown: null, delay: null },
        },
      });
    };
    if (table.export.mode === 'per-row') {
      for (const r of records)
        add(
          r.row.meta.id,
          `WorldEvolution-${table.name}-${r.label}`,
          `${table.name}\n${r.lines.join('\n')}`,
          r.keys,
          false,
        );
    } else if (records.length) {
      // index = constant title catalogue; constant = constant whole-table body. Same privacy policy.
      const content =
        table.export.mode === 'index'
          ? records.map(r => `- ${r.label}`).join('\n')
          : records.map(r => `${r.label}\n${r.lines.join('\n')}`).join('\n\n');
      add(
        null,
        `WorldEvolution-${table.name}-${table.export.mode === 'index' ? '索引' : '常驻'}`,
        `${table.name}\n${content}`,
        [],
        true,
      );
    }
  }
  return output;
}

export async function buildT12Projection(archiveInput: T4Archive, bindingInput: T12Binding): Promise<T12Built> {
  const binding = normalizeT12Binding(bindingInput);
  let archive: T4Archive;
  try {
    archive = await validateT4Archive(archiveInput);
  } catch {
    throw new T12Error('SOURCE');
  }
  const scope = archive.scope;
  if (
    !binding.primaryBook ||
    binding.chatId !== scope.chatId ||
    binding.worldId !== scope.worldId ||
    binding.branchId !== scope.branchId
  )
    throw new T12Error('TARGET');
  const state = archive.commits.at(-1)?.snapshot.state ?? archive.genesis;
  const entries: T12Projection[] = [];
  let chars = 2;
  for (const e of render(state, scope, 'main')) {
    const sealed = { ...e, fingerprint: await fingerprintT4(e.payload) };
    chars += JSON.stringify(sealed).length + (entries.length ? 1 : 0);
    if (entries.length >= T12_MAX_ENTRIES || chars > T12_MAX_CHARS) throw new T12Error('SIZE');
    entries.push(sealed);
  }
  const base = {
    format: 'world-evolution-sql-projection' as const,
    version: 1 as const,
    binding,
    scope,
    head: headT4Token(archive),
    entries,
  };
  const generation = { ...base, fingerprint: await fingerprintT4(base) };
  return {
    generation,
    preview: render(state, scope, 'user').map(e => ({
      key: e.key,
      name: e.payload.name,
      content: e.payload.content,
      keys: e.payload.strategy.keys,
      constant: e.payload.strategy.type === 'constant',
      table: state.template.tables.find(t => t.id === e.tableId)!.name,
    })),
    tables: state.template.tables
      .filter(t => t.visibility.user)
      .map(t => ({
        name: t.name,
        enabled: t.export.enabled && t.visibility.mainAi,
        mode: t.export.mode,
        fields: t.fields
          .filter(f => t.export.fieldIds.includes(f.id) && f.visibility.mainAi && f.visibility.user && !f.hiddenUi)
          .map(f => f.name),
      })),
  };
}

const headSchema = z.strictObject({
  commitId: id.nullable(),
  seq: z.number().int().min(0),
  revision: z.number().int().min(0),
  stateFingerprint: hash,
});
const payloadSchema = z.strictObject({
  name: text.refine(v => v.startsWith('WorldEvolution-')),
  content: z.string().min(1).max(T12_MAX_CHARS),
  strategy: z.strictObject({
    type: z.enum(['constant', 'selective']),
    keys: z.array(text).max(256),
    keys_secondary: z.strictObject({ logic: z.literal('and_any'), keys: z.array(text).max(0) }),
    scan_depth: z.literal('same_as_global'),
  }),
  position: z.strictObject({
    type: z.literal('at_depth'),
    role: z.literal('system'),
    depth: z.literal(2),
    order: z.literal(9800),
  }),
  probability: z.literal(100),
  recursion: z.strictObject({
    prevent_incoming: z.literal(true),
    prevent_outgoing: z.literal(true),
    delay_until: z.null(),
  }),
  effect: z.strictObject({ sticky: z.null(), cooldown: z.null(), delay: z.null() }),
});
export async function validateT12Generation(input: unknown): Promise<T12Generation> {
  try {
    const g = z
      .strictObject({
        format: z.literal('world-evolution-sql-projection'),
        version: z.literal(1),
        binding: bindingSchema,
        scope: z.unknown(),
        head: headSchema,
        entries: z
          .array(
            z.strictObject({
              key: z.string().min(1).max(512),
              tableId: id,
              rowId: id.nullable(),
              payload: payloadSchema,
              fingerprint: hash,
            }),
          )
          .max(T12_MAX_ENTRIES),
        fingerprint: hash,
      })
      .parse(cloneT2Json(input));
    const scope = normalizeT4Scope(g.scope),
      result = { ...g, scope };
    if (
      !g.binding.primaryBook ||
      g.binding.chatId !== scope.chatId ||
      g.binding.worldId !== scope.worldId ||
      g.binding.branchId !== scope.branchId ||
      new Set(g.entries.map(e => e.key)).size !== g.entries.length
    )
      throw new T12Error('INTEGRITY');
    for (const e of g.entries) {
      if (
        e.key !== keyT12(scope, e.tableId, e.rowId) ||
        e.fingerprint !== (await fingerprintT4(e.payload)) ||
        (e.payload.strategy.type === 'selective' && !e.payload.strategy.keys.length)
      )
        throw new T12Error('INTEGRITY');
    }
    const { fingerprint, ...base } = result;
    if (canonicalT4Json(g.entries).length > T12_MAX_CHARS || fingerprint !== (await fingerprintT4(base)))
      throw new T12Error('INTEGRITY');
    return result;
  } catch {
    throw new T12Error('INTEGRITY');
  }
}
