import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createMinimalT2Fixture } from './t2-defaults';
import { cloneT2Json, type T2Json } from './t2-template';
import { prepareT2NewRow } from './t2-values';
import { createT3LocalPolicy } from './t3-engine';
import {
  canonicalT4Json,
  createT4Archive,
  diffT4States,
  fingerprintT4,
  fingerprintT4Schema,
  fingerprintT4Template,
  normalizeT4Anchor,
  normalizeT4Context,
  normalizeT4Origin,
  normalizeT4Scope,
  normalizeT4State,
  normalizeT4Step,
  sealT4Commit,
  stampT4State,
  T4ProtocolError,
  validateT4Archive,
  validateT4Commit,
  type T4Archive,
  type T4Commit,
  type T4Context,
  type T4Scope,
  type T4State,
} from './t4-protocol';

const copy = <T>(value: T): T => cloneT2Json(value) as unknown as T;
function fixture(): { scope: T4Scope; state: T4State } {
  const state = createMinimalT2Fixture();
  return {
    state,
    scope: {
      mode: 't4-sandbox',
      chatId: 'sandbox-protocol',
      worldId: state.data.worldId,
      branchId: state.data.branchId,
    },
  };
}
async function context(): Promise<T4Context> {
  return {
    inputFingerprint: await fingerprintT4('story'),
    promptFingerprint: await fingerprintT4('prompt'),
    modelFingerprint: await fingerprintT4('mock-model'),
    parametersFingerprint: await fingerprintT4({ temperature: 0 }),
  };
}
async function makeCommit(
  base: T4State,
  scope: T4Scope,
  options: {
    seq?: number;
    parent?: string | null;
    kind?: T4Commit['kind'];
    sourceCommitId?: string | null;
    draft?: T4State;
    noop?: boolean;
  } = {},
): Promise<T4Commit> {
  const seq = options.seq ?? 1,
    kind = options.kind ?? 'manual';
  const draft = options.draft ? normalizeT4State(options.draft) : normalizeT4State(base);
  if (!options.draft && !options.noop) draft.data.tables.npc[0].values.goals = `巡查任务-${seq}`;
  const after = stampT4State(base, draft),
    commitId = `commit-${seq}`,
    frozenContext = await context();
  const beforeHash = await fingerprintT4(base),
    afterHash = await fingerprintT4(after);
  return sealT4Commit({
    format: 'world-evolution-commit',
    version: 1,
    scope,
    runId: `run-${seq}`,
    commitId,
    parentCommitId: options.parent ?? null,
    seq,
    baseRevision: base.data.revision,
    kind,
    sourceCommitId: options.sourceCommitId ?? null,
    anchor: {
      chatId: scope.chatId,
      messageId: 'assistant-one',
      swipeId: 'swipe-one',
      inputFingerprint: frozenContext.inputFingerprint,
    },
    context: frozenContext,
    beforeStateFingerprint: beforeHash,
    afterStateFingerprint: afterHash,
    templateFingerprint: await fingerprintT4Template(after.template),
    schemaFingerprint: await fingerprintT4Schema(after.template),
    steps:
      kind === 'manual' || kind === 'model'
        ? [
            {
              batchId: `batch-${seq}`,
              sql: options.noop
                ? 'SELECT f_goals FROM we_npc;'
                : 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?;',
              parameters: options.noop
                ? []
                : [draft.data.tables.npc[0].values.goals as T2Json, draft.data.tables.npc[0].meta.id],
              policy: createT3LocalPolicy(
                base.template,
                base.data,
                kind === 'model' ? 'ai' : 'manual',
                kind === 'model' ? 'micro' : null,
              ),
              beforeFingerprint: beforeHash,
              afterFingerprint: await fingerprintT4(draft),
            },
          ]
        : [],
    changes: diffT4States(base, after),
    snapshot: {
      throughCommitId: commitId,
      throughSeq: seq,
      beforeFingerprint: beforeHash,
      afterFingerprint: afterHash,
      state: after,
    },
  });
}
async function reseal(commit: T4Commit): Promise<T4Commit> {
  const { fingerprint: _fingerprint, ...unsigned } = commit;
  return sealT4Commit(unsigned);
}
async function archiveTwo(): Promise<T4Archive> {
  const { state, scope } = fixture(),
    archive = await createT4Archive(scope, state);
  const first = await makeCommit(state, scope),
    second = await makeCommit(first.snapshot.state, scope, { seq: 2, parent: first.commitId });
  archive.commits = [first, second];
  return archive;
}
function rejectsCode(code: T4ProtocolError['code']) {
  return (error: unknown) => error instanceof T4ProtocolError && error.code === code;
}

