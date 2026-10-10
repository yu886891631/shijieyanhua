import assert from 'node:assert/strict';
import test from 'node:test';
import { setupT13Test, legacyT13Fixture, emptyT13Fixture } from './t13-test-fixtures';
import { createMinimalT2Fixture, createCustomT2Fixture } from './t2-defaults';
import { createT13Controller } from './t13-controller';
import { exportT13Archive, sealT13File, copyT13 } from './t13-backup';
import { createT4CommitService } from './t4-service';
import { createT4SandboxStore } from './t4-store';
import { createT4Archive, validateT4Archive, sealT4Commit } from './t4-protocol';
import { executeT8Test, deferredT8Test, responseT8Test } from './t8-test-fixtures';
import { recoverT9Ledger } from './t9-ledger';
import { setupT11HostTest } from './t11-test-fixtures';
const raw = () => JSON.stringify(legacyT13Fixture());
const prepared = async (f: Awaited<ReturnType<typeof setupT13Test>>, replace = false) => {
  await f.backup();
  await f.transfer.previewText(raw(), 'legacy', replace);
  f.transfer.consent(true);
  assert.equal(f.transfer.view().canSave, true, f.transfer.view().error ?? 'cannot save');
};
test('T13 opening/closing wizard never probes old DB, commits, sends API, clears chat or projects worldbook', async () => {
  let reads = 0;
  const f = await setupT13Test(undefined, {
    readLegacy: async () => {
      reads++;
      return legacyT13Fixture();
    },
  });
  assert.equal(reads, 0);
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(f.transfer.view().report, null);
  f.close();
  assert.equal(reads, 0);
  assert.equal(f.store.statistics.writes, 0);
});
test('T13 empty target migration makes one T4 commit with original source material; refresh recovers independent receipt', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await prepared(f);
  const before = f.store.readOtherData(f.scope.chatId);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  const archive = await f.store.read(f.scope);
  assert.equal(archive.commits.length, 1);
  assert.deepEqual(archive.commits[0].transfer!.material, legacyT13Fixture());
  assert.equal(archive.commits[0].steps.length, 0);
  assert.deepEqual(f.store.readOtherData(f.scope.chatId), before);
  const reopened = createT4SandboxStore(f.store.exportStorage());
  const service = await createT4CommitService({ scope: f.scope, store: reopened, execute: executeT8Test });
  assert.equal(service.view().formal.data.tables.npc.length, 1);
  assert.equal(service.evolutionLedger(), null);
  assert.deepEqual(await validateT4Archive(await reopened.read(f.scope)), archive);
  service.close();
  f.close();
});
test('T13 complete world/data/template/history exports share formal head and leave source unchanged', async () => {
  const f = await setupT13Test();
  const before = f.store.exportStorage();
  for (const kind of ['world', 'data', 'template', 'history'] as const) {
    const file = await f.transfer.backup(kind, true);
    assert.ok(file);
    assert.equal(file.kind, kind);
  }
  assert.equal(f.store.exportStorage(), before);
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 explicit external-backup acknowledgement AND range consent are required before any save', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await f.transfer.previewText(raw(), 'legacy');
  await f.transfer.backup('world', true);
  f.transfer.consent(true);
  await f.transfer.save();
  assert.match(f.transfer.view().error!, /备份/);
  assert.equal(f.store.statistics.writes, 0);
  f.transfer.acknowledgeBackup(true);
  f.transfer.consent(false);
  await f.transfer.save();
  assert.equal(f.store.statistics.writes, 0);
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.store.statistics.writes, 1);
  f.close();
});
test('T13 existing rows conflict until explicit replace, while old data stays recoverable in history', async () => {
  const f = await setupT13Test();
  await f.transfer.previewText(raw(), 'legacy');
  assert.match(f.transfer.view().error!, /冲突/);
  assert.equal(f.transfer.view().report?.valid, false);
  assert.equal(f.store.statistics.writes, 0);
  await prepared(f, true);
  await f.transfer.save();
  const a = await f.store.read(f.scope);
  assert.equal(a.genesis.data.tables.npc[0].values.name, '陈望');
  assert.equal(a.commits.length, 1);
  f.close();
});
test('T13 repeated migration after save/reopen is idempotent and does not overwrite later edits or bump revision', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await prepared(f);
  await f.transfer.save();
  const before = f.store.exportStorage();
  await f.transfer.previewText(raw(), 'legacy', true);
  assert.equal(f.transfer.view().report?.status, 'already-imported');
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.store.exportStorage(), before);
  assert.equal(f.store.statistics.writes, 1);
  const other = createT13Controller(f.transferOptions);
  await other.previewText(raw(), 'legacy', true);
  assert.equal(other.view().report?.status, 'already-imported');
  other.close();
  f.close();
});
test('T13 known failed save leaves old authority; retry is the exact same transfer payload, not another migration', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await prepared(f);
  const before = f.service.view().formal;
  f.store.queueWriteFault('save-failed');
  await f.transfer.save();
  assert.equal(f.service.view().status, 'failed');
  assert.deepEqual(f.service.view().formal, before);
  const commit = copyT13(f.service.view().draft!.commit);
  await f.transfer.save();
  assert.equal(f.service.view().status, 'saved');
  assert.deepEqual((await f.store.read(f.scope)).commits[0], commit);
  f.close();
});
test('T13 ACK lost allows query only; independent readback confirms single save without repeat SQL/API', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await prepared(f);
  f.store.queueWriteFault('ack-lost');
  await f.transfer.save();
  assert.equal(f.transfer.view().pending, true);
  assert.equal(f.transfer.view().canSave, false);
  assert.equal(f.store.statistics.writes, 1);
  await f.transfer.save();
  assert.equal(f.store.statistics.writes, 1);
  await f.transfer.query();
  assert.equal(f.transfer.view().report?.status, 'saved');
  assert.equal(f.store.statistics.writes, 1);
  f.close();
});
test('T13 stale current head invalidates preview and old backup; no unexpected replacement', async () => {
  const f = await setupT13Test();
  await prepared(f, true);
  await f.manual('并发更新');
  await f.service.save();
  await f.transfer.save();
  assert.equal(f.store.statistics.writes, 1);
  assert.notEqual(f.transfer.view().report?.status, 'saved');
  assert.equal(f.transfer.view().hasBackup, false);
  f.close();
});
test('T13 protected locked row, locked field and user-invisible field cannot be unlocked via imported template', async () => {
  for (const type of ['row', 'field', 'private'] as const) {
    const s = createMinimalT2Fixture();
    if (type === 'row') s.data.tables.npc[0].meta.locked = true;
    if (type === 'field') s.data.tables.npc[0].meta.lockedFieldIds = ['goals'];
    if (type === 'private')
      s.template.tables.find(t => t.id === 'npc')!.fields.find(f => f.id === 'goals')!.visibility.user = false;
    const f = await setupT13Test(s);
    await f.transfer.previewText(raw(), 'legacy', true);
    assert.match(f.transfer.view().error!, /锁定/);
    assert.equal(f.store.statistics.writes, 0);
    f.close();
  }
});
test('T13 untrusted private export authority cannot reveal full signed backup through getExport', async () => {
  let allowed = true;
  const f = await setupT13Test(undefined, { canBackupPrivate: () => allowed });
  await f.transfer.backup('world', true);
  allowed = false;
  assert.throws(() => f.transfer.getExport());
  await f.transfer.backup('template', true);
  assert.match(f.transfer.view().error!, /非公开/);
  f.close();
});
test('T13 newly protected secret cannot leak cached export or be saved from preview', async () => {
  let secrets: string[] = [];
  const f = await setupT13Test(emptyT13Fixture(), { readSecrets: () => secrets });
  await prepared(f);
  secrets = ['名称-old-npc'];
  await f.transfer.save();
  assert.equal(f.store.statistics.writes, 0);
  assert.match(f.transfer.view().error!, /密钥/);
  assert.doesNotMatch(JSON.stringify(f.transfer.view()), /名称-old-npc/);
  f.close();
  let blocked: string[] = [];
  const g = await setupT13Test(undefined, { readSecrets: () => blocked });
  await g.backup();
  blocked = ['陈望'];
  assert.throws(() => g.transfer.getExport());
  g.close();
});
test('T13 cancellation and close retain source/authority; no automatic migration on fresh controller', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await prepared(f);
  f.transfer.cancel();
  assert.equal(f.transfer.view().report, null);
  assert.equal(f.store.statistics.writes, 0);
  const second = createT13Controller(f.transferOptions);
  assert.equal(second.view().report, null);
  second.close();
  f.close();
});
test('T13 unrelated outstanding manual draft cannot be overwritten by preview or query', async () => {
  const f = await setupT13Test();
  await f.manual();
  const before = copyT13(f.service.view().draft);
  await f.transfer.previewText(raw(), 'legacy', true);
  assert.match(f.transfer.view().error!, /占用/);
  await f.transfer.query();
  assert.deepEqual(f.service.view().draft, before);
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 corrupted new backup fails with zero durable writes; history audit is read-only', async () => {
  const f = await setupT13Test();
  const file = await f.backup();
  await f.transfer.previewText(JSON.stringify({ ...file, fingerprint: 'b'.repeat(64) }), 'restore', true);
  assert.match(f.transfer.view().error!, /指纹/);
  const history = await exportT13Archive(await f.store.read(f.scope), 'history', true, true);
  await f.transfer.previewText(JSON.stringify(history), 'audit');
  assert.equal(f.transfer.view().report?.status, 'audit');
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 typed snapshot restore preserves custom tables, exact decimals, false/empty values and source history as audit', async () => {
  const state = createCustomT2Fixture(),
    f = await setupT13Test(state),
    file = await f.backup();
  // Rebase makes a new formal version; external SQL is not replayed.
  await f.transfer.previewText(JSON.stringify(file), 'restore', true);
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  const market = f.service.view().formal.data.tables.market[0];
  assert.equal(market.values.unit_price, '12.30');
  assert.equal(market.values.open, false);
  const a = await f.store.read(f.scope);
  assert.equal(a.commits[0].transfer?.action, 'snapshot');
  assert.deepEqual(a.commits[0].transfer!.material, file);
  assert.equal(a.commits[0].steps.length, 0);
  f.close();
});
test('T13 copy requires a new target world; copied typed rows never inherit mutable source head or active identity', async () => {
  const source = createMinimalT2Fixture(),
    a = await createT4Archive(
      { mode: 't4-sandbox', chatId: 'sandbox-origin', worldId: source.data.worldId, branchId: source.data.branchId },
      source,
    );
  const file = await exportT13Archive(a, 'world', true, true),
    target = emptyT13Fixture();
  target.data.worldId = 'independent-copy';
  const f = await setupT13Test(target);
  await f.backup();
  await f.transfer.previewText(JSON.stringify(file), 'copy');
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  assert.equal(f.service.view().formal.data.worldId, 'independent-copy');
  assert.equal((await f.store.read(f.scope)).origin.kind, 'new');
  assert.equal(a.commits.length, 0);
  f.close();
});
test('T13 mismatch same-world foreign chat cannot restore or pretend to be independent copy', async () => {
  const f = await setupT13Test(),
    source = createMinimalT2Fixture();
  const a = await createT4Archive({ ...f.scope, chatId: 'sandbox-other' }, source);
  const file = await exportT13Archive(a, 'world', true, true);
  for (const mode of ['restore', 'copy'] as const) {
    await f.transfer.previewText(JSON.stringify(file), mode, true);
    assert.match(f.transfer.view().error!, /世界/);
  }
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 template-only import uses T6 validation, does not seed rows or invent values', async () => {
  const f = await setupT13Test(emptyT13Fixture()),
    template = copyT13(f.service.view().formal.template);
  template.name = '自定义空模板';
  const file = await sealT13File('template', template);
  await f.backup();
  await f.transfer.previewText(JSON.stringify(file), 'template');
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  assert.ok(Object.values(f.service.view().formal.data.tables).every(rows => rows.length === 0));
  f.close();
});
test('T13 clear appends empty current branch, resets ledger, retains foreign data/history, refresh does not resurrect old cache', async () => {
  const f = await setupT13Test();
  await f.backup();
  await f.transfer.previewClear();
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  const a = await f.store.read(f.scope);
  assert.equal(a.commits[0].transfer?.action, 'clear');
  assert.ok(Object.values(a.commits[0].snapshot.state.data.tables).every(rows => rows.length === 0));
  assert.equal(a.genesis.data.tables.npc.length, 1);
  assert.equal(recoverT9Ledger(a), null);
  assert.match(f.transfer.view().report!.limitations.join(''), /旧投影/);
  const store = createT4SandboxStore(f.store.exportStorage()),
    service = await createT4CommitService({ scope: f.scope, store, execute: executeT8Test });
  assert.ok(Object.values(service.view().formal.data.tables).every(rows => rows.length === 0));
  assert.deepEqual(store.readOtherData(f.scope.chatId), { externalMvu: 'unchanged', externalDatabase: 'unchanged' });
  service.close();
  f.close();
});
test('T13 clear is disabled without acknowledged backup; locked worlds are not cleared', async () => {
  const f = await setupT13Test();
  await f.transfer.previewClear();
  assert.match(f.transfer.view().error!, /备份/);
  assert.equal(f.store.statistics.writes, 0);
  f.close();
  const s = createMinimalT2Fixture();
  s.data.tables.npc[0].meta.locked = true;
  const g = await setupT13Test(s);
  await g.backup();
  await g.transfer.previewClear();
  assert.match(g.transfer.view().error!, /锁定/);
  g.close();
});
test('T13 verified simulated T10 gateway receives the same transfer receipt and preserves other namespaces/messages', async () => {
  const f = await setupT11HostTest(),
    before = JSON.parse(f.host.exportStorage());
  const transfer = createT13Controller({
    scope: f.scope,
    service: f.session.service,
    store: f.session.gateway,
    execute: executeT8Test,
    runSpec: async () => ({
      runId: 't13-host-run',
      commitId: 't13-host-commit',
      anchor: f.input.anchor,
      context: {
        inputFingerprint: f.input.anchor.inputFingerprint,
        promptFingerprint: 'a'.repeat(64),
        modelFingerprint: 'a'.repeat(64),
        parametersFingerprint: 'a'.repeat(64),
      },
    }),
    canBackupPrivate: () => true,
    canUse: f.session.canRun,
    readRecovery: f.session.refresh,
  });
  await transfer.backup('world', true);
  transfer.acknowledgeBackup(true);
  await transfer.previewText(raw(), 'legacy', true);
  transfer.consent(true);
  await transfer.save();
  assert.equal(transfer.view().report?.status, 'saved', transfer.view().error ?? '');
  const after = JSON.parse(f.host.exportStorage());
  assert.deepEqual(after.variables.mvu, before.variables.mvu);
  assert.deepEqual(after.messages, before.messages);
  transfer.close();
  f.controller.close();
  f.session.close();
});
test('T13 source reading is explicit; a failed/absent readonly reader leaves world unchanged', async () => {
  let reads = 0;
  const f = await setupT13Test(emptyT13Fixture(), {
    readLegacy: async () => {
      reads++;
      return legacyT13Fixture();
    },
  });
  assert.equal(reads, 0);
  await f.transfer.readOldSource();
  assert.equal(reads, 1);
  assert.equal(f.transfer.view().report?.sourceKind, 'alpha11');
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 close while run spec is delayed revokes authorization before durable CAS', async () => {
  const d = deferredT8Test<void>(),
    f = await setupT13Test(emptyT13Fixture());
  const other = createT13Controller({
    ...f.transferOptions,
    runSpec: async () => {
      await d.promise;
      return f.spec();
    },
  });
  await other.backup('world', true);
  other.acknowledgeBackup(true);
  await other.previewText(raw(), 'legacy');
  other.consent(true);
  const pending = other.save();
  await new Promise(resolve => setTimeout(resolve, 20));
  other.close();
  d.resolve();
  await pending;
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 whole-round ledger survives typed backup restore without a second model run', async () => {
  let calls = 0;
  const f = await setupT13Test();
  f.options.reply = async request => {
    calls++;
    return responseT8Test(
      request.stage === 'macro'
        ? 'UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?'
        : 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?',
      request.stage === 'macro' ? [70, 'small-valley-weather'] : ['观察天气', 'traveler'],
    );
  };
  await (
    await f.round.start('t13-evolution')
  ).done;
  assert.equal(f.round.view().status, 'saved');
  const ledger = copyT13(f.service.evolutionLedger()),
    file = await f.backup(),
    before = calls;
  await f.transfer.previewText(JSON.stringify(file), 'restore', true);
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  assert.deepEqual(f.service.evolutionLedger(), ledger);
  assert.equal(calls, before);
  f.close();
});

