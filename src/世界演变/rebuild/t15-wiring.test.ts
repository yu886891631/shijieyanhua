import assert from 'node:assert/strict';
import test from 'node:test';
import { wiringFixture } from './t15-wiring-test-fixtures';
import { createT15SourceSignals, type T15SignalFrame } from './t15-source-signals';
import { captureT15Input } from './t15-prerequisites';
import { createT15HostWorkspace } from './t15-host-workspace';
import { executeT8Test, deferredT8Test } from './t8-test-fixtures';
import { createT15ApiTransport } from './t15-api-transport';
import { copyT10 } from './t10-host-protocol';
import { buildT12Projection, copyT12 } from './t12-projection';
import { canWriteT12, canSynchronizeT12Compatibility, confirmedT12Book } from './t12-gateway';
import { fingerprintT4 } from './t4-protocol';
import { createT12Controller, createT12CompatibilityController } from './t12-controller';
import { createT4CommitService } from './t4-service';
import { createT15WorldbookCompatibility } from './t15-worldbook-compatibility';

test('actual MVU and database receipts wait separately for persisted results; hints cannot complete', async () => {
  const f = await wiringFixture();
  try {
    assert.equal((await f.gate.refresh()).ready, false);
    f.gate.hint('database', '更新不是完成');
    assert.equal(f.gate.ready(), false);
    const a = f.gate.begin('mvu', f.input.anchor);
    f.gate.complete('mvu', a, [{ weather: '雪' }]);
    assert.equal((await f.gate.refresh()).ready, false);
    assert.equal(f.gate.readInput().segments.length, 0);
    f.mutate(doc => {
      (doc[2] as { variables: Record<string, unknown>[] }).variables[0].stat_data = { weather: '雪' };
    });
    await f.gate.refresh();
    assert.equal(f.gate.readInput().proofs[0].persisted, true);
    assert.equal(f.gate.ready(), false);
    const b = f.gate.begin('database', f.input.anchor);
    f.gate.complete('database', b, [{ result: '本轮结果' }]);
    assert.equal((await f.gate.refresh()).ready, true);
    assert.equal(f.gate.ready(), true);
    assert.equal(f.saves(), 1);
    assert.equal(f.bookSaves(), 0);
    f.gate.hint('database', '仅内存更新');
    assert.equal(f.gate.ready(), false);
    assert.equal(f.gate.readInput().segments.length, 0);
  } finally {
    f.close();
  }
});
test('late, foreign-swipe, copied JSON and duplicate receipts cannot authorize', async () => {
  const f = await wiringFixture();
  try {
    assert.throws(() => f.gate.begin('mvu', { ...f.input.anchor, swipeId: 'wrong' }));
    const a = f.gate.begin('mvu', f.input.anchor),
      b = f.gate.begin('mvu', f.input.anchor);
    assert.throws(() => f.gate.complete('mvu', a, [{ weather: '雨' }]));
    assert.throws(() => f.gate.complete('mvu', JSON.parse(JSON.stringify(b)), [{ weather: '雨' }]));
    f.gate.complete('mvu', b, [{ weather: '雨' }]);
    assert.throws(() => f.gate.complete('mvu', b, [{ weather: '雨' }]));
    f.setEpoch();
    await assert.rejects(f.gate.refresh());
    assert.equal(f.gate.ready(), false);
  } finally {
    f.close();
  }
});
test('unannounced story/swipe changes and unstamped messages are refused, not substituted with an old floor', async () => {
  const f = await wiringFixture();
  try {
    await f.complete();
    f.mutate(doc => {
      (doc[2] as Record<string, unknown>).mes = '改写';
    });
    await assert.rejects(f.gate.refresh());
    assert.equal(f.gate.ready(), false);
    f.mutate(doc => {
      doc.push({ is_user: true, mes: '新指令' });
    });
    await assert.rejects(captureT15Input({ read: f.read, epoch: () => 0 }, f.scope, 2));
  } finally {
    f.close();
  }
});
test('MVU parsed object/reconciled object + exact body are candidates, not durable success; cleanup is complete', async () => {
  const f = await wiringFixture();
  let callback: ((data: unknown, meta?: { persisted?: boolean }) => void) | null = null;
  const callbacks = new Map<string, (...args: unknown[]) => void>(),
    message = {};
  let epoch = 0,
    frame: T15SignalFrame = {
      binding: f.binding,
      message,
      swipe: 0,
      text: f.input.story.at(-1)!.text,
      matchingBodies: 1,
    };
  const monitor = createT15SourceSignals({
    current: () => frame,
    epoch: () => epoch,
    mvuEvents: { parsed: 'parsed', reconciled: 'zod' },
    on: (event, fn) => {
      callbacks.set(event, fn);
      return () => {
        callbacks.delete(event);
      };
    },
    database: {
      registerTableUpdateCallback: fn => {
        callback = fn;
      },
      unregisterTableUpdateCallback: () => {
        callback = null;
      },
    },
  });
  try {
    const vars = { stat_data: { weather: '雨' } };
    callbacks.get('parsed')!(vars, [], frame.text);
    callbacks.get('zod')!({ stat_data: { weather: '雨' } });
    assert.throws(() => monitor.applyMvu(f.gate, f.selections[0].selections));
    callbacks.get('zod')!(vars);
    monitor.applyMvu(f.gate, f.selections[0].selections);
    assert.equal(f.gate.ready(), false);
    assert.equal((await f.gate.refresh()).ready, false);
    assert.equal(f.gate.readInput().proofs[0].persisted, true);
    (callback as unknown as (data: unknown, meta: { persisted: boolean }) => void)({}, { persisted: true });
    monitor.applyDatabaseHint(f.gate);
    assert.equal(f.gate.readInput().proofs[1].state, 'unverifiable');
    await f.complete();
    assert.equal(f.gate.ready(), true);
    callbacks.get('parsed')!(vars, [], frame.text);
    assert.equal(f.gate.ready(), false, 'a new MVU parse revokes the old current permission immediately');
    await f.complete();
    assert.equal(f.gate.ready(), true);
    (callback as unknown as (data: unknown, meta: { persisted: boolean }) => void)({}, { persisted: true });
    assert.equal(f.gate.ready(), false, 'even a persisted database update is not whole-round completion');
    epoch++;
    assert.throws(() => monitor.applyMvu(f.gate, f.selections[0].selections));
    frame = { ...frame, matchingBodies: 2 };
    callbacks.get('parsed')!(vars, [], frame.text);
    assert.equal(monitor.status().mvu, false);
  } finally {
    monitor.close();
    monitor.close();
    f.close();
  }
  assert.equal(callbacks.size, 0);
  assert.equal(callback, null);
});

