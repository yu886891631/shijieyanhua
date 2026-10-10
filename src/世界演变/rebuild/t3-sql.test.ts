import assert from 'node:assert/strict';
import test from 'node:test';
import { countT3Parameters, parseT3Sql, T3_SQL_LIMITS, T3SqlError } from './t3-sql';

test('T3 SQL: SELECT has explicit columns, row targets, stable order and bounded LIMIT', () => {
  assert.deepEqual(
    parseT3Sql(
      "SELECT __we_row_id, F_Name FROM WE_NPC WHERE __we_row_id IN (?, 'lin-watch') ORDER BY __we_row_id ASC LIMIT 10;",
    ),
    [
      {
        kind: 'select',
        table: 'we_npc',
        columns: ['__we_row_id', 'f_name'],
        targets: [
          { kind: 'parameter', index: 0 },
          { kind: 'literal', value: 'lin-watch' },
        ],
        orderBy: '__we_row_id-asc',
        limit: 10,
      },
    ],
  );
  assert.deepEqual(parseT3Sql('select f_name from we_npc limit 0'), [
    { kind: 'select', table: 'we_npc', columns: ['f_name'], limit: 0 },
  ]);
  assert.equal(parseT3Sql('select f_name from we_npc order by __we_row_id')[0].kind, 'select');
});

test('T3 SQL: INSERT scalar values preserve empty, NULL, false, zero and quote data', () => {
  assert.deepEqual(
    parseT3Sql(
      "INSERT INTO we_npc (f_name, f_location, f_active, f_score, f_note) VALUES ('林澄', NULL, false, 0, 'O''Brien; -- /*不是注释*/');",
    ),
    [
      {
        kind: 'insert',
        table: 'we_npc',
        columns: ['f_name', 'f_location', 'f_active', 'f_score', 'f_note'],
        values: [
          { kind: 'literal', value: '林澄' },
          { kind: 'literal', value: null },
          { kind: 'literal', value: false },
          { kind: 'literal', value: 0 },
          { kind: 'literal', value: "O'Brien; -- /*不是注释*/" },
        ],
      },
    ],
  );
  const statement = parseT3Sql("insert into we_npc (f_name) values ('')")[0];
  assert.equal(statement.kind, 'insert');
  if (statement.kind === 'insert') assert.deepEqual(statement.values[0], { kind: 'literal', value: '' });
});

test('T3 SQL: UPDATE and DELETE require explicit row identities', () => {
  assert.deepEqual(
    parseT3Sql(
      "UPDATE we_npc SET f_name = ?, f_note = '城门' WHERE __we_row_id = ?; DELETE FROM we_plan WHERE __we_row_id IN ('one', ?);",
    ),
    [
      {
        kind: 'update',
        table: 'we_npc',
        assignments: [
          { column: 'f_name', value: { kind: 'parameter', index: 0 } },
          { column: 'f_note', value: { kind: 'literal', value: '城门' } },
        ],
        targets: [{ kind: 'parameter', index: 1 }],
      },
      {
        kind: 'delete',
        table: 'we_plan',
        targets: [
          { kind: 'literal', value: 'one' },
          { kind: 'parameter', index: 2 },
        ],
      },
    ],
  );
});

test('T3 SQL: parameters are indexed across the complete batch, not inside literal strings', () => {
  const ast = parseT3Sql(
    "insert into we_npc(f_name) values('?'); insert into we_npc(f_name) values(?); select f_name from we_npc where __we_row_id = ?;",
  );
  assert.equal(countT3Parameters(ast), 2);
  assert.equal(countT3Parameters(parseT3Sql('select f_name from we_npc')), 0);
});

test('T3 SQL: token-aware comments do not expose semicolons or fake statements', () => {
  const ast = parseT3Sql(
    '-- DELETE FROM we_npc;\n/* DROP TABLE foo; */ ;select /* x */ f_name from we_npc; -- bad ? ;\n ;',
  );
  assert.deepEqual(ast, [{ kind: 'select', table: 'we_npc', columns: ['f_name'] }]);
  assert.deepEqual(parseT3Sql('select f_name from we_npc-- end of statement'), ast);
});

