/** T3 只读展示模型：只生成用户可见文本，不执行SQL或保留私密诊断载荷。 */
import { z } from 'zod';
import { createDefaultT2Template } from './t2-defaults';
import {
  cloneT2Json,
  normalizeT2Template,
  T2_ID_PATTERN,
  type T2Cell,
  type T2Field,
  type T2Reference,
  type T2Row,
  type T2Table,
} from './t2-template';
import { normalizeT2WorldData, validateT2Cell } from './t2-values';

export interface T3PreviewInput {
  template?: unknown;
  result?: unknown;
  baseData?: unknown;
  error?: unknown;
  limits?: unknown;
}
export interface T3PreviewTable {
  id: string;
  name: string;
  groupId: 'macro' | 'micro';
  fields: { id: string; name: string }[];
  rows: { id: string; cells: { fieldId: string; text: string }[] }[];
}
export interface T3PreviewModel {
  status: 'empty' | 'success' | 'error' | 'invalid';
  templateName: string;
  tables: T3PreviewTable[];
  queries: { index: number; tableName: string; fields: string[]; rows: { id: string; cells: string[] }[] }[];
  statements: { index: number; operation: string; tableName: string; fields: string[]; rowCount: number }[];
  summary: { changedRows: number; newRows: number; queryRows: number; statements: number };
  limits: { label: string; value: number }[];
  error: { label: string; statement: number | null; field: string | null } | null;
}

const ID = z
  .string()
  .regex(T2_ID_PATTERN)
  .refine(value => !['constructor', 'prototype'].includes(value));
const index = z.number().int().min(0).max(31);
const rowIdentity = z.object({ tableId: ID, rowId: ID });
const resultSchema = z.object({
  mode: z.literal('isolated-sqlite'),
  data: z.unknown(),
  queries: z
    .array(
      z.object({
        statementIndex: index,
        tableId: ID,
        fieldIds: z.array(ID).max(256),
        rows: z.array(z.object({ rowId: ID, values: z.record(ID, z.unknown()) })).max(100),
      }),
    )
    .max(32),
  statements: z
    .array(
      z.object({
        statementIndex: index,
        operation: z.enum(['select', 'insert', 'update', 'delete']),
        tableId: ID,
        rowIds: z.array(ID).max(10_000),
        fieldIds: z.array(ID).max(256),
      }),
    )
    .max(32),
  allocations: z.array(rowIdentity.extend({ statementIndex: index })).max(32),
  changedRows: z.array(rowIdentity).max(10_000),
});
const limitsSchema = z
  .object({
    maxStatements: z.number().int().min(1).max(32).optional(),
    maxAffectedRows: z.number().int().min(0).max(10_000).optional(),
    maxNewRows: z.number().int().min(0).max(1_000).optional(),
    maxQueryRows: z.number().int().min(0).max(100).optional(),
    maxResultChars: z.number().int().min(1).max(1_000_000).optional(),
  })
  .strict();
const errorSchema = z.object({
  code: z.enum([
    'INPUT',
    'SQL',
    'AUTHORIZATION',
    'LIMIT',
    'DATA',
    'CONSTRAINT',
    'ABORTED',
    'TIMEOUT',
    'WORKER_START',
    'WORKER_ERROR',
    'WORKER_EXECUTION',
    'PROTOCOL',
  ]),
  statementIndex: index.optional(),
  tableId: ID.optional(),
  fieldId: ID.optional(),
});
const errorLabels = {
  INPUT: '输入未通过校验',
  SQL: 'SQL不在支持范围内',
  AUTHORIZATION: '读取或修改权限不足',
  LIMIT: '超过预览批次预算',
  DATA: '字段或引用未通过校验',
  CONSTRAINT: 'SQLite约束拒绝此批次',
  ABORTED: 'SQL工作已取消，未接受结果',
  TIMEOUT: 'SQL工作超时，执行线程已终止',
  WORKER_START: 'SQLite执行线程无法启动',
  WORKER_ERROR: 'SQLite执行失败，未接受结果',
  WORKER_EXECUTION: 'SQLite内核无法初始化或执行',
  PROTOCOL: '执行线程返回数据未通过校验',
};
const operationLabels = { select: '查询', insert: '新增', update: '修改', delete: '删除' };

