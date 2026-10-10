/** T3 worker-side SQLite execution; the result is a private draft, never a chat commit. */
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { z } from 'zod';
import {
  cloneT2Json,
  normalizeT2Template,
  resolveT2TableSettings,
  type T2Cell,
  type T2Field,
  type T2Json,
  type T2Row,
  type T2Table,
  type T2Template,
  type T2WorldData,
} from './t2-template';
import {
  canReadT2Field,
  decodeT2Cell,
  encodeT2Cell,
  evaluateT2Write,
  normalizeT2WorldData,
  prepareT2NewRow,
  validateT2Cell,
} from './t2-values';
import { assertT3SqlValue, createT3Database, exportT3World, insertT3Row, quoteT3Identifier } from './t3-schema';
import { countT3Parameters, parseT3Sql, type T3Statement, type T3Value } from './t3-sql';

export interface T3Grant {
  tableId: string;
  rowIds: string[];
  fieldIds: string[];
}
/** Caller-owned frozen authority; not part of the model's SQL response. */
export interface T3Policy {
  actor: 'manual' | 'ai';
  stage: 'macro' | 'micro' | null;
  read: T3Grant[];
  write: T3Grant[];
  insertTableIds: string[];
}
export interface T3Limits {
  maxStatements: number;
  maxAffectedRows: number;
  maxNewRows: number;
  maxQueryRows: number;
  maxResultChars: number;
}
export interface T3Request {
  template: T2Template;
  data: T2WorldData;
  sql: string;
  parameters: T2Json[];
  batchId: string;
  policy: T3Policy;
  limits?: Partial<T3Limits>;
}
export interface T3QueryResult {
  statementIndex: number;
  tableId: string;
  fieldIds: string[];
  rows: { rowId: string; values: Record<string, T2Cell> }[];
}
export interface T3Allocation {
  statementIndex: number;
  tableId: string;
  rowId: string;
}
export interface T3ExecutedStatement {
  statementIndex: number;
  operation: T3Statement['kind'];
  tableId: string;
  rowIds: string[];
  fieldIds: string[];
  sql: string;
  bindings: (null | number | string)[];
  affectedRows: number;
}
export interface T3Log {
  format: 'world-evolution-sql-log';
  version: 1;
  templateId: string;
  templateVersion: number;
  batchId: string;
  sql: string;
  parameters: T2Json[];
}
export interface T3Result {
  mode: 'isolated-sqlite';
  data: T2WorldData;
  queries: T3QueryResult[];
  allocations: T3Allocation[];
  statements: T3ExecutedStatement[];
  log: T3Log;
  changedRows: { tableId: string; rowId: string }[];
}
export type T3EngineErrorCode = 'INPUT' | 'SQL' | 'AUTHORIZATION' | 'LIMIT' | 'DATA' | 'CONSTRAINT';
export class T3EngineError extends Error {
  constructor(
    readonly code: T3EngineErrorCode,
    message: string,
    readonly statementIndex?: number,
    readonly fieldId?: string,
    readonly tableId?: string,
  ) {
    super(message);
    this.name = 'T3EngineError';
  }
}

const ID = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/)
  .refine(value => value !== 'constructor' && value !== 'prototype');
