import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type BindParams, type Database, type SqlJsStatic } from 'sql.js';
import { createCustomT2Fixture, createDefaultT2Fixture, createMinimalT2Fixture } from './t2-defaults';
import { normalizeT2Template, type T2Json, type T2Template, type T2WorldData } from './t2-template';
import { normalizeT2WorldData } from './t2-values';
import {
  allocateT3RowId,
  createT3LocalPolicy,
  executeT3Request,
  replayT3Log,
  T3EngineError,
  type T3EngineErrorCode,
  type T3Policy,
  type T3Request,
} from './t3-engine';

const sqlReady = initSqlJs({
  wasmBinary: Uint8Array.from(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});

type Fixture = { template: T2Template; data: T2WorldData };

function request(
  fixture: Fixture,
  sql: string,
  parameters: T2Json[] = [],
  overrides: Partial<T3Request> = {},
): T3Request {
  return {
    ...fixture,
    sql,
    parameters,
    batchId: 'engine-test',
    policy: createT3LocalPolicy(fixture.template, fixture.data),
    ...overrides,
  };
}

function aiPolicy(fixture: Fixture, stage: 'macro' | 'micro'): T3Policy {
  return createT3LocalPolicy(fixture.template, fixture.data, 'ai', stage);
}

function unchangedOnReject(SQL: SqlJsStatic, input: T3Request, code?: T3EngineErrorCode): T3EngineError {
  const before = JSON.stringify(input);
  let thrown: unknown;
  try {
    executeT3Request(SQL, input);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof T3EngineError, 'The complete batch must reject, never return a partial success.');
  if (code) assert.equal(thrown.code, code);
  assert.equal(
    JSON.stringify(input),
    before,
    'Rejected batches must not alter their template, base data or frozen grants.',
  );
  return thrown;
}

test('T3 engine uses actual SQLite and returns a private same-revision draft without mutating its input', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const input = request(fixture, "UPDATE we_npc SET f_goals = '守住北门' WHERE __we_row_id = 'lin-watch';");
  const before = JSON.stringify(input);
  const result = executeT3Request(SQL, input);
  assert.equal(result.mode, 'isolated-sqlite');
  assert.equal(result.data.tables.npc[0].values.goals, '守住北门');
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.data.revision, fixture.data.revision);
  assert.equal(result.data.worldId, fixture.data.worldId);
  assert.equal(result.data.branchId, fixture.data.branchId);
  assert.deepEqual(result.data.tables.npc[0].meta, fixture.data.tables.npc[0].meta);
  assert.deepEqual(result.changedRows, [{ tableId: 'npc', rowId: 'lin-watch' }]);
  assert.equal(result.statements[0].affectedRows, 1);
  assert.ok(result.statements[0].sql.includes('?'));
  result.data.tables.npc[0].values.name = '只修改返回对象';
  assert.equal(fixture.data.tables.npc[0].values.name, '林澄');
});

test('T3 engine AI macro/micro write groups differ, while permitted macro conditions remain independently readable', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const micro = aiPolicy(fixture, 'micro');
  const read = executeT3Request(
    SQL,
    request(fixture, "SELECT f_travel_constraints FROM we_environment WHERE __we_row_id='harbor-weather'", [], {
      policy: micro,
    }),
  );
  assert.equal(
    read.queries[0].rows[0].values.travel_constraints,
    fixture.data.tables.environment[0].values.travel_constraints,
  );
  assert.deepEqual(read.data, fixture.data);
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_environment SET f_summary='改路' WHERE __we_row_id='harbor-weather'", [], {
      policy: micro,
    }),
    'AUTHORIZATION',
  );
  const macro = aiPolicy(fixture, 'macro');
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='越组' WHERE __we_row_id='lin-watch'", [], { policy: macro }),
    'AUTHORIZATION',
  );
  const update = executeT3Request(
    SQL,
    request(fixture, "UPDATE we_environment SET f_summary='道路受阻' WHERE __we_row_id='harbor-weather'", [], {
      policy: macro,
    }),
  );
  assert.equal(update.data.tables.environment[0].values.summary, '道路受阻');
});

test('T3 engine frozen read grants constrain both rows and fields, including SELECT without WHERE', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const policy = aiPolicy(fixture, 'micro');
  policy.read = [{ tableId: 'npc', rowIds: ['lin-watch'], fieldIds: ['name'] }];
  const result = executeT3Request(SQL, request(fixture, 'SELECT __we_row_id, f_name FROM we_npc', [], { policy }));
  assert.deepEqual(result.queries[0].rows, [{ rowId: 'lin-watch', values: { name: '林澄' } }]);
  unchangedOnReject(
    SQL,
    request(fixture, "SELECT f_name FROM we_npc WHERE __we_row_id='lin-merchant'", [], { policy }),
    'AUTHORIZATION',
  );
  unchangedOnReject(
    SQL,
    request(fixture, "SELECT f_goals FROM we_npc WHERE __we_row_id='lin-watch'", [], { policy }),
    'AUTHORIZATION',
  );
});

test('T3 engine secret fields, hidden rows and hidden tables cannot bypass visibility using forged read grants', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const policy = aiPolicy(fixture, 'micro');
  policy.read.find(grant => grant.tableId === 'npc')!.fieldIds.push('editor_note');
  unchangedOnReject(
    SQL,
    request(fixture, "SELECT f_editor_note FROM we_npc WHERE __we_row_id='lin-watch'", [], { policy }),
    'AUTHORIZATION',
  );
  fixture.data.tables.npc[0].meta.visibility.evolutionAi = false;
  unchangedOnReject(
    SQL,
    request(fixture, "SELECT f_name FROM we_npc WHERE __we_row_id='lin-watch'", [], { policy }),
    'AUTHORIZATION',
  );
  fixture.data.tables.npc[0].meta.visibility.evolutionAi = true;
  fixture.template.tables.find(table => table.id === 'npc')!.visibility.evolutionAi = false;
  unchangedOnReject(SQL, request(fixture, 'SELECT __we_row_id FROM we_npc', [], { policy }), 'AUTHORIZATION');
});

