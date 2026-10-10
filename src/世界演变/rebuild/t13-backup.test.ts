import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultT2Fixture, createCustomT2Fixture } from './t2-defaults';
import { createT4Archive, validateT4Archive } from './t4-protocol';
import {
  exportT13Archive,
  readT13File,
  parseT13Text,
  redactT13,
  fenceT13,
  T13Error,
  copyT13,
  stateT13File,
  sealT13File,
} from './t13-backup';
import { planT13Legacy, kindT13Legacy } from './t13-legacy';
import { legacyT13Fixture, emptyT13Fixture } from './t13-test-fixtures';
const archive = async (s = createCustomT2Fixture()) =>
  createT4Archive({ mode: 't4-sandbox', chatId: 'sandbox-t13', worldId: s.data.worldId, branchId: s.data.branchId }, s);
for (const kind of ['world', 'data', 'template', 'history'] as const)
  test(`T13 ${kind} versioned backup validates without writes, API, source mutation or seed generation`, async () => {
    const a = await archive(),
      before = JSON.stringify(a),
      f = await exportT13Archive(a, kind, true, true);
    const read = await readT13File(parseT13Text(JSON.stringify(f)));
    assert.deepEqual(read, f);
    assert.equal(JSON.stringify(a), before);
    if (kind === 'world' || kind === 'data') assert.deepEqual((await stateT13File(read)).state, a.genesis);
    if (kind === 'template') assert.equal(JSON.stringify(f.payload).includes('陈望'), false);
    if (kind === 'history') assert.deepEqual(await validateT4Archive(f.payload), a);
  });
