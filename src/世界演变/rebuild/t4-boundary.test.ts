import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { createMinimalT2Fixture } from './t2-defaults';
import { cloneT2Json } from './t2-template';
import { createT3LocalPolicy, executeT3Request } from './t3-engine';
import { T3RuntimeError } from './t3-runtime';
import {
  diffT4States,
  fingerprintT4,
  fingerprintT4Schema,
  fingerprintT4Template,
  sealT4Commit,
  stampT4State,
  T4ProtocolError,
  validateT4Archive,
  type T4Commit,
  type T4State,
} from './t4-protocol';
import { createT4CommitService, T4ServiceError, type T4Batch, type T4Executor, type T4RunSpec } from './t4-service';
import { createT4SandboxStore, headT4Token, T4StoreError } from './t4-store';

const sqlReady = initSqlJs({
  wasmBinary: Uint8Array.from(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});
const copy = <T>(value: T): T => cloneT2Json(value) as unknown as T;
const hash = 'a'.repeat(64);
const context = {
  inputFingerprint: hash,
  promptFingerprint: 'b'.repeat(64),
  modelFingerprint: 'c'.repeat(64),
  parametersFingerprint: 'd'.repeat(64),
};

async function fixture(executeOverride?: T4Executor) {
  const state = createMinimalT2Fixture();
  const scope = {
    mode: 't4-sandbox' as const,
    chatId: 'sandbox-boundary',
    worldId: state.data.worldId,
    branchId: state.data.branchId,
  };
  const anchor = { chatId: scope.chatId, messageId: 'assistant-one', swipeId: 'swipe-one', inputFingerprint: hash };
  const store = createT4SandboxStore();
  await store.initialize(scope, state);
  store.registerAnchor(anchor, { anotherPlugin: { value: 'preserve me' } });
  const execute: T4Executor = executeOverride ?? (async request => executeT3Request(await sqlReady, request));
  const service = await createT4CommitService({ scope, store, execute });
  const spec = (suffix = 'one'): T4RunSpec => ({
    runId: `run-${suffix}`,
    commitId: `commit-${suffix}`,
    anchor,
    context,
  });
  const batch = (value = '到达山谷营地', batchId = 'boundary-one'): T4Batch => ({
    sql: 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?;',
    parameters: [value, 'traveler'],
    batchId,
    policy: createT3LocalPolicy(service.view().formal.template, service.view().formal.data),
  });
  return { state, scope, anchor, store, execute, service, spec, batch };
}

async function reseal(commit: T4Commit): Promise<T4Commit> {
  const { fingerprint: _fingerprint, ...unsigned } = commit;
  return sealT4Commit(unsigned);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

test('T4 failed new SQL preparation invalidates a previously prepared payload before save', async () => {
  for (const failure of ['identity', 'execution'] as const) {
    const setup = await fixture();
    await setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] });
    const before = setup.store.exportStorage();
    const bad = {
      ...setup.spec('two'),
      kind: 'manual' as const,
      batches: [setup.batch('never saved', 'boundary-two')],
    };
    if (failure === 'identity') bad.runId = 'INVALID identity';
    else bad.batches[0].sql = 'DROP TABLE we_npc;';
    await assert.rejects(setup.service.prepareSql(bad));
    assert.equal(setup.service.view().draft, null, 'A failed new attempt must not expose the prior draft as saveable.');
    await assert.rejects(setup.service.save());
    assert.equal(setup.store.exportStorage(), before);
    assert.equal(setup.store.statistics.writes, 0);
  }
});

test('T4 failed migration or restore cannot accidentally save an earlier SQL draft', async () => {
  for (const failure of ['migration', 'restore'] as const) {
    const setup = await fixture();
    await setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] });
    const before = setup.store.exportStorage();
    if (failure === 'migration')
      await assert.rejects(setup.service.prepareMigration({ ...setup.spec('two'), state: copy(setup.state) }));
    else
      await assert.rejects(setup.service.prepareRestore({ ...setup.spec('two'), sourceCommitId: 'not-a-real-commit' }));
    assert.equal(setup.service.view().draft, null);
    await assert.rejects(setup.service.save());
    assert.equal(setup.store.exportStorage(), before);
    assert.equal(setup.store.statistics.writes, 0);
  }
});

test('T4 imported archive rejects two distinct commits carrying the same run identity', async () => {
  const setup = await fixture();
  await setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] });
  await setup.service.save();
  await setup.service.prepareSql({
    ...setup.spec('two'),
    kind: 'manual',
    batches: [setup.batch('再次巡查', 'boundary-two')],
  });
  await setup.service.save();
  const archive = await setup.store.read(setup.scope);
  archive.commits[1].runId = archive.commits[0].runId;
  archive.commits[1] = await reseal(archive.commits[1]);
  await assert.rejects(validateT4Archive(archive), error => error instanceof T4ProtocolError && error.code === 'CHAIN');
});