test('T3 SQL: canonical double-quoted identifiers work without changing stable names', () => {
  assert.deepEqual(parseT3Sql('SELECT "f_name" FROM "we_npc" WHERE "__we_row_id" = \'one\''), [
    { kind: 'select', table: 'we_npc', columns: ['f_name'], targets: [{ kind: 'literal', value: 'one' }] },
  ]);
  for (const identifier of ['WE_NPC', '表格', 'we-npc', 'we_npc;drop', 'we.npc', 'we"npc', '']) {
    assert.throws(() => parseT3Sql(`select f_name from "${identifier.replaceAll('"', '""')}"`), T3SqlError);
  }
});

const forbiddenSql = [
  "update we_npc set f_name = 'x'",
  'delete from we_npc',
  "update we_npc set f_name = 'x' where 1 = 1",
  "delete from we_npc where __we_row_id = 'one' OR 1 = 1",
  "delete from we_npc where __we_row_id <> 'one'",
  "update we_npc set f_name = 'x' where __we_row_id = 'one' AND true",
  'select * from we_npc',
  'select count(f_name) from we_npc',
  'select random() from we_npc',
  'select current_timestamp from we_npc',
  "update we_npc set f_name = datetime('now') where __we_row_id = 'one'",
  "update we_npc set f_name = f_secret where __we_row_id = 'one'",
  "update we_npc set f_score = 1 + 1 where __we_row_id = 'one'",
  "update we_npc set f_name = (select f_secret from we_npc) where __we_row_id = 'one'",
  'with x as (select f_name from we_npc) select f_name from x',
  'select f_name from we_npc join we_plan on true',
  'select f_name from we_npc, we_plan',
  'select f_name from main.we_npc',
  'select f_name from we_npc union select f_name from we_plan',
  'select f_name as other from we_npc',
  'select distinct f_name from we_npc',
  "select f_name from we_npc where f_name = '林澄'",
  'select f_name from we_npc where __we_row_id in ()',
  'select f_name from we_npc order by f_name asc',
  'select f_name from we_npc order by __we_row_id desc',
  'select f_name from we_npc limit ? ',
  'select f_name from we_npc limit 1 offset 1',
  'select f_name from we_npc limit -1',
  'select f_name from we_npc limit 1.5',
  'select f_name from we_npc limit 1.0',
  'select f_name from we_npc limit 1 order by __we_row_id',
  "insert or replace into we_npc (f_name) values ('one')",
  'insert into we_npc(f_name) select f_name from we_npc',
  "insert into we_npc(f_name) values ('one'), ('two')",
  "insert into we_npc(f_name) values ('one') returning f_name",
  "insert into we_npc(__we_row_id) values ('one')",
  "update we_npc set __we_locked = false where __we_row_id = 'one'",
  'insert into we_npc(f_name) values (?) on conflict do nothing',
  'create table we_npc(f_name text)',
  'drop table we_npc',
  'alter table we_npc add column f_secret text',
  'pragma writable_schema = 1',
  "attach database 'other.sqlite' as evil",
  'begin; select f_name from we_npc; commit',
  'vacuum',
  'explain select f_name from we_npc',
  "select load_extension('x') from we_npc",
];

test('T3 SQL: unsupported SQL fails closed before any execution', () => {
  for (const sql of forbiddenSql) assert.throws(() => parseT3Sql(sql), T3SqlError, sql);
});

test('T3 SQL: duplicate columns and assignments are rejected after case normalization', () => {
  for (const sql of [
    'select f_name, F_NAME from we_npc',
    "insert into we_npc (f_name, f_name) values ('one', 'two')",
    "update we_npc set f_name = 'one', F_NAME = 'two' where __we_row_id = 'one'",
    "insert into we_npc (f_name, f_score) values ('one')",
    "insert into we_npc (f_name) values ('one', 1)",
  ])
    assert.throws(() => parseT3Sql(sql), T3SqlError);
});

test('T3 SQL: non-positional parameters and expressions are not accepted as data', () => {
  for (const value of [
    ':name',
    '@name',
    '$name',
    '?1',
    '1e3',
    '0x01',
    "x'cafe'",
    '+1',
    '.5',
    '1.',
    'NaN',
    'Infinity',
    '01',
    'DEFAULT',
    'CURRENT_DATE',
    'CURRENT_TIME',
  ]) {
    assert.throws(() => parseT3Sql(`insert into we_npc(f_score) values(${value})`), T3SqlError, value);
  }
});

