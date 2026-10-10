import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCustomT2Fixture, createDefaultT2Fixture } from './t2-defaults';
import { fingerprintT4 } from './t4-protocol';
import { createT8Control, parseT8Output } from './t8-control';
import { createT8Queue } from './t8-queue';
import { createT8Sandbox } from './t8-sandbox';
import {
  cloneT8Test as clone,
  setupT8Test as setup,
  responseT8Test as response,
  deferredT8Test as deferred,
  executeT8Test,
} from './t8-test-fixtures';

async function finish(f: ReturnType<typeof setup>, runId = 't8-run') {
  const started = await f.control.start(runId);
  await started.done;
  return f.control.view(runId);
}
async function until(check: () => boolean) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 1500) throw new Error('test condition timed out');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
function waiting(f: ReturnType<typeof setup>, sourceId = 'db') {
  f.input.proofs.push({
    sourceId,
    required: true,
    state: 'waiting',
    identity: { ...f.input.anchor, worldId: f.input.worldId, branchId: f.input.branchId },
    sourceCommitId: null,
    resultFingerprint: null,
    persisted: false,
    requirePersisted: true,
    reason: '',
  });
}
async function success(f: ReturnType<typeof setup>, sourceId = 'db') {
  const proof = f.input.proofs.find(p => p.sourceId === sourceId)!;
  Object.assign(proof, {
    state: 'success',
    sourceCommitId: `${sourceId}-commit`,
    resultFingerprint: await fingerprintT4(f.input.segments.filter(s => s.sourceId === sourceId)),
    persisted: true,
  });
}