test('T4 direct archive gateway rejects a newly sealed template downgrade before writing', async () => {
  const setup = await fixture();
  const nextTemplate = copy(setup.state);
  nextTemplate.template.templateVersion = 2;
  nextTemplate.data.templateVersion = 2;
  await setup.service.prepareMigration({ ...setup.spec(), state: nextTemplate });
  await setup.service.save();
  const archive = await setup.store.read(setup.scope);
  const base = setup.service.view().formal;
  const downgraded = copy(base);
  downgraded.template.templateVersion = 1;
  downgraded.data.templateVersion = 1;
  const after = stampT4State(base, downgraded);
  const beforeFingerprint = await fingerprintT4(base);
  const afterFingerprint = await fingerprintT4(after);
  const commit = await sealT4Commit({
    format: 'world-evolution-commit',
    version: 1,
    scope: setup.scope,
    ...setup.spec('downgrade'),
    anchor: setup.anchor,
    parentCommitId: archive.commits[0].commitId,
    seq: 2,
    baseRevision: base.data.revision,
    kind: 'migration',
    sourceCommitId: null,
    beforeStateFingerprint: beforeFingerprint,
    afterStateFingerprint: afterFingerprint,
    templateFingerprint: await fingerprintT4Template(after.template),
    schemaFingerprint: await fingerprintT4Schema(after.template),
    steps: [],
    changes: diffT4States(base, after),
    snapshot: {
      throughCommitId: 'commit-downgrade',
      throughSeq: 2,
      beforeFingerprint,
      afterFingerprint,
      state: after,
    },
  });
  const before = setup.store.exportStorage();
  await assert.rejects(
    setup.store.compareAndSwap({ scope: setup.scope, expected: headT4Token(archive), commit }),
    error => error instanceof T4ProtocolError && error.code === 'CHAIN',
  );
  assert.equal(setup.store.exportStorage(), before);
  assert.equal(setup.store.statistics.writes, 1);
});

test('T4 caller option mutation cannot replace the cancellation capability of an in-flight preparation', async () => {
  const reached = deferred();
  const resume = deferred();
  const original = new AbortController();
  const replacement = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const setup = await fixture(async (request, options) => {
    observedSignal = options?.signal;
    reached.resolve();
    await resume.promise;
    return executeT3Request(await sqlReady, request);
  });
  const options = { signal: original.signal };
  const preparing = setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] }, options);
  options.signal = replacement.signal;
  await reached.promise;
  original.abort();
  resume.resolve();
  await assert.rejects(preparing, error => error instanceof T4ServiceError && error.code === 'ABORTED');
  assert.equal(observedSignal, original.signal);
  assert.equal(setup.service.view().draft, null);
  assert.equal(setup.store.statistics.writes, 0);
});

test('T4 cancellation during commit sealing cannot leave a draft that reconciliation revives', async () => {
  const setup = await fixture();
  const controller = new AbortController();
  const subtle = globalThis.crypto.subtle;
  const originalDescriptor = Object.getOwnPropertyDescriptor(subtle, 'digest');
  const digest = subtle.digest.bind(subtle);
  let sealed = false;
  Object.defineProperty(subtle, 'digest', {
    configurable: true,
    value: async (algorithm: AlgorithmIdentifier, bytes: BufferSource): Promise<ArrayBuffer> => {
      const view = ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
      const content = JSON.parse(new TextDecoder().decode(view));
      if (content && typeof content === 'object' && content.format === 'world-evolution-commit') {
        sealed = true;
        controller.abort();
      }
      return digest(algorithm, bytes);
    },
  });
  try {
    await assert.rejects(
      setup.service.prepareSql(
        { ...setup.spec(), kind: 'manual', batches: [setup.batch()] },
        { signal: controller.signal },
      ),
      error => error instanceof T4ServiceError && error.code === 'ABORTED',
    );
    assert.equal(sealed, true, 'This specifically cancels after SQL execution, while the commit is being sealed.');
    assert.equal(setup.service.view().draft === null, true, 'Cancelled sealing must invalidate its draft.');
    await setup.service.reconcile();
    assert.equal(setup.service.view().draft === null, true, 'Reconciliation must not revive the cancelled run.');
    await assert.rejects(setup.service.save());
    assert.equal(setup.store.statistics.writes, 0);
  } finally {
    if (originalDescriptor) Object.defineProperty(subtle, 'digest', originalDescriptor);
    else Reflect.deleteProperty(subtle, 'digest');
  }
});

test('T4 actual Worker abort error is reported as cancellation and never installs a draft', async () => {
  const controller = new AbortController();
  const setup = await fixture(async () => {
    controller.abort();
    throw new T3RuntimeError('ABORTED', 'Worker terminated by cancellation.');
  });
  await assert.rejects(
    setup.service.prepareSql(
      { ...setup.spec(), kind: 'manual', batches: [setup.batch()] },
      { signal: controller.signal },
    ),
    error => error instanceof T4ServiceError && error.code === 'ABORTED',
  );
  assert.equal(setup.service.view().status, 'cancelled');
  assert.equal(setup.service.view().draft, null);
  assert.equal(setup.store.statistics.writes, 0);
});