test('T13 raw legacy material export/import roundtrip preserves unsupported fields without keys or mutating original', async () => {
  const f = await setupT13Test(emptyT13Fixture()),
    original = { ...legacyT13Fixture(), apiKey: 'should-not-export' };
  const file = await f.transfer.exportLegacyOriginal(JSON.stringify(original), true);
  assert.ok(file);
  assert.doesNotMatch(JSON.stringify(file), /should-not-export/);
  assert.equal(original.apiKey, 'should-not-export');
  await f.backup();
  await f.transfer.previewText(JSON.stringify(file), 'legacy');
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  assert.equal(f.transfer.view().report?.redactions, 1);
  assert.deepEqual((await f.store.read(f.scope)).commits[0].transfer!.material, file);
  f.close();
});
test('T13 raw material backup still works when recognized current rows are malformed; migration refuses them', async () => {
  const f = await setupT13Test(emptyT13Fixture()),
    original = legacyT13Fixture();
  (original.rows.npc as unknown[]).push(null);
  const file = await f.transfer.exportLegacyOriginal(JSON.stringify(original), true);
  assert.ok(file);
  assert.ok(JSON.stringify(file).includes('null'));
  await f.transfer.previewText(JSON.stringify(file), 'legacy');
  assert.equal(f.transfer.view().report?.valid, false);
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 transfer material corruption cannot be hidden by resealing only the outer commit fingerprint', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await prepared(f);
  await f.transfer.save();
  const archive = await f.store.read(f.scope),
    commit = copyT13(archive.commits[0]);
  commit.transfer!.material = { tampered: true };
  const { fingerprint: _old, ...unsigned } = commit;
  archive.commits[0] = await sealT4Commit(unsigned);
  await assert.rejects(() => validateT4Archive(archive));
  f.close();
});
test('T13 explicitly restoring an already-used backup remains possible after later changes; only old migration is deduplicated', async () => {
  const f = await setupT13Test(),
    file = await f.backup();
  await f.transfer.previewText(JSON.stringify(file), 'restore', true);
  f.transfer.consent(true);
  await f.transfer.save();
  await f.manual('之后的新目标');
  await f.service.save();
  await f.backup();
  await f.transfer.previewText(JSON.stringify(file), 'restore', true);
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  assert.equal(f.service.view().formal.data.tables.npc[0].values.goals, '安全到达营地。');
  assert.equal(f.store.statistics.writes, 3);
  f.close();
});
test('T13 migrated immutable raw payload does not prevent explicitly confirmed row deletion via clear', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await prepared(f);
  await f.transfer.save();
  await f.backup();
  await f.transfer.previewClear();
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  assert.ok(Object.values(f.service.view().formal.data.tables).every(rows => rows.length === 0));
  assert.equal(f.store.statistics.writes, 2);
  f.close();
});
test('T13 model progress is reset on clear, while explicit historical restore can recover it without requests', async () => {
  const f = await setupT13Test();
  await (
    await f.round.start('t13-progress')
  ).done;
  assert.ok(f.service.evolutionLedger());
  await f.backup();
  await f.transfer.previewClear();
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.service.evolutionLedger(), null);
  const archive = await f.store.read(f.scope);
  assert.equal(archive.commits[1].transfer?.action, 'clear');
  await f.service.prepareRestore({ ...f.spec(), sourceCommitId: archive.commits[0].commitId });
  await f.service.save();
  assert.ok(f.service.evolutionLedger());
  f.close();
});
test('T13 revoked host/local capability during preparation stops save at authorization boundary', async () => {
  let allowed = true;
  const f = await setupT13Test(emptyT13Fixture(), { canUse: () => allowed });
  await prepared(f);
  allowed = false;
  await f.transfer.save();
  assert.equal(f.store.statistics.writes, 0);
  assert.match(f.transfer.view().error!, /持久能力/);
  f.close();
});
test('T13 missing assistant anchor leaves draft unsaved rather than creating fake plot messages', async () => {
  const f = await setupT13Test(emptyT13Fixture(), {
    runSpec: async () => ({
      runId: 'no-anchor',
      commitId: 'no-anchor-c',
      anchor: null,
      context: {
        inputFingerprint: 'a'.repeat(64),
        promptFingerprint: 'a'.repeat(64),
        modelFingerprint: 'a'.repeat(64),
        parametersFingerprint: 'a'.repeat(64),
      },
    }),
  });
  await prepared(f);
  await f.transfer.save();
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(f.service.view().status, 'draft');
  f.close();
});

test('T13 private authority revoked after read but before asynchronous export cannot emit an artifact', async () => {
  const f = await setupT13Test();
  let calls = 0;
  const other = createT13Controller({ ...f.transferOptions, canBackupPrivate: () => ++calls === 1 });
  const file = await other.backup('world', true);
  assert.equal(file, null);
  assert.equal(other.view().backupReady, false);
  assert.throws(() => other.getExport());
  assert.equal(f.store.statistics.writes, 0);
  other.close();
  f.close();
});
test('T13 compatible template import on populated world does not require replacing business rows', async () => {
  const f = await setupT13Test(),
    t = copyT13(f.service.view().formal.template);
  t.name = '只改显示名称';
  const file = await sealT13File('template', t);
  await f.backup();
  await f.transfer.previewText(JSON.stringify(file), 'template', false);
  assert.equal(f.transfer.view().report?.valid, true, f.transfer.view().error ?? '');
  f.transfer.consent(true);
  await f.transfer.save();
  assert.equal(f.service.view().formal.data.tables.npc[0].values.name, '陈望');
  assert.equal(f.store.statistics.writes, 1);
  f.close();
});
