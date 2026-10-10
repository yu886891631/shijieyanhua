import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import {
  createCustomT2Fixture,
  createDefaultT2Fixture,
  createMinimalT2Fixture,
  createMinimalT2Template,
} from './t2-defaults';
import {
  normalizeT2Template,
  T2_SYSTEM_SQL_COLUMNS,
  type T2Field,
  type T2Template,
  type T2WorldData,
} from './t2-template';
import { createT2EmptyWorld, normalizeT2WorldData, prepareT2NewRow } from './t2-values';
import {
  assertT3Schema,
  assertT3SqlValue,
  createT3Database,
  exportT3World,
  insertT3Row,
  quoteT3Identifier,
} from './t3-schema';

const sqlReady = initSqlJs({
  wasmBinary: new Uint8Array(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});

async function withFixture(
  run: (db: Database, template: T2Template, data: T2WorldData) => void,
  factory = createCustomT2Fixture,
): Promise<void> {
  const SQL = await sqlReady;
  const { template, data } = factory();
  const db = createT3Database(SQL, template, data);
  try {
    run(db, template, data);
  } finally {
    db.close();
  }
}

function testField(type: T2Field['type'], overrides: Partial<T2Field> = {}): T2Field {
  const controls: Record<T2Field['type'], T2Field['control']> = {
    text: 'single-line',
    integer: 'integer',
    number: 'number',
    decimal: 'decimal',
    boolean: 'toggle',
    enum: 'select',
    'string-list': 'string-list',
    reference: 'reference',
    'reference-list': 'reference-list',
    'world-time': 'world-time',
  };
  return {
    id: type.replace('-', '_'),
    sqlName: `f_${type.replace('-', '_')}`,
    name: '测试字段',
    description: '固定字段类型往返样例',
    type,
    required: false,
    nullable: true,
    readonly: false,
    hiddenUi: false,
    permissions: { manualWrite: true, aiWrite: true },
    visibility: { user: true, evolutionAi: true, mainAi: true },
    constraints: {},
    control: controls[type],
    ...overrides,
  };
}

function allTypeFixture(): { template: T2Template; data: T2WorldData } {
  const raw = createMinimalT2Template();
  const environment = raw.tables.find(table => table.id === 'environment')!;
  const npc = raw.tables.find(table => table.id === 'npc')!;
  environment.fields = [
    testField('text', { required: true, nullable: false }),
    testField('integer', { constraints: { min: -10, max: 10 } }),
    testField('number'),
    testField('decimal', { constraints: { precision: 15, scale: 2 } }),
    testField('boolean'),
    testField('enum', { constraints: { enumValues: ["引号'；--不是指令", '甲'] } }),
    testField('string-list'),
    testField('reference', { constraints: { reference: { tableIds: ['npc'], onDelete: 'restrict' } } }),
    testField('reference-list', { constraints: { reference: { tableIds: ['npc'], onDelete: 'clear' } } }),
    testField('world-time', { constraints: { calendarId: raw.calendars[0].id } }),
    testField('text', {
      id: 'optional_nonnullable',
      sqlName: 'f_optional_nonnullable',
      nullable: false,
      defaultValue: '不覆盖',
    }),
  ];
  environment.context.fieldIds = [];
  environment.export.fieldIds = [];
  environment.export.titleFieldId = null;
  environment.export.keyFieldIds = [];
  npc.context.relatedTableIds = [];
  const template = normalizeT2Template(raw);
  const data = createT2EmptyWorld(template, 'test-world', 'test-branch');
  data.revision = 1;
  const npcRow = prepareT2NewRow(template, 'npc', 'target', { name: '同名角色' }, { revision: 1 });
  data.tables.npc.push(npcRow);
  data.tables.environment.push({
    meta: { ...npcRow.meta, id: 'all-values', locked: true, lockedFieldIds: ['integer'], archived: true },
    values: {
      text: '',
      integer: 0,
      number: 0.1,
      decimal: '9999999999999.99',
      boolean: false,
      enum: "引号'；--不是指令",
      string_list: [],
      reference: { tableId: 'npc', rowId: 'target' },
      reference_list: [{ tableId: 'npc', rowId: 'target' }],
      world_time: { calendarId: raw.calendars[0].id, ordinalMinute: -1, display: '此前一分钟' },
    },
  });
  data.tables.environment.push({
    meta: { ...npcRow.meta, id: 'null-values' },
    values: { text: '第二行', integer: null },
  });
  return { template, data: normalizeT2WorldData(template, data) };
}

for (const [name, factory] of [
  ['默认七表', createDefaultT2Fixture],
  ['最小双表', createMinimalT2Fixture],
  ['自定义第八表', createCustomT2Fixture],
  ['全部十种字段', allTypeFixture],
] as const)
  test(`T3 ${name}真实SQLite往返保留完整JSON、元数据和顺序`, async () => {
    await withFixture((db, template, data) => {
      assert.deepEqual(exportT3World(db, template, data), data);
      assert.deepEqual(exportT3World(db, template, data), data);
      assertT3Schema(db, template);
      assert.equal(db.exec('SELECT sqlite_version()')[0].values.length, 1);
    }, factory);
  });

test('T3 未填写、NULL、空串、false、零、空数组各自保留；恢复不应用默认', async () => {
  await withFixture((db, template, data) => {
    const recovered = exportT3World(db, template, data);
    assert.equal(recovered.tables.environment[0].values.text, '');
    assert.equal(recovered.tables.environment[0].values.integer, 0);
    assert.equal(recovered.tables.environment[0].values.boolean, false);
    assert.deepEqual(recovered.tables.environment[0].values.string_list, []);
    assert.equal(recovered.tables.environment[1].values.integer, null);
    assert.equal(Object.hasOwn(recovered.tables.environment[1].values, 'boolean'), false);
    assert.equal(Object.hasOwn(recovered.tables.environment[0].values, 'optional_nonnullable'), false);
    const presence = db.exec('SELECT "__we_presence" FROM "we_environment" ORDER BY rowid')[0].values;
    assert.deepEqual(JSON.parse(presence[1][0] as string), ['text', 'integer']);
  }, allTypeFixture);
});

test('T3 SQLite使用真实STRICT表和九个受保护系统列', async () => {
  await withFixture((db, template) => {
    const list = db.exec('PRAGMA table_list')[0];
    for (const table of template.tables) {
      assert.equal(list.values.find(row => row[1] === table.sqlName)![5], 1);
      const columns = db.exec(`PRAGMA table_info("${table.sqlName}")`)[0].values.map(row => row[1]);
      assert.deepEqual(columns.slice(0, 9), [...T2_SYSTEM_SQL_COLUMNS]);
    }
    assert.throws(() => db.run('UPDATE "we_market" SET "f_open" = 2'), /CHECK/);
    assert.throws(() => db.run('UPDATE "we_market" SET "f_unit_price" = 0.125'), /INTEGER/);
    assert.throws(() => db.run('UPDATE "we_market" SET "f_name" = NULL'), /NOT NULL/);
    assert.throws(() => db.run('UPDATE "we_market" SET "f_open" = ?', [new Uint8Array([0])]), /INTEGER/);
    assert.throws(() => db.run('UPDATE "we_market" SET "__we_row_id" = NULL'), /NOT NULL/);
  });
});

test('T3 行主键重复、非法ID和修订版本被SQLite约束拒绝', async () => {
  await withFixture((db, template, data) => {
    const table = template.tables.find(item => item.id === 'market')!;
    assert.throws(() => insertT3Row(db, table, data.tables.market[0]), /UNIQUE/);
    for (const id of ['Bad', '', 'constructor', 'a'.repeat(65), 'sql;drop'])
      assert.throws(() => db.run('UPDATE "we_market" SET "__we_row_id" = ?', [id]), /CHECK/);
    assert.throws(() => db.run('UPDATE "we_market" SET "__we_created_revision" = -1'), /CHECK/);
    assert.throws(() => db.run('UPDATE "we_market" SET "__we_updated_revision" = 0'), /CHECK/);
  });
});

test('T3 范围、精确小数精度、枚举和复合JSON形状受物理约束保护', async () => {
  await withFixture(db => {
    assert.throws(() => db.run('UPDATE "we_environment" SET "f_integer" = 11'), /CHECK/);
    assert.throws(() => db.run('UPDATE "we_environment" SET "f_number" = 1e100'), /CHECK/);
    assert.throws(() => db.run('UPDATE "we_environment" SET "f_decimal" = 1000000000000000'), /CHECK/);
    assert.throws(() => db.run('UPDATE "we_environment" SET "f_enum" = ?', ['乙']), /CHECK/);
    assert.throws(() => db.run('UPDATE "we_environment" SET "f_string_list" = ?', ['{']), /JSON|CHECK/i);
    assert.throws(() => db.run('UPDATE "we_environment" SET "f_string_list" = ?', ['{}']), /CHECK/);
    assert.throws(() => db.run('UPDATE "we_environment" SET "f_reference" = ?', ['[]']), /CHECK/);
  }, allTypeFixture);
});

test('T3 内部受控插入保留数组顺序，新行追加而不按姓名或ID重排', async () => {
  await withFixture((db, template, data) => {
    const table = template.tables.find(item => item.id === 'market')!;
    const newRow = prepareT2NewRow(template, table.id, 'aaa-new', { name: '同名角色' }, { revision: data.revision });
    insertT3Row(db, table, newRow);
    assert.deepEqual(
      exportT3World(db, template, data).tables.market.map(row => row.meta.id),
      ['harbor-market', 'aaa-new'],
    );
    db.run('UPDATE "we_market" SET "f_name" = ?', ['更新名称']);
    assert.deepEqual(
      exportT3World(db, template, data).tables.market.map(row => row.meta.id),
      ['harbor-market', 'aaa-new'],
    );
  });
});

test('T3 数组内重复、悬空引用及跨表目标必须在完整导出时拒绝', async () => {
  await withFixture((db, template, data) => {
    db.run('UPDATE "we_market" SET "f_location" = ?', [JSON.stringify({ tableId: 'location', rowId: 'not-exists' })]);
    assert.throws(() => exportT3World(db, template, data), /悬空引用/);
    db.run('UPDATE "we_market" SET "f_location" = ?', [JSON.stringify({ tableId: 'npc', rowId: 'lin-watch' })]);
    assert.throws(() => exportT3World(db, template, data), /目标范围/);
    db.run('UPDATE "we_market" SET "f_location" = NULL');
    db.run('UPDATE "we_market" SET "f_goods" = ?', ['["重复","重复"]']);
    assert.throws(() => exportT3World(db, template, data), /重复/);
  });
});

test('T3 删除被引用目标不声称SQLite数组外键，完整JSON图检查拒绝悬空', async () => {
  await withFixture((db, template, data) => {
    db.run('DELETE FROM "we_location" WHERE "__we_row_id" = ?', ['harbor']);
    assert.throws(() => exportT3World(db, template, data), /悬空引用/);
  });
});

test('T3 存在性旁路拒绝未知、重复字段及隐藏非NULL值', async () => {
  await withFixture((db, template, data) => {
    db.run('UPDATE "we_market" SET "__we_presence" = ?', ['["unknown"]']);
    assert.throws(() => exportT3World(db, template, data), /旁路/);
    db.run('UPDATE "we_market" SET "__we_presence" = ?', ['["name","name"]']);
    assert.throws(() => exportT3World(db, template, data), /旁路/);
    db.run('UPDATE "we_market" SET "__we_presence" = ?', ['[]']);
    assert.throws(() => exportT3World(db, template, data), /缺失/);
  });
});

test('T3 JSON元数据必须逐项合法，不能用额外键或伪布尔值绕过', async () => {
  await withFixture((db, template, data) => {
    db.run('UPDATE "we_market" SET "__we_visibility" = ?', [
      '{"user":true,"evolutionAi":true,"mainAi":true,"extra":true}',
    ]);
    assert.throws(() => exportT3World(db, template, data), /不支持/);
    db.run('UPDATE "we_market" SET "__we_visibility" = ?', ['{"user":true,"evolutionAi":true,"mainAi":true}']);
    db.run('PRAGMA ignore_check_constraints = ON');
    db.run('UPDATE "we_market" SET "__we_locked" = 2');
    assert.throws(() => exportT3World(db, template, data), /0\/1/);
  });
});

for (const [name, mutate] of [
  ['外来表', (db: Database) => db.run('CREATE TABLE intruder (x INTEGER)')],
  ['外来视图', (db: Database) => db.run('CREATE VIEW intruder AS SELECT * FROM we_npc')],
  ['外来触发器', (db: Database) => db.run('CREATE TRIGGER intruder AFTER UPDATE ON we_npc BEGIN SELECT 1; END')],
  ['外来索引', (db: Database) => db.run('CREATE INDEX intruder ON we_npc(f_name)')],
  ['临时表', (db: Database) => db.run('CREATE TEMP TABLE intruder (x INTEGER)')],
  ['附加库', (db: Database) => db.run("ATTACH ':memory:' AS intruder")],
  ['追加列', (db: Database) => db.run('ALTER TABLE we_npc ADD COLUMN f_intruder TEXT')],
  ['缺失表', (db: Database) => db.run('DROP TABLE we_npc')],
] as const)
  test(`T3 ${name}篡改后导出拒绝而不接受外来SQLite结构`, async () => {
    await withFixture((db, template, data) => {
      mutate(db);
      assert.throws(() => assertT3Schema(db, template), /结构|临时|附加/);
      assert.throws(() => exportT3World(db, template, data), /结构|临时|附加/);
    });
  });

test('T3 即便列名相同，也拒绝替换成没有原约束的表', async () => {
  await withFixture((db, template, data) => {
    db.run('ALTER TABLE we_market RENAME TO we_previous');
    db.run('CREATE TABLE we_market AS SELECT * FROM we_previous');
    db.run('DROP TABLE we_previous');
    assert.throws(() => exportT3World(db, template, data), /结构/);
  });
});

test('T3 SQL标识符仅接受规范协议名称和明确系统列', () => {
  for (const name of ['we_npc', 'f_private_goal', ...T2_SYSTEM_SQL_COLUMNS])
    assert.equal(quoteT3Identifier(name), `"${name}"`);
  for (const name of ['npc', 'rowid', 'sqlite_schema', 'f_name";DROP TABLE we_npc;--', 'we_NPC', '__we_fake'])
    assert.throws(() => quoteT3Identifier(name), /标识符/);
});

test('T3 空JSON只建立空表，不读取示例、不自动补种或覆盖原对象', async () => {
  const SQL = await sqlReady;
  const template = createMinimalT2Template();
  const data = createT2EmptyWorld(template, 'empty-world', 'empty-branch');
  const before = JSON.stringify({ template, data });
  const db = createT3Database(SQL, template, data);
  try {
    assert.deepEqual(exportT3World(db, template, data), data);
    assert.equal(JSON.stringify({ template, data }), before);
    assert.equal(Object.values(data.tables).flat().length, 0);
  } finally {
    db.close();
  }
});

test('T3 行排序保持导入数组而非字典序，同名行和不同表同ID不合并', async () => {
  const SQL = await sqlReady;
  const { template, data } = allTypeFixture();
  data.tables.environment.reverse();
  const db = createT3Database(SQL, template, data);
  try {
    assert.deepEqual(exportT3World(db, template, data), data);
  } finally {
    db.close();
  }
});

test('T3 创建失败关闭已分配数据库；输入校验失败不分配数据库', async () => {
  const SQL = await sqlReady;
  let opened = 0;
  let closed = 0;
  class FailingDatabase extends SQL.Database {
    constructor() {
      super();
      opened += 1;
    }
    override run(): Database {
      throw new Error('固定模拟DDL创建失败');
    }
    override close(): void {
      closed += 1;
      super.close();
    }
  }
  const instrumented = { ...SQL, Database: FailingDatabase } as SqlJsStatic;
  const { template, data } = createMinimalT2Fixture();
  assert.throws(() => createT3Database(instrumented, template, data), /创建失败/);
  assert.equal(opened, 1);
  assert.equal(closed, 1);
  const invalid = { ...data, templateVersion: data.templateVersion + 1 };
  assert.throws(() => createT3Database(instrumented, template, invalid));
  assert.equal(opened, 1);
});

test('T3 实际数据库关闭后不再可用；导出只返回独立规范JSON', async () => {
  const SQL = await sqlReady;
  const { template, data } = createMinimalT2Fixture();
  const db = createT3Database(SQL, template, data);
  const exported = exportT3World(db, template, data);
  exported.tables.npc[0].values.name = '仅改独立返回对象';
  assert.deepEqual(exportT3World(db, template, data), data);
  db.close();
  assert.throws(() => db.exec('SELECT 1'), /closed|out of memory/i);
});

test('T3 内部绑定不执行业务文本中的SQL、脚本或引号', async () => {
  await withFixture((db, template, data) => {
    const table = template.tables.find(item => item.id === 'market')!;
    const payload = "'; DROP TABLE we_npc; -- <script>alert(1)</script>";
    insertT3Row(
      db,
      table,
      prepareT2NewRow(template, table.id, 'sql-text', { name: payload }, { revision: data.revision }),
    );
    const exported = exportT3World(db, template, data);
    assert.equal(exported.tables.market[1].values.name, payload);
    assert.equal(exported.tables.npc.length, data.tables.npc.length);
    assertT3Schema(db, template);
  });
});

test('T3 无法无损表达的孤立代理UTF-16文本拒绝，不静默替换', async () => {
  const SQL = await sqlReady;
  const { template, data } = createMinimalT2Fixture();
  data.tables.npc[0].values.name = '\ud800';
  assert.throws(() => createT3Database(SQL, template, data), /编码|改变/);
});

test('T3 绑定值拒绝NUL/孤立代理/无限值/BLOB，不拒绝合法emoji或已转义复合JSON', () => {
  for (const value of ['a\u0000b', '\ud800', '\udc00', Infinity, NaN, -0, new Uint8Array([1]), {}, undefined])
    assert.throws(() => assertT3SqlValue(value));
  for (const value of ['中文😀', '', JSON.stringify(['a\u0000b', '\ud800']), null, 0, 0.1, Number.MAX_SAFE_INTEGER])
    assert.doesNotThrow(() => assertT3SqlValue(value));
});

test('T3 内部新行辅助不能静默丢弃未知元数据或把伪布尔转换成布尔', async () => {
  await withFixture((db, template, data) => {
    const table = template.tables.find(item => item.id === 'market')!;
    const row = prepareT2NewRow(template, table.id, 'meta-test', { name: '新行' }, { revision: data.revision });
    assert.throws(() => insertT3Row(db, table, { ...row, meta: { ...row.meta, extra: true } } as typeof row), /元数据/);
    assert.throws(
      () => insertT3Row(db, table, { ...row, meta: { ...row.meta, locked: 'false' } } as unknown as typeof row),
      /布尔/,
    );
    assert.throws(() => insertT3Row(db, table, { ...row, values: { ...row.values, name: 'a\u0000b' } }), /NUL/);
    assert.deepEqual(exportT3World(db, template, data), data);
  });
});
