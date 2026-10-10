import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { createCustomT2Fixture, createDefaultT2Fixture, createMinimalT2Fixture } from './t2-defaults';
import { cloneT2Json, type T2Cell } from './t2-template';
import { normalizeT2WorldData, prepareT2NewRow } from './t2-values';
import { executeT3Request } from './t3-engine';
import { fingerprintT4, validateT4Archive, sealT4Commit, type T4Scope, type T4State } from './t4-protocol';
import { createT4CommitService, replayT4Suffix } from './t4-service';
import { createT5Sandbox } from './t5-sandbox';
import { createT5Workbench } from './t5-workbench';
import { applyT5Controls, type T5Control } from './t5-controls';
import { compileT5Action, inputT5Cell, parseT5Input, type T5Input } from './t5-form';
import { readT5Sheets, previewT5Import, selectT5Import } from './t5-import';

const SQL = initSqlJs({
  wasmBinary: Uint8Array.from(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});
const clone = <T>(input: T) => cloneT2Json(input) as unknown as T;
const scope: T4Scope = { mode: 't4-sandbox', chatId: 'sandbox-t5', worldId: 'demo-world', branchId: 'demo-main' };
const execute = async (request: Parameters<typeof executeT3Request>[1]) => executeT3Request(await SQL, request);
async function fixture(initial?: T4State, anchor = true) {
  return createT5Sandbox({ execute, scope, ...(initial ? { initial } : {}), withMockAnchor: anchor });
}
function set(w: ReturnType<typeof createT5Workbench>, id: string, patch: Partial<T5Input>) {
  const field = w.view().editor!.fields.find(f => f.field.id === id)!;
  w.setInput(id, { ...field.input, mode: 'value', ...patch });
}
async function save(w: ReturnType<typeof createT5Workbench>) {
  await w.prepare();
  assert.equal(w.view().preview?.valid, true);
  w.consent(true);
  assert.equal(w.view().canSave, true);
  await w.save();
  assert.equal(w.view().error, null);
}

test('T5 default world has two groups, seven empty tables, no demo seeds or implicit anchors', async () => {
  const f = await fixture(undefined, false),
    w = f.workbench;
  assert.equal(w.view().tables.length, 7);
  assert.equal(
    w.view().tables.every(t => t.count === 0),
    true,
  );
  assert.deepEqual(new Set(w.view().tables.map(t => t.groupId)), new Set(['macro', 'micro']));
  w.selectTable('npc');
  w.beginNew();
  set(w, 'name', { text: '新角色甲' });
  assert.equal(w.stageEditor(), true);
  await w.prepare();
  w.consent(true);
  assert.equal(w.view().canSave, false);
  assert.equal(f.store.statistics.writes, 0);
  assert.match(w.view().notice, /未写当前聊天/);
  assert.equal(f.service.view().formal.data.tables.npc.length, 0);
});

test('T5 non-JSON user adds location then NPC, changes location and reopens exact saved JSON', async () => {
  const f = await fixture(),
    w = f.workbench;
  w.selectTable('location');
  w.beginNew();
  set(w, 'name', { text: '城门' });
  w.stageEditor();
  await save(w);
  const location = f.service.view().formal.data.tables.location[0].meta.id;
  w.selectTable('npc');
  w.beginNew();
  set(w, 'name', { text: '韩青' });
  set(w, 'identity', { text: '巡逻官' });
  w.stageEditor();
  assert.equal(f.service.view().formal.data.tables.npc.length, 0);
  await save(w);
  const npc = f.service.view().formal.data.tables.npc[0].meta.id;
  w.beginEdit(npc);
  set(w, 'location', { references: [{ tableId: 'location', rowId: location }] });
  set(w, 'goals', { text: '值守城门' });
  w.stageEditor();
  await save(w);
  const expected = f.service.view().formal;
  assert.deepEqual(expected.data.tables.npc[0].values.location, { tableId: 'location', rowId: location });
  assert.equal(f.store.statistics.writes, 3);
  const reopened = await createT5Sandbox({
    scope,
    execute: async () => {
      throw new Error('recovery must not execute SQL');
    },
    storage: f.exportStorage(),
    withMockAnchor: true,
  });
  assert.deepEqual(reopened.service.view().formal, expected);
  assert.equal(reopened.store.statistics.writes, 0);
});

test('T5 field validation locates missing required name and numeric errors, leaves formal data unchanged', async () => {
  const f = await fixture(),
    w = f.workbench;
  w.selectTable('npc');
  w.beginNew();
  assert.equal(w.stageEditor(), false);
  assert.match(w.view().editor!.fields.find(f => f.field.id === 'name')!.error!, /必填/);
  w.cancelEditor();
  w.selectTable('environment');
  w.beginNew();
  set(w, 'name', { text: '天气' });
  set(w, 'risk', { text: '999' });
  assert.equal(w.stageEditor(), false);
  assert.ok(w.view().editor!.fields.find(f => f.field.id === 'risk')!.error);
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(f.service.view().formal.data.tables.environment.length, 0);
});

test('T5 cancel and cross-table navigation retain only deliberate drafts, never silently save', async () => {
  const f = await fixture(),
    w = f.workbench;
  w.selectTable('npc');
  w.beginNew();
  set(w, 'name', { text: '保留草稿' });
  const draft = w.draftFingerprint();
  w.selectTable('environment');
  assert.equal(w.draftFingerprint(), draft);
  assert.throws(() => w.beginNew(), /暂存或取消/);
  w.stageEditor();
  assert.equal(w.view().staged.length, 1);
  await assert.rejects(w.reload(false), /放弃/);
  assert.equal(w.view().staged.length, 1);
  await w.reload(true);
  assert.equal(w.view().staged.length, 0);
  assert.equal(f.store.statistics.writes, 0);
});

test('T5 batch preview preserves 0, false, empty string/list and explicit NULL', async () => {
  const f = await fixture(createCustomT2Fixture()),
    w = f.workbench;
  w.selectTable('market');
  w.beginEdit('harbor-market');
  set(w, 'summary', { text: '' });
  set(w, 'goods', { text: '' });
  set(w, 'location', { mode: 'null' });
  set(w, 'open', { checked: false });
  set(w, 'unit_price', { text: '0.00' });
  w.stageEditor();
  await save(w);
  const row = f.service.view().formal.data.tables.market[0];
  assert.equal(row.values.summary, '');
  assert.deepEqual(row.values.goods, []);
  assert.equal(row.values.location, null);
  assert.equal(row.values.open, false);
  assert.equal(row.values.unit_price, '0.00');
});

test('T5 save failure retains prepared draft; reconcile enables consent and retry, no repeated SQL', async () => {
  const f = await fixture(),
    w = f.workbench;
  w.selectTable('npc');
  w.beginNew();
  set(w, 'name', { text: '失败草稿' });
  w.stageEditor();
  await w.prepare();
  f.store.queueWriteFault('save-failed');
  w.consent(true);
  await w.save();
  assert.equal(f.service.view().formal.data.tables.npc.length, 0);
  assert.equal(w.view().staged.length, 1);
  assert.equal(w.view().canSave, false);
  await w.reconcile();
  w.consent(true);
  await w.save();
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(w.view().staged.length, 0);
});

test('T5 ACK loss blocks all editing and blind retry until readback; one commit only', async () => {
  const f = await fixture(),
    w = f.workbench;
  w.selectTable('npc');
  w.beginNew();
  set(w, 'name', { text: '确认丢失' });
  w.stageEditor();
  await w.prepare();
  f.store.queueWriteFault('ack-lost');
  w.consent(true);
  await w.save();
  assert.equal(f.service.view().status, 'pending');
  assert.throws(() => w.beginNew(), /待核对/);
  await assert.rejects(w.save(), /待核对/);
  assert.equal(w.view().staged.length, 1);
  await w.reconcile();
  assert.equal(w.view().tables.find(t => t.id === 'npc')!.count, 1);
  assert.equal(f.store.statistics.writes, 1);
});

test('T5 competing sandbox commit causes zero overwrite and retains user draft for explicit reload', async () => {
  const f = await fixture(createMinimalT2Fixture()),
    w = f.workbench;
  const competing = await createT5Sandbox({ execute, scope, storage: f.exportStorage(), withMockAnchor: true });
  // Share actual authority, independent service/session.
  const otherService = await createT4CommitService({ scope, store: f.store, execute });
  const run = competing.service.view();
  const anchor = {
    chatId: scope.chatId,
    messageId: 'mock-assistant',
    swipeId: 'mock-swipe',
    inputFingerprint: await fingerprintT4('T5 explicit local simulation, not a real plot message'),
  };
  const other = createT5Workbench({
    service: otherService,
    readArchive: () => f.store.read(scope),
    nextId: () => 'other-one',
    runSpec: () => ({
      runId: 'other-run',
      commitId: 'other-commit',
      anchor,
      context: {
        inputFingerprint: anchor.inputFingerprint,
        promptFingerprint: anchor.inputFingerprint,
        modelFingerprint: anchor.inputFingerprint,
        parametersFingerprint: anchor.inputFingerprint,
      },
    }),
  });
  assert.equal(run.status, 'saved');
  w.selectTable('npc');
  w.beginEdit('traveler');
  set(w, 'goals', { text: '我的草稿' });
  w.stageEditor();
  await w.prepare();
  other.selectTable('npc');
  other.beginEdit('traveler');
  set(other, 'goals', { text: '较新提交' });
  other.stageEditor();
  await save(other);
  w.consent(true);
  await w.save();
  assert.match(w.view().error!, /不能覆盖/);
  assert.equal(w.view().staged.length, 1);
  assert.equal(f.store.statistics.writes, 1);
  await w.reload(true);
  assert.equal(
    w.view().rows[0].cells.some(c => c.text === '较新提交'),
    true,
  );
});

test('T5 history snapshot is read-only, viewing never restores or overwrites head', async () => {
  const f = await fixture(createMinimalT2Fixture()),
    w = f.workbench;
  await w.history(null);
  assert.equal(w.view().history, 'genesis');
  assert.equal(w.view().canAdd, false);
  assert.throws(() => w.beginNew(), /历史资料只读/);
  w.selectTable('npc');
  w.beginEdit('traveler');
  assert.equal(
    w.view().editor!.fields.every(f => !f.writable),
    true,
  );
  w.cancelEditor();
  await assert.rejects(w.prepare(), /历史资料只读/);
  await w.reload(false);
  assert.equal(w.view().history, null);
  assert.equal(f.store.statistics.writes, 0);
});

test('T5 paginates, filters and hides columns without validating the entire graph on each keystroke', async t => {
  const state = createMinimalT2Fixture(),
    original = state.data.tables.npc[0];
  state.data.tables.npc = Array.from({ length: 200 }, (_, i) => {
    const row = clone(original);
    row.meta.id = `npc-${i}`;
    row.values.name = `角色${i}`;
    return row;
  });
  const f = await fixture(state),
    w = f.workbench;
  w.selectTable('npc');
  assert.equal(w.view().rows.length, 20);
  assert.equal(w.view().pages, 10);
  w.page(10);
  assert.equal(w.view().rows[0].id, 'npc-180');
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    w.search(`角色${i}`);
    w.view();
  }
  const elapsed = performance.now() - start;
  t.diagnostic(`cached 200-row search/view 100 times: ${elapsed.toFixed(1)}ms (local unit, not production)`);
  assert.ok(elapsed < 3000);
  w.search('没有这个角色');
  assert.equal(w.view().total, 0);
  assert.equal(w.view().page, 1);
  w.search('');
  w.column('goals', false);
  assert.equal(
    w.view().rows[0].cells.some(c => c.fieldId === 'goals'),
    false,
  );
  w.filter('archived');
  assert.equal(w.view().total, 0);
});

