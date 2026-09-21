import assert from 'node:assert/strict';
import {
  comparePlotWorldbookEntriesForPlaceholder,
  normalizeWorldbookWritePlacement,
  sortPlotWorldbookEntries,
  type PlotWorldbookSortEntry,
} from './entry-order';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function entry(
  partial: Partial<PlotWorldbookSortEntry> & Pick<PlotWorldbookSortEntry, 'uid' | 'name'>,
): PlotWorldbookSortEntry {
  return {
    enabled: true,
    strategy: { type: 'constant', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
    position: {
      type: 'after_character_definition',
      role: 'system',
      depth: 0,
      order: 100,
    },
    content: '',
    probability: 100,
    recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
    ...partial,
  };
}

test('same after_char segment sorts by order ascending', () => {
  const sorted = sortPlotWorldbookEntries([
    entry({ uid: 3, name: 'c', position: { type: 'after_character_definition', role: 'system', depth: 0, order: 99 } }),
    entry({ uid: 1, name: 'a', position: { type: 'after_character_definition', role: 'system', depth: 0, order: 1 } }),
    entry({ uid: 2, name: 'b', position: { type: 'after_character_definition', role: 'system', depth: 0, order: 4 } }),
  ]);
  assert.deepEqual(sorted.map(e => e.uid), [1, 2, 3]);
});

test('constant and selective mix by order not by strategy type', () => {
  const sorted = sortPlotWorldbookEntries([
    entry({
      uid: 1,
      name: 'blue',
      strategy: { type: 'constant', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      position: { type: 'after_character_definition', role: 'system', depth: 0, order: 99 },
    }),
    entry({
      uid: 2,
      name: 'green',
      strategy: { type: 'selective', keys: ['kw'], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      position: { type: 'after_character_definition', role: 'system', depth: 0, order: 50 },
    }),
  ]);
  assert.deepEqual(sorted.map(e => e.uid), [2, 1]);
});

test('at_depth higher depth comes before lower depth', () => {
  const sorted = sortPlotWorldbookEntries([
    entry({ uid: 1, name: 'd0', position: { type: 'at_depth', role: 'system', depth: 0, order: 1 } }),
    entry({ uid: 2, name: 'd4', position: { type: 'at_depth', role: 'system', depth: 4, order: 1 } }),
  ]);
  assert.deepEqual(sorted.map(e => e.uid), [2, 1]);
});

test('segment order before_char then after_char then at_depth', () => {
  const sorted = sortPlotWorldbookEntries([
    entry({ uid: 3, name: 'depth', position: { type: 'at_depth', role: 'system', depth: 2, order: 1 } }),
    entry({ uid: 2, name: 'after', position: { type: 'after_character_definition', role: 'system', depth: 0, order: 1 } }),
    entry({ uid: 1, name: 'before', position: { type: 'before_character_definition', role: 'system', depth: 0, order: 1 } }),
  ]);
  assert.deepEqual(sorted.map(e => e.uid), [1, 2, 3]);
});

test('normalizeWorldbookWritePlacement clamps invalid order and normalizes position', () => {
  assert.deepEqual(
    normalizeWorldbookWritePlacement({ position: 'before_char', depth: 'x' as unknown as number, order: 0 }),
    { position: 'before_character_definition', depth: 2, order: 1 },
  );
  assert.deepEqual(normalizeWorldbookWritePlacement({ order: 42 }), {
    position: 'at_depth_as_system',
    depth: 2,
    order: 42,
  });
});

test('tie-break uses placeholderOriginalIndex then bookName then uid', () => {
  const a = entry({
    uid: 2,
    name: 'same',
    bookName: 'B',
    placeholderOriginalIndex: 1,
    position: { type: 'after_character_definition', role: 'system', depth: 0, order: 10 },
  });
  const b = entry({
    uid: 1,
    name: 'same',
    bookName: 'A',
    placeholderOriginalIndex: 0,
    position: { type: 'after_character_definition', role: 'system', depth: 0, order: 10 },
  });
  assert.equal(comparePlotWorldbookEntriesForPlaceholder(b, a), -1);

  const c = entry({
    uid: 3,
    name: 'same',
    bookName: 'A',
    placeholderOriginalIndex: 0,
    position: { type: 'after_character_definition', role: 'system', depth: 0, order: 10 },
  });
  assert.equal(comparePlotWorldbookEntriesForPlaceholder(b, c), -1);
});
