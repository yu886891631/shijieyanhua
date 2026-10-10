import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { createCustomT2Fixture, createMinimalT2Fixture } from './t2-defaults';
import { cloneT2Json } from './t2-template';
import { createT3LocalPolicy, executeT3Request } from './t3-engine';
import {
  canonicalT4Json,
  fingerprintT4,
  type T4Anchor,
  type T4Context,
  type T4Scope,
  type T4State,
} from './t4-protocol';
import { createT4SandboxStore, headT4Token, T4StoreError, type T4ArchiveGateway } from './t4-store';
import {
  createT4CommitService,
  forkT4Sandbox,
  reconcileT4Cache,
  recoverT4Snapshot,
  replayT4Suffix,
  T4ServiceError,
  type T4Batch,
  type T4Executor,
  type T4RunSpec,
  previewT4View,
} from './t4-service';
import { createT4PreviewModel } from './t4-preview';

const ready = initSqlJs({
  wasmBinary: Uint8Array.from(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});
const clone = <T>(input: T): T => cloneT2Json(input) as unknown as T;
const scope: T4Scope = { mode: 't4-sandbox', chatId: 'sandbox-chat', worldId: 'demo-world', branchId: 'demo-main' };
const sql = "UPDATE we_npc SET f_goals = ? WHERE __we_row_id = 'traveler';";
const copyScope: T4Scope = { ...scope, chatId: 'sandbox-copy', worldId: 'copied-world', branchId: 'copied-main' };
async function fixture(executor?: T4Executor, state: T4State = createMinimalT2Fixture()) {
  const store = createT4SandboxStore();
  const inputFingerprint = await fingerprintT4({ story: 'fixture-story', prerequisites: 'done' });
  const anchor: T4Anchor = { chatId: scope.chatId, messageId: 'assistant-one', swipeId: 'swipe-one', inputFingerprint };
  const context: T4Context = {
    inputFingerprint,
    promptFingerprint: await fingerprintT4('fixed-prompt'),
    modelFingerprint: await fingerprintT4('fake-model'),
    parametersFingerprint: await fingerprintT4({ temperature: 0 }),
  };
  const execute: T4Executor = executor ?? (async request => executeT3Request(await ready, request));
  store.registerAnchor(anchor, { mvu: { level: 5 }, database: ['retain'], swipes: { second: 'unchanged' } });
  await store.initialize(scope, state);
  const service = await createT4CommitService({ scope, store, execute });
  const spec = (id: string, selected: T4Anchor | null = anchor): T4RunSpec => ({
    runId: `run-${id}`,
    commitId: `commit-${id}`,
    anchor: selected,
    context,
  });
  const batch = (id: string, value = '检查道路'): T4Batch => ({
    sql,
    parameters: [value],
    batchId: `batch-${id}`,
    policy: createT3LocalPolicy(state.template, state.data),
  });
  return { store, service, execute, anchor, context, spec, batch, state };
}
const code = (expected: string) => (error: unknown) =>
  (error instanceof T4ServiceError || error instanceof T4StoreError) && error.code === expected;
async function prepare(f: Awaited<ReturnType<typeof fixture>>, id = 'one', value = '检查道路') {
  return f.service.prepareSql({ ...f.spec(id), kind: 'manual', batches: [f.batch(id, value)] });
}

test('T4 true SQLite draft is not formal until one JSON save and independent read-back', async () => {
  const f = await fixture();
  const before = f.service.view();
  const draft = await prepare(f);
  assert.equal(draft.state.data.tables.npc[0].values.goals, '检查道路');
  assert.equal(draft.state.data.revision, before.formal.data.revision + 1);
  assert.deepEqual(f.service.view().formal, before.formal);
  assert.equal(f.store.statistics.writes, 0);
  const saved = await f.service.save();
  assert.equal(saved.status, 'saved');
  assert.equal(saved.head.seq, 1);
  assert.equal(saved.formal.data.tables.npc[0].meta.updatedAtRevision, saved.formal.data.revision);
  assert.deepEqual(saved.formal.data.tables.environment[0].meta, before.formal.data.tables.environment[0].meta);
  assert.equal(f.store.statistics.writes, 1);
});

test('T4 identical prepared ID retry writes once without another SQL call or revision advance', async () => {
  let calls = 0;
  const f = await fixture(async request => {
    calls++;
    return executeT3Request(await ready, request);
  });
  await prepare(f);
  const first = await f.service.save();
  const second = await f.service.save();
  assert.deepEqual(second.formal, first.formal);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(calls, 1);
});

test('T4 same ID with different payload and duplicate run with another commit are zero-overwrite conflicts', async () => {
  const f = await fixture();
  const competing = await createT4CommitService({ scope, store: f.store, execute: f.execute });
  const committed = await prepare(f);
  await competing.prepareSql({ ...f.spec('one'), kind: 'manual', batches: [f.batch('one', '另一行动')] });
  await f.service.save();
  await assert.rejects(competing.save(), code('CONFLICT'));
  const other = await createT4CommitService({ scope, store: f.store, execute: f.execute });
  await assert.rejects(
    other.prepareSql({ ...f.spec('one'), commitId: 'different-commit', kind: 'manual', batches: [f.batch('two')] }),
    code('CONFLICT'),
  );
  assert.equal(f.store.statistics.writes, 1);
  assert.deepEqual((await f.store.read(scope)).commits[0], committed.commit);
});

test('T4 concurrent instances at the same baseline permit exactly one simulated CAS winner', async () => {
  const f = await fixture();
  const other = await createT4CommitService({ scope, store: f.store, execute: f.execute });
  await prepare(f);
  await other.prepareSql({ ...f.spec('two'), kind: 'manual', batches: [f.batch('two', '留在营地')] });
  const outcomes = await Promise.allSettled([f.service.save(), other.save()]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
  assert.equal((await f.store.read(scope)).commits.length, 1);
  assert.equal(f.store.statistics.writes, 1);
});

test('T4 save failure retains draft, does not advance formal, and same payload can be saved afterward', async () => {
  const f = await fixture(),
    before = f.service.view().formal;
  await prepare(f);
  f.store.queueWriteFault('save-failed');
  await assert.rejects(f.service.save(), code('SAVE_FAILED'));
  assert.equal(f.service.view().status, 'failed');
  assert.deepEqual(f.service.view().formal, before);
  assert.ok(f.service.view().draft);
  assert.equal((await f.store.read(scope)).commits.length, 0);
  assert.equal((await f.service.save()).head.seq, 1);
  assert.equal(f.store.statistics.writes, 1);
});

test('T4 ACK lost blocks blind retry and new preparation; reconcile confirms commit without SQL reexecution', async () => {
  const f = await fixture(),
    before = f.service.view().formal;
  await prepare(f);
  f.store.queueWriteFault('ack-lost');
  await assert.rejects(f.service.save(), code('PENDING'));
  assert.equal(f.service.view().status, 'pending');
  assert.deepEqual(f.service.view().formal, before);
  await assert.rejects(f.service.save(), code('PENDING'));
  await assert.rejects(prepare(f, 'new'), code('PENDING'));
  assert.throws(() => f.service.cancelDraft(), code('PENDING'));
  assert.equal((await f.service.reconcile()).head.seq, 1);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal((await f.service.save()).head.seq, 1);
});

test('T4 failed read-back after successful write is pending, not rollback or cache success', async () => {
  const f = await fixture(),
    before = f.service.view().formal;
  await prepare(f);
  f.store.queueReadFailure();
  await assert.rejects(f.service.save(), code('PENDING'));
  assert.deepEqual(f.service.view().formal, before);
  assert.equal(f.store.statistics.writes, 1);
  f.store.queueReadFailure();
  await assert.rejects(f.service.reconcile(), code('READ_FAILED'));
  assert.equal(f.service.view().status, 'pending');
  assert.equal((await f.service.reconcile()).head.seq, 1);
});

test('T4 unknown save exception with no actual write requires read-back before identical retry', async () => {
  const f = await fixture();
  let fail = true;
  const gateway: T4ArchiveGateway = {
    mode: 't4-sandbox',
    read: s => f.store.read(s),
    async compareAndSwap(input) {
      if (fail) {
        fail = false;
        throw new Error('unknown transport');
      }
      await f.store.compareAndSwap(input);
    },
  };
  const service = await createT4CommitService({ scope, store: gateway, execute: f.execute });
  await service.prepareSql({ ...f.spec('one'), kind: 'manual', batches: [f.batch('one')] });
  await assert.rejects(service.save(), code('PENDING'));
  assert.equal((await service.reconcile()).status, 'private');
  assert.equal((await service.save()).head.seq, 1);
  assert.equal(f.store.statistics.writes, 1);
});

test('T4 cancelled before persistence produces zero writes and cannot resubmit cancelled draft', async () => {
  const f = await fixture();
  await prepare(f);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.service.save({ signal: controller.signal }), code('ABORTED'));
  assert.equal(f.service.view().status, 'cancelled');
  assert.equal(f.store.statistics.writes, 0);
  await assert.rejects(f.service.save(), code('ABORTED'));
});

test('T4 cancellation after actual write cannot claim rollback; read-back confirms saved state', async () => {
  const f = await fixture(),
    controller = new AbortController();
  const gateway: T4ArchiveGateway = {
    mode: 't4-sandbox',
    read: s => f.store.read(s),
    async compareAndSwap(input) {
      await f.store.compareAndSwap(input);
      controller.abort();
    },
  };
  const service = await createT4CommitService({ scope, store: gateway, execute: f.execute });
  await service.prepareSql({ ...f.spec('one'), kind: 'manual', batches: [f.batch('one')] });
  assert.equal((await service.save({ signal: controller.signal })).status, 'saved');
  assert.equal(f.store.statistics.writes, 1);
});

test('T4 cancelled SQL result and mixed invalid batch discard entire private execution', async () => {
  const controller = new AbortController();
  const f = await fixture(async request => {
    const result = executeT3Request(await ready, request);
    controller.abort();
    return result;
  });
  const before = f.service.view().formal;
  await assert.rejects(
    f.service.prepareSql(
      { ...f.spec('one'), kind: 'manual', batches: [f.batch('one')] },
      { signal: controller.signal },
    ),
    code('ABORTED'),
  );
  assert.deepEqual(f.service.view().formal, before);
  assert.equal(f.store.statistics.writes, 0);
  const g = await fixture();
  await assert.rejects(
    g.service.prepareSql({
      ...g.spec('two'),
      kind: 'manual',
      batches: [g.batch('a'), { ...g.batch('b'), sql: 'DROP TABLE we_npc;' }],
    }),
  );
  assert.equal(g.service.view().draft, null);
  assert.equal(g.store.statistics.writes, 0);
});

test('T4 absent assistant anchor preserves only draft and cannot fabricate a formal commit', async () => {
  const f = await fixture();
  const draft = await f.service.prepareSql({ ...f.spec('one', null), kind: 'manual', batches: [f.batch('one')] });
  assert.equal(draft.commit, null);
  assert.equal(f.service.view().status, 'draft');
  await assert.rejects(f.service.save(), code('ANCHOR'));
  assert.equal(f.store.statistics.writes, 0);
  assert.equal((await f.store.read(scope)).commits.length, 0);
});

test('T4 edited message, changed swipe, different chat and input fingerprints cannot save old results', async () => {
  for (const mode of ['text', 'swipe', 'missing'] as const) {
    const f = await fixture();
    await prepare(f);
    if (mode === 'text') f.store.registerAnchor({ ...f.anchor, inputFingerprint: await fingerprintT4('edited-story') });
    else if (mode === 'swipe') f.store.registerAnchor({ ...f.anchor, swipeId: 'swipe-two' });
    else f.store.selectAnchor(scope.chatId, null);
    await assert.rejects(f.service.save(), code('ANCHOR'));
    assert.equal(f.store.statistics.writes, 0);
  }
  const f = await fixture();
  await assert.rejects(
    f.service.prepareSql({
      ...f.spec('wrong', { ...f.anchor, chatId: 'sandbox-other' }),
      kind: 'manual',
      batches: [f.batch('one')],
    }),
    code('ANCHOR'),
  );
  await assert.rejects(
    f.service.prepareSql({
      ...f.spec('wrong'),
      context: { ...f.context, inputFingerprint: 'a'.repeat(64) },
      kind: 'manual',
      batches: [f.batch('one')],
    }),
    code('ANCHOR'),
  );
});

test('T4 same message anchor holds multiple ordered commits and unrelated JSON namespaces stay intact', async () => {
  const f = await fixture(),
    other = f.store.readOtherData(scope.chatId);
  await prepare(f, 'one');
  await f.service.save();
  await prepare(f, 'two', '检查完成');
  await f.service.save();
  const archive = await f.store.read(scope);
  assert.equal(archive.commits.length, 2);
  assert.deepEqual(archive.commits[0].anchor, archive.commits[1].anchor);
  assert.equal(archive.commits[1].parentCommitId, archive.commits[0].commitId);
  assert.deepEqual(f.store.readOtherData(scope.chatId), other);
});

test('T4 close and recreate service plus serialized-store reload recover exact state without executor', async () => {
  const f = await fixture();
  await prepare(f);
  const saved = await f.service.save();
  f.service.close();
  assert.throws(() => f.service.view(), code('CLOSED'));
  const reload = createT4SandboxStore(f.store.exportStorage());
  const execute: T4Executor = async () => {
    throw new Error('Recovery must not execute SQL/AI.');
  };
  const reopened = await createT4CommitService({ scope, store: reload, execute });
  assert.deepEqual(reopened.view().formal, saved.formal);
  assert.deepEqual(reopened.view().head, saved.head);
  assert.equal(reopened.view().draft, null);
});

test('T4 closing before SQL completes does not make a persisted state or reusable draft', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => {
    release = resolve;
  });
  const f = await fixture(async request => {
    await barrier;
    return executeT3Request(await ready, request);
  });
  const running = prepare(f);
  f.service.close();
  release();
  await assert.rejects(running, code('CLOSED'));
  assert.equal(f.store.statistics.writes, 0);
});