test('T5 concealed rows/fields cannot leak through search, editor, picker or counts', async () => {
  const state = createDefaultT2Fixture();
  state.data.tables.location.find(r => r.meta.id === 'north-gate')!.meta.visibility.user = false;
  state.template.tables.find(t => t.id === 'npc')!.fields.find(f => f.id === 'goals')!.hiddenUi = true;
  const secret = state.data.tables.npc[0].values.goals;
  const f = await fixture(state),
    w = f.workbench;
  w.selectTable('npc');
  w.beginEdit('lin-watch');
  assert.equal(
    w.view().editor!.fields.some(f => f.field.id === 'goals'),
    false,
  );
  const location = w.view().editor!.fields.find(f => f.field.id === 'location')!;
  assert.equal(
    location.choices.some(c => c.reference.rowId === 'north-gate'),
    false,
  );
  assert.deepEqual(location.input.references, []);
  assert.equal(location.writable, false);
  assert.match(location.current, /未公开/);
  assert.equal(JSON.stringify(w.view()).includes(String(secret)), false);
  w.search(String(secret));
  assert.equal(w.view().total, 0);
});

test('T5 row/field locks and archive use separate commits and preserve replay/reload', async () => {
  const f = await fixture(createMinimalT2Fixture()),
    w = f.workbench;
  w.selectTable('npc');
  w.stageControl('traveler', 'field-lock', 'goals', true);
  await save(w);
  w.beginEdit('traveler');
  assert.throws(() => set(w, 'goals', { text: '绕过锁' }), /字段锁定/);
  w.cancelEditor();
  assert.throws(() => w.stageControl('traveler', 'archive', null, true), /控制操作被拒绝/);
  w.stageControl('traveler', 'field-lock', 'goals', false);
  await save(w);
  w.stageControl('traveler', 'archive', null, true);
  await save(w);
  assert.equal(w.view().rows.length, 0);
  w.filter('archived');
  assert.equal(w.view().rows.length, 1);
  w.stageControl('traveler', 'row-lock', null, true);
  await save(w);
  w.beginEdit('traveler');
  assert.equal(
    w.view().editor!.fields.every(f => !f.writable),
    true,
  );
  w.cancelEditor();
  const replay = await replayT4Suffix(await f.store.read(scope), null, async () => {
    throw new Error('metadata has no SQL');
  });
  assert.deepEqual(replay, f.service.view().formal);
  assert.equal(f.store.statistics.writes, 4);
});