test('T4 reopening a saved archive rejects reused run or commit identities before any SQL execution', async () => {
  const setup = await fixture();
  await setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] });
  await setup.service.save();
  let calls = 0;
  const reopened = await createT4CommitService({
    scope: setup.scope,
    store: setup.store,
    execute: async request => {
      calls++;
      return executeT3Request(await sqlReady, request);
    },
  });
  const before = setup.store.exportStorage();
  for (const identity of ['run', 'commit'] as const) {
    const spec = { ...setup.spec('two') };
    if (identity === 'run') spec.runId = setup.spec().runId;
    else spec.commitId = setup.spec().commitId;
    await assert.rejects(
      reopened.prepareSql({ ...spec, kind: 'manual', batches: [setup.batch('must not execute', 'reuse-boundary')] }),
      error => error instanceof T4ServiceError && error.code === 'CONFLICT',
    );
    assert.equal(reopened.view().draft, null);
  }
  assert.equal(calls, 0);
  assert.equal(setup.store.exportStorage(), before);
});

test('T4 inherited history without mappings for its assistant dependencies is not a valid copy archive', async () => {
  const setup = await fixture();
  await setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] });
  await setup.service.save();
  const source = await setup.store.read(setup.scope);
  const targetScope = {
    ...setup.scope,
    chatId: 'sandbox-copy-boundary',
    worldId: 'copy-world',
    branchId: 'copy-branch',
  };
  const state: T4State = copy(source.commits[0].snapshot.state);
  state.data.worldId = targetScope.worldId;
  state.data.branchId = targetScope.branchId;
  const before = setup.store.exportStorage();
  await assert.rejects(
    setup.store.initialize(targetScope, state, {
      kind: 'copy',
      sourceScope: setup.scope,
      sourceCommitId: source.commits[0].commitId,
      sourceSeq: 1,
      sourceStateFingerprint: source.commits[0].afterStateFingerprint,
      anchorMapping: [],
      sourceHistory: source,
    }),
    error => error instanceof T4ProtocolError,
  );
  assert.equal(setup.store.exportStorage(), before);
});

test('T4 failed copy initialization does not create a partial target fixture before anchor checks', async () => {
  const setup = await fixture();
  await setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] });
  await setup.service.save();
  const source = await setup.store.read(setup.scope);
  const targetScope = {
    ...setup.scope,
    chatId: 'sandbox-unregistered-copy',
    worldId: 'copy-world',
    branchId: 'copy-branch',
  };
  const state: T4State = copy(source.commits[0].snapshot.state);
  state.data.worldId = targetScope.worldId;
  state.data.branchId = targetScope.branchId;
  const before = setup.store.exportStorage();
  await assert.rejects(
    setup.store.initialize(targetScope, state, {
      kind: 'copy',
      sourceScope: setup.scope,
      sourceCommitId: source.commits[0].commitId,
      sourceSeq: 1,
      sourceStateFingerprint: source.commits[0].afterStateFingerprint,
      anchorMapping: [{ source: setup.anchor, target: { ...setup.anchor, chatId: targetScope.chatId } }],
      sourceHistory: source,
    }),
    error => error instanceof T4StoreError,
  );
  assert.equal(
    setup.store.exportStorage() === before,
    true,
    'A failed initialization must leave no partial chat fixture.',
  );
});

test('T4 write barrier snapshots payload before awaits and preserves unrelated simulated chat data', async () => {
  const setup = await fixture();
  const prepared = await setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] });
  assert.ok(prepared.commit);
  const expectedGoal = prepared.state.data.tables.npc[0].values.goals;
  const save = setup.store.compareAndSwap({ scope: setup.scope, expected: prepared.base, commit: prepared.commit });
  prepared.commit.snapshot.state.data.tables.npc[0].values.goals = 'changed caller object after save started';
  prepared.commit.steps[0].parameters[0] = 'another mutation';
  await save;
  const saved = await setup.store.read(setup.scope);
  assert.equal(saved.commits[0].snapshot.state.data.tables.npc[0].values.goals, expectedGoal);
  assert.deepEqual(setup.store.readOtherData(setup.scope.chatId), { anotherPlugin: { value: 'preserve me' } });
});

test('T4 stale-anchor and cancelled direct writes stop at the atomic barrier with zero overwrite', async () => {
  for (const failure of ['anchor', 'cancel'] as const) {
    const setup = await fixture();
    const prepared = await setup.service.prepareSql({ ...setup.spec(), kind: 'manual', batches: [setup.batch()] });
    assert.ok(prepared.commit);
    const controller = new AbortController();
    const save = setup.store.compareAndSwap({
      scope: setup.scope,
      expected: prepared.base,
      commit: prepared.commit,
      signal: controller.signal,
    });
    if (failure === 'anchor') setup.store.selectAnchor(setup.scope.chatId, null);
    else controller.abort();
    const before = setup.store.exportStorage();
    await assert.rejects(
      save,
      error => error instanceof T4StoreError && error.code === (failure === 'anchor' ? 'ANCHOR' : 'ABORTED'),
    );
    assert.equal(setup.store.exportStorage(), before);
    assert.equal(setup.store.statistics.writes, 0);
    assert.equal(setup.service.view().formal.data.revision, setup.state.data.revision);
  }
});