const grantSchema = z.strictObject({ tableId: ID, rowIds: z.array(ID).max(5000), fieldIds: z.array(ID).max(256) });
const policySchema = z.strictObject({
  actor: z.enum(['manual', 'ai']),
  stage: z.enum(['macro', 'micro']).nullable(),
  read: z.array(grantSchema).max(256),
  write: z.array(grantSchema).max(256),
  insertTableIds: z.array(ID).max(256),
});
const integer = z.number().int().min(0);
const limitsSchema = z.strictObject({
  maxStatements: integer.min(1).max(32).optional(),
  maxAffectedRows: integer.max(10000).optional(),
  maxNewRows: integer.max(1000).optional(),
  maxQueryRows: integer.max(100).optional(),
  maxResultChars: integer.min(1).max(1000000).optional(),
});
const requestSchema = z.strictObject({
  template: z.unknown(),
  data: z.unknown(),
  sql: z.string().min(1).max(20000),
  parameters: z.array(z.unknown()).max(8192),
  batchId: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/)
    .refine(value => value !== 'constructor' && value !== 'prototype'),
  policy: policySchema,
  limits: limitsSchema.optional(),
});
const DEFAULT_LIMITS: T3Limits = {
  maxStatements: 32,
  maxAffectedRows: 50,
  maxNewRows: 10,
  maxQueryRows: 100,
  maxResultChars: 256000,
};

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new T3EngineError('INPUT', `${path} 包含重复身份。`);
}
function tableById(template: T2Template, id: string): T2Table {
  const table = template.tables.find(item => item.id === id);
  if (!table) throw new T3EngineError('AUTHORIZATION', `未声明的表 ${id}。`);
  return table;
}
function fieldBySql(table: T2Table, sqlName: string): T2Field {
  const field = table.fields.find(item => item.sqlName === sqlName);
  if (!field) throw new T3EngineError('AUTHORIZATION', `表 ${table.id} 的列 ${sqlName} 未声明或属于系统字段。`);
  return field;
}

function normalizeRequest(input: T3Request): T3Request & { limits: T3Limits } {
  const request = requestSchema.parse(cloneT2Json(input));
  const template = normalizeT2Template(request.template);
  const data = normalizeT2WorldData(template, request.data);
  if (request.policy.actor === 'ai' && request.policy.stage === null)
    throw new T3EngineError('INPUT', 'AI 请求必须固定宏观或微观阶段。');
  if (request.policy.actor === 'manual' && request.policy.stage !== null)
    throw new T3EngineError('INPUT', '人工隔离编辑不冒充 AI 阶段。');
  for (const direction of ['read', 'write'] as const) {
    unique(
      request.policy[direction].map(grant => grant.tableId),
      `${direction} 表授权`,
    );
    for (const grant of request.policy[direction]) {
      const table = tableById(template, grant.tableId);
      unique(grant.rowIds, `${direction}.${table.id}.rowIds`);
      unique(grant.fieldIds, `${direction}.${table.id}.fieldIds`);
      for (const fieldId of grant.fieldIds)
        if (!table.fields.some(field => field.id === fieldId))
          throw new T3EngineError('INPUT', `授权引用了未知字段 ${table.id}.${fieldId}。`);
      for (const rowId of grant.rowIds)
        if (!data.tables[table.id].some(row => row.meta.id === rowId))
          throw new T3EngineError('INPUT', `授权引用了未知记录 ${table.id}/${rowId}。`);
    }
  }
  unique(request.policy.insertTableIds, 'insertTableIds');
  for (const id of request.policy.insertTableIds) tableById(template, id);
  const limits = { ...DEFAULT_LIMITS, ...request.limits };
  limits.maxAffectedRows = Math.min(limits.maxAffectedRows, template.hardLimits.maxRows);
  limits.maxNewRows = Math.min(limits.maxNewRows, template.hardLimits.maxNewRows, limits.maxAffectedRows);
  return {
    template,
    data,
    sql: request.sql,
    parameters: request.parameters as T2Json[],
    batchId: request.batchId,
    policy: request.policy,
    limits,
  };
}