test('source construction failure cleans previously registered listeners and a partially attached database callback', () => {
  const active = new Set<string>();
  const base = {
    current: () => {
      throw new Error('not accessed');
    },
    epoch: () => 0,
    mvuEvents: { parsed: 'parsed', reconciled: 'zod' },
  };
  assert.throws(
    () =>
      createT15SourceSignals({
        ...base,
        database: null,
        on(event) {
          if (event === 'zod') throw new Error('registration failed');
          active.add(event);
          return () => {
            active.delete(event);
          };
        },
      }),
    /registration failed/,
  );
  assert.equal(active.size, 0);
  let attached = false;
  assert.throws(
    () =>
      createT15SourceSignals({
        ...base,
        on(event) {
          active.add(event);
          return () => {
            active.delete(event);
          };
        },
        database: {
          registerTableUpdateCallback() {
            attached = true;
            throw new Error('database registration failed');
          },
          unregisterTableUpdateCallback() {
            attached = false;
          },
        },
      }),
    /database registration failed/,
  );
  assert.equal(active.size, 0);
  assert.equal(attached, false);
});
test('compatible worldbook preserves full unmanaged entries/header, stable keys and no strict capture claim', async () => {
  const f = await wiringFixture();
  try {
    const initial = f.rawBook(),
      g = (await buildT12Projection(await f.gateway.read(f.scope), f.bookBinding)).generation,
      book = await f.book.driver.read('主书');
    assert.equal(canWriteT12(f.book.driver.capabilities), false);
    assert.equal(canSynchronizeT12Compatibility(f.book.driver), true);
    await f.book.driver.synchronize({
      generation: g,
      expectedBookFingerprint: await fingerprintT4(book),
      operation: 'sync',
      authorize: async () => {},
      assertCurrent: () => {},
    });
    const after = f.rawBook();
    assert.deepEqual(
      (after.entries as Record<string, unknown>)['9'],
      (initial.entries as Record<string, unknown>)['9'],
    );
    assert.deepEqual(after.customHeader, initial.customHeader);
    assert.equal(f.bookSaves(), 1);
    assert.equal(await confirmedT12Book(g, await f.book.driver.read('主书')), true);
    await assert.rejects(
      f.book.driver.capture({ generation: g, authorize: async () => {}, assertCurrent: () => {} }, async () => 0),
      /ISOLATION/,
    );
    const next = await f.book.driver.read('主书');
    await f.book.driver.synchronize({
      generation: g,
      expectedBookFingerprint: await fingerprintT4(next),
      operation: 'repair',
      authorize: async () => {},
      assertCurrent: () => {},
    });
    assert.deepEqual(f.rawBook(), after);
  } finally {
    f.close();
  }
});
test('worldbook raw conflicts, source revocation and target changes send no write', async () => {
  const f = await wiringFixture();
  try {
    const g = (await buildT12Projection(await f.gateway.read(f.scope), f.bookBinding)).generation,
      book = await f.book.driver.read('主书');
    f.mutateBook(v => {
      v.customHeader = { new: 'other editor' };
    });
    await assert.rejects(
      f.book.driver.synchronize({
        generation: g,
        expectedBookFingerprint: await fingerprintT4(book),
        operation: 'sync',
        authorize: async () => {},
        assertCurrent: () => {},
      }),
      /CONFLICT/,
    );
    assert.equal(f.bookSaves(), 0);
    f.bookEpoch();
    await assert.rejects(f.book.driver.read('主书'), /STALE/);
  } finally {
    f.close();
  }
});
test('unknown book receipt is queryable but cannot be retried, including through the compatible controller', async () => {
  const f = await wiringFixture();
  let raw = f.rawBook(),
    writes = 0;
  const book = createT15WorldbookCompatibility({
    current: () => f.bookBinding,
    epoch: () => 0,
    writable: () => true,
    subscribe: () => () => {},
    readRaw: async () => copyT10(raw),
    saveRaw: async (_name, value) => {
      raw = copyT10(value);
      writes++;
      throw new Error('unknown');
    },
  });
  const service = await createT4CommitService({ scope: f.scope, store: f.gateway, execute: executeT8Test });
  const { inspectT10CompatibilityHost } = await import('./t10-recovery');
  const options = {
    scope: f.scope,
    service,
    store: f.gateway,
    driver: book.driver,
    readRecovery: () => inspectT10CompatibilityHost(f.host.driver),
  };
  const strict = createT12Controller(options),
    controller = createT12CompatibilityController(options);
  try {
    assert.equal((await strict.inspect()).canSync, false);
    assert.equal((await controller.inspect()).canSync, true);
    assert.equal((await controller.sync(true)).status, 'pending');
    assert.equal(writes, 1);
    const confirmed = await controller.query();
    assert.equal(confirmed.status, 'synced');
    assert.equal(confirmed.canSync, false);
    await controller.retry(true);
    assert.equal(writes, 1);
  } finally {
    strict.close();
    controller.close();
    service.close();
    book.close();
    f.close();
  }
});
test('host nine-page composition has zero automatic API/book writes; real API consent remains separate', async () => {
  const f = await wiringFixture();
  let sends = 0,
    config = copyT10(f.model.api);
  const session = await createT15HostWorkspace({
    driver: f.host.driver,
    scope: f.scope,
    execute: executeT8Test,
    prerequisites: f.gate,
    bookDriver: f.book.driver,
    api: { read: () => config, save: next => (config = copyT10(next)) },
    transport: createT15ApiTransport({
      authorize: () => {},
      fetchImpl: async () => {
        sends++;
        return new Response('{}');
      },
    }),
  });
  try {
    assert.equal(sends, 0);
    assert.equal(f.bookSaves(), 0);
    assert.equal(session.realApiEnabled(), false);
    await f.complete();
    await session.refresh();
    assert.equal(sends, 0);
    await session.generation.freeze();
    assert.equal(session.generation.view().error, null);
    assert.ok(await session.backup.backup('world', true), JSON.stringify(session.backup.view()));
    session.authorizeRealApi(true);
    assert.equal(session.realApiEnabled(), true);
    session.apiPort.save(config);
    assert.equal(session.realApiEnabled(), false);
    assert.equal(sends, 0);
  } finally {
    session.close();
    session.close();
    f.close();
  }
});

