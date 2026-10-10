import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { createCustomT2Fixture, createDefaultT2Fixture, createMinimalT2Fixture } from './t2-defaults';
import { normalizeT2Template } from './t2-template';
import { createT2EmptyWorld } from './t2-values';
import { executeT3Request } from './t3-engine';
import { createT3Database, exportT3World, describeT3SchemaDdl } from './t3-schema';
import { copyT6, dropT6Field, newT6Field, newT6Table, typeT6Field } from './t6-editor';
import { exportT6Ddl, importT6Ddl } from './t6-ddl';
import { planT6Migration, type T6MigrationOptions } from './t6-migration';
import { createT6DefaultStore, newT6World } from './t6-defaults';
import { createT6Sandbox } from './t6-sandbox';
import { validateT6Sqlite } from './t6-workbench';
import { createT4CommitService, replayT4Suffix } from './t4-service';
import { canonicalT4Json, type T4State, type T4Scope } from './t4-protocol';

const SQL = initSqlJs({
  wasmBinary: Uint8Array.from(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});
const execute = async (request: Parameters<typeof executeT3Request>[1]) => executeT3Request(await SQL, request);
const scope: T4Scope = { mode: 't4-sandbox', chatId: 'sandbox-t6', worldId: 'demo-world', branchId: 'demo-main' };
const noFill: T6MigrationOptions = { mappings: [], allowRemoval: false };
const npc = (state: T4State) => state.template.tables.find(t => t.id === 'npc')!;
async function fixture(initial: T4State = createMinimalT2Fixture(), anchor = true) {
  return createT6Sandbox({ execute, scope, initial, withMockAnchor: anchor });
}
async function save(f: Awaited<ReturnType<typeof fixture>>) {
  await f.structure.prepare();
  assert.equal(f.structure.view().report?.valid, true);
  assert.equal(f.structure.view().error, null);
  f.structure.consent(true);
  assert.equal(f.structure.view().canSave, true);
  await f.structure.save();
  assert.equal(f.structure.view().error, null);
}

test('T6 optional field keeps old missing distinct from NULL/default and SQLite roundtrips', async () => {
  const base = createMinimalT2Fixture(),
    template = copyT6(base.template),
    field = newT6Field('age', '年龄', 'integer');
  field.defaultValue = 18;
  npc({ ...base, template }).fields.push(field);
  const plan = planT6Migration(base, template, noFill);
  assert.equal(plan.report.valid, true);
  assert.equal(plan.state!.template.templateVersion, 2);
  assert.equal(Object.hasOwn(plan.state!.data.tables.npc[0].values, 'age'), false);
  const db = createT3Database(await SQL, plan.state!.template, plan.state!.data);
  try {
    assert.deepEqual(exportT3World(db, plan.state!.template, plan.state!.data), plan.state!.data);
  } finally {
    db.close();
  }
  await validateT6Sqlite(plan.state!, execute);
  assert.equal(
    base.template.tables.find(t => t.id === 'npc')!.fields.some(f => f.id === 'age'),
    false,
  );
});

test('T6 required field needs explicit fill; false/0/NULL not confused; default is new-row only', () => {
  const base = createMinimalT2Fixture(),
    template = copyT6(base.template),
    age = newT6Field('age', '年龄', 'integer');
  age.required = true;
  age.nullable = false;
  age.defaultValue = 20;
  npc({ ...base, template }).fields.push(age);
  assert.equal(planT6Migration(base, template, noFill).report.valid, false);
  const options: T6MigrationOptions = {
    ...noFill,
    mappings: [{ tableId: 'npc', fieldId: 'age', fromFieldId: null, conversion: 'identity', fill: 0 }],
  };
  const plan = planT6Migration(base, template, options);
  assert.equal(plan.report.valid, true);
  assert.equal(plan.state!.data.tables.npc[0].values.age, 0);
  assert.equal(plan.report.mappings[0].filled, 1);
  options.mappings[0].fill = null;
  assert.equal(planT6Migration(base, template, options).report.valid, false);
  age.type = 'boolean';
  age.control = 'toggle';
  age.defaultValue = false;
  options.mappings[0].fill = false;
  assert.equal(planT6Migration(base, template, options).state!.data.tables.npc[0].values.age, false);
});

test('T6 strict explicit conversion rejects truncation, whitespace, overflow and ambiguous coercion', () => {
  for (const [text, valid] of [
    ['42', true],
    ['42x', false],
    [' 42', false],
    ['1.5', false],
    ['9007199254740993', false],
    ['-0', false],
  ] as const) {
    const base = createMinimalT2Fixture();
    base.data.tables.npc[0].values.identity = text;
    const template = copyT6(base.template),
      old = npc({ ...base, template }).fields.find(f => f.id === 'identity')!;
    npc({ ...base, template }).fields = npc({ ...base, template }).fields.map(f =>
      f.id === old.id ? typeT6Field(old, 'integer', template) : f,
    );
    const plan = planT6Migration(base, template, {
      ...noFill,
      mappings: [{ tableId: 'npc', fieldId: 'identity', fromFieldId: 'identity', conversion: 'text-integer' }],
    });
    assert.equal(plan.report.valid, valid, text);
    if (valid) assert.equal(plan.state!.data.tables.npc[0].values.identity, 42);
    assert.equal(base.data.tables.npc[0].values.identity, text);
  }
});

test('T6 enum tightening rejects old value instead of deleting it', () => {
  const base = createDefaultT2Fixture(),
    template = copyT6(base.template);
  const status = template.tables.find(t => t.id === 'plan')!.fields.find(f => f.id === 'status')!;
  status.constraints.enumValues = ['待定'];
  // Exercise row-data tightening, independently of T9's terminal-state subset contract.
  delete status.constraints.terminalValues;
  delete status.defaultValue;
  const plan = planT6Migration(base, template, noFill);
  assert.equal(plan.state, null);
  assert.ok(plan.report.issues.some(i => i.path.includes('status')));
  assert.equal(base.data.tables.plan[0].values.status, '进行中');
});

test('T6 display rename/reorder/group retains stable identity, row metadata and references', () => {
  const base = createDefaultT2Fixture(),
    template = copyT6(base.template),
    table = template.tables.find(t => t.id === 'npc')!;
  table.name = '居民';
  table.groupId = 'macro';
  table.fields.reverse();
  table.fields.find(f => f.id === 'name')!.name = '全名';
  template.tables.reverse();
  const plan = planT6Migration(base, template, noFill);
  assert.equal(plan.report.valid, true);
  assert.deepEqual(plan.state!.data.tables.npc, base.data.tables.npc);
  assert.deepEqual(plan.state!.data.tables.organization[0].values.members, [{ tableId: 'npc', rowId: 'lin-watch' }]);
  assert.equal(table.sqlName, 'we_npc');
  assert.equal(table.fields.find(f => f.id === 'name')!.sqlName, 'f_name');
});

test('T6 same-table field mapping is explicit; deletion needs acknowledgement and reports removed values', () => {
  const base = createMinimalT2Fixture(),
    template = copyT6(base.template),
    table = npc({ ...base, template });
  table.fields.push(newT6Field('job', '职业'));
  Object.assign(table, dropT6Field(table, 'identity'));
  const options: T6MigrationOptions = {
    mappings: [{ tableId: 'npc', fieldId: 'job', fromFieldId: 'identity', conversion: 'identity' }],
    allowRemoval: false,
  };
  assert.equal(planT6Migration(base, template, options).report.valid, false);
  options.allowRemoval = true;
  const plan = planT6Migration(base, template, options);
  assert.equal(plan.report.valid, true);
  assert.equal(plan.state!.data.tables.npc[0].values.job, '山谷旅人');
  assert.equal(Object.hasOwn(plan.state!.data.tables.npc[0].values, 'identity'), false);
  assert.ok(plan.report.removed.some(r => r.path === 'npc/identity' && r.values === 1));
});

test('T6 removing referenced tables fails whole-graph validation even with removal consent', () => {
  const base = createDefaultT2Fixture(),
    template = copyT6(base.template);
  template.tables = template.tables.filter(t => t.id !== 'location');
  for (const t of template.tables) {
    t.context.relatedTableIds = t.context.relatedTableIds.filter(id => id !== 'location');
    for (const f of t.fields)
      if (f.constraints.reference?.tableIds.includes('location')) f.constraints.reference.tableIds = ['npc'];
  }
  const plan = planT6Migration(base, template, { ...noFill, allowRemoval: true });
  assert.equal(plan.state, null);
  assert.equal(plan.report.valid, false);
  assert.equal(base.data.tables.location.length, 2);
});

test('T6 original locks/readonly/permissions block values and cannot be bypassed by new grants', () => {
  for (const kind of ['row', 'field', 'table', 'readonly', 'permission'] as const) {
    const base = createMinimalT2Fixture(),
      table = npc(base),
      field = table.fields.find(f => f.id === 'identity')!;
    if (kind === 'row') base.data.tables.npc[0].meta.locked = true;
    if (kind === 'field') base.data.tables.npc[0].meta.lockedFieldIds = ['identity'];
    if (kind === 'table') table.locked = true;
    if (kind === 'readonly') {
      field.readonly = true;
      field.permissions = { manualWrite: false, aiWrite: false };
    }
    if (kind === 'permission') table.permissions.manual.update = false;
    const template = copyT6(base.template),
      next = npc({ ...base, template });
    next.locked = false;
    next.permissions.manual.update = true;
    next.fields.find(f => f.id === 'identity')!.readonly = false;
    next.fields.find(f => f.id === 'identity')!.permissions.manualWrite = true;
    Object.assign(next, dropT6Field(next, 'identity'));
    const plan = planT6Migration(base, template, { ...noFill, allowRemoval: true });
    assert.equal(plan.state, null, kind);
    assert.ok(
      plan.report.issues.some(i => i.path === 'protected'),
      kind,
    );
  }
});

test('T6 nonpublic row/field diagnostics never expose secret values or identities', () => {
  const base = createMinimalT2Fixture();
  base.data.tables.npc[0].meta.visibility.user = false;
  base.data.tables.npc[0].values.identity = '不可泄露的秘密';
  const template = copyT6(base.template);
  Object.assign(npc({ ...base, template }), dropT6Field(npc({ ...base, template }), 'identity'));
  const report = planT6Migration(base, template, { ...noFill, allowRemoval: true }).report;
  const json = JSON.stringify(report);
  assert.equal(report.valid, false);
  assert.doesNotMatch(json, /不可泄露|traveler/);
  assert.equal(report.changedRows, 0);
});

test('T6 changing calendar epoch with existing world-time cannot silently reinterpret history', () => {
  const base = createDefaultT2Fixture(),
    template = copyT6(base.template);
  template.calendars[0].epoch = '新纪元';
  assert.equal(planT6Migration(base, template, noFill).report.valid, false);
  template.calendars[0].epoch = base.template.calendars[0].epoch;
  template.calendars[0].name = '历法显示改名';
  assert.equal(planT6Migration(base, template, noFill).report.valid, true);
});

test('T6 no-op/duplicate mapping/different template identity rejected with zero candidate', () => {
  const base = createMinimalT2Fixture();
  assert.equal(planT6Migration(base, base.template, noFill).state, null);
  const template = copyT6(base.template);
  template.name = '修改';
  const mapping = { tableId: 'npc', fieldId: 'name', fromFieldId: 'name', conversion: 'identity' as const };
  assert.equal(planT6Migration(base, template, { ...noFill, mappings: [mapping, mapping] }).state, null);
  template.id = 'different';
  assert.equal(planT6Migration(base, template, noFill).state, null);
});

test('T6 canonical annotated DDL preserves all supported types/constraints/settings byte-for-byte', () => {
  const template = createCustomT2Fixture().template,
    ddl = exportT6Ddl(template);
  assert.deepEqual(importT6Ddl(template, ddl), template);
  assert.equal(exportT6Ddl(importT6Ddl(template, ddl)), ddl);
  assert.ok(ddl.includes(describeT3SchemaDdl(template)));
  assert.match(ddl, /CHECK/);
  assert.throws(() => importT6Ddl(template, `${ddl}\nDROP TABLE we_npc;`));
  assert.throws(() => importT6Ddl(template, ddl.replace(' STRICT;', ' WITHOUT ROWID;')));
  assert.throws(() => importT6Ddl(template, ddl.replace(`"id":"${template.id}"`, '"id":"unrelated"')));
});

test('T6 plain restricted DDL supports new table/add/drop with static defaults; it never executes', () => {
  const template = createMinimalT2Fixture().template;
  const next = importT6Ddl(
    template,
    `CREATE TABLE "we_trade" (f_name TEXT NOT NULL, f_amount INTEGER DEFAULT 0, f_note TEXT DEFAULT 'a;''b') STRICT;
    ALTER TABLE we_npc ADD COLUMN f_age INTEGER;
    ALTER TABLE we_npc DROP COLUMN f_identity;`,
    'macro',
  );
  assert.equal(next.tables.find(t => t.id === 'trade')!.groupId, 'macro');
  assert.equal(next.tables.find(t => t.id === 'trade')!.fields[2].defaultValue, "a;'b");
  assert.ok(next.tables.find(t => t.id === 'npc')!.fields.some(f => f.id === 'age'));
  assert.equal(template.tables.length, 2);
  assert.equal(
    template.tables[1].fields.some(f => f.id === 'age'),
    false,
  );
  assert.equal(importT6Ddl(next, 'DROP TABLE we_trade;').tables.length, 2);
});

for (const ddl of [
  'CREATE TABLE we_x (f_a TEXT DEFAULT CURRENT_TIMESTAMP) STRICT;',
  'CREATE TABLE we_x (f_a TEXT CHECK (length(f_a)<5)) STRICT;',
  'CREATE TABLE we_x (f_a BLOB) STRICT;',
  'CREATE TABLE we_x (f_a TEXT, f_a INTEGER) STRICT;',
  'CREATE TABLE we_x (f_a INTEGER DEFAULT 9007199254740993) STRICT;',
  'CREATE TABLE we_x (__we_row_id TEXT) STRICT;',
  'ALTER TABLE we_npc RENAME TO we_people;',
  'ALTER TABLE we_npc ADD COLUMN f_age INTEGER; CREATE TRIGGER x AFTER INSERT ON we_npc BEGIN SELECT 1; END;',
  "ATTACH DATABASE 'x' AS y;",
  'CREATE VIEW x AS SELECT * FROM we_npc;',
])
  test(`T6 rejects unsupported/lossy DDL: ${ddl.slice(0, 70)}`, () => {
    const template = createMinimalT2Fixture().template,
      json = JSON.stringify(template);
    assert.throws(() => importT6Ddl(template, ddl));
    assert.equal(JSON.stringify(template), json);
  });

test('T6 migration saves template/data/version once, refreshes T5 then allows filling new field', async () => {
  const f = await fixture();
  f.structure.selectTable('npc');
  f.structure.addField('age', '年龄');
  f.structure.selectField('age');
  f.structure.field({ type: 'integer', control: 'integer' });
  assert.throws(() => f.workbench.beginNew());
  await assert.rejects(f.workbench.reload(false));
  await save(f);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.service.view().formal.template.templateVersion, 2);
  assert.equal(f.service.view().formal.data.revision, 2);
  f.workbench.selectTable('npc');
  f.workbench.beginEdit('traveler');
  const input = f.workbench.view().editor!.fields.find(f => f.field.id === 'age')!.input;
  f.workbench.setInput('age', { ...input, mode: 'value', text: '25' });
  assert.equal(f.workbench.stageEditor(), true);
  await f.workbench.prepare();
  f.workbench.consent(true);
  await f.workbench.save();
  assert.equal(f.service.view().formal.data.tables.npc[0].values.age, 25);
  assert.equal(f.service.view().formal.data.revision, 3);
  const reopened = await createT6Sandbox({ execute, scope, storage: f.exportStorage(), withMockAnchor: true });
  assert.equal(
    reopened.structure
      .view()
      .template!.tables.find(t => t.id === 'npc')!
      .fields.some(f => f.id === 'age'),
    true,
  );
  assert.equal(reopened.service.view().formal.data.tables.npc[0].values.age, 25);
});