/** Convenience for isolated UI/tests only; production T7/T8 must supply its frozen candidate grants. */
export function createT3LocalPolicy(
  templateInput: T2Template,
  dataInput: T2WorldData,
  actor: 'manual' | 'ai' = 'manual',
  stage: 'macro' | 'micro' | null = null,
): T3Policy {
  const template = normalizeT2Template(templateInput);
  const data = normalizeT2WorldData(template, dataInput);
  if (actor !== 'manual' && actor !== 'ai') throw new T3EngineError('INPUT', '未知读取/修改者。');
  if (actor === 'ai' ? stage !== 'macro' && stage !== 'micro' : stage !== null)
    throw new T3EngineError('INPUT', '读取/修改者与阶段不匹配。');
  const audience = actor === 'manual' ? 'user' : 'evolutionAi';
  return {
    actor,
    stage,
    read: template.tables
      .filter(table => table.visibility[audience])
      .map(table => ({
        tableId: table.id,
        rowIds: data.tables[table.id].filter(row => row.meta.visibility[audience]).map(row => row.meta.id),
        fieldIds: table.fields.filter(field => field.visibility[audience]).map(field => field.id),
      })),
    write: template.tables
      .filter(table => actor === 'manual' || table.groupId === stage)
      .map(table => ({
        tableId: table.id,
        rowIds: data.tables[table.id].map(row => row.meta.id),
        fieldIds: table.fields
          .filter(field => !field.readonly && field.permissions[actor === 'manual' ? 'manualWrite' : 'aiWrite'])
          .map(field => field.id),
      })),
    insertTableIds: template.tables
      .filter(table => table.permissions[actor].insert && (actor === 'manual' || table.groupId === stage))
      .map(table => table.id),
  };
}

/** Allocations are deterministic inputs to the later T4 commit, not random SQLite rowids. */
export function allocateT3RowId(batchId: string, statementIndex: number): string {
  if (
    !/^[a-z][a-z0-9_-]{0,31}$/.test(batchId) ||
    batchId === 'constructor' ||
    batchId === 'prototype' ||
    !Number.isSafeInteger(statementIndex) ||
    statementIndex < 0 ||
    statementIndex >= 32
  )
    throw new T3EngineError('INPUT', '新增记录的批次/语句身份无效。');
  return `new-${batchId}-${statementIndex}`;
}

function runPrepared(db: Database, sql: string, bindings: SqlValue[]): void {
  const statement = db.prepare(sql);
  try {
    statement.bind(bindings);
    while (statement.step()) {
      /* DML must finish before checking affected rows. */
    }
  } finally {
    statement.free();
  }
}