test('T3 engine hiddenUi is not a read permission and manual reads use user visibility, not main-AI visibility', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const manual = executeT3Request(
    SQL,
    request(fixture, "SELECT f_editor_note, f_private_goal FROM we_npc WHERE __we_row_id='lin-watch'"),
  );
  assert.equal(manual.queries[0].rows[0].values.editor_note, fixture.data.tables.npc[0].values.editor_note);
  assert.equal(manual.queries[0].rows[0].values.private_goal, fixture.data.tables.npc[0].values.private_goal);
});

test('T3 engine expressions, functions and subqueries cannot copy a denied field into an allowed field', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  for (const expression of [
    'f_editor_note',
    '(SELECT f_editor_note FROM we_npc)',
    'random()',
    "datetime('now')",
    'CURRENT_TIMESTAMP',
    "f_editor_note || 'x'",
  ]) {
    unchangedOnReject(
      SQL,
      request(
        fixture,
        `UPDATE we_npc SET f_goals='暂存' WHERE __we_row_id='lin-watch'; UPDATE we_npc SET f_goals=${expression} WHERE __we_row_id='lin-watch'`,
      ),
      'SQL',
    );
  }
});

test('T3 engine locks on tables, rows and individual fields prevent manual and AI writes without preventing reads', async () => {
  const SQL = await sqlReady;
  for (const lock of ['table', 'row', 'field'] as const) {
    const fixture = createDefaultT2Fixture();
    if (lock === 'table') fixture.template.tables.find(table => table.id === 'npc')!.locked = true;
    if (lock === 'row') fixture.data.tables.npc[0].meta.locked = true;
    if (lock === 'field') fixture.data.tables.npc[0].meta.lockedFieldIds = ['goals'];
    for (const actor of ['manual', 'ai'] as const) {
      const policy = createT3LocalPolicy(fixture.template, fixture.data, actor, actor === 'ai' ? 'micro' : null);
      unchangedOnReject(
        SQL,
        request(fixture, "UPDATE we_npc SET f_goals='不可更改' WHERE __we_row_id='lin-watch'", [], { policy }),
        'AUTHORIZATION',
      );
      assert.equal(
        executeT3Request(
          SQL,
          request(fixture, "SELECT f_goals FROM we_npc WHERE __we_row_id='lin-watch'", [], { policy }),
        ).queries[0].rows.length,
        1,
      );
    }
  }
});

test('T3 engine disabled AI phases, tables, inherited frequency and budgets remain readable but not AI-writable', async () => {
  const SQL = await sqlReady;
  for (const disabled of ['phase', 'table', 'frequency', 'budget'] as const) {
    const fixture = createDefaultT2Fixture();
    const npc = fixture.template.tables.find(table => table.id === 'npc')!;
    if (disabled === 'phase') fixture.template.phases.micro.enabled = false;
    if (disabled === 'table') npc.runtime.enabled = false;
    if (disabled === 'frequency') fixture.template.phases.micro.frequency = { state: 'disabled' };
    if (disabled === 'budget') npc.runtime.budget = { state: 'disabled' };
    const policy = aiPolicy(fixture, 'micro');
    unchangedOnReject(
      SQL,
      request(fixture, "UPDATE we_npc SET f_goals='不可更新' WHERE __we_row_id='lin-watch'", [], { policy }),
      'AUTHORIZATION',
    );
    assert.equal(
      executeT3Request(
        SQL,
        request(fixture, "SELECT f_goals FROM we_npc WHERE __we_row_id='lin-watch'", [], { policy }),
      ).queries[0].rows.length,
      1,
    );
    assert.equal(
      executeT3Request(SQL, request(fixture, "UPDATE we_npc SET f_goals='人工仍可修改' WHERE __we_row_id='lin-watch'"))
        .data.tables.npc[0].values.goals,
      '人工仍可修改',
    );
  }
});

test('T3 engine readonly fields and system columns cannot be written even with caller-expanded grants', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const npc = fixture.template.tables.find(table => table.id === 'npc')!;
  const goals = npc.fields.find(field => field.id === 'goals')!;
  goals.readonly = true;
  goals.permissions = { manualWrite: false, aiWrite: false };
  const policy = createT3LocalPolicy(fixture.template, fixture.data);
  policy.write.find(grant => grant.tableId === 'npc')!.fieldIds.push('goals');
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='越权' WHERE __we_row_id='lin-watch'", [], { policy }),
    'AUTHORIZATION',
  );
  for (const sql of [
    "UPDATE we_npc SET __we_locked=false WHERE __we_row_id='lin-watch'",
    "INSERT INTO we_npc(__we_row_id,f_name) VALUES('new-manual','改ID')",
    'SELECT __we_visibility FROM we_npc',
    'SELECT rowid FROM we_npc',
    'SELECT name FROM sqlite_schema',
  ])
    unchangedOnReject(SQL, request(fixture, sql));
});

test('T3 engine full-table writes, broad WHERE and unsupported multi-table syntax are zero-effect failures', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  for (const sql of [
    "UPDATE we_npc SET f_goals='所有人'",
    'DELETE FROM we_npc',
    "UPDATE we_npc SET f_goals='所有人' WHERE 1=1",
    "DELETE FROM we_npc WHERE __we_row_id='lin-watch' OR 1=1",
    "UPDATE we_npc SET f_goals='x' FROM we_environment WHERE __we_row_id='lin-watch'",
    "WITH x AS (SELECT f_name FROM we_npc) UPDATE we_npc SET f_goals='x' WHERE __we_row_id='lin-watch'",
  ])
    unchangedOnReject(SQL, request(fixture, sql), 'SQL');
});

