import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createDefaultT2Fixture, createMinimalT2Fixture, createCustomT2Fixture } from './t2-defaults';
import { canonicalT4Json, fingerprintT4, validateT4Archive } from './t4-protocol';
import { createT4SandboxStore, type T4SaveInput } from './t4-store';
import { createT4CommitService, recoverT4Snapshot, replayT4Suffix } from './t4-service';
import { recoverT9Ledger, normalizeT9Ledger } from './t9-ledger';
import { createT9Sandbox } from './t9-sandbox';
import { createT9Round } from './t9-round';
import { normalizeT2Template } from './t2-template';
import { typeT6Field } from './t6-editor';
import { setupT9Test as setup, finishT9Test as finish, untilT9Test as until } from './t9-test-fixtures';
import {
  responseT8Test as response,
  deferredT8Test as deferred,
  cloneT8Test as clone,
  executeT8Test,
} from './t8-test-fixtures';

const noChange = (tableId: string) => response(`SELECT __we_row_id FROM we_${tableId}`);
test('T9 macro→micro reads new weather and saves one revision with time/rotation/frequency, not external data', async () => {
  const seen: string[] = [];
  const f = await setup(undefined, {
    reply: async request => {
      seen.push(request.stage);
      if (request.stage === 'macro')
        return response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [80, 'small-valley-weather']);
      assert.match(request.messages[1].content, /80/);
      return response('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', ['等待雨势减缓', 'traveler']);
    },
  });
  const before = f.service.view().formal;
  const v = await finish(f);
  assert.equal(v.status, 'saved', JSON.stringify(v.error));
  assert.deepEqual(seen, ['macro', 'micro']);
  assert.equal(v.sent, 2);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.service.view().formal.data.revision, before.data.revision + 1);
  assert.equal(f.service.view().formal.data.tables.environment[0].values.risk, 80);
  assert.equal(f.service.view().formal.data.tables.npc[0].values.last_action, '等待雨势减缓');
  const archive = await f.store.read(f.scope),
    commit = archive.commits[0];
  assert.deepEqual(
    commit.steps.map(s => s.policy.stage),
    ['macro', 'micro'],
  );
  assert.deepEqual(commit.evolution?.worldTime, f.input.now);
  assert.equal(commit.evolution?.progress.npc.lastSuccessfulRound, 1);
  assert.equal(commit.evolution?.progress.npc.rotation, 1);
  assert.deepEqual(f.store.readOtherData(f.scope.chatId), { externalMvu: 'unchanged', externalDatabase: 'unchanged' });
  assert.doesNotMatch(
    JSON.stringify([v, archive, f.store.exportStorage()]),
    /private-t8-key|invalid.example|Authorization|apiKey/,
  );
});

test('T9 all failed micro work leaves macro, time, successful round and rotation uncommitted', async () => {
  const f = await setup(undefined, {
    reply: async r =>
      r.stage === 'macro'
        ? response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [90, 'small-valley-weather'])
        : { status: 400, text: 'failure' },
  });
  const before = f.service.view();
  const v = await finish(f);
  assert.equal(v.status, 'paused');
  assert.equal(v.error?.code, 'MODEL');
  assert.deepEqual(f.service.view().formal, before.formal);
  assert.equal(f.service.view().evolution, null);
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(v.outcome, 'unknown');
});

test('T9 saved JSON recreates exactly same world and ledger without model or SQL; replay is explicit', async () => {
  const f = await setup(undefined, {
    reply: async r =>
      r.stage === 'macro'
        ? response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [90, 'small-valley-weather'])
        : noChange(r.tableId),
  });
  await finish(f);
  const store = createT4SandboxStore(f.store.exportStorage());
  const service = await createT4CommitService({
    scope: f.scope,
    store,
    execute: async () => {
      throw new Error('no SQL on open');
    },
  });
  assert.deepEqual(service.view().formal, f.service.view().formal);
  assert.deepEqual(service.view().evolution, f.service.view().evolution);
  assert.equal(store.statistics.writes, 0);
  const archive = await store.read(f.scope);
  assert.deepEqual(await recoverT4Snapshot(archive), service.view().formal);
  assert.deepEqual(await replayT4Suffix(archive, null, executeT8Test), service.view().formal);
});

test('T9 one runId and same trigger are idempotent, including simultaneous starts', async () => {
  const f = await setup();
  const [a, b] = await Promise.all([f.round.start('same'), f.round.start('same')]);
  await Promise.all([a.done, b.done]);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.round.view().sent, 2);
  const duplicate = await f.round.start('other');
  await duplicate.done;
  assert.equal(duplicate.duplicate, true);
  assert.equal(f.store.statistics.writes, 1);
});