test('T5 metadata authorization uses original locks, not earlier unlock controls, and rejects hidden/extra data', () => {
  const state = createMinimalT2Fixture();
  state.data.tables.npc[0].meta.locked = true;
  const unlock: T5Control = {
    tableId: 'npc',
    rowId: 'traveler',
    kind: 'row-lock',
    fieldId: null,
    before: true,
    after: false,
  };
  const archive: T5Control = { ...unlock, kind: 'archive', before: false, after: true };
  assert.throws(() => applyT5Controls(state, [unlock, archive]), /CONTROL/);
  assert.throws(() => applyT5Controls(state, [{ ...unlock, values: { goals: 'injection' } }]));
  assert.equal(state.data.tables.npc[0].meta.locked, true);
});

test('T5 metadata checkpoint cannot smuggle business edits under a freshly computed fingerprint', async () => {
  const f = await fixture(createMinimalT2Fixture()),
    w = f.workbench;
  w.selectTable('npc');
  w.stageControl('traveler', 'row-lock', null, true);
  await save(w);
  const archive = await f.store.read(scope);
  const original = clone(archive.commits[0]);
  original.snapshot.state.data.tables.npc[0].values.goals = '伪造业务修改';
  original.afterStateFingerprint = await fingerprintT4(original.snapshot.state);
  original.snapshot.afterFingerprint = original.afterStateFingerprint;
  const { fingerprint: _fingerprint, ...unsigned } = original;
  archive.commits[0] = await sealT4Commit(unsigned);
  await assert.rejects(validateT4Archive(archive));
});

