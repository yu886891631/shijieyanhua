import assert from 'node:assert/strict';
import { test } from 'node:test';
import { upsertAppliedInList, type WorldbookWriteAppliedEntry } from './write-sync';
import { upsertSnapshotKeepFirstInList, type WorldbookWriteSnapshotEntry } from './write-from-template';

function applied(stableName: string, content: string): WorldbookWriteAppliedEntry {
  return {
    ruleId: 'r1',
    bookName: 'BookA',
    stableName,
    partial: { name: stableName, content, enabled: true },
  };
}

function snapshot(entryName: string, content: string): WorldbookWriteSnapshotEntry {
  return {
    bookName: 'BookA',
    entryName,
    uid: 1,
    content,
    enabled: true,
    existed: true,
  };
}

test('upsertAppliedInList appends new entry', () => {
  const { list, replaced } = upsertAppliedInList([], applied('A', 'first'));
  assert.equal(replaced, false);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.partial.content, 'first');
});

test('upsertAppliedInList replaces same stableName on same floor', () => {
  const first = upsertAppliedInList([], applied('A', 'stage1'));
  const second = upsertAppliedInList(first.list, applied('A', 'stage2'));
  assert.equal(second.replaced, true);
  assert.equal(second.list.length, 1);
  assert.equal(second.list[0]?.partial.content, 'stage2');
});

test('upsertAppliedInList keeps distinct stable names', () => {
  let { list } = upsertAppliedInList([], applied('A', 'a'));
  ({ list } = upsertAppliedInList(list, applied('B', 'b')));
  assert.equal(list.length, 2);
});

test('upsertSnapshotKeepFirstInList keeps first snapshot only', () => {
  const first = upsertSnapshotKeepFirstInList([], snapshot('A', 'original'));
  const second = upsertSnapshotKeepFirstInList(first.list, snapshot('A', 'intermediate'));
  assert.equal(second.skipped, true);
  assert.equal(second.list.length, 1);
  assert.equal(second.list[0]?.content, 'original');
});

console.log('write-sync.test.ts: all passed');
