import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { executeT3Request } from './t3-engine';
import { fingerprintT4 } from './t4-protocol';
import { createT15Session, parseT15File, T15_CAPABILITIES, type T15Session } from './t15-session';
import type { T9Options } from './t9-round';
import { newT6Table } from './t6-editor';
const sqlite = initSqlJs();
const execute = async (request: Parameters<typeof executeT3Request>[1]) => executeT3Request(await sqlite, request);
const reply = (sql: string, parameters: unknown[] = []) => ({ status: 200, text: JSON.stringify({ sql, parameters }) });
async function setup(response?: T9Options['reply']) {
  return createT15Session({ execute, reply: response });
}
async function add(s: T15Session, table: string, name: string) {
  s.data.selectTable(table);
  s.data.beginNew();
  const f = s.data.view().editor!.fields.find(f => f.field.id === 'name')!;
  s.data.setInput('name', { ...f.input, mode: 'value', text: name });
  assert.equal(s.data.stageEditor(), true);
  await s.data.prepare();
  s.data.consent(true);
  await s.data.save();
  assert.equal(s.data.view().error, null);
  return s.service.view().formal.data.tables[table].at(-1)!.meta.id;
}
async function migrate(
  s: T15Session,
  fn: (t: ReturnType<T15Session['service']['view']>['formal']['template']) => void,
) {
  const t = s.service.view().formal.template;
  fn(t);
  s.structure.replaceTemplate(t);
  await s.structure.prepare();
  s.structure.consent(true);
  await s.structure.save();
  assert.equal(s.structure.view().error, null);
}
async function run(s: T15Session, id = `r-${crypto.randomUUID()}`) {
  const task = await s.round.start(id);
  await task.done;
  return s.round.view();
}
test('T15 one authority opens empty with no network, save, real host or projection capability', async () => {
  const s = await setup();
  await s.refresh();
  assert.equal(s.data.view().tables.length, 7);
  assert.ok(s.data.view().tables.every(t => t.count === 0));
  assert.equal(s.store.statistics.writes, 0);
  assert.equal(s.book.statistics.writes, 0);
  assert.equal(s.round.view().sent, 0);
  assert.deepEqual(s.capabilities, T15_CAPABILITIES);
  assert.equal(s.capabilities.realApi, false);
  assert.equal(s.service.view().formal.template.defaults.api.state, 'disabled');
  s.close();
});
test('T15 actual filling + DIY + prompts + file reopening retains same formal state without model/SQL', async () => {
  const s = await setup();
  await add(s, 'npc', '自主角色甲');
  await migrate(s, t => {
    t.tables.find(t => t.id === 'npc')!.description += '自定义说明';
  });
  s.generation.editPrompt('global', { state: 'value', value: '自定义全局规则' });
  s.generation.saveDraft();
  await s.generation.enable();
  s.generation.editPrompt('phase:micro', { state: 'value', value: '已保存但尚未启用的微观草稿' });
  s.generation.saveDraft();
  s.setAppearance({ theme: 'cream', scale: 125, density: 'compact', text: 'wrap' });
  const text = await s.exportWorkspace();
  const next = await createT15Session({
    file: await parseT15File(text),
    execute: async () => {
      throw new Error('opening cannot execute SQL');
    },
  });
  assert.deepEqual(next.service.view().formal, s.service.view().formal);
  assert.deepEqual(next.generation.exportPrompts(), s.generation.exportPrompts());
  assert.equal(next.readAppearance().scale, 125);
  assert.equal(next.store.statistics.writes, 0);
  assert.equal(next.apiPort.read().presets.length, 0);
  next.close();
  s.close();
});
test('T15 seven-table cap stays five after explicit simulation enable and no auto generation', async () => {
  const s = await setup();
  await assert.rejects(s.enableSimulation(false));
  await s.enableSimulation(true);
  assert.equal(s.service.view().formal.template.defaults.budget.maxRequests, 5);
  assert.equal(s.round.view().sent, 0);
  const writes = s.store.statistics.writes;
  const v = await run(s);
  assert.ok(v.sent <= 5);
  assert.equal(s.service.view().formal.template.defaults.budget.maxRequests, 5);
  assert.ok(s.store.statistics.writes <= writes + 1);
  s.close();
});
test('T15 filled macro→micro reads newest macro, one commit, projection from confirmed head, file recovery ledger', async () => {
  let environment = '',
    npc = '';
  const seen: string[] = [];
  const s = await setup(async request => {
    seen.push(request.tableId);
    if (request.tableId === 'environment')
      return reply('UPDATE we_environment SET f_weather = ? WHERE __we_row_id = ?', ['风暴', environment]);
    if (request.tableId === 'npc') {
      assert.match(request.messages[1].content, /风暴/);
      return reply('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', ['根据暴雨留守', npc]);
    }
    return reply(`SELECT __we_row_id FROM we_${request.tableId}`);
  });
  environment = await add(s, 'environment', '城区天气');
  npc = await add(s, 'npc', '角色甲');
  await migrate(s, t => {
    t.defaults.budget.maxRequests = 7;
  });
  await s.enableSimulation(true);
  await s.setStory('城区进入暴雨。');
  const writes = s.store.statistics.writes;
  const v = await run(s);
  assert.equal(v.status, 'saved', JSON.stringify(v.error));
  assert.equal(s.store.statistics.writes, writes + 1);
  assert.equal(s.data.view().revision, s.service.view().formal.data.revision);
  assert.ok(seen.indexOf('environment') < seen.indexOf('npc'));
  assert.equal(s.service.view().formal.data.tables.npc[0].values.last_action, '根据暴雨留守');
  await s.refresh();
  await s.projection.sync(true);
  assert.equal(s.projection.view().status, 'synced', s.projection.view().error ?? '');
  assert.match(JSON.stringify(s.book.exportBooks()), /根据暴雨留守/);
  const reopened = await createT15Session({ execute, file: await parseT15File(await s.exportWorkspace()) });
  assert.deepEqual(reopened.service.evolutionLedger(), s.service.evolutionLedger());
  assert.equal(reopened.readInput().eligibleRound, 2);
  assert.equal(reopened.book.statistics.writes, 0);
  reopened.close();
  s.close();
});
test('T15 ACK lost requires query not another SQL or model call; data editor and export stay blocked', async () => {
  const s = await setup();
  s.data.selectTable('npc');
  s.data.beginNew();
  const f = s.data.view().editor!.fields.find(f => f.field.id === 'name')!;
  s.data.setInput('name', { ...f.input, mode: 'value', text: '回执角色' });
  s.data.stageEditor();
  await s.data.prepare();
  s.store.queueWriteFault('ack-lost');
  s.data.consent(true);
  await s.data.save();
  assert.equal(s.service.view().status, 'pending');
  await assert.rejects(s.exportWorkspace());
  await s.data.reconcile();
  assert.equal(s.service.view().formal.data.tables.npc.length, 1);
  assert.equal(s.store.statistics.writes, 1);
  assert.equal(s.round.view().sent, 0);
  s.close();
});
test('T15 corrupt file and hash-valid host/multi-chat file rejected, keep current world intact', async () => {
  const s = await setup();
  await add(s, 'npc', '保留');
  const original = await s.exportWorkspace();
  const f = JSON.parse(original);
  f.payload.storage = '{}';
  await assert.rejects(parseT15File(JSON.stringify(f)));
  f.fingerprint = await fingerprintT4(f.payload);
  await assert.rejects(createT15Session({ execute, file: f }));
  const g = JSON.parse(original);
  g.payload.scope.mode = 't10-host';
  g.fingerprint = await fingerprintT4(g.payload);
  await assert.rejects(parseT15File(JSON.stringify(g)));
  const h = JSON.parse(original),
    raw = JSON.parse(h.payload.storage);
  raw.chats.push(raw.chats[0]);
  h.payload.storage = JSON.stringify(raw);
  h.fingerprint = await fingerprintT4(h.payload);
  await assert.rejects(createT15Session({ execute, file: h }));
  assert.equal(s.service.view().formal.data.tables.npc[0].values.name, '保留');
  s.close();
});
test('T15 API editor does not feed simulated engine or leak Key into workspace/backup', async () => {
  const s = await setup();
  const c = s.apiPort.read();
  c.presets = [
    {
      id: 'demo',
      name: '界面检查',
      provider: 'openai-compatible',
      endpoint: 'https://invalid.example',
      apiKey: 'secret-t15-never-export',
      model: 'example',
      enabled: true,
      timeoutMs: 1000,
      maxRetries: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  s.apiPort.save(c);
  assert.doesNotMatch(await s.exportWorkspace(), /secret-t15-never-export|apiKey|https:\/\//);
  await add(s, 'npc', 'secret-t15-never-export');
  await assert.rejects(s.exportWorkspace(), /Key/);
  s.close();
});
test('T15 dirty and active round prevent cross-page mutation, cancel rejects delayed fake result', async () => {
  let release!: (v: { status: number; text: string }) => void;
  const pending = new Promise<{ status: number; text: string }>(r => {
    release = r;
  });
  const s = await setup(async () => pending);
  await migrate(s, t => {
    t.defaults.budget.maxRequests = 7;
  });
  await s.enableSimulation(true);
  const writes = s.store.statistics.writes,
    task = await s.round.start('cancel-check');
  assert.throws(() => s.data.beginNew());
  await assert.rejects(s.exportWorkspace());
  assert.throws(() => s.structure.addTable('intrude', '侵入表', 'micro'));
  s.round.cancel();
  release(reply('SELECT __we_row_id FROM we_society'));
  await task.done;
  assert.equal(s.store.statistics.writes, writes);
  assert.equal(s.round.view().status, 'cancelled');
  s.close();
});
test('T15 custom DIY table flows through context, SQL, archive, reopen and projection (not a default fixture)', async () => {
  let rowId = '';
  const s = await setup(async request => {
    if (request.tableId === 'market') {
      assert.match(request.messages[1].content, /港口市场/);
      return reply('UPDATE we_market SET f_name = ? WHERE __we_row_id = ?', ['港口市场已调整', rowId]);
    }
    return reply(`SELECT __we_row_id FROM we_${request.tableId}`);
  });
  await migrate(s, t => {
    const table = newT6Table('market', '自定义市场', 'micro');
    table.export.enabled = true;
    table.export.keyFieldIds = ['name'];
    table.export.mode = 'per-row';
    t.tables.push(table);
    t.defaults.budget.maxRequests = 8;
  });
  rowId = await add(s, 'market', '港口市场');
  await s.enableSimulation(true);
  const v = await run(s);
  assert.equal(v.status, 'saved', JSON.stringify(v.error));
  await s.refresh();
  await s.projection.sync(true);
  assert.equal(s.projection.view().status, 'synced');
  assert.match(JSON.stringify(s.book.exportBooks()), /港口市场已调整/);
  const next = await createT15Session({ execute, file: await parseT15File(await s.exportWorkspace()) });
  assert.equal(next.service.view().formal.data.tables.market[0].values.name, '港口市场已调整');
  next.close();
  s.close();
});
test('T15 malformed SQL rolls back both stages; retry is not an implicit new request', async () => {
  let rowId = '';
  const s = await setup(async request =>
    request.tableId === 'environment'
      ? reply('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [60, rowId])
      : request.stage === 'micro'
        ? reply('DROP TABLE we_npc')
        : reply(`SELECT __we_row_id FROM we_${request.tableId}`),
  );
  rowId = await add(s, 'environment', '天气');
  await add(s, 'npc', '守卫');
  await migrate(s, t => {
    t.defaults.budget.maxRequests = 7;
  });
  await s.enableSimulation(true);
  const before = s.store.exportStorage(),
    v = await run(s);
  assert.equal(v.status, 'failed');
  assert.equal(s.store.exportStorage(), before);
  assert.equal(v.canResume, false);
  s.close();
});
test('T15 backup and history restore update all page views and keep the old checkpoint recoverable', async () => {
  const s = await setup();
  await add(s, 'npc', '可恢复角色');
  const file = await s.backup.backup('world', true);
  assert.ok(file);
  const saved = s.service.view().formal;
  await add(s, 'location', '临时地点');
  await s.daily.refresh();
  const first = (await s.store.read(s.scope)).commits[0].commitId;
  assert.equal(s.daily.selectHistory(first), true);
  assert.equal(s.daily.previewRestore(), true);
  assert.equal(await s.daily.confirmRestore(true), true, s.daily.view().error ?? 'restore failed');
  assert.equal(s.service.view().formal.data.tables.location.length, 0);
  assert.equal(s.data.view().tables.find(t => t.id === 'location')!.count, 0);
  assert.deepEqual(s.structure.view().template, s.service.view().formal.template);
  assert.equal(s.service.view().formal.data.tables.npc[0].values.name, saved.data.tables.npc[0].values.name);
  assert.equal((await s.store.read(s.scope)).commits.length, 3);
  s.close();
});