test('T3 engine token-aware comment parsing and bound injection strings remain ordinary data', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const payload = "'; DROP TABLE we_npc; -- /* <script>不会执行</script>";
  const result = executeT3Request(
    SQL,
    request(
      fixture,
      '/* DELETE FROM we_npc; */ UPDATE we_npc SET f_goals=? WHERE __we_row_id=?; -- DROP TABLE we_plan;',
      [payload, 'lin-watch'],
    ),
  );
  assert.equal(result.data.tables.npc[0].values.goals, payload);
  assert.equal(result.data.tables.npc.length, 2);
  assert.deepEqual(result.data.tables.plan, fixture.data.tables.plan);
  assert.ok(!result.statements[0].sql.includes(payload));
  assert.equal(result.statements[0].bindings[0], payload);
  assert.equal(
    replayT3Log(SQL, fixture.template, fixture.data, result.log, createT3LocalPolicy(fixture.template, fixture.data))
      .data.tables.npc[0].values.goals,
    payload,
  );
});

test('T3 engine targeted actual update counts are checked, repeated writes consume distinct affected rows', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const result = executeT3Request(
    SQL,
    request(
      fixture,
      "UPDATE we_npc SET f_goals='第一步' WHERE __we_row_id IN ('lin-watch','lin-merchant'); UPDATE we_npc SET f_goals='第二步' WHERE __we_row_id='lin-watch';",
      [],
      { limits: { maxAffectedRows: 2 } },
    ),
  );
  assert.deepEqual(
    result.statements.map(statement => statement.affectedRows),
    [2, 1],
  );
  assert.equal(result.changedRows.length, 2);
  assert.equal(result.data.tables.npc[0].values.goals, '第二步');
  assert.equal(result.data.tables.npc[1].values.goals, '第一步');
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='x' WHERE __we_row_id='not-present'"),
    'AUTHORIZATION',
  );
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='x' WHERE __we_row_id IN (?,?)", ['lin-watch', 'lin-watch']),
    'INPUT',
  );
});

test('T3 engine frozen write row/field grants are independent of read grants', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const policy = aiPolicy(fixture, 'micro');
  policy.write = [{ tableId: 'npc', rowIds: ['lin-watch'], fieldIds: ['goals'] }];
  assert.equal(
    executeT3Request(
      SQL,
      request(fixture, "UPDATE we_npc SET f_goals='合法' WHERE __we_row_id='lin-watch'", [], { policy }),
    ).data.tables.npc[0].values.goals,
    '合法',
  );
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='越候选' WHERE __we_row_id='lin-merchant'", [], { policy }),
    'AUTHORIZATION',
  );
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_name='越字段' WHERE __we_row_id='lin-watch'", [], { policy }),
    'AUTHORIZATION',
  );
});

test('T3 engine unknown/repeated grant identities and malformed actor-stage pairs fail before database allocation', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  let opened = 0;
  class CountedDatabase extends SQL.Database {
    constructor() {
      super();
      opened += 1;
    }
  }
  const instrumented = { ...SQL, Database: CountedDatabase } as SqlJsStatic;
  for (const mutate of [
    (policy: T3Policy) => {
      policy.read.push({ ...policy.read[0] });
    },
    (policy: T3Policy) => {
      policy.read[0].rowIds.push(policy.read[0].rowIds[0]);
    },
    (policy: T3Policy) => {
      policy.read[0].fieldIds.push(policy.read[0].fieldIds[0]);
    },
    (policy: T3Policy) => {
      policy.read[0].fieldIds.push('unknown');
    },
    (policy: T3Policy) => {
      policy.write[0].rowIds.push('unknown');
    },
    (policy: T3Policy) => {
      policy.insertTableIds.push(policy.insertTableIds[0]);
    },
    (policy: T3Policy) => {
      policy.actor = 'ai';
      policy.stage = null;
    },
    (policy: T3Policy) => {
      policy.stage = 'micro';
    },
  ]) {
    const policy = createT3LocalPolicy(fixture.template, fixture.data);
    mutate(policy);
    unchangedOnReject(instrumented, request(fixture, 'SELECT f_name FROM we_npc', [], { policy }), 'INPUT');
  }
  const policy = createT3LocalPolicy(fixture.template, fixture.data);
  policy.read[0].tableId = 'unknown';
  unchangedOnReject(instrumented, request(fixture, 'SELECT f_name FROM we_npc', [], { policy }), 'AUTHORIZATION');
  assert.equal(opened, 0);
});

test('T3 engine requires exact positional parameter counts and rejects unsupported parameter objects', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  unchangedOnReject(
    SQL,
    request(fixture, 'UPDATE we_npc SET f_goals=? WHERE __we_row_id=?', ['missing-target']),
    'INPUT',
  );
  unchangedOnReject(SQL, request(fixture, 'SELECT f_name FROM we_npc', ['unused']), 'INPUT');
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals=? WHERE __we_row_id='lin-watch'", [{ not: 'a string' }]),
    'DATA',
  );
  unchangedOnReject(SQL, request(fixture, 'SELECT f_name FROM we_npc WHERE __we_row_id=?', [1]), 'DATA');
});

test('T3 engine field codecs preserve number, integer, boolean, exact decimal, lists, references and custom calendar', async () => {
  const SQL = await sqlReady;
  const fixture = createCustomT2Fixture();
  const time = { calendarId: 'demo-calendar', ordinalMinute: -1, display: '纪元前一分钟' };
  const reference = { tableId: 'location', rowId: 'north-gate' };
  const references = [{ tableId: 'npc', rowId: 'lin-merchant' }];
  const result = executeT3Request(
    SQL,
    request(
      fixture,
      [
        "UPDATE we_market SET f_open=?, f_unit_price=?, f_goods=?, f_location=? WHERE __we_row_id='harbor-market'",
        "UPDATE we_environment SET f_temperature=?, f_risk=?, f_tags=?, f_observed_time=? WHERE __we_row_id='harbor-weather'",
        "UPDATE we_npc SET f_relationships=?, f_last_action_time=?, f_location=NULL WHERE __we_row_id='lin-watch'",
        "SELECT f_open, f_unit_price, f_goods, f_location FROM we_market WHERE __we_row_id='harbor-market'",
      ].join(';'),
      [false, '-12.30', [], reference, 0.1, 0, ['标签'], time, references, time],
    ),
  );
  assert.equal(result.data.tables.market[0].values.open, false);
  assert.equal(result.data.tables.market[0].values.unit_price, '-12.30');
  assert.deepEqual(result.data.tables.market[0].values.goods, []);
  assert.deepEqual(result.data.tables.market[0].values.location, reference);
  assert.equal(result.data.tables.environment[0].values.temperature, 0.1);
  assert.equal(result.data.tables.environment[0].values.risk, 0);
  assert.deepEqual(result.data.tables.environment[0].values.observed_time, time);
  assert.deepEqual(result.data.tables.npc[0].values.relationships, references);
  assert.equal(result.data.tables.npc[0].values.location, null);
  assert.deepEqual(result.queries[0].rows[0].values, {
    open: false,
    unit_price: '-12.30',
    goods: [],
    location: reference,
  });
  assert.ok(result.statements[0].bindings.includes(-1230));
});