test('T6 added custom table is fillable; removed selected T5 table falls back safely', async () => {
  const f = await fixture();
  f.structure.addTable('market', '市场', 'macro');
  await save(f);
  f.workbench.selectTable('market');
  f.workbench.beginNew();
  const input = f.workbench.view().editor!.fields[0].input;
  f.workbench.setInput('name', { ...input, mode: 'value', text: '集市' });
  f.workbench.stageEditor();
  await f.workbench.prepare();
  f.workbench.consent(true);
  await f.workbench.save();
  // Refresh the structure baseline after a normal data commit.
  await f.structure.discard();
  f.structure.selectTable('market');
  f.structure.dropTable();
  f.structure.mappings({ ...noFill, allowRemoval: true });
  await save(f);
  assert.notEqual(f.workbench.view().table.id, 'market');
  assert.equal(f.store.statistics.writes, 3);
});

test('T6 confirmed save failure keeps old complete archive and draft; retry saves once', async () => {
  const f = await fixture(),
    old = f.exportStorage();
  f.structure.selectTable('npc');
  f.structure.addField('note', '备注');
  await f.structure.prepare();
  f.structure.consent(true);
  f.store.queueWriteFault('save-failed');
  await f.structure.save();
  assert.equal(f.exportStorage(), old);
  assert.equal(f.structure.view().dirty, true);
  assert.match(f.structure.view().error!, /保存失败/);
  assert.equal(f.service.view().formal.template.templateVersion, 1);
  f.structure.consent(true);
  await f.structure.save();
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.service.view().formal.template.templateVersion, 2);
});