test('T4 full snapshot recovery never double-applies INSERT or replays included logs', async () => {
  const f = await fixture();
  await f.service.prepareSql({
    ...f.spec('insert'),
    kind: 'manual',
    batches: [
      {
        ...f.batch('insert'),
        sql: "INSERT INTO we_npc (f_name, f_identity) VALUES ('新旅人', '普通旅人');",
        parameters: [],
      },
    ],
  });
  const saved = await f.service.save(),
    archive = await f.store.read(scope);
  let calls = 0;
  const recovered = await recoverT4Snapshot(archive);
  const replayed = await replayT4Suffix(archive, 'commit-insert', async request => {
    calls++;
    return executeT3Request(await ready, request);
  });
  assert.deepEqual(recovered, saved.formal);
  assert.deepEqual(replayed, saved.formal);
  assert.equal(calls, 0);
  assert.equal(recovered.data.tables.npc.length, 2);
  assert.equal(recovered.data.tables.npc[1].meta.createdAtRevision, saved.formal.data.revision);
});

test('T4 suffix replays only logs after exact checkpoint, frozen IDs and params reproduce exact hash', async () => {
  const f = await fixture();
  await prepare(f);
  await f.service.save();
  await prepare(f, 'two', '到达营地');
  const saved = await f.service.save();
  let calls = 0;
  const restored = await replayT4Suffix(await f.store.read(scope), 'commit-one', async request => {
    calls++;
    return executeT3Request(await ready, request);
  });
  assert.deepEqual(restored, saved.formal);
  assert.equal(calls, 1);
});

