import assert from 'node:assert/strict';
import test from 'node:test';
import { wiringFixture } from './t15-wiring-test-fixtures';
import { createT15SourceSignals, createT15NativeSourceSignals, type T15SignalFrame } from './t15-source-signals';
import { createT15DbCompletionProducer } from './t15-db-completion-protocol';
import { createT15HostWorkspace } from './t15-host-workspace';
import { attachT15Automatic } from './t15-automatic';
import { acquireT15TriggerOwner, assertT15NoOtherEntries } from './t15-trigger-ownership';
import { createT15ApiTransport } from './t15-api-transport';
import { deferredT8Test, executeT8Test } from './t8-test-fixtures';
import { untilT9Test } from './t9-test-fixtures';
import { createT15AutomaticLifecycle } from './t15-automatic-lifecycle';
import { openT15NativeWorkspace } from './t15-native-workspace';
import { WORLD_EVOLUTION_API_CONFIG_KEY } from '../api-config';

async function fixture(reply?: () => Promise<Response>, legacy = () => {}) {
  const f = await wiringFixture(),
    callbacks = new Map<string, (...args: unknown[]) => void>();
  let sourceEpoch = 0,
    sends = 0;
  let frame: T15SignalFrame = {
    binding: f.binding,
    message: f.chat.at(-1)!,
    swipe: 0,
    text: f.input.story.at(-1)!.text,
    matchingBodies: 1,
  };
  let update: ((data: unknown, meta?: { persisted?: boolean }) => void) | null = null;
  const source = createT15DbCompletionProducer({
    current: () => ({ ...frame, isolation: 'slot' }),
    epoch: () => sourceEpoch,
    snapshot: () => ({ data: { TavernDB_ACU_IsolatedData: f.chat.at(-1)!.TavernDB_ACU_IsolatedData }, runtime: {} }),
  });
  const signals = createT15SourceSignals({
    current: () => frame,
    epoch: () => sourceEpoch,
    mvuEvents: { parsed: 'parsed', reconciled: 'ended' },
    on(event, fn) {
      callbacks.set(event, fn);
      return () => {
        callbacks.delete(event);
      };
    },
    database: {
      getWorldEvolutionCompletion: () => source.observer,
      registerTableUpdateCallback(fn) {
        update = fn;
      },
      unregisterTableUpdateCallback() {
        update = null;
      },
    },
  });
  const target = {},
    owner = acquireT15TriggerOwner(target, legacy);
  const workspace = await createT15HostWorkspace({
    driver: f.host.driver,
    scope: f.scope,
    execute: executeT8Test,
    prerequisites: f.gate,
    bookDriver: f.book.driver,
    api: { read: () => f.model.api, save: next => next },
    triggerOwner: owner,
    transport: createT15ApiTransport({
      authorize: () => {},
      fetchImpl: async () => {
        sends++;
        if (reply) return reply();
        const sql =
          sends === 1
            ? "UPDATE we_environment SET f_risk = 80 WHERE __we_row_id = 'small-valley-weather'"
            : "UPDATE we_npc SET f_goals = '等雨停' WHERE __we_row_id = 'traveler'";
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sql, parameters: [] }) } }] }),
        );
      },
    }),
  });
  const automatic = attachT15Automatic({
    signals,
    gate: f.gate,
    sources: f.selections,
    daily: workspace.daily,
    authorized: workspace.realApiEnabled,
    valid: () => owner.owns() && f.host.status().state === 'ready',
    busy: () => !workspace.automaticIdle(),
    assertOwner: owner.assertAvailable,
    refresh: workspace.refresh,
    delayMs: 2,
    attempts: 3,
  });
  const arm = () => {
    workspace.authorizeRealApi(true);
    workspace.daily.setAutomatic(true);
  };
  const mvu = (weather = '雨') => {
    const vars = { stat_data: { weather } };
    callbacks.get('parsed')!(vars, [], frame.text);
    callbacks.get('ended')!(vars);
    return vars;
  };
  const db = (outcome: 'success' | 'failure' | 'cancelled' | 'disabled' | 'frequency-skipped' = 'success') => {
    const ticket = source.begin(outcome === 'disabled' ? null : outcome === 'frequency-skipped' ? [] : ['one']);
    if (!['disabled', 'frequency-skipped'].includes(outcome))
      source.groups(ticket, ['one'], { success: outcome === 'success' });
    source.finish(ticket, outcome, 'fixture whole round');
    return ticket;
  };
  return {
    ...f,
    signals,
    source,
    owner,
    target,
    automatic,
    workspace,
    arm,
    mvu,
    db,
    sends: () => sends,
    update: () => update!({}, { persisted: true }),
    change() {
      sourceEpoch++;
      frame = { ...frame, swipe: 1 };
      signals.invalidate();
      automatic.invalidate();
    },
    async closeAll() {
      automatic.close();
      workspace.close();
      owner.close();
      signals.close();
      source.close();
      await Promise.all([automatic.settled(), workspace.daily.settled()]);
      f.close();
    },
  };
}