test('T6 lost acknowledgement blocks edits/retry and reconciles exact atomic migration', async () => {
  const f = await fixture();
  f.structure.selectTable('npc');
  f.structure.addField('note', '备注');
  await f.structure.prepare();
  f.structure.consent(true);
  f.store.queueWriteFault('ack-lost');
  await f.structure.save();
  assert.equal(f.structure.view().pending, true);
  assert.equal(f.service.view().formal.template.templateVersion, 1);
  assert.throws(() => f.structure.table({ name: '越权修改' }));
  assert.throws(() => f.workbench.beginNew());
  await f.structure.save();
  assert.equal(f.store.statistics.writes, 1);
  await f.structure.reconcile();
  assert.equal(f.service.view().formal.template.templateVersion, 2);
  assert.equal(f.structure.view().dirty, false);
  assert.equal(f.store.statistics.writes, 1);
});

test('T6 no anchor permits validated preview only; discard remains usable', async () => {
  const f = await fixture(undefined, false);
  f.structure.selectTable('npc');
  f.structure.addField('note', '备注');
  await f.structure.prepare();
  f.structure.consent(true);
  assert.equal(f.structure.view().canSave, false);
  await f.structure.save();
  assert.equal(f.store.statistics.writes, 0);
  await f.structure.discard();
  assert.equal(f.structure.view().dirty, false);
});

