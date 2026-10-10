import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { createEmptyWorldEvolutionApiConfiguration, type WorldEvolutionApiConfiguration } from '../api-config';
import { createMinimalT2Fixture, createDefaultT2Fixture, createCustomT2Fixture } from './t2-defaults';
import { cloneT2Json } from './t2-template';
import { executeT3Request } from './t3-engine';
import { fingerprintT4, type T4State } from './t4-protocol';
import {
  adaptT7Database,
  adaptT7Mvu,
  adaptT7Worldbook,
  inspectT7Prerequisites,
  normalizeT7Input,
  type T7Input,
} from './t7-input';
import { createT7Prompts, createT7PromptStore, resolveT7Prompt } from './t7-prompts';
import { createT7Run, type T7Run } from './t7-run';
import { createT7Workbench } from './t7-workbench';
import { createT7Sandbox } from './t7-sandbox';

const clone = <T>(input: T) => cloneT2Json(input) as unknown as T;
function configuration(): WorldEvolutionApiConfiguration {
  const config = createEmptyWorldEvolutionApiConfiguration(0);
  config.presets = ['first', 'second'].map(id => ({
    id,
    name: id,
    provider: 'openai-compatible',
    endpoint: 'https://invalid.example/chat/completions',
    model: `model-${id}`,
    apiKey: `secret-${id}-never-preview`,
    enabled: true,
    timeoutMs: 1000,
    maxRetries: 2,
    createdAt: 0,
    updatedAt: 0,
  }));
  config.routing.primaryPresetId = 'second';
  return config;
}
function inputFor(state: T4State): T7Input {
  return {
    anchor: { chatId: 'sandbox-t7', messageId: 'assistant-7', swipeId: 'swipe-0', inputFingerprint: 'a'.repeat(64) },
    worldId: state.data.worldId,
    branchId: state.data.branchId,
    eligibleRound: 1,
    story: [
      { messageId: 'old-6', role: 'assistant', text: '之前的天气平稳。' },
      { messageId: 'assistant-7', role: 'assistant', text: '本轮暴雨加剧，北门道路受到影响。' },
    ],
    segments: [],
    proofs: [],
    selected: [],
    progress: {},
    now: null,
  };
}
function setup(state: T4State = createMinimalT2Fixture()) {
  state.template.defaults.api = { state: 'value', value: { presetId: 'first' } };
  return {
    runId: 'test-run',
    state,
    input: inputFor(state),
    prompts: createT7Prompts(state.template),
    api: configuration(),
  };
}
async function micro(run: T7Run, state: T4State) {
  await run.plan('macro');
  await run.provideMacro({ runId: run.view().runId, inputFingerprint: run.view().inputFingerprint, data: state.data });
  return run.plan('micro');
}
async function proof(input: T7Input, sourceId = 'db') {
  const value = {
    sourceId,
    required: true,
    state: 'success' as const,
    identity: { ...input.anchor, worldId: input.worldId, branchId: input.branchId },
    sourceCommitId: 'db-commit-7',
    resultFingerprint: await fingerprintT4(input.segments.filter(s => s.sourceId === sourceId)),
    persisted: true,
    requirePersisted: true,
    reason: '',
  };
  input.proofs.push(value);
  return value;
}

