import assert from 'node:assert/strict';
import {
  applyTagsToRawContainer,
  buildDynamicAttrWritePlan,
  flattenTagContainerToRelayKeys,
  mergeNestedGroupIntoRawContainer,
  normalizeTagContainerRaw,
} from './tag-variables-nested';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('flatten nested item_id to flat keys', () => {
  const flat = flattenTagContainerToRelayKeys({
    result: 'hello',
    item_id: {
      '1': 'A',
      '2': 'B',
    },
  });
  assert.equal(flat['item@id=1'], 'A');
  assert.equal(flat['item@id=2'], 'B');
  assert.equal(flat.result, 'hello');
});

test('flatten legacy flat keys', () => {
  const flat = flattenTagContainerToRelayKeys({
    'item@id=1': '<item id="1">A</item>',
  });
  assert.equal(flat['item@id=1'], '<item id="1">A</item>');
});

test('dynamic write plan builds nested group', () => {
  const plan = buildDynamicAttrWritePlan('item@id', {
    'item@id=2': 'B',
    'item@id=1': 'A',
  });
  assert.ok(plan);
  assert.equal(plan!.groupKey, 'item_id');
  assert.equal(plan!.entries['1'], 'A');
});

test('dynamic write plan ignores ReplicaEnum registry marker', () => {
  const plan = buildDynamicAttrWritePlan('item@name', {
    'item@name=甲': '\u0000',
    'item@name=乙': '<item name="乙">内容</item>',
  });
  assert.ok(plan);
  assert.equal(plan!.entries['甲'], undefined);
  assert.equal(plan!.entries['乙'], '<item name="乙">内容</item>');
});

test('merge nested keeps stale attr keys', () => {
  const plan = buildDynamicAttrWritePlan('item@id', {
    'item@id=1': 'A',
  })!;
  const raw = mergeNestedGroupIntoRawContainer(
    { item_id: { '1': 'old', '9': 'stale' }, 'item@id=1': 'flat-stale' },
    plan,
  );
  const group = raw.item_id as Record<string, string>;
  assert.equal(group['1'], 'A');
  assert.equal(group['9'], 'stale');
  assert.equal(raw['item@id=1'], undefined);
});

test('applyTagsToRawContainer routes composite keys to nested group', () => {
  const raw = applyTagsToRawContainer(
    {},
    {
      'item@id=1': 'A',
      'item@id=2': 'B',
      result: 'hello',
    },
  );
  assert.equal(raw['item@id=1'], undefined);
  assert.equal(raw['item@id=2'], undefined);
  assert.equal((raw.item_id as Record<string, string>)['1'], 'A');
  assert.equal((raw.item_id as Record<string, string>)['2'], 'B');
  assert.equal(raw.result, 'hello');
});

test('applyTagsToRawContainer normalizes legacy full blocks to inner', () => {
  const raw = applyTagsToRawContainer(
    {},
    {
      'item@id=1': '<item id="1">A</item>',
    },
  );
  assert.equal((raw.item_id as Record<string, string>)['1'], 'A');
});

test('normalizeTagContainerRaw strips flat keys when nested exists', () => {
  const raw = normalizeTagContainerRaw({
    item_id: { '1': 'A', '2': 'B' },
    'item@id=1': 'stale-flat',
    result: 'ok',
  });
  assert.equal(raw['item@id=1'], undefined);
  assert.equal(raw.result, 'ok');
});

test('normalizeTagContainerRaw strips legacy full block in nested to inner', () => {
  const raw = normalizeTagContainerRaw({
    item_id: { '1': '<item id="1">A</item>' },
  });
  assert.equal((raw.item_id as Record<string, string>)['1'], 'A');
});

if (process.exitCode) process.exit(process.exitCode);
