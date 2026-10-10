import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultT2Fixture, createMinimalT2Fixture } from './t2-defaults';
import { createT11Controller } from './t11-controller';
import { projectT11History } from './t11-history';
import { createT4CommitService } from './t4-service';
import { fingerprintT4 } from './t4-protocol';
import { T10_NAMESPACE } from './t10-host-protocol';
import { inspectT10Host } from './t10-recovery';
import { setupT11Test as setup, setupT11HostTest } from './t11-test-fixtures';
import { untilT9Test as until } from './t9-test-fixtures';
import {
  responseT8Test as response,
  deferredT8Test as deferred,
  cloneT8Test as clone,
  executeT8Test,
} from './t8-test-fixtures';
const noChange = (id: string) => response(`SELECT __we_row_id FROM we_${id}`);
const twoUpdates = async (r: { stage: string; tableId: string }) =>
  r.stage === 'macro'
    ? response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [80, 'small-valley-weather'])
    : response('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', ['等待雨势减缓', 'traveler']);

test('T11 initial view / navigation / refresh are query-only; automatic defaults off', async () => {
  let replies = 0;
  const f = await setup(undefined, {
    reply: async r => {
      replies++;
      return noChange(r.tableId);
    },
  });
  assert.equal(f.controller.view().checked, false);
  for (const page of ['history', 'automatic', 'overview'] as const) f.controller.selectPage(page);
  f.controller.setAutomatic(true);
  await f.controller.refresh();
  assert.equal(f.controller.view().canStart, true);
  assert.equal(f.controller.view().confirmed, true);
  assert.equal(f.controller.view().projection.status, 'unavailable');
  assert.equal(f.controller.view().tables.find(t => t.id === 'npc')?.pending, true);
  assert.equal(replies, 0);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 zero-row default world stays empty; preparation does not insert demo NPCs', async () => {
  const state = createDefaultT2Fixture();
  state.data.tables = Object.fromEntries(state.template.tables.map(t => [t.id, []]));
  const f = await setup(state);
  await f.controller.refresh();
  assert.equal(f.controller.view().macroRows, 0);
  assert.equal(f.controller.view().microRows, 0);
  assert.equal(f.controller.view().history.length, 0);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 missing API / endpoint and wrong input identities fail closed without generation', async () => {
  const f = await setup();
  f.api.presets = [];
  await f.controller.refresh();
  assert.equal(f.controller.view().canStart, false);
  assert.match(f.controller.view().tables.find(t => t.id === 'environment')!.route, /预设不存在/);
  assert.equal(await f.controller.start(), false);
  f.input.worldId = 'wrong-world';
  await f.controller.refresh();
  assert.equal(f.controller.view().checked, false);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 manual run uses the same T9 and T4 service and one commit; all pages agree', async () => {
  const f = await setup(undefined, { reply: twoUpdates });
  await f.controller.refresh();
  assert.equal(await f.controller.start(), true);
  for (const page of ['overview', 'automatic', 'history'] as const) {
    f.controller.selectPage(page);
    const v = f.controller.view();
    assert.equal(v.revision, f.state.data.revision + 1);
    assert.equal(v.run.status, 'saved');
    assert.equal(v.run.sent, 2);
    assert.equal(v.history.length, 1);
    assert.equal(v.history[0].macro, 1);
    assert.equal(v.history[0].micro, 1);
    assert.equal(v.runs[0].source, 'manual');
    assert.equal(v.runs[0].saved, true);
  }
  assert.equal(f.round.view().commitId, f.controller.view().commitId);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.controller.view().tables.find(t => t.id === 'environment')!.lastSuccess, 1);
  assert.equal(f.controller.view().tables.find(t => t.id === 'environment')!.nextDue, 4);
  assert.equal(f.controller.view().tables.find(t => t.id === 'npc')!.nextDue, 2);
  f.controller.close();
});
test('T11 no-change success advances processing progress, not a failure; history is still one commit', async () => {
  const f = await setup();
  await f.controller.start();
  assert.equal(f.controller.view().run.status, 'no-change');
  assert.equal(f.controller.view().run.outcome, '存档已确认');
  assert.equal(f.controller.view().tables.find(t => t.id === 'npc')!.lastSuccess, 1);
  assert.equal(f.controller.view().history[0].changes.length, 0);
  const sent = f.controller.view().run.sent;
  await f.controller.start(); // Persisted same anchor is recognized, never re-sent.
  assert.equal(f.store.statistics.writes, 1);
  assert.ok(sent > 0);
  assert.equal(f.round.view().sent, 0);
  assert.equal(f.controller.view().runs[0].sent, sent);
  f.controller.close();
});
test('T11 macro is private while micro runs; staged candidates use latest macro and one remaining cap', async () => {
  const blocked = deferred<void>();
  const f = await setup(undefined, {
    reply: async r => {
      if (r.stage === 'macro') return twoUpdates(r);
      assert.match(r.messages[1].content, /80/);
      await blocked.promise;
      return twoUpdates(r);
    },
  });
  const done = f.controller.start();
  await until(() => f.round.view().batches.some(b => b.status === 'sending'));
  const v = f.controller.view();
  assert.equal(v.revision, f.state.data.revision);
  assert.equal(v.run.outcome, '仅暂存，正式资料尚未改变');
  assert.equal(v.run.phase, '微观阶段');
  assert.equal(v.run.macroDone, 1);
  assert.equal(v.canCancel, true);
  assert.equal(v.tables.find(t => t.id === 'npc')!.pending, false);
  assert.ok(v.tables.find(t => t.id === 'npc')!.candidates.length);
  blocked.resolve();
  await done;
  assert.equal(f.controller.view().revision, f.state.data.revision + 1);
  f.controller.close();
});
test('T11 failed micro has an error table and no formal revision / frequency advance', async () => {
  const f = await setup(undefined, {
    reply: async r => (r.stage === 'macro' ? twoUpdates(r) : { status: 400, text: 'bad' }),
  });
  await f.controller.start();
  const v = f.controller.view();
  assert.equal(v.run.status, 'paused');
  assert.equal(v.run.failureCode, 'MODEL');
  assert.equal(v.run.failureTable, 'NPC');
  assert.equal(v.run.savedRevision, null);
  assert.equal(v.revision, f.state.data.revision);
  assert.equal(v.history.length, 0);
  assert.equal(v.tables.find(t => t.id === 'environment')!.lastSuccess, null);
  assert.equal(v.runs[0].saved, false);
  assert.equal(v.canResume, true);
  assert.match(v.run.outcome, /费用可能未知/);
  f.controller.close();
});
test('T11 SQL failure identifies the stage without guessing a field; does not expose provider text', async () => {
  const f = await setup(undefined, {
    reply: async r =>
      r.stage === 'macro'
        ? noChange(r.tableId)
        : response('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', [10, 'traveler']),
  });
  await f.controller.start();
  const v = f.controller.view();
  assert.equal(v.run.failureCode, 'SQL');
  assert.equal(v.canResume, false);
  assert.equal(v.revision, f.state.data.revision);
  assert.match(v.run.phase, /校验/);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 known save failure retries immutable save, not model; ACK loss only queries', async () => {
  for (const fault of ['save-failed', 'ack-lost'] as const) {
    const f = await setup(undefined, { reply: twoUpdates });
    f.store.queueWriteFault(fault);
    await f.controller.start();
    const before = f.round.view().sent;
    assert.equal(f.controller.view().revision, f.state.data.revision);
    if (fault === 'save-failed') {
      assert.equal(f.controller.view().canResume, true);
      await f.controller.resume();
    } else {
      assert.equal(f.controller.view().canQuery, true);
      assert.equal(f.controller.view().canStart, false);
      await f.controller.queryReceipt();
    }
    assert.equal(f.round.view().sent, before);
    assert.equal(f.controller.view().revision, f.state.data.revision + 1);
    assert.equal(f.store.statistics.writes, 1);
    assert.equal(f.controller.view().run.outcome, '存档已确认');
    f.controller.close();
  }
});
test('T11 cancellation stops staged results and displays unknown request outcome, not rollback promise', async () => {
  const blocked = deferred<void>();
  const f = await setup(undefined, {
    reply: async r => {
      await blocked.promise;
      return noChange(r.tableId);
    },
  });
  const done = f.controller.start();
  await until(() => f.round.view().macro.sent === 1);
  f.controller.cancel();
  await done;
  blocked.resolve();
  assert.equal(f.controller.view().run.status, 'cancelled');
  assert.equal(f.controller.view().revision, f.state.data.revision);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 automatic enabling/navigation do not send; repeated events share same trigger ownership', async () => {
  const blocked = deferred<void>();
  let calls = 0;
  const f = await setup(undefined, {
    reply: async r => {
      calls++;
      await blocked.promise;
      return noChange(r.tableId);
    },
  });
  assert.equal(await f.controller.trigger('assistant-completed'), false);
  f.controller.setAutomatic(true);
  await f.controller.refresh();
  assert.equal(calls, 0);
  const first = f.controller.trigger('assistant-completed');
  await until(() => calls === 1);
  assert.equal(await f.controller.trigger('prerequisite-changed'), false);
  assert.equal(await f.controller.start(), false);
  blocked.resolve();
  await first;
  await f.controller.trigger('prerequisite-changed');
  assert.equal(calls, 2);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.controller.view().runs[0].source, 'automatic');
  f.controller.close();
});
test('T11 disabling automatic cancels its own queued/running task, but not a manual task', async () => {
  for (const automatic of [true, false]) {
    const gate = deferred<void>();
    const f = await setup(undefined, {
      reply: async r => {
        await gate.promise;
        return noChange(r.tableId);
      },
    });
    f.controller.setAutomatic(true);
    const done = automatic ? f.controller.trigger('assistant-completed') : f.controller.start();
    await until(() => f.round.view().macro.sent > 0);
    f.controller.setAutomatic(false);
    if (!automatic) assert.notEqual(f.round.view().status, 'cancelled');
    gate.resolve();
    await done;
    assert.equal(f.store.statistics.writes, automatic ? 0 : 1);
    f.controller.close();
  }
});
test('T11 prerequisite waiting uses T8 polling; matching persisted completion starts once, not a second scheduler', async () => {
  const f = await setup(undefined, { prerequisiteTimeoutMs: 2000 });
  const identity = { ...f.input.anchor, worldId: f.input.worldId, branchId: f.input.branchId };
  f.input.proofs = [
    {
      sourceId: 'database',
      required: true,
      state: 'waiting',
      identity,
      sourceCommitId: null,
      resultFingerprint: null,
      persisted: false,
      requirePersisted: true,
      reason: '等待',
    },
  ];
  f.controller.setAutomatic(true);
  const done = f.controller.trigger('assistant-completed');
  await until(() => f.round.view().macro.status === 'waiting');
  assert.equal(f.controller.view().run.phase, '等待前置完成');
  assert.equal(f.round.view().sent, 0);
  const proof = f.input.proofs[0];
  proof.state = 'success';
  proof.sourceCommitId = 'database-c1';
  proof.resultFingerprint = await fingerprintT4([]);
  proof.persisted = true;
  await f.controller.trigger('prerequisite-changed');
  await done;
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.round.view().sent, 2);
  f.controller.close();
});
test('T11 prerequisite failure or mismatching prior swipe never generates or advances', async () => {
  for (const state of ['failure', 'success'] as const) {
    const f = await setup();
    f.input.proofs = [
      {
        sourceId: 'database',
        required: true,
        state,
        identity: { ...f.input.anchor, swipeId: 'old-swipe', worldId: f.input.worldId, branchId: f.input.branchId },
        sourceCommitId: 'old-c1',
        resultFingerprint: await fingerprintT4([]),
        persisted: true,
        requirePersisted: true,
        reason: 'old',
      },
    ];
    assert.equal(await f.controller.start(), false);
    assert.equal(f.round.view().sent, 0);
    assert.equal(f.store.statistics.writes, 0);
    f.controller.close();
  }
});
test('T11 template/API change invalidates cached preflight and preparation remains zero-cost', async () => {
  const f = await setup();
  await f.controller.refresh();
  assert.equal(f.controller.view().checked, true);
  f.api.presets[0].model = 'other-model';
  assert.equal(f.controller.view().checked, false);
  assert.equal(f.controller.view().canStart, false);
  await f.controller.refresh();
  assert.equal(f.controller.view().checked, true);
  f.input.anchor.swipeId = 'another-swipe';
  assert.equal(f.controller.view().checked, false);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 external dirty editor and prepared manual drafts block start without discarding edits', async () => {
  let dirty = true;
  const f = await setup(undefined, { canFreeze: () => !dirty });
  await f.controller.refresh();
  assert.equal(f.controller.view().canStart, false);
  assert.equal(await f.controller.start(), false);
  dirty = false;
  await f.manual();
  const prepared = f.service.view().draft;
  f.controller.selectPage('history');
  f.controller.selectHistory('genesis');
  await f.controller.refresh();
  assert.equal(await f.controller.start(), false);
  assert.deepEqual(f.service.view().draft, prepared);
  assert.equal(f.controller.previewRestore(), false);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11/T9 cannot race a manual SQL preparation before its draft exists; T4 notifies busy transitions', async () => {
  const gate = deferred<void>();
  const f = await setup(undefined, {
    execute: async req => {
      await gate.promise;
      return executeT8Test(req);
    },
  });
  await f.controller.refresh();
  let events = 0;
  const off = f.controller.subscribe(() => events++);
  const prepared = f.manual();
  assert.equal(f.service.view().busy, true);
  assert.equal(f.controller.view().canStart, false);
  await assert.rejects(f.round.start('no-racing-manual'));
  gate.resolve();
  await prepared;
  assert.ok(events > 0);
  assert.equal(f.store.statistics.writes, 0);
  off();
  f.controller.close();
});
test('T11 subscribed display adopts a manual commit across pages without a second write', async () => {
  const f = await setup();
  await f.controller.refresh();
  let last = 0;
  const off = f.controller.subscribe(() => {
    last = f.controller.view().revision;
  });
  await f.manual();
  await f.service.save();
  await until(() => f.controller.view().history.length === 1);
  assert.equal(last, f.state.data.revision + 1);
  assert.equal(f.controller.view().history[0].kind, 'manual');
  assert.equal(f.controller.view().run.status, 'idle');
  assert.equal(f.store.statistics.writes, 1);
  off();
  f.controller.close();
});
test('T11 history / checkpoint / SQL and impact inspection have zero writes, SQL or model execution', async () => {
  let executes = 0,
    replies = 0;
  const f = await setup(undefined, {
    execute: async req => {
      executes++;
      return executeT8Test(req);
    },
    reply: async r => {
      replies++;
      return twoUpdates(r);
    },
  });
  await f.controller.start();
  const counts = [executes, replies, f.store.statistics.writes];
  f.controller.selectPage('history');
  assert.equal(f.controller.selectHistory(f.controller.view().history[0].id), true);
  assert.ok(f.controller.view().checkpoint?.valid);
  assert.match(f.controller.view().history[0].sql[0].sql!, /UPDATE/);
  assert.deepEqual(f.controller.view().history[0].sql[0].parameters, [80, 'small-valley-weather']);
  f.controller.selectHistory('genesis');
  assert.equal(f.controller.view().impact!.commits, 1);
  assert.equal(f.controller.previewRestore(), true);
  await f.controller.refresh();
  assert.deepEqual([executes, replies, f.store.statistics.writes], counts);
  f.controller.close();
});
test('T11 hidden fields, rows, references and revoked current permission mask old fixed SQL / values', async () => {
  const f = await setup();
  await f.manual('SECRET-GOALS');
  await f.service.save();
  await f.controller.refresh();
  const archive = await f.store.read(f.scope),
    current = clone(f.service.view().formal);
  current.template.tables.find(t => t.id === 'npc')!.fields.find(f => f.id === 'goals')!.hiddenUi = true;
  let publicHistory = projectT11History(archive, current);
  assert.doesNotMatch(JSON.stringify(publicHistory), /SECRET-GOALS/);
  assert.equal(publicHistory[0].sql[0].sql, null);
  current.data.tables.npc[0].meta.visibility.user = false;
  publicHistory = projectT11History(archive, current);
  assert.doesNotMatch(JSON.stringify(publicHistory), /SECRET-GOALS|traveler/);
  f.controller.close();
});
test('T11 API key never reaches logs / diffs / checkpoint even if it was manually entered into data', async () => {
  const f = await setup();
  const secret = f.api.presets[0].apiKey;
  await f.manual(secret);
  await f.service.save();
  await f.controller.refresh();
  f.controller.selectHistory(f.service.headToken().commitId!);
  assert.doesNotMatch(JSON.stringify(f.controller.view()), new RegExp(secret));
  assert.equal(f.controller.view().checked, false);
  assert.equal(f.controller.view().history[0].sql[0].sql, null);
  f.controller.close();
});
test('T11 failed authority read does not promote cache to confirmed; recovery check is readonly', async () => {
  const f = await setup();
  await f.controller.start();
  f.store.queueReadFailure();
  await f.controller.refresh();
  assert.equal(f.controller.view().confirmed, false);
  assert.equal(f.controller.view().canStart, false);
  assert.equal(f.controller.view().history.length, 0);
  assert.equal(f.store.statistics.writes, 1);
  f.controller.close();
});
test('T11 restore requires consent, previews whole-checkpoint impact, then appends once with no AI', async () => {
  let calls = 0;
  const f = await setup(undefined, {
    reply: async r => {
      calls++;
      return twoUpdates(r);
    },
  });
  await f.controller.start();
  f.controller.selectHistory('genesis');
  assert.equal(f.controller.previewRestore(), true);
  assert.equal(f.controller.view().impact!.commits, 1);
  assert.equal(f.controller.view().restore!.canConfirm, true);
  assert.equal(await f.controller.confirmRestore(false), false);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(await f.controller.confirmRestore(true), true);
  assert.equal(calls, 2);
  const v = f.controller.view();
  assert.equal(v.revision, f.state.data.revision + 2);
  assert.equal(v.history.length, 2);
  assert.equal(v.history[0].kind, 'restore');
  assert.equal(f.service.view().evolution, null);
  assert.equal(f.service.view().formal.data.tables.environment[0].values.risk, 30);
  assert.equal(f.store.statistics.writes, 2);
  f.controller.close();
});
test('T11 stale input or manual commit expires restore preview; no historical overwrite', async () => {
  for (const change of ['input', 'manual']) {
    const f = await setup(undefined, { reply: twoUpdates });
    await f.controller.start();
    f.controller.selectHistory('genesis');
    f.controller.previewRestore();
    if (change === 'input') f.input.story[0].text = '新的剧情';
    else {
      await f.manual('后来人工编辑');
      await f.service.save();
    }
    const writes = f.store.statistics.writes;
    assert.equal(f.controller.view().restore!.canConfirm, false);
    assert.equal(await f.controller.confirmRestore(true), false);
    assert.equal(f.store.statistics.writes, writes);
    f.controller.close();
  }
});
test('T11 restore save failure retries same payload; ACK loss queries without another commit', async () => {
  for (const fault of ['save-failed', 'ack-lost'] as const) {
    const f = await setup(undefined, { reply: twoUpdates });
    await f.controller.start();
    f.controller.selectHistory('genesis');
    f.controller.previewRestore();
    f.store.queueWriteFault(fault);
    assert.equal(await f.controller.confirmRestore(true), false);
    const pendingId = f.service.view().draft!.commit!.commitId;
    if (fault === 'save-failed') {
      assert.equal(f.controller.view().restore!.canConfirm, true);
      assert.equal(await f.controller.confirmRestore(true), true);
      assert.equal(f.service.headToken().commitId, pendingId);
    } else {
      assert.equal(f.controller.view().canQuery, true);
      assert.equal(await f.controller.confirmRestore(true), false);
      await f.controller.queryReceipt();
    }
    assert.equal(f.store.statistics.writes, 2);
    assert.equal(f.service.headToken().seq, 2);
    assert.equal(f.round.view().sent, 2);
    f.controller.close();
  }
});
test('T11 async restore anchor capture does not discard a concurrently opened manual draft', async () => {
  const gate = deferred<void>();
  const f = await setup();
  await f.controller.start();
  const controller = createT11Controller({
    ...f.t11Options,
    restoreSpec: async () => {
      await gate.promise;
      return f.spec();
    },
  });
  await controller.refresh();
  controller.selectHistory('genesis');
  controller.previewRestore();
  const restored = controller.confirmRestore(true);
  await f.manual('保留草稿');
  const draft = f.service.view().draft;
  gate.resolve();
  assert.equal(await restored, false);
  assert.deepEqual(f.service.view().draft, draft);
  assert.equal(f.store.statistics.writes, 1);
  controller.close();
  f.controller.close();
});
test('T11 concurrent instance commit causes restore CAS conflict, never hides the new authority', async () => {
  const f = await setup(undefined, { reply: twoUpdates });
  await f.controller.start();
  f.controller.selectHistory('genesis');
  f.controller.previewRestore();
  const other = await createT4CommitService({ scope: f.scope, store: f.store, execute: executeT8Test });
  await other.prepareRestore({ ...f.spec(), sourceCommitId: null });
  await other.save();
  assert.equal(await f.controller.confirmRestore(true), false);
  assert.equal(f.store.statistics.writes, 2);
  assert.equal((await f.store.read(f.scope)).commits.length, 2);
  f.controller.close();
  other.close();
});
test('T11 navigation callback has no state/AI side effects; absent restore capture allows preview only', async () => {
  const destinations: string[] = [];
  const f = await setup(
    undefined,
    {},
    {
      restoreSpec: undefined,
      navigate: destination => {
        destinations.push(destination);
      },
    },
  );
  await f.controller.refresh();
  f.controller.navigate('api');
  f.controller.navigate('world');
  f.controller.selectHistory('genesis');
  assert.equal(f.controller.previewRestore(), true);
  assert.equal(f.controller.view().restore!.canConfirm, false);
  assert.equal(await f.controller.confirmRestore(true), false);
  assert.deepEqual(destinations, ['api', 'world']);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 simulated host source is explicit; fresh reconstruction sees persisted run without auto requests', async () => {
  const f = await setupT11HostTest();
  const before = f.host.statistics.writes;
  await f.controller.refresh();
  assert.match(f.controller.view().source, /模拟酒馆宿主/);
  assert.equal(f.controller.view().canStart, true);
  await f.controller.start();
  assert.equal(f.controller.view().revision, f.state.data.revision + 1);
  assert.equal(f.controller.view().history.length, 1);
  const fresh = createT11Controller({
    service: f.session.service,
    round: f.session.round,
    store: f.session.gateway,
    runtime: f.options,
    readRecovery: f.session.refresh,
  });
  await fresh.refresh();
  assert.equal(fresh.view().autoEnabled, false);
  assert.equal(fresh.view().runs[0].saved, true);
  assert.ok(f.host.statistics.writes > before);
  const writes = f.host.statistics.writes;
  fresh.selectPage('history');
  fresh.selectHistory('genesis');
  await fresh.refresh();
  assert.equal(f.host.statistics.writes, writes);
  assert.deepEqual((await f.host.driver.readDurable(f.host.driver.currentBinding())).variables.mvu, { hp: 10 });
  fresh.close();
  f.controller.close();
  f.session.close();
});
test('T11 unverified host is not made writable by user settings / automatic toggle', async () => {
  const f = await setupT11HostTest();
  const driver = {
    ...f.host.driver,
    capabilities: {
      ...f.host.driver.capabilities,
      environment: 'unverified-host' as const,
      atomicDocumentCas: false,
      writeScope: 'none' as const,
    },
  };
  const c = createT11Controller({
    service: f.session.service,
    round: f.session.round,
    store: f.session.gateway,
    runtime: f.options,
    readRecovery: () => inspectT10Host(driver),
  });
  await c.refresh();
  c.setAutomatic(true);
  assert.equal(c.view().canStart, false);
  const writes = f.host.statistics.writes;
  assert.equal(await c.trigger('assistant-completed'), false);
  assert.equal(f.host.statistics.writes, writes);
  assert.match(c.view().source, /未验证宿主/);
  c.close();
  f.controller.close();
  f.session.close();
});
test('T11 changed story quarantines old host tail and shows verified ancestor, never replays invalid SQL', async () => {
  const f = await setupT11HostTest();
  await f.controller.start();
  const writes = f.host.statistics.writes;
  f.host.mutate(doc => {
    doc.messages[0].swipes[0] = '删改了旧剧情';
  });
  await f.controller.refresh();
  const v = f.controller.view();
  assert.equal(v.revision, f.state.data.revision);
  assert.equal(v.confirmed, true);
  assert.equal(v.invalidated.length, 1);
  assert.equal(v.history.length, 0);
  assert.equal(v.canStart, false);
  assert.equal(f.host.statistics.writes, writes);
  f.controller.close();
  f.session.close();
});
test('T11 damaged host namespace refuses cached success; pending records are not cleared by viewing', async () => {
  const f = await setupT11HostTest();
  await f.controller.start();
  const writes = f.host.statistics.writes;
  f.host.mutate(doc => {
    (doc.variables[T10_NAMESPACE] as Record<string, unknown>).version = 999;
  });
  await f.controller.refresh();
  assert.equal(f.controller.view().confirmed, false);
  assert.equal(f.controller.view().canStart, false);
  assert.equal(f.host.statistics.writes, writes);
  f.controller.close();
  f.session.close();
});
test('T11 projection service reports pending/synced separately, never writes from refresh', async () => {
  let status: 'pending' | 'synced' = 'pending';
  const f = await setup(undefined, {}, { projection: () => ({ status, detail: '只读投影回执' }) });
  await f.controller.refresh();
  assert.equal(f.controller.view().projection.status, 'pending');
  status = 'synced';
  assert.equal(f.controller.view().projection.status, 'synced');
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 closing shared runtime prevents late stage saves, unlike just navigating tabs', async () => {
  const gate = deferred<void>();
  const f = await setup(undefined, {
    reply: async r => {
      await gate.promise;
      return noChange(r.tableId);
    },
  });
  const done = f.controller.start();
  await until(() => f.round.view().macro.sent === 1);
  f.controller.close();
  gate.resolve();
  await done;
  assert.equal(f.store.statistics.writes, 0);
});