test('T13 full backups require separate trusted private authority and explicit consent', async () => {
  const a = await archive();
  for (const [authority, consent] of [
    [false, false],
    [false, true],
    [true, false],
  ])
    await assert.rejects(() => exportT13Archive(a, 'world', authority, consent), new T13Error('PRIVATE'));
});
test('T13 fingerprint corruption, future versions, extra fields and illegal JSON fail closed', async () => {
  const f = await exportT13Archive(await archive(), 'world', true, true);
  for (const changed of [
    { ...f, version: 2 },
    { ...f, extra: 'unknown' },
    { ...f, fingerprint: 'a'.repeat(64) },
  ])
    await assert.rejects(() => readT13File(changed));
  for (const invalid of ['{', 'null', '{"x":1,}', JSON.stringify({ __proto__: null, format: 'other' })]) {
    await assert.rejects(async () => readT13File(parseT13Text(invalid)));
  }
});
test('T13 file size, depth, prototype keys and executable non-JSON types are bounded', () => {
  assert.throws(() => parseT13Text(' '.repeat(4_000_001)), new T13Error('SIZE'));
  assert.throws(() => parseT13Text('{"__proto__":{"bad":1}}'));
  assert.throws(() => parseT13Text('['.repeat(70) + '0' + ']'.repeat(70)));
  assert.throws(() => redactT13({ fn: () => 1 }));
});
test('T13 credential redaction is idempotent; protected strings in property names also cannot leak', () => {
  const raw = {
    apiKey: 'secret-key',
    values: { health: 0, alive: false, empty: '', nested: { authorization: 'Bearer whatever' } },
    ['known-key']: 'also-known-key',
  };
  const r = redactT13(raw, ['known-key']);
  assert.equal(r.redactions, 4);
  assert.doesNotMatch(JSON.stringify(r.value), /secret-key|known-key|Bearer whatever/);
  assert.doesNotThrow(() => fenceT13(r.value, ['known-key']));
  assert.deepEqual((r.value as any).values, {
    health: 0,
    alive: false,
    empty: '',
    nested: { authorization: '[凭据已移除]' },
  });
  assert.equal(raw.apiKey, 'secret-key');
});
test('T13 signed backup with a known secret is rejected, not rewritten with invalid hashes', async () => {
  const s = createDefaultT2Fixture();
  s.data.tables.npc[0].values.name = 'known-real-key';
  const a = await archive(s);
  await assert.rejects(() => exportT13Archive(a, 'world', true, true, ['known-real-key']), new T13Error('SECRET'));
});
test('T13 alpha.11 representative current rows retain unknown values, events/plans, stable references and original audit materials', async () => {
  const raw = legacyT13Fixture(),
    before = JSON.stringify(raw),
    p = await planT13Legacy(raw, emptyT13Fixture(), false);
  assert.equal(p.evidence.sourceKind, 'alpha11');
  assert.equal(p.evidence.ledger, null);
  assert.deepEqual(p.evidence.material, raw);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(p.state.data.tables.npc.length, 1);
  assert.equal(p.state.data.tables.event.length, 1);
  assert.equal(p.state.data.tables.plan[0].values.legacy_status, 'done');
  assert.deepEqual(JSON.parse(p.state.data.tables.npc[0].values.legacy_data as string), raw.rows.npc[0]);
  const links = p.state.data.tables.npc[0].values.links as any[];
  assert.equal(links.length, 2);
  assert.ok(links.some(r => r.rowId === p.state.data.tables.location[0].meta.id));
  assert.ok(p.state.template.tables.every(t => !t.export.enabled && !t.runtime.enabled));
  assert.equal(
    p.state.template.tables.find(t => t.id === 'npc')!.fields.find(f => f.id === 'legacy_data')!.visibility.mainAi,
    false,
  );
});
test('T13 unchanged source yields identical row IDs despite name/ordinal edits; equal IDs across tables are independent', async () => {
  const raw = legacyT13Fixture(),
    a = await planT13Legacy(raw, emptyT13Fixture(), false);
  raw.rows.npc[0].name = '改名但不是新身份';
  const b = await planT13Legacy(raw, emptyT13Fixture(), false);
  assert.equal(a.state.data.tables.npc[0].meta.id, b.state.data.tables.npc[0].meta.id);
  raw.rows.location[0].id = raw.rows.npc[0].id;
  raw.rows.npc[0].data.locationId = raw.rows.npc[0].id;
  raw.rows.event[0].data.locationId = raw.rows.npc[0].id;
  const c = await planT13Legacy(raw, emptyT13Fixture(), false);
  assert.notEqual(c.state.data.tables.npc[0].meta.id, c.state.data.tables.location[0].meta.id);
});
test('T13 duplicate IDs are errors, not silently discarded; equal names are not identity collisions', async () => {
  const raw = legacyT13Fixture();
  raw.rows.npc.push(copyT13(raw.rows.npc[0]));
  await assert.rejects(() => planT13Legacy(raw, emptyT13Fixture(), false), new T13Error('CONFLICT'));
  raw.rows.npc[1].id = 'second-npc';
  const p = await planT13Legacy(raw, emptyT13Fixture(), false);
  assert.equal(p.state.data.tables.npc.length, 2);
});
test('T13 dangling references stop until explicit keep-original choice; no invented target row', async () => {
  const raw = legacyT13Fixture();
  raw.rows.npc[0].data.locationId = 'missing';
  await assert.rejects(() => planT13Legacy(raw, emptyT13Fixture(), false), new T13Error('REFERENCE'));
  const p = await planT13Legacy(raw, emptyT13Fixture(), true);
  assert.equal(p.state.data.tables.location.length, 1);
  assert.match(p.evidence.limitations.join('\n'), /不能唯一确认/);
  assert.equal(JSON.parse(p.state.data.tables.npc[0].values.legacy_data as string).data.locationId, 'missing');
});
test('T13 old early entity backup migrates only recognized types, exact actor names and visibility', async () => {
  const old = {
    chatKey: 'old-chat',
    entities: { a: { id: 'a', type: 'npc', name: '角色甲', state: { private: '后台秘密' }, visibility: 'backstage' } },
    events: [{ id: 'ev', summary: '事件', actors: ['角色甲'], visibility: 'revealed' }],
    scheduledEvents: [{ id: 'p', title: '计划', status: 'pending', visibility: 'ai_context' }],
    checkpoints: [{ damaged: true }],
  };
  const p = await planT13Legacy(old, emptyT13Fixture(), false);
  assert.equal(p.evidence.sourceKind, 'legacy005');
  assert.equal(p.state.data.tables.npc[0].meta.visibility.mainAi, false);
  assert.equal((p.state.data.tables.event[0].values.links as any[]).length, 1);
  assert.deepEqual(p.evidence.material, old);
  assert.match(p.evidence.limitations[0], /不伪造/);
});
test('T13 wrong chat, malformed rows and unsupported source version are rejected rather than normalized away', async () => {
  const raw = legacyT13Fixture();
  raw.rows.npc[0].chatKey = 'foreign';
  await assert.rejects(() => planT13Legacy(raw, emptyT13Fixture(), false), new T13Error('TARGET'));
  assert.throws(() => kindT13Legacy({ ...legacyT13Fixture(), version: 'alpha.99' }), new T13Error('FORMAT'));
  await assert.rejects(() =>
    planT13Legacy(
      { rows: { npc: [null] }, meta: { chatKey: 'x' }, floorRuns: [], revisions: [], checkpoints: [], projections: [] },
      emptyT13Fixture(),
      false,
    ),
  );
  assert.throws(() => kindT13Legacy({ name: '随便一个对象' }));
});
test('T13 corrupt legacy history is preserved as raw audit, never fabricated as SQL or successful round ledger', async () => {
  const raw = legacyT13Fixture();
  raw.revisions = [{ revision: -9, operations: [] }] as any;
  const p = await planT13Legacy(raw, emptyT13Fixture(), false);
  assert.deepEqual(p.evidence.material, raw);
  assert.equal(p.evidence.ledger, null);
  assert.match(p.evidence.limitations[0], /审计材料/);
});
test('T13 legacy credential fields are sanitized while original remains untouched and material can be backed up', async () => {
  const raw = { ...legacyT13Fixture(), apiKey: 'do-not-store' };
  const p = await planT13Legacy(raw, emptyT13Fixture(), false);
  assert.equal(p.evidence.redactions, 1);
  assert.doesNotMatch(JSON.stringify(p), /do-not-store/);
  assert.equal(raw.apiKey, 'do-not-store');
  await sealT13File('legacy', {
    material: p.evidence.material,
    redactions: p.evidence.redactions,
    sourceFingerprint: p.evidence.sourceFingerprint,
  });
});

test('T13 exported pretty JSON is subject to the same file size cap as later imports', async () => {
  const raw = { rows: Array(6300).fill({ a: 'x'.repeat(300), b: 'y'.repeat(300) }) };
  assert.ok(JSON.stringify(raw).length < 4_000_000);
  assert.ok(JSON.stringify(raw, null, 2).length > 4_000_000);
  await assert.rejects(() => sealT13File('legacy', raw), new T13Error('SIZE'));
});