test('T9 no-change success persists once and no-model all-skipped round has a sealed empty log', async () => {
  const f = await setup();
  const v = await finish(f);
  assert.equal(v.status, 'no-change');
  assert.equal(v.outcome, 'saved');
  assert.equal(f.service.view().evolution?.progress.environment.lastSuccessfulRound, 1);
  const state = createMinimalT2Fixture();
  state.template.phases.macro.enabled = false;
  state.template.phases.micro.enabled = false;
  const g = await setup(state, {
    reply: async () => {
      throw new Error('must not call model');
    },
  });
  assert.equal((await finish(g)).status, 'no-change');
  assert.equal(g.round.view().sent, 0);
  const c = (await g.store.read(g.scope)).commits[0];
  assert.deepEqual(c.steps, []);
  assert.deepEqual(c.evolution?.processedTableIds, []);
  assert.equal(g.store.statistics.writes, 1);
});

test('T9 missing or invalid micro route blocks save rather than treating it as no change', async () => {
  const state = createMinimalT2Fixture();
  state.template.tables.find(t => t.id === 'npc')!.runtime.api = { state: 'value', value: { presetId: 'missing' } };
  const f = await setup(state);
  const v = await finish(f);
  assert.equal(v.error?.code, 'PLAN');
  assert.equal(f.store.statistics.writes, 0);
});

test('T9 environment→access→NPC action; later organization reads already-staged NPC; same names use IDs', async () => {
  const state = createDefaultT2Fixture();
  state.template.defaults.budget.maxRequests = 10;
  const seen: string[] = [];
  const f = await setup(state, {
    reply: async r => {
      seen.push(r.tableId);
      if (r.tableId === 'environment')
        return response('UPDATE we_environment SET f_weather = ? WHERE __we_row_id = ?', ['风暴', 'harbor-weather']);
      if (r.tableId === 'location') {
        assert.match(r.messages[1].content, /风暴/);
        return response('UPDATE we_location SET f_access = ? WHERE __we_row_id = ?', ['封闭', 'north-gate']);
      }
      if (r.tableId === 'npc') {
        assert.match(r.messages[1].content, /封闭/);
        return response('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', [
          '转为驻地协助，暂停出门',
          'lin-watch',
        ]);
      }
      if (r.tableId === 'organization') {
        assert.match(r.messages[1].content, /转为驻地协助/);
        return response('UPDATE we_organization SET f_action_arrangements = ? WHERE __we_row_id = ?', [
          '在驻地分发沙袋',
          'watch',
        ]);
      }
      if (r.tableId === 'plan')
        return response('UPDATE we_plan SET f_status = ?, f_result = ? WHERE __we_row_id = ?', [
          '受阻',
          '封路无法前往',
          'gate-drainage',
        ]);
      return noChange(r.tableId);
    },
  });
  const v = await finish(f);
  assert.equal(v.status, 'saved', JSON.stringify(v.error));
  assert.deepEqual(seen, ['society', 'environment', 'location', 'npc', 'organization', 'plan']);
  const data = f.service.view().formal.data;
  assert.equal(data.tables.npc.find(r => r.meta.id === 'lin-watch')!.values.last_action, '转为驻地协助，暂停出门');
  assert.notEqual(
    data.tables.npc.find(r => r.meta.id === 'lin-merchant')!.values.last_action,
    '转为驻地协助，暂停出门',
  );
  assert.ok(v.micro?.candidates.find(c => c.rowId === 'lin-watch')?.reasons.includes('最新宏观影响/位置'));
  assert.equal(data.tables.plan.length, 2);
  assert.equal(data.tables.plan[1].meta.archived, true);
});

for (const [label, sql, parameters] of [
  [
    'dangling reference',
    'UPDATE we_npc SET f_location = ? WHERE __we_row_id = ?',
    [{ tableId: 'location', rowId: 'absent' }, 'traveler'],
  ],
  ['readonly field', 'UPDATE we_npc SET f_editor_note = ? WHERE __we_row_id = ?', ['leak', 'traveler']],
  ['invalid type', 'UPDATE we_npc SET f_status = ? WHERE __we_row_id = ?', ['任意状态', 'traveler']],
  ['physical lifecycle delete', 'DELETE FROM we_npc WHERE __we_row_id = ?', ['traveler']],
  ['metadata archive', 'UPDATE we_npc SET __we_archived = ? WHERE __we_row_id = ?', [true, 'traveler']],
  ['DDL', 'DROP TABLE we_npc', []],
] as const)
  test(`T9 ${label} rejects entire round`, async () => {
    const f = await setup(undefined, {
      reply: async r => (r.stage === 'macro' ? noChange(r.tableId) : response(sql, [...parameters])),
    });
    const v = await finish(f);
    assert.equal(v.error?.code, 'SQL');
    assert.equal(f.store.statistics.writes, 0);
  });

