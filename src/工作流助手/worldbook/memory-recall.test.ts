import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleMemoryRecallEntries,
  extractAmCodeFromEntry,
  extractAmCodeNumber,
  selectRecentChronicleMemoryEntries,
} from './memory-recall';

test('extractAmCodeNumber parses AMXXXX', () => {
  assert.equal(extractAmCodeNumber('AM0007'), 7);
  assert.equal(extractAmCodeNumber('key AM0012 extra'), 12);
  assert.equal(extractAmCodeNumber('no-code'), null);
});

test('extractAmCodeFromEntry prefers strategy keys', () => {
  assert.equal(
    extractAmCodeFromEntry({
      name: 'TavernDB-ACU-CustomExport-纪要-1',
      strategy: { type: 'selective', keys: ['AM0003'], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
    } as never),
    3,
  );
});

test('selectRecentChronicleMemoryEntries takes highest AM then sorts ascending', () => {
  const selected = selectRecentChronicleMemoryEntries(
    [
      { entry: { uid: 1 } as never, bookName: 'A', am: 1 },
      { entry: { uid: 2 } as never, bookName: 'A', am: 5 },
      { entry: { uid: 3 } as never, bookName: 'A', am: 3 },
      { entry: { uid: 4 } as never, bookName: 'A', am: 9 },
    ],
    2,
  );
  assert.deepEqual(
    selected.map(s => s.am),
    [5, 9],
  );
  assert.deepEqual(selectRecentChronicleMemoryEntries(selected, 0), []);
});

test('assembleMemoryRecallEntries orders wrap-before, rows, wrap-after', () => {
  const before = { uid: 10, name: '…包裹-上', content: '<记忆回溯>' } as never;
  const after = { uid: 11, name: '…包裹-下', content: '</记忆回溯>' } as never;
  const rowA = { uid: 1, name: '…纪要-1', content: 'row-a' } as never;
  const rowB = { uid: 2, name: '…纪要-2', content: 'row-b' } as never;

  const ordered = assembleMemoryRecallEntries({
    wrapBefore: before,
    rows: [rowA, rowB],
    wrapAfter: after,
  });
  assert.deepEqual(
    ordered.map((e: { uid: number }) => e.uid),
    [10, 1, 2, 11],
  );
  assert.deepEqual(assembleMemoryRecallEntries({ wrapBefore: before, rows: [], wrapAfter: after }), []);
});
