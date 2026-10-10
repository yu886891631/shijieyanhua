import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultT2Fixture, createMinimalT2Fixture, createCustomT2Fixture } from './t2-defaults';
import { createT4Archive, fingerprintT4, type T4State } from './t4-protocol';
import {
  buildT12Projection,
  copyT12,
  keyT12,
  resolveT12Primary,
  T12Error,
  validateT12Generation,
} from './t12-projection';
import { materializeT12, ownerT12, diffT12Book, confirmedT12Book, activationT12 } from './t12-gateway';
const scope = { mode: 't4-sandbox' as const, chatId: 'sandbox-t12', worldId: 'world-t12', branchId: 'branch-t12' };
const binding = {
  chatId: scope.chatId,
  worldId: scope.worldId,
  branchId: scope.branchId,
  characterId: '测试卡',
  primaryBook: '主书',
};
async function build(state: T4State = createMinimalT2Fixture()) {
  const s = copyT12(state);
  s.data.worldId = scope.worldId;
  s.data.branchId = scope.branchId;
  return buildT12Projection(await createT4Archive(scope, s), binding);
}
const errorCode = (code: string) => (e: unknown) => e instanceof T12Error && e.code === code;
test('T12 character primary resolution has no fallback, creation or binding mutation', () => {
  assert.equal(
    resolveT12Primary(() => ({ primary: '原主书', additional: ['附加'] })),
    '原主书',
  );
  for (const primary of [null, '', '   '])
    assert.equal(
      resolveT12Primary(() => ({ primary, additional: ['附加'] })),
      null,
    );
  assert.equal(
    resolveT12Primary(() => {
      throw new Error('host');
    }),
    null,
  );
});
test('T12 per-row payload is deterministic, literal-key selective and recursion/sticky disabled', async () => {
  const a = await build(),
    b = await build();
  assert.deepEqual(a, b);
  assert.equal(a.generation.entries.length, 2);
  assert.deepEqual(await validateT12Generation(a.generation), a.generation);
  for (const e of a.generation.entries) {
    if (e.tableId === 'npc') {
      assert.equal(e.payload.strategy.type, 'selective');
      assert.ok(e.payload.strategy.keys.length);
    } else assert.equal(e.payload.strategy.type, 'constant');
    assert.deepEqual(e.payload.recursion, { prevent_incoming: true, prevent_outgoing: true, delay_until: null });
    assert.deepEqual(e.payload.effect, { sticky: null, cooldown: null, delay: null });
    assert.equal(e.fingerprint, await fingerprintT4(e.payload));
  }
});
test('T12 secrets cannot enter body/title/keys/index, even if selected by DIY export settings', async () => {
  const s = createDefaultT2Fixture(),
    npc = s.template.tables.find(t => t.id === 'npc')!;
  const hidden = npc.fields.find(f => !f.visibility.mainAi)!;
  s.data.tables.npc[0].values[hidden.id] = 'TOP-SECRET-全途径';
  npc.export.fieldIds.push(hidden.id);
  npc.export.titleFieldId = hidden.id;
  npc.export.keyFieldIds = [hidden.id];
  for (const mode of ['constant', 'index'] as const) {
    npc.export.mode = mode;
    const b = await build(s);
    assert.doesNotMatch(JSON.stringify(b), /TOP-SECRET|全途径/);
  }
  npc.export.mode = 'per-row';
  await assert.rejects(build(s), errorCode('KEYS'));
});
test('T12 field hiddenUi is independent of main AI visibility; user preview intersects both rights', async () => {
  const s = createMinimalT2Fixture(),
    t = s.template.tables.find(t => t.id === 'npc')!;
  t.fields.find(f => f.id === 'goals')!.hiddenUi = true;
  s.data.tables.npc[0].values.goals = '主AI可读界面隐藏内容';
  const b = await build(s);
  assert.match(JSON.stringify(b.generation), /主AI可读界面隐藏内容/);
  assert.doesNotMatch(JSON.stringify(b.preview), /主AI可读界面隐藏内容/);
});
test('T12 main-only row is exported without granting user permission or previewing its title', async () => {
  const s = createMinimalT2Fixture();
  s.data.tables.npc[0].meta.visibility.user = false;
  s.data.tables.npc[0].values.name = '用户不可读但主AI允许';
  const b = await build(s);
  assert.match(JSON.stringify(b.generation), /用户不可读但主AI允许/);
  assert.doesNotMatch(JSON.stringify(b.preview), /用户不可读但主AI允许/);
});
test('T12 table/row main visibility and export off all suppress direct exports', async () => {
  for (const choice of ['table', 'row', 'export'] as const) {
    const s = createMinimalT2Fixture(),
      t = s.template.tables.find(t => t.id === 'npc')!;
    if (choice === 'table') t.visibility.mainAi = false;
    else if (choice === 'row') s.data.tables.npc[0].meta.visibility.mainAi = false;
    else t.export.enabled = false;
    const b = await build(s);
    assert.ok(b.generation.entries.every(e => e.tableId !== 'npc'));
  }
});
test('T12 references dereference only readable target titles, never hidden target names or IDs', async () => {
  const s = createDefaultT2Fixture(),
    location = s.template.tables.find(t => t.id === 'location')!;
  const row = s.data.tables.location[0];
  row.values.name = '不可读目标地点';
  row.meta.visibility.mainAi = false;
  const npc = s.template.tables.find(t => t.id === 'npc')!,
    ref = npc.fields.find(f => f.type === 'reference')!;
  s.data.tables.npc[0].values[ref.id] = { tableId: 'location', rowId: row.meta.id };
  const b = await build(s);
  const e = b.generation.entries.find(e => e.tableId === 'npc' && e.rowId === s.data.tables.npc[0].meta.id)!;
  assert.doesNotMatch(JSON.stringify(e.payload), /不可读目标地点/);
  assert.ok(!e.payload.content.includes(row.meta.id));
  row.meta.visibility.mainAi = true;
  location.fields.find(f => f.id === location.export.titleFieldId)!.visibility.mainAi = false;
  location.export.mode = 'constant';
  assert.doesNotMatch(JSON.stringify((await build(s)).generation), /不可读目标地点/);
});
test('T12 readable references render names, not JSON identities; boolean/null/time/list retain meanings', async () => {
  const b = await build(createDefaultT2Fixture());
  assert.ok(b.generation.entries.some(e => e.payload.content.includes('地点')));
  assert.doesNotMatch(b.generation.entries.map(e => e.payload.content).join(''), /"rowId"|"tableId"|\[object Object\]/);
});
test('T12 row/table/SQL-name rename leaves stable projection key unchanged and changes fingerprint', async () => {
  const s = createMinimalT2Fixture(),
    a = await build(s),
    t = s.template.tables.find(t => t.id === 'npc')!;
  t.name = '新角色表显示名';
  t.sqlName = 'we_renamed_npc';
  s.data.tables.npc[0].values.name = '新全名';
  const b = await build(s),
    ae = a.generation.entries.find(e => e.tableId === 'npc')!,
    be = b.generation.entries.find(e => e.tableId === 'npc')!;
  assert.equal(ae.key, be.key);
  assert.notEqual(ae.fingerprint, be.fingerprint);
  assert.match(be.payload.name, /新全名/);
});
test('T12 world/chat/branch identity separates same names and stable row IDs', () => {
  const a = keyT12(scope, 'npc', 'same');
  for (const replacement of [{ chatId: 'sandbox-another' }, { worldId: 'another' }, { branchId: 'another' }])
    assert.notEqual(keyT12({ ...scope, ...replacement }, 'npc', 'same'), a);
  assert.notEqual(keyT12(scope, 'organization', 'same'), a);
});
test('T12 empty tables, no selected body fields and filtered archives generate no placeholders', async () => {
  const s = createMinimalT2Fixture();
  s.data.tables.environment = [];
  s.data.tables.npc[0].meta.archived = true;
  assert.equal((await build(s)).generation.entries.length, 0);
  s.template.tables.find(t => t.id === 'npc')!.export.includeArchived = true;
  assert.equal((await build(s)).generation.entries.length, 1);
  s.template.tables.find(t => t.id === 'npc')!.export.fieldIds = [];
  assert.equal((await build(s)).generation.entries.length, 0);
});
test('T12 index is a constant title catalogue; constant mode includes all selected public fields', async () => {
  const s = createMinimalT2Fixture(),
    t = s.template.tables.find(t => t.id === 'npc')!;
  s.data.tables.npc[0].values.goals = '常驻正文内容';
  t.export.mode = 'index';
  let e = (await build(s)).generation.entries.find(e => e.tableId === 'npc')!;
  assert.equal(e.rowId, null);
  assert.equal(e.payload.strategy.type, 'constant');
  assert.doesNotMatch(e.payload.content, /常驻正文内容/);
  t.export.mode = 'constant';
  e = (await build(s)).generation.entries.find(e => e.tableId === 'npc')!;
  assert.match(e.payload.content, /常驻正文内容/);
});
test('T12 body/trigger limit failures do not silently truncate or promote rows to constant', async () => {
  const s = createMinimalT2Fixture();
  s.template.tables[0].export.maxChars = 1;
  await assert.rejects(build(s), errorCode('SIZE'));
  const s2 = createMinimalT2Fixture();
  s2.template.tables.find(t => t.id === 'npc')!.export.keyFieldIds = [];
  await assert.rejects(build(s2), errorCode('KEYS'));
});
test('T12 template/macro code markers are data errors, not executable host payloads', async () => {
  for (const value of ['<% arbitraryCode() %>', '{{getvar::secret}}']) {
    const s = createMinimalT2Fixture();
    s.data.tables.npc[0].values.goals = value;
    await assert.rejects(build(s), errorCode('CONTENT'));
  }
});
test('T12 nondefault market table supports row, index and constant exports with no seven-kind switch', async () => {
  const s = createCustomT2Fixture(),
    t = s.template.tables.find(t => t.id === 'market')!;
  for (const mode of ['per-row', 'index', 'constant'] as const) {
    t.export.mode = mode;
    const b = await build(s);
    assert.ok(b.generation.entries.some(e => e.tableId === 'market'));
    assert.ok(b.preview.some(e => e.table.includes('市场')));
  }
});
test('T12 rejects tampered sealed generations, ownership keys, source head and arbitrary extra fields', async () => {
  const b = await build();
  for (const change of [
    (g: typeof b.generation) => {
      g.entries[0].payload.content = 'changed';
    },
    (g: typeof b.generation) => {
      g.head.revision++;
    },
    (g: typeof b.generation) => {
      g.entries[0].key = 'bad';
    },
  ]) {
    const g = copyT12(b.generation);
    change(g);
    await assert.rejects(validateT12Generation(g), errorCode('INTEGRITY'));
  }
  await assert.rejects(validateT12Generation({ ...b.generation, extra: 'unknown' }), errorCode('INTEGRITY'));
});
test('T12 target mismatch and corrupt archive do not produce a generation', async () => {
  const s = createMinimalT2Fixture();
  s.data.worldId = scope.worldId;
  s.data.branchId = scope.branchId;
  const a = await createT4Archive(scope, s);
  await assert.rejects(buildT12Projection(a, { ...binding, primaryBook: null }), errorCode('TARGET'));
  await assert.rejects(buildT12Projection(a, { ...binding, branchId: 'other' }), errorCode('TARGET'));
  await assert.rejects(buildT12Projection({ ...a, genesisFingerprint: '0'.repeat(64) }, binding), errorCode('SOURCE'));
});
test('T12 exact diff retains UID and unrelated extra; duplicate/orphan cleanup has proven current ownership', async () => {
  const g = (await build()).generation,
    p = g.entries[0],
    e = materializeT12(g, p, 1);
  e.extra = { ...(e.extra as Record<string, never>), userNote: 'keep' };
  const duplicated = copyT12(e);
  duplicated.uid = 2;
  const fakeUser = { uid: 3, name: e.name, content: 'user owns', enabled: false };
  const d = await diffT12Book(g, { entries: [duplicated, e, fakeUser], active: activationT12(g), blocked: false });
  assert.ok(d.some(d => d.kind === 'keep' && d.uid === 1));
  assert.ok(d.some(d => d.kind === 'delete' && d.uid === 2));
  assert.ok(!d.some(d => d.uid === 3));
  assert.equal(
    materializeT12(g, p, 1, e).extra && (materializeT12(g, p, 1, e).extra as Record<string, unknown>).userNote,
    'keep',
  );
});
test('T12 live content or activation drift is not hidden by matching cached metadata', async () => {
  const g = (await build()).generation,
    entries = g.entries.map((p, i) => materializeT12(g, p, i));
  const book = { entries, active: activationT12(g), blocked: false };
  assert.equal(await confirmedT12Book(g, book), true);
  entries[0].content = 'drift';
  assert.equal(await confirmedT12Book(g, book), false);
  delete entries[0].content;
  assert.equal(await confirmedT12Book(g, book), false);
  assert.throws(
    () => ownerT12({ uid: 99, extra: { world_evolution_sql_t12: { key: 'fake' } } }),
    errorCode('INTEGRITY'),
  );
});
test('T12 generation seals target before await, and record storage order does not affect projection order', async () => {
  const s = createMinimalT2Fixture();
  s.data.worldId = scope.worldId;
  s.data.branchId = scope.branchId;
  const archive = await createT4Archive(scope, s),
    target = copyT12(binding);
  const running = buildT12Projection(archive, target);
  target.primaryBook = 'changed-after-call';
  assert.equal((await running).generation.binding.primaryBook, '主书');
  const another = copyT12(s.data.tables.npc[0]);
  another.meta.id = 'another-row';
  another.values.name = '同名不同身份';
  s.data.tables.npc.push(another);
  const a = await build(s);
  s.data.tables.npc.reverse();
  assert.deepEqual((await build(s)).generation.entries, a.generation.entries);
});
test('T12 representative 200-NPC projection stays bounded and preserves all stable identities', async context => {
  const s = createMinimalT2Fixture(),
    row = s.data.tables.npc[0];
  s.data.tables.npc = Array.from({ length: 200 }, (_, i) => {
    const r = copyT12(row);
    r.meta.id = `npc-${i}`;
    r.values.name = `角色${i}`;
    return r;
  });
  const begin = performance.now(),
    built = await build(s),
    elapsed = performance.now() - begin;
  assert.equal(built.generation.entries.filter(e => e.tableId === 'npc').length, 200);
  assert.equal(new Set(built.generation.entries.map(e => e.key)).size, 201);
  context.diagnostic(
    `T12 200 NPC pure projection: ${elapsed.toFixed(1)} ms; ${JSON.stringify(built.generation).length} JSON chars; simulated only, not a host SLA.`,
  );
});