test('T4 canonical JSON and SHA-256 ignore object key insertion order while preserving arrays and missing/null', async () => {
  const first = { z: ['a', 'b'], a: { n: null } },
    second = { a: { n: null }, z: ['a', 'b'] };
  assert.equal(canonicalT4Json(first), '{"a":{"n":null},"z":["a","b"]}');
  assert.equal(await fingerprintT4(first), await fingerprintT4(second));
  assert.equal(await fingerprintT4(first), createHash('sha256').update(canonicalT4Json(first)).digest('hex'));
  assert.notEqual(await fingerprintT4(['a', 'b']), await fingerprintT4(['b', 'a']));
  assert.notEqual(await fingerprintT4({}), await fingerprintT4({ optional: null }));
  assert.notEqual(await fingerprintT4('\ud800'), await fingerprintT4('\ufffd'));
});

test('T4 canonical JSON never invokes accessors/toJSON and rejects cycles, prototypes, symbols and negative zero', () => {
  let called = 0;
  const getter = Object.defineProperty({}, 'value', {
    enumerable: true,
    get: () => {
      called++;
      return 'secret';
    },
  });
  for (const input of [
    getter,
    {
      toJSON() {
        called++;
        return {};
      },
    },
    new Date(),
    { value: undefined },
    -0,
    NaN,
    1n,
    { [Symbol('x')]: 1 },
  ]) {
    assert.throws(() => canonicalT4Json(input), rejectsCode('INPUT'));
  }
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalT4Json(cyclic), rejectsCode('INPUT'));
  assert.equal(called, 0);
});

test('T4 protocol refuses oversized and non-dense JSON before hashing or importing', () => {
  assert.throws(() => canonicalT4Json({ value: 'x'.repeat(1000001) }), rejectsCode('INPUT'));
  assert.throws(() => canonicalT4Json(new Array(2)), rejectsCode('INPUT'));
  assert.throws(() => canonicalT4Json(JSON.parse('{"__proto__":{}}')), rejectsCode('INPUT'));
});

test('T4 scope and anchor identities separate sandbox chat, world, branch, message and swipe', async () => {
  const { scope } = fixture();
  assert.deepEqual(normalizeT4Scope(scope), scope);
  assert.throws(() => normalizeT4Scope({ ...scope, chatId: 'real-chat' }), rejectsCode('INPUT'));
  assert.throws(() => normalizeT4Scope({ ...scope, messageId: 'message' }), rejectsCode('INPUT'));
  const anchor = {
    chatId: scope.chatId,
    messageId: 'assistant-one',
    swipeId: 'swipe-one',
    inputFingerprint: await fingerprintT4('story'),
  };
  assert.deepEqual(normalizeT4Anchor(anchor), anchor);
  assert.throws(() => normalizeT4Anchor({ ...anchor, swipeId: 0 }), rejectsCode('INPUT'));
  assert.throws(
    () => normalizeT4Anchor({ ...anchor, inputFingerprint: anchor.inputFingerprint.toUpperCase() }),
    rejectsCode('INPUT'),
  );
});

test('T4 context persists hashes only; credentials and unknown settings are rejected', async () => {
  const value = await context();
  assert.deepEqual(normalizeT4Context(value), value);
  assert.throws(() => normalizeT4Context({ ...value, apiKey: 'never-store-key' }), rejectsCode('INPUT'));
  assert.throws(() => normalizeT4Context({ ...value, modelFingerprint: 'model-name' }), rejectsCode('INPUT'));
});

test('T4 state normalization returns independent objects and rejects unknown or mismatched template data', () => {
  const { state } = fixture(),
    normalized = normalizeT4State(state);
  normalized.data.tables.npc[0].values.goals = 'only clone';
  assert.notEqual(state.data.tables.npc[0].values.goals, 'only clone');
  assert.throws(() => normalizeT4State({ ...state, cache: {} }), rejectsCode('INPUT'));
  const bad = copy(state);
  bad.data.templateVersion++;
  assert.throws(() => normalizeT4State(bad), rejectsCode('INPUT'));
});