for (const text of [
  'not json',
  '```json\n{"sql":"SELECT __we_row_id FROM we_npc","parameters":[]}\n```',
  '{"sql":"SELECT __we_row_id FROM we_npc","parameters":[],"extra":true}',
])
  test('T9 invalid response stops without blind retry: ' + text.slice(0, 12), async () => {
    const f = await setup(undefined, {
      reply: async r => (r.stage === 'macro' ? noChange(r.tableId) : { status: 200, text }),
    });
    const v = await finish(f);
    assert.equal(v.error?.code, 'RESPONSE');
    assert.equal(v.canResume, false);
    assert.equal(f.store.statistics.writes, 0);
  });

test('T9 custom macro and non-default micro table flow through SQL, ordered context, save and recovery', async () => {
  const state = createCustomT2Fixture();
  state.template.defaults.budget.maxRequests = 10;
  const custom = clone(state.template.tables.find(t => t.id === 'npc')!);
  custom.id = 'agents';
  custom.sqlName = 'we_agents';
  custom.name = '自定义探员';
  custom.purpose = 'custom';
  custom.context.relatedTableIds = ['environment', 'market', 'npc'];
  state.template.tables.push(custom);
  state.data.tables.agents = [clone(state.data.tables.npc[0])];
  state.data.tables.agents[0].meta.id = 'agent';
  const f = await setup(state, {
    reply: async r =>
      r.tableId === 'agents'
        ? response('UPDATE we_agents SET f_last_action = ? WHERE __we_row_id = ?', ['自定义表行动', 'agent'])
        : r.tableId === 'market'
          ? response('UPDATE we_market SET f_open = ? WHERE __we_row_id = ?', [true, 'harbor-market'])
          : noChange(r.tableId),
  });
  const v = await finish(f);
  assert.equal(v.status, 'saved', JSON.stringify(v.error));
  const archive = await f.store.read(f.scope),
    recovered = await recoverT4Snapshot(archive);
  assert.equal(recovered.data.tables.market[0].values.open, true);
  assert.equal(recovered.data.tables.agents[0].values.last_action, '自定义表行动');
  assert.ok(v.batches.some(b => b.tableId === 'agents'));
});

test('T9 successful macro is reused for explicit micro retry, never reset shared counters', async () => {
  let fail = true;
  const seen: string[] = [];
  const f = await setup(undefined, {
    reply: async r => {
      seen.push(r.tableId);
      return r.stage === 'micro' && fail ? { status: 400, text: 'fail' } : noChange(r.tableId);
    },
  });
  let v = await finish(f);
  assert.equal(v.status, 'paused');
  fail = false;
  await f.round.resume();
  v = f.round.view();
  assert.equal(v.status, 'no-change', JSON.stringify(v.error));
  assert.deepEqual(seen, ['environment', 'npc', 'npc']);
  assert.equal(v.sent, 3);
  assert.equal(f.store.statistics.writes, 1);
});

test('T9 known save failure retries identical receipt without any AI or SQL regeneration', async () => {
  const f = await setup();
  f.store.queueWriteFault('save-failed');
  let v = await finish(f);
  assert.equal(v.error?.code, 'SAVE');
  assert.equal(f.store.statistics.writes, 0);
  const receipt = clone(f.service.view().draft);
  const sends = v.sent;
  await f.round.resume();
  v = f.round.view();
  assert.equal(v.status, 'no-change');
  assert.equal(v.sent, sends);
  assert.deepEqual(f.service.view().draft, receipt);
  assert.equal(f.store.statistics.writes, 1);
});

test('T9 lost ACK is pending, only reconciliation establishes saved state without duplicate writes', async () => {
  const f = await setup();
  f.store.queueWriteFault('ack-lost');
  let v = await finish(f);
  assert.equal(v.status, 'pending');
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.service.view().formal.data.revision, 1);
  await assert.rejects(f.round.resume());
  const sends = v.sent;
  f.store.queueReadFailure();
  await f.round.reconcile();
  assert.equal(f.round.view().status, 'pending');
  await f.round.reconcile();
  v = f.round.view();
  assert.equal(v.status, 'no-change');
  assert.equal(v.sent, sends);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.service.view().formal.data.revision, 2);
});