/** Synchronous only inside a disposable worker; use createT3WorkerRunner for preemptible execution. */
export function executeT3Request(SQL: SqlJsStatic, input: T3Request): T3Result {
  let request: ReturnType<typeof normalizeRequest>;
  let parsed: T3Statement[];
  try {
    request = normalizeRequest(input);
  } catch (error) {
    if (error instanceof T3EngineError) throw error;
    throw new T3EngineError('INPUT', error instanceof Error ? error.message : '请求未通过校验。');
  }
  try {
    parsed = parseT3Sql(request.sql);
  } catch (error) {
    throw new T3EngineError('SQL', error instanceof Error ? error.message : 'SQL 不受支持。');
  }
  if (parsed.length > request.limits.maxStatements) throw new T3EngineError('LIMIT', 'SQL 语句数超过本批预算。');
  if (countT3Parameters(parsed) !== request.parameters.length)
    throw new T3EngineError('INPUT', '位置参数缺失或存在未使用参数。');
  const { template, data: base, policy, limits } = request;
  const allocations: T3Allocation[] = parsed.flatMap((statement, index) =>
    statement.kind === 'insert'
      ? [
          {
            statementIndex: index,
            tableId: template.tables.find(table => table.sqlName === statement.table)?.id ?? '',
            rowId: allocateT3RowId(request.batchId, index),
          },
        ]
      : [],
  );
  const addedRows = new Map<string, T2Row>();
  const changed = new Map<string, { tableId: string; rowId: string }>();
  const perTableChanged = new Map<string, Set<string>>();
  const perTableNew = new Map<string, number>();
  const queries: T3QueryResult[] = [];
  const executed: T3ExecutedStatement[] = [];
  const logicalSql: string[] = [];
  const logicalParameters: T2Json[] = [];
  let queryChars = 0;
  const key = (tableId: string, rowId: string) => JSON.stringify([tableId, rowId]);
  const allocationFor = (alias: string, table: T2Table): string => {
    const match = /^@new:(0|[1-9]\d*)$/.exec(alias);
    if (!match) {
      ID.parse(alias);
      return alias;
    }
    const allocation = allocations.find(item => item.statementIndex === Number(match[1]));
    if (!allocation || allocation.tableId !== table.id)
      throw new T3EngineError('DATA', '新增别名不是本批次指定表的 INSERT 语句。');
    return allocation.rowId;
  };
  const valueOf = (value: T3Value): T2Json =>
    value.kind === 'literal' ? value.value : request.parameters[value.index];
  const rowFor = (table: T2Table, rowId: string): T2Row | undefined =>
    addedRows.get(key(table.id, rowId)) ?? base.tables[table.id].find(row => row.meta.id === rowId);
  const typedValue = (field: T2Field, inputValue: T2Json): T2Cell => {
    let value: unknown = inputValue;
    if (
      value !== null &&
      ['string-list', 'reference', 'reference-list', 'world-time'].includes(field.type) &&
      typeof value === 'string'
    ) {
      try {
        value = JSON.parse(value);
      } catch {
        throw new T3EngineError('DATA', '复合字段必须是合法 JSON 值或 JSON 文本。', undefined, field.id);
      }
    }
    if (field.type === 'reference' || field.type === 'reference-list') {
      const materialize = (ref: unknown): unknown => {
        const object = cloneT2Json(ref);
        if (
          !object ||
          typeof object !== 'object' ||
          Array.isArray(object) ||
          typeof object.tableId !== 'string' ||
          typeof object.rowId !== 'string'
        )
          return object;
        const targetTable = tableById(template, object.tableId);
        return { ...object, rowId: allocationFor(object.rowId, targetTable) };
      };
      value =
        value === null
          ? null
          : field.type === 'reference-list' && Array.isArray(value)
            ? value.map(materialize)
            : materialize(value);
    }
    try {
      return validateT2Cell(field, value, template);
    } catch (error) {
      throw new T3EngineError('DATA', error instanceof Error ? error.message : '字段值不合法。', undefined, field.id);
    }
  };
  const authorizeWrite = (
    table: T2Table,
    operation: 'insert' | 'update' | 'delete',
    rowId: string,
    fields: T2Field[],
  ): void => {
    const grant = policy.write.find(item => item.tableId === table.id);
    if (!grant || fields.some(field => !grant.fieldIds.includes(field.id)))
      throw new T3EngineError('AUTHORIZATION', '写入表/字段不在已冻结授权中。');
    const newRow = addedRows.has(key(table.id, rowId));
    if (operation === 'insert' ? !policy.insertTableIds.includes(table.id) : !grant.rowIds.includes(rowId) && !newRow)
      throw new T3EngineError('AUTHORIZATION', '写入记录不在已冻结候选范围中。');
    const result = evaluateT2Write(template, base, {
      actor: policy.actor,
      operation: newRow ? 'insert' : operation,
      tableId: table.id,
      rowId,
      fieldIds: fields.map(field => field.id),
      ...(policy.stage ? { stage: policy.stage } : {}),
    });
    if (!result.allowed || !table.permissions[policy.actor][operation])
      throw new T3EngineError('AUTHORIZATION', result.reasons.join('；') || '表禁止此写操作。');
    if (policy.actor === 'ai' && resolveT2TableSettings(template, table.id).budget.state === 'disabled')
      throw new T3EngineError('AUTHORIZATION', '本表的自动演变预算已明确关闭。');
  };
  const countWrite = (table: T2Table, rowIds: string[], inserted = false): void => {
    const rows = perTableChanged.get(table.id) ?? new Set<string>();
    for (const rowId of rowIds) {
      rows.add(rowId);
      changed.set(key(table.id, rowId), { tableId: table.id, rowId });
    }
    perTableChanged.set(table.id, rows);
    if (changed.size > limits.maxAffectedRows) throw new T3EngineError('LIMIT', '实际修改记录超出整批/整轮硬上限。');
    if (inserted) perTableNew.set(table.id, (perTableNew.get(table.id) ?? 0) + rowIds.length);
    if ([...perTableNew.values()].reduce((sum, count) => sum + count, 0) > limits.maxNewRows)
      throw new T3EngineError('LIMIT', '新增记录超出独立新增预算。');
    if (policy.actor === 'ai') {
      const budget = resolveT2TableSettings(template, table.id).budget.value;
      if (!budget || rows.size > budget.maxRows || (perTableNew.get(table.id) ?? 0) > budget.maxNewRows)
        throw new T3EngineError('LIMIT', '实际修改/新增记录超过本表有效预算。');
    }
  };
  let db: Database | undefined;
  let transaction = false;
  let statementIndex: number | undefined;
  try {
    db = createT3Database(SQL, template, base);
    db.run('BEGIN IMMEDIATE');
    transaction = true;
    for (const [index, statement] of parsed.entries()) {
      statementIndex = index;
      const table = template.tables.find(item => item.sqlName === statement.table);
      if (!table) throw new T3EngineError('AUTHORIZATION', 'SQL 指向了未声明的表、系统表或外部数据库。');
      const targets =
        statement.kind !== 'insert' && statement.targets
          ? statement.targets.map(value => {
              const raw = valueOf(value);
              if (typeof raw !== 'string')
                throw new T3EngineError('DATA', '目标记录 ID 必须是字符串，不按姓名或数字匹配。');
              return allocationFor(raw, table);
            })
          : [];
      unique(targets, '目标记录');
      if (statement.kind === 'select') {
        const fields = statement.columns
          .filter(column => column !== '__we_row_id')
          .map(column => fieldBySql(table, column));
        const grant = policy.read.find(item => item.tableId === table.id);
        const audience = policy.actor === 'manual' ? 'user' : 'evolutionAi';
        if (
          !grant ||
          !table.visibility[audience] ||
          fields.some(field => !grant.fieldIds.includes(field.id) || !field.visibility[audience])
        )
          throw new T3EngineError('AUTHORIZATION', '查询字段不在已冻结的独立读取授权中。');
        const permitted = [
          ...grant.rowIds,
          ...allocations
            .filter(item => item.tableId === table.id && addedRows.has(key(table.id, item.rowId)))
            .map(item => item.rowId),
        ];
        const requested = statement.targets ? targets : permitted;
        if (requested.some(rowId => !permitted.includes(rowId)))
          throw new T3EngineError('AUTHORIZATION', '查询记录不在已冻结读取范围中。');
        for (const rowId of requested) {
          const row = rowFor(table, rowId);
          if (
            row &&
            (!row.meta.visibility[audience] || fields.some(field => !canReadT2Field(table, row, field.id, audience)))
          )
            throw new T3EngineError('AUTHORIZATION', '记录或字段不允许当前读取者读取。');
        }
        // Apply LIMIT inside SQLite after filtering deleted rows, not to stale candidate IDs.
        const rowIds = [...requested].sort();
        const sql = `SELECT ${['__we_row_id', '__we_presence', ...fields.map(field => field.sqlName)].map(quoteT3Identifier).join(',')} FROM ${quoteT3Identifier(table.sqlName)} WHERE "__we_row_id" IN (${rowIds.map(() => '?').join(',') || 'NULL'}) ORDER BY "__we_row_id" ASC LIMIT ?`;
        const bindings = [...rowIds, Math.min(statement.limit ?? limits.maxQueryRows, limits.maxQueryRows)];
        const prepared = db.prepare(sql);
        const rows: T3QueryResult['rows'] = [];
        try {
          prepared.bind(bindings);
          while (prepared.step()) {
            const physical = prepared.getAsObject();
            const presence = JSON.parse(String(physical.__we_presence)) as string[];
            const values: Record<string, T2Cell> = {};
            for (const field of fields) {
              const value = decodeT2Cell(
                field,
                { present: presence.includes(field.id), value: physical[field.sqlName] },
                template,
              );
              const references =
                value === undefined || value === null
                  ? []
                  : field.type === 'reference'
                    ? [value as { tableId: string; rowId: string }]
                    : field.type === 'reference-list'
                      ? (value as { tableId: string; rowId: string }[])
                      : [];
              for (const reference of references) {
                const target = tableById(template, reference.tableId);
                const targetGrant = policy.read.find(item => item.tableId === target.id);
                const targetRow = rowFor(target, reference.rowId);
                const created = addedRows.has(key(target.id, reference.rowId));
                if (
                  !targetGrant ||
                  !target.visibility[audience] ||
                  !targetRow?.meta.visibility[audience] ||
                  (!targetGrant.rowIds.includes(reference.rowId) && !created)
                )
                  throw new T3EngineError('AUTHORIZATION', '查询引用目标不在当前读取范围中。', undefined, field.id);
              }
              if (value !== undefined) values[field.id] = value;
            }
            rows.push({ rowId: String(physical.__we_row_id), values });
          }
        } finally {
          prepared.free();
        }
        const query: T3QueryResult = {
          statementIndex: index,
          tableId: table.id,
          fieldIds: fields.map(field => field.id),
          rows,
        };
        queryChars += JSON.stringify(query).length;
        if (queryChars > limits.maxResultChars)
          throw new T3EngineError('LIMIT', '查询结果累计文本量超过预算；整批未接受。');
        queries.push(query);
        executed.push({
          statementIndex: index,
          operation: 'select',
          tableId: table.id,
          rowIds: rows.map(row => row.rowId),
          fieldIds: fields.map(field => field.id),
          sql,
          bindings,
          affectedRows: 0,
        });
        logicalSql.push(
          `SELECT ${statement.columns.map(quoteT3Identifier).join(',')} FROM ${quoteT3Identifier(table.sqlName)}${statement.targets ? ` WHERE "__we_row_id" IN (${targets.map(() => '?').join(',')})` : ''} ORDER BY "__we_row_id" ASC${statement.limit === undefined ? '' : ` LIMIT ${statement.limit}`}`,
        );
        if (statement.targets) logicalParameters.push(...targets);
      } else if (statement.kind === 'insert') {
        const allocation = allocations.find(item => item.statementIndex === index)!;
        const fields = statement.columns.map(column => fieldBySql(table, column));
        authorizeWrite(table, 'insert', allocation.rowId, fields);
        const values = Object.fromEntries(
          fields.map((field, offset) => [field.id, typedValue(field, valueOf(statement.values[offset]))]),
        );
        const row = prepareT2NewRow(template, table.id, allocation.rowId, values, {
          revision: base.revision,
          source: {
            kind: policy.actor === 'manual' ? 'manual' : 'evolution',
            detail: `T3 隔离批次 ${request.batchId}`,
          },
        });
        // Static defaults are business writes too; they cannot bypass the caller's field grant.
        const insertedFields = table.fields.filter(field => Object.hasOwn(row.values, field.id));
        authorizeWrite(table, 'insert', allocation.rowId, insertedFields);
        countWrite(table, [allocation.rowId], true);
        insertT3Row(db, table, row);
        if (db.getRowsModified() !== 1) throw new T3EngineError('CONSTRAINT', 'SQLite 新增记录实际数量不一致。');
        addedRows.set(key(table.id, row.meta.id), row);
        const sql = `INSERT INTO ${quoteT3Identifier(table.sqlName)} (${insertedFields.map(field => quoteT3Identifier(field.sqlName)).join(',')}) VALUES (${insertedFields.map(() => '?').join(',')})`;
        logicalSql.push(sql);
        logicalParameters.push(...insertedFields.map(field => row.values[field.id] as T2Json));
        executed.push({
          statementIndex: index,
          operation: 'insert',
          tableId: table.id,
          rowIds: [row.meta.id],
          fieldIds: insertedFields.map(field => field.id),
          sql,
          bindings: insertedFields.map(field => encodeT2Cell(field, row.values[field.id], template).value),
          affectedRows: 1,
        });
      } else {
        const fields =
          statement.kind === 'update'
            ? statement.assignments.map(assignment => fieldBySql(table, assignment.column))
            : [];
        for (const rowId of targets) authorizeWrite(table, statement.kind, rowId, fields);
        const check = db.prepare(
          `SELECT "__we_row_id","__we_presence" FROM ${quoteT3Identifier(table.sqlName)} WHERE "__we_row_id" IN (${targets.map(() => '?').join(',')})`,
        );
        const actual: string[] = [];
        const deletedFieldIds = new Set<string>();
        try {
          check.bind(targets);
          while (check.step()) {
            const physicalRow = check.get();
            const rowId = String(physicalRow[0]);
            actual.push(rowId);
            if (statement.kind === 'delete') {
              const present = JSON.parse(String(physicalRow[1])) as string[];
              const removedFields = table.fields.filter(field => present.includes(field.id));
              authorizeWrite(table, 'delete', rowId, removedFields);
              removedFields.forEach(field => deletedFieldIds.add(field.id));
            }
          }
        } finally {
          check.free();
        }
        if (actual.length !== targets.length)
          throw new T3EngineError('DATA', '目标包含不存在或已删除的记录，不能当成成功写入。');
        countWrite(table, actual);
        if (statement.kind === 'delete') {
          const sql = `DELETE FROM ${quoteT3Identifier(table.sqlName)} WHERE "__we_row_id" IN (${targets.map(() => '?').join(',')})`;
          runPrepared(db, sql, targets);
          if (db.getRowsModified() !== targets.length)
            throw new T3EngineError('CONSTRAINT', 'SQLite 删除记录数量与授权目标不一致。');
          logicalSql.push(sql);
          logicalParameters.push(...targets);
          executed.push({
            statementIndex: index,
            operation: 'delete',
            tableId: table.id,
            rowIds: targets,
            fieldIds: table.fields.filter(field => deletedFieldIds.has(field.id)).map(field => field.id),
            sql,
            bindings: targets,
            affectedRows: targets.length,
          });
          for (const rowId of targets) addedRows.delete(key(table.id, rowId));
        } else {
          const values = fields.map((field, offset) => typedValue(field, valueOf(statement.assignments[offset].value)));
          const physical = fields.map((field, offset) => {
            const value = encodeT2Cell(field, values[offset], template).value;
            try {
              assertT3SqlValue(value);
            } catch (error) {
              throw new T3EngineError(
                'DATA',
                error instanceof Error ? error.message : '字段值无法无损绑定。',
                undefined,
                field.id,
              );
            }
            return value;
          });
          const sql = `UPDATE ${quoteT3Identifier(table.sqlName)} SET ${fields.map(field => `${quoteT3Identifier(field.sqlName)}=?`).join(',')} WHERE "__we_row_id" IN (${targets.map(() => '?').join(',')})`;
          runPrepared(db, sql, [...physical, ...targets]);
          if (db.getRowsModified() !== targets.length)
            throw new T3EngineError('CONSTRAINT', 'SQLite 更新记录数量与授权目标不一致。');
          for (const rowId of targets) {
            const reader = db.prepare(
              `SELECT "__we_presence" FROM ${quoteT3Identifier(table.sqlName)} WHERE "__we_row_id"=?`,
            );
            let presence: string[];
            try {
              reader.bind([rowId]);
              if (!reader.step()) throw new T3EngineError('DATA', '更新目标消失。');
              presence = JSON.parse(String(reader.get()[0])) as string[];
            } finally {
              reader.free();
            }
            runPrepared(db, `UPDATE ${quoteT3Identifier(table.sqlName)} SET "__we_presence"=? WHERE "__we_row_id"=?`, [
              JSON.stringify(
                table.fields
                  .filter(field => presence.includes(field.id) || fields.some(updated => updated.id === field.id))
                  .map(field => field.id),
              ),
              rowId,
            ]);
            const added = addedRows.get(key(table.id, rowId));
            if (added)
              fields.forEach((field, offset) => {
                added.values[field.id] = values[offset];
              });
          }
          logicalSql.push(sql);
          logicalParameters.push(...(values as T2Json[]), ...targets);
          executed.push({
            statementIndex: index,
            operation: 'update',
            tableId: table.id,
            rowIds: targets,
            fieldIds: fields.map(field => field.id),
            sql,
            bindings: [...physical, ...targets],
            affectedRows: targets.length,
          });
        }
      }
    }
    statementIndex = undefined; // Whole-batch checks must not blame the last individually valid statement.
    let data: T2WorldData;
    try {
      data = exportT3World(db, template, base);
    } catch (error) {
      throw new T3EngineError('DATA', error instanceof Error ? error.message : '整批资料校验失败。');
    }
    const replaySql = `${logicalSql.join(';\n')};`;
    try {
      const replayStatements = parseT3Sql(replaySql);
      if (countT3Parameters(replayStatements) !== logicalParameters.length)
        throw new Error('固定日志参数与语句不一致。');
      cloneT2Json(logicalParameters);
    } catch (error) {
      throw new T3EngineError(
        'LIMIT',
        error instanceof Error ? `固定日志无法安全重放：${error.message}` : '固定日志超限。',
      );
    }
    db.run('COMMIT');
    transaction = false;
    return {
      mode: 'isolated-sqlite',
      data,
      queries,
      allocations,
      statements: executed,
      log: {
        format: 'world-evolution-sql-log',
        version: 1,
        templateId: template.id,
        templateVersion: template.templateVersion,
        batchId: request.batchId,
        sql: replaySql,
        parameters: logicalParameters,
      },
      changedRows: [...changed.values()],
    };
  } catch (error) {
    if (transaction && db) {
      try {
        db.run('ROLLBACK');
      } catch {
        /* Disposable DB is closed below even if rollback itself fails. */
      }
    }
    const failedStatement = statementIndex === undefined ? undefined : parsed[statementIndex];
    const failedTableId = template.tables.find(table => table.sqlName === failedStatement?.table)?.id;
    if (error instanceof T3EngineError)
      throw new T3EngineError(
        error.code,
        error.message,
        error.statementIndex ?? statementIndex,
        error.fieldId,
        error.tableId ?? failedTableId,
      );
    throw new T3EngineError(
      'CONSTRAINT',
      error instanceof Error ? error.message : 'SQLite 批次失败。',
      statementIndex,
      undefined,
      failedTableId,
    );
  } finally {
    db?.close();
  }
}

export function replayT3Log(
  SQL: SqlJsStatic,
  template: T2Template,
  data: T2WorldData,
  logInput: T3Log,
  policy: T3Policy,
  limits?: Partial<T3Limits>,
): T3Result {
  const schema = z.strictObject({
    format: z.literal('world-evolution-sql-log'),
    version: z.literal(1),
    templateId: ID,
    templateVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    batchId: z.string(),
    sql: z.string(),
    parameters: z.array(z.unknown()),
  });
  const log = schema.parse(cloneT2Json(logInput));
  if (log.templateId !== template.id || log.templateVersion !== template.templateVersion)
    throw new T3EngineError('INPUT', '固定日志与当前模板身份/版本不匹配；不能猜测重放。');
  return executeT3Request(SQL, {
    template,
    data,
    sql: log.sql,
    parameters: log.parameters as T2Json[],
    batchId: log.batchId,
    policy,
    ...(limits ? { limits } : {}),
  });
}