test('T4 whole commit stamps only changed/new rows once, preserves creation metadata and does not mutate drafts', () => {
  const { state } = fixture(),
    draft = normalizeT4State(state);
  draft.data.tables.npc[0].values.goals = 'patrol';
  draft.data.tables.npc.push(
    prepareT2NewRow(draft.template, 'npc', 'new-user', { name: '新角色' }, { revision: state.data.revision }),
  );
  const frozen = canonicalT4Json(draft),
    stamped = stampT4State(state, draft);
  assert.equal(stamped.data.revision, state.data.revision + 1);
  assert.equal(stamped.data.tables.npc[0].meta.createdAtRevision, state.data.tables.npc[0].meta.createdAtRevision);
  assert.equal(stamped.data.tables.npc[0].meta.updatedAtRevision, stamped.data.revision);
  assert.equal(stamped.data.tables.npc[1].meta.createdAtRevision, stamped.data.revision);
  assert.equal(stamped.data.tables.npc[1].meta.updatedAtRevision, stamped.data.revision);
  assert.deepEqual(stamped.data.tables.environment[0].meta, state.data.tables.environment[0].meta);
  assert.equal(canonicalT4Json(draft), frozen);
});

test('T4 successful no-change submission advances revision without changing row stamps', () => {
  const { state } = fixture(),
    after = stampT4State(state, state);
  assert.equal(after.data.revision, state.data.revision + 1);
  assert.deepEqual(after.data.tables, state.data.tables);
  assert.deepEqual(diffT4States(state, after), []);
});

test('T4 stamping refuses cross-world drafts, stale revisions and dangling references', () => {
  const { state } = fixture(),
    draft = copy(state);
  draft.data.worldId = 'other-world';
  assert.throws(() => stampT4State(state, draft), rejectsCode('SCOPE'));
  draft.data.worldId = state.data.worldId;
  draft.data.revision++;
  assert.throws(() => stampT4State(state, draft), rejectsCode('CHAIN'));
  const bad = copy(state);
  bad.data.tables.npc[0].values.unknown = 'not-a-field';
  assert.throws(() => stampT4State(state, bad), rejectsCode('INPUT'));
});

test('T4 change list uses sorted stable identities and detects metadata edits, insertions and deletions', () => {
  const { state } = fixture(),
    draft = copy(state);
  draft.data.tables.environment = [];
  draft.data.tables.npc[0].meta.archived = true;
  draft.data.tables.npc.push(
    prepareT2NewRow(draft.template, 'npc', 'second-person', { name: '同名' }, { revision: state.data.revision }),
  );
  assert.deepEqual(diffT4States(state, draft), [
    { tableId: 'environment', rowId: state.data.tables.environment[0].meta.id, kind: 'delete' },
    { tableId: 'npc', rowId: 'second-person', kind: 'insert' },
    { tableId: 'npc', rowId: state.data.tables.npc[0].meta.id, kind: 'update' },
  ]);
});

test('T4 schema fingerprint excludes display labels but includes physical constraints separately template fingerprint', async () => {
  const { state } = fixture(),
    label = copy(state.template);
  label.name = 'display change';
  label.tables[0].fields[0].name = 'new label';
  label.tables[0].fields[0].hiddenUi = true;
  assert.equal(await fingerprintT4Schema(label), await fingerprintT4Schema(state.template));
  assert.notEqual(await fingerprintT4Template(label), await fingerprintT4Template(state.template));
  const schema = copy(state.template);
  schema.tables[0].fields[0].constraints.maxLength = 101;
  assert.notEqual(await fingerprintT4Schema(schema), await fingerprintT4Schema(state.template));
});

test('T4 fixed SQL logs check parameters, policy shape, declared mappings and reject arbitrary SQL', async () => {
  const { state, scope } = fixture(),
    step = (await makeCommit(state, scope)).steps[0];
  assert.deepEqual(normalizeT4Step(step, state.template), step);
  for (const bad of [
    { ...step, sql: 'DROP TABLE we_npc;' },
    { ...step, parameters: [] },
    { ...step, sql: 'UPDATE we_npc SET __we_locked = 0 WHERE __we_row_id = ?;', parameters: ['lin-watch'] },
    { ...step, sql: 'SELECT f_name FROM we_unknown;', parameters: [] },
    { ...step, policy: { ...step.policy, stage: 'macro' } },
    { ...step, policy: { ...step.policy, insertTableIds: ['npc', 'npc'] } },
  ])
    assert.throws(() => normalizeT4Step(bad, state.template), rejectsCode('INPUT'));
});