test('T3 engine JSON text complex values are data, invalid precision/types/enum/calendar/list duplicates are rejected', async () => {
  const SQL = await sqlReady;
  const fixture = createCustomT2Fixture();
  const valid = executeT3Request(
    SQL,
    request(fixture, 'UPDATE we_market SET f_goods=\'["甲","乙"]\' WHERE __we_row_id=\'harbor-market\''),
  );
  assert.deepEqual(valid.data.tables.market[0].values.goods, ['甲', '乙']);
  for (const [sql, parameter] of [
    ["UPDATE we_market SET f_unit_price=? WHERE __we_row_id='harbor-market'", '12.3'],
    ["UPDATE we_market SET f_open=? WHERE __we_row_id='harbor-market'", 0],
    ["UPDATE we_market SET f_goods=? WHERE __we_row_id='harbor-market'", ['重复', '重复']],
    ["UPDATE we_npc SET f_status=? WHERE __we_row_id='lin-watch'", '不存在的状态'],
    [
      "UPDATE we_environment SET f_observed_time=? WHERE __we_row_id='harbor-weather'",
      { calendarId: 'wrong-calendar', ordinalMinute: 1, display: '错纪元' },
    ],
    ["UPDATE we_market SET f_goods=? WHERE __we_row_id='harbor-market'", '[not JSON]'],
  ] as [string, T2Json][])
    unchangedOnReject(SQL, request(fixture, sql, [parameter]), 'DATA');
});

test('T3 engine missing optional values stay missing instead of being overwritten by template defaults', async () => {
  const SQL = await sqlReady;
  const fixture = createCustomT2Fixture();
  const market = fixture.template.tables.find(table => table.id === 'market')!;
  market.fields.push({
    ...market.fields.find(field => field.id === 'name')!,
    id: 'optional',
    sqlName: 'f_optional',
    required: false,
    defaultValue: '不自动补',
  });
  fixture.template = normalizeT2Template(fixture.template);
  fixture.data = normalizeT2WorldData(fixture.template, fixture.data);
  const read = executeT3Request(SQL, request(fixture, 'SELECT f_optional FROM we_market'));
  assert.equal(Object.hasOwn(read.queries[0].rows[0].values, 'optional'), false);
  assert.equal(Object.hasOwn(read.data.tables.market[0].values, 'optional'), false);
  const write = executeT3Request(
    SQL,
    request(fixture, "UPDATE we_market SET f_optional='' WHERE __we_row_id='harbor-market'"),
  );
  assert.equal(write.data.tables.market[0].values.optional, '');
});

test('T3 engine controlled INSERT IDs and forward/backward reference aliases resolve within one atomic batch', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const result = executeT3Request(
    SQL,
    request(
      fixture,
      [
        'INSERT INTO we_npc(f_name,f_relationships) VALUES(?,?)',
        'INSERT INTO we_npc(f_name,f_relationships) VALUES(?,?)',
        "UPDATE we_npc SET f_goals=? WHERE __we_row_id='@new:0'",
        "SELECT f_name,f_relationships FROM we_npc WHERE __we_row_id IN ('@new:0','@new:1')",
      ].join(';'),
      ['甲', [{ tableId: 'npc', rowId: '@new:1' }], '乙', [{ tableId: 'npc', rowId: '@new:0' }], '更新新角色'],
    ),
  );
  assert.deepEqual(result.allocations, [
    { statementIndex: 0, tableId: 'npc', rowId: 'new-engine-test-0' },
    { statementIndex: 1, tableId: 'npc', rowId: 'new-engine-test-1' },
  ]);
  const first = result.data.tables.npc.find(row => row.meta.id === 'new-engine-test-0')!;
  const second = result.data.tables.npc.find(row => row.meta.id === 'new-engine-test-1')!;
  assert.equal(first.values.goals, '更新新角色');
  assert.deepEqual(first.values.relationships, [{ tableId: 'npc', rowId: second.meta.id }]);
  assert.deepEqual(second.values.relationships, [{ tableId: 'npc', rowId: first.meta.id }]);
  assert.equal(first.meta.createdAtRevision, fixture.data.revision);
  assert.equal(result.queries[0].rows.length, 2);
  assert.equal(JSON.stringify(result.log).includes('@new:'), false);
});

test('T3 engine forward single references across tables and JSON-text aliases resolve before graph validation', async () => {
  const SQL = await sqlReady;
  const fixture = createCustomT2Fixture();
  const result = executeT3Request(
    SQL,
    request(
      fixture,
      'INSERT INTO we_market(f_name,f_location) VALUES(?,?); INSERT INTO we_location(f_name) VALUES(?);',
      ['新集市', JSON.stringify({ tableId: 'location', rowId: '@new:1' }), '新地点'],
    ),
  );
  assert.deepEqual(result.data.tables.market.at(-1)!.values.location, {
    tableId: 'location',
    rowId: 'new-engine-test-1',
  });
});