test('T7 exact macro messages use old macro and enabled table lifecycle rules, no Key or endpoint', async () => {
  const opts = setup(),
    run = await createT7Run(opts),
    plan = await run.plan('macro'),
    request = plan.requests[0];
  assert.equal(plan.status, 'final');
  assert.equal(plan.requests.length, 1);
  assert.match(JSON.stringify(request.messages), /旧宏观|宏观条件|small-valley-weather/);
  assert.match(JSON.stringify(request.messages), new RegExp(opts.state.template.tables[0].rules.update.slice(0, 8)));
  assert.equal(
    request.chars,
    request.messages.reduce((n, m) => n + m.content.length, 0),
  );
  assert.doesNotMatch(JSON.stringify(run.view()), /secret-first|secret-second|invalid.example|Authorization/);
});
test('T7 micro is pending, then uses supplied latest macro and previous micro only', async () => {
  const opts = setup(),
    run = await createT7Run(opts);
  assert.equal((await run.plan('micro')).status, 'pending-macro');
  assert.deepEqual(run.view().micro.requests, []);
  await run.plan('macro');
  const latest = clone(opts.state.data);
  latest.tables.environment[0].values.summary = '暴雨';
  await run.provideMacro({ runId: run.view().runId, inputFingerprint: run.view().inputFingerprint, data: latest });
  const plan = await run.plan('micro');
  assert.equal(plan.status, 'final');
  assert.match(JSON.stringify(plan.requests[0].messages), /暴雨/);
  assert.match(JSON.stringify(plan.requests[0].messages), /陈望/);
  assert.deepEqual(opts.state.data.tables.environment[0].values.weather, '雨');
});
test('T7 macro impact selects an unmentioned NPC by stable location relation', async () => {
  const opts = setup(createDefaultT2Fixture()),
    run = await createT7Run(opts);
  await run.plan('macro');
  const latest = clone(opts.state.data);
  latest.tables.environment[0].values.summary = '暴雨加强';
  await run.provideMacro({ runId: run.view().runId, inputFingerprint: run.view().inputFingerprint, data: latest });
  const plan = await run.plan('micro');
  assert.ok(
    plan.candidates.find(c => c.tableId === 'npc' && c.rowId === 'lin-watch')?.reasons.includes('最新宏观影响/位置'),
  );
});
test('T7 same-name NPCs keep distinct IDs, renamed NPC/custom table participates', async () => {
  const opts = setup(createCustomT2Fixture());
  opts.input.story.at(-1)!.text = '林澄在雾港集市观察暴雨。';
  opts.state.template.tables.find(t => t.id === 'npc')!.name = '人物日志';
  opts.state.template.defaults.budget.maxRequests = 10;
  const run = await createT7Run(opts),
    macro = await run.plan('macro');
  assert.ok(macro.requests.some(r => r.tableId === 'market'));
  const plan = await micro(run, opts.state);
  assert.equal(plan.candidates.filter(c => c.tableId === 'npc' && c.selected).length, 2);
  assert.deepEqual(
    plan.candidates.filter(c => c.tableId === 'npc').map(c => c.rowId),
    ['lin-watch', 'lin-merchant'],
  );
});
test('T7 routes resolve global → phase → table, and explicit disable cannot fallback', async () => {
  const opts = setup();
  opts.state.template.phases.micro.api = { state: 'value', value: { presetId: 'second' } };
  let run = await createT7Run(opts);
  assert.equal((await run.plan('macro')).tables[0].route.source, 'global');
  assert.equal((await micro(run, opts.state)).tables[0].route.source, 'phase');
  opts.state.template.tables.find(t => t.id === 'npc')!.runtime.api = { state: 'value', value: { presetId: 'first' } };
  run = await createT7Run(opts);
  assert.equal((await micro(run, opts.state)).tables[0].route.source, 'table');
  opts.state.template.tables[0].runtime.api = { state: 'disabled' };
  run = await createT7Run(opts);
  assert.equal((await run.plan('macro')).requests.length, 0);
  assert.match(run.view().macro!.tables[0].skip!, /禁用/);
});
for (const change of ['missing', 'disabled', 'model', 'key'] as const)
  test(`T7 API ${change} blocks rather than borrowing legacy default`, async () => {
    const opts = setup();
    if (change === 'missing') opts.state.template.defaults.api = { state: 'value', value: { presetId: 'unknown' } };
    if (change === 'disabled') opts.api.presets[0].enabled = false;
    if (change === 'model') opts.api.presets[0].model = '';
    if (change === 'key') opts.api.presets[0].apiKey = '';
    const run = await createT7Run(opts),
      plan = await run.plan('macro');
    assert.equal(plan.requests.length, 0);
    assert.equal(run.view().sent, 0);
  });