function displayCell(
  field: T2Field,
  value: T2Cell | undefined,
  publicReference: (reference: T2Reference) => boolean,
): string {
  if (value === undefined) return '未填写';
  if (value === null) return 'NULL（明确空值）';
  if (value === true) return '是';
  if (value === false) return '否';
  if (value === '') return '空字符串';
  if (field.type === 'reference') return publicReference(value as T2Reference) ? JSON.stringify(value) : '未公开';
  if (field.type === 'reference-list') return JSON.stringify((value as T2Reference[]).filter(publicReference));
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** 输出不包含原始SQL、bindings、log、message、不可见身份、字段名或计数。 */
export function createT3PreviewModel(input: T3PreviewInput = {}): T3PreviewModel {
  const empty: T3PreviewModel = {
    status: 'empty',
    templateName: '',
    tables: [],
    queries: [],
    statements: [],
    summary: { changedRows: 0, newRows: 0, queryRows: 0, statements: 0 },
    limits: [],
    error: null,
  };
  try {
    const supplied = cloneT2Json(input) as unknown as T3PreviewInput;
    const template = normalizeT2Template(
      supplied.template === undefined ? createDefaultT2Template() : supplied.template,
    );
    const result = supplied.result === undefined ? null : resultSchema.parse(supplied.result);
    const data = result ? normalizeT2WorldData(template, result.data) : null;
    const base = supplied.baseData === undefined ? null : normalizeT2WorldData(template, supplied.baseData);
    if (
      data &&
      base &&
      (data.worldId !== base.worldId || data.branchId !== base.branchId || data.revision !== base.revision)
    )
      throw new Error('预览基线与结果身份不一致。');
    const rowsFor = (tableId: string) => data?.tables[tableId] ?? base?.tables[tableId] ?? [];
    const visibleFields = (table: T2Table) => table.fields.filter(field => field.visibility.user && !field.hiddenUi);
    const visibleTables = template.tables.filter(table => table.visibility.user && visibleFields(table).length > 0);
    const tableFor = (tableId: string) => visibleTables.find(table => table.id === tableId);
    const rowFor = (tableId: string, rowId: string): T2Row | undefined =>
      data?.tables[tableId]?.find(row => row.meta.id === rowId) ??
      base?.tables[tableId]?.find(row => row.meta.id === rowId);
    const visibleRow = (tableId: string, rowId: string) =>
      !!tableFor(tableId) && rowFor(tableId, rowId)?.meta.visibility.user === true;
    const publicReference = (reference: T2Reference) => visibleRow(reference.tableId, reference.rowId);
    const model: T3PreviewModel = {
      ...empty,
      templateName: template.name,
      status: result ? 'success' : 'empty',
      tables: visibleTables.map(table => ({
        id: table.id,
        name: table.name,
        groupId: table.groupId,
        fields: visibleFields(table).map(field => ({ id: field.id, name: field.name })),
        rows: rowsFor(table.id)
          .filter(row => row.meta.visibility.user)
          .map(row => ({
            id: row.meta.id,
            cells: visibleFields(table).map(field => ({
              fieldId: field.id,
              text: displayCell(field, row.values[field.id], publicReference),
            })),
          })),
      })),
    };
    if (result) {
      for (const query of result.queries) {
        const table = tableFor(query.tableId);
        if (!table) continue;
        const fields = visibleFields(table).filter(field => query.fieldIds.includes(field.id));
        if (!fields.length) continue;
        const rows = query.rows
          .filter(row => visibleRow(table.id, row.rowId))
          .map(row => ({
            id: row.rowId,
            cells: fields.map(field =>
              displayCell(
                field,
                Object.hasOwn(row.values, field.id) ? validateT2Cell(field, row.values[field.id], template) : undefined,
                publicReference,
              ),
            ),
          }));
        if (rows.length)
          model.queries.push({
            index: model.queries.length + 1,
            tableName: table.name,
            fields: fields.map(field => field.name),
            rows,
          });
      }
      const publicWrites = new Set<string>();
      for (const statement of result.statements) {
        const table = tableFor(statement.tableId);
        if (!table) continue;
        const fields = visibleFields(table).filter(field => statement.fieldIds.includes(field.id));
        if (!fields.length && statement.operation !== 'delete') continue;
        const visibleRows = statement.rowIds.filter(rowId => visibleRow(table.id, rowId));
        if (!visibleRows.length) continue;
        if (statement.operation !== 'select')
          for (const rowId of visibleRows) publicWrites.add(JSON.stringify([table.id, rowId]));
        model.statements.push({
          index: model.statements.length + 1,
          operation: operationLabels[statement.operation],
          tableName: table.name,
          fields: fields.map(field => field.name),
          rowCount: visibleRows.length,
        });
      }
      const uniqueVisible = (rows: { tableId: string; rowId: string }[]) =>
        new Set(
          rows
            .filter(
              row => visibleRow(row.tableId, row.rowId) && publicWrites.has(JSON.stringify([row.tableId, row.rowId])),
            )
            .map(row => JSON.stringify([row.tableId, row.rowId])),
        ).size;
      model.summary = {
        changedRows: uniqueVisible(result.changedRows),
        newRows: uniqueVisible(result.allocations),
        queryRows: model.queries.reduce((total, query) => total + query.rows.length, 0),
        statements: model.statements.length,
      };
    }
    const limits = {
      maxStatements: 32,
      maxAffectedRows: 50,
      maxNewRows: 10,
      maxQueryRows: 100,
      maxResultChars: 256_000,
      ...limitsSchema.parse(supplied.limits ?? {}),
    };
    limits.maxAffectedRows = Math.min(limits.maxAffectedRows, template.hardLimits.maxRows);
    limits.maxNewRows = Math.min(limits.maxNewRows, template.hardLimits.maxNewRows, limits.maxAffectedRows);
    model.limits = [
      ['最多语句', limits.maxStatements],
      ['最多修改记录', limits.maxAffectedRows],
      ['最多新增记录', limits.maxNewRows],
      ['单次最多查询行', limits.maxQueryRows],
      ['累计查询文本上限', limits.maxResultChars],
    ].map(([label, value]) => ({ label: String(label), value: Number(value) }));
    if (supplied.error !== undefined) {
      const error = errorSchema.parse(supplied.error);
      const table = error.tableId === undefined ? undefined : tableFor(error.tableId);
      const field = table?.fields.find(item => item.id === error.fieldId && item.visibility.user && !item.hiddenUi);
      const canLocate = !!table && (error.fieldId === undefined || !!field);
      model.error = {
        label: errorLabels[error.code],
        statement: canLocate && error.statementIndex !== undefined ? error.statementIndex + 1 : null,
        field: canLocate && field ? `${table.name} / ${field.name}` : null,
      };
      model.status = 'error';
    }
    return model;
  } catch {
    return {
      ...empty,
      status: 'invalid',
      error: { label: '预览输入未通过校验；没有采用损坏数据', statement: null, field: null },
    };
  }
}