test('T6 data draft/history and foreign prepared generation block structural operations', async () => {
  const f = await fixture();
  f.workbench.selectTable('npc');
  f.workbench.beginNew();
  const input = f.workbench.view().editor!.fields[0].input;
  f.workbench.setInput('name', { ...input, mode: 'value', text: '未保存' });
  assert.throws(() => f.structure.addField('note', '备注'));
  f.workbench.cancelEditor();
  await f.workbench.history(null);
  assert.throws(() => f.structure.addField('note', '备注'));
  await f.workbench.reload(false);
  const state = copyT6(f.service.view().formal);
  state.template.templateVersion++;
  state.template.name = '其他迁移';
  state.data.templateVersion++;
  await f.service.prepareMigration({ ...f.runSpec(), state });
  assert.throws(() => f.structure.addField('note', '备注'));
  assert.equal(f.store.statistics.writes, 0);
});

test('T6 temporary SQLite failure or forged changed result leaves zero writes', async () => {
  for (const failure of ['throw', 'mutate'] as const) {
    const f = await createT6Sandbox({
      scope,
      initial: createMinimalT2Fixture(),
      withMockAnchor: true,
      execute: async request => {
        if (failure === 'throw') throw new Error('WASM failure');
        const result = await execute(request);
        result.data.tables.npc[0].values.name = '篡改';
        return result;
      },
    });
    f.structure.selectTable('npc');
    f.structure.addField('note', '备注');
    await f.structure.prepare();
    assert.equal(f.structure.view().canSave, false);
    assert.equal(f.store.statistics.writes, 0);
    assert.equal(f.service.view().formal.data.tables.npc[0].values.name, '陈望');
  }
});