test('T3 engine unknown/wrong-table aliases, missing INSERT grant and allocation collisions are rejected', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  unchangedOnReject(
    SQL,
    request(fixture, "INSERT INTO we_npc(f_name,f_relationships) VALUES('甲',?)", [
      [{ tableId: 'npc', rowId: '@new:8' }],
    ]),
    'DATA',
  );
  unchangedOnReject(
    SQL,
    request(
      fixture,
      "INSERT INTO we_environment(f_name) VALUES('宏观'); INSERT INTO we_npc(f_name,f_relationships) VALUES('甲',?)",
      [[{ tableId: 'npc', rowId: '@new:0' }]],
    ),
    'DATA',
  );
  const policy = createT3LocalPolicy(fixture.template, fixture.data);
  policy.insertTableIds = [];
  unchangedOnReject(SQL, request(fixture, "INSERT INTO we_npc(f_name) VALUES('甲')", [], { policy }), 'AUTHORIZATION');
  const first = executeT3Request(SQL, request(fixture, "INSERT INTO we_npc(f_name) VALUES('甲')"));
  unchangedOnReject(
    SQL,
    request({ template: fixture.template, data: first.data }, "INSERT INTO we_npc(f_name) VALUES('乙')"),
  );
  for (const [batch, index] of [
    ['bad batch', 0],
    ['constructor', 0],
    ['valid', -1],
    ['valid', 32],
  ] as const)
    assert.throws(() => allocateT3RowId(batch, index), T3EngineError);
});

test('T3 engine deleting a referenced row fails whole-graph validation without implicit cascade/clear', async () => {
  const SQL = await sqlReady;
  for (const onDelete of ['restrict', 'clear'] as const) {
    const fixture = createDefaultT2Fixture();
    fixture.template.tables
      .find(table => table.id === 'npc')!
      .fields.find(field => field.id === 'relationships')!.constraints.reference!.onDelete = onDelete;
    unchangedOnReject(SQL, request(fixture, "DELETE FROM we_npc WHERE __we_row_id='lin-merchant'"), 'DATA');
    const result = executeT3Request(
      SQL,
      request(
        fixture,
        "UPDATE we_npc SET f_relationships=? WHERE __we_row_id='lin-watch'; DELETE FROM we_npc WHERE __we_row_id='lin-merchant'",
        [[]],
      ),
    );
    assert.equal(result.data.tables.npc.length, 1);
    assert.deepEqual(result.data.tables.npc[0].values.relationships, []);
    assert.equal(result.statements[1].affectedRows, 1);
  }
});

test('T3 engine INSERT then targeted deletion of an unreferenced new row succeeds without persisting a phantom row', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const result = executeT3Request(
    SQL,
    request(fixture, "INSERT INTO we_npc(f_name) VALUES('临时角色'); DELETE FROM we_npc WHERE __we_row_id='@new:0'"),
  );
  assert.deepEqual(result.data, fixture.data);
  assert.deepEqual(
    result.statements.map(statement => statement.affectedRows),
    [1, 1],
  );
  assert.equal(result.changedRows.length, 1);
  unchangedOnReject(
    SQL,
    request(
      fixture,
      "INSERT INTO we_npc(f_name) VALUES('临时角色'); DELETE FROM we_npc WHERE __we_row_id='@new:0'; UPDATE we_npc SET f_goals='已删' WHERE __we_row_id='@new:0'",
    ),
  );
});

test('T3 engine mixed valid/invalid batches dispose the SQLite transaction and never expose partial results', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  let opened = 0;
  let closed = 0;
  class CountedDatabase extends SQL.Database {
    constructor() {
      super();
      opened += 1;
    }
    override close(): void {
      closed += 1;
      super.close();
    }
  }
  const instrumented = { ...SQL, Database: CountedDatabase } as SqlJsStatic;
  const error = unchangedOnReject(
    instrumented,
    request(
      fixture,
      "UPDATE we_npc SET f_goals='暂存合法' WHERE __we_row_id='lin-watch'; UPDATE we_npc SET f_status='非法枚举' WHERE __we_row_id='lin-merchant'",
    ),
    'DATA',
  );
  assert.equal(error.statementIndex, 1);
  assert.equal(error.fieldId, 'status');
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

test('T3 engine statement/affected/new/result budgets fail the complete batch; query rows are bounded', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  unchangedOnReject(
    SQL,
    request(fixture, 'SELECT f_name FROM we_npc; SELECT f_name FROM we_plan', [], { limits: { maxStatements: 1 } }),
    'LIMIT',
  );
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='x' WHERE __we_row_id IN ('lin-watch','lin-merchant')", [], {
      limits: { maxAffectedRows: 1 },
    }),
    'LIMIT',
  );
  unchangedOnReject(
    SQL,
    request(fixture, "INSERT INTO we_npc(f_name) VALUES('无新增额度')", [], { limits: { maxNewRows: 0 } }),
    'LIMIT',
  );
  unchangedOnReject(SQL, request(fixture, 'SELECT f_name FROM we_npc', [], { limits: { maxResultChars: 1 } }), 'LIMIT');
  const limited = executeT3Request(
    SQL,
    request(fixture, 'SELECT f_name FROM we_npc LIMIT 99', [], { limits: { maxQueryRows: 1 } }),
  );
  assert.equal(limited.queries[0].rows.length, 1);
  assert.equal(limited.queries[0].rows[0].rowId, 'lin-merchant');
  const empty = executeT3Request(
    SQL,
    request(fixture, 'SELECT f_name FROM we_npc', [], { limits: { maxQueryRows: 0 } }),
  );
  assert.deepEqual(empty.queries[0].rows, []);
  assert.deepEqual(empty.data, fixture.data);
});

test('T3 engine template hard limits and table-specific AI budgets cannot be expanded by a caller', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  fixture.template.hardLimits.maxRows = 1;
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='x' WHERE __we_row_id IN ('lin-watch','lin-merchant')", [], {
      limits: { maxAffectedRows: 10000 },
    }),
    'LIMIT',
  );
  fixture.template.hardLimits.maxRows = 100;
  const npc = fixture.template.tables.find(table => table.id === 'npc')!;
  // This test isolates budget rejection, rather than the separate AI-only field/default boundary.
  const editorNote = npc.fields.find(field => field.id === 'editor_note')!;
  editorNote.required = false;
  delete editorNote.defaultValue;
  npc.runtime.budget = { state: 'value', value: { maxRows: 1, maxNewRows: 0, maxRequests: 1, maxContextChars: 1000 } };
  const policy = aiPolicy(fixture, 'micro');
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='x' WHERE __we_row_id IN ('lin-watch','lin-merchant')", [], {
      policy,
      limits: { maxAffectedRows: 10000 },
    }),
    'LIMIT',
  );
  unchangedOnReject(SQL, request(fixture, "INSERT INTO we_npc(f_name) VALUES('无新增额度')", [], { policy }), 'LIMIT');
  npc.runtime.budget = { state: 'value', value: { maxRows: 0, maxNewRows: 0, maxRequests: 1, maxContextChars: 1000 } };
  unchangedOnReject(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals='零额度' WHERE __we_row_id='lin-watch'", [], {
      policy: aiPolicy(fixture, 'micro'),
    }),
    'LIMIT',
  );
});

