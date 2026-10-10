import assert from 'node:assert/strict';
import test from 'node:test';
import { createMinimalT2Fixture } from './t2-defaults';
import { createT3LocalPolicy } from './t3-engine';
import { normalizeT4Scope, type T4Scope, type T4State } from './t4-protocol';
import { createT4CommitService, type T4Executor } from './t4-service';
import { createT4SandboxStore } from './t4-store';
import { setupT8Test, executeT8Test, deferredT8Test } from './t8-test-fixtures';
import { canWriteT10, createT10Gateway, type T10Driver } from './t10-host-gateway';
import {
  T10_NAMESPACE as NS,
  copyT10,
  frameT10Envelope,
  normalizeT10Document,
  registerT10Messages,
  type T10Document,
  type T10Message,
} from './t10-host-protocol';
import { inspectT10Host, prepareT10Fork, recoverT10Document } from './t10-recovery';
import { createT10SimulatedHost } from './t10-simulated-host';
import { openT10Session } from './t10-session';
import { observeT10Tavern } from './t10-tavern-observer';
import { createT10RecoveryController } from './t10-recovery-controller';
const scope: T4Scope = { mode: 't10-host', chatId: 'chat-one', worldId: 'demo-world', branchId: 'demo-main' };
const hash = 'a'.repeat(64);
const deferred = () => deferredT8Test<void>();
function allocator(prefix = 'id') {
  let count = 0;
  return (kind: 'message' | 'swipe') => `${prefix}-${kind}-${++count}`;
}
function message(index: number, role: 'user' | 'assistant', text: string): T10Message {
  return {
    message_id: index,
    role,
    name: role === 'user' ? '玩家' : '叙述者',
    is_hidden: false,
    swipe_id: 0,
    swipes: [text, `${text}（另一回复）`],
    swipes_data: [{ stat_data: { rank: 3 }, other: false }, { TavernDB: { sheet: ['保持'] } }],
    swipes_info: [{ extra: '保持' }, { extra: '保持另一页' }],
  };
}
function document(): T10Document {
  return normalizeT10Document({
    binding: { hostChatId: 'local-game.jsonl', characterId: 'card-one' },
    variables: { TavernDB: { table: [1, 2] }, mvu: { hp: 10 } },
    messages: [
      message(0, 'user', '去城门'),
      message(1, 'assistant', '大雨封路'),
      message(2, 'user', '等待'),
      message(3, 'assistant', '雨停了'),
    ],
  });
}
async function fixture(execute: T4Executor = executeT8Test, initialState = createMinimalT2Fixture()) {
  const initial = document(),
    host = createT10SimulatedHost(initial),
    gateway = createT10Gateway(host.driver),
    state = setupT8Test(initialState).state;
  await gateway.initialize(scope, state, allocator());
  const anchor = await gateway.capture(scope, 1, hash);
  const service = await createT4CommitService({ scope, store: gateway, execute });
  const batch = (id: string, goals = '检查城门') => ({
    batchId: `batch-${id}`,
    sql: "UPDATE we_npc SET f_goals = ? WHERE __we_row_id = 'traveler'",
    parameters: [goals],
    policy: createT3LocalPolicy(state.template, state.data),
  });
  async function prepare(id = 'one', goals?: string, selected = anchor) {
    return service.prepareSql({
      runId: `run-${id}`,
      commitId: `commit-${id}`,
      anchor: selected,
      context: {
        inputFingerprint: selected.inputFingerprint,
        promptFingerprint: hash,
        modelFingerprint: hash,
        parametersFingerprint: hash,
      },
      kind: 'manual',
      batches: [batch(id, goals)],
    });
  }
  return { initial, host, gateway, service, state, anchor, prepare, batch };
}
test('T10 host scope and sandbox scope cannot be exchanged or backed by the wrong gateway', async () => {
  assert.throws(() => normalizeT4Scope({ ...scope, chatId: 'sandbox-one' }));
  assert.throws(() => normalizeT4Scope({ ...scope, mode: 't4-sandbox' }));
  await assert.rejects(createT4SandboxStore().initialize(scope, createMinimalT2Fixture()));
  const f = await fixture();
  await assert.rejects(
    createT4CommitService({
      scope: { ...scope, mode: 't4-sandbox', chatId: 'sandbox-one' },
      store: f.gateway,
      execute: executeT8Test,
    }),
  );
});
test('T10 initialization preserves bodies, all swipe data and other plugin namespaces', async () => {
  const f = await fixture(),
    saved = await f.host.driver.readDurable(f.initial.binding);
  delete saved.variables[NS];
  for (const m of saved.messages) for (const data of m.swipes_data) delete data[NS];
  assert.deepEqual(saved, f.initial);
  assert.equal(f.host.statistics.writes, 1);
  await assert.rejects(f.gateway.initialize(scope, f.state, allocator()));
});
test('T10 one confirmed host CAS advances the shared service once and refresh reopens JSON', async () => {
  const f = await fixture();
  await f.prepare();
  assert.equal(f.service.view().formal.data.revision, 1);
  await f.service.save();
  assert.equal(f.service.view().formal.data.revision, 2);
  const reopened = createT10SimulatedHost(JSON.parse(f.host.exportStorage()));
  const service = await createT4CommitService({
    scope,
    store: createT10Gateway(reopened.driver),
    execute: async () => {
      throw new Error('Recovery must never execute SQL');
    },
  });
  assert.deepEqual(service.view().formal, f.service.view().formal);
  assert.equal(reopened.statistics.writes, 0);
  await f.service.save();
  assert.equal(f.host.statistics.writes, 2);
});
for (const missing of ['durableRead', 'atomicDocumentCas', 'evidence', 'version', 'writeScope', 'environment'] as const)
  test(`T10 missing host capability ${missing} blocks writes before any driver call`, async () => {
    const f = await fixture();
    let writes = 0;
    const values = {
      durableRead: false,
      atomicDocumentCas: false,
      evidence: '',
      version: '',
      writeScope: 'none',
      environment: 'unverified-host',
    };
    const driver = {
      ...f.host.driver,
      capabilities: { ...f.host.driver.capabilities, [missing]: values[missing] },
      compareDocument: async () => {
        writes++;
      },
    } as T10Driver;
    assert.equal(canWriteT10(driver), false);
    const report = await inspectT10Host(driver);
    assert.equal(report.writable, false);
    await assert.rejects(createT10Gateway(driver).initialize(scope, f.state, allocator()));
    assert.equal(writes, 0);
  });