test('T11 a paused private round cannot be replaced by a new start; explicit cancel releases its UI draft', async () => {
  const f = await setup(undefined, {
    reply: async r => (r.stage === 'macro' ? noChange(r.tableId) : { status: 400, text: 'bad' }),
  });
  await f.controller.start();
  assert.equal(f.controller.view().canResume, true);
  assert.equal(f.controller.view().canStart, false);
  assert.equal(await f.controller.start(), false);
  assert.equal(f.controller.view().canCancel, true);
  f.controller.cancel();
  assert.equal(f.controller.view().canResume, false);
  assert.equal(f.controller.view().run.status, 'cancelled');
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 manual draft created during a pause disables continuation without discarding it', async () => {
  const f = await setup(undefined, {
    reply: async r => (r.stage === 'macro' ? noChange(r.tableId) : { status: 400, text: 'bad' }),
  });
  await f.controller.start();
  await f.manual('保留人工草稿');
  const draft = f.service.view().draft;
  assert.equal(f.controller.view().canResume, false);
  assert.equal(await f.controller.resume(), false);
  assert.deepEqual(f.service.view().draft, draft);
  f.controller.close();
});
test('T11 same-instance T10 ownership allows explicit remaining-budget resume; refreshed controller gets no grant', async () => {
  let failed = true;
  const f = await setupT11HostTest({
    reply: async r => (r.stage === 'micro' && failed ? { status: 400, text: 'bad' } : noChange(r.tableId)),
  });
  await f.controller.start();
  assert.equal((await f.session.refresh()).writable, false);
  assert.equal(f.controller.view().canResume, true);
  const fresh = createT11Controller({
    service: f.session.service,
    round: f.session.round,
    store: f.session.gateway,
    runtime: { ...f.options, canRun: f.session.canRun },
    readRecovery: f.session.refresh,
  });
  await fresh.refresh();
  assert.equal(fresh.view().canResume, false);
  failed = false;
  assert.equal(await f.controller.resume(), true);
  assert.equal(f.controller.view().revision, f.state.data.revision + 1);
  assert.equal(f.controller.view().run.sent, 3);
  fresh.close();
  f.controller.close();
  f.session.close();
});
test('T11 new round inherits sealed frequency progress; environment skips while NPC is due', async () => {
  const f = await setup();
  await f.controller.start();
  f.input.anchor.messageId = 'second-assistant';
  f.input.anchor.inputFingerprint = 'b'.repeat(64);
  f.input.story = [{ messageId: 'second-assistant', role: 'assistant', text: '等待雨势变化。' }];
  f.input.eligibleRound = 2;
  f.store.registerAnchor(f.input.anchor);
  await f.controller.refresh();
  const before = f.controller.view();
  assert.equal(before.tables.find(t => t.id === 'environment')!.due, false);
  assert.match(before.tables.find(t => t.id === 'environment')!.skip!, /尚未到/);
  await f.controller.start();
  assert.equal(f.controller.view().run.sent, 1);
  assert.equal(f.controller.view().tables.find(t => t.id === 'environment')!.lastSuccess, 1);
  assert.equal(f.controller.view().tables.find(t => t.id === 'npc')!.lastSuccess, 2);
  f.controller.close();
});
test('T11 invalidated host attempt remains marked originally saved but no longer effective', async () => {
  const f = await setupT11HostTest();
  await f.controller.start();
  f.host.mutate(doc => {
    doc.messages[0].swipes[0] = '旧剧情已编辑';
  });
  await f.controller.refresh();
  assert.equal(f.controller.view().runs[0].saved, true);
  assert.equal(f.controller.view().runs[0].effective, false);
  assert.match(f.controller.view().runs[0].label, /依赖失效/);
  f.controller.close();
  f.session.close();
});