test('T4 migration and user restore reuse gate, retain historical template and never call AI', async () => {
  const f = await fixture();
  await prepare(f);
  await f.service.save();
  const state = clone(f.service.view().formal);
  state.template.templateVersion++;
  state.data.templateVersion++;
  state.template.tables[1].name = '旅人档案';
  await f.service.prepareMigration({ ...f.spec('migration'), state });
  const migrated = await f.service.save();
  assert.equal(migrated.formal.template.templateVersion, 2);
  await f.service.prepareRestore({ ...f.spec('restore'), sourceCommitId: 'commit-one' });
  const restored = await f.service.save();
  assert.equal(restored.formal.template.templateVersion, 1);
  assert.equal(restored.head.seq, 3);
  assert.equal(restored.formal.data.revision, migrated.formal.data.revision + 1);
  assert.equal((await f.store.read(scope)).commits[2].sourceCommitId, 'commit-one');
  assert.deepEqual(await replayT4Suffix(await f.store.read(scope), 'commit-one', f.execute), restored.formal);
});

test('T4 no-change successful SELECT records one commit but does not touch row revision stamps', async () => {
  const f = await fixture();
  await f.service.prepareSql({
    ...f.spec('select'),
    kind: 'manual',
    batches: [{ ...f.batch('select'), sql: 'SELECT f_name FROM we_npc;', parameters: [] }],
  });
  const saved = await f.service.save(),
    archive = await f.store.read(scope);
  assert.deepEqual(saved.formal.data.tables, f.state.data.tables);
  assert.equal(saved.formal.data.revision, f.state.data.revision + 1);
  assert.deepEqual(archive.commits[0].changes, []);
});