test('T6 stale baseline and competing service cannot overwrite latest world', async () => {
  const f = await fixture(),
    other = await createT4CommitService({ scope, execute, store: f.store });
  const state = copyT6(other.view().formal);
  state.template.templateVersion++;
  state.template.name = '并行最新';
  state.data.templateVersion++;
  await other.prepareMigration({ ...f.runSpec(), state });
  await other.save();
  f.structure.selectTable('npc');
  f.structure.addField('note', '备注');
  await f.structure.prepare();
  f.structure.consent(true);
  await f.structure.save();
  assert.match(f.structure.view().error!, /不能覆盖/);
  assert.equal((await f.store.read(scope)).commits.length, 1);
  await f.structure.discard();
  assert.equal(f.structure.view().template!.name, '并行最新');
});

test('T6 history restore returns old template and removed values, no SQL/AI replay needed', async () => {
  const f = await fixture(),
    original = copyT6(f.service.view().formal);
  f.structure.selectTable('npc');
  f.structure.selectField('identity');
  f.structure.dropField();
  f.structure.mappings({ ...noFill, allowRemoval: true });
  await save(f);
  assert.equal(Object.hasOwn(f.service.view().formal.data.tables.npc[0].values, 'identity'), false);
  const archive = await f.store.read(scope);
  const replayed = await replayT4Suffix(archive, null, async () => {
    throw new Error('migration replay must use snapshot');
  });
  assert.deepEqual(replayed, f.service.view().formal);
  await f.service.prepareRestore({ ...f.runSpec(), sourceCommitId: null });
  await f.service.save();
  await f.structure.discard();
  assert.deepEqual(f.service.view().formal.template, original.template);
  assert.equal(f.service.view().formal.data.tables.npc[0].values.identity, '山谷旅人');
  assert.equal(f.service.view().formal.data.revision, 3);
});

