import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test, { before } from 'node:test';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createDefaultT2Fixture, createMinimalT2Fixture } from './t2-defaults';
import { cloneT2Json, type T2Json } from './t2-template';
import { createT3LocalPolicy, executeT3Request, type T3Request, type T3Result } from './t3-engine';
import { freezeT3Request, normalizeT3Result } from './t3-result';

let SQL: SqlJsStatic;
before(async () => {
  SQL = await initSqlJs({
    wasmBinary: new Uint8Array(readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm'))).buffer,
  });
});
function work(
  sql = 'UPDATE we_npc SET f_goals=? WHERE __we_row_id=?; SELECT f_name,f_goals FROM we_npc WHERE __we_row_id=?',
  parameters: T2Json[] = ['守住城门', 'lin-watch', 'lin-watch'],
): T3Request {
  const { template, data } = createDefaultT2Fixture();
  return { template, data, sql, parameters, batchId: 'result', policy: createT3LocalPolicy(template, data) };
}
const copy = <T>(value: T): T => cloneT2Json(value) as T;

test('完整受限 SQL 结果可通过纯边界校验，输入/输出互不共享引用', () => {
  const request = work();
  const frozen = freezeT3Request(request);
  const result = executeT3Request(SQL, request);
  const accepted = normalizeT3Result(result, frozen);
  assert.deepEqual(accepted, result);
  assert.notEqual(accepted.data, result.data);
  assert.notEqual(frozen.data, request.data);
  assert.ok(Object.isFrozen(frozen.policy.read[0].fieldIds));
  result.data.tables.npc[0].values.goals = '外部修改';
  assert.equal(accepted.data.tables.npc[0].values.goals, '守住城门');
});

test('结果外形严格：空对象、缺块、多字段、函数与非 JSON 值全部拒绝', () => {
  const request = freezeT3Request(work());
  const result = executeT3Request(SQL, request);
  const invalid: unknown[] = [
    {},
    { ...result, extra: 1 },
    { ...result, mode: 'production' },
    { ...result, log: null },
    { ...result, unsafe: () => 1 },
    { ...result, queries: [{ invalid: NaN }] },
  ];
  const missing = copy(result) as Partial<T3Result>;
  delete missing.allocations;
  invalid.push(missing);
  for (const input of invalid) assert.throws(() => normalizeT3Result(input, request));
});

test('世界、分支、revision、模板及日志批次不得被 Worker 改换', () => {
  const request = freezeT3Request(work());
  const result = executeT3Request(SQL, request);
  for (const key of ['worldId', 'branchId', 'templateId', 'revision', 'templateVersion'] as const) {
    const changed = copy(result);
    Object.assign(changed.data, {
      [key]: typeof changed.data[key] === 'number' ? Number(changed.data[key]) + 1 : 'other',
    });
    assert.throws(() => normalizeT3Result(changed, request));
  }
  for (const key of ['batchId', 'templateId', 'templateVersion'] as const) {
    const changed = copy(result);
    Object.assign(changed.log, {
      [key]: typeof changed.log[key] === 'number' ? Number(changed.log[key]) + 1 : 'other',
    });
    assert.throws(() => normalizeT3Result(changed, request));
  }
});

test('全快照类型、引用、字段、元数据仍以 T2 模板为唯一来源', () => {
  const request = freezeT3Request(work());
  const result = executeT3Request(SQL, request);
  const mutate: ((result: T3Result) => void)[] = [
    value => {
      value.data.tables.npc[0].values.name = 7;
    },
    value => {
      value.data.tables.npc[0].values.location = { tableId: 'location', rowId: 'missing' };
    },
    value => {
      value.data.tables.npc[0].values.unknown = 'extra';
    },
    value => {
      value.data.tables.npc[0].meta.locked = true;
    },
    value => {
      value.data.tables.npc[0].meta.source.detail = '改来源';
    },
    value => {
      value.data.tables.npc[0].values.name = '偷偷改未声明列';
    },
    value => {
      value.data.tables.npc[1].values.goals = '偷偷修改不在摘要中的行';
    },
  ];
  for (const change of mutate) {
    const invalid = copy(result);
    change(invalid);
    assert.throws(() => normalizeT3Result(invalid, request));
  }
});

test('语句的顺序、操作、声明表列和查询身份必须与冻结 SQL 对应', () => {
  const request = freezeT3Request(work());
  const result = executeT3Request(SQL, request);
  const mutate: ((result: T3Result) => void)[] = [
    value => {
      value.statements[0].statementIndex = 1;
    },
    value => {
      value.statements[0].operation = 'delete';
    },
    value => {
      value.statements[0].tableId = 'location';
    },
    value => {
      value.statements[0].fieldIds = ['name'];
    },
    value => {
      value.statements[0].rowIds = ['missing'];
    },
    value => {
      value.statements[0].affectedRows = 0;
    },
    value => {
      value.statements[1].affectedRows = 1;
    },
    value => {
      value.queries[0].statementIndex = 0;
    },
    value => {
      value.queries[0].rows[0].rowId = 'lin-merchant';
    },
    value => {
      value.queries[0].fieldIds.push('editor_note');
    },
  ];
  for (const change of mutate) {
    const invalid = copy(result);
    change(invalid);
    assert.throws(() => normalizeT3Result(invalid, request));
  }
});

test('查询行、列、类型和可读授权不能靠结果消息扩大', () => {
  const request = freezeT3Request(work());
  const result = executeT3Request(SQL, request);
  const mutate: ((result: T3Result) => void)[] = [
    value => {
      value.queries[0].rows[0].values.editor_note = '隐藏数据';
    },
    value => {
      value.queries[0].rows[0].values.name = 4;
    },
    value => {
      value.queries.push(copy(value.queries[0]));
    },
    value => {
      value.queries[0].rows.push(copy(value.queries[0].rows[0]));
    },
    value => {
      value.changedRows.push(copy(value.changedRows[0]));
    },
    value => {
      value.changedRows = [];
    },
  ];
  for (const change of mutate) {
    const invalid = copy(result);
    change(invalid);
    assert.throws(() => normalizeT3Result(invalid, request));
  }
  const blocked = copy(request);
  blocked.policy.read.find(grant => grant.tableId === 'npc')!.fieldIds = ['goals'];
  assert.throws(() => normalizeT3Result(result, freezeT3Request(blocked)));
});

test('真实 INSERT 默认字段、确定分配、随后查询与删除均接受，不保存幽灵行', () => {
  const request = freezeT3Request(
    work(
      "INSERT INTO we_npc(f_name) VALUES('临时角色'); SELECT f_name FROM we_npc WHERE __we_row_id='@new:0'; DELETE FROM we_npc WHERE __we_row_id='@new:0'",
      [],
    ),
  );
  const result = executeT3Request(SQL, request);
  assert.deepEqual(normalizeT3Result(result, request), result);
  assert.ok(result.changedRows.some(row => row.rowId === 'new-result-0'));
  assert.ok(!result.data.tables.npc.some(row => row.meta.id === 'new-result-0'));
  const invalid = copy(result);
  invalid.allocations[0].rowId = 'invented';
  assert.throws(() => normalizeT3Result(invalid, request));
});

test('真实 INSERT 的受控元数据不得被返回结果伪造为锁定或其它来源', () => {
  const request = freezeT3Request(work("INSERT INTO we_npc(f_name) VALUES('新角色')", []));
  const result = executeT3Request(SQL, request);
  assert.deepEqual(normalizeT3Result(result, request), result);
  const invalid = copy(result);
  invalid.data.tables.npc.at(-1)!.meta.source.kind = 'import';
  assert.throws(() => normalizeT3Result(invalid, request));
});

test('日志仍需受限语法、参数数量和语句操作对齐，不接受任意 SQL 日志', () => {
  const request = freezeT3Request(work());
  const result = executeT3Request(SQL, request);
  for (const sql of ['DROP TABLE we_npc', 'SELECT f_name FROM we_npc', result.log.sql.replace('UPDATE', 'DELETE')]) {
    const invalid = copy(result);
    invalid.log.sql = sql;
    assert.throws(() => normalizeT3Result(invalid, request));
  }
  const invalid = copy(result);
  invalid.log.parameters.push('unused');
  assert.throws(() => normalizeT3Result(invalid, request));
});

test('纯边界校验使用冻结查询和修改预算，不接受过量结果', () => {
  const request = freezeT3Request(work());
  const result = executeT3Request(SQL, request);
  for (const limits of [{ maxAffectedRows: 0 }, { maxQueryRows: 0 }, { maxResultChars: 1 }])
    assert.throws(() => normalizeT3Result(result, freezeT3Request({ ...request, limits })));
});

test('先 SELECT 后 UPDATE 保留合法中间查询值，不要求查询等于最终表格', () => {
  const request = freezeT3Request(
    work(
      "SELECT f_goals FROM we_npc WHERE __we_row_id='lin-watch'; UPDATE we_npc SET f_goals='稍后修改' WHERE __we_row_id='lin-watch'",
      [],
    ),
  );
  const result = executeT3Request(SQL, request);
  assert.notEqual(result.queries[0].rows[0].values.goals, result.data.tables.npc[0].values.goals);
  assert.deepEqual(normalizeT3Result(result, request), result);
});

test('先查询引用再显式解除引用并删目标，合法中间引用无需存在于最终快照', () => {
  const request = freezeT3Request(
    work(
      "SELECT f_relationships FROM we_npc WHERE __we_row_id='lin-watch'; UPDATE we_npc SET f_relationships=? WHERE __we_row_id='lin-watch'; DELETE FROM we_npc WHERE __we_row_id='lin-merchant'",
      [[]],
    ),
  );
  const result = executeT3Request(SQL, request);
  assert.deepEqual(normalizeT3Result(result, request), result);
  const unauthorized = copy(result);
  unauthorized.queries[0].rows[0].values.relationships = [{ tableId: 'npc', rowId: 'not-granted' }];
  assert.throws(() => normalizeT3Result(unauthorized, request));
});

test('DML 结果仍需冻结表、记录、字段和新增授权，不接受伪造候选或只读字段', () => {
  const request = freezeT3Request(work());
  const result = executeT3Request(SQL, request);
  const variants = [copy(request), copy(request), copy(request), copy(request)];
  variants[0].policy.write.find(grant => grant.tableId === 'npc')!.rowIds = [];
  variants[1].policy.write.find(grant => grant.tableId === 'npc')!.fieldIds = ['name'];
  variants[2].template.tables.find(table => table.id === 'npc')!.locked = true;
  variants[3].template.tables.find(table => table.id === 'npc')!.fields.find(field => field.id === 'goals')!.readonly =
    true;
  for (const changed of variants) assert.throws(() => normalizeT3Result(result, freezeT3Request(changed)));
  const insertedRequest = freezeT3Request(work("INSERT INTO we_npc(f_name) VALUES('新增对象')", []));
  const inserted = executeT3Request(SQL, insertedRequest);
  const noInsert = copy(insertedRequest);
  noInsert.policy.insertTableIds = [];
  assert.throws(() => normalizeT3Result(inserted, freezeT3Request(noInsert)));
});

test('新增行不能夹带未声明写入的合法字段；分配 ID 不能撞上基础快照', () => {
  const request = freezeT3Request(work("INSERT INTO we_npc(f_name) VALUES('新增对象')", []));
  const result = executeT3Request(SQL, request);
  const hidden = copy(result);
  hidden.data.tables.npc.at(-1)!.values.editor_note = '夹带字段';
  assert.throws(() => normalizeT3Result(hidden, request));
  const collision = copy(request);
  const existing = copy(collision.data.tables.npc[0]);
  existing.meta.id = 'new-result-0';
  collision.data.tables.npc.push(existing);
  assert.throws(() => normalizeT3Result(result, freezeT3Request(collision)));
});

test('内部候选过滤可生成超过 20k 的诊断 SQL；输入/日志仍保持 20k 边界', () => {
  const { template, data } = createMinimalT2Fixture();
  const table = template.tables.find(table => table.id === 'npc')!;
  const field = copy(table.fields.find(field => field.id === 'name')!);
  delete field.defaultValue;
  table.fields = Array.from({ length: 256 }, (_, index) => ({
    ...copy(field),
    id: `wide-${index}`,
    sqlName: `f_${'a'.repeat(55)}${String(index).padStart(4, '0')}`,
    required: false,
  }));
  table.context.fieldIds = [];
  table.export.fieldIds = [];
  table.export.keyFieldIds = [];
  table.export.titleFieldId = null;
  const meta = copy(data.tables.npc[0].meta);
  meta.source.detail = '';
  data.tables.npc = Array.from({ length: 5000 }, (_, index) => ({
    meta: { ...copy(meta), id: `record-${index}` },
    values: {},
  }));
  const columns = table.fields.map(field => field.sqlName).join(',');
  const fields = table.fields.map(field => field.id);
  const rowIds = data.tables.npc.map(row => row.meta.id);
  const input: T3Request = {
    template,
    data,
    sql: `SELECT ${columns} FROM we_npc LIMIT 0`,
    parameters: [],
    batchId: 'wide',
    policy: {
      actor: 'manual',
      stage: null,
      read: [{ tableId: 'npc', rowIds, fieldIds: fields }],
      write: [],
      insertTableIds: [],
    },
  };
  const frozen = freezeT3Request(input);
  const compiled = `SELECT "__we_row_id","__we_presence",${table.fields.map(field => `"${field.sqlName}"`).join(',')} FROM "we_npc" WHERE "__we_row_id" IN (${rowIds.map(() => '?').join(',')}) ORDER BY "__we_row_id" ASC LIMIT ?`;
  assert.ok(compiled.length > 20000 && compiled.length < 40000);
  const result: T3Result = {
    mode: 'isolated-sqlite',
    data: frozen.data,
    allocations: [],
    changedRows: [],
    queries: [{ statementIndex: 0, tableId: 'npc', fieldIds: fields, rows: [] }],
    statements: [
      {
        statementIndex: 0,
        operation: 'select',
        tableId: 'npc',
        rowIds: [],
        fieldIds: fields,
        sql: compiled,
        bindings: [...rowIds, 0],
        affectedRows: 0,
      },
    ],
    log: {
      format: 'world-evolution-sql-log',
      version: 1,
      templateId: template.id,
      templateVersion: template.templateVersion,
      batchId: 'wide',
      sql: `${input.sql};`,
      parameters: [],
    },
  };
  assert.deepEqual(normalizeT3Result(result, frozen), result);
  assert.throws(() => freezeT3Request({ ...input, sql: ' '.repeat(20001) }));
  assert.throws(() => normalizeT3Result({ ...result, log: { ...result.log, sql: ' '.repeat(20001) } }, frozen));
  assert.throws(() =>
    normalizeT3Result({ ...result, statements: [{ ...result.statements[0], sql: ' '.repeat(40001) }] }, frozen),
  );
});