test('T4 two ordered private macro/micro batches stamp and submit the entire run once', async () => {
  const f = await fixture();
  const macro: T4Batch = {
    sql: "UPDATE we_environment SET f_risk = 90 WHERE __we_row_id = 'small-valley-weather';",
    parameters: [],
    batchId: 'macro',
    policy: createT3LocalPolicy(f.state.template, f.state.data, 'ai', 'macro'),
  };
  const micro: T4Batch = {
    ...f.batch('micro', '避开洪水'),
    policy: createT3LocalPolicy(f.state.template, f.state.data, 'ai', 'micro'),
  };
  const prepared = await f.service.prepareSql({ ...f.spec('model'), kind: 'model', batches: [macro, micro] });
  assert.equal(prepared.commit?.steps.length, 2);
  assert.equal(prepared.state.data.revision, f.state.data.revision + 1);
  const saved = await f.service.save();
  assert.equal(saved.head.seq, 1);
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(saved.formal.data.tables.environment[0].values.risk, 90);
  assert.equal(saved.formal.data.tables.npc[0].values.goals, '避开洪水');
});

test('T4 caches reconcile both scope/head and contents, and cannot rescue corrupt authority', async () => {
  const f = await fixture();
  await prepare(f);
  const saved = await f.service.save(),
    archive = await f.store.read(scope);
  const cache = { scope, head: headT4Token(archive), state: saved.formal };
  assert.equal((await reconcileT4Cache(archive)).status, 'absent');
  assert.equal((await reconcileT4Cache(archive, cache)).status, 'match');
  const bad = clone(cache);
  bad.state.data.tables.npc[0].values.goals = '伪造同版本缓存';
  assert.equal((await reconcileT4Cache(archive, bad)).status, 'discarded');
  assert.equal((await reconcileT4Cache(archive, { ...cache, scope: copyScope })).status, 'discarded');
  const broken = clone(archive);
  broken.commits[0].snapshot.state.data.tables.npc[0].values.goals = 'broken';
  await assert.rejects(reconcileT4Cache(broken, cache));
});