test('T5 controlled deletion requires confirmation, refuses referenced/locked rows, and saves unreferenced row', async () => {
  const f = await fixture(createDefaultT2Fixture()),
    w = f.workbench;
  w.selectTable('location');
  assert.throws(() => w.stageDelete('north-gate', false), /确认/);
  assert.throws(() => w.stageDelete('north-gate', true), /仍被引用/);
  w.selectTable('npc');
  w.beginNew();
  set(w, 'name', { text: '仅沙盒待删' });
  w.stageEditor();
  await save(w);
  const id = f.service.view().formal.data.tables.npc.find(r => r.values.name === '仅沙盒待删')!.meta.id;
  w.stageDelete(id, true);
  await save(w);
  assert.equal(
    f.service.view().formal.data.tables.npc.some(r => r.meta.id === id),
    false,
  );
});

const source = () => ({
  sheet_npc: {
    name: '角色资料表',
    content: [['中文姓名', '自定义身份'], ...Array.from({ length: 42 }, (_, i) => [`来源角色${i}`, `来源背景${i}`])],
  },
});
const plan = {
  sourceId: 'fixed-source',
  sheetId: 'sheet_npc',
  tableId: 'npc',
  mapping: [
    { column: 0, fieldId: 'name' },
    { column: 1, fieldId: 'identity' },
  ],
};
test('T5 real-shaped SPDB 42 rows map to 42 NPC previews, not one sheet-name character', async () => {
  const f = await fixture(),
    state = f.service.view().formal,
    input = source(),
    before = JSON.stringify(input);
  const sheets = readT5Sheets(input),
    preview = await previewT5Import(state, sheets[0], plan);
  assert.equal(preview.total, 42);
  assert.equal(
    preview.rows.every(r => r.allowed),
    true,
  );
  assert.equal(preview.rows[41].values.name, '来源角色41');
  assert.equal(JSON.stringify(input), before);
  assert.throws(
    () =>
      selectT5Import(
        preview,
        Array.from({ length: 11 }, (_, i) => i),
      ),
    /最多|1–10/,
  );
});
test('T5 explicitly selected import rows save stable identity and do not duplicate after recovery', async () => {
  const f = await fixture(),
    w = f.workbench;
  w.selectTable('npc');
  w.loadImport(source());
  await w.previewImport(plan);
  w.stageImport([0, 41]);
  await save(w);
  assert.equal(f.service.view().formal.data.tables.npc.length, 2);
  const f2 = await createT5Sandbox({ scope, execute, storage: f.exportStorage(), withMockAnchor: true });
  f2.workbench.selectTable('npc');
  f2.workbench.loadImport(source());
  await f2.workbench.previewImport(plan);
  assert.equal(f2.workbench.view().importPreview!.rows[0].allowed, false);
  assert.equal(f2.workbench.view().importPreview!.rows[41].allowed, false);
  assert.throws(() => f2.workbench.stageImport([0]), /不可导入/);
  assert.equal(f2.store.statistics.writes, 0);
});
test('T5 malformed sources, duplicate mappings and wrong types never write or overwrite locked data', async () => {
  assert.throws(() => readT5Sheets({ rows: [{ name: 'wrong' }] }), /sheet_/);
  assert.throws(() => readT5Sheets({ sheet_bad: { content: [['a'], ['one', 'two']] } }), /列数/);
  const f = await fixture(createDefaultT2Fixture()),
    state = f.service.view().formal;
  state.data.tables.npc[0].meta.locked = true;
  await assert.rejects(
    previewT5Import(state, readT5Sheets(source())[0], {
      ...plan,
      mapping: [
        { column: 0, fieldId: 'name' },
        { column: 1, fieldId: 'name' },
      ],
    }),
  );
  const preview = await previewT5Import(state, readT5Sheets({ sheet_npc: { content: [['名称'], [123]] } })[0], {
    ...plan,
    mapping: [{ column: 0, fieldId: 'name' }],
  });
  assert.equal(preview.rows[0].allowed, false);
  assert.equal(state.data.tables.npc[0].meta.locked, true);
  assert.equal(f.store.statistics.writes, 0);
});