test('T6 rules/budgets/frequency/context/API/export have one canonical template and survive save', async () => {
  const f = await fixture();
  f.structure.selectTable('npc');
  const table = f.structure.view().template!.tables.find(t => t.id === 'npc')!;
  table.rules.update = '依据最新宏观条件行动';
  table.runtime.api = { state: 'value', value: { presetId: 'local-preset' } };
  table.runtime.frequency = { state: 'value', value: { unit: 'eligible-story-round', every: 3, offset: 1 } };
  table.runtime.budget = {
    state: 'value',
    value: { maxRows: 2, maxNewRows: 1, maxRequests: 1, maxContextChars: 3000 },
  };
  table.context.settings = { state: 'disabled' };
  table.export.enabled = false;
  table.export.titleFieldId = 'name';
  f.structure.table({ rules: table.rules, runtime: table.runtime, context: table.context, export: table.export });
  await save(f);
  assert.deepEqual(f.service.view().formal.template.tables.find(t => t.id === 'npc')!, table);
  assert.equal(f.structure.view().resolved?.api.value?.presetId, 'local-preset');
  assert.equal(f.structure.view().resolved?.frequency.value?.every, 3);
  assert.equal(f.service.view().formal.data.tables.npc[0].values.identity, '山谷旅人');
});