for (const fault of ['save-failed', 'ack-lost', 'readback-failed'] as const)
  test(`T10 ${fault} never flips formal state before an independent confirmed read`, async () => {
    const f = await fixture();
    await f.prepare();
    f.host.queueFault(fault);
    await assert.rejects(f.service.save());
    assert.equal(f.service.view().formal.data.revision, 1);
    assert.equal(f.service.view().status, fault === 'save-failed' ? 'failed' : 'pending');
    if (fault !== 'save-failed') await assert.rejects(f.service.save());
    await f.service.reconcile();
    if (fault === 'save-failed') await f.service.save();
    assert.equal(f.service.view().formal.data.revision, 2);
    assert.equal(f.host.statistics.writes, 2);
  });
test('T10 two independent gateway instances race against the same full durable document', async () => {
  const f = await fixture(),
    secondGateway = createT10Gateway(f.host.driver);
  await secondGateway.capture(scope, 1, hash);
  const second = await createT4CommitService({ scope, store: secondGateway, execute: executeT8Test });
  await f.prepare();
  await second.prepareSql({
    runId: 'other-run',
    commitId: 'other-commit',
    anchor: f.anchor,
    context: { inputFingerprint: hash, promptFingerprint: hash, modelFingerprint: hash, parametersFingerprint: hash },
    kind: 'manual',
    batches: [f.batch('other')],
  });
  const results = await Promise.allSettled([f.service.save(), second.save()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.host.statistics.writes, 2);
  assert.equal((await f.gateway.read(scope)).commits.length, 1);
});
test('T10 other-plugin change during transport is not overwritten by stale merge', async () => {
  const f = await fixture();
  await f.prepare();
  const reached = deferred(),
    resume = deferred();
  f.host.delayWrites(async () => {
    reached.resolve();
    await resume.promise;
  });
  const saving = f.service.save();
  await reached.promise;
  f.host.mutate(doc => {
    doc.variables.TavernDB = { latest: '新值' };
  });
  resume.resolve();
  await assert.rejects(saving);
  assert.equal(f.host.statistics.writes, 1);
  assert.deepEqual(JSON.parse(f.host.exportStorage()).variables.TavernDB, { latest: '新值' });
});
test('T10 expired authorization rejects a delayed writer at the actual CAS boundary', async () => {
  const f = await fixture();
  await f.prepare();
  const reached = deferred(),
    resume = deferred();
  let valid = true;
  f.host.delayWrites(async () => {
    reached.resolve();
    await resume.promise;
  });
  const saving = f.service.save({
    authorize: () => {
      if (!valid) throw new Error('revoked');
    },
  });
  await reached.promise;
  valid = false;
  resume.resolve();
  await assert.rejects(saving);
  assert.equal(f.host.statistics.writes, 1);
});
test('T10 authorization-induced document mutation cannot win after an awaited fingerprint', async () => {
  const f = await fixture();
  await f.prepare();
  await assert.rejects(
    f.service.save({
      authorize: () => {
        f.host.mutate(d => {
          d.variables.other = 42;
        });
      },
    }),
  );
  assert.equal(f.host.statistics.writes, 1);
  assert.equal(JSON.parse(f.host.exportStorage()).variables.other, 42);
});
test('T10 switching chat while a delayed save is in flight prevents writing either chat', async () => {
  const f = await fixture();
  await f.prepare();
  const reached = deferred(),
    resume = deferred();
  f.host.delayWrites(async () => {
    reached.resolve();
    await resume.promise;
  });
  const saving = f.service.save();
  await reached.promise;
  f.host.switchBinding({ hostChatId: 'other.jsonl', characterId: 'other' });
  resume.resolve();
  await assert.rejects(saving);
  assert.equal(f.host.statistics.writes, 1);
});
test('T10 payload is frozen before awaits and repeat ID cannot replace a sealed commit', async () => {
  const f = await fixture(),
    p = await f.prepare();
  assert.ok(p.commit);
  const saving = f.gateway.compareAndSwap({ scope, expected: p.base, commit: p.commit });
  p.commit.snapshot.state.data.tables.npc[0].values.goals = '偷换';
  await saving;
  assert.equal((await f.gateway.read(scope)).commits[0].snapshot.state.data.tables.npc[0].values.goals, '检查城门');
  await assert.rejects(f.gateway.compareAndSwap({ scope, expected: p.base, commit: p.commit }));
});
for (const change of ['delete', 'edit', 'swipe', 'role', 'hidden', 'insert', 'reorder'] as const)
  test(`T10 ${change} invalidates only the dependent tail and restores the valid ancestor without AI`, async () => {
    const f = await fixture();
    await f.prepare();
    await f.service.save();
    const next = await f.gateway.capture(scope, 3, 'b'.repeat(64));
    await f.prepare('two', '继续等待', next);
    await f.service.save();
    f.host.mutate(doc => {
      if (change === 'delete') doc.messages.splice(2, 1);
      if (change === 'edit') doc.messages[2].swipes[0] = '改过的玩家输入';
      if (change === 'swipe') doc.messages[3].swipe_id = 1;
      if (change === 'role') doc.messages[2].role = 'assistant';
      if (change === 'hidden') doc.messages[2].is_hidden = true;
      if (change === 'insert') doc.messages.splice(2, 0, message(2, 'user', '插入'));
      if (change === 'reorder') [doc.messages[2], doc.messages[3]] = [doc.messages[3], doc.messages[2]];
      doc.messages.forEach((m, i) => {
        m.message_id = i;
      });
    });
    const raw = f.host.exportStorage(),
      report = await inspectT10Host(f.host.driver);
    assert.equal(report.status, 'restored-ancestor');
    assert.equal(report.head?.commitId, 'commit-one');
    assert.equal(report.state?.data.revision, 2);
    assert.deepEqual(
      report.pending.map(p => p.commitId),
      ['commit-two'],
    );
    assert.equal(report.writable, false);
    assert.equal(f.host.exportStorage(), raw);
    await assert.rejects(f.gateway.read(scope));
  });
test('T10 editing the first dependency restores genesis and preserves corrupted-tail bytes', async () => {
  const f = await fixture();
  await f.prepare();
  await f.service.save();
  f.host.mutate(d => {
    d.messages[0].swipes[0] = '新输入';
  });
  const report = await inspectT10Host(f.host.driver);
  assert.equal(report.head?.seq, 0);
  assert.deepEqual(report.state, f.state);
});
test('T10 appended unregistered messages and inactive new swipes do not invalidate older prefixes', async () => {
  const f = await fixture();
  await f.prepare();
  await f.service.save();
  f.host.mutate(d => {
    d.messages.push(message(4, 'user', '继续'), message(5, 'assistant', '新剧情'));
    d.messages[1].swipes.push('新备选');
    d.messages[1].swipes_data.push({});
    d.messages[1].swipes_info.push({});
  });
  assert.equal((await inspectT10Host(f.host.driver)).status, 'ready');
  await assert.rejects(f.gateway.capture(scope, 5, hash));
  const before = await f.gateway.capture(scope, 1, hash);
  await f.gateway.registerMessages(scope, allocator('new'));
  assert.deepEqual(await f.gateway.capture(scope, 1, hash), before);
  assert.ok(await f.gateway.capture(scope, 5, hash));
});
for (const damage of ['chain', 'fingerprint', 'template', 'receipt'] as const)
  test(`T10 damaged ${damage} quarantines the suffix instead of accepting cache or current defaults`, async () => {
    const f = await fixture();
    await f.prepare();
    await f.service.save();
    const next = await f.gateway.capture(scope, 3, hash);
    await f.prepare('two', '等候', next);
    await f.service.save();
    f.host.mutate(d => {
      const e = d.variables[NS] as unknown as ReturnType<typeof frameT10Envelope>;
      if (damage === 'chain') e.archive.commits[1].parentCommitId = 'missing';
      if (damage === 'fingerprint') e.archive.commits[1].snapshot.state.data.tables.npc[0].values.goals = '损坏';
      if (damage === 'template') (e.archive.commits[1].snapshot.state as Partial<T4State>).template = undefined;
      if (damage === 'receipt') e.receipts[1].dependencies[0].bodyFingerprint = 'b'.repeat(64);
    });
    const view = await inspectT10Host(f.host.driver, {
      scope,
      head: f.service.headToken(),
      state: f.service.view().formal,
    });
    assert.equal(view.head?.commitId, 'commit-one');
    assert.equal(view.cache, 'discarded');
    assert.equal(view.status, 'restored-ancestor');
  });
test('T10 missing genesis template cannot promote an otherwise valid cache to authority', async () => {
  const f = await fixture();
  f.host.mutate(d => {
    delete (d.variables[NS] as unknown as { archive: { genesis: Partial<T4State> } }).archive.genesis.template;
  });
  const view = await inspectT10Host(f.host.driver, { state: f.state });
  assert.equal(view.status, 'damaged');
  assert.equal(view.state, null);
});
test('T10 unknown chat and duplicate message/swipe stamps are rejected', async () => {
  const bad = document();
  bad.binding.hostChatId = 'unknown_chat';
  assert.throws(() => normalizeT10Document(bad));
  const f = await fixture();
  f.host.mutate(d => {
    d.messages[1].swipes_data[0][NS] = d.messages[0].swipes_data[0][NS];
  });
  await assert.rejects(f.gateway.capture(scope, 1, hash));
});
test('T10 without an assistant anchor a draft cannot produce a host commit', async () => {
  const f = await fixture();
  await assert.rejects(f.gateway.capture(scope, 0, hash));
  await f.service.prepareSql({
    runId: 'draft',
    commitId: 'draft-commit',
    anchor: null,
    context: { inputFingerprint: hash, modelFingerprint: hash, promptFingerprint: hash, parametersFingerprint: hash },
    kind: 'manual',
    batches: [f.batch('draft')],
  });
  await assert.rejects(f.service.save());
  assert.equal(f.host.statistics.writes, 1);
});
test('T10 cache absence/corruption recovers the exact snapshot and never writes', async () => {
  const f = await fixture();
  await f.prepare();
  await f.service.save();
  const doc = JSON.parse(f.host.exportStorage());
  const cache = { scope, head: f.service.headToken(), state: f.service.view().formal };
  assert.equal((await recoverT10Document(doc, 'simulated-host', cache)).cache, 'match');
  cache.state.data.tables.npc[0].values.goals = '错误缓存';
  assert.equal((await recoverT10Document(doc, 'simulated-host', cache)).cache, 'discarded');
  assert.equal((await recoverT10Document(doc, 'simulated-host')).cache, 'absent');
  assert.equal(f.host.statistics.writes, 2);
});
test('T10 failed durable read does not report saved or auto-retry writes', async () => {
  const f = await fixture();
  f.host.failReads();
  assert.equal((await inspectT10Host(f.host.driver)).status, 'read-failed');
  assert.equal(f.host.statistics.writes, 1);
});
test('T10 incomplete run persists a credential-free reservation and reopens without transport', async () => {
  const f = await fixture(),
    reservation = {
      runId: 'pending-run',
      stage: 'macro' as const,
      sent: 1,
      maxRequests: 3,
      anchor: f.anchor,
      signal: new AbortController().signal,
    };
  await f.gateway.reserveSend(scope, 'owner-one', reservation);
  const report = await inspectT10Host(f.host.driver);
  assert.equal(report.runs[0].status, 'interrupted');
  assert.equal(report.writable, false);
  const fresh = createT10SimulatedHost(JSON.parse(f.host.exportStorage()));
  assert.equal((await inspectT10Host(fresh.driver)).runs[0].sent, 1);
  assert.equal(fresh.statistics.writes, 0);
  await assert.rejects(f.gateway.reserveSend(scope, 'owner-two', { ...reservation, sent: 2 }));
  await f.gateway.reserveSend(scope, 'owner-one', { ...reservation, stage: 'micro', sent: 2 });
  await assert.rejects(f.gateway.reserveSend(scope, 'owner-one', { ...reservation, sent: 3 }));
  await assert.rejects(f.gateway.reserveSend(scope, 'owner-one', { ...reservation, stage: 'micro', sent: 4 }));
  await f.gateway.abandonRun(scope, reservation.runId);
  assert.equal((await inspectT10Host(f.host.driver)).runs[0].status, 'abandoned');
  assert.equal((await f.gateway.read(scope)).commits.length, 0);
});
test('T10 same trigger is owned by only one reservation across independent gateways', async () => {
  const f = await fixture(),
    second = createT10Gateway(f.host.driver);
  await second.capture(scope, 1, hash);
  const input = {
    runId: 'shared',
    stage: 'macro' as const,
    sent: 1,
    maxRequests: 3,
    anchor: f.anchor,
    signal: new AbortController().signal,
  };
  const results = await Promise.allSettled([
    f.gateway.reserveSend(scope, 'one', input),
    second.reserveSend(scope, 'two', input),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.host.statistics.writes, 2);
});
test('T10 reservation ACK loss stops transport and is recoverable by query only', async () => {
  const f = await fixture();
  f.host.queueFault('ack-lost');
  await assert.rejects(
    f.gateway.reserveSend(scope, 'one', {
      runId: 'uncertain',
      stage: 'macro',
      sent: 1,
      maxRequests: 3,
      anchor: f.anchor,
      signal: new AbortController().signal,
    }),
  );
  const view = await inspectT10Host(f.host.driver);
  assert.equal(view.runs[0].status, 'interrupted');
  assert.equal(view.runs[0].sent, 1);
});
for (const kind of ['copy', 'branch'] as const)
  test(`T10 explicit ${kind} inherits only its cutoff, uses new stable IDs and ignores source deletions`, async () => {
    const f = await fixture();
    await f.prepare();
    await f.service.save();
    const nextAnchor = await f.gateway.capture(scope, 3, hash);
    await f.prepare('two', '后缀不能继承', nextAnchor);
    await f.service.save();
    const source = JSON.parse(f.host.exportStorage()) as T10Document,
      target = copyT10(source);
    target.binding.hostChatId = `${kind}.jsonl`;
    const targetScope = {
      ...scope,
      chatId: `chat-${kind}`,
      worldId: kind === 'copy' ? 'world-copy' : scope.worldId,
      branchId: `branch-${kind}`,
    };
    const prepared = await prepareT10Fork({
      source,
      target,
      targetScope,
      throughCommitId: 'commit-one',
      kind,
      allocate: allocator(kind),
    });
    const targetHost = createT10SimulatedHost(target),
      gateway = createT10Gateway(targetHost.driver),
      e = frameT10Envelope(prepared.variables[NS]);
    await gateway.installFork(targetScope, e.archive.origin, e.archive.genesis, prepared, e.inheritedDependencies);
    const view = await inspectT10Host(targetHost.driver);
    assert.equal(view.status, 'ready');
    assert.equal(view.state?.data.tables.npc[0].values.goals, '检查城门');
    assert.equal(e.archive.origin.kind, kind);
    assert.equal(e.archive.origin.sourceHistory.commits.length, 1);
    f.host.mutate(d => {
      d.messages.splice(0);
    });
    assert.equal((await inspectT10Host(targetHost.driver)).status, 'ready');
    targetHost.mutate(d => {
      d.messages[0].swipes[0] = '复制后的新输入';
    });
    assert.equal((await inspectT10Host(targetHost.driver)).status, 'damaged');
  });
test('T10 copied metadata is read-only until an explicit new identity and verified prefix mapping', async () => {
  const f = await fixture();
  await f.prepare();
  await f.service.save();
  const target = JSON.parse(f.host.exportStorage()) as T10Document;
  target.binding.hostChatId = 'copy.jsonl';
  assert.equal((await recoverT10Document(target, 'simulated-host')).status, 'identity-mismatch');
  target.messages[0].swipes[0] = '不同的剧情';
  await assert.rejects(
    prepareT10Fork({
      source: JSON.parse(f.host.exportStorage()),
      target,
      targetScope: { ...scope, chatId: 'chat-copy', worldId: 'copy', branchId: 'copy' },
      throughCommitId: 'commit-one',
      kind: 'copy',
      allocate: allocator('copy'),
    }),
  );
});
test('T10 TavernHelper observer is memory-only, lossless and never calls a write API', () => {
  const doc = document();
  const reader = { binding: () => doc.binding, getVariables: () => doc.variables, getChatMessages: () => doc.messages };
  const observation = observeT10Tavern(reader);
  assert.equal(observation.writable, false);
  assert.equal(observation.source, 'memory-only');
  assert.deepEqual(observation.document, doc);
});
test('T10 recovery controller discards stale async reads and exposes no automatic model/save action', async () => {
  const f = await fixture(),
    reached = deferred(),
    resume = deferred();
  const driver: T10Driver = {
    ...f.host.driver,
    readDurable: async b => {
      reached.resolve();
      await resume.promise;
      return f.host.driver.readDurable(b);
    },
  };
  const controller = createT10RecoveryController(driver),
    refreshing = controller.refresh();
  await reached.promise;
  f.host.emit('swiped');
  resume.resolve();
  await refreshing;
  assert.equal(controller.view().recovery, null);
  await controller.refresh();
  assert.equal(controller.view().recovery?.status, 'ready');
  controller.close();
  assert.equal(f.host.statistics.writes, 1);
});
test('T10 T9 integration records both phases before fake sends, commits once and restores ledger without AI', async () => {
  const f = await fixture(),
    t8 = setupT8Test(f.state);
  const input = copyT10(t8.input);
  input.anchor = f.anchor;
  input.story = [{ messageId: f.anchor.messageId, role: 'assistant', text: f.initial.messages[1].swipes[0] }];
  const session = await openT10Session({
    driver: f.host.driver,
    scope,
    execute: executeT8Test,
    runtime: { ...t8.options, readInput: () => input },
  });
  await (
    await session.round.start('host-round')
  ).done;
  const view = session.round.view();
  assert.ok(view.status === 'saved' || view.status === 'no-change');
  const report = await inspectT10Host(f.host.driver);
  assert.equal(report.runs[0].status, 'committed');
  assert.equal(report.evolution?.sent, report.runs[0].sent);
  assert.equal(report.head?.seq, 1);
  const archive = await f.gateway.read(scope);
  assert.equal(archive.commits[0].steps.at(-1)?.policy.stage, 'micro');
  assert.equal(JSON.stringify(report).includes('private-t8-key'), false);
  session.close();
});
test('T10 host change cancels the whole run and prevents all late responses from committing', async () => {
  const f = await fixture(),
    t8 = setupT8Test(f.state),
    reached = deferred(),
    resume = deferred();
  const input = {
    ...t8.input,
    anchor: f.anchor,
    story: [{ messageId: f.anchor.messageId, role: 'assistant' as const, text: f.initial.messages[1].swipes[0] }],
  };
  const session = await openT10Session({
    driver: f.host.driver,
    scope,
    execute: executeT8Test,
    runtime: {
      ...t8.options,
      readInput: () => input,
      reply: async () => {
        reached.resolve();
        await resume.promise;
        return { status: 200, text: '{"sql":"SELECT __we_row_id FROM we_environment","parameters":[]}' };
      },
    },
  });
  const running = await session.round.start('cancel-host');
  await reached.promise;
  f.host.emit('regenerated');
  resume.resolve();
  await running.done;
  assert.equal((await f.gateway.read(scope)).commits.length, 0);
  assert.equal((await inspectT10Host(f.host.driver)).runs[0].status, 'interrupted');
  session.close();
});
test('T10 deterministic recovery retains world time/progress after reopening, never current clock', async () => {
  const f = await fixture(),
    t8 = setupT8Test(f.state),
    input = {
      ...t8.input,
      anchor: f.anchor,
      story: [{ messageId: f.anchor.messageId, role: 'assistant' as const, text: f.initial.messages[1].swipes[0] }],
    };
  const session = await openT10Session({
    driver: f.host.driver,
    scope,
    execute: executeT8Test,
    runtime: { ...t8.options, readInput: () => input },
  });
  await (
    await session.round.start('time-host')
  ).done;
  const first = await inspectT10Host(f.host.driver),
    reopened = createT10SimulatedHost(JSON.parse(f.host.exportStorage()));
  assert.deepEqual((await inspectT10Host(reopened.driver)).evolution, first.evolution);
  assert.deepEqual(first.evolution?.worldTime, input.now);
  assert.equal(reopened.statistics.writes, 0);
  session.close();
});
test('T10 strict records refuse arbitrary secret fields and excessive archive/history input', async () => {
  const f = await fixture();
  f.host.mutate(d => {
    (d.variables[NS] as unknown as Record<string, unknown>).apiKey = 'DO-NOT-STORE';
  });
  assert.equal((await inspectT10Host(f.host.driver)).status, 'damaged');
  assert.throws(() =>
    registerT10Messages(
      {
        ...document(),
        messages: Array.from({ length: 2001 }, (_, i) => message(i, 'user', 'x')),
      } as unknown as T10Document,
      allocator(),
    ),
  );
});

test('T10 empty chat cannot persist first state without inventing an assistant anchor', async () => {
  const doc = document();
  doc.messages = [];
  const host = createT10SimulatedHost(doc),
    gateway = createT10Gateway(host.driver);
  await assert.rejects(gateway.initialize(scope, createMinimalT2Fixture(), allocator()));
  assert.equal(host.statistics.writes, 0);
});
test('T10 missing independent durable read is not substituted with an in-memory getter', async () => {
  const f = await fixture();
  let called = 0;
  const driver: T10Driver = {
    ...f.host.driver,
    capabilities: { ...f.host.driver.capabilities, durableRead: false },
    readDurable: async b => {
      called++;
      return f.host.driver.readDurable(b);
    },
  };
  const report = await inspectT10Host(driver);
  assert.equal(report.status, 'read-failed');
  assert.equal(report.state, null);
  assert.equal(called, 0);
});
test('T10 corrupted pending-run counter cannot restore a lower request budget', async () => {
  const f = await fixture();
  await f.gateway.reserveSend(scope, 'owner', {
    runId: 'integrity-run',
    stage: 'macro',
    sent: 1,
    maxRequests: 3,
    anchor: f.anchor,
    signal: new AbortController().signal,
  });
  f.host.mutate(d => {
    (d.variables[NS] as unknown as { runs: { maxRequests: number }[] }).runs[0].maxRequests = 10;
  });
  const report = await inspectT10Host(f.host.driver);
  assert.equal(report.status, 'damaged');
  assert.equal(report.writable, false);
  await assert.rejects(f.gateway.read(scope));
});
test('T10 signal and authorization capabilities cannot be replaced after a direct save begins', async () => {
  const f = await fixture(),
    p = await f.prepare(),
    reached = deferred(),
    resume = deferred();
  assert.ok(p.commit);
  const controller = new AbortController(),
    replacement = new AbortController();
  let allowed = true;
  f.host.delayWrites(async () => {
    reached.resolve();
    await resume.promise;
  });
  const input = {
    scope,
    expected: p.base,
    commit: p.commit,
    signal: controller.signal,
    authorize: () => {
      if (!allowed) throw new Error();
    },
  };
  const saving = f.gateway.compareAndSwap(input);
  await reached.promise;
  input.signal = replacement.signal;
  input.authorize = () => {};
  allowed = false;
  controller.abort();
  resume.resolve();
  await assert.rejects(saving);
  assert.equal(f.host.statistics.writes, 1);
});
test('T10 reservation failure prevents even the first fake model send', async () => {
  const f = await fixture(),
    t8 = setupT8Test(f.state);
  let sent = 0;
  const input = {
    ...t8.input,
    anchor: f.anchor,
    story: [{ messageId: f.anchor.messageId, role: 'assistant' as const, text: f.initial.messages[1].swipes[0] }],
  };
  const session = await openT10Session({
    driver: f.host.driver,
    scope,
    execute: executeT8Test,
    runtime: {
      ...t8.options,
      readInput: () => input,
      reply: async () => {
        sent++;
        throw new Error('must not reach transport');
      },
    },
  });
  f.host.queueFault('save-failed');
  await (
    await session.round.start('no-send')
  ).done;
  assert.equal(sent, 0);
  assert.equal((await f.gateway.read(scope)).commits.length, 0);
  assert.equal(f.host.statistics.writes, 1);
  session.close();
});
test('T10 runtime story must match its persisted stable message identity before any requests', async () => {
  const f = await fixture(),
    t8 = setupT8Test(f.state),
    input = {
      ...t8.input,
      anchor: f.anchor,
      story: [{ messageId: f.anchor.messageId, role: 'assistant' as const, text: '伪造剧情' }],
    };
  await assert.rejects(
    openT10Session({
      driver: f.host.driver,
      scope,
      execute: executeT8Test,
      runtime: { ...t8.options, readInput: () => input },
    }),
  );
  assert.equal(f.host.statistics.writes, 1);
});
test('T10 copied genesis dependency corruption cannot silently unlock source-derived facts', async () => {
  const f = await fixture();
  await f.prepare();
  await f.service.save();
  const source = JSON.parse(f.host.exportStorage()),
    target = copyT10(source) as T10Document;
  target.binding.hostChatId = 'copy';
  const doc = await prepareT10Fork({
    source,
    target,
    targetScope: { ...scope, chatId: 'chat-copy', worldId: 'copy', branchId: 'copy' },
    throughCommitId: 'commit-one',
    kind: 'copy',
    allocate: allocator('copy'),
  });
  (doc.variables[NS] as unknown as { inheritedDependencies: unknown[] }).inheritedDependencies = [];
  assert.equal((await recoverT10Document(doc, 'simulated-host')).status, 'damaged');
});
test('T10 200 NPC capacity reports chat JSON size and query-only recovery time without compression', async t => {
  const state = createMinimalT2Fixture(),
    original = state.data.tables.npc[0];
  state.data.tables.npc = Array.from({ length: 200 }, (_, i) => {
    const row = copyT10(original);
    row.meta.id = i === 0 ? 'traveler' : `npc-${i}`;
    row.values.name = `角色 ${i}`;
    return row;
  });
  const f = await fixture(executeT8Test, state);
  const start = performance.now();
  await f.prepare();
  const preparedMs = performance.now() - start;
  const saveStart = performance.now();
  await f.service.save();
  const saveMs = performance.now() - saveStart;
  const before = f.host.exportStorage(),
    recoverStart = performance.now(),
    report = await inspectT10Host(f.host.driver);
  assert.equal(report.state?.data.tables.npc.length, 200);
  assert.equal(f.host.exportStorage(), before);
  t.diagnostic(
    JSON.stringify({
      scope: 'simulated-host-not-production',
      npcRows: 200,
      bytes: report.bytes,
      prepareMs: Math.round(preparedMs),
      saveConfirmMs: Math.round(saveMs),
      recoverMs: Math.round(performance.now() - recoverStart),
      compression: false,
    }),
  );
});