test('H2 defaults off; construction, refresh, and enabling do not replay completed sources', async () => {
  const f = await fixture();
  try {
    f.mvu();
    f.db();
    await f.automatic.settled();
    assert.equal(f.sends(), 0);
    f.arm();
    await f.workspace.refresh();
    await f.automatic.settled();
    assert.equal(f.sends(), 0);
    assert.equal(f.bookSaves(), 0);
  } finally {
    await f.closeAll();
  }
});
for (const order of ['mvu-first', 'db-first'] as const)
  test(`H2 ${order} waits for both, uses one T11/T9 round and one formal commit`, async () => {
    const f = await fixture();
    try {
      f.arm();
      if (order === 'mvu-first') f.mvu();
      else f.db();
      await f.automatic.settled();
      assert.equal(f.sends(), 0);
      if (order === 'mvu-first') f.db();
      else f.mvu();
      await untilT9Test(() => f.workspace.round.view().status === 'saved');
      await f.automatic.settled();
      assert.equal(f.sends(), 2);
      assert.equal((await f.gateway.read(f.scope)).commits.length, 1);
      assert.equal(f.workspace.daily.view().runs.length, 1);
      assert.equal(f.bookSaves(), 0);
      f.update();
      f.signals.wake();
      f.signals.wake();
      await f.automatic.settled();
      assert.equal(f.sends(), 2);
      assert.equal((await f.gateway.read(f.scope)).commits.length, 1);
    } finally {
      await f.closeAll();
    }
  });
for (const outcome of ['failure', 'cancelled'] as const)
  test(`H2 database ${outcome} cannot start after MVU success`, async () => {
    const f = await fixture();
    try {
      f.arm();
      f.mvu();
      f.db(outcome);
      await f.automatic.settled();
      assert.equal(f.sends(), 0);
    } finally {
      await f.closeAll();
    }
  });
for (const outcome of ['disabled', 'frequency-skipped'] as const)
  test(`H2 explicit database ${outcome} is allowed, never guessed by timeout`, async () => {
    const f = await fixture();
    try {
      f.arm();
      f.mvu();
      f.db(outcome);
      await untilT9Test(() => f.workspace.round.view().status === 'saved');
      assert.equal(f.sends(), 2);
    } finally {
      await f.closeAll();
    }
  });