test('T7 mutating input/template/prompts/API or returned metadata cannot alter frozen messages/model', async () => {
  const opts = setup(),
    run = await createT7Run(opts),
    plan = await run.plan('macro'),
    before = clone(plan.requests[0]);
  opts.runId = 'mutated';
  opts.api.presets[0].model = 'changed';
  opts.api.presets[0].apiKey = 'changed-key';
  opts.prompts.global = 'changed-global';
  opts.input.story.at(-1)!.text = 'changed-story';
  opts.state.template.tables[0].rules.update = 'changed-rule';
  plan.requests[0].messages[0].content = 'mutated-view';
  assert.deepEqual((await run.plan('macro')).requests[0], before);
  assert.equal(run.view().runId, 'test-run');
  assert.equal(run.view().macro!.requests[0].route.model, 'model-first');
});
test('T7 enabled/draft/save/freeze versions are separate and only next run changes', async () => {
  const opts = setup(),
    store = await createT7PromptStore(opts.state.template),
    before = store.view();
  const draft = clone(before.draft);
  draft.global = 'ONLY_NEXT_ENABLED';
  store.edit(draft);
  assert.equal(store.view().enabled.global, before.enabled.global);
  store.saveDraft();
  assert.equal(store.view().enabled.global, before.enabled.global);
  const run = await createT7Run({ ...opts, prompts: store.view().enabled });
  const request = (await run.plan('macro')).requests[0];
  await store.enable(before.enabledFingerprint);
  assert.equal(store.view().enabled.revision, 2);
  assert.doesNotMatch(request.messages[0].content, /ONLY_NEXT_ENABLED/);
  const next = await createT7Run({ ...opts, prompts: store.view().enabled });
  assert.match((await next.plan('macro')).requests[0].messages[0].content, /ONLY_NEXT_ENABLED/);
  await assert.rejects(store.enable(before.enabledFingerprint));
});
test('T7 prompt inheritance retains global safeguards; disabled guidance never disables lifecycle rules', () => {
  const opts = setup();
  opts.prompts.tables.npc = { state: 'value', value: 'TABLE_NPC' };
  assert.equal(resolveT7Prompt(opts.prompts, 'npc', 'micro').source, 'table');
  opts.prompts.tables.npc = { state: 'disabled' };
  const resolved = resolveT7Prompt(opts.prompts, 'npc', 'micro');
  assert.equal(resolved.disabled, true);
  assert.ok(resolved.global.length);
  opts.prompts.phases.micro = { state: 'inherit' };
  delete opts.prompts.tables.npc;
  assert.equal(resolveT7Prompt(opts.prompts, 'npc', 'micro').source, 'global');
});
test('T7 new enabled field and rule actually enter the next request, denied field is absent', async () => {
  const opts = setup(),
    env = opts.state.template.tables[0],
    f = clone(env.fields[0]);
  f.id = 'extra';
  f.sqlName = 'f_extra';
  f.name = '新增可读列';
  f.required = false;
  env.fields.push(f);
  env.context.fieldIds.push('extra');
  opts.state.data.tables.environment[0].values.extra = 'NEW_FIELD_VALUE';
  env.rules.update = 'NEW_ENABLED_RULE';
  const run = await createT7Run(opts),
    request = (await run.plan('macro')).requests[0];
  assert.match(JSON.stringify(request.messages), /NEW_FIELD_VALUE|NEW_ENABLED_RULE/);
  opts.state.template.tables[0].fields.find(f => f.id === 'extra')!.visibility.evolutionAi = false;
  const blocked = await createT7Run(opts);
  assert.doesNotMatch(JSON.stringify((await blocked.plan('macro')).requests), /NEW_FIELD_VALUE|新增可读列/);
});
test('T7 main-AI private column may reach evolution; hiddenUi does not grant/deny AI; editor secret absent', async () => {
  const opts = setup(createDefaultT2Fixture());
  opts.state.template.defaults.budget.maxRequests = 10;
  const npc = opts.state.template.tables.find(t => t.id === 'npc')!,
    row = opts.state.data.tables.npc[0];
  row.values.private_goal = 'EVOLUTION_ONLY';
  row.values.editor_note = 'USER_EDITOR_SECRET';
  npc.fields.find(f => f.id === 'private_goal')!.hiddenUi = true;
  const run = await createT7Run(opts),
    plan = await micro(run, opts.state),
    text = JSON.stringify(plan.requests);
  assert.match(text, /EVOLUTION_ONLY/);
  assert.doesNotMatch(text, /USER_EDITOR_SECRET|f_editor_note/);
});
test('T7 unreadable row and references do not leak hidden stable IDs into previews', async () => {
  const opts = setup(createDefaultT2Fixture());
  opts.state.template.defaults.budget.maxRequests = 10;
  opts.state.data.tables.location[1].meta.visibility.evolutionAi = false;
  opts.state.data.tables.npc[0].meta.visibility.evolutionAi = false;
  const run = await createT7Run(opts),
    macro = await run.plan('macro'),
    microPlan = await micro(run, opts.state);
  assert.doesNotMatch(JSON.stringify([...macro.requests, ...microPlan.requests]), /lin-watch|north-gate/);
});
test('T7 locked and disabled macro stays readable to micro without write grant', async () => {
  const opts = setup();
  opts.state.template.tables[0].runtime.enabled = false;
  opts.state.template.tables[0].locked = true;
  const run = await createT7Run(opts),
    macro = await run.plan('macro');
  assert.equal(macro.requests.length, 0);
  const plan = await micro(run, opts.state),
    req = plan.requests[0];
  assert.match(JSON.stringify(req.messages), /small-valley-weather/);
  assert.ok(req.policy.read.some(g => g.tableId === 'environment'));
  assert.ok(req.policy.write.every(g => g.tableId === 'npc'));
});
test('T7 locked NPC is read-only condition and cannot appear in write scope', async () => {
  const opts = setup();
  opts.state.data.tables.npc[0].meta.locked = true;
  opts.input.selected = [{ tableId: 'npc', rowId: 'traveler' }];
  const other = clone(opts.state.data.tables.npc[0]);
  other.meta.id = 'other';
  other.meta.locked = false;
  other.values.name = '另一人';
  opts.state.data.tables.npc.push(other);
  const run = await createT7Run(opts),
    req = (await micro(run, opts.state)).requests[0];
  assert.match(JSON.stringify(req.messages), /traveler/);
  assert.ok(req.policy.write.every(g => !g.rowIds.includes('traveler')));
});
test('T7 unrelated same-table row outside candidates is not sent', async () => {
  const opts = setup(),
    table = opts.state.template.tables.find(t => t.id === 'npc')!;
  for (let i = 0; i < 3; i++) {
    const row = clone(opts.state.data.tables.npc[0]);
    row.meta.id = `outside-${i}`;
    row.values.name = `无关人${i}`;
    opts.state.data.tables.npc.push(row);
  }
  table.runtime.budget = {
    state: 'value',
    value: { maxRows: 1, maxNewRows: 0, maxRequests: 1, maxContextChars: 16000 },
  };
  const run = await createT7Run(opts),
    plan = await micro(run, opts.state);
  assert.equal(plan.candidates.filter(c => c.selected).length, 1);
  assert.doesNotMatch(JSON.stringify(plan.requests), /无关人0|无关人1|无关人2/);
  assert.ok(plan.candidates.some(c => c.skipped === '候选数量预算截取'));
});
test('T7 bounded rotation changes only via explicitly supplied committed marker; failures do not advance', async () => {
  const opts = setup(),
    table = opts.state.template.tables.find(t => t.id === 'npc')!;
  const row = clone(opts.state.data.tables.npc[0]);
  row.meta.id = 'other';
  row.values.name = '另一人';
  opts.state.data.tables.npc.push(row);
  table.runtime.budget = {
    state: 'value',
    value: { maxRows: 1, maxNewRows: 0, maxRequests: 1, maxContextChars: 16000 },
  };
  let run = await createT7Run(opts),
    plan = await micro(run, opts.state);
  const first = plan.candidates.find(c => c.selected)!;
  assert.equal(opts.input.progress.npc, undefined);
  await run.simulate(plan.requests[0].id, { responses: [{ status: 400, text: 'failed' }] });
  assert.equal(plan.tables[0].rotationProposal, 1);
  assert.equal(opts.input.progress.npc, undefined);
  opts.input.progress.npc = { rotation: 1, lastSuccessfulRound: null };
  run = await createT7Run(opts);
  plan = await micro(run, opts.state);
  assert.notEqual(plan.candidates.find(c => c.selected)!.rowId, first.rowId);
});
test('T7 one-slot candidate budget prioritizes direct plot and still reserves periodic background turns', async () => {
  const opts = setup(),
    table = opts.state.template.tables.find(t => t.id === 'npc')!;
  const other = clone(opts.state.data.tables.npc[0]);
  other.meta.id = 'other';
  other.values.name = '未被提及的人';
  opts.state.data.tables.npc.push(other);
  table.runtime.budget = {
    state: 'value',
    value: { maxRows: 1, maxNewRows: 0, maxRequests: 1, maxContextChars: 16000 },
  };
  opts.input.story.at(-1)!.text = '陈望继续赶路。';
  let run = await createT7Run(opts);
  assert.equal((await micro(run, opts.state)).candidates.find(c => c.selected)?.rowId, 'traveler');
  opts.input.eligibleRound = 4;
  run = await createT7Run(opts);
  assert.equal((await micro(run, opts.state)).candidates.find(c => c.selected)?.rowId, 'other');
});
test('T7 macro rows outside priority also use committed rotation instead of always taking first records', async () => {
  const opts = setup(),
    table = opts.state.template.tables[0],
    other = clone(opts.state.data.tables.environment[0]);
  other.meta.id = 'other-env';
  other.values.name = '另一地区天气';
  opts.state.data.tables.environment.push(other);
  table.runtime.budget = {
    state: 'value',
    value: { maxRows: 1, maxNewRows: 0, maxRequests: 1, maxContextChars: 16000 },
  };
  opts.input.progress.environment = { lastSuccessfulRound: null, rotation: 1 };
  const run = await createT7Run(opts),
    plan = await run.plan('macro');
  assert.equal(plan.candidates.find(c => c.selected)?.rowId, 'other-env');
  assert.equal(plan.tables[0].rotationProposal, 2);
});
test('T7 frequencies use committed eligible rounds, not message number or attempted calls', async () => {
  const opts = setup();
  opts.state.template.tables[0].runtime.frequency = {
    state: 'value',
    value: { unit: 'eligible-story-round', every: 3, offset: 1 },
  };
  opts.input.progress.environment = { lastSuccessfulRound: 1, rotation: 0 };
  opts.input.eligibleRound = 3;
  let run = await createT7Run(opts);
  assert.equal((await run.plan('macro')).requests.length, 0);
  opts.input.eligibleRound = 4;
  run = await createT7Run(opts);
  assert.equal((await run.plan('macro')).requests.length, 1);
});
test('T7 due plans use configured world calendar minute, not wall clock', async () => {
  const opts = setup(createDefaultT2Fixture());
  opts.state.template.defaults.budget.maxRequests = 10;
  opts.input.now = { calendarId: 'demo-calendar', ordinalMinute: 100000 };
  const run = await createT7Run(opts),
    plan = await micro(run, opts.state);
  assert.ok(plan.candidates.find(c => c.rowId === 'gate-drainage')?.reasons.includes('到期计划'));
});
test('T7 selected external sources match exact source, scope and verified result fingerprint', async () => {
  const opts = setup();
  opts.input.segments = [
    { source: 'database', sourceId: 'db', label: '本轮数据库结果', text: 'VERIFIED_DB', tableIds: ['environment'] },
  ];
  await proof(opts.input);
  const run = await createT7Run(opts);
  assert.equal(run.view().ready, true);
  assert.match(JSON.stringify((await run.plan('macro')).requests), /VERIFIED_DB/);
  const plan = await micro(run, opts.state);
  assert.doesNotMatch(JSON.stringify(plan.requests), /VERIFIED_DB/);
});
for (const bad of [
  'swipe',
  'message',
  'world',
  'input',
  'persisted',
  'result',
  'commit',
  'failure',
  'waiting',
] as const)
  test(`T7 ${bad} prerequisite does not release requests`, async () => {
    const opts = setup();
    const p = await proof(opts.input);
    if (bad === 'swipe') p.identity.swipeId = 'older';
    if (bad === 'message') p.identity.messageId = 'older';
    if (bad === 'world') p.identity.worldId = 'older';
    if (bad === 'input') p.identity.inputFingerprint = 'b'.repeat(64);
    if (bad === 'persisted') p.persisted = false;
    if (bad === 'result') p.resultFingerprint = 'c'.repeat(64);
    if (bad === 'commit') p.sourceCommitId = null as unknown as string;
    if (bad === 'failure') p.state = 'failure' as 'success';
    if (bad === 'waiting') p.state = 'waiting' as 'success';
    const run = await createT7Run(opts);
    assert.equal(run.view().ready, false);
    assert.equal((await run.plan('macro')).requests.length, 0);
  });