test('T9 manual edit committed during micro rejects old macro before any save', async () => {
  const gate = deferred<{ status: number; text: string }>();
  const f = await setup(undefined, { reply: async r => (r.stage === 'micro' ? gate.promise : noChange(r.tableId)) });
  const started = await f.round.start('conflict');
  await until(() => f.round.view().batches.some(b => b.status === 'sending'));
  const hash = await fingerprintT4('manual');
  await f.service.prepareSql({
    runId: 'manual',
    commitId: 'manual',
    kind: 'manual',
    anchor: f.input.anchor,
    context: {
      inputFingerprint: f.input.anchor.inputFingerprint,
      promptFingerprint: hash,
      modelFingerprint: hash,
      parametersFingerprint: hash,
    },
    batches: [
      {
        batchId: 'edit',
        sql: 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?',
        parameters: ['人工编辑', 'traveler'],
        policy: {
          actor: 'manual',
          stage: null,
          read: [],
          write: [{ tableId: 'npc', rowIds: ['traveler'], fieldIds: ['goals'] }],
          insertTableIds: [],
        },
      },
    ],
  });
  await f.service.save();
  gate.resolve(noChange('npc'));
  await started.done;
  assert.equal(f.round.view().status, 'stale');
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.service.view().formal.data.tables.environment[0].values.risk, 30);
});

for (const change of ['story', 'swipe', 'branch', 'time', 'selected', 'permissions'] as const)
  test('T9 frozen ' + change + ' change rejects result', async () => {
    const gate = deferred<{ status: number; text: string }>();
    let allowed = true;
    const f = await setup(undefined, {
      canRun: () => allowed,
      reply: async r => (r.stage === 'micro' ? gate.promise : noChange(r.tableId)),
    });
    const started = await f.round.start('stale');
    await until(() => f.round.view().batches.some(b => b.status === 'sending'));
    if (change === 'story') f.input.story[0].text += 'changed';
    if (change === 'swipe') f.input.anchor.swipeId = 's2';
    if (change === 'branch') f.input.branchId = 'different';
    if (change === 'time') f.input.now!.ordinalMinute++;
    if (change === 'selected') f.input.selected.push({ tableId: 'npc', rowId: 'traveler' });
    if (change === 'permissions') allowed = false;
    gate.resolve(noChange('npc'));
    await started.done;
    assert.equal(f.round.view().status, 'stale');
    assert.equal(f.store.statistics.writes, 0);
  });

test('T9 ordinary API/prompt edits do not switch frozen request or invalidate result', async () => {
  const gate = deferred<{ status: number; text: string }>();
  const f = await setup(undefined, {
    reply: async r => {
      if (r.stage === 'macro') return gate.promise;
      assert.equal(r.route.model, 'model-fake');
      return noChange(r.tableId);
    },
  });
  const start = await f.round.start('frozen');
  await until(() => f.round.view().macro.batches.some(b => b.status === 'sending'));
  f.api.presets[0].model = 'new-model';
  f.api.presets[0].apiKey = 'new-secret';
  f.prompts.revision++;
  gate.resolve(noChange('environment'));
  await start.done;
  assert.equal(f.round.view().status, 'no-change');
});