test('source update during a pending macro request cancels the round, with no micro request or commit', async () => {
  const f = await wiringFixture(),
    entered = deferredT8Test<void>(),
    response = deferredT8Test<Response>();
  let sends = 0;
  const session = await createT15HostWorkspace({
    driver: f.host.driver,
    scope: f.scope,
    execute: executeT8Test,
    prerequisites: f.gate,
    bookDriver: f.book.driver,
    api: { read: () => f.model.api, save: next => next },
    transport: createT15ApiTransport({
      authorize: () => {},
      fetchImpl: async () => {
        sends++;
        entered.resolve();
        return response.promise;
      },
    }),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await f.complete();
    await session.refresh();
    session.authorizeRealApi(true);
    const handle = await session.round.start('source-cancellation');
    await Promise.race([
      entered.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('fake request did not start')), 10000);
      }),
    ]);
    f.gate.hint('database', '资料再次更新，原本完成证据撤销');
    response.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"sql":"","parameters":[]}' } }] })),
    );
    await handle.done;
    assert.equal(sends, 1);
    assert.equal(f.gate.ready(), false);
    assert.notEqual(session.round.view().status, 'saved');
    assert.equal((await f.gateway.read(f.scope)).commits.length, 0);
    assert.equal(f.bookSaves(), 0);
  } finally {
    if (timer) clearTimeout(timer);
    response.resolve(new Response('{}'));
    session.close();
    f.close();
  }
});

