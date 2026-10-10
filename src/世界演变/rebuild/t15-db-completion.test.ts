import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { wiringFixture } from './t15-wiring-test-fixtures';
import { createT15DbCompletionProducer, type T15DbEvent, type T15DbOutcome } from './t15-db-completion-protocol';
import { createT15SourceSignals, type T15SignalFrame } from './t15-source-signals';

async function fixture() {
  const f = await wiringFixture();
  let epoch = 0,
    runtime: unknown = { sheet_npc: { content: [['姓名'], ['旅人']] } },
    update: ((data: unknown, meta?: { persisted?: boolean }) => void) | null = null;
  let frame: T15SignalFrame = {
    binding: f.binding,
    message: f.chat.at(-1)!,
    swipe: 0,
    text: f.input.story.at(-1)!.text,
    matchingBodies: 1,
  };
  const source = createT15DbCompletionProducer({
    current: () => ({ ...frame, isolation: 'slot' }),
    epoch: () => epoch,
    snapshot: () => ({ data: { TavernDB_ACU_IsolatedData: f.chat.at(-1)!.TavernDB_ACU_IsolatedData }, runtime }),
  });
  const events: T15DbEvent[] = [];
  source.observer.subscribe(e => events.push(e));
  const monitor = createT15SourceSignals({
    current: () => frame,
    epoch: () => epoch,
    mvuEvents: null,
    on: () => () => {},
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
  monitor.applyDatabaseHint(f.gate);
  f.gate.complete('mvu', f.gate.begin('mvu', f.input.anchor), [{ weather: '雨' }]);
  return {
    ...f,
    source,
    events,
    monitor,
    update: (persisted = true) => update!({}, { persisted }),
    runtime: (value: unknown) => {
      runtime = value;
    },
    frame: (next: Partial<T15SignalFrame>) => {
      frame = { ...frame, ...next };
    },
    epoch: () => {
      epoch++;
    },
    apply: () => monitor.applyDatabase(f.gate, f.selections[1].selections),
    close() {
      monitor.close();
      source.close();
      f.close();
    },
  };
}

test('database waits for all actual groups and outer terminal, then requires independent persisted confirmation', async () => {
  const f = await fixture();
  try {
    assert.equal(f.monitor.status().databaseCompletionAvailable, true);
    const ticket = f.source.begin(['one', 'two']);
    f.source.groups(ticket, ['one'], { success: true });
    f.update(false);
    f.apply();
    assert.equal((await f.gate.refresh()).ready, false);
    f.source.groups(ticket, ['two'], { success: true });
    f.update(true);
    assert.equal(f.monitor.status().database, false, 'last group is still not outer completion');
    f.source.finish(ticket, 'success', '全部结束');
    f.apply();
    assert.equal(f.gate.ready(), false, 'terminal is only a candidate');
    assert.equal((await f.gate.refresh()).ready, true);
    assert.equal(f.gate.readInput().proofs.find(p => p.sourceId === 'database')!.persisted, true);
    assert.equal(f.saves(), 1);
    assert.equal(f.bookSaves(), 0);
  } finally {
    f.close();
  }
});
test('new database data must be read back on this message, not only exist in runtime', async () => {
  const f = await fixture();
  try {
    const ticket = f.source.begin(['one']);
    const final = { slot: { result: '新的完整结果' } };
    f.chat.at(-1)!.TavernDB_ACU_IsolatedData = final;
    f.source.groups(ticket, ['one'], { success: true });
    f.source.finish(ticket, 'success', '全部结束');
    f.apply();
    assert.equal((await f.gate.refresh()).ready, false);
    f.mutate(doc => {
      (doc[2] as Record<string, unknown>).TavernDB_ACU_IsolatedData = final;
    });
    assert.equal((await f.gate.refresh()).ready, true);
  } finally {
    f.close();
  }
});
for (const [label, keys, results] of [
  ['missing group', ['a', 'b'], [['a'], { success: true }]],
  ['failed group', ['a'], [['a'], { success: false, failedGroups: ['a'] }]],
  ['unknown result', ['a'], [['a'], true]],
  ['empty runner keys', ['a'], [[], { success: true }]],
  ['foreign group', ['a'], [['b'], { success: true }]],
  ['conflicting result', ['a'], [['a'], { success: true, failedGroups: ['a'] }]],
] as const) {
  test(`database cannot publish successful outer terminal with ${label}`, async () => {
    const f = await fixture();
    try {
      const t = f.source.begin([...keys]);
      f.source.groups(t, [...results[0]], results[1]);
      f.source.finish(t, 'success', 'bad success');
      f.apply();
      assert.equal(f.monitor.status().database, false);
      assert.equal((await f.gate.refresh()).ready, false);
      assert.equal((f.events.at(-1) as Extract<T15DbEvent, { type: 'terminal' }>).outcome, 'unverifiable');
    } finally {
      f.close();
    }
  });
}
test('duplicate group, duplicate terminal, superseded and copied tickets cannot authorize', async () => {
  const f = await fixture();
  try {
    const old = f.source.begin(['a']),
      now = f.source.begin(['b']);
    assert.equal(f.source.groups(old, ['a'], { success: true }), false);
    assert.equal(f.source.finish(old, 'success', 'old'), false);
    assert.equal(f.source.groups(JSON.parse(JSON.stringify(now)), ['b'], { success: true }), false);
    f.source.groups(now, ['b'], { success: true });
    f.source.groups(now, ['b'], { success: true });
    f.source.finish(now, 'success', 'duplicate');
    f.apply();
    assert.equal((await f.gate.refresh()).ready, false);
    assert.equal(f.source.finish(now, 'success', 'duplicate'), false);
  } finally {
    f.close();
  }
});
for (const outcome of ['failure', 'cancelled'] as const) {
  test(`database ${outcome} is explicit failure, never skip/success`, async () => {
    const f = await fixture();
    try {
      const t = f.source.begin(['a']);
      f.source.finish(t, outcome, '未完成');
      f.apply();
      assert.equal((await f.gate.refresh()).ready, false);
      assert.equal(f.gate.readInput().proofs.find(p => p.sourceId === 'database')!.state, 'failure');
    } finally {
      f.close();
    }
  });
}
for (const [outcome, plan] of [
  ['frequency-skipped', []],
  ['disabled', null],
] as const) {
  test(`database explicitly ${outcome} is accepted only for the current no-work decision`, async () => {
    const f = await fixture();
    try {
      const t = f.source.begin(plan);
      f.source.finish(t, outcome, '明确跳过');
      f.apply();
      assert.equal((await f.gate.refresh()).ready, true);
      assert.equal(f.gate.readInput().proofs.find(p => p.sourceId === 'database')!.state, outcome);
    } finally {
      f.close();
    }
  });
}
test('skip cannot hide a planned job or a malformed empty-success plan', async () => {
  const f = await fixture();
  try {
    for (const [plan, outcome] of [
      [['a'], 'frequency-skipped'],
      [[], 'success'],
      [[], 'disabled'],
    ] as [string[], T15DbOutcome][]) {
      const t = f.source.begin(plan);
      f.source.finish(t, outcome, '不是可信跳过');
      f.apply();
      assert.equal((await f.gate.refresh()).ready, false);
    }
  } finally {
    f.close();
  }
});
for (const [label, change] of [
  ['swipe', (f: Awaited<ReturnType<typeof fixture>>) => f.frame({ swipe: 1 })],
  ['message', (f: Awaited<ReturnType<typeof fixture>>) => f.frame({ message: {} })],
  ['body', (f: Awaited<ReturnType<typeof fixture>>) => f.frame({ text: '另一段剧情' })],
  ['binding', (f: Awaited<ReturnType<typeof fixture>>) => f.frame({ binding: { ...f.binding, hostChatId: 'other' } })],
  ['epoch', (f: Awaited<ReturnType<typeof fixture>>) => f.epoch()],
] as const) {
  test(`late database ${label} signal cannot complete the current reply`, async () => {
    const f = await fixture();
    try {
      const t = f.source.begin(['a']);
      f.source.groups(t, ['a'], { success: true });
      change(f);
      f.source.finish(t, 'success', '迟到');
      f.apply();
      assert.equal(f.monitor.status().database, false);
      assert.equal((await f.gate.refresh()).ready, false);
    } finally {
      f.close();
    }
  });
}
test('identical delayed UI update keeps the candidate; memory-only or changed data revokes it immediately', async () => {
  const f = await fixture();
  try {
    const t = f.source.begin(['a']);
    f.source.groups(t, ['a'], { success: true });
    f.source.finish(t, 'success', '完成');
    f.apply();
    await f.gate.refresh();
    assert.equal(f.gate.ready(), true);
    f.update(true);
    assert.equal(f.gate.ready(), true);
    f.runtime({ sheet_npc: { content: [['姓名'], ['别人']] } });
    assert.equal(
      f.monitor.status().database,
      false,
      'live source guard notices runtime changes even before a notification',
    );
    f.update(true);
    assert.equal(f.gate.ready(), false);
    const next = f.source.begin(['a']);
    f.source.groups(next, ['a'], { success: true });
    f.source.finish(next, 'success', '完成');
    f.apply();
    await f.gate.refresh();
    assert.equal(f.gate.ready(), true);
    f.update(false);
    assert.equal(f.gate.ready(), false);
  } finally {
    f.close();
  }
});
test('completion cannot export a different isolation tag or adopt a missing field as success', async () => {
  const f = await fixture();
  try {
    const t = f.source.begin(['a']);
    f.source.groups(t, ['a'], { success: true });
    f.source.finish(t, 'success', '完成');
    for (const path of [
      ['TavernDB_ACU_IsolatedData'],
      ['TavernDB_ACU_IsolatedData', 'wrong'],
      ['TavernDB_ACU_IsolatedData', 'slot', 'missing'],
    ]) {
      f.monitor.applyDatabase(f.gate, [{ path, label: '资料', tableIds: ['npc'] }]);
      assert.equal((await f.gate.refresh()).ready, false);
      assert.match(f.monitor.status().databaseReason, /未采用/);
    }
  } finally {
    f.close();
  }
});
test('source snapshot is detached, supports parent-realm JSON and rejects oversized/non-JSON payloads', () => {
  const message = {},
    frame = {
      binding: { characterId: 'card.png', hostChatId: 'chat' },
      message,
      swipe: 0,
      text: '剧情',
      isolation: 'default',
    };
  let data: unknown = vm.runInNewContext('({TavernDB_ACU_IsolatedData:{slot:{rows:[1]}}})');
  const events: T15DbEvent[] = [],
    p = createT15DbCompletionProducer({
      current: () => frame,
      epoch: () => 0,
      snapshot: () => ({ data, runtime: {} }),
    });
  p.observer.subscribe(e => events.push(e));
  const t = p.begin(['a']);
  p.groups(t, ['a'], { success: true });
  p.finish(t, 'success', '完成');
  const e = events.at(-1) as Extract<T15DbEvent, { type: 'terminal' }>;
  assert.equal(e.outcome, 'success');
  assert.equal(p.observer.isCurrent(t), true);
  (data as { TavernDB_ACU_IsolatedData: { slot: { rows: number[] } } }).TavernDB_ACU_IsolatedData.slot.rows.push(2);
  assert.equal(p.observer.isCurrent(t), false);
  assert.deepEqual(e.data, { TavernDB_ACU_IsolatedData: { slot: { rows: [1] } } });
  for (const value of [new Date(), { text: 'x'.repeat(2_000_001) }]) {
    data = value;
    const token = p.begin(['a']);
    p.groups(token, ['a'], { success: true });
    p.finish(token, 'success', '坏数据');
    assert.equal((events.at(-1) as Extract<T15DbEvent, { type: 'terminal' }>).outcome, 'unverifiable');
  }
  p.close();
  p.close();
});
test('source close revokes current permission, observer exceptions do not affect the database and no completion is replayed', async () => {
  const f = await fixture();
  try {
    f.source.observer.subscribe(() => {
      throw new Error('broken view');
    });
    const t = f.source.begin(['a']);
    f.source.groups(t, ['a'], { success: true });
    f.source.finish(t, 'success', '完成');
    f.apply();
    await f.gate.refresh();
    assert.equal(f.gate.ready(), true);
    let late = 0;
    f.source.observer.subscribe(() => late++);
    assert.equal(late, 0);
    f.source.close();
    assert.equal(f.gate.ready(), false);
    assert.equal(late, 1);
    assert.throws(() => f.source.begin([]), /closed/);
  } finally {
    f.close();
  }
});