test('T3 SQL: numbers preserve canonical finite values and reject silent rounding', () => {
  for (const [sqlNumber, expected] of [
    ['-9007199254740991', Number.MIN_SAFE_INTEGER],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ['0.1', 0.1],
    ['0.0000001', 1e-7],
    ['-12.30', -12.3],
    ['1.000', 1],
  ] as const) {
    const ast = parseT3Sql(`insert into we_npc(f_score) values(${sqlNumber})`)[0];
    assert.equal(ast.kind, 'insert');
    if (ast.kind === 'insert') assert.deepEqual(ast.values[0], { kind: 'literal', value: expected });
  }
  for (const sqlNumber of [
    '9007199254740992',
    '-9007199254740992',
    '-0',
    '-0.000',
    '1.0000000000000000001',
    '0.100000000000000000001',
    `0.${'0'.repeat(129)}1`,
  ]) {
    assert.throws(() => parseT3Sql(`insert into we_npc(f_score) values(${sqlNumber})`), T3SqlError, sqlNumber);
  }
});

test('T3 SQL: unterminated, NUL, wrappers and trailing syntax have precise parse errors', () => {
  for (const sql of [
    '',
    ' ; ; ',
    '/* empty */',
    '/* never closed',
    "select f_name from we_npc where __we_row_id = 'unterminated",
    'select "f_name from we_npc',
    'select f_name from we_npc\0',
    '```sql\nselect f_name from we_npc\n```',
    'select f_name from we_npc select f_name from we_npc',
    'select f_name from we_npc; DROP TABLE we_npc',
  ]) {
    assert.throws(
      () => parseT3Sql(sql),
      error => error instanceof T3SqlError && Number.isSafeInteger(error.position),
      sql,
    );
  }
  assert.throws(() => parseT3Sql(undefined as unknown as string), T3SqlError);
});

test('T3 SQL: strings containing attack text remain ordinary scalar data', () => {
  const attack = "one'); DELETE FROM we_npc; --";
  const escaped = attack.replaceAll("'", "''");
  const statement = parseT3Sql(`insert into we_npc(f_name) values('${escaped}')`)[0];
  assert.equal(statement.kind, 'insert');
  if (statement.kind === 'insert') assert.deepEqual(statement.values, [{ kind: 'literal', value: attack }]);
});

test('T3 SQL: all batch/target/column/token/text bounds are enforced', () => {
  const single = 'select f_name from we_npc;';
  assert.equal(parseT3Sql(single.repeat(T3_SQL_LIMITS.maxStatements)).length, T3_SQL_LIMITS.maxStatements);
  assert.throws(() => parseT3Sql(single.repeat(T3_SQL_LIMITS.maxStatements + 1)), /语句数量/);
  const targets = Array.from({ length: 100 }, (_, index) => `'row-${index}'`).join(',');
  const statement = parseT3Sql(`delete from we_npc where __we_row_id in (${targets})`)[0];
  assert.equal(statement.kind, 'delete');
  if (statement.kind === 'delete') assert.equal(statement.targets.length, 100);
  assert.throws(() => parseT3Sql(`delete from we_npc where __we_row_id in (${targets}, 'extra')`), /目标记录数量/);
  const columns = Array.from({ length: 256 }, (_, index) => `f_${index}`).join(',');
  assert.equal(parseT3Sql(`select ${columns} from we_npc`)[0].kind, 'select');
  assert.throws(() => parseT3Sql(`select ${columns}, f_extra from we_npc`), /列数量/);
  assert.throws(() => parseT3Sql(';'.repeat(4001)), /token 数量/);
  assert.throws(() => parseT3Sql(' '.repeat(20_001)), /文本长度/);
  assert.throws(() => parseT3Sql(`select ${'f'.repeat(65)} from we_npc`), /标识符/);
});

test('T3 SQL: parser is deterministic and has no host or SQLite side effects', () => {
  const sql =
    "insert into we_npc(f_name) values ('<script>只是数据</script>'); select f_name from we_npc where __we_row_id = ?";
  const first = parseT3Sql(sql);
  const second = parseT3Sql(sql);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  const insert = first[0];
  if (insert.kind === 'insert') insert.columns[0] = 'changed';
  assert.notDeepEqual(first, second);
});
