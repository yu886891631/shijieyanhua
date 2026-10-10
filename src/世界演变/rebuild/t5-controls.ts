/** User-only metadata controls. Never SQL columns, never an arbitrary snapshot setter. */
import { z } from 'zod';
import { cloneT2Json, T2_ID_PATTERN, type T2Template, type T2WorldData } from './t2-template';
import { normalizeT2WorldData } from './t2-values';

export interface T5Control {
  tableId: string;
  rowId: string;
  kind: 'row-lock' | 'field-lock' | 'archive';
  fieldId: string | null;
  before: boolean;
  after: boolean;
}
const id = z.string().regex(T2_ID_PATTERN);
export const t5ControlsSchema = z
  .array(
    z.strictObject({
      tableId: id,
      rowId: id,
      kind: z.enum(['row-lock', 'field-lock', 'archive']),
      fieldId: id.nullable(),
      before: z.boolean(),
      after: z.boolean(),
    }),
  )
  .min(1)
  .max(100);

export function applyT5Controls<T extends { template: T2Template; data: T2WorldData }>(input: T, edits: unknown): T {
  const state = cloneT2Json(input) as unknown as T;
  const controls = t5ControlsSchema.parse(cloneT2Json(edits));
  const keys = new Set<string>();
  for (const edit of controls) {
    const key = `${edit.tableId}/${edit.rowId}/${edit.kind}/${edit.fieldId}`;
    if (keys.has(key) || edit.before === edit.after) throw new Error('CONTROL');
    keys.add(key);
    const table = state.template.tables.find(t => t.id === edit.tableId);
    const row = state.data.tables[edit.tableId]?.find(r => r.meta.id === edit.rowId);
    // Permissions are always evaluated against the unchanged input, not earlier unlocks in this list.
    const original = input.data.tables[edit.tableId]?.find(r => r.meta.id === edit.rowId);
    if (
      !table ||
      !row ||
      !original ||
      !table.visibility.user ||
      !row.meta.visibility.user ||
      table.locked ||
      !table.permissions.manual.update
    )
      throw new Error('CONTROL');
    if (edit.kind === 'field-lock') {
      const field = table.fields.find(f => f.id === edit.fieldId);
      if (
        !field ||
        !field.visibility.user ||
        field.hiddenUi ||
        field.readonly ||
        !field.permissions.manualWrite ||
        original.meta.locked
      )
        throw new Error('CONTROL');
      if (original.meta.lockedFieldIds.includes(field.id) !== edit.before) throw new Error('CONTROL');
      row.meta.lockedFieldIds = edit.after
        ? [...row.meta.lockedFieldIds, field.id].sort()
        : row.meta.lockedFieldIds.filter(f => f !== field.id);
    } else {
      if (edit.fieldId !== null) throw new Error('CONTROL');
      const property = edit.kind === 'row-lock' ? 'locked' : 'archived';
      if (original.meta[property] !== edit.before) throw new Error('CONTROL');
      if (
        edit.kind === 'archive' &&
        (!table.permissions.manual.archive || original.meta.locked || original.meta.lockedFieldIds.length)
      )
        throw new Error('CONTROL');
      row.meta[property] = edit.after;
    }
  }
  state.data = normalizeT2WorldData(state.template, state.data);
  return state;
}