test('T4 caller and gateway payload mutations cannot modify formal authority after async boundaries', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => {
    release = resolve;
  });
  const f = await fixture(async request => {
    await barrier;
    return executeT3Request(await ready, request);
  });
  const spec = { ...f.spec('one'), kind: 'manual' as const, batches: [f.batch('one')] };
  const running = f.service.prepareSql(spec);
  spec.batches[0].parameters[0] = '外部篡改';
  spec.context.promptFingerprint = 'a'.repeat(64);
  release();
  const prepared = await running;
  assert.equal(prepared.state.data.tables.npc[0].values.goals, '检查道路');
  prepared.state.data.tables.npc[0].values.goals = '返回值篡改';
  prepared.commit!.snapshot.state.data.tables.npc[0].values.goals = '返回值篡改';
  const saved = await f.service.save();
  assert.equal(saved.formal.data.tables.npc[0].values.goals, '检查道路');
  saved.formal.data.tables.npc[0].values.goals = 'view篡改';
  assert.equal((await f.store.read(scope)).commits[0].snapshot.state.data.tables.npc[0].values.goals, '检查道路');
});

test('T4 copied worlds and single-parent branches have separate heads and immutable exact prefix history', async () => {
  const f = await fixture();
  await prepare(f);
  await f.service.save();
  await prepare(f, 'two', '源世界后续行动');
  await f.service.save();
  const targetAnchor = { ...f.anchor, chatId: copyScope.chatId, messageId: 'copy-assistant' };
  f.store.registerAnchor(targetAnchor);
  await forkT4Sandbox({
    store: f.store,
    sourceScope: scope,
    targetScope: copyScope,
    throughCommitId: 'commit-one',
    kind: 'copy',
    anchorMapping: [{ source: f.anchor, target: targetAnchor }],
  });
  const copied = await f.store.read(copyScope);
  assert.equal(copied.origin.kind, 'copy');
  assert.equal(copied.origin.sourceHistory.commits.length, 1);
  assert.equal(copied.genesis.data.tables.npc[0].values.goals, '检查道路');
  const service = await createT4CommitService({ scope: copyScope, store: f.store, execute: f.execute });
  await service.prepareSql({
    ...f.spec('copied', targetAnchor),
    kind: 'manual',
    batches: [f.batch('copied', '副本行动')],
  });
  await service.save();
  assert.equal((await f.store.read(scope)).commits.length, 2);
  assert.equal((await f.store.read(copyScope)).commits.length, 1);
  f.store.selectAnchor(scope.chatId, null); // Source dependency loss is not a write to an independent copy.
  assert.equal((await recoverT4Snapshot(await f.store.read(copyScope))).data.tables.npc[0].values.goals, '副本行动');
  const branchScope = { ...scope, branchId: 'branch-one' };
  f.store.selectAnchor(scope.chatId, f.anchor);
  await forkT4Sandbox({
    store: f.store,
    sourceScope: scope,
    targetScope: branchScope,
    throughCommitId: 'commit-one',
    kind: 'branch',
    anchorMapping: [{ source: f.anchor, target: f.anchor }],
  });
  assert.equal((await f.store.read(branchScope)).genesis.data.tables.npc[0].values.goals, '检查道路');
  assert.equal((await f.store.read(branchScope)).commits.length, 0);
  assert.equal((await f.store.read(scope)).commits.length, 2);
});