test('T11 missing micro route is detected before any macro send without claiming a final micro candidate plan', async () => {
  const state = createMinimalT2Fixture();
  state.template.tables.find(t => t.id === 'npc')!.runtime.api = {
    state: 'value',
    value: { presetId: 'missing-preset' },
  };
  const f = await setup(state);
  await f.controller.refresh();
  assert.equal(f.controller.view().canStart, false);
  assert.equal(f.controller.view().tables.find(t => t.id === 'npc')!.pending, true);
  assert.match(f.controller.view().tables.find(t => t.id === 'npc')!.skip!, /预设不存在/);
  assert.equal(await f.controller.start(), false);
  assert.equal(f.round.view().sent, 0);
  f.controller.close();
});
test('T11 failed authority check marks old attempts effective status unknown, not currently confirmed', async () => {
  const f = await setup();
  await f.controller.start();
  f.store.queueReadFailure();
  await f.controller.refresh();
  assert.equal(f.controller.view().runs[0].saved, true);
  assert.equal(f.controller.view().runs[0].effective, null);
  assert.equal(f.controller.view().confirmed, false);
  f.controller.close();
});
test('T11 thrown editor/permission guards produce disabled controls, not a crashed page or unguarded run', async () => {
  const f = await setup(undefined, {
    canRun: () => {
      throw new Error('host offline');
    },
  });
  await f.controller.refresh();
  assert.equal(f.controller.view().canStart, false);
  assert.equal(await f.controller.start(), false);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