test('T4 sealed SQL commit validates snapshot cutoff, fixed private SQL draft and formal row stamps', async () => {
  const { state, scope } = fixture(),
    commit = await makeCommit(state, scope);
  assert.deepEqual(await validateT4Commit(commit, state, scope, null, 1), commit);
  assert.notEqual(commit.steps[0].afterFingerprint, commit.afterStateFingerprint);
  assert.equal(commit.snapshot.throughCommitId, commit.commitId);
  assert.equal(commit.snapshot.state.data.revision, 2);
});

test('T4 sealing freezes caller content before async hashing', async () => {
  const { state, scope } = fixture(),
    original = await makeCommit(state, scope);
  const { fingerprint: _fingerprint, ...input } = copy(original);
  const sealedPromise = sealT4Commit(input);
  input.snapshot.state.data.tables.npc[0].values.goals = 'mutated-after-seal';
  const sealed = await sealedPromise;
  assert.notEqual(sealed.snapshot.state.data.tables.npc[0].values.goals, 'mutated-after-seal');
  await validateT4Commit(sealed, state, scope, null, 1);
});

test('T4 corruption is rejected even before any checkpoint state is adopted', async () => {
  const { state, scope } = fixture(),
    commit = await makeCommit(state, scope);
  commit.snapshot.state.data.tables.npc[0].values.goals = 'corruption';
  await assert.rejects(validateT4Commit(commit, state, scope, null, 1), rejectsCode('INTEGRITY'));
});

test('T4 rehashed wrong change list, before/after hashes and schema hash do not bypass semantic checks', async () => {
  const { state, scope } = fixture(),
    good = await makeCommit(state, scope);
  for (const edit of [
    (value: T4Commit) => {
      value.changes = [];
    },
    (value: T4Commit) => {
      value.beforeStateFingerprint = '0'.repeat(64);
    },
    (value: T4Commit) => {
      value.afterStateFingerprint = '0'.repeat(64);
    },
    (value: T4Commit) => {
      value.schemaFingerprint = '0'.repeat(64);
    },
    (value: T4Commit) => {
      value.steps[0].afterFingerprint = '0'.repeat(64);
    },
  ]) {
    const bad = copy(good);
    edit(bad);
    await assert.rejects(validateT4Commit(await reseal(bad), state, scope, null, 1), rejectsCode('INTEGRITY'));
  }
});

test('T4 cutoff, parent, baseline revision, actor and chain discontinuity reject rehashed payloads', async () => {
  const { state, scope } = fixture(),
    good = await makeCommit(state, scope);
  for (const edit of [
    (value: T4Commit) => {
      value.snapshot.throughSeq = 2;
    },
    (value: T4Commit) => {
      value.parentCommitId = 'missing-parent';
    },
    (value: T4Commit) => {
      value.baseRevision = 0;
    },
    (value: T4Commit) => {
      value.steps[0].beforeFingerprint = '0'.repeat(64);
    },
    (value: T4Commit) => {
      value.steps[0].policy.actor = 'ai';
      value.steps[0].policy.stage = 'micro';
    },
  ]) {
    const bad = copy(good);
    edit(bad);
    await assert.rejects(validateT4Commit(await reseal(bad), state, scope, null, 1), rejectsCode('CHAIN'));
  }
});

test('T4 malformed foreign-message or changed-input anchors reject even a newly sealed commit', async () => {
  const { state, scope } = fixture(),
    good = await makeCommit(state, scope);
  const foreign = copy(good);
  foreign.anchor.chatId = 'sandbox-another';
  await assert.rejects(validateT4Commit(await reseal(foreign), state, scope, null, 1), rejectsCode('SCOPE'));
  const changed = copy(good);
  changed.anchor.inputFingerprint = await fingerprintT4('changed story');
  await assert.rejects(validateT4Commit(await reseal(changed), state, scope, null, 1), rejectsCode('SCOPE'));
});

test('T4 SELECT-only no-op commit is valid and does not manufacture row edits', async () => {
  const { state, scope } = fixture(),
    commit = await makeCommit(state, scope, { noop: true });
  await validateT4Commit(commit, state, scope, null, 1);
  assert.deepEqual(commit.changes, []);
  assert.deepEqual(commit.snapshot.state.data.tables, state.data.tables);
});