test('T8 valid macro SQL stages changes, keeps old formal state/time/micro and gives fresh private handoff', async () => {
  const f = setup(undefined, {
    reply: async () =>
      response('UPDATE we_environment SET f_risk = ?, f_weather = ? WHERE __we_row_id = ?', [
        80,
        '风暴',
        'small-valley-weather',
      ]),
  });
  const before = clone(f.state),
    v = await finish(f);
  assert.equal(v.status, 'staged');
  assert.equal(v.sent, 1);
  assert.equal(v.completed, 1);
  assert.deepEqual(f.state, before);
  assert.deepEqual(v.worldTime, f.input.now);
  const handoff = await f.control.handoff();
  assert.equal(handoff.data.tables.environment[0].values.risk, 80);
  assert.deepEqual(handoff.data.tables.npc, before.data.tables.npc);
  assert.equal(handoff.data.revision, before.data.revision);
  assert.equal(handoff.batches.length, 1);
  assert.deepEqual(handoff.usage, { rows: 1, newRows: 0 });
  assert.equal(v.changes.length, 1);
  assert.equal(v.changes[0].fields.length, 2);
  assert.notEqual(v.batches[0].beforeFingerprint, v.batches[0].afterFingerprint);
  const micro = await handoff.run.plan('micro');
  assert.equal(micro.status, 'final');
  assert.match(JSON.stringify(micro.requests[0].messages), /风暴|80/);
  handoff.data.tables.environment[0].values.risk = 1;
  assert.equal((await f.control.handoff()).data.tables.environment[0].values.risk, 80);
  assert.doesNotMatch(JSON.stringify(v), /private-t8-key|invalid.example|Authorization/);
});
test('T8 default fake SELECT is genuinely validated, no change does not advance committed frequency/rotation', async () => {
  const f = setup();
  f.input.eligibleRound = 3;
  f.input.progress.environment = { lastSuccessfulRound: 0, rotation: 0 };
  const before = clone(f.input),
    v = await finish(f);
  assert.equal(v.status, 'staged');
  assert.deepEqual(v.changes, []);
  assert.equal(v.sent, 1);
  assert.deepEqual(f.input, before);
  assert.deepEqual((await f.control.handoff()).usage, { rows: 0, newRows: 0 });
});
test('T8 later macro request reads validated weather, including non-default market table; candidates stay frozen', async () => {
  const seen: string[] = [];
  const f = setup(createCustomT2Fixture(), {
    reply: async request => {
      seen.push(request.tableId);
      if (request.tableId === 'environment')
        return response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [90, 'harbor-weather']);
      if (request.tableId === 'market') {
        const rows = request.messages[1].content
          .split('\n')
          .map(line => JSON.parse(line))
          .filter(piece => piece.source === 'world')
          .map(piece => JSON.parse(piece.content));
        assert.ok(rows.some(row => row.tableId === 'environment' && row.values.risk === 90));
        return response('UPDATE we_market SET f_open = ? WHERE __we_row_id = ?', [true, 'harbor-market']);
      }
      return response(`SELECT __we_row_id FROM we_${request.tableId}`);
    },
  });
  const v = await finish(f);
  assert.equal(v.status, 'staged', JSON.stringify(v.error));
  assert.deepEqual(seen, ['society', 'environment', 'location', 'market']);
  const h = await f.control.handoff();
  assert.equal(h.data.tables.market[0].values.open, true);
  assert.equal(f.state.data.tables.market[0].values.open, false);
});
test('T8 valid access update is private until whole macro finishes', async () => {
  const f = setup(createDefaultT2Fixture(), {
    reply: async request =>
      request.tableId === 'location'
        ? response('UPDATE we_location SET f_access = ? WHERE __we_row_id = ?', ['封闭', 'north-gate'])
        : response(`SELECT __we_row_id FROM we_${request.tableId}`),
  });
  const v = await finish(f);
  assert.equal(v.status, 'staged', JSON.stringify(v.error));
  assert.equal(
    (await f.control.handoff()).data.tables.location.find(r => r.meta.id === 'north-gate')!.values.access,
    '封闭',
  );
  assert.equal(f.state.data.tables.location.find(r => r.meta.id === 'north-gate')!.values.access, '受限');
});
test('T8 frequency skipped macro inherits previous world and uses zero requests', async () => {
  const f = setup();
  f.state.template.tables[0].runtime.frequency = {
    state: 'value',
    value: { unit: 'eligible-story-round', every: 3, offset: 0 },
  };
  f.input.progress.environment = { lastSuccessfulRound: 0, rotation: 7 };
  const v = await finish(f);
  assert.equal(v.status, 'staged');
  assert.equal(v.sent, 0);
  assert.match(v.skipped[0].reason, /尚未到/);
  assert.deepEqual((await f.control.handoff()).data, f.state.data);
  assert.equal((await (await f.control.handoff()).run.plan('micro')).requests.length, 1);
});
test('T8 phase disabled also inherits without empty model requests', async () => {
  const f = setup();
  f.state.template.phases.macro.enabled = false;
  const v = await finish(f);
  assert.equal(v.status, 'staged');
  assert.equal(v.sent, 0);
  assert.equal(v.total, 0);
  const disabledApi = setup();
  disabledApi.state.template.tables[0].runtime.api = { state: 'disabled' };
  const inherited = await finish(disabledApi);
  assert.equal(inherited.status, 'staged');
  assert.equal(inherited.sent, 0);
});
for (const [label, sql, params] of [
  ['DDL', 'DROP TABLE we_environment', []],
  ['cross-stage', 'UPDATE we_npc SET f_name = ? WHERE __we_row_id = ?', ['替换', 'traveler']],
  ['unknown field', 'UPDATE we_environment SET f_not_known = ? WHERE __we_row_id = ?', ['bad', 'small-valley-weather']],
  [
    'invalid weather',
    'UPDATE we_environment SET f_weather = ? WHERE __we_row_id = ?',
    ['模板没有的天气', 'small-valley-weather'],
  ],
  ['invalid range', 'UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [999, 'small-valley-weather']],
  ['outside candidates', 'UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [90, 'not-allowed']],
  ['expression', 'UPDATE we_environment SET f_risk = f_risk + 1 WHERE __we_row_id = ?', ['small-valley-weather']],
  [
    'system metadata',
    'UPDATE we_environment SET __we_locked = ? WHERE __we_row_id = ?',
    [false, 'small-valley-weather'],
  ],
] as const)
  test(`T8 ${label} SQL fails whole run with zero formal changes`, async () => {
    const f = setup(undefined, { reply: async () => response(sql, [...params]) }),
      before = clone(f.state);
    const v = await finish(f);
    assert.equal(v.status, 'failed');
    assert.equal(v.error?.code, 'SQL');
    assert.deepEqual(f.state, before);
    assert.deepEqual(v.changes, []);
    await assert.rejects(f.control.handoff());
  });
for (const text of [
  '```json\n{"sql":"SELECT __we_row_id FROM we_environment","parameters":[]}\n```',
  '{"sql":"x","parameters":[],"extra":1}',
  '{"sql":"x","parameters":"bad"}',
  '{"sql":"x"}',
  '{"sql":null,"parameters":[]}',
  'hello',
  '[1]',
  '{"sql":"","parameters":[]}',
])
  test(`T8 rejects malformed output: ${text.slice(0, 20)}`, async () => {
    assert.throws(() => parseT8Output(text));
    const f = setup(undefined, { reply: async () => ({ status: 200, text }) }),
      v = await finish(f);
    assert.equal(v.status, 'failed');
    assert.equal(v.error?.code, 'RESPONSE');
  });
test('T8 bounded output refuses oversize JSON before SQL', () => {
  assert.throws(() => parseT8Output(' '.repeat(200001)));
});
test('T8 corrupt worker result cannot sneak in changes to hidden or micro state', async () => {
  const f = setup(undefined, {
    execute: async request => {
      const result = await executeT8Test(request);
      result.data.tables.npc[0].values.name = '越权';
      return result;
    },
  });
  const v = await finish(f);
  assert.equal(v.status, 'failed');
  assert.equal(v.error?.code, 'SQL');
  assert.equal(f.state.data.tables.npc[0].values.name, '陈望');
});
test('T8 failed later batch discards earlier private weather; no partial handoff', async () => {
  const f = setup(createDefaultT2Fixture(), {
    reply: async request =>
      request.tableId === 'environment'
        ? response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [90, 'harbor-weather'])
        : request.tableId === 'location'
          ? response('DROP TABLE we_location')
          : response('SELECT __we_row_id FROM we_society'),
  });
  const before = clone(f.state),
    v = await finish(f);
  assert.equal(v.status, 'failed');
  assert.equal(v.completed, 2);
  assert.deepEqual(v.changes, []);
  assert.deepEqual(f.state, before);
  await assert.rejects(f.control.handoff());
});
test('T8 waits separately for MVU then database, persisted proof required; duplicate signals send once', async () => {
  const f = setup();
  waiting(f, 'mvu');
  waiting(f, 'db');
  const start = await f.control.start('first');
  await until(() => f.control.view().status === 'waiting');
  await success(f, 'mvu');
  await new Promise(resolve => setTimeout(resolve, 12));
  assert.equal(f.control.view().sent, 0);
  await success(f, 'db');
  f.input.proofs[1].persisted = false;
  // Success without the required durable evidence is a failure, not a successful release.
  await start.done;
  assert.equal(f.control.view().error?.code, 'PREREQUISITE');
  assert.equal(f.control.view().sent, 0);
  const duplicate = await f.control.start('second');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.runId, 'first');
});
test('T8 independent valid completion proofs release waiting macro exactly once', async () => {
  const f = setup();
  waiting(f, 'mvu');
  waiting(f, 'db');
  const start = await f.control.start('one');
  await until(() => f.control.view().status === 'waiting');
  await success(f, 'mvu');
  await success(f, 'db');
  await start.done;
  assert.equal(f.control.view().status, 'staged');
  assert.equal(f.control.view().sent, 1);
  assert.equal((await f.control.start('two')).duplicate, true);
});
for (const state of ['failure', 'unverifiable', 'not-installed'] as const)
  test(`T8 necessary ${state} prevents any model send`, async () => {
    const f = setup();
    waiting(f);
    f.input.proofs[0].state = state;
    const v = await finish(f);
    assert.equal(v.error?.code, 'PREREQUISITE');
    assert.equal(v.sent, 0);
  });