test('H2 completion without durable fields exhausts bounded readback with zero requests', async () => {
  const f = await fixture();
  try {
    f.arm();
    f.mvu('雪');
    f.db();
    await untilT9Test(() => f.automatic.view().checks === 3 && !f.automatic.view().checking);
    assert.equal(f.gate.ready(), false);
    assert.equal(f.sends(), 0);
    assert.match(f.automatic.view().reason, /复核次数已用完/);
  } finally {
    await f.closeAll();
  }
});
test('H2 readback can confirm a later save without replacing candidate tokens or assuming delay success', async () => {
  const f = await fixture();
  try {
    f.arm();
    f.mvu('雪');
    f.db();
    await untilT9Test(() => f.automatic.view().checks >= 1);
    f.mutate(doc => {
      (doc[2] as { variables: Record<string, unknown>[] }).variables[0].stat_data = { weather: '雪' };
    });
    (f.chat.at(-1)!.variables as Record<string, unknown>[])[0].stat_data = { weather: '雪' };
    await untilT9Test(() => f.workspace.round.view().status === 'saved');
    assert.equal(f.sends(), 2);
  } finally {
    await f.closeAll();
  }
});
test('H2 manual and automatic race share dispatch ownership; repeat manual does not send again', async () => {
  const f = await fixture();
  try {
    f.mvu();
    f.db();
    f.signals.applyMvu(f.gate, f.selections[0].selections);
    f.signals.applyDatabase(f.gate, f.selections[1].selections);
    await f.workspace.refresh();
    f.arm();
    f.signals.wake();
    await f.workspace.daily.start();
    await f.automatic.settled();
    assert.equal(f.sends(), 2);
    assert.equal((await f.gateway.read(f.scope)).commits.length, 1);
    await f.workspace.daily.start();
    assert.equal(f.sends(), 2);
  } finally {
    await f.closeAll();
  }
});
test('H2 invalid SQL failure is not auto retried by repeated source or persisted notifications', async () => {
  const f = await fixture(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"sql":"BAD SQL","parameters":[]}' } }] })),
  );
  try {
    f.arm();
    f.mvu();
    f.db();
    await untilT9Test(() => f.workspace.round.view().status === 'failed');
    await f.automatic.settled();
    f.signals.wake();
    f.signals.wake();
    await f.automatic.settled();
    assert.equal(f.sends(), 1);
    assert.equal((await f.gateway.read(f.scope)).commits.length, 0);
  } finally {
    await f.closeAll();
  }
});
for (const revoke of ['automatic-off', 'api-off', 'input-changed'] as const)
  test(`H2 ${revoke} cancels delayed macro, prevents micro and formal commit`, async () => {
    const release = deferredT8Test<Response>(),
      entered = deferredT8Test<void>();
    const f = await fixture(async () => {
      entered.resolve();
      return release.promise;
    });
    try {
      f.arm();
      f.mvu();
      f.db();
      await entered.promise;
      if (revoke === 'automatic-off') f.workspace.daily.setAutomatic(false);
      else if (revoke === 'api-off') f.workspace.authorizeRealApi(false);
      else f.change();
      release.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"sql":"SELECT __we_row_id FROM we_environment","parameters":[]}' } }],
          }),
        ),
      );
      await f.automatic.settled();
      assert.equal(f.sends(), 1);
      assert.equal((await f.gateway.read(f.scope)).commits.length, 0);
      assert.equal(f.bookSaves(), 0);
    } finally {
      release.resolve(new Response('{}'));
      await f.closeAll();
    }
  });
test('H2 draft blocks automatic dispatch and is preserved; saving/refreshing it alone does not trigger', async () => {
  const f = await fixture();
  try {
    f.arm();
    const template = structuredClone(f.model.state.template);
    template.name += '（未保存草稿）';
    f.workspace.structure.replaceTemplate(template);
    f.mvu();
    f.db();
    await f.automatic.settled();
    assert.equal(f.workspace.structure.dirty(), true);
    assert.equal(f.sends(), 0);
  } finally {
    await f.closeAll();
  }
});
test('H2 a newly enabled legacy entry at the dispatch boundary blocks all model sends', async () => {
  let legacy = false;
  const f = await fixture(undefined, () => {
    if (legacy) throw new Error('legacy active');
  });
  try {
    f.arm();
    legacy = true;
    f.mvu();
    f.db();
    await f.automatic.settled();
    assert.equal(f.sends(), 0);
  } finally {
    await f.closeAll();
  }
});