test('T4 successful multi-commit archive can use the same message anchor and restores exactly the last checkpoint', async () => {
  const archive = await archiveTwo(),
    expected = canonicalT4Json(archive.commits[1].snapshot.state);
  const recovered = await validateT4Archive(JSON.parse(JSON.stringify(archive)));
  assert.equal(canonicalT4Json(recovered.commits.at(-1)?.snapshot.state), expected);
  assert.deepEqual(recovered.commits[0].anchor, recovered.commits[1].anchor);
});

test('T4 current mutable template is not used while validating historical full snapshots', async () => {
  const archive = await archiveTwo(),
    independent = fixture().state;
  independent.template.tables[0].fields[0].name = 'changed current settings';
  independent.template.templateVersion++;
  const recovered = await validateT4Archive(archive);
  assert.equal(recovered.genesis.template.templateVersion, 1);
  assert.notEqual(recovered.genesis.template.tables[0].fields[0].name, 'changed current settings');
});

test('T4 archive validation refuses missing/reordered commits, duplicate identities and oversized history', async () => {
  const archive = await archiveTwo();
  const missing = copy(archive);
  missing.commits.shift();
  await assert.rejects(validateT4Archive(missing), rejectsCode('CHAIN'));
  const reversed = copy(archive);
  reversed.commits.reverse();
  await assert.rejects(validateT4Archive(reversed), rejectsCode('CHAIN'));
  const duplicate = copy(archive);
  duplicate.commits[1].commitId = duplicate.commits[0].commitId;
  await assert.rejects(validateT4Archive(duplicate), rejectsCode('CHAIN'));
  const over = copy(archive);
  over.commits = Array.from({ length: 33 }, () => archive.commits[0]);
  await assert.rejects(validateT4Archive(over), rejectsCode('INPUT'));
});

test('T4 archive genesis integrity and unknown imported fields are checked before recovery', async () => {
  const { scope, state } = fixture(),
    archive = await createT4Archive(scope, state);
  archive.genesis.data.tables.npc[0].values.goals = 'changed genesis';
  await assert.rejects(validateT4Archive(archive), rejectsCode('INTEGRITY'));
  await assert.rejects(
    validateT4Archive({ ...(await createT4Archive(scope, state)), secret: 'key' }),
    rejectsCode('INPUT'),
  );
});

test('T4 independent-copy and single-parent branch origins require separate mutable identity and validated anchor mapping', async () => {
  const { scope, state } = fixture(),
    sourceHash = await fingerprintT4(state),
    inputHash = await fingerprintT4('story');
  const target = { ...scope, chatId: 'sandbox-copy', worldId: 'copy-world', branchId: 'copy-main' };
  const origin = {
    kind: 'copy' as const,
    sourceScope: scope,
    sourceCommitId: null,
    sourceSeq: 0,
    sourceStateFingerprint: sourceHash,
    sourceHistory: await createT4Archive(scope, state),
    anchorMapping: [
      {
        source: { chatId: scope.chatId, messageId: 'source-msg', swipeId: 'swipe-one', inputFingerprint: inputHash },
        target: { chatId: target.chatId, messageId: 'copy-msg', swipeId: 'swipe-one', inputFingerprint: inputHash },
      },
    ],
  };
  assert.deepEqual(normalizeT4Origin(origin, target), origin);
  assert.throws(() => normalizeT4Origin(origin, { ...target, branchId: scope.branchId }), rejectsCode('SCOPE'));
  assert.throws(() => normalizeT4Origin(origin, { ...target, worldId: scope.worldId }), rejectsCode('SCOPE'));
  assert.throws(
    () => normalizeT4Origin({ ...origin, sourceCommitId: 'known', sourceSeq: 0 }, target),
    rejectsCode('CHAIN'),
  );
  const bad = copy(origin);
  bad.anchorMapping[0].target.inputFingerprint = '0'.repeat(64);
  assert.throws(() => normalizeT4Origin(bad, target), rejectsCode('SCOPE'));
  const branch = { ...origin, kind: 'branch' as const };
  assert.deepEqual(normalizeT4Origin(branch, { ...target, worldId: scope.worldId }), branch);
});