test('T9 HTTP cancellation stops next micro batch and rejects late callback', async () => {
  const gate = deferred<{ status: number; text: string }>();
  const state = createDefaultT2Fixture();
  state.template.defaults.budget.maxRequests = 10;
  const f = await setup(state, { reply: async r => (r.tableId === 'npc' ? gate.promise : noChange(r.tableId)) });
  const start = await f.round.start('cancel');
  await until(() => f.round.view().sent === 4);
  f.round.cancel();
  await start.done;
  assert.equal(f.round.view().status, 'cancelled');
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(f.round.view().sent, 4);
  gate.resolve(noChange('npc'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.store.statistics.writes, 0);
});

test('T9 cancel at durable write boundary uses receipt, not false rollback claim', async () => {
  let cancel = () => {};
  const f = await setup(undefined, {}, store => ({
    ...store,
    compareAndSwap: async (input: T4SaveInput) => {
      await store.compareAndSwap(input);
      cancel();
    },
  }));
  cancel = () => f.round.cancel();
  const v = await finish(f);
  assert.equal(v.status, 'no-change');
  assert.equal(v.outcome, 'saved');
  assert.equal(f.store.statistics.writes, 1);
});

test('T9 zero Key leaks through output; whole round rejected before persistence', async () => {
  const f = await setup(undefined, {
    reply: async r =>
      r.stage === 'micro'
        ? response('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', ['private-t8-key-no-leak', 'traveler'])
        : noChange(r.tableId),
  });
  const v = await finish(f);
  assert.equal(f.store.statistics.writes, 0);
  assert.doesNotMatch(JSON.stringify(v), /private-t8-key/);
});

test('T9 local sandbox explicitly registers matching fixture anchor and reloads without requests', async () => {
  const f = await setup();
  const args = { execute: executeT8Test, scope: f.scope, initial: f.state, input: f.input, api: f.api };
  const sandbox = await createT9Sandbox(args);
  await (
    await sandbox.round.start('factory')
  ).done;
  assert.equal(sandbox.round.view().status, 'no-change');
  const rebuilt = await createT9Sandbox({
    ...args,
    storage: sandbox.exportStorage(),
    runtime: {
      reply: async () => {
        throw new Error('no refresh model');
      },
    },
  });
  assert.equal(rebuilt.round.view().status, 'idle');
  assert.deepEqual(rebuilt.service.view().formal, sandbox.service.view().formal);
  assert.deepEqual(rebuilt.service.view().evolution, sandbox.service.view().evolution);
});

test('T9 restoring a historical checkpoint restores its progress rather than retaining future rotation', async () => {
  const f = await setup();
  await finish(f);
  const ledger = clone(f.service.view().evolution);
  const hash = await fingerprintT4('restore');
  await f.service.prepareRestore({
    runId: 'restore',
    commitId: 'restore',
    anchor: f.input.anchor,
    context: {
      inputFingerprint: f.input.anchor.inputFingerprint,
      promptFingerprint: hash,
      modelFingerprint: hash,
      parametersFingerprint: hash,
    },
    sourceCommitId: null,
  });
  await f.service.save();
  assert.equal(f.service.view().evolution, null);
  assert.ok(ledger);
  assert.equal(recoverT9Ledger(await f.store.read(f.scope)), null);
});

test('T9 ledger validators reject forged counts, duplicate/unknown tables and invalid calendar', () => {
  const state = createMinimalT2Fixture();
  const base = {
    version: 1,
    frozenInputFingerprint: 'a'.repeat(64),
    eligibleRound: 1,
    worldTime: null,
    progress: {},
    processedTableIds: [],
    sent: 0,
    maxRequests: 5,
  };
  assert.ok(normalizeT9Ledger(base, state));
  for (const patch of [
    { sent: 6 },
    { processedTableIds: ['npc', 'npc'] },
    { progress: { unknown: { lastSuccessfulRound: 1, rotation: 0 } } },
    { worldTime: { calendarId: 'no-calendar', ordinalMinute: 1 } },
    { progress: { npc: { lastSuccessfulRound: 2, rotation: 0 } } },
    { apiKey: 'bad' },
  ])
    assert.throws(() => normalizeT9Ledger({ ...base, ...patch }, state));
});

test('T9 modules remain unregistered local factories, never host/network/build entry', () => {
  for (const name of ['t9-round.ts', 't9-sandbox.ts', 't9-ledger.ts'])
    assert.doesNotMatch(
      readFileSync(`src/世界演变/rebuild/${name}`, 'utf8'),
      /\bfetch\(|TavernHelper|eventOn\(|replaceWorldbook|localStorage|IndexedDB|\$\(\s*(?:async\s*)?\(/,
    );
});

test('T9 restored saved trigger is recognized from JSON; refresh never regenerates it', async () => {
  const f = await setup();
  await finish(f);
  const store = createT4SandboxStore(f.store.exportStorage());
  const service = await createT4CommitService({
    scope: f.scope,
    store,
    execute: async () => {
      throw new Error('no SQL');
    },
  });
  const round = createT9Round({
    ...f.options,
    service,
    reply: async () => {
      throw new Error('no model');
    },
  });
  const started = await round.start('refreshed');
  await started.done;
  assert.equal(started.duplicate, true);
  assert.equal(started.runId, 't9-run');
  assert.equal(store.statistics.writes, 0);
  assert.equal(round.view().sent, 0);
  assert.equal(service.view().formal.data.revision, 2);
});

test('T9 a saved round updates table UI without clearing newly entered drafts', async () => {
  const f = await setup(),
    sandbox = await createT9Sandbox({
      execute: executeT8Test,
      scope: f.scope,
      initial: f.state,
      input: f.input,
      api: f.api,
      runtime: {
        reply: async r =>
          r.stage === 'micro'
            ? response('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', ['表格应立刻可见', 'traveler'])
            : noChange(r.tableId),
      },
    });
  await (
    await sandbox.round.start('refresh-table')
  ).done;
  sandbox.workbench.selectTable('npc');
  assert.match(JSON.stringify(sandbox.workbench.view()), /表格应立刻可见/);
  sandbox.workbench.beginNew();
  const name = clone(sandbox.workbench.view().editor!.fields.find(f => f.field.id === 'name')!.input);
  name.mode = 'value';
  name.text = '未保存新角色';
  sandbox.workbench.setInput('name', name);
  assert.equal(sandbox.workbench.refreshSaved(), false);
  assert.match(JSON.stringify(sandbox.workbench.view().editor), /未保存新角色/);
});

test('T9 exactly three sends shared by macro/client retry/micro, exhausted retries never save or reset', async () => {
  const state = createMinimalT2Fixture();
  state.template.defaults.budget.maxRequests = 3;
  const f = await setup(state, {
    reply: async (r, attempt) =>
      r.stage === 'macro' && attempt === 1 ? { status: 502, text: 'temporary' } : noChange(r.tableId),
  });
  f.api.presets[0].maxRetries = 1;
  let v = await finish(f);
  assert.equal(v.status, 'no-change', JSON.stringify(v.error));
  assert.equal(v.sent, 3);
  assert.equal(f.store.statistics.writes, 1);
  const g = await setup(state, {
    reply: async r => (r.stage === 'micro' ? { status: 502, text: 'temporary' } : noChange(r.tableId)),
  });
  g.api.presets[0].maxRetries = 2;
  v = await finish(g);
  assert.equal(v.error?.code, 'BUDGET');
  assert.equal(v.sent, 3);
  assert.equal(g.store.statistics.writes, 0);
  await assert.rejects(g.round.resume());
});

test('T9 queue owns complete macro/micro/save round, not only macro phase', async () => {
  const gate = deferred<{ status: number; text: string }>();
  const f = await setup(undefined, { reply: async r => (r.stage === 'micro' ? gate.promise : noChange(r.tableId)) });
  const start = await f.round.start('queue-round');
  await until(() => f.round.view().sent === 2);
  let second = false;
  const later = f.queue.schedule('different-key', 'second', 'second-owner', async () => {
    second = true;
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(second, false);
  gate.resolve(noChange('npc'));
  await start.done;
  await later.done;
  assert.equal(second, true);
  assert.equal(f.store.statistics.writes, 1);
});

test('T9 SQL cancellation rejects a late worker result and never saves', async () => {
  const gate = deferred<Awaited<ReturnType<typeof executeT8Test>>>();
  let microSignal: AbortSignal | undefined;
  const f = await setup(undefined, {
    execute: async (req, opts) => {
      if (req.policy.stage === 'micro') {
        microSignal = opts?.signal;
        return gate.promise;
      }
      return executeT8Test(req, opts);
    },
  });
  const start = await f.round.start('sql-cancel');
  await until(() => !!microSignal);
  f.round.cancel();
  await start.done;
  assert.equal(microSignal!.aborted, true);
  assert.equal(f.round.view().status, 'cancelled');
  assert.equal(f.store.statistics.writes, 0);
});

test('T9 SQL timeout and expired macro cannot be reused for new micro', async () => {
  const f = await setup(undefined, {
    sqlTimeoutMs: 500,
    execute: async (req, opts) => (req.policy.stage === 'micro' ? new Promise(() => {}) : executeT8Test(req, opts)),
  });
  const v = await finish(f);
  assert.equal(v.error?.code, 'TIMEOUT');
  assert.equal(f.store.statistics.writes, 0);
  await assert.rejects(f.round.resume());
  let fail = true;
  const g = await setup(undefined, {
    runTimeoutMs: 1500,
    reply: async r => (r.stage === 'micro' && fail ? { status: 400, text: 'fail' } : noChange(r.tableId)),
  });
  await finish(g);
  await new Promise(resolve => setTimeout(resolve, 1600));
  fail = false;
  const sent = g.round.view().sent;
  await g.round.resume();
  assert.equal(g.round.view().status, 'stale');
  assert.equal(g.round.view().sent, sent);
  assert.equal(g.store.statistics.writes, 0);
});

test('T9 save cancelled before CAS is cancelled, not retryable save failure', async () => {
  let cancel = () => {};
  const f = await setup(undefined, {}, store => ({
    ...store,
    compareAndSwap: async (input: T4SaveInput) => {
      cancel();
      await store.compareAndSwap(input);
    },
  }));
  cancel = () => f.round.cancel();
  const v = await finish(f);
  assert.equal(v.status, 'cancelled');
  assert.equal(v.canResume, false);
  assert.equal(f.store.statistics.writes, 0);
});

test('T9 same-run resume after source/permission change is rejected without another send', async () => {
  const f = await setup(undefined, {
    reply: async r => (r.stage === 'micro' ? { status: 400, text: 'failure' } : noChange(r.tableId)),
  });
  await finish(f);
  const sent = f.round.view().sent;
  f.input.story[0].text += 'new source';
  await f.round.resume();
  assert.equal(f.round.view().status, 'stale');
  assert.equal(f.round.view().sent, sent);
  assert.equal(f.store.statistics.writes, 0);
});

test('T9 committed frequency and fairness rotate background rows across rounds, not previews', async () => {
  const state = createMinimalT2Fixture();
  state.template.tables.find(t => t.id === 'npc')!.runtime.budget = {
    state: 'value',
    value: { maxRows: 1, maxNewRows: 0, maxRequests: 2, maxContextChars: 20000 },
  };
  const npc = state.data.tables.npc[0];
  state.data.tables.npc.push({ ...clone(npc), meta: { ...clone(npc.meta), id: 'other' } });
  const f = await setup(state);
  await finish(f);
  assert.equal(f.round.view().batches[0].request.policy.write[0].rowIds[0], 'traveler');
  assert.equal(f.service.view().evolution?.progress.npc.rotation, 1);
  f.input.eligibleRound = 2;
  f.input.anchor.messageId = 'a9';
  f.input.story[0].messageId = 'a9';
  f.input.now!.ordinalMinute++;
  f.store.registerAnchor(f.input.anchor);
  await finish(f, 'round-two');
  assert.equal(f.round.view().status, 'no-change');
  assert.equal(f.round.view().macro.sent, 0);
  assert.equal(f.round.view().batches[0].request.policy.write[0].rowIds[0], 'other');
  assert.equal(f.service.view().evolution?.progress.npc.rotation, 2);
  assert.equal(f.service.view().evolution?.progress.environment.lastSuccessfulRound, 1);
});

test('T9 lifecycle cannot automatically resurrect a terminal NPC, including custom enum fields', async () => {
  const state = createMinimalT2Fixture();
  state.data.tables.npc[0].values.status = '死亡';
  const f = await setup(state, {
    reply: async r =>
      r.stage === 'micro'
        ? response('UPDATE we_npc SET f_status = ? WHERE __we_row_id = ?', ['活跃', 'traveler'])
        : noChange(r.tableId),
  });
  const v = await finish(f);
  assert.equal(v.error?.code, 'SQL');
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(f.service.view().formal.data.tables.npc[0].values.status, '死亡');
});

test('T9 actual-action time cannot invent a future or unknown current time; future deadlines remain valid', async () => {
  for (const now of [15000, null]) {
    const f = await setup(undefined, {
      reply: async r =>
        r.stage === 'micro'
          ? response('UPDATE we_npc SET f_last_action_time = ? WHERE __we_row_id = ?', [
              { calendarId: 'demo-calendar', ordinalMinute: 15001, display: '未来行动' },
              'traveler',
            ])
          : noChange(r.tableId),
    });
    if (now === null) f.input.now = null;
    const v = await finish(f);
    assert.equal(v.error?.code, 'SQL');
    assert.equal(f.store.statistics.writes, 0);
  }
});

test('T9 DIY title and deadline mappings survive renamed field IDs; no name-only identity assumptions', async () => {
  const state = createDefaultT2Fixture();
  state.template.defaults.budget.maxRequests = 10;
  const npc = state.template.tables.find(t => t.id === 'npc')!;
  const label = npc.fields.find(f => f.id === 'name')!;
  label.id = 'caption';
  label.sqlName = 'f_caption';
  npc.export.titleFieldId = 'caption';
  npc.context.fieldIds = npc.context.fieldIds.map(id => (id === 'name' ? 'caption' : id));
  npc.export.fieldIds = npc.export.fieldIds.map(id => (id === 'name' ? 'caption' : id));
  npc.export.keyFieldIds = npc.export.keyFieldIds.map(id => (id === 'name' ? 'caption' : id));
  for (const row of state.data.tables.npc) {
    row.values.caption = row.values.name;
    delete row.values.name;
  }
  const plan = state.template.tables.find(t => t.id === 'plan')!;
  const deadline = plan.fields.find(f => f.id === 'deadline')!;
  deadline.id = 'due_at';
  deadline.sqlName = 'f_due_at';
  plan.context.fieldIds = plan.context.fieldIds.map(id => (id === 'deadline' ? 'due_at' : id));
  plan.export.fieldIds = plan.export.fieldIds.map(id => (id === 'deadline' ? 'due_at' : id));
  for (const row of state.data.tables.plan) {
    row.values.due_at = row.values.deadline;
    delete row.values.deadline;
  }
  const f = await setup(state);
  f.input.story[0].text += '林澄';
  const v = await finish(f);
  assert.equal(v.status, 'no-change', JSON.stringify(v.error));
  assert.ok(v.micro?.candidates.find(c => c.rowId === 'lin-watch')?.reasons.includes('剧情直接关联'));
  assert.ok(v.micro?.candidates.find(c => c.rowId === 'gate-drainage')?.reasons.includes('到期计划'));
  assert.match(v.batches.find(b => b.tableId === 'plan')!.request.messages[0].content, /deadline/);
});

test('T9 terminal-state/time meaning is typed and incompatible type switch clears time meaning', () => {
  const state = createMinimalT2Fixture(),
    copy = clone(state.template);
  copy.tables[0].fields[0].semantic = 'deadline';
  assert.throws(() => normalizeT2Template(copy));
  const bad = clone(state.template);
  bad.tables.find(t => t.id === 'npc')!.fields.find(f => f.id === 'status')!.constraints.terminalValues = ['未知终态'];
  assert.throws(() => normalizeT2Template(bad));
  const time = state.template.tables.find(t => t.id === 'npc')!.fields.find(f => f.id === 'last_action_time')!;
  assert.equal(typeT6Field(time, 'text', state.template).semantic, undefined);
});

test('T9 immutable checkpoint preserves completed plan history instead of restarting its lifecycle', async () => {
  const state = createDefaultT2Fixture();
  state.template.defaults.budget.maxRequests = 10;
  state.data.tables.plan[0].values.status = '完成';
  const f = await setup(state, {
    reply: async r =>
      r.tableId === 'plan'
        ? response('UPDATE we_plan SET f_status = ? WHERE __we_row_id = ?', ['进行中', 'gate-drainage'])
        : noChange(r.tableId),
  });
  const view = await finish(f);
  assert.equal(view.status, 'no-change', JSON.stringify(view.error));
  assert.equal(view.micro?.candidates.find(c => c.rowId === 'gate-drainage')?.writable, false);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.service.view().formal.data.tables.plan[0].values.status, '完成');
});

test('T9 source budget and frozen candidates also apply to later refreshed micro requests', async () => {
  const state = createDefaultT2Fixture();
  state.template.defaults.budget.maxRequests = 10;
  let failed = false;
  const seen: string[] = [];
  const f = await setup(state, {
    reply: async r => {
      seen.push(r.tableId);
      if (r.tableId === 'organization' && !failed) {
        failed = true;
        return { status: 400, text: 'failure' };
      }
      return noChange(r.tableId);
    },
  });
  const first = await finish(f);
  assert.equal(first.status, 'paused');
  assert.equal(f.store.statistics.writes, 0);
  const npcInput = first.batches.find(b => b.tableId === 'npc')!.request.fingerprint;
  await f.round.resume();
  assert.equal(f.round.view().status, 'no-change', JSON.stringify(f.round.view().error));
  assert.equal(seen.filter(id => id === 'npc').length, 1);
  assert.equal(seen.filter(id => id === 'environment').length, 1);
  assert.equal(f.round.view().batches.find(b => b.tableId === 'npc')!.request.fingerprint, npcInput);
  assert.equal(f.store.statistics.writes, 1);
});

for (const change of ['story', 'ownership', 'permissions'] as const)
  test('T9 rechecks ' + change + ' at the atomic write boundary, after final preview check', async () => {
    let allowed = true,
      mutate = () => {};
    const f = await setup(undefined, { canRun: () => allowed }, store => ({
      ...store,
      compareAndSwap: async (input: T4SaveInput) => {
        mutate();
        await store.compareAndSwap(input);
      },
    }));
    mutate = () => {
      if (change === 'story') f.input.story[0].text += 'changed at write';
      if (change === 'ownership') f.queue.revoke(f.round.view().macro.triggerKey!);
      if (change === 'permissions') allowed = false;
    };
    const v = await finish(f);
    assert.equal(v.status, 'stale', JSON.stringify(v.error));
    assert.equal(f.store.statistics.writes, 0);
    assert.equal(f.service.view().formal.data.revision, 1);
  });

test('T9 saved receipt remains identifiable if a later manual commit appears before unknown-ACK reconciliation', async () => {
  const f = await setup();
  f.store.queueWriteFault('ack-lost');
  await finish(f);
  assert.equal(f.round.view().status, 'pending');
  const later = await createT4CommitService({ scope: f.scope, store: f.store, execute: executeT8Test });
  const hash = await fingerprintT4('later');
  await later.prepareSql({
    runId: 'later',
    commitId: 'later',
    kind: 'manual',
    anchor: f.input.anchor,
    context: {
      inputFingerprint: f.input.anchor.inputFingerprint,
      promptFingerprint: hash,
      modelFingerprint: hash,
      parametersFingerprint: hash,
    },
    batches: [
      {
        batchId: 'later',
        sql: 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?',
        parameters: ['后续人工记录', 'traveler'],
        policy: {
          actor: 'manual',
          stage: null,
          read: [],
          write: [{ tableId: 'npc', rowIds: ['traveler'], fieldIds: ['goals'] }],
          insertTableIds: [],
        },
      },
    ],
  });
  await later.save();
  await f.round.reconcile();
  assert.equal(f.round.view().status, 'no-change');
  assert.equal(f.round.view().commitId, 'c-t9-run');
  assert.equal(f.round.view().savedRevision, 2);
  assert.equal(f.service.view().formal.data.revision, 3);
  assert.equal(f.service.view().formal.data.tables.npc[0].values.goals, '后续人工记录');
  assert.equal(f.store.statistics.writes, 2);
});
