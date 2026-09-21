import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatWorldbookWriteRule } from './schema';
import { computePrunableWorldbookTargets, type RemovedReplicaInfo } from './prune-applied-for-replica';

function rule(overrides: Partial<ChatWorldbookWriteRule> = {}): ChatWorldbookWriteRule {
  return {
    id: 'r1',
    targetTag: 'item@name',
    template: '{{item@name}}',
    entryName: '',
    bookSource: 'manual',
    manualBookName: 'BookA',
    entryType: 'keyword',
    keywords: '',
    splitByAttr: true,
    wrapTagName: '',
    placement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
    preventRecursion: true,
    ...overrides,
  };
}

function removed(attrValues: string[], spec = 'item@name'): RemovedReplicaInfo {
  return { rootId: 'root', spec, attrValues };
}

test('computePrunableWorldbookTargets maps attrValues to default stable names', () => {
  const targets = computePrunableWorldbookTargets([removed(['剑', '盾'])], [rule()]);
  const names = targets.map(t => t.stableName).sort();
  assert.deepEqual(names, ['WorkflowHelper-item name-剑', 'WorkflowHelper-item name-盾'].sort());
  assert.ok(targets.every(t => t.bookName === 'BookA'));
});

test('computePrunableWorldbookTargets ignores legacy custom entryName', () => {
  const targets = computePrunableWorldbookTargets(
    [removed(['剑'])],
    [rule({ entryName: 'MyItem-{attrValue}' })],
  );
  assert.deepEqual(targets, [{ bookName: 'BookA', stableName: 'WorkflowHelper-item name-剑' }]);
});

test('computePrunableWorldbookTargets skips non-split rules', () => {
  const targets = computePrunableWorldbookTargets([removed(['剑'])], [rule({ splitByAttr: false })]);
  assert.deepEqual(targets, []);
});

test('computePrunableWorldbookTargets skips rules with mismatched tag', () => {
  const targets = computePrunableWorldbookTargets(
    [removed(['剑'], 'item@name')],
    [rule({ targetTag: 'skill@name' })],
  );
  assert.deepEqual(targets, []);
});

test('computePrunableWorldbookTargets dedups identical targets', () => {
  const targets = computePrunableWorldbookTargets(
    [removed(['剑']), removed(['剑'])],
    [rule()],
  );
  assert.equal(targets.length, 1);
});

test('computePrunableWorldbookTargets ignores empty attrValues', () => {
  const targets = computePrunableWorldbookTargets([removed([])], [rule()]);
  assert.deepEqual(targets, []);
});

console.log('prune-applied-for-replica.test.ts: all passed');