test('T4 copied genesis preserves inherited revision and metadata rather than pretending the world began at zero', async () => {
  const source = await archiveTwo(),
    state = copy(source.commits[1].snapshot.state);
  const scope = { ...source.scope, chatId: 'sandbox-copy', worldId: 'independent-copy', branchId: 'new-branch' };
  state.data.worldId = scope.worldId;
  state.data.branchId = scope.branchId;
  const archive = await createT4Archive(scope, state, {
    kind: 'copy',
    sourceScope: source.scope,
    sourceCommitId: source.commits[1].commitId,
    sourceSeq: 2,
    sourceStateFingerprint: source.commits[1].afterStateFingerprint,
    sourceHistory: source,
    anchorMapping: [
      {
        source: source.commits[0].anchor,
        target: { ...source.commits[0].anchor, chatId: scope.chatId, messageId: 'copy-message' },
      },
    ],
  });
  const commit = await makeCommit(state, scope);
  archive.commits.push(commit);
  await validateT4Archive(archive);
  assert.equal(archive.genesis.data.revision, 3);
  assert.equal(commit.seq, 1);
  assert.equal(commit.snapshot.state.data.revision, 4);
  assert.deepEqual(archive.genesis.data.tables, source.commits[1].snapshot.state.data.tables);
});

test('T4 migration snapshot changes validated template without applying SQL or silent data defaults', async () => {
  const { state, scope } = fixture(),
    draft = copy(state);
  draft.template.templateVersion++;
  draft.template.name = 'explicit template migration';
  draft.data.templateVersion++;
  const migration = await makeCommit(state, scope, { kind: 'migration', draft });
  await validateT4Commit(migration, state, scope, null, 1);
  assert.deepEqual(migration.steps, []);
  assert.deepEqual(migration.changes, []);
  const illegal = copy(migration);
  illegal.steps = (await makeCommit(state, scope)).steps;
  await assert.rejects(validateT4Commit(await reseal(illegal), state, scope, null, 1), rejectsCode('INPUT'));
});

test('T4 local historical restore creates a new commit and exact-source validation rejects invented history', async () => {
  const archive = await archiveTwo(),
    base = archive.commits[1].snapshot.state;
  const historical = copy(archive.commits[0].snapshot.state);
  historical.data.revision = base.data.revision;
  const restored = await makeCommit(base, archive.scope, {
    seq: 3,
    parent: archive.commits[1].commitId,
    kind: 'restore',
    sourceCommitId: archive.commits[0].commitId,
    draft: historical,
  });
  archive.commits.push(restored);
  await validateT4Archive(archive);
  assert.equal(restored.snapshot.state.data.revision, 4);
  assert.equal(
    restored.snapshot.state.data.tables.npc[0].values.goals,
    archive.commits[0].snapshot.state.data.tables.npc[0].values.goals,
  );
  const invented = copy(archive);
  invented.commits[2].sourceCommitId = 'not-in-this-branch';
  invented.commits[2] = await reseal(invented.commits[2]);
  await assert.rejects(validateT4Archive(invented), rejectsCode('CHAIN'));
  const wrongSource = copy(archive);
  wrongSource.commits[2].sourceCommitId = null;
  wrongSource.commits[2] = await reseal(wrongSource.commits[2]);
  await assert.rejects(validateT4Archive(wrongSource), rejectsCode('INTEGRITY'));
});