test('T7 one success does not hide another necessary failure; optional missing never contributes stale data', async () => {
  const opts = setup();
  await proof(opts.input, 'mvu');
  const other = await proof(opts.input, 'db');
  other.state = 'failure' as 'success';
  assert.equal((await inspectT7Prerequisites(opts.input)).ready, false);
  other.required = false;
  assert.equal((await inspectT7Prerequisites(opts.input)).ready, true);
});
test('T7 explicit skip is identity bound and requires a reason, and never reads skipped source', async () => {
  const opts = setup();
  opts.input.segments = [
    { source: 'database', sourceId: 'db', label: '旧结果', text: 'OLD_DB_NEVER_SEND', tableIds: [] },
  ];
  const p = await proof(opts.input);
  p.state = 'frequency-skipped' as 'success';
  p.reason = '本轮未到频率';
  const run = await createT7Run(opts);
  assert.equal(run.view().ready, true);
  assert.doesNotMatch(JSON.stringify((await run.plan('macro')).requests), /OLD_DB_NEVER_SEND/);
  p.reason = '';
  assert.equal((await inspectT7Prerequisites(opts.input)).ready, false);
});
test('T7 source adapters use real 2D sheet shape and exclude unselected columns/rows', () => {
  const fixture = {
    sheet_npc: {
      name: '人物',
      content: [['姓名', '秘密'], ...Array.from({ length: 42 }, (_, i) => [`人物${i}`, `secret-${i}`])],
    },
  };
  const all = adaptT7Database(fixture, {
    sourceId: 'db',
    sheetId: 'sheet_npc',
    columns: [0],
    rowIndices: Array.from({ length: 42 }, (_, i) => i),
    tableIds: ['npc'],
  });
  assert.equal(JSON.parse(all.text).rows.length, 42);
  assert.doesNotMatch(all.text, /secret-/);
  const one = adaptT7Database(fixture, {
    sourceId: 'db',
    sheetId: 'sheet_npc',
    columns: [0],
    rowIndices: [3],
    tableIds: ['npc'],
  });
  assert.deepEqual(JSON.parse(one.text).rows, [['人物3']]);
  assert.throws(() =>
    adaptT7Database(
      { rows: [{ name: 'fake' }] },
      { sourceId: 'db', sheetId: 'sheet_npc', columns: [0], rowIndices: [0], tableIds: [] },
    ),
  );
});
test('T7 MVU explicit stat_data path and worldbook originals only; no own projection feedback', () => {
  const source = { stat_data: { 天气: '雨', 秘密: 'MVU_SECRET' }, other: 'PRIVATE' };
  const mvu = adaptT7Mvu(source, 'mvu', [{ path: ['stat_data', '天气'], label: '天气', tableIds: ['environment'] }]);
  assert.equal(mvu[0].text, '"雨"');
  assert.doesNotMatch(JSON.stringify(mvu), /MVU_SECRET|PRIVATE/);
  assert.throws(() => adaptT7Mvu(source, 'mvu', [{ path: ['missing'], label: 'missing', tableIds: [] }]));
  const worldbook = adaptT7Worldbook(
    [
      { name: '设定', content: 'ORIGINAL', enabled: true },
      { name: 'WorldEvolution-NPC-甲', content: 'OWN_OLD', enabled: true },
    ],
    'worldbook',
    ['设定', 'WorldEvolution-NPC-甲'],
    ['npc'],
  );
  assert.equal(worldbook.length, 1);
  assert.equal(worldbook[0].text, 'ORIGINAL');
});
test('T7 budgets omit whole source blocks with reasons, never truncate structured JSON', async () => {
  const opts = setup();
  opts.input.segments = [
    { source: 'database', sourceId: 'db', label: '超长已选来源', text: 'x'.repeat(50000), tableIds: [] },
  ];
  await proof(opts.input);
  const run = await createT7Run(opts),
    request = (await run.plan('macro')).requests[0];
  assert.ok(request.omitted.some(x => x.source === 'database' && x.reason.includes('字符预算')));
  assert.ok(request.chars <= 20000);
  assert.equal(request.messages[1].content.includes('x'.repeat(100)), false);
});
test('T7 insufficient mandatory story budget blocks request entirely', async () => {
  const opts = setup();
  opts.input.story.at(-1)!.text = 'x'.repeat(50000);
  const run = await createT7Run(opts),
    plan = await run.plan('macro');
  assert.equal(plan.requests.length, 0);
  assert.match(plan.tables[0].skip!, /预算/);
});
test('T7 no external-source authorization excludes it even with valid prerequisite', async () => {
  const opts = setup();
  opts.state.template.defaults.context.sources = ['story'];
  opts.input.segments = [{ source: 'database', sourceId: 'db', label: 'DB', text: 'EXCLUDED_DB', tableIds: [] }];
  await proof(opts.input);
  const run = await createT7Run(opts);
  assert.doesNotMatch(JSON.stringify((await run.plan('macro')).requests), /EXCLUDED_DB/);
});
test('T7 aggregate macro + micro object/new/request budgets never multiply per table', async () => {
  const opts = setup(createDefaultT2Fixture());
  opts.state.template.defaults.budget.maxRows = 4;
  opts.state.template.defaults.budget.maxNewRows = 1;
  opts.state.template.defaults.budget.maxRequests = 3;
  const run = await createT7Run(opts),
    macro = await run.plan('macro'),
    plan = await micro(run, opts.state),
    requests = [...macro.requests, ...plan.requests];
  assert.ok(requests.length <= 3);
  assert.ok(requests.reduce((n, r) => n + r.maxRows, 0) <= 4);
  assert.ok(requests.reduce((n, r) => n + r.maxNewRows, 0) <= 1);
});
test('T7 actual existing client uses only injected local fake fetch, retry sends share one global cap', async () => {
  const opts = setup();
  opts.state.template.defaults.budget.maxRequests = 3;
  opts.api.presets[0].maxRetries = 8;
  const run = await createT7Run(opts),
    request = (await run.plan('macro')).requests[0],
    original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('NETWORK_MUST_NEVER_BE_USED');
  };
  try {
    const result = await run.simulate(request.id, {
      responses: Array.from({ length: 8 }, () => ({ status: 503, text: 'x' })),
    });
    assert.equal(result.ok, false);
    assert.equal(run.view().sent, 3);
    const next = await run.simulate(request.id);
    assert.equal(next.ok, false);
    assert.equal(run.view().sent, 3);
  } finally {
    globalThis.fetch = original;
  }
});
test('T7 aborted simulation consumes no send and has no model/database side effects', async () => {
  const opts = setup(),
    before = clone(opts.state),
    run = await createT7Run(opts),
    request = (await run.plan('macro')).requests[0],
    controller = new AbortController();
  controller.abort();
  const result = await run.simulate(request.id, { signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(run.view().sent, 0);
  assert.deepEqual(opts.state, before);
});
test('T7 fake provider text containing a Key is blocked from public result', async () => {
  const opts = setup(),
    run = await createT7Run(opts),
    request = (await run.plan('macro')).requests[0];
  await assert.rejects(
    run.simulate(request.id, { responses: [{ status: 200, text: opts.api.presets[0].apiKey }] }),
    /凭据/,
  );
});
test('T7 accidental Key in plot, model/name or rule blocks publication', async () => {
  const opts = setup();
  opts.api.presets[0].name = opts.api.presets[0].apiKey;
  await assert.rejects(createT7Run(opts), /凭据/);
  opts.api = configuration();
  opts.input.story.at(-1)!.text = opts.api.presets[0].apiKey;
  const run = await createT7Run(opts);
  await assert.rejects(run.plan('macro'), /凭据/);
});
for (const bad of ['run', 'fingerprint', 'revision', 'micro', 'world'] as const)
  test(`T7 ${bad} macro handoff rejected`, async () => {
    const opts = setup(),
      run = await createT7Run(opts);
    await run.plan('macro');
    const handoff = {
      runId: run.view().runId,
      inputFingerprint: run.view().inputFingerprint,
      data: clone(opts.state.data),
    };
    if (bad === 'run') handoff.runId = 'other';
    if (bad === 'fingerprint') handoff.inputFingerprint = 'd'.repeat(64);
    if (bad === 'revision') handoff.data.revision++;
    if (bad === 'world') handoff.data.worldId = 'other';
    if (bad === 'micro') handoff.data.tables.npc[0].values.name = 'another';
    await assert.rejects(run.provideMacro(handoff));
    assert.equal(run.view().micro.status, 'pending-macro');
  });
test('T7 frozen read/write scope is accepted by actual T3 SQLite, denied condition update is rejected', async () => {
  const opts = setup(),
    run = await createT7Run(opts),
    req = (await micro(run, opts.state)).requests[0];
  const SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(
      readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)),
    ).buffer,
  });
  const request = {
    template: opts.state.template,
    data: opts.state.data,
    policy: req.policy,
    batchId: 't7-sql',
    sql: 'SELECT __we_row_id, f_name FROM we_environment',
    parameters: [],
  };
  assert.equal(executeT3Request(SQL, request).queries[0].rows.length, 1);
  assert.throws(
    () =>
      executeT3Request(SQL, {
        ...request,
        sql: 'UPDATE we_environment SET f_weather=? WHERE __we_row_id=?',
        parameters: ['暴雨', 'small-valley-weather'],
      }),
    /权限|授权/,
  );
});
test('T7 workbench preview and simulation share one enabled service; drafts prevent freeze', async () => {
  const opts = setup();
  let canFreeze = false;
  const ui = await createT7Workbench({
    readState: () => opts.state,
    input: opts.input,
    api: opts.api,
    canFreeze: () => canFreeze,
  });
  await ui.freeze();
  assert.equal(ui.view().run, null);
  assert.ok(ui.view().error);
  canFreeze = true;
  await ui.freeze();
  const request = ui.view().run!.macro!.requests[0];
  ui.editPrompt('global', { state: 'value', value: 'NEXT_UI_RULE' });
  ui.saveDraft();
  await ui.enable();
  assert.doesNotMatch(ui.view().run!.macro!.requests[0].messages[0].content, /NEXT_UI_RULE/);
  await ui.simulate(request.id);
  assert.equal(ui.view().result?.ok, true);
  ui.setApi({ ...opts.api, presets: opts.api.presets.map(p => ({ ...p, model: 'next-model' })) });
  assert.equal(ui.view().run!.macro!.requests[0].route.model, 'model-first');
  await ui.freeze();
  assert.match(ui.view().run!.macro!.requests[0].messages[0].content, /NEXT_UI_RULE/);
  assert.equal(ui.view().run!.macro!.requests[0].route.model, 'next-model');
});
test('T7 malformed source, old story anchor and hostile accessor fail closed without running getter', () => {
  const opts = setup();
  const bad = clone(opts.input);
  bad.story.at(-1)!.messageId = 'other';
  assert.throws(() => normalizeT7Input(bad));
  let invoked = false;
  const hostile = Object.defineProperty({}, 'story', {
    get() {
      invoked = true;
      return [];
    },
    enumerable: true,
  });
  assert.throws(() => normalizeT7Input(hostile));
  assert.equal(invoked, false);
});
test('T7 zero history range does not accidentally send every old assistant message', async () => {
  const opts = setup();
  opts.state.template.defaults.context.lastAssistantMessages = 0;
  opts.input.story[0].text = 'OLD_SHOULD_NOT_SEND';
  const run = await createT7Run(opts);
  assert.doesNotMatch(JSON.stringify((await run.plan('macro')).requests), /OLD_SHOULD_NOT_SEND/);
});
test('T7 locked field is readable but not writable in exact SQL grants', async () => {
  const opts = setup();
  opts.state.data.tables.npc[0].meta.lockedFieldIds = ['goals'];
  const run = await createT7Run(opts),
    req = (await micro(run, opts.state)).requests[0];
  assert.ok(req.policy.read.find(g => g.tableId === 'npc')?.fieldIds.includes('goals'));
  assert.ok(!req.policy.write.find(g => g.tableId === 'npc')?.fieldIds.includes('goals'));
});
test('T7 archived row is never writable and only readable when explicitly included', async () => {
  const opts = setup();
  opts.state.data.tables.npc[0].meta.archived = true;
  opts.input.selected = [{ tableId: 'npc', rowId: 'traveler' }];
  let run = await createT7Run(opts),
    plan = await micro(run, opts.state);
  assert.equal(plan.candidates.length, 0);
  opts.state.template.defaults.context.includeArchived = true;
  run = await createT7Run(opts);
  plan = await micro(run, opts.state);
  assert.equal(plan.candidates[0].writable, false);
  assert.ok(plan.requests.every(r => r.policy.write.every(g => !g.rowIds.includes('traveler'))));
});
test('T7 empty custom table gets an insertion field grant accepted by real SQLite', async () => {
  const opts = setup();
  opts.state.data.tables.environment = [];
  const run = await createT7Run(opts),
    req = (await run.plan('macro')).requests[0];
  assert.ok(req.policy.insertTableIds.includes('environment'));
  assert.ok(req.policy.write[0].fieldIds.includes('name'));
  const SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(
      readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)),
    ).buffer,
  });
  const result = executeT3Request(SQL, {
    template: opts.state.template,
    data: opts.state.data,
    policy: req.policy,
    batchId: 't7-empty',
    sql: 'INSERT INTO we_environment(f_name) VALUES(?)',
    parameters: ['人工世界的新环境'],
    limits: { maxAffectedRows: req.maxRows, maxNewRows: req.maxNewRows },
  });
  assert.equal(result.data.tables.environment.length, 1);
  assert.equal(opts.state.data.tables.environment.length, 0);
});
test('T7 secret required/default field disables impossible insertion instead of advertising unauthorized writes', async () => {
  const opts = setup();
  opts.state.data.tables.environment = [];
  opts.state.template.tables[0].fields.find(f => f.id === 'name')!.visibility.evolutionAi = false;
  const run = await createT7Run(opts),
    plan = await run.plan('macro');
  assert.equal(plan.requests.length, 0);
  assert.match(plan.tables[0].skip!, /无可更新/);
});
test('T7 frozen receipts are stable and repeated preview cannot consume sends or rotation', async () => {
  const opts = setup(),
    run = await createT7Run(opts),
    first = await run.plan('macro');
  assert.deepEqual(await run.plan('macro'), first);
  assert.equal(run.view().sent, 0);
  assert.deepEqual(opts.input.progress, {});
  assert.equal((await run.simulate(first.requests[0].id)).ok, true);
  assert.deepEqual(await run.plan('macro'), first);
});
test('T7 user-hidden schema and row metadata is not sent even when evolution visibility is true', async () => {
  const opts = setup();
  opts.state.template.tables[0].visibility.user = false;
  const run = await createT7Run(opts);
  assert.equal((await run.plan('macro')).tables.length, 0);
  const plan = await micro(run, opts.state);
  assert.doesNotMatch(JSON.stringify(plan.requests), /small-valley-weather|we_environment|山谷雨情/);
});
test('T7 workbench rejects stale saved data before another simulation; no late result accepted', async () => {
  const opts = setup(),
    ui = await createT7Workbench({ readState: () => opts.state, input: opts.input, api: opts.api });
  await ui.freeze();
  const id = ui.view().run!.macro!.requests[0].id;
  opts.state.data.revision++;
  await ui.simulate(id);
  assert.ok(ui.view().error);
  assert.equal(ui.view().run!.sent, 0);
  assert.equal(ui.view().result, null);
});
test('T7 editing template rules after freeze does not silently send a stale request', async () => {
  const opts = setup(),
    ui = await createT7Workbench({ readState: () => opts.state, input: opts.input, api: opts.api });
  await ui.freeze();
  const id = ui.view().run!.macro!.requests[0].id;
  opts.state.template.tables[0].rules.update = 'NEW_SAVED_RULE';
  await ui.simulate(id);
  assert.ok(ui.view().error);
  assert.equal(ui.view().run!.sent, 0);
});
test('T7 changed plot/swipe invalidates old request without borrowing next input', async () => {
  const opts = setup(),
    ui = await createT7Workbench({ readState: () => opts.state, input: opts.input, api: opts.api });
  await ui.freeze();
  const id = ui.view().run!.macro!.requests[0].id;
  const next = clone(opts.input);
  next.anchor.swipeId = 'new-swipe';
  next.story.at(-1)!.text = '另一条剧情';
  ui.setInput(next);
  assert.equal(ui.view().inputInvalidated, true);
  await ui.simulate(id);
  assert.equal(ui.view().run!.sent, 0);
  await ui.freeze();
  assert.equal(ui.view().inputInvalidated, false);
  assert.match(JSON.stringify(ui.view().run!.macro!.requests[0].messages), /另一条剧情/);
});
test('T7 table IDs macro/global remain separate from phase/global prompt scopes', async () => {
  const opts = setup(),
    t = clone(opts.state.template.tables[0]);
  t.id = 'macro';
  t.sqlName = 'we_extra';
  t.name = '自定义宏观';
  opts.state.template.tables.push(t);
  opts.state.data.tables.macro = [];
  const ui = await createT7Workbench({ readState: () => opts.state, input: opts.input, api: opts.api });
  ui.editPrompt('table:macro', { state: 'value', value: 'CUSTOM_MACRO_TABLE' });
  ui.saveDraft();
  await ui.enable();
  assert.deepEqual(ui.view().prompts.enabled.tables.macro, { state: 'value', value: 'CUSTOM_MACRO_TABLE' });
  assert.notEqual(
    ui.view().prompts.enabled.phases.macro.state === 'value' ? ui.view().prompts.enabled.phases.macro : null,
    null,
  );
});
test('T7 newly saved table is editable through current provider, not a stale initial UI template', async () => {
  const opts = setup(),
    ui = await createT7Workbench({ readState: () => opts.state, input: opts.input, api: opts.api });
  const t = clone(opts.state.template.tables[0]);
  t.id = 'newtable';
  t.sqlName = 'we_newtable';
  opts.state.template.tables.push(t);
  opts.state.data.tables.newtable = [];
  ui.editPrompt('table:newtable', { state: 'value', value: 'NEW_TABLE_RULE' });
  ui.saveDraft();
  await ui.enable();
  assert.deepEqual(ui.view().prompts.enabled.tables.newtable, { state: 'value', value: 'NEW_TABLE_RULE' });
  assert.ok(ui.view().tableIds.includes('newtable'));
});
test('T7 UI refuses Key in rule draft and public response objects cannot mutate service receipt', async () => {
  const opts = setup(),
    ui = await createT7Workbench({ readState: () => opts.state, input: opts.input, api: opts.api });
  assert.throws(() => ui.editPrompt('global', { state: 'value', value: opts.api.presets[0].apiKey }), /凭据/);
  await ui.freeze();
  await ui.simulate(ui.view().run!.macro!.requests[0].id);
  const result = ui.view().result!;
  if (result.ok) result.text = 'CHANGED_PUBLIC_RESULT';
  assert.notEqual(ui.view().result?.ok ? ui.view().result?.text : '', 'CHANGED_PUBLIC_RESULT');
});
test('T7 integrates shared T4/T5/T6 sandbox without any archive writes; structure/data drafts block freeze', async () => {
  const opts = setup(),
    scope = {
      mode: 't4-sandbox' as const,
      chatId: 'sandbox-t7-integrated',
      worldId: opts.state.data.worldId,
      branchId: opts.state.data.branchId,
    };
  const f = await createT7Sandbox({
    scope,
    initial: opts.state,
    input: opts.input,
    api: opts.api,
    withMockAnchor: true,
    execute: async () => {
      throw new Error('Preview must not execute SQL');
    },
  });
  const before = f.store.statistics.writes;
  await f.generation.freeze();
  assert.ok(f.generation.view().run);
  assert.equal(f.store.statistics.writes, before);
  f.generation.discardRun();
  f.workbench.beginNew();
  const nameInput = clone(f.workbench.view().editor!.fields.find(field => field.field.id === 'name')!.input);
  nameInput.mode = 'value';
  nameInput.text = '尚未保存的新环境';
  f.workbench.setInput('name', nameInput);
  await f.generation.freeze();
  assert.equal(f.generation.view().run, null);
  assert.ok(f.generation.view().error);
  f.workbench.cancelEditor();
  await f.generation.freeze();
  assert.ok(f.generation.view().run);
});
