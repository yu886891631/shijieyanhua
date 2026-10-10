/** Typed form codec and bound SQL compiler; user values are never SQL text. */
import { cloneT2Json, type T2Cell, type T2Field, type T2Json, type T2Reference } from './t2-template';
import { validateT2Cell } from './t2-values';
import { quoteT3Identifier } from './t3-schema';
import type { T4State } from './t4-protocol';

export interface T5Input {
  mode: 'keep' | 'value' | 'null';
  text: string;
  checked: boolean;
  references: T2Reference[];
  minute: string;
  display: string;
}
export function inputT5Cell(field: T2Field, value?: T2Cell): T5Input {
  const result: T5Input = { mode: 'keep', text: '', checked: false, references: [], minute: '', display: '' };
  if (value === undefined || value === null) return result;
  if (field.type === 'reference') result.references = [value as T2Reference];
  else if (field.type === 'reference-list') result.references = cloneT2Json(value) as unknown as T2Reference[];
  else if (field.type === 'world-time') {
    const time = value as { ordinalMinute: number; display: string };
    result.minute = String(time.ordinalMinute);
    result.display = time.display;
  } else if (field.type === 'boolean') result.checked = value as boolean;
  else result.text = Array.isArray(value) ? value.join('\n') : String(value);
  return result;
}
export function parseT5Input(field: T2Field, input: T5Input, state: T4State): T2Cell | undefined {
  if (input.mode === 'keep') return undefined;
  if (input.mode === 'null') return validateT2Cell(field, null, state.template);
  let value: unknown = input.text;
  if (field.type === 'number' || field.type === 'integer') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.text.trim())) throw new Error('NUMBER');
    value = Number(input.text);
  } else if (field.type === 'boolean') value = input.checked;
  else if (field.type === 'string-list') value = input.text === '' ? [] : input.text.split('\n');
  else if (field.type === 'reference' || field.type === 'reference-list') {
    if (field.type === 'reference' && input.references.length !== 1) throw new Error('REFERENCE');
    value = field.type === 'reference' ? input.references[0] : input.references;
    for (const ref of input.references) {
      const target = state.template.tables.find(t => t.id === ref.tableId);
      const row = state.data.tables[ref.tableId]?.find(r => r.meta.id === ref.rowId);
      if (!target?.visibility.user || !row?.meta.visibility.user || row.meta.archived) throw new Error('REFERENCE');
    }
  } else if (field.type === 'world-time') {
    if (!/^\d+$/.test(input.minute)) throw new Error('TIME');
    value = { calendarId: field.constraints.calendarId, ordinalMinute: Number(input.minute), display: input.display };
  }
  return validateT2Cell(field, value, state.template);
}
export type T5Action =
  | { kind: 'insert'; tableId: string; values: Record<string, T2Cell>; importBatchId?: string }
  | { kind: 'update'; tableId: string; rowId: string; values: Record<string, T2Cell> }
  | { kind: 'delete'; tableId: string; rowId: string };

export function compileT5Action(state: T4State, action: T5Action): { sql: string; parameters: T2Json[] } {
  const table = state.template.tables.find(t => t.id === action.tableId);
  if (!table) throw new Error('TABLE');
  const name = quoteT3Identifier(table.sqlName);
  if (action.kind === 'delete')
    return { sql: `DELETE FROM ${name} WHERE "__we_row_id" = ?;`, parameters: [action.rowId] };
  const entries = Object.entries(action.values);
  if (!entries.length) throw new Error('EMPTY');
  const columns = entries.map(([id]) => {
    const field = table.fields.find(f => f.id === id);
    if (!field) throw new Error('FIELD');
    return quoteT3Identifier(field.sqlName);
  });
  const parameters = cloneT2Json(entries.map(([, value]) => value)) as T2Json[];
  return action.kind === 'insert'
    ? { sql: `INSERT INTO ${name} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')});`, parameters }
    : {
        sql: `UPDATE ${name} SET ${columns.map(c => `${c} = ?`).join(',')} WHERE "__we_row_id" = ?;`,
        parameters: [...parameters, action.rowId],
      };
}
