/** Read-only SPDB fixture mapping. No guessing unknown formats, no source writes. */
import { cloneT2Json, type T2Cell } from './t2-template';
import { validateT2Cell, prepareT2NewRow } from './t2-values';
import { allocateT3RowId } from './t3-engine';
import { fingerprintT4, type T4State } from './t4-protocol';
import type { T5Action } from './t5-form';

export interface T5ImportSheet {
  id: string;
  name: string;
  headers: string[];
  rows: unknown[][];
}
export interface T5ImportPlan {
  sourceId: string;
  sheetId: string;
  tableId: string;
  mapping: { column: number; fieldId: string }[];
}
export interface T5ImportRow {
  index: number;
  batchId: string;
  rowId: string;
  values: Record<string, T2Cell>;
  allowed: boolean;
  issues: string[];
}
export interface T5ImportPreview {
  plan: T5ImportPlan;
  rows: T5ImportRow[];
  total: number;
}

export function readT5Sheets(input: unknown): T5ImportSheet[] {
  const safe = cloneT2Json(input);
  if (!safe || typeof safe !== 'object' || Array.isArray(safe)) throw new Error('不支持的导入格式');
  const sheets: T5ImportSheet[] = [];
  for (const [id, value] of Object.entries(safe)) {
    if (!id.startsWith('sheet_')) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('表结构不完整');
    const content = value.content;
    if (
      !Array.isArray(content) ||
      !Array.isArray(content[0]) ||
      content.length > 5001 ||
      !content[0].length ||
      content[0].some(h => typeof h !== 'string') ||
      content[0].length > 256
    )
      throw new Error('表头或二维数据不完整');
    const headers = content[0] as string[];
    if (content.slice(1).some(row => !Array.isArray(row) || row.length !== headers.length))
      throw new Error('行与表头列数不一致');
    sheets.push({
      id,
      name: typeof value.name === 'string' ? value.name : id,
      headers,
      rows: content.slice(1) as unknown[][],
    });
  }
  if (!sheets.length) throw new Error('未找到 sheet_*.content 表；请手动建立或提供受支持导出');
  return sheets;
}
export async function previewT5Import(
  state: T4State,
  sheetInput: T5ImportSheet,
  planInput: T5ImportPlan,
): Promise<T5ImportPreview> {
  const sheet = cloneT2Json(sheetInput) as unknown as T5ImportSheet;
  const plan = cloneT2Json(planInput) as unknown as T5ImportPlan;
  const table = state.template.tables.find(t => t.id === plan.tableId);
  if (
    !/^[a-z][a-z0-9_-]{0,63}$/.test(plan.sourceId) ||
    sheet.id !== plan.sheetId ||
    !table?.visibility.user ||
    table.locked ||
    !table.permissions.manual.insert ||
    !plan.mapping.length ||
    new Set(plan.mapping.map(m => m.fieldId)).size !== plan.mapping.length
  )
    throw new Error('来源身份、目标表或映射不合法');
  const rows: T5ImportRow[] = [];
  for (const [index, row] of sheet.rows.entries()) {
    // Stable source/table/ordinal identity is independent of name, selected subset and revision.
    const digest = await fingerprintT4({ sourceId: plan.sourceId, sheetId: plan.sheetId, index });
    const batchId = `im-${digest.slice(0, 24)}`,
      rowId = allocateT3RowId(batchId, 0);
    const values: Record<string, T2Cell> = {},
      issues: string[] = [];
    if (Object.values(state.data.tables).some(rs => rs.some(r => r.meta.id === rowId)))
      issues.push('此来源行已导入，禁止重复或自动覆盖');
    for (const mapping of plan.mapping) {
      const field = table.fields.find(f => f.id === mapping.fieldId);
      if (
        !Number.isSafeInteger(mapping.column) ||
        mapping.column < 0 ||
        mapping.column >= sheet.headers.length ||
        !field ||
        field.hiddenUi ||
        !field.visibility.user ||
        field.readonly ||
        !field.permissions.manualWrite
      ) {
        issues.push('映射包含不可写字段或不存在的列');
        continue;
      }
      try {
        values[field.id] = validateT2Cell(field, row[mapping.column], state.template);
      } catch {
        issues.push(`${field.name}：类型或范围不符合要求（不自动猜测转换）`);
      }
    }
    try {
      prepareT2NewRow(state.template, table.id, rowId, values, { revision: state.data.revision });
    } catch {
      issues.push('必填项或默认值不完整');
    }
    rows.push({ index, batchId, rowId, values, allowed: !issues.length, issues });
  }
  return { plan, rows, total: rows.length };
}
export function selectT5Import(preview: T5ImportPreview, indices: number[]): T5Action[] {
  if (!indices.length || indices.length > 10 || new Set(indices).size !== indices.length)
    throw new Error('每次明确选择 1–10 行；其余分批处理');
  return indices.map(index => {
    const row = preview.rows.find(r => r.index === index);
    if (!row?.allowed) throw new Error('来源行不可导入');
    return { kind: 'insert', tableId: preview.plan.tableId, values: row.values, importBatchId: row.batchId };
  });
}
