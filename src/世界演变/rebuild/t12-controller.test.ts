import assert from 'node:assert/strict';
import test from 'node:test';
import { setupT12Test as setup, otherT12Entries } from './t12-test-fixtures';
import { createT12Controller } from './t12-controller';
import { createT11Controller } from './t11-controller';
import { setupT11HostTest } from './t11-test-fixtures';
import { createT12SimulatedBook } from './t12-simulated-book';
import { T12Error, copyT12 } from './t12-projection';
import { ownerT12, createT12ReadOnlyDriver } from './t12-gateway';
import { createCustomT2Fixture } from './t2-defaults';
import type { T4Archive } from './t4-protocol';
import { T10_NAMESPACE as T10_NS } from './t10-host-protocol';
import { createT4CommitService } from './t4-service';
import { createT4SandboxStore } from './t4-store';
import { executeT8Test, deferredT8Test as deferred } from './t8-test-fixtures';
import { createT3LocalPolicy } from './t3-engine';
import { untilT9Test as until } from './t9-test-fixtures';
const code = (v: string) => (e: unknown) => e instanceof T12Error && e.code === v;
test('T12 opening/inspecting never writes worldbook/world, calls AI, or mounts old entry', async () => {
  const f = await setup();
  assert.equal(f.projection.view().status, 'unchecked');
  assert.equal((await f.projection.inspect()).status, 'pending');
  assert.equal(f.book.statistics.writes, 0);
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(f.round.view().sent, 0);
  assert.equal(f.projection.view().canSync, true);
  f.close();
});
test('T12 synchronization requires explicit scope confirmation and preserves user/TavernDB/MVU/legacy', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(false);
  assert.equal(f.book.statistics.writes, 0);
  assert.equal((await f.projection.sync(true)).status, 'synced');
  const book = await f.book.driver.read(f.binding.primaryBook);
  assert.deepEqual(
    book.entries.filter(e => !ownerT12(e)),
    otherT12Entries,
  );
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(f.round.view().sent, 0);
  const raw = JSON.stringify(book);
  await f.projection.sync(true);
  assert.equal(f.book.statistics.writes, 1);
  assert.equal(JSON.stringify(await f.book.driver.read(f.binding.primaryBook)), raw);
  f.close();
});
test('T12 manual draft never becomes projection data; saved head invalidates old task', async () => {
  const f = await setup();
  await f.manual('尚未保存草稿-不可导出');
  await f.projection.inspect();
  assert.doesNotMatch(JSON.stringify(f.projection.view()), /尚未保存草稿-不可导出/);
  await f.projection.sync(true);
  assert.doesNotMatch(JSON.stringify(f.book.exportBooks()), /尚未保存草稿-不可导出/);
  await f.service.save();
  assert.equal(f.projection.view().status, 'stale');
  const writes = f.book.statistics.writes;
  await f.projection.retry(true);
  assert.equal(f.book.statistics.writes, writes);
  await f.projection.inspect();
  await f.projection.sync(true);
  assert.match(JSON.stringify(f.book.exportBooks()), /尚未保存草稿-不可导出/);
  assert.equal(f.store.statistics.writes, 1);
  f.close();
});
test('T12 save uncertainty blocks new projection rather than exporting a private pending result', async () => {
  const f = await setup();
  await f.manual('保存回执不明');
  f.store.queueWriteFault('ack-lost');
  await assert.rejects(f.service.save());
  assert.equal(f.service.view().status, 'pending');
  assert.equal((await f.projection.inspect()).status, 'blocked');
  assert.equal(f.book.statistics.writes, 0);
  f.close();
});
test('T12 failed sync keeps confirmed world and retries only projection once', async () => {
  const f = await setup();
  await f.manual('已保存');
  await f.service.save();
  const head = f.service.headToken();
  await f.projection.inspect();
  f.book.queueFault('write-failed');
  assert.equal((await f.projection.sync(true)).status, 'failed');
  assert.deepEqual(f.service.headToken(), head);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal((await f.projection.retry(true)).status, 'synced');
  assert.equal(f.book.statistics.writes, 1);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.round.view().sent, 0);
  f.close();
});
test('T12 ack loss remains pending until independent query; retry does not repeat confirmed write', async () => {
  const f = await setup();
  await f.projection.inspect();
  f.book.queueFault('ack-lost');
  assert.equal((await f.projection.sync(true)).status, 'pending');
  assert.equal(f.book.statistics.writes, 1);
  assert.equal((await f.projection.retry(true)).status, 'synced');
  assert.equal(f.book.statistics.writes, 1);
  f.close();
});
test('T12 partial failure blocks main AI from mixed generations; retry repairs stable UID without AI', async () => {
  const f = await setup();
  await f.projection.inspect();
  f.book.queueFault('partial');
  assert.equal((await f.projection.sync(true)).status, 'pending');
  let called = 0;
  await assert.rejects(
    f.projection.capture(async () => {
      called++;
      return true;
    }),
    code('PENDING'),
  );
  assert.equal(called, 0);
  const partial = await f.book.driver.read(f.binding.primaryBook),
    uid = partial.entries.find(e => ownerT12(e))!.uid;
  assert.equal(partial.blocked, true);
  assert.ok(partial.entries.filter(e => ownerT12(e)).every(e => e.enabled === false));
  assert.equal((await f.projection.retry(true)).status, 'synced');
  const final = await f.book.driver.read(f.binding.primaryBook);
  assert.ok(final.entries.some(e => e.uid === uid && e.enabled === true));
  assert.equal(await f.projection.capture(async entries => entries.filter(e => ownerT12(e)).length), 2);
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T12 independent read failure never uses cached synced status', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  f.book.queueReadFailure();
  assert.equal((await f.projection.query()).status, 'failed');
  assert.notEqual(f.projection.summary().status, 'synced');
  assert.equal((await f.projection.query()).status, 'synced');
  f.close();
});
test('T12 content/strategy drift is detected and repaired in place; current orphans and duplicates cleaned', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  const initial = (await f.book.driver.read(f.binding.primaryBook)).entries.filter(e => ownerT12(e));
  f.book.mutate(f.binding.primaryBook, book => {
    const e = book.entries.find(e => ownerT12(e))!;
    e.content = '手工漂移';
    e.strategy = { type: 'constant', keys: [] };
    const duplicate = copyT12(e);
    duplicate.uid = 100;
    book.entries.push(duplicate);
    return book;
  });
  const v = await f.projection.inspect();
  assert.equal(v.counts.update, 1);
  assert.equal(v.counts.delete, 1);
  await f.projection.sync(true, 'repair');
  const final = (await f.book.driver.read(f.binding.primaryBook)).entries.filter(e => ownerT12(e));
  assert.deepEqual(
    final.map(e => e.uid),
    initial.map(e => e.uid),
  );
  assert.equal(f.projection.view().status, 'synced');
  f.close();
});
test('T12 export removal deletes only owned current entries, not other plugin records', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  const state = f.service.view().formal;
  state.template.templateVersion++;
  state.template.tables.find(t => t.id === 'npc')!.export.enabled = false;
  state.data.templateVersion = state.template.templateVersion;
  await f.service.prepareMigration({ ...f.spec(), state });
  await f.service.save();
  assert.equal((await f.projection.inspect()).counts.delete, 1);
  await f.projection.sync(true);
  assert.deepEqual(
    (await f.book.driver.read(f.binding.primaryBook)).entries.filter(e => !ownerT12(e)),
    otherT12Entries,
  );
  f.close();
});
test('T12 same world re-render after rename updates stable UID rather than duplicate row', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  const initial = (await f.book.driver.read(f.binding.primaryBook)).entries.find(e => ownerT12(e)?.tableId === 'npc')!;
  const s = f.service.view().formal;
  await f.service.prepareSql({
    ...f.spec(),
    kind: 'manual',
    batches: [
      {
        batchId: 'rename',
        sql: 'UPDATE we_npc SET f_name = ? WHERE __we_row_id = ?',
        parameters: ['陈望新名', 'traveler'],
        policy: createT3LocalPolicy(s.template, s.data),
      },
    ],
  });
  await f.service.save();
  await f.projection.inspect();
  await f.projection.sync(true);
  const final = (await f.book.driver.read(f.binding.primaryBook)).entries.filter(e => ownerT12(e)?.tableId === 'npc');
  assert.equal(final.length, 1);
  assert.equal(final[0].uid, initial.uid);
  assert.match(String(final[0].name), /陈望新名/);
  f.close();
});
test('T12 two chat/branch worlds share primary book but capture only active generation; old retry is stale', async () => {
  const a = await setup(),
    state = copyT12(a.state);
  state.data.branchId = 'another-branch';
  const b = await setup(state, { driver: a.book.driver });
  a.book.registerSource(
    b.scope,
    () =>
      JSON.parse(
        JSON.parse(b.store.exportStorage()).chats[0].archives[`${b.scope.worldId}/${b.scope.branchId}`],
      ) as T4Archive,
  );
  const bBinding = { ...a.binding, branchId: b.scope.branchId };
  await a.projection.inspect();
  await a.projection.sync(true);
  a.book.switchBinding(bBinding);
  await b.projection.inspect();
  const diff = b.projection.view();
  assert.equal(diff.counts.deactivate, 2);
  await b.projection.sync(true);
  const captured = await b.projection.capture(async entries =>
    entries.filter(e => ownerT12(e)).map(e => ownerT12(e)!.scope.branchId),
  );
  assert.deepEqual(captured, ['another-branch', 'another-branch']);
  const writes = a.book.statistics.writes;
  await a.projection.retry(true);
  assert.equal(a.projection.view().status, 'stale');
  assert.equal(a.book.statistics.writes, writes);
  const all = (await a.book.driver.read(a.binding.primaryBook)).entries.filter(e => ownerT12(e));
  assert.equal(all.length, 4);
  assert.ok(all.filter(e => ownerT12(e)!.scope.branchId === a.scope.branchId).every(e => e.enabled === false));
  a.close();
  b.close();
});
test('T12 no primary, target book change, world switch and permission revocation block old writes', async () => {
  for (const mode of ['primary', 'target', 'world', 'permission'] as const) {
    let allowed = true;
    const f = await setup(undefined, { canUse: () => allowed });
    await f.projection.inspect();
    if (mode === 'permission') allowed = false;
    else
      f.book.switchBinding({
        ...f.binding,
        ...(mode === 'primary'
          ? { primaryBook: null }
          : mode === 'target'
            ? { primaryBook: '新的主书' }
            : { worldId: 'new-world' }),
      });
    await f.projection.retry(true);
    assert.equal(f.book.statistics.writes, 0);
    assert.notEqual(f.projection.view().status, 'synced');
    f.close();
  }
});
test('T12 unknown active legacy/name collision is preserved and isolation blocked, never adopted/deleted', async () => {
  const f = await setup();
  f.book.mutate(f.binding.primaryBook, b => {
    b.entries.find(e => e.uid === 43)!.enabled = true;
    return b;
  });
  assert.equal((await f.projection.inspect()).status, 'blocked');
  await f.projection.sync(true);
  assert.equal(f.book.statistics.writes, 0);
  assert.equal((await f.book.driver.read(f.binding.primaryBook)).entries.find(e => e.uid === 43)!.enabled, true);
  f.close();
});
test('T12 missing verified source/capture/CAS capabilities fail closed, including explicit capture call', async () => {
  for (const caps of [
    { environment: 'unverified-host' as const, scope: 'none' as const },
    { durableRead: false },
    { guardedWrites: false },
    { guardedCapture: false },
    { sourceFence: false },
  ]) {
    const f = await setup(undefined, {}, caps);
    assert.equal((await f.projection.inspect()).status, 'blocked');
    await f.projection.sync(true);
    await assert.rejects(
      f.projection.capture(async () => true),
      code('ISOLATION'),
    );
    assert.equal(f.book.statistics.writes, 0);
    f.close();
  }
});
test('T12 concurrent prepared controllers CAS book fingerprint: stale contender cannot clobber changes', async () => {
  const f = await setup();
  const second = createT12Controller(f.projectionOptions);
  await Promise.all([f.projection.inspect(), second.inspect()]);
  const results = await Promise.all([f.projection.sync(true), second.sync(true)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['pending', 'synced']);
  assert.equal(f.book.statistics.writes, 1);
  assert.equal((await second.query()).status, 'synced');
  second.close();
  f.close();
});
test('T12 capture lock covers entire consumer; activation queued during capture waits for its release', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  const gate = deferred<void>(),
    started = deferred<void>();
  let syncDone = false;
  const capture = f.projection.capture(async entries => {
    started.resolve();
    await gate.promise;
    return entries.filter(e => ownerT12(e)).length;
  });
  await started.promise;
  const synced = f.projection.sync(true).then(() => {
    syncDone = true;
  });
  await until(() => f.projection.view().busy);
  assert.equal(syncDone, false);
  gate.resolve();
  assert.equal(await capture, 2);
  await synced;
  assert.equal(syncDone, true);
  f.close();
});
test('T12 branch switch during context capture discards capture result and cannot activate old source', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  const gate = deferred<void>(),
    entered = deferred<void>();
  const pending = f.projection.capture(async () => {
    entered.resolve();
    await gate.promise;
    return '不得交给发送器';
  });
  await entered.promise;
  f.book.switchBinding({ ...f.binding, branchId: 'switched' });
  gate.resolve();
  await assert.rejects(pending, code('STALE'));
  assert.equal(f.book.statistics.writes, 1);
  f.close();
});
test('T12 fresh formal commit before main AI capture rejects old activated generation', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  await f.manual('最新事实');
  await f.service.save();
  let captured = false;
  await assert.rejects(
    f.projection.capture(async () => {
      captured = true;
      return true;
    }),
    code('PENDING'),
  );
  assert.equal(captured, false);
  f.close();
});
test('T12 external source/store head conflict blocks projection even when local cached service looks valid', async () => {
  const f = await setup();
  const broken = createT12Controller({
    ...f.projectionOptions,
    store: {
      ...f.store,
      read: async () => {
        throw new Error('private provider payload');
      },
    },
  });
  const v = await broken.inspect();
  assert.equal(v.status, 'blocked');
  assert.doesNotMatch(JSON.stringify(v), /private provider payload/);
  assert.equal(f.book.statistics.writes, 0);
  broken.close();
  f.close();
});
test('T12 known API vault key never exports even when copied into public data', async () => {
  const f = await setup(undefined, { readSecrets: () => ['private-api-key'] });
  await f.manual('private-api-key');
  await f.service.save();
  assert.equal((await f.projection.inspect()).status, 'blocked');
  assert.doesNotMatch(JSON.stringify(f.projection.view()), /private-api-key/);
  assert.equal(f.book.statistics.writes, 0);
  f.close();
});
test('T12 unmount/close cancellation revokes queued write and does not close shared T4/T9 service', async () => {
  const f = await setup();
  await f.projection.inspect();
  f.projection.close();
  await f.projection.sync(true);
  assert.equal(f.book.statistics.writes, 0);
  await f.manual('仍可正常保存');
  await f.service.save();
  assert.equal(f.store.statistics.writes, 1);
  f.close();
});
test('T12 nondefault market SQL -> confirmed save -> row export -> index migration -> recovery export', async () => {
  const f = await setup(createCustomT2Fixture());
  const initial = f.service.view().formal;
  await f.service.prepareSql({
    ...f.spec(),
    kind: 'manual',
    batches: [
      {
        batchId: 'market-change',
        sql: 'UPDATE we_market SET f_summary = ? WHERE __we_row_id = ?',
        parameters: ['新的市场供需条件', 'harbor-market'],
        policy: createT3LocalPolicy(initial.template, initial.data),
      },
    ],
  });
  await f.service.save();
  const commitId = f.service.headToken().commitId;
  await f.projection.inspect();
  await f.projection.sync(true);
  assert.match(JSON.stringify(f.book.exportBooks()), /新的市场供需条件/);
  const after = f.service.view().formal;
  after.template.templateVersion++;
  after.data.templateVersion = after.template.templateVersion;
  after.template.tables.find(t => t.id === 'market')!.export.mode = 'index';
  await f.service.prepareMigration({ ...f.spec(), state: after });
  await f.service.save();
  await f.projection.inspect();
  await f.projection.sync(true);
  const index = (await f.book.driver.read(f.binding.primaryBook)).entries.find(e => ownerT12(e)?.tableId === 'market')!;
  assert.equal(ownerT12(index)!.rowId, null);
  assert.doesNotMatch(String(index.content), /新的市场供需条件/);
  await f.service.prepareRestore({ ...f.spec(), sourceCommitId: commitId });
  await f.service.save();
  await f.projection.inspect();
  await f.projection.sync(true);
  const restored = (await f.book.driver.read(f.binding.primaryBook)).entries.filter(
    e => ownerT12(e)?.tableId === 'market',
  );
  assert.equal(restored.length, 1);
  assert.equal(ownerT12(restored[0])!.rowId, 'harbor-market');
  assert.match(String(restored[0].content), /新的市场供需条件/);
  assert.equal(f.round.view().sent, 0);
  f.close();
});
test('T12 verified simulated T10 host source can project, but unverified/missing recovery proof cannot', async () => {
  const f = await setupT11HostTest(),
    binding = {
      chatId: f.scope.chatId,
      worldId: f.scope.worldId,
      branchId: f.scope.branchId,
      characterId: 'test-card',
      primaryBook: 'host-test-book',
    };
  const book = createT12SimulatedBook(binding);
  book.registerSource(f.scope, () => JSON.parse(f.host.exportStorage()).variables[T10_NS].archive as T4Archive);
  const options = {
    scope: f.scope,
    service: f.session.service,
    store: f.session.gateway,
    driver: book.driver,
    readRecovery: f.session.refresh,
  };
  const c = createT12Controller(options);
  assert.equal((await c.inspect()).status, 'pending');
  assert.equal((await c.sync(true)).status, 'synced');
  const missing = createT12Controller({ ...options, readRecovery: undefined });
  assert.equal((await missing.inspect()).status, 'blocked');
  const snapshot = f.host.exportStorage();
  await c.query();
  assert.deepEqual(f.host.exportStorage(), snapshot);
  c.close();
  missing.close();
  f.controller.close();
  f.session.close();
});
test('T12 T11 overview shares independent projection status and receives projection-only notifications', async () => {
  const f = await setup(),
    daily = createT11Controller({
      ...f.t11Options,
      projection: f.projection.summary,
      subscribeProjection: f.projection.subscribe,
    });
  let notifications = 0;
  const stop = daily.subscribe(() => {
    notifications++;
  });
  await daily.refresh();
  await f.projection.inspect();
  assert.equal(daily.view().projection.status, 'pending');
  const prior = notifications;
  await f.projection.sync(true);
  assert.equal(daily.view().projection.status, 'synced');
  assert.ok(notifications > prior);
  stop();
  daily.close();
  f.close();
});
test('T12 repair/full logical rebuild reuses complete generation; no whole-book erase or repeated world save', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  const before = f.book.exportBooks();
  await f.projection.sync(true, 'rebuild');
  assert.deepEqual(f.book.exportBooks(), before);
  assert.equal(f.book.statistics.writes, 1);
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T12 capture consumer cannot mutate stored worldbook, and selective scan can use literal keywords', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  const before = f.book.exportBooks();
  const captured = await f.projection.capture(async entries => {
    const selected = entries.filter(e => {
      const s = e.strategy as { type: string; keys: string[] } | undefined;
      return s?.type === 'constant' || s?.keys.some(k => '陈望前往城门'.includes(k));
    });
    entries[0].content = 'consumer mutation';
    return selected.filter(e => ownerT12(e)).length;
  });
  assert.equal(captured, 2);
  assert.deepEqual(f.book.exportBooks(), before);
  f.close();
});
test('T12 separate chats on one card never activate each other, even with identical row names', async () => {
  const a = await setup();
  await a.projection.inspect();
  await a.projection.sync(true);
  const state = copyT12(a.state);
  state.data.worldId = 'world-other-chat';
  const scope = { ...a.scope, chatId: 'sandbox-other-chat', worldId: state.data.worldId };
  const store = createT4SandboxStore();
  await store.initialize(scope, state);
  const service = await createT4CommitService({ scope, store, execute: executeT8Test });
  a.book.registerSource(
    scope,
    () =>
      JSON.parse(
        JSON.parse(store.exportStorage()).chats[0].archives[`${scope.worldId}/${scope.branchId}`],
      ) as T4Archive,
  );
  const b = createT12Controller({ scope, service, store, driver: a.book.driver });
  a.book.switchBinding({ ...a.binding, chatId: scope.chatId, worldId: scope.worldId });
  assert.equal(a.projection.view().status, 'stale');
  await b.inspect();
  await b.sync(true);
  const scopes = await b.capture(async entries => entries.filter(e => ownerT12(e)).map(e => ownerT12(e)!.scope.chatId));
  assert.deepEqual(scopes, ['sandbox-other-chat', 'sandbox-other-chat']);
  b.close();
  service.close();
  a.close();
});
test('T12 source fence rejects a different instance commit between independent authorization and mutation', async () => {
  const f = await setup(),
    external = await createT4CommitService({ scope: f.scope, store: f.store, execute: executeT8Test });
  const state = external.view().formal;
  await external.prepareSql({
    ...f.spec(),
    kind: 'manual',
    batches: [
      {
        batchId: 'external',
        sql: 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?',
        parameters: ['另一实例正式结果', 'traveler'],
        policy: createT3LocalPolicy(state.template, state.data),
      },
    ],
  });
  let calls = 0;
  const wrapped = createT12Controller({
    ...f.projectionOptions,
    driver: {
      ...f.book.driver,
      synchronize: input =>
        f.book.driver.synchronize({
          ...input,
          authorize: async () => {
            await input.authorize();
            if (++calls === 2) await external.save();
          },
        }),
    },
  });
  await wrapped.inspect();
  assert.equal((await wrapped.sync(true)).status, 'stale');
  assert.equal(f.book.statistics.writes, 0);
  assert.equal(f.store.statistics.writes, 1);
  wrapped.close();
  external.close();
  f.close();
});
test('T12 full-book CAS recheck preserves a user edit made during source authorization', async () => {
  const f = await setup();
  let calls = 0;
  const wrapped = createT12Controller({
    ...f.projectionOptions,
    driver: {
      ...f.book.driver,
      synchronize: input =>
        f.book.driver.synchronize({
          ...input,
          authorize: async () => {
            await input.authorize();
            if (++calls === 2)
              f.book.mutate(f.binding.primaryBook, b => {
                b.entries[0].content = '授权中产生的新用户资料';
                return b;
              });
          },
        }),
    },
  });
  await wrapped.inspect();
  assert.equal((await wrapped.sync(true)).status, 'pending');
  assert.equal(f.book.statistics.writes, 0);
  assert.equal((await f.book.driver.read(f.binding.primaryBook)).entries[0].content, '授权中产生的新用户资料');
  wrapped.close();
  f.close();
});
test('T12 uncoordinated fixture book mutation during capture discards its result', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  await assert.rejects(
    f.projection.capture(async () => {
      f.book.mutate(f.binding.primaryBook, b => {
        b.entries[0].content = 'capture changed';
        return b;
      });
      return true;
    }),
    code('CONFLICT'),
  );
  assert.notEqual(f.projection.summary().status, 'synced');
  f.close();
});
test('T12 readonly adapter cannot upgrade getters into write/capture authority', async () => {
  const f = await setup();
  const readonly = createT12ReadOnlyDriver(f.book.driver);
  const c = createT12Controller({ ...f.projectionOptions, driver: readonly });
  assert.equal((await c.inspect()).status, 'blocked');
  await c.sync(true);
  await assert.rejects(
    c.capture(async () => true),
    code('ISOLATION'),
  );
  assert.equal(f.book.statistics.writes, 0);
  c.close();
  f.close();
});
test('T12 reopened fake JSON book is checked live; no automatic synchronization on service creation', async () => {
  const f = await setup();
  await f.projection.inspect();
  await f.projection.sync(true);
  const reopened = createT12SimulatedBook(f.binding, f.book.exportBooks());
  reopened.registerSource(
    f.scope,
    () =>
      JSON.parse(
        JSON.parse(f.store.exportStorage()).chats[0].archives[`${f.scope.worldId}/${f.scope.branchId}`],
      ) as T4Archive,
  );
  const c = createT12Controller({ ...f.projectionOptions, driver: reopened.driver });
  assert.equal(c.view().status, 'unchecked');
  assert.equal((await c.inspect()).status, 'synced');
  assert.equal(reopened.statistics.writes, 0);
  c.close();
  f.close();
});
test('T12 newly protected credentials redact already-open previews and invalidate prior synchronization', async () => {
  const secrets: string[] = [];
  const f = await setup(undefined, { readSecrets: () => secrets });
  await f.manual('formerly-public-token');
  await f.service.save();
  await f.projection.inspect();
  await f.projection.sync(true);
  secrets.push('formerly-public-token');
  assert.equal(f.projection.view().status, 'stale');
  assert.doesNotMatch(JSON.stringify(f.projection.view()), /formerly-public-token/);
  await assert.rejects(
    f.projection.capture(async () => true),
    code('PERMISSION'),
  );
  f.close();
});