test('T8 optional failed source is omitted, does not authorize old result', async () => {
  const f = setup();
  waiting(f);
  f.input.proofs[0].required = false;
  f.input.proofs[0].state = 'failure';
  f.input.segments.push({
    source: 'database',
    sourceId: 'db',
    label: 'failed data',
    text: 'OLD_DATA_MUST_NOT_READ',
    tableIds: [],
  });
  const v = await finish(f);
  assert.equal(v.status, 'staged');
  assert.doesNotMatch(JSON.stringify(v.batches[0].request.messages), /OLD_DATA_MUST_NOT_READ/);
});
test('T8 explicit disabled prerequisite requires matching identity/reason, never reads stale data', async () => {
  const f = setup();
  waiting(f);
  Object.assign(f.input.proofs[0], { state: 'disabled', sourceCommitId: 'skip-this-round', reason: '用户已停用' });
  const v = await finish(f);
  assert.equal(v.status, 'staged');
  assert.equal(v.prerequisites?.reports[0].allowedRead, false);
});
test('T8 old swipe completion cannot release a new run', async () => {
  const f = setup();
  waiting(f);
  f.input.proofs[0].identity!.swipeId = 'old-swipe';
  await success(f);
  const v = await finish(f);
  assert.equal(v.error?.code, 'PREREQUISITE');
  assert.equal(v.sent, 0);
});
test('T8 waiting source timeout stays failed rather than pretending completed', async () => {
  const f = setup(undefined, { prerequisiteTimeoutMs: 10 });
  waiting(f);
  const v = await finish(f);
  assert.equal(v.error?.code, 'PREREQUISITE_TIMEOUT');
  assert.equal(v.sent, 0);
});
test('T8 cancel waiting releases queue, never sends later success', async () => {
  const f = setup();
  waiting(f);
  const job = await f.control.start('one');
  await until(() => f.control.view().status === 'waiting');
  f.control.cancel();
  await job.done;
  await success(f);
  assert.equal(f.control.view().status, 'cancelled');
  assert.equal(f.control.view().sent, 0);
});
test('T8 cancel HTTP ignores late response and starts no later macro table', async () => {
  const late = deferred<{ status: number; text: string }>();
  const f = setup(createDefaultT2Fixture(), { reply: () => late.promise });
  const job = await f.control.start('one');
  await until(() => f.control.view().sent === 1);
  f.control.cancel();
  await job.done;
  late.resolve(response('SELECT __we_row_id FROM we_society'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.control.view().status, 'cancelled');
  assert.equal(f.control.view().completed, 0);
  assert.equal(f.control.view().sent, 1);
  assert.equal(f.control.view().outcome, 'simulation-result-unknown');
  await assert.rejects(f.control.handoff());
});
test('T8 cancel SQLite propagates signal and rejects even an adapter that ignores cancellation', async () => {
  const late = deferred<Awaited<ReturnType<typeof executeT8Test>>>();
  let signal: AbortSignal | undefined;
  const f = setup(undefined, {
    execute: async (request, options) => {
      signal = options?.signal;
      const result = await executeT8Test(request);
      setTimeout(() => late.resolve(result), 30);
      return late.promise;
    },
  });
  const job = await f.control.start('one');
  await until(() => signal !== undefined);
  f.control.cancel();
  await job.done;
  assert.equal(signal?.aborted, true);
  assert.equal(f.control.view().status, 'cancelled');
  assert.equal(f.control.view().completed, 0);
});
test('T8 entire run timeout and SQL timeout do not accept hung mock work', async () => {
  const f = setup(undefined, { runTimeoutMs: 150, reply: async () => new Promise(() => {}) });
  const v = await finish(f);
  assert.equal(v.error?.code, 'RUN_TIMEOUT');
  assert.ok(v.sent <= 1);
  const sql = setup(undefined, { sqlTimeoutMs: 10, execute: async () => new Promise(() => {}) });
  assert.equal((await finish(sql)).error?.code, 'SQL');
});
for (const [label, change] of [
  [
    'chat',
    (f: ReturnType<typeof setup>) => {
      f.input.anchor.chatId = 'sandbox-other';
    },
  ],
  [
    'swipe',
    (f: ReturnType<typeof setup>) => {
      f.input.anchor.swipeId = 's1';
    },
  ],
  [
    'plot',
    (f: ReturnType<typeof setup>) => {
      f.input.story[0].text = 'changed story';
    },
  ],
  [
    'template',
    (f: ReturnType<typeof setup>) => {
      f.state.template.name = 'changed template';
    },
  ],
  [
    'revision',
    (f: ReturnType<typeof setup>) => {
      f.state.data.revision += 1;
    },
  ],
  [
    'world time',
    (f: ReturnType<typeof setup>) => {
      f.input.now!.ordinalMinute += 1;
    },
  ],
] as const)
  test(`T8 ${label} change during response discards result before SQL`, async () => {
    const late = deferred<{ status: number; text: string }>(),
      f = setup(undefined, { reply: () => late.promise });
    const job = await f.control.start('one');
    await until(() => f.control.view().sent === 1);
    change(f);
    late.resolve(response('SELECT __we_row_id FROM we_environment'));
    await job.done;
    assert.equal(f.control.view().status, 'stale');
    assert.equal(f.control.view().completed, 0);
    await assert.rejects(f.control.handoff());
  });
test('T8 stale after staged invalidates handoff, rather than gluing it to another round', async () => {
  const f = setup();
  await finish(f);
  f.input.anchor.swipeId = 's1';
  await assert.rejects(f.control.handoff());
  assert.equal(f.control.view().status, 'stale');
  assert.deepEqual(f.control.view().changes, []);
});
test('T8 retry sends consume same global budget; no multiply by batch/retry count', async () => {
  const f = setup(createDefaultT2Fixture(), { reply: async () => ({ status: 503, text: 'ignored' }) });
  f.state.template.defaults.budget.maxRequests = 3;
  f.api.presets[0].maxRetries = 8;
  const v = await finish(f);
  assert.equal(v.error?.code, 'BUDGET');
  assert.equal(v.sent, 3);
  assert.equal(v.completed, 0);
});
test('T8 table retry budget independently stops before next fake transport send', async () => {
  const f = setup(undefined, { reply: async () => ({ status: 503, text: 'ignored' }) });
  f.state.template.tables[0].runtime.budget = {
    state: 'value',
    value: { maxRows: 5, maxNewRows: 1, maxRequests: 1, maxContextChars: 16000 },
  };
  f.api.presets[0].maxRetries = 8;
  const v = await finish(f);
  assert.equal(v.error?.code, 'BUDGET');
  assert.equal(v.sent, 1);
});
test('T8 successful HTTP retry leaves micro only the remaining whole-run send quota and actual row budget', async () => {
  const f = setup(undefined, {
    reply: async (_request, attempt) =>
      attempt === 1 ? { status: 503, text: 'ignored' } : response('SELECT __we_row_id FROM we_environment'),
  });
  f.api.presets[0].maxRetries = 1;
  f.state.template.defaults.budget.maxRequests = 2;
  f.state.template.defaults.budget.maxRows = 2;
  f.state.template.defaults.budget.maxNewRows = 0;
  const v = await finish(f);
  assert.equal(v.status, 'staged');
  assert.equal(v.sent, 2);
  const h = await f.control.handoff(),
    micro = await h.run.plan('micro');
  assert.equal(micro.requests.length, 0);
  assert.deepEqual(h.usage, { rows: 0, newRows: 0 });
});
test('T8 unused macro row/new quota is returned to micro, not consumed by preview', async () => {
  const f = setup();
  f.state.template.defaults.budget.maxRows = 2;
  f.state.template.defaults.budget.maxNewRows = 1;
  assert.equal((await finish(f)).status, 'staged');
  const h = await f.control.handoff();
  const micro = await h.run.plan('micro');
  assert.equal(micro.requests.length, 1);
  assert.equal(micro.requests[0].maxRows, 2);
});
test('T8 revoked ownership before first send stops zero API calls; between retries stops repeated sends', async () => {
  const f = setup();
  waiting(f);
  const job = await f.control.start('one');
  await until(() => f.control.view().status === 'waiting');
  f.queue.revoke(f.control.view().triggerKey!);
  await success(f);
  await job.done;
  assert.equal(f.control.view().error?.code, 'OWNERSHIP');
  assert.equal(f.control.view().sent, 0);
  const retry = setup(undefined, {
    reply: async () => {
      retry.queue.revoke(retry.control.view().triggerKey!);
      return { status: 503, text: 'ignored' };
    },
  });
  retry.api.presets[0].maxRetries = 3;
  await finish(retry);
  assert.equal(retry.control.view().error?.code, 'OWNERSHIP');
  assert.equal(retry.control.view().sent, 1);
});
test('T8 two shared entries dedupe same trigger even with different run IDs', async () => {
  const queue = createT8Queue(),
    first = setup(undefined, { queue }),
    second = setup(undefined, { queue, ownerId: 'another-entry' });
  const one = await first.control.start('one'),
    two = await second.control.start('two');
  assert.equal(two.duplicate, true);
  assert.equal(two.runId, 'one');
  await one.done;
  assert.equal(first.control.view().sent, 1);
  assert.equal(second.control.view().sent, 0);
  assert.equal(queue.size, 1);
});
test('T8 queue is serial; queued cancellation never calls its fake model', async () => {
  const queue = createT8Queue(),
    late = deferred<{ status: number; text: string }>();
  const f = setup(undefined, { queue, reply: () => late.promise }),
    g = setup(undefined, { queue });
  g.input.anchor.messageId = 'a9';
  g.input.story[0].messageId = 'a9';
  const one = await f.control.start('one');
  await until(() => f.control.view().sent === 1);
  const two = await g.control.start('two');
  assert.equal(g.control.view().status, 'queued');
  assert.equal(g.control.view().sent, 0);
  g.control.cancel();
  late.resolve(response('SELECT __we_row_id FROM we_environment'));
  await Promise.all([one.done, two.done]);
  assert.equal(f.control.view().status, 'staged');
  assert.equal(g.control.view().status, 'cancelled');
  assert.equal(g.control.view().sent, 0);
});
test('T8 API/prompt changes after freeze only affect next run, use frozen model and prompt', async () => {
  const late = deferred<{ status: number; text: string }>();
  const f = setup(undefined, { reply: () => late.promise });
  const job = await f.control.start('one');
  await until(() => f.control.view().sent === 1);
  f.api.presets[0].model = 'new-model';
  f.api.presets[0].apiKey = 'new-private-key';
  f.prompts.global = 'NEW_RULE_NOT_THIS_RUN';
  late.resolve(response('SELECT __we_row_id FROM we_environment'));
  await job.done;
  const v = f.control.view();
  assert.equal(v.status, 'staged');
  assert.equal(v.batches[0].request.route.model, 'model-fake');
  assert.doesNotMatch(JSON.stringify(v), /NEW_RULE_NOT_THIS_RUN|new-private-key/);
});
test('T8 fake response carrying a private API Key is blocked without exposing raw error', async () => {
  const f = setup(undefined, {
    reply: async () => response('SELECT __we_row_id FROM we_environment', ['private-t8-key-no-leak']),
  });
  const v = await finish(f);
  assert.equal(v.status, 'failed');
  assert.doesNotMatch(JSON.stringify(v), /private-t8-key|invalid.example/);
});
test('T8 sandbox shares formal T4 state but macro stages perform no archive writes', async () => {
  const f = setup();
  const sandbox = await createT8Sandbox({
    scope: { mode: 't4-sandbox', chatId: 'sandbox-t8', worldId: f.state.data.worldId, branchId: f.state.data.branchId },
    initial: f.state,
    execute: executeT8Test,
    input: f.input,
    api: f.api,
    withMockAnchor: true,
  });
  const before = clone(sandbox.store.statistics),
    job = await sandbox.macro.start('one');
  await job.done;
  assert.equal(sandbox.macro.view().status, 'staged');
  assert.deepEqual(sandbox.store.statistics, before);
  assert.deepEqual(sandbox.service.view().formal, f.state);
  sandbox.generation.editPrompt('global', { state: 'value', value: 'unsaved' });
  await assert.rejects(sandbox.macro.start('two'));
});
test('T8 rejects real-chat scope, bad timers, UI dirty state and no ownership identity', async () => {
  const f = setup();
  f.input.anchor.chatId = 'real-chat';
  await assert.rejects(f.control.start('one'));
  assert.throws(() => createT8Control({ ...f.options, ownerId: '' }));
  assert.throws(() => createT8Control({ ...f.options, pollMs: 0 }));
  const dirty = setup(undefined, { canRun: () => false });
  await assert.rejects(dirty.control.start('one'));
});
test('T8 public view is cloned and unsafe listener cannot interrupt a run', async () => {
  const f = setup();
  f.control.subscribe(() => {
    throw new Error('listener failure');
  });
  await finish(f);
  const view = f.control.view();
  view.batches[0].request.messages[0].content = 'altered';
  assert.notEqual(f.control.view().batches[0].request.messages[0].content, 'altered');
  assert.equal(f.control.view().status, 'staged');
});
test('T8 modules have no live host/network/write entry and no new auto-scanned index', () => {
  for (const name of ['t8-control.ts', 't8-sandbox.ts', 't8-queue.ts']) {
    const source = readFileSync(`src/世界演变/rebuild/${name}`, 'utf8');
    assert.doesNotMatch(
      source,
      /fetch\(|TavernHelper|localStorage|\.prepareSql\(|\.save\(|createWorldbook|replaceChatMessages/,
    );
  }
});

test('T8 missing API and insufficient mandatory context fail visibly, not false no-change success', async () => {
  const f = setup();
  f.api.presets = [];
  const v = await finish(f);
  assert.equal(v.error?.code, 'PLAN');
  assert.equal(v.sent, 0);
  assert.match(v.skipped[0].reason, /不存在/);
  const small = setup();
  small.state.template.defaults.context.maxChars = 500;
  const tooSmall = await finish(small);
  assert.equal(tooSmall.error?.code, 'PLAN');
  assert.equal(tooSmall.sent, 0);
  const badEndpoint = setup();
  badEndpoint.api.presets[0].endpoint = 'not-a-valid-url';
  const bad = await finish(badEndpoint);
  assert.equal(bad.error?.code, 'PLAN');
  assert.equal(bad.sent, 0);
});
test('T8 client timeout stops a hanging fake transport and counts only actual simulated sends', async () => {
  const transport: { signal: AbortSignal | null } = { signal: null };
  const f = setup(undefined, {
    reply: async (_request, _attempt, s) => {
      transport.signal = s;
      return new Promise(() => {});
    },
  });
  const v = await finish(f);
  assert.equal(v.error?.code, 'MODEL');
  assert.equal(v.sent, 1);
  assert.equal(transport.signal?.aborted, true);
});
test('T8 permitted macro insert uses stable allocated ID; no sample seeds or revision advance', async () => {
  const f = setup(undefined, {
    reply: async () =>
      response('INSERT INTO we_environment (f_name, f_weather, f_risk) VALUES (?, ?, ?)', ['另一处雨情', '风暴', 60]),
  });
  const v = await finish(f);
  assert.equal(v.status, 'staged', JSON.stringify(v.error));
  assert.equal(v.batches[0].newRows, 1);
  const h = await f.control.handoff();
  assert.equal(h.data.tables.environment.length, 2);
  assert.equal(f.state.data.tables.environment.length, 1);
  assert.notEqual(h.data.tables.environment[1].meta.id, 'small-valley-weather');
  assert.equal(h.data.revision, f.state.data.revision);
  assert.deepEqual(h.usage, { rows: 1, newRows: 1 });
});
test('T8 zero new-row quota and locked field cannot be bypassed by model SQL', async () => {
  const f = setup(undefined, {
    reply: async () => response('INSERT INTO we_environment (f_name) VALUES (?)', ['越额']),
  });
  f.state.template.defaults.budget.maxNewRows = 0;
  assert.equal((await finish(f)).error?.code, 'SQL');
  const locked = setup(undefined, {
    reply: async () =>
      response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [80, 'small-valley-weather']),
  });
  locked.state.data.tables.environment[0].meta.lockedFieldIds = ['risk'];
  assert.equal((await finish(locked)).error?.code, 'SQL');
});
test('T8 allowed deletion does not reassign a completed/deleted macro row to later batches', async () => {
  const state = createDefaultT2Fixture();
  state.data.tables.society = [];
  state.template.tables.find(t => t.id === 'environment')!.permissions.ai.delete = true;
  const f = setup(state, {
    reply: async request =>
      request.tableId === 'environment'
        ? response('DELETE FROM we_environment WHERE __we_row_id = ?', ['harbor-weather'])
        : response(`SELECT __we_row_id FROM we_${request.tableId}`),
  });
  // Disable insertion for the empty society, so environment is the first actual batch.
  f.state.template.tables.find(t => t.id === 'society')!.permissions.ai.insert = false;
  const v = await finish(f);
  assert.equal(v.status, 'staged', JSON.stringify(v.error));
  assert.equal(v.sent, 2);
  assert.equal((await f.control.handoff()).data.tables.environment.length, 0);
  assert.equal(f.state.data.tables.environment.length, 1);
});
test('T8 macro candidates do not expand just because previous batch generated a new reference', async () => {
  const f = setup(createDefaultT2Fixture(), {
    reply: async request => {
      if (request.tableId === 'environment')
        return response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [90, 'harbor-weather']);
      return response(`SELECT __we_row_id FROM we_${request.tableId}`);
    },
  });
  const originalChoices = new Map<string, string[]>();
  f.control.subscribe(() => {
    for (const b of f.control.view().batches)
      if (!originalChoices.has(b.tableId))
        originalChoices.set(
          b.tableId,
          b.request.policy.write.flatMap(g => g.rowIds),
        );
  });
  const v = await finish(f);
  assert.equal(v.status, 'staged', JSON.stringify({ error: v.error, sent: v.sent, completed: v.completed }));
  for (const b of v.batches)
    assert.deepEqual(
      b.request.policy.write.flatMap(g => g.rowIds),
      originalChoices.get(b.tableId),
    );
  assert.equal(new Set(v.batches.map(b => b.tableId)).size, v.total);
});
test('T8 source result changing after freeze is stale, even if plot anchor did not move', async () => {
  const late = deferred<{ status: number; text: string }>(),
    f = setup(undefined, { reply: () => late.promise });
  waiting(f);
  await success(f);
  const job = await f.control.start('one');
  await until(() => f.control.view().sent === 1);
  f.input.proofs[0].sourceCommitId = 'another-result';
  late.resolve(response('SELECT __we_row_id FROM we_environment'));
  await job.done;
  assert.equal(f.control.view().status, 'stale');
  assert.equal(f.control.view().completed, 0);
});
test('T8 staged user/evolution-hidden fields stay out of public difference summary', async () => {
  const f = setup(undefined, {
    reply: async () =>
      response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [80, 'small-valley-weather']),
  });
  const hidden = f.state.template.tables[0].fields.find(field => field.id === 'summary')!;
  hidden.visibility.user = false;
  hidden.visibility.evolutionAi = false;
  f.state.data.tables.environment[0].values.summary = 'HIDDEN_MACRO_NOTE';
  const v = await finish(f);
  assert.equal(v.status, 'staged');
  assert.doesNotMatch(JSON.stringify(v), /HIDDEN_MACRO_NOTE/);
});
test('T8 queued job rechecks current template and branch before any send', async () => {
  const queue = createT8Queue(),
    late = deferred<{ status: number; text: string }>();
  const f = setup(undefined, { queue, reply: () => late.promise }),
    g = setup(undefined, { queue });
  g.input.anchor.swipeId = 'another';
  const one = await f.control.start('one');
  await until(() => f.control.view().sent === 1);
  const two = await g.control.start('two');
  g.state.template.name = 'changed while queued';
  late.resolve(response('SELECT __we_row_id FROM we_environment'));
  await Promise.all([one.done, two.done]);
  assert.equal(g.control.view().status, 'stale');
  assert.equal(g.control.view().sent, 0);
});
test('T8 queue capacity fails closed without evicting terminal dedupe receipts', async () => {
  const queue = createT8Queue(1),
    f = setup(undefined, { queue });
  await finish(f);
  f.input.anchor.swipeId = 's1';
  await assert.rejects(f.control.start('two'));
  assert.equal(queue.size, 1);
  assert.throws(() => createT8Queue(0));
  assert.throws(() => createT8Queue(257));
});
test('T8 revoking run permission while waiting/HTTP blocks later work immediately', async () => {
  let allowed = true;
  const late = deferred<{ status: number; text: string }>();
  const f = setup(undefined, { canRun: () => allowed, reply: () => late.promise });
  const job = await f.control.start('one');
  await until(() => f.control.view().sent === 1);
  allowed = false;
  late.resolve(response('SELECT __we_row_id FROM we_environment'));
  await job.done;
  assert.equal(f.control.view().status, 'stale');
  assert.equal(f.control.view().completed, 0);
});
test('T8 UI draft changes are next-run settings, not a false invalidation of frozen active rules', async () => {
  const f = setup(),
    late = deferred<{ status: number; text: string }>();
  const sandbox = await createT8Sandbox({
    scope: { mode: 't4-sandbox', chatId: 'sandbox-t8', worldId: f.state.data.worldId, branchId: f.state.data.branchId },
    initial: f.state,
    input: f.input,
    api: f.api,
    execute: executeT8Test,
    runtime: { reply: () => late.promise, pollMs: 5 },
  });
  const job = await sandbox.macro.start('one');
  await until(() => sandbox.macro.view().sent === 1);
  sandbox.generation.editPrompt('global', { state: 'value', value: 'DRAFT_ONLY_NEW_RULE' });
  late.resolve(response('SELECT __we_row_id FROM we_environment'));
  await job.done;
  assert.equal(sandbox.macro.view().status, 'staged');
  assert.doesNotMatch(JSON.stringify(sandbox.macro.view()), /DRAFT_ONLY_NEW_RULE/);
});
test('T8 cancel on validating notification prevents even starting the SQLite adapter', async () => {
  let sqlCalls = 0;
  const f = setup(undefined, {
    execute: async request => {
      sqlCalls += 1;
      return executeT8Test(request);
    },
  });
  f.control.subscribe(() => {
    if (f.control.view().batches[0]?.status === 'validating' && f.control.view().status === 'running')
      f.control.cancel();
  });
  const v = await finish(f);
  assert.equal(v.status, 'cancelled');
  assert.equal(sqlCalls, 0);
});
test('T8 fake transport path never reaches global fetch, even when reply is omitted', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('real network forbidden');
  };
  try {
    assert.equal((await finish(setup())).status, 'staged');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