test('T3 engine fixed logs replay the same base to identical data and controlled IDs at a different clock time', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const input = request(
    fixture,
    "INSERT INTO we_npc(f_name) VALUES(?); UPDATE we_npc SET f_goals=? WHERE __we_row_id='@new:0'; SELECT f_name,f_goals FROM we_npc WHERE __we_row_id='@new:0'",
    ['重放角色', '固定行动'],
  );
  const result = executeT3Request(SQL, input);
  const originalNow = Date.now;
  let replay;
  try {
    Date.now = () => 9_000_000_000_000;
    replay = replayT3Log(SQL, fixture.template, fixture.data, result.log, input.policy);
  } finally {
    Date.now = originalNow;
  }
  assert.deepEqual(replay.data, result.data);
  assert.deepEqual(replay.allocations, result.allocations);
  assert.deepEqual(replay.changedRows, result.changedRows);
  assert.deepEqual(replay.log, result.log);
  assert.equal(replay.data.revision, fixture.data.revision);
  assert.throws(
    () => replayT3Log(SQL, fixture.template, fixture.data, { ...result.log, templateVersion: 99 }, input.policy),
    T3EngineError,
  );
});

test('T3 engine and replay do not contact host chat, worldbook, storage or network APIs', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const names = [
    'fetch',
    'getVariables',
    'replaceVariables',
    'getChatMessages',
    'setChatMessages',
    'getWorldbook',
    'replaceWorldbook',
    'localStorage',
    'indexedDB',
  ];
  const original = names.map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) }));
  try {
    for (const name of names)
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => {
          throw new Error(`Forbidden host access: ${name}`);
        },
      });
    const input = request(fixture, "UPDATE we_npc SET f_goals='本地演算' WHERE __we_row_id='traveler'");
    const first = executeT3Request(SQL, input);
    const replay = replayT3Log(SQL, fixture.template, fixture.data, first.log, input.policy);
    assert.deepEqual(first.data, replay.data);
  } finally {
    for (const { name, descriptor } of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test('T3 engine local-policy helper rejects inconsistent identities and never supplies secrets as AI read grants', () => {
  const fixture = createDefaultT2Fixture();
  const policy = aiPolicy(fixture, 'micro');
  assert.equal(policy.read.find(grant => grant.tableId === 'npc')!.fieldIds.includes('editor_note'), false);
  assert.equal(
    policy.write.some(grant => grant.tableId === 'environment'),
    false,
  );
  assert.equal(
    policy.read.some(grant => grant.tableId === 'environment'),
    true,
  );
  assert.throws(() => createT3LocalPolicy(fixture.template, fixture.data, 'ai', null), T3EngineError);
  assert.throws(() => createT3LocalPolicy(fixture.template, fixture.data, 'manual', 'macro'), T3EngineError);
  assert.throws(() => createT3LocalPolicy(fixture.template, fixture.data, 'unknown' as 'ai', 'macro'), T3EngineError);
});

test('T3 engine INSERT defaults obey frozen field grants and readonly/write permissions for every actor', async () => {
  const SQL = await sqlReady;
  for (const actor of ['manual', 'ai'] as const) {
    for (const boundary of ['grant', 'readonly', 'permission'] as const) {
      const fixture = createMinimalT2Fixture();
      const npc = fixture.template.tables.find(table => table.id === 'npc')!;
      const editorNote = npc.fields.find(field => field.id === 'editor_note')!;
      editorNote.required = false;
      delete editorNote.defaultValue;
      const goals = npc.fields.find(field => field.id === 'goals')!;
      goals.defaultValue = '默认也属于业务写入';
      if (boundary === 'readonly') {
        goals.readonly = true;
        goals.permissions = { manualWrite: false, aiWrite: false };
      }
      if (boundary === 'permission') goals.permissions[actor === 'manual' ? 'manualWrite' : 'aiWrite'] = false;
      const policy = createT3LocalPolicy(fixture.template, fixture.data, actor, actor === 'ai' ? 'micro' : null);
      const grant = policy.write.find(item => item.tableId === 'npc')!;
      if (boundary === 'grant') grant.fieldIds = grant.fieldIds.filter(id => id !== 'goals');
      else if (!grant.fieldIds.includes('goals')) grant.fieldIds.push('goals');
      unchangedOnReject(
        SQL,
        request(fixture, "INSERT INTO we_npc(f_name) VALUES('默认越权角色')", [], { policy }),
        'AUTHORIZATION',
      );
    }
  }
});

test('T3 engine materializes static INSERT defaults in a fixed replay log, without mutating grants or parameters', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const npc = fixture.template.tables.find(table => table.id === 'npc')!;
  npc.fields.find(field => field.id === 'goals')!.defaultValue = '原始默认目标';
  const input = request(fixture, 'INSERT INTO we_npc(f_name) VALUES(?)', ['回放新增']);
  const before = JSON.stringify(input);
  const first = executeT3Request(SQL, input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(first.statements[0].fieldIds.includes('goals'), true);
  assert.equal(first.log.sql.includes('"f_goals"'), true);
  assert.equal(first.log.parameters.includes('原始默认目标'), true);
  npc.fields.find(field => field.id === 'goals')!.defaultValue = '后续修改的模板默认';
  const replayInput = JSON.stringify([fixture.template, fixture.data, first.log, input.policy]);
  const replay = replayT3Log(SQL, fixture.template, fixture.data, first.log, input.policy);
  assert.deepEqual(replay.data, first.data);
  assert.deepEqual(replay.allocations, first.allocations);
  assert.deepEqual(replay.log, first.log);
  assert.equal(JSON.stringify([fixture.template, fixture.data, first.log, input.policy]), replayInput);
});

test('T3 engine DELETE authorizes every actual-present business field, including caller-forged readonly grants', async () => {
  const SQL = await sqlReady;
  for (const actor of ['manual', 'ai'] as const) {
    for (const boundary of ['grant', 'readonly', 'permission'] as const) {
      const fixture = createMinimalT2Fixture();
      const npc = fixture.template.tables.find(table => table.id === 'npc')!;
      const goals = npc.fields.find(field => field.id === 'goals')!;
      // Keep this test independent of the user-only editor_note permission.
      npc.fields.find(field => field.id === 'editor_note')!.required = false;
      delete fixture.data.tables.npc[0].values.editor_note;
      if (boundary === 'readonly') {
        goals.readonly = true;
        goals.permissions = { manualWrite: false, aiWrite: false };
      }
      if (boundary === 'permission') goals.permissions[actor === 'manual' ? 'manualWrite' : 'aiWrite'] = false;
      const policy = createT3LocalPolicy(fixture.template, fixture.data, actor, actor === 'ai' ? 'micro' : null);
      const grant = policy.write.find(item => item.tableId === 'npc')!;
      if (boundary === 'grant') grant.fieldIds = grant.fieldIds.filter(id => id !== 'goals');
      else if (!grant.fieldIds.includes('goals')) grant.fieldIds.push('goals');
      unchangedOnReject(
        SQL,
        request(fixture, "DELETE FROM we_npc WHERE __we_row_id='traveler'", [], { policy }),
        'AUTHORIZATION',
      );
    }
  }
});

test('T3 engine DELETE does not demand an absent readonly optional field but audits actual removed fields', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const npc = fixture.template.tables.find(table => table.id === 'npc')!;
  const optional = {
    ...npc.fields.find(field => field.id === 'goals')!,
    id: 'untouched',
    sqlName: 'f_untouched',
    readonly: true,
    required: false,
    permissions: { manualWrite: false, aiWrite: false },
  };
  delete optional.defaultValue;
  npc.fields.push(optional);
  const result = executeT3Request(SQL, request(fixture, "DELETE FROM we_npc WHERE __we_row_id='traveler'"));
  assert.equal(result.data.tables.npc.length, 0);
  assert.equal(result.statements[0].fieldIds.includes('goals'), true);
  assert.equal(result.statements[0].fieldIds.includes('untouched'), false);
});

test('T3 engine SELECT LIMIT applies after deletions instead of truncating stale frozen candidate IDs', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const input = request(
    fixture,
    "UPDATE we_npc SET f_relationships=? WHERE __we_row_id='lin-watch'; DELETE FROM we_npc WHERE __we_row_id='lin-merchant'; SELECT f_name FROM we_npc LIMIT 1",
    [[]],
  );
  const result = executeT3Request(SQL, input);
  assert.deepEqual(result.queries[0].rows, [{ rowId: 'lin-watch', values: { name: '林澄' } }]);
  assert.deepEqual(replayT3Log(SQL, fixture.template, fixture.data, result.log, input.policy).queries, result.queries);
});