test('worldbook timeout does not claim rollback and a late persisted save is queryable without retry', async () => {
  const f = await wiringFixture(),
    release = deferredT8Test<void>(),
    settled = deferredT8Test<void>();
  let raw = f.rawBook(),
    writes = 0;
  const book = createT15WorldbookCompatibility({
    current: () => f.bookBinding,
    epoch: () => 0,
    writable: () => true,
    subscribe: () => () => {},
    writeTimeoutMs: 10,
    readRaw: async () => copyT10(raw),
    saveRaw: async (_name, next) => {
      writes++;
      await release.promise;
      raw = copyT10(next);
      settled.resolve();
    },
  });
  try {
    const g = (await buildT12Projection(await f.gateway.read(f.scope), f.bookBinding)).generation,
      before = await book.driver.read('主书'),
      request = {
        generation: g,
        expectedBookFingerprint: await fingerprintT4(before),
        operation: 'sync' as const,
        authorize: async () => {},
        assertCurrent: () => {},
      };
    await assert.rejects(book.driver.synchronize(request), /PENDING/);
    assert.equal(writes, 1);
    assert.equal(book.status().uncertain, true);
    assert.equal(canSynchronizeT12Compatibility(book.driver), false);
    release.resolve();
    await settled.promise;
    assert.equal(await confirmedT12Book(g, await book.driver.read('主书')), true);
    await assert.rejects(book.driver.synchronize(request), /PERMISSION/);
    assert.equal(writes, 1);
  } finally {
    release.resolve();
    book.close();
    f.close();
  }
});
test('completion -> macro -> micro -> single chat commit -> existing worldbook controller uses one authority', async () => {
  const f = await wiringFixture();
  let sends = 0;
  const session = await createT15HostWorkspace({
    driver: f.host.driver,
    scope: f.scope,
    execute: executeT8Test,
    prerequisites: f.gate,
    bookDriver: f.book.driver,
    api: { read: () => f.model.api, save: next => next },
    transport: createT15ApiTransport({
      authorize: () => {},
      fetchImpl: async () => {
        sends++;
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
  try {
    await f.complete();
    await session.refresh();
    session.authorizeRealApi(true);
    await (
      await session.round.start('real-shape-fake-api-round')
    ).done;
    assert.equal(session.round.view().status, 'saved', JSON.stringify(session.round.view().error));
    assert.equal(sends, 2);
    assert.equal((await f.gateway.read(f.scope)).commits.length, 1);
    const view = await session.projection.inspect();
    assert.equal(view.canSync, true, view.error ?? 'projection');
    const sync = await session.projection.sync(true);
    assert.equal(sync.status, 'synced', sync.error ?? 'sync');
    assert.equal(f.bookSaves(), 1);
    assert.equal(sends, 2);
    await (
      await session.round.start('duplicate-another-entry')
    ).done;
    assert.equal(sends, 2);
    const doc = await f.read();
    assert.deepEqual(doc.messages.at(-1)!.swipes_data[0].stat_data, { weather: '雨' });
    assert.deepEqual((doc.messages.at(-1)!.TavernDB_ACU_IsolatedData as Record<string, unknown>).slot, {
      result: '本轮结果',
    });
  } finally {
    session.close();
    f.close();
  }
});
test('exact own worldbook save notification does not revoke, but other/same-name modified payload does', async () => {
  const f = await wiringFixture();
  try {
    const raw = f.rawBook();
    await f.host.saveOwnedWorldbook('主书', raw, async () => {
      f.emit('WORLDINFO_UPDATED', '主书', copyT12(raw));
    });
    assert.equal(f.host.status().state, 'ready');
    await f.host.saveOwnedWorldbook('主书', raw, async () => {
      f.emit('WORLDINFO_UPDATED', '主书', { ...raw, external: true });
    });
    assert.equal(f.host.status().state, 'invalidated');
  } finally {
    f.close();
  }
});
