/** Pure worker-boundary validation; never imports or executes the SQLite engine. */
import { z } from 'zod';
import type { T3Request, T3Result } from './t3-engine';
import { cloneT2Json, normalizeT2Template, type T2Cell, type T2Json } from './t2-template';
import { normalizeT2WorldData, validateT2Cell } from './t2-values';
import { countT3Parameters, parseT3Sql } from './t3-sql';

const ID = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/)
  .refine(value => !['constructor', 'prototype'].includes(value));
const index = z.number().int().min(0).max(31);
const ids = z.array(ID).max(256);
const grant = z.strictObject({ tableId: ID, rowIds: z.array(ID).max(5000), fieldIds: ids });
const limits = z.strictObject({
  maxStatements: z.number().int().min(1).max(32).optional(),
  maxAffectedRows: z.number().int().min(0).max(10000).optional(),
  maxNewRows: z.number().int().min(0).max(1000).optional(),
  maxQueryRows: z.number().int().min(0).max(100).optional(),
  maxResultChars: z.number().int().min(1).max(1000000).optional(),
});
const requestShape = z.strictObject({
  template: z.unknown(),
  data: z.unknown(),
  sql: z.string().min(1).max(20000),
  parameters: z.array(z.unknown()).max(8192),
  batchId: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/)
    .refine(value => !['constructor', 'prototype'].includes(value)),
  policy: z.strictObject({
    actor: z.enum(['manual', 'ai']),
    stage: z.enum(['macro', 'micro']).nullable(),
    read: z.array(grant).max(256),
    write: z.array(grant).max(256),
    insertTableIds: ids,
  }),
  limits: limits.optional(),
});
const resultShape = z.strictObject({
  mode: z.literal('isolated-sqlite'),
  data: z.unknown(),
  queries: z
    .array(
      z.strictObject({
        statementIndex: index,
        tableId: ID,
        fieldIds: ids,
        rows: z.array(z.strictObject({ rowId: ID, values: z.record(ID, z.unknown()) })).max(100),
      }),
    )
    .max(32),
  allocations: z.array(z.strictObject({ statementIndex: index, tableId: ID, rowId: ID })).max(32),
  statements: z
    .array(
      z.strictObject({
        statementIndex: index,
        operation: z.enum(['select', 'insert', 'update', 'delete']),
        tableId: ID,
        rowIds: z.array(ID).max(100),
        fieldIds: ids,
        // Trusted compilation adds authorization IN placeholders; this is not the input/log SQL cap.
        sql: z.string().min(1).max(40000),
        bindings: z.array(z.union([z.null(), z.number().finite(), z.string()])).max(8192),
        affectedRows: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(32),
  log: z.strictObject({
    format: z.literal('world-evolution-sql-log'),
    version: z.literal(1),
    templateId: ID,
    templateVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    batchId: requestShape.shape.batchId,
    sql: z.string().min(1).max(20000),
    parameters: z.array(z.unknown()).max(8192),
  }),
  changedRows: z.array(z.strictObject({ tableId: ID, rowId: ID })).max(10000),
});

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const rowKey = (tableId: string, rowId: string) => `${tableId}/${rowId}`;
function requireResult(condition: unknown): asserts condition {
  if (!condition) throw new Error('SQLite Worker 结果与冻结请求不一致。');
}
function unique(values: readonly string[]): void {
  requireResult(new Set(values).size === values.length);
}
function freezeJson<T>(input: T): T {
  if (input !== null && typeof input === 'object') {
    for (const value of Object.values(input)) freezeJson(value);
    Object.freeze(input);
  }
  return input;
}

/** Clone before worker creation: neither caller mutation nor a transport adapter can change the trusted baseline. */
export function freezeT3Request(input: T3Request): T3Request {
  const shape = requestShape.parse(cloneT2Json(input));
  const template = normalizeT2Template(shape.template);
  const data = normalizeT2WorldData(template, shape.data);
  return freezeJson({ ...shape, template, data, parameters: shape.parameters as T2Json[] });
}

/** Validate complete JSON shape and world identity before accepting any disposable-worker reply. */
export function normalizeT3Result(input: unknown, frozen: T3Request): T3Result {
  const shape = resultShape.parse(cloneT2Json(input));
  const template = normalizeT2Template(frozen.template);
  const base = normalizeT2WorldData(template, frozen.data);
  const data = normalizeT2WorldData(template, shape.data);
  const baseRows = new Map(
    template.tables.map(table => [table.id, new Map(base.tables[table.id].map(row => [row.meta.id, row]))]),
  );
  const currentRows = new Map(
    template.tables.map(table => [table.id, new Map(data.tables[table.id].map(row => [row.meta.id, row]))]),
  );
  for (const key of [
    'format',
    'dataVersion',
    'schemaVersion',
    'worldId',
    'branchId',
    'revision',
    'templateId',
    'templateVersion',
  ] as const)
    requireResult(data[key] === base[key]);
  requireResult(
    shape.log.templateId === template.id &&
      shape.log.templateVersion === template.templateVersion &&
      shape.log.batchId === frozen.batchId,
  );
  const requested = parseT3Sql(frozen.sql);
  const replay = parseT3Sql(shape.log.sql);
  requireResult(
    countT3Parameters(requested) === frozen.parameters.length &&
      countT3Parameters(replay) === shape.log.parameters.length,
  );
  requireResult(shape.statements.length === requested.length && replay.length === requested.length);
  const expectedAllocations = requested.flatMap((statement, statementIndex) =>
    statement.kind === 'insert'
      ? [
          {
            statementIndex,
            tableId: template.tables.find(table => table.sqlName === statement.table)?.id,
            rowId: `new-${frozen.batchId}-${statementIndex}`,
          },
        ]
      : [],
  );
  requireResult(same(shape.allocations, expectedAllocations));
  const created = new Set(shape.allocations.map(allocation => rowKey(allocation.tableId, allocation.rowId)));
  unique([...shape.allocations.map(allocation => rowKey(allocation.tableId, allocation.rowId))]);
  for (const allocation of shape.allocations) requireResult(!baseRows.get(allocation.tableId)?.has(allocation.rowId));
  const changed = new Set<string>();
  const removed = new Set<string>();
  const writtenFields = new Map<string, Set<string>>();
  const selected = new Set<number>();
  for (const [statementIndex, statement] of shape.statements.entries()) {
    const original = requested[statementIndex];
    const canonical = replay[statementIndex];
    const table = template.tables.find(table => table.id === statement.tableId);
    requireResult(
      table &&
        statement.statementIndex === statementIndex &&
        statement.operation === original.kind &&
        original.table === table.sqlName &&
        canonical.kind === original.kind &&
        canonical.table === table.sqlName,
    );
    unique(statement.rowIds);
    unique(statement.fieldIds);
    requireResult(statement.fieldIds.every(id => table.fields.some(field => field.id === id)));
    const explicitFields =
      original.kind === 'delete'
        ? []
        : (original.kind === 'update' ? original.assignments.map(item => item.column) : original.columns)
            .filter(name => name !== '__we_row_id')
            .map(name => table.fields.find(field => field.sqlName === name)?.id);
    requireResult(explicitFields.every(id => id !== undefined));
    if (original.kind === 'select' || original.kind === 'update')
      requireResult(same(statement.fieldIds, explicitFields));
    if (original.kind !== 'insert' && original.targets) {
      const targets = original.targets.map(target => {
        const value = target.kind === 'literal' ? target.value : frozen.parameters[target.index];
        requireResult(typeof value === 'string');
        const alias = /^@new:(0|[1-9]\d*)$/.exec(value);
        if (!alias) return value;
        const allocation = shape.allocations.find(
          item => item.statementIndex === Number(alias[1]) && item.tableId === table.id,
        );
        requireResult(allocation);
        return allocation.rowId;
      });
      if (original.kind === 'select') requireResult(statement.rowIds.every(id => targets.includes(id)));
      else requireResult(same(statement.rowIds, targets));
    }
    if (original.kind === 'insert') {
      requireResult(
        statement.rowIds.length === 1 &&
          created.has(rowKey(table.id, statement.rowIds[0])) &&
          statement.affectedRows === 1,
      );
      requireResult(explicitFields.every(id => statement.fieldIds.includes(id!)));
    } else if (original.kind === 'select') {
      requireResult(statement.affectedRows === 0);
      selected.add(statementIndex);
    } else requireResult(statement.rowIds.length > 0 && statement.affectedRows === statement.rowIds.length);
    for (const rowId of statement.rowIds)
      requireResult(baseRows.get(table.id)?.has(rowId) || created.has(rowKey(table.id, rowId)));
    if (original.kind !== 'select')
      for (const rowId of statement.rowIds) {
        const identity = rowKey(table.id, rowId);
        const grant = frozen.policy.write.find(grant => grant.tableId === table.id);
        const actor = frozen.policy.actor;
        const oldRow = baseRows.get(table.id)?.get(rowId);
        requireResult(grant && !table.locked && table.permissions[actor][original.kind]);
        requireResult(
          original.kind === 'insert'
            ? frozen.policy.insertTableIds.includes(table.id)
            : grant.rowIds.includes(rowId) || created.has(identity),
        );
        if (actor === 'ai') requireResult(table.groupId === frozen.policy.stage && !oldRow?.meta.archived);
        requireResult(!oldRow?.meta.locked);
        for (const fieldId of statement.fieldIds) {
          const field = table.fields.find(field => field.id === fieldId)!;
          requireResult(
            grant.fieldIds.includes(fieldId) &&
              !field.readonly &&
              field.permissions[actor === 'manual' ? 'manualWrite' : 'aiWrite'] &&
              !oldRow?.meta.lockedFieldIds.includes(fieldId),
          );
        }
        changed.add(identity);
        if (original.kind === 'delete') removed.add(identity);
        const fields = writtenFields.get(identity) ?? new Set<string>();
        statement.fieldIds.forEach(id => fields.add(id));
        writtenFields.set(identity, fields);
      }
  }
  unique(shape.changedRows.map(row => rowKey(row.tableId, row.rowId)));
  requireResult(same([...changed].sort(), shape.changedRows.map(row => rowKey(row.tableId, row.rowId)).sort()));
  requireResult(changed.size <= Math.min(frozen.limits?.maxAffectedRows ?? 50, template.hardLimits.maxRows));
  requireResult(shape.allocations.length <= Math.min(frozen.limits?.maxNewRows ?? 10, template.hardLimits.maxNewRows));
  unique(shape.queries.map(query => String(query.statementIndex)));
  requireResult(
    same(
      shape.queries.map(query => query.statementIndex).sort((a, b) => a - b),
      [...selected].sort((a, b) => a - b),
    ),
  );
  const audience = frozen.policy.actor === 'manual' ? 'user' : 'evolutionAi';
  const queries = shape.queries.map(query => {
    const statement = shape.statements[query.statementIndex];
    const table = template.tables.find(table => table.id === query.tableId);
    const read = frozen.policy.read.find(grant => grant.tableId === query.tableId);
    requireResult(
      table &&
        read &&
        table.visibility[audience] &&
        statement.tableId === table.id &&
        same(query.fieldIds, statement.fieldIds),
    );
    requireResult(
      same(
        query.rows.map(row => row.rowId),
        statement.rowIds,
      ),
    );
    requireResult(query.rows.length <= (frozen.limits?.maxQueryRows ?? 100));
    for (const fieldId of query.fieldIds)
      requireResult(
        read.fieldIds.includes(fieldId) && table.fields.find(field => field.id === fieldId)?.visibility[audience],
      );
    const rows = query.rows.map(row => {
      const original = baseRows.get(table.id)?.get(row.rowId);
      requireResult(
        (read.rowIds.includes(row.rowId) && original?.meta.visibility[audience]) ||
          created.has(rowKey(table.id, row.rowId)),
      );
      requireResult(Object.keys(row.values).every(id => query.fieldIds.includes(id)));
      const values: Record<string, T2Cell> = {};
      for (const fieldId of query.fieldIds) {
        const field = table.fields.find(item => item.id === fieldId)!;
        requireResult(
          read.fieldIds.includes(fieldId) &&
            field.visibility[audience] &&
            (!original || original.meta.visibility[audience]),
        );
        if (Object.hasOwn(row.values, fieldId)) {
          const value = validateT2Cell(field, row.values[fieldId], template);
          const references =
            value === null
              ? []
              : field.type === 'reference'
                ? [value as { tableId: string; rowId: string }]
                : field.type === 'reference-list'
                  ? (value as { tableId: string; rowId: string }[])
                  : [];
          for (const reference of references) {
            const target = template.tables.find(table => table.id === reference.tableId);
            const targetGrant = frozen.policy.read.find(grant => grant.tableId === reference.tableId);
            const targetRow = baseRows.get(reference.tableId)?.get(reference.rowId);
            requireResult(
              target &&
                targetGrant &&
                target.visibility[audience] &&
                ((targetGrant.rowIds.includes(reference.rowId) && targetRow?.meta.visibility[audience]) ||
                  created.has(rowKey(reference.tableId, reference.rowId))),
            );
          }
          values[fieldId] = value;
        }
      }
      return { rowId: row.rowId, values };
    });
    return { ...query, rows };
  });
  requireResult(
    shape.queries.reduce((sum, query) => sum + JSON.stringify(query).length, 0) <=
      (frozen.limits?.maxResultChars ?? 256000),
  );
  for (const table of template.tables) {
    for (const oldRow of base.tables[table.id]) {
      const current = currentRows.get(table.id)?.get(oldRow.meta.id);
      if (current) requireResult(same(current.meta, oldRow.meta));
      else requireResult(removed.has(rowKey(table.id, oldRow.meta.id)));
      if (!changed.has(rowKey(table.id, oldRow.meta.id))) requireResult(same(current, oldRow));
      if (current && changed.has(rowKey(table.id, oldRow.meta.id)))
        for (const field of table.fields) {
          if (writtenFields.get(rowKey(table.id, oldRow.meta.id))?.has(field.id)) continue;
          requireResult(
            Object.hasOwn(current.values, field.id) === Object.hasOwn(oldRow.values, field.id) &&
              same(current.values[field.id], oldRow.values[field.id]),
          );
        }
    }
    for (const row of data.tables[table.id]) {
      if (baseRows.get(table.id)?.has(row.meta.id)) continue;
      requireResult(created.has(rowKey(table.id, row.meta.id)) && changed.has(rowKey(table.id, row.meta.id)));
      requireResult(
        Object.keys(row.values).every(fieldId => writtenFields.get(rowKey(table.id, row.meta.id))?.has(fieldId)),
      );
      requireResult(
        same(row.meta, {
          id: row.meta.id,
          locked: false,
          lockedFieldIds: [],
          archived: false,
          visibility: { user: true, evolutionAi: true, mainAi: true },
          source: {
            kind: frozen.policy.actor === 'manual' ? 'manual' : 'evolution',
            detail: `T3 隔离批次 ${frozen.batchId}`,
          },
          createdAtRevision: base.revision,
          updatedAtRevision: base.revision,
        }),
      );
    }
  }
  return { ...shape, data, queries, log: { ...shape.log, parameters: shape.log.parameters as T2Json[] } };
}