test('H2 owner is shared across entry instances; closing waits for in-flight claim, attempts survive reopen', () => {
  const target = {},
    scope = { mode: 't10-host' as const, chatId: 'chat-test', worldId: 'world', branchId: 'main' },
    anchor = { chatId: scope.chatId, messageId: 'message-a', swipeId: 'swipe-a', inputFingerprint: 'a'.repeat(64) };
  const first = acquireT15TriggerOwner(target, () => {}, 1),
    claim = first.claim(scope, anchor)!;
  assert.throws(() => acquireT15TriggerOwner(target, () => {}));
  first.close();
  assert.throws(() => claim.assertCurrent());
  assert.throws(() => acquireT15TriggerOwner(target, () => {}));
  claim.finish();
  claim.finish();
  const second = acquireT15TriggerOwner(target, () => {}, 1);
  assert.equal(second.claim(scope, anchor), null);
  assert.throws(() => second.claim(scope, { ...anchor, swipeId: 'swipe-b' }), /账本已满/);
  second.close();
});
function script(id: string, name: string, content = '', enabled = true): Script {
  return {
    type: 'script',
    id,
    name,
    content,
    enabled,
    info: '',
    button: { enabled: false, buttons: [] },
    data: {},
    export_with: { data: false, button: false },
  };
}
test('H2 read-only script inventory checks global/preset/character and excludes only the exact own id', () => {
  assert.doesNotThrow(() =>
    assertT15NoOtherEntries([[script('self', '世界演变')], [], [script('old', '世界演变', '', false)]], 'self'),
  );
  assert.throws(() => assertT15NoOtherEntries([[], [script('old', '世界演变')], []], 'self'));
  assert.throws(() =>
    assertT15NoOtherEntries(
      [[], [], [script('alias', '改名', "import 'https://example.test/dist/世界演变/index.js'")]],
      'self',
    ),
  );
  assert.throws(() => assertT15NoOtherEntries([[], []], 'self'));
  const folder: ScriptFolder = {
    type: 'folder',
    id: 'folder',
    name: '',
    enabled: false,
    icon: '',
    color: '',
    scripts: [script('old', '世界演变')],
  };
  assert.doesNotThrow(() => assertT15NoOtherEntries([[folder], [], []], 'self'));
  folder.enabled = true;
  assert.throws(() => assertT15NoOtherEntries([[folder], [], []], 'self'));
});

test('H2 unclaimed raw round entry cannot reserve budget or send; completed claims require explicit owned continuation', async () => {
  const f = await fixture();
  try {
    f.mvu();
    f.db();
    f.signals.applyMvu(f.gate, f.selections[0].selections);
    f.signals.applyDatabase(f.gate, f.selections[1].selections);
    await f.workspace.refresh();
    f.arm();
    const saves = f.saves();
    await assert.rejects(f.workspace.round.start('unclaimed-raw-entry'));
    assert.equal(f.sends(), 0);
    assert.equal(f.saves(), saves);
    const claim = f.owner.claim(f.scope, f.input.anchor)!;
    claim.assertCurrent();
    claim.finish();
    assert.throws(() => f.owner.assertClaim(f.scope, f.input.anchor));
    assert.equal(f.owner.canContinue(f.scope, f.input.anchor), true);
    const continuation = f.owner.continueClaim(f.scope, f.input.anchor);
    continuation.assertCurrent();
    continuation.finish();
    assert.equal(f.owner.claim(f.scope, f.input.anchor), null);
  } finally {
    await f.closeAll();
  }
});
test('H2 a paused micro batch only resumes through explicit same-run ownership, without a fresh automatic attempt', async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    if (calls === 2) return new Response('fake provider failure', { status: 500 });
    const sql =
      calls === 1
        ? "UPDATE we_environment SET f_risk = 80 WHERE __we_row_id = 'small-valley-weather'"
        : "UPDATE we_npc SET f_goals = '等雨停' WHERE __we_row_id = 'traveler'";
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sql, parameters: [] }) } }] }),
    );
  });
  try {
    f.arm();
    f.mvu();
    f.db();
    await f.automatic.settled();
    assert.equal(f.workspace.round.view().status, 'paused', JSON.stringify(f.workspace.round.view().error));
    const runId = f.workspace.round.view().runId;
    f.signals.wake();
    await f.automatic.settled();
    assert.equal(f.sends(), 2);
    assert.equal(f.workspace.daily.view().canResume, true, JSON.stringify(f.workspace.daily.view().readiness));
    assert.equal(await f.workspace.daily.resume(), true);
    assert.equal(f.workspace.round.view().status, 'saved', JSON.stringify(f.workspace.round.view().error));
    assert.equal(f.workspace.round.view().runId, runId);
    assert.equal(f.sends(), 3);
    assert.equal((await f.gateway.read(f.scope)).commits.length, 1);
  } finally {
    await f.closeAll();
  }
});