test('T6 save global default is separate; new world empty, existing world byte-identical', async () => {
  const f = await fixture(),
    old = canonicalT4Json(f.service.view().formal);
  f.structure.addTable('market', '市场', 'macro');
  await f.structure.saveDefault(true);
  assert.equal(f.structure.view().error, null);
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(canonicalT4Json(f.service.view().formal), old);
  const fresh = await newT6World(f.defaults, 'new-world', 'new-main');
  assert.ok(fresh.template.tables.some(t => t.id === 'market'));
  assert.equal(Object.values(fresh.data.tables).flat().length, 0);
  assert.equal(f.structure.view().dirty, true);
  const reopened = await createT6DefaultStore(createMinimalT2Fixture().template, f.defaults.exportStorage());
  assert.deepEqual((await reopened.read()).template, fresh.template);
});

test('T6 default save failure/concurrent CAS/corrupt archive never overwrite prior default', async () => {
  const template = createMinimalT2Fixture().template,
    store = await createT6DefaultStore(template),
    before = await store.read();
  const changed = copyT6(template);
  changed.name = '新默认';
  store.queueSaveFailure();
  await assert.rejects(store.save(before.fingerprint, changed));
  assert.deepEqual(await store.read(), before);
  const results = await Promise.allSettled([
    store.save(before.fingerprint, changed),
    store.save(before.fingerprint, template),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await store.read()).revision, 1);
  const corrupt = JSON.parse(store.exportStorage());
  corrupt.template.name = '损坏';
  await assert.rejects(createT6DefaultStore(template, JSON.stringify(corrupt)));
  assert.deepEqual(createT2EmptyWorld(normalizeT2Template(template), 'another', 'main').tables.npc, []);
});

test('T6 NULL remains explicit, missing fill cannot replace existing values through null source', () => {
  const base = createMinimalT2Fixture(),
    template = copyT6(base.template);
  const field = npc({ ...base, template }).fields.find(f => f.id === 'identity')!;
  field.name = '身份说明';
  const report = planT6Migration(base, template, {
    ...noFill,
    mappings: [{ tableId: 'npc', fieldId: 'identity', fromFieldId: null, conversion: 'identity', fill: '替换' }],
  }).report;
  assert.equal(report.valid, false);
  const nullable = newT6Field('note', '备注');
  npc(base).fields.push(nullable);
  base.data.tables.npc[0].values.note = null;
  const next = copyT6(base.template);
  next.name = '新显示名';
  const plan = planT6Migration(base, next, {
    ...noFill,
    mappings: [{ tableId: 'npc', fieldId: 'note', fromFieldId: 'note', conversion: 'identity', fill: '补充' }],
  });
  assert.equal(plan.state!.data.tables.npc[0].values.note, null);
  assert.equal(plan.report.mappings[0].filled, 0);
});

