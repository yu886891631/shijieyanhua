/** Local deterministic capacity evidence only, not a live SillyTavern or production benchmark. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { createMinimalT2Fixture } from './t2-defaults';
import { cloneT2Json } from './t2-template';
import { createT3LocalPolicy, executeT3Request } from './t3-engine';
import {
  canonicalT4Json,
  createT4Archive,
  fingerprintT4,
  fingerprintT4Schema,
  fingerprintT4Template,
  normalizeT4State,
  sealT4Commit,
  stampT4State,
  T4ProtocolError,
  validateT4Archive,
  type T4Anchor,
  type T4Commit,
  type T4Context,
  type T4Scope,
  type T4State,
} from './t4-protocol';
import { createT4CommitService } from './t4-service';
import { createT4SandboxStore } from './t4-store';

const ready = initSqlJs({
  wasmBinary: Uint8Array.from(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});
const clone = <T>(input: T): T => cloneT2Json(input) as unknown as T;
const round = (milliseconds: number) => Math.round(milliseconds * 100) / 100;
function capacityState(rows: number): T4State {
  const state = createMinimalT2Fixture();
  const original = state.data.tables.npc[0];
  state.data.tables.npc = Array.from({ length: rows }, (_, index) => {
    const row = clone(original);
    row.meta.id = `npc-${String(index).padStart(4, '0')}`;
    row.values.name = `固定沙盒角色 ${index}`;
    row.values.goals = `固定目标 ${index}`;
    return row;
  });
  return normalizeT4State(state);
}
async function frozenRun(scope: T4Scope, rows: number): Promise<{ anchor: T4Anchor; context: T4Context }> {
  const inputFingerprint = await fingerprintT4({ source: 'fixed-capacity-fixture', rows });
  const context = {
    inputFingerprint,
    promptFingerprint: await fingerprintT4('fixed-prompt-no-network'),
    modelFingerprint: await fingerprintT4('mock-model-not-called'),
    parametersFingerprint: await fingerprintT4({ temperature: 0 }),
  };
  return {
    anchor: { chatId: scope.chatId, messageId: 'assistant-capacity', swipeId: 'swipe-one', inputFingerprint },
    context,
  };
}

for (const rows of [2, 50, 200]) {
  test(`T4 capacity ${rows} NPC rows: true SQLite private UPDATE saves JSON and reopens without an AI or SQL replay`, async t => {
    const SQL = await ready;
    const state = capacityState(rows);
    const scope: T4Scope = {
      mode: 't4-sandbox',
      chatId: `sandbox-capacity-${rows}`,
      worldId: state.data.worldId,
      branchId: state.data.branchId,
    };
    const run = await frozenRun(scope, rows);
    const store = createT4SandboxStore();
    store.registerAnchor(run.anchor, { unrelated: 'must survive' });
    let executeCalls = 0;
    const execute = async (request: Parameters<typeof executeT3Request>[1]) => {
      executeCalls++;
      return executeT3Request(SQL, request);
    };
    let timer = performance.now();
    await store.initialize(scope, state);
    const service = await createT4CommitService({ scope, store, execute });
    const initMs = round(performance.now() - timer);
    timer = performance.now();
    const prepared = await service.prepareSql({
      ...run,
      runId: 'run-capacity',
      commitId: 'commit-capacity',
      kind: 'manual',
      batches: [
        {
          batchId: 'batch-capacity',
          sql: "UPDATE we_npc SET f_goals = ? WHERE __we_row_id = 'npc-0000';",
          parameters: ['检查山谷道路'],
          policy: createT3LocalPolicy(state.template, state.data),
        },
      ],
    });
    const privateSqlMs = round(performance.now() - timer);
    assert.equal(store.statistics.writes, 0);
    assert.equal(prepared.state.data.tables.npc[0].values.goals, '检查山谷道路');
    timer = performance.now();
    const saved = await service.save();
    const saveReadbackMs = round(performance.now() - timer);
    assert.equal(saved.status, 'saved');
    assert.equal(store.statistics.writes, 1);
    assert.equal(executeCalls, 1);
    const expected = canonicalT4Json(saved.formal),
      storage = store.exportStorage();
    const jsonBytes = new TextEncoder().encode(storage).byteLength;
    service.close();
    timer = performance.now();
    const reopened = createT4SandboxStore(storage);
    let recoveryExecuteCalls = 0;
    const recovered = await createT4CommitService({
      scope,
      store: reopened,
      execute: async () => {
        recoveryExecuteCalls++;
        throw new Error('Recovery cannot call SQLite or a model.');
      },
    });
    const reopenRecoverMs = round(performance.now() - timer);
    assert.equal(canonicalT4Json(recovered.view().formal), expected);
    assert.equal(recovered.view().formal.data.tables.npc.length, rows);
    assert.equal(recovered.view().formal.data.tables.environment.length, 1);
    assert.equal(recoveryExecuteCalls, 0);
    assert.equal(reopened.statistics.writes, 0);
    assert.deepEqual(reopened.readOtherData(scope.chatId), { unrelated: 'must survive' });
    t.diagnostic(
      JSON.stringify({
        scope: 'local-node-real-sqlite-fake-json-store',
        npcRows: rows,
        totalRows: rows + 1,
        jsonBytes,
        initMs,
        privateSqlMs,
        saveReadbackMs,
        reopenRecoverMs,
        productionGuarantee: false,
      }),
    );
  });
}

test('T4 capacity oversized state fails closed before archive creation and cannot overwrite the existing formal head', async t => {
  const state = capacityState(2),
    store = createT4SandboxStore();
  const scope: T4Scope = {
    mode: 't4-sandbox',
    chatId: 'sandbox-capacity-limit',
    worldId: state.data.worldId,
    branchId: state.data.branchId,
  };
  const run = await frozenRun(scope, 2),
    SQL = await ready;
  store.registerAnchor(run.anchor, { unrelated: 'preserved' });
  await store.initialize(scope, state);
  const service = await createT4CommitService({
    scope,
    store,
    execute: async request => executeT3Request(SQL, request),
  });
  await service.prepareSql({
    ...run,
    runId: 'run-initial',
    commitId: 'commit-initial',
    kind: 'manual',
    batches: [
      {
        batchId: 'batch-initial',
        sql: "UPDATE we_npc SET f_goals = '正常保存' WHERE __we_row_id = 'npc-0000';",
        parameters: [],
        policy: createT3LocalPolicy(state.template, state.data),
      },
    ],
  });
  await service.save();
  const storageBefore = store.exportStorage(),
    formalBefore = canonicalT4Json(service.view().formal),
    writesBefore = store.statistics.writes;
  const huge = createMinimalT2Fixture(),
    original = huge.data.tables.npc[0];
  // Each cell remains below its own 20k text budget; the combined JSON payload exceeds 4M UTF-16 chars.
  huge.data.tables.npc = Array.from({ length: 151 }, (_, index) => {
    const row = clone(original);
    row.meta.id = `large-${index}`;
    row.values.goals = 'x'.repeat(20000);
    row.values.constraints = 'y'.repeat(20000);
    return row;
  });
  assert.ok(JSON.stringify(huge).length > 4_000_000);
  const timer = performance.now();
  await assert.rejects(
    store.initialize(scope, huge),
    (error: unknown) => error instanceof T4ProtocolError && error.code === 'INPUT',
  );
  assert.equal(store.exportStorage(), storageBefore);
  assert.equal(store.statistics.writes, writesBefore);
  assert.equal(canonicalT4Json(service.view().formal), formalBefore);
  t.diagnostic(
    JSON.stringify({
      scope: 'local-only-size-rejection',
      npcRows: 151,
      inputCharacters: JSON.stringify(huge).length,
      rejectMs: round(performance.now() - timer),
      newWrites: store.statistics.writes - writesBefore,
      productionGuarantee: false,
    }),
  );
});

test('T4 capacity valid 32-commit history fits the declared count budget, while commit 33 is rejected without changing its prefix', async t => {
  const state = capacityState(2),
    scope: T4Scope = {
      mode: 't4-sandbox',
      chatId: 'sandbox-history-capacity',
      worldId: state.data.worldId,
      branchId: state.data.branchId,
    };
  const run = await frozenRun(scope, 2),
    archive = await createT4Archive(scope, state);
  let base = state;
  async function noopCommit(seq: number): Promise<T4Commit> {
    const after = stampT4State(base, base),
      beforeHash = await fingerprintT4(base),
      afterHash = await fingerprintT4(after);
    const commitId = `history-${seq}`;
    return sealT4Commit({
      format: 'world-evolution-commit',
      version: 1,
      scope,
      runId: `history-run-${seq}`,
      commitId,
      parentCommitId: archive.commits.at(-1)?.commitId ?? null,
      seq,
      baseRevision: base.data.revision,
      kind: 'manual',
      sourceCommitId: null,
      ...run,
      beforeStateFingerprint: beforeHash,
      afterStateFingerprint: afterHash,
      templateFingerprint: await fingerprintT4Template(after.template),
      schemaFingerprint: await fingerprintT4Schema(after.template),
      steps: [
        {
          batchId: `history-batch-${seq}`,
          sql: 'SELECT f_goals FROM we_npc;',
          parameters: [],
          policy: createT3LocalPolicy(base.template, base.data),
          beforeFingerprint: beforeHash,
          afterFingerprint: beforeHash,
        },
      ],
      changes: [],
      snapshot: {
        throughCommitId: commitId,
        throughSeq: seq,
        beforeFingerprint: beforeHash,
        afterFingerprint: afterHash,
        state: after,
      },
    });
  }
  const timer = performance.now();
  for (let seq = 1; seq <= 32; seq++) {
    const commit = await noopCommit(seq);
    archive.commits.push(commit);
    base = commit.snapshot.state;
  }
  await validateT4Archive(archive);
  const validPrefix = canonicalT4Json(archive),
    rejected = { ...archive, commits: [...archive.commits, await noopCommit(33)] };
  await assert.rejects(
    validateT4Archive(rejected),
    (error: unknown) => error instanceof T4ProtocolError && error.code === 'INPUT',
  );
  assert.equal(canonicalT4Json(archive), validPrefix);
  t.diagnostic(
    JSON.stringify({
      scope: 'local-pure-protocol-history-budget',
      commits: archive.commits.length,
      jsonBytes: new TextEncoder().encode(JSON.stringify(archive)).byteLength,
      validateAndPrepareMs: round(performance.now() - timer),
      productionGuarantee: false,
    }),
  );
});