test('T4 full snapshot recover never invokes SQL, model, chat globals or current worldbook projection', async () => {
  const globals = ['getVariables', 'replaceVariables', 'generate', 'getWorldbook', 'replaceWorldbook'] as const;
  const prior = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  let calls = 0;
  try {
    globals.forEach(name =>
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: () => {
          calls++;
          throw new Error('capability trap');
        },
      }),
    );
    await validateT4Archive(await archiveTwo());
    assert.equal(calls, 0);
  } finally {
    globals.forEach((name, index) => {
      if (prior[index]) Object.defineProperty(globalThis, name, prior[index]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});

test('T4 inherited history must stop at the exact requested parent and match copied business data', async () => {
  const source = await archiveTwo(),
    state = copy(source.commits[0].snapshot.state);
  const scope = { ...source.scope, chatId: 'sandbox-prefix-copy', worldId: 'prefix-copy', branchId: 'prefix-main' };
  state.data.worldId = scope.worldId;
  state.data.branchId = scope.branchId;
  const origin = {
    kind: 'copy' as const,
    sourceScope: source.scope,
    sourceCommitId: source.commits[0].commitId,
    sourceSeq: 1,
    sourceStateFingerprint: source.commits[0].afterStateFingerprint,
    sourceHistory: source,
    anchorMapping: [
      {
        source: source.commits[0].anchor,
        target: { ...source.commits[0].anchor, chatId: scope.chatId, messageId: 'copy-message' },
      },
    ],
  };
  await assert.rejects(createT4Archive(scope, state, origin), rejectsCode('CHAIN'));
  const prefix = copy(source);
  prefix.commits.pop();
  const archive = await createT4Archive(scope, state, { ...origin, sourceHistory: prefix });
  assert.equal(archive.origin.kind === 'copy' ? archive.origin.sourceHistory.commits.length : -1, 1);
  const changed = copy(state);
  changed.data.tables.npc[0].values.goals = 'undocumented edit while copying';
  await assert.rejects(createT4Archive(scope, changed, { ...origin, sourceHistory: prefix }), rejectsCode('INTEGRITY'));
});

test('T4 rehashing forged row bookkeeping stamps cannot manufacture extra changed rows', async () => {
  const { state, scope } = fixture(),
    commit = await makeCommit(state, scope);
  commit.snapshot.state.data.tables.environment[0].meta.updatedAtRevision = commit.snapshot.state.data.revision;
  commit.afterStateFingerprint = await fingerprintT4(commit.snapshot.state);
  commit.snapshot.afterFingerprint = commit.afterStateFingerprint;
  await assert.rejects(validateT4Commit(await reseal(commit), state, scope, null, 1), rejectsCode('CHAIN'));
});

test('T4 migration cannot silently keep the same template version or substitute template identity', async () => {
  const { state, scope } = fixture();
  const unchanged = await makeCommit(state, scope, { kind: 'migration', draft: state });
  await assert.rejects(validateT4Commit(unchanged, state, scope, null, 1), rejectsCode('CHAIN'));
  const changed = copy(state);
  changed.template.id = 'replacement';
  changed.template.templateVersion++;
  changed.data.templateId = changed.template.id;
  changed.data.templateVersion++;
  const replacement = await makeCommit(state, scope, { kind: 'migration', draft: changed });
  await assert.rejects(validateT4Commit(replacement, state, scope, null, 1), rejectsCode('CHAIN'));
});

test('T4 archive rejects a second commit with a reused run identity even when its hash and parent are valid', async () => {
  const archive = await archiveTwo();
  archive.commits[1].runId = archive.commits[0].runId;
  archive.commits[1] = await reseal(archive.commits[1]);
  await assert.rejects(validateT4Archive(archive), rejectsCode('CHAIN'));
});

test('T4 copy gateway requires complete dependency anchor mapping and rejects ambiguous mappings', async () => {
  const source = await archiveTwo(),
    state = copy(source.commits[1].snapshot.state);
  const scope = { ...source.scope, chatId: 'sandbox-map-target', worldId: 'mapped-copy', branchId: 'mapped-branch' };
  state.data.worldId = scope.worldId;
  state.data.branchId = scope.branchId;
  const origin = {
    kind: 'copy' as const,
    sourceScope: source.scope,
    sourceCommitId: source.commits[1].commitId,
    sourceSeq: 2,
    sourceStateFingerprint: source.commits[1].afterStateFingerprint,
    sourceHistory: source,
    anchorMapping: [],
  };
  await assert.rejects(createT4Archive(scope, state, origin), rejectsCode('SCOPE'));
  const mapping = {
    source: source.commits[0].anchor,
    target: { ...source.commits[0].anchor, chatId: scope.chatId, messageId: 'copy-message' },
  };
  // Both original commits share one message/swipe dependency, so exactly one mapping suffices.
  await createT4Archive(scope, state, { ...origin, anchorMapping: [mapping] });
  await assert.rejects(
    createT4Archive(scope, state, {
      ...origin,
      anchorMapping: [mapping, { ...mapping, target: { ...mapping.target, messageId: 'second-target' } }],
    }),
    rejectsCode('INPUT'),
  );
  const different = copy(source);
  different.commits[1].anchor.messageId = 'second-assistant';
  different.commits[1] = await reseal(different.commits[1]);
  await assert.rejects(
    createT4Archive(scope, state, { ...origin, sourceHistory: different, anchorMapping: [mapping] }),
    rejectsCode('SCOPE'),
  );
});