test('T6 numeric conversion rejects rounded/underflow values, allows exact decimal text', () => {
  for (const [value, valid] of [
    ['0.1', true],
    ['1.50', true],
    ['9007199254740990.1', false],
    ['0.' + '0'.repeat(400) + '1', false],
  ] as const) {
    const base = createMinimalT2Fixture();
    base.data.tables.npc[0].values.identity = value;
    const template = copyT6(base.template),
      table = npc({ ...base, template });
    table.fields = table.fields.map(f => (f.id === 'identity' ? typeT6Field(f, 'number', template) : f));
    assert.equal(
      planT6Migration(base, template, {
        ...noFill,
        mappings: [{ tableId: 'npc', fieldId: 'identity', fromFieldId: 'identity', conversion: 'text-number' }],
      }).report.valid,
      valid,
      value,
    );
  }
});

test('T6 new columns remain visible after T5 customized column choices; data page cannot reconcile migration', async () => {
  const f = await fixture();
  f.workbench.selectTable('npc');
  f.workbench.column('identity', false);
  f.structure.selectTable('npc');
  f.structure.addField('age', '年龄');
  await f.structure.prepare();
  await assert.rejects(f.workbench.reconcile());
  await assert.rejects(f.workbench.reload(true));
  f.structure.consent(true);
  await f.structure.save();
  assert.equal(f.workbench.view().fields.find(f => f.id === 'age')!.shown, true);
  assert.equal(f.workbench.view().fields.find(f => f.id === 'identity')!.shown, false);
});

test('T6 next structure edit adopts confirmed data baseline, but never rebase an existing structure draft', async () => {
  const f = await fixture();
  f.workbench.selectTable('npc');
  f.workbench.beginEdit('traveler');
  const input = f.workbench.view().editor!.fields.find(f => f.field.id === 'identity')!.input;
  f.workbench.setInput('identity', { ...input, mode: 'value', text: '新身份' });
  f.workbench.stageEditor();
  await f.workbench.prepare();
  f.workbench.consent(true);
  await f.workbench.save();
  f.structure.selectTable('npc');
  f.structure.addField('age', '年龄');
  await save(f);
  assert.equal(f.service.view().formal.data.tables.npc[0].values.identity, '新身份');
  assert.equal(f.store.statistics.writes, 2);
});

test('T6 global defaults reject old-world record references and stale default overwrite', async () => {
  const f = await fixture(),
    previous = await f.defaults.read();
  const candidate = copyT6(previous.template);
  const field = newT6Field('friend', '朋友', 'reference', candidate);
  field.constraints.reference!.tableIds = ['npc'];
  field.defaultValue = { tableId: 'npc', rowId: 'traveler' };
  npc({ template: candidate, data: f.service.view().formal.data }).fields.push(field);
  await assert.rejects(f.defaults.save(previous.fingerprint, candidate));
  assert.deepEqual(await f.defaults.read(), previous);
  const changed = copyT6(previous.template);
  changed.name = '其他默认版本';
  await f.defaults.save(previous.fingerprint, changed);
  f.structure.addTable('market', '市场', 'macro');
  await f.structure.saveDefault(true);
  assert.ok(f.structure.view().error);
  assert.equal((await f.defaults.read()).template.name, '其他默认版本');
  assert.equal(f.store.statistics.writes, 0);
});

test('T6 malicious/getter/oversize template and DDL input reject without executing embedded code', () => {
  const base = createMinimalT2Fixture(),
    untrusted = { ...base.template };
  let read = 0;
  Object.defineProperty(untrusted, 'tables', {
    enumerable: true,
    get() {
      read++;
      return [];
    },
  });
  assert.equal(planT6Migration(base, untrusted, noFill).state, null);
  assert.equal(read, 0);
  assert.throws(() => importT6Ddl(base.template, 'a'.repeat(1_000_001)));
  assert.throws(() => importT6Ddl(base.template, 'CREATE TABLE we_x (f_a TEXT DEFAULT (alert(1))) STRICT;'));
});