for (const notice of ['binding', 'cancelled'] as const)
  test(`H2 ${notice} revokes lifecycle even without valid source candidates; old grant cannot return`, async () => {
    const signals = createT15SourceSignals({
      current: () => ({
        binding: { characterId: 'card', hostChatId: 'chat' },
        message: {},
        swipe: 0,
        text: '剧情',
        matchingBodies: 1,
      }),
      epoch: () => 0,
      mvuEvents: null,
      database: null,
      on: () => () => {},
    });
    let opens = 0;
    const lifecycle = createT15AutomaticLifecycle({
      signals,
      sources: [{ id: 'database', required: true }],
      configurationIdentity: () => 'same',
      async open() {
        opens++;
        throw new Error('should not open');
      },
    });
    try {
      lifecycle.arm(true);
      signals.invalidate(notice);
      signals.wake('source');
      await lifecycle.settled();
      assert.equal(lifecycle.view().armed, false);
      assert.equal(opens, 0);
    } finally {
      lifecycle.close();
      await lifecycle.settled();
      signals.close();
    }
  });

test('H2 actual native composition uses fake globals only: source wake -> durable proof -> one round, inventory and cleanup', async () => {
  const f = await fixture();
  f.automatic.close();
  f.workspace.close();
  f.owner.close();
  f.host.close();
  f.signals.detach(f.gate);
  const globals = globalThis as unknown as Record<string, unknown>,
    names = [
      'window',
      'SillyTavern',
      'tavern_events',
      'eventOn',
      'getCharWorldbookNames',
      'getWorldbook',
      'getVariables',
      'getScriptId',
      'getScriptTrees',
    ];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globals, name)]));
  const hides = new Set<() => void>();
  let sends = 0;
  const fakeFetch = async (url: string, init: RequestInit) => {
    if (url.endsWith('/api/worldinfo/get')) return new Response(JSON.stringify(f.rawBook()));
    if (url.startsWith('http://127.0.0.1:8000/')) return f.port.fetchImpl(url, init);
    sends++;
    const sql =
      sends === 1
        ? "UPDATE we_environment SET f_risk = 80 WHERE __we_row_id = 'small-valley-weather'"
        : "UPDATE we_npc SET f_goals = '等雨停' WHERE __we_row_id = 'traveler'";
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sql, parameters: [] }) } }] }),
    );
  };
  const parent = { location: { href: 'http://127.0.0.1:8000/' }, fetch: fakeFetch };
  const injected: Record<string, unknown> = {
    window: {
      parent,
      fetch: fakeFetch,
      addEventListener: (_event: string, fn: () => void) => hides.add(fn),
      removeEventListener: (_event: string, fn: () => void) => hides.delete(fn),
    },
    SillyTavern: {
      ...f.port.context(),
      characters: [{ avatar: f.binding.characterId, chat: f.binding.hostChatId, name: '角色' }],
      chatMetadata: f.metadata,
      getWorldInfoNames: () => ['主书'],
    },
    tavern_events: f.port.events,
    eventOn: f.port.on,
    getCharWorldbookNames: f.port.getPrimary,
    getWorldbook: f.port.getWorldbook,
    getVariables: () => ({ [WORLD_EVOLUTION_API_CONFIG_KEY]: f.model.api }),
    getScriptId: () => 'self',
    getScriptTrees: () => [script('self', '世界演变')],
  };
  let native: Awaited<ReturnType<typeof openT15NativeWorkspace>> | undefined;
  try {
    for (const [name, value] of Object.entries(injected))
      Object.defineProperty(globals, name, { configurable: true, writable: true, value });
    native = await openT15NativeWorkspace({
      version: 'fake-H2',
      execute: executeT8Test,
      confirmedSinglePage: true,
      initializeIfEmpty: false,
      sources: f.selections,
      signals: f.signals,
    });
    assert.equal(sends, 0);
    native.authorizeRealApi(true);
    native.daily.setAutomatic(true);
    f.mvu();
    f.db();
    await native.automatic.settled();
    assert.equal(
      native.round.view().status,
      'saved',
      JSON.stringify({
        automatic: native.automatic.view(),
        proofs: native.readInput().proofs,
        daily: native.daily.view().error,
        round: native.round.view().error,
      }),
    );
    assert.equal(sends, 2);
    assert.equal((await native.store.read(f.scope)).commits.length, 1);
    assert.equal(f.bookSaves(), 0);
    await assert.rejects(
      openT15NativeWorkspace({
        version: 'fake-duplicate',
        execute: executeT8Test,
        confirmedSinglePage: true,
        initializeIfEmpty: false,
        sources: f.selections,
        signals: f.signals,
      }),
      /所有权/,
    );
  } finally {
    native?.close();
    if (native) await Promise.all([native.automatic.settled(), native.daily.settled()]);
    for (const name of names) {
      const descriptor = originals.get(name);
      if (descriptor) Object.defineProperty(globals, name, descriptor);
      else delete globals[name];
    }
    await f.closeAll();
  }
  assert.equal(hides.size, 0);
  assert.equal(
    [...f.handlers.values()].reduce((n, handlers) => n + handlers.size, 0),
    0,
  );
});
test('H2 native source factory maps real event names and cleans source subscriptions on late registration failure', async () => {
  const globals = globalThis as unknown as Record<string, unknown>,
    names = ['window', 'SillyTavern', 'tavern_events', 'eventOn'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globals, name)]));
  const handlers = new Map<string, Set<() => void>>(),
    hides = new Set<() => void>();
  const message = { mes: '剧情', is_user: false, swipe_id: 0 };
  let fail = false,
    updates = 0,
    subscriptions = 0;
  const events = Object.fromEntries(
    [
      'CHAT_CHANGED',
      'MESSAGE_SWIPED',
      'MESSAGE_SWIPE_DELETED',
      'MESSAGE_DELETED',
      'MESSAGE_EDITED',
      'GENERATION_STARTED',
      'GENERATION_STOPPED',
      'MESSAGE_UPDATED',
      'MESSAGE_RECEIVED',
      'GENERATION_ENDED',
      'CHARACTER_EDITED',
      'CHARACTER_DELETED',
    ].map(name => [name, name]),
  );
  const observer = {
    protocol: 'WorldEvolution/TavernDB-auto-round/1',
    coverage: ['automatic-plan'],
    candidateOnly: true,
    isCurrent: () => false,
    subscribe: () => {
      subscriptions++;
    },
    unsubscribe: () => {
      subscriptions--;
    },
  };
  const injected = {
    window: {
      parent: {
        AutoCardUpdaterAPI: {
          getWorldEvolutionCompletion: () => observer,
          registerTableUpdateCallback: () => {
            updates++;
          },
          unregisterTableUpdateCallback: () => {
            updates--;
          },
        },
      },
      addEventListener: (_event: string, fn: () => void) => hides.add(fn),
      removeEventListener: (_event: string, fn: () => void) => hides.delete(fn),
    },
    SillyTavern: {
      characterId: 0,
      characters: [{ avatar: 'card.png', chat: 'chat' }],
      chat: [message],
      getCurrentChatId: () => 'chat',
    },
    tavern_events: events,
    eventOn(event: string, fn: () => void) {
      if (fail && event === 'MESSAGE_UPDATED') throw new Error('late registration failure');
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return {
        stop: () => {
          handlers.get(event)!.delete(fn);
        },
      };
    },
  };
  try {
    for (const [name, value] of Object.entries(injected))
      Object.defineProperty(globals, name, { configurable: true, writable: true, value });
    const monitor = await createT15NativeSourceSignals({ mvu: false, database: true }),
      notices: string[] = [];
    monitor.subscribe(notice => notices.push(notice));
    for (const event of ['GENERATION_ENDED', 'MESSAGE_UPDATED', 'CHAT_CHANGED', 'GENERATION_STOPPED'])
      for (const fn of handlers.get(event)!) fn();
    assert.deepEqual(notices, ['assistant', 'persisted', 'binding', 'cancelled']);
    monitor.close();
    assert.throws(() => monitor.frame());
    assert.equal(subscriptions, 0);
    assert.equal(updates, 0);
    assert.equal(hides.size, 0);
    fail = true;
    await assert.rejects(createT15NativeSourceSignals({ mvu: false, database: true }), /late registration failure/);
    assert.equal(subscriptions, 0);
    assert.equal(updates, 0);
    assert.equal(
      [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
      0,
    );
  } finally {
    for (const name of names) {
      const descriptor = originals.get(name);
      if (descriptor) Object.defineProperty(globals, name, descriptor);
      else delete globals[name];
    }
  }
});