test('T4 unknown copy identity, absent mapping and malformed JSON storage fail closed', async () => {
  const f = await fixture();
  await prepare(f);
  await f.service.save();
  await assert.rejects(
    forkT4Sandbox({
      store: f.store,
      sourceScope: scope,
      targetScope: copyScope,
      throughCommitId: 'commit-one',
      kind: 'copy',
      anchorMapping: [],
    }),
    code('ANCHOR'),
  );
  await assert.rejects(
    forkT4Sandbox({
      store: f.store,
      sourceScope: scope,
      targetScope: { ...copyScope, worldId: scope.worldId },
      throughCommitId: 'commit-one',
      kind: 'copy',
      anchorMapping: [],
    }),
    code('INPUT'),
  );
  assert.throws(() => createT4SandboxStore('{invalid}'));
  const fixtureJSON = JSON.parse(f.store.exportStorage());
  const key = `${scope.worldId}/${scope.branchId}`;
  const archive = JSON.parse(fixtureJSON.chats[0].archives[key]);
  archive.genesisFingerprint = 'a'.repeat(64);
  fixtureJSON.chats[0].archives[key] = JSON.stringify(archive);
  const corruptStore = createT4SandboxStore(JSON.stringify(fixtureJSON));
  await assert.rejects(createT4CommitService({ scope, store: corruptStore, execute: f.execute }));
});