test('T3 engine malformed UTF-16 and NUL text UPDATE rejects the complete batch with the exact field identity', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  for (const text of ['中\u0000文', '\ud800', '\udfff', '正常\ud800后缀']) {
    const error = unchangedOnReject(
      SQL,
      request(
        fixture,
        "UPDATE we_npc SET f_knowledge='合法暂存' WHERE __we_row_id='traveler'; UPDATE we_npc SET f_goals=? WHERE __we_row_id='traveler'",
        [text],
      ),
      'DATA',
    );
    assert.equal(error.statementIndex, 1);
    assert.equal(error.fieldId, 'goals');
  }
  const valid = executeT3Request(
    SQL,
    request(fixture, "UPDATE we_npc SET f_goals=? WHERE __we_row_id='traveler'", ['正常中文与😀']),
  );
  assert.equal(valid.data.tables.npc[0].values.goals, '正常中文与😀');
});

test('T3 engine rejects canonical replay text overflow caused by materialized defaults before committing', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const npc = fixture.template.tables.find(table => table.id === 'npc')!;
  const source = npc.fields.find(field => field.id === 'goals')!;
  for (let index = 0; index < 170; index += 1) {
    const id = `extra_${index}`;
    npc.fields.push({ ...source, id, sqlName: `f_${id.padEnd(61, 'x')}`, required: false, defaultValue: '' });
  }
  fixture.template = normalizeT2Template(fixture.template);
  const error = unchangedOnReject(
    SQL,
    request(fixture, "INSERT INTO we_npc(f_name) VALUES('一'); INSERT INTO we_npc(f_name) VALUES('二')"),
    'LIMIT',
  );
  assert.match(error.message, /固定日志.*文本长度超限/);
});

test('T3 engine rejects canonical replay token overflow even when original SQL and replay text are short', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const npc = fixture.template.tables.find(table => table.id === 'npc')!;
  const source = npc.fields.find(field => field.id === 'goals')!;
  for (let index = 0; index < 150; index += 1) {
    const id = `x${index}`;
    npc.fields.push({ ...source, id, sqlName: `f_${id}`, required: false, defaultValue: '' });
  }
  fixture.template = normalizeT2Template(fixture.template);
  const sql = Array.from({ length: 8 }, (_, index) => `INSERT INTO we_npc(f_name) VALUES('新增${index}')`).join(';');
  const error = unchangedOnReject(SQL, request(fixture, sql), 'LIMIT');
  assert.match(error.message, /固定日志.*token 数量超限/);
});