test('H2 lifecycle captures consecutive reply sessions, closes old first, and never opens on arm alone', async () => {
  let epoch = 0,
    frame: T15SignalFrame = {
      binding: { characterId: 'card.png', hostChatId: 'chat' },
      message: {},
      swipe: 0,
      text: '第一轮',
      matchingBodies: 1,
    };
  const signals = createT15SourceSignals({
    current: () => frame,
    epoch: () => epoch,
    mvuEvents: null,
    database: null,
    on: () => () => {},
  });
  let opens = 0,
    closes = 0,
    config = 'route-v1',
    dirty = false;
  const sessions: { revoke(): void; assert(): void }[] = [];
  const lifecycle = createT15AutomaticLifecycle({
    signals,
    sources: [],
    configurationIdentity: () => config,
    async open(assertCurrent) {
      opens++;
      let auto = false,
        consent = false,
        closed = false;
      const listeners = new Set<() => void>();
      const daily = {
        setAutomatic(value: boolean) {
          auto = value;
          listeners.forEach(fn => fn());
        },
        view: () => ({ autoEnabled: auto }),
        subscribe(fn: () => void) {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        settled: async () => {},
      };
      sessions.push({
        revoke: () => {
          consent = false;
        },
        assert: assertCurrent,
      });
      return {
        daily,
        authorizeRealApi(value: boolean) {
          consent = value;
        },
        realApiEnabled: () => consent,
        canHandoff: () => !dirty,
        automatic: { settled: async () => {} },
        close() {
          if (!closed) {
            closes++;
            closed = true;
          }
        },
      };
    },
  });
  try {
    lifecycle.arm(true);
    await lifecycle.settled();
    assert.equal(opens, 0);
    signals.wake();
    await lifecycle.settled();
    assert.equal(opens, 0, 'ordinary table/save hint cannot start no-source path');
    signals.wake('assistant');
    await lifecycle.settled();
    assert.equal(opens, 1);
    signals.wake('assistant');
    await lifecycle.settled();
    assert.equal(opens, 1);
    epoch++;
    frame = { ...frame, message: {}, text: '第二轮' };
    assert.throws(() => sessions[0].assert());
    signals.wake('assistant');
    await lifecycle.settled();
    assert.equal(opens, 2);
    assert.equal(closes, 1);
    dirty = true;
    epoch++;
    frame = { ...frame, message: {}, text: '第三轮' };
    signals.wake('assistant');
    await lifecycle.settled();
    assert.equal(opens, 2);
    assert.equal(closes, 1);
    assert.equal(lifecycle.view().armed, false);
    assert.match(lifecycle.view().reason, /草稿|页面关闭/);
    dirty = false;
    lifecycle.arm(true);
    config = 'route-v2';
    signals.wake('assistant');
    await lifecycle.settled();
    assert.equal(opens, 2);
    assert.equal(lifecycle.view().armed, false);
  } finally {
    lifecycle.close();
    await lifecycle.settled();
    signals.close();
  }
  assert.equal(closes, 2);
});
test('H2 lifecycle refuses a late open and cleans it after reply changes while awaiting capture', async () => {
  let epoch = 0;
  const message = {};
  const signals = createT15SourceSignals({
    current: () => ({
      binding: { characterId: 'card', hostChatId: 'chat' },
      message,
      swipe: 0,
      text: '剧情',
      matchingBodies: 1,
    }),
    epoch: () => epoch,
    mvuEvents: null,
    database: null,
    on: () => () => {},
  });
  const started = deferredT8Test<void>(),
    release = deferredT8Test<void>();
  let closed = 0,
    granted = 0;
  const lifecycle = createT15AutomaticLifecycle({
    signals,
    sources: [],
    configurationIdentity: () => 'same',
    async open() {
      started.resolve();
      await release.promise;
      return {
        daily: {
          setAutomatic: () => {},
          view: () => ({ autoEnabled: false }),
          subscribe: () => () => {},
          settled: async () => {},
        },
        authorizeRealApi: () => {
          granted++;
        },
        realApiEnabled: () => false,
        canHandoff: () => true,
        automatic: { settled: async () => {} },
        close: () => {
          closed++;
        },
      };
    },
  });
  try {
    lifecycle.arm(true);
    signals.wake('assistant');
    await started.promise;
    epoch++;
    release.resolve();
    await lifecycle.settled();
    assert.equal(closed, 1);
    assert.equal(granted, 0);
    assert.equal(lifecycle.view().armed, false);
  } finally {
    release.resolve();
    lifecycle.close();
    await lifecycle.settled();
    signals.close();
  }
});