test('T4 custom eighth business table also follows SQL save JSON reload and deterministic replay', async () => {
  const state = createCustomT2Fixture(),
    f = await fixture(undefined, state);
  const table = state.template.tables.find(t => t.purpose === 'custom')!;
  const text = table.fields.find(field => field.type === 'text' && !field.readonly && field.id !== 'name')!;
  const row = state.data.tables[table.id][0];
  await f.service.prepareSql({
    ...f.spec('custom'),
    kind: 'manual',
    batches: [
      {
        sql: `UPDATE ${table.sqlName} SET ${text.sqlName} = ? WHERE __we_row_id = ?;`,
        parameters: ['自定义营业变化', row.meta.id],
        batchId: 'custom',
        policy: createT3LocalPolicy(state.template, state.data),
      },
    ],
  });
  const saved = await f.service.save(),
    archive = await f.store.read(scope);
  assert.equal(saved.formal.data.tables[table.id][0].values[text.id], '自定义营业变化');
  assert.equal(await fingerprintT4(await replayT4Suffix(archive, null, f.execute)), await fingerprintT4(saved.formal));
});

test('T4 modules have no production imports or unsafe fallback and all histories remain sandbox-labelled', async () => {
  for (const name of ['t4-store.ts', 't4-service.ts']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"].*\.\.\/|indexedDB|localStorage|sessionStorage|fetch\(|getChatMessages|setChatMessages|replaceVariables|SillyTavern\./,
    );
  }
  const f = await fixture();
  assert.match(canonicalT4Json(await f.store.read(scope)), /t4-sandbox/);
});

test('T4 unified receipt drives genesis/private/saved diff and missing-anchor preview without pretending saved', async () => {
  const f = await fixture();
  const genesis = createT4PreviewModel(previewT4View(f.service.view()));
  assert.equal(genesis.valid, true);
  assert.match(genesis.badge, /尚无提交/);
  await prepare(f);
  const privateView = createT4PreviewModel(previewT4View(f.service.view()));
  assert.equal(privateView.valid, true);
  assert.equal(privateView.confirmationAllowed, true);
  assert.equal(privateView.summary.updated, 1);
  await f.service.save();
  const saved = createT4PreviewModel(previewT4View(f.service.view()));
  assert.equal(saved.valid, true);
  assert.equal(saved.summary.updated, 1);
  assert.equal(saved.confirmationAllowed, false);
  await f.service.prepareSql({ ...f.spec('no-anchor', null), kind: 'manual', batches: [f.batch('no-anchor')] });
  const draft = createT4PreviewModel(previewT4View(f.service.view()));
  assert.equal(draft.valid, true);
  assert.equal(draft.anchor, null);
  assert.equal(draft.confirmationAllowed, false);
});