test('T3 engine captures a real SQLite ROLLBACK restoring data before close and closes success databases too', async () => {
  const SQL = await sqlReady;
  const fixture = createMinimalT2Fixture();
  const events: string[] = [];
  const closedGoals: unknown[] = [];
  class InstrumentedDatabase extends SQL.Database {
    override run(sql: string, parameters?: BindParams): Database {
      const result = super.run(sql, parameters);
      if (sql === 'BEGIN IMMEDIATE' || sql === 'ROLLBACK' || (sql === 'COMMIT' && events.includes('BEGIN IMMEDIATE')))
        events.push(sql);
      return result;
    }
    override close(): void {
      closedGoals.push(this.exec("SELECT f_goals FROM we_npc WHERE __we_row_id='traveler'")[0].values[0][0]);
      events.push('CLOSE');
      super.close();
    }
  }
  const instrumented = { ...SQL, Database: InstrumentedDatabase } as SqlJsStatic;
  unchangedOnReject(
    instrumented,
    request(
      fixture,
      "UPDATE we_npc SET f_goals='暂时改变' WHERE __we_row_id='traveler'; UPDATE we_npc SET f_status='不存在' WHERE __we_row_id='traveler'",
    ),
    'DATA',
  );
  assert.deepEqual(events, ['BEGIN IMMEDIATE', 'ROLLBACK', 'CLOSE']);
  assert.deepEqual(closedGoals, [fixture.data.tables.npc[0].values.goals]);
  events.length = 0;
  const accepted = executeT3Request(
    instrumented,
    request(fixture, "UPDATE we_npc SET f_goals='合法改变' WHERE __we_row_id='traveler'"),
  );
  assert.deepEqual(events, ['BEGIN IMMEDIATE', 'COMMIT', 'CLOSE']);
  assert.equal(closedGoals.at(-1), '合法改变');
  assert.equal(accepted.data.tables.npc[0].values.goals, '合法改变');
});

test('T3 engine default NPC AI INSERT succeeds without inventing or allowing the user-only editor note', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const policy = aiPolicy(fixture, 'micro');
  const result = executeT3Request(
    SQL,
    request(fixture, "INSERT INTO we_npc(f_name) VALUES('新增NPC')", [], { policy }),
  );
  const added = result.data.tables.npc.at(-1)!;
  assert.equal(added.values.name, '新增NPC');
  assert.equal(Object.hasOwn(added.values, 'editor_note'), false);
  assert.equal(result.statements[0].fieldIds.includes('editor_note'), false);
  assert.equal(result.log.sql.includes('"f_editor_note"'), false);
  assert.equal(result.data.tables.npc[0].values.editor_note, fixture.data.tables.npc[0].values.editor_note);
  unchangedOnReject(
    SQL,
    request(fixture, "INSERT INTO we_npc(f_name,f_editor_note) VALUES('新增NPC','偷写用户备注')", [], { policy }),
    'AUTHORIZATION',
  );
  policy.write.find(grant => grant.tableId === 'npc')!.fieldIds.push('editor_note');
  unchangedOnReject(
    SQL,
    request(fixture, "INSERT INTO we_npc(f_name,f_editor_note) VALUES('新增NPC','伪造授权')", [], { policy }),
    'AUTHORIZATION',
  );
});

test('T3 engine single/list reference reads cannot disclose excluded or invisible target identities', async () => {
  const SQL = await sqlReady;
  for (const actor of ['manual', 'ai'] as const) {
    for (const reference of [
      { field: 'location', table: 'location', row: 'north-gate' },
      { field: 'organizations', table: 'organization', row: 'watch' },
    ]) {
      for (const boundary of ['target-grant', 'table-grant', 'row-visibility', 'table-visibility'] as const) {
        const fixture = createDefaultT2Fixture();
        const policy = createT3LocalPolicy(fixture.template, fixture.data, actor, actor === 'ai' ? 'micro' : null);
        const audience = actor === 'manual' ? 'user' : 'evolutionAi';
        const sql = `SELECT f_${reference.field} FROM we_npc WHERE __we_row_id='lin-watch'`;
        const baseline = executeT3Request(SQL, request(fixture, sql, [], { policy }));
        assert.deepEqual(
          baseline.queries[0].rows[0].values[reference.field],
          fixture.data.tables.npc[0].values[reference.field],
        );
        if (boundary === 'target-grant') {
          const grant = policy.read.find(item => item.tableId === reference.table)!;
          grant.rowIds = grant.rowIds.filter(id => id !== reference.row);
        }
        if (boundary === 'table-grant') policy.read = policy.read.filter(item => item.tableId !== reference.table);
        if (boundary === 'row-visibility')
          fixture.data.tables[reference.table].find(row => row.meta.id === reference.row)!.meta.visibility[audience] =
            false;
        if (boundary === 'table-visibility')
          fixture.template.tables.find(table => table.id === reference.table)!.visibility[audience] = false;
        const error = unchangedOnReject(SQL, request(fixture, sql, [], { policy }), 'AUTHORIZATION');
        assert.equal(error.statementIndex, 0);
        assert.equal(error.fieldId, reference.field);
        assert.equal(error.tableId, 'npc');
      }
    }
  }
});

test('T3 engine NULL and empty reference lists do not require grants to hypothetical targets', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  fixture.data.tables.npc[0].values.location = null;
  fixture.data.tables.npc[0].values.organizations = [];
  const policy = aiPolicy(fixture, 'micro');
  policy.read = policy.read.filter(grant => grant.tableId !== 'location' && grant.tableId !== 'organization');
  const result = executeT3Request(
    SQL,
    request(fixture, "SELECT f_location,f_organizations FROM we_npc WHERE __we_row_id='lin-watch'", [], { policy }),
  );
  assert.deepEqual(result.queries[0].rows[0].values, { location: null, organizations: [] });
  assert.deepEqual(result.data, fixture.data);
});

test('T3 engine whole-graph reference failure is attributed to validation, not the last unrelated SQL statement', async () => {
  const SQL = await sqlReady;
  const fixture = createDefaultT2Fixture();
  const error = unchangedOnReject(
    SQL,
    request(fixture, "DELETE FROM we_npc WHERE __we_row_id='lin-merchant'; SELECT f_name FROM we_environment"),
    'DATA',
  );
  assert.equal(error.statementIndex, undefined);
  assert.equal(error.tableId, undefined, 'Whole-world validation must not guess the last SQL table as the cause.');
});