test('T5 typed codec covers every T2 type and all semantic empty values', () => {
  const state = createCustomT2Fixture();
  const cases: [string, string, Partial<T5Input>, T2Cell][] = [
    ['npc', 'name', { text: '全名' }, '全名'],
    ['npc', 'goals', { text: '长文'.repeat(200) }, '长文'.repeat(200)],
    ['environment', 'risk', { text: '0' }, 0],
    ['environment', 'temperature', { text: '-2.5' }, -2.5],
    ['market', 'unit_price', { text: '0.00' }, '0.00'],
    ['market', 'open', { checked: false }, false],
    ['npc', 'status', { text: '休整' }, '休整'],
    ['market', 'goods', { text: '' }, []],
    [
      'npc',
      'location',
      { references: [{ tableId: 'location', rowId: 'north-gate' }] },
      { tableId: 'location', rowId: 'north-gate' },
    ],
    ['npc', 'organizations', { references: [] }, []],
    [
      'environment',
      'observed_time',
      { minute: '0', display: '元年起点' },
      { calendarId: 'demo-calendar', ordinalMinute: 0, display: '元年起点' },
    ],
    ['npc', 'identity', { text: '' }, ''],
    ['npc', 'location', { mode: 'null' }, null],
  ];
  for (const [tableId, fieldId, patch, expected] of cases) {
    const field = state.template.tables.find(t => t.id === tableId)!.fields.find(f => f.id === fieldId)!;
    assert.deepEqual(parseT5Input(field, { ...inputT5Cell(field), mode: 'value', ...patch }, state), expected);
    assert.equal(parseT5Input(field, inputT5Cell(field), state), undefined);
  }
});
test('T5 typed codec rejects invalid numbers, precision, enum, duplicate lists, refs and world time', () => {
  const state = createCustomT2Fixture();
  const cases: [string, string, Partial<T5Input>][] = [
    ['environment', 'risk', { text: '' }],
    ['environment', 'risk', { text: '1.5' }],
    ['market', 'unit_price', { text: '1.234' }],
    ['npc', 'status', { text: 'foo' }],
    ['market', 'goods', { text: 'a\na' }],
    ['npc', 'location', { references: [{ tableId: 'location', rowId: 'missing' }] }],
    ['environment', 'observed_time', { minute: '0.5', display: 'wrong' }],
  ];
  for (const [tableId, fieldId, patch] of cases) {
    const field = state.template.tables.find(t => t.id === tableId)!.fields.find(f => f.id === fieldId)!;
    assert.throws(() => parseT5Input(field, { ...inputT5Cell(field), mode: 'value', ...patch }, state));
  }
});
test('T5 SQL injection-like text is a bound value, never concatenated into SQL', () => {
  const state = createDefaultT2Fixture(),
    value = "'; DELETE FROM we_npc; --";
  const compiled = compileT5Action(state, {
    kind: 'update',
    tableId: 'npc',
    rowId: 'lin-watch',
    values: { goals: value },
  });
  assert.equal(compiled.sql.includes(value), false);
  assert.deepEqual(compiled.parameters, [value, 'lin-watch']);
});
test('T5 exact archive memo does not cache corruption or share mutable returned snapshots', async () => {
  const f = await fixture(createMinimalT2Fixture());
  const archive = await f.store.read(scope);
  const first = await validateT4Archive(archive);
  first.genesis.data.tables.npc[0].values.goals = 'mutated caller';
  const second = await validateT4Archive(archive);
  assert.notEqual(second.genesis.data.tables.npc[0].values.goals, 'mutated caller');
  const corrupt = clone(archive);
  corrupt.genesis.data.tables.npc[0].values.goals = 'tamper';
  await assert.rejects(validateT4Archive(corrupt));
  assert.deepEqual(await validateT4Archive(archive), second);
});
test('T5 fixtures remain schema-valid and controls never change source or business values', () => {
  const state = createMinimalT2Fixture();
  const edited = applyT5Controls(state, [
    { tableId: 'npc', rowId: 'traveler', kind: 'row-lock', fieldId: null, before: false, after: true },
  ]);
  assert.deepEqual(edited.data.tables.npc[0].values, state.data.tables.npc[0].values);
  assert.deepEqual(edited.data.tables.npc[0].meta.source, state.data.tables.npc[0].meta.source);
  assert.deepEqual(normalizeT2WorldData(edited.template, edited.data), edited.data);
  assert.ok(prepareT2NewRow(state.template, 'npc', 'new-manual', { name: '测试' }));
});
test('T5 reconciliation and deletion cannot silently discard an unprepared editor draft', async () => {
  const f = await fixture(createMinimalT2Fixture()),
    w = f.workbench;
  w.selectTable('npc');
  w.beginEdit('traveler');
  set(w, 'goals', { text: '未暂存输入' });
  const before = w.draftFingerprint();
  await assert.rejects(w.reconcile(), /草稿仍保留/);
  assert.throws(() => w.stageDelete('traveler', true), /不会替你丢弃/);
  assert.equal(w.draftFingerprint(), before);
  assert.equal(f.store.statistics.writes, 0);
});
test('T5 unchanged archive memo still checks changed active anchors at the atomic write boundary', async () => {
  const f = await fixture(createMinimalT2Fixture()),
    w = f.workbench;
  await validateT4Archive(await f.store.read(scope));
  w.selectTable('npc');
  w.beginEdit('traveler');
  set(w, 'goals', { text: '锚点失效' });
  w.stageEditor();
  await w.prepare();
  f.store.selectAnchor(scope.chatId, null);
  w.consent(true);
  await w.save();
  assert.equal(f.store.statistics.writes, 0);
  assert.match(w.view().error!, /锚点/);
});
