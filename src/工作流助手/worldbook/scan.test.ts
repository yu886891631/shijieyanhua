import assert from 'node:assert/strict';
import test from 'node:test';
import { scanTriggeredWorldbookEntries } from './scan';

import type { WorldbookEntry } from '@types/function/worldbook';

function entry(
  partial: Partial<WorldbookEntry> & Pick<WorldbookEntry, 'uid' | 'name'>,
): WorldbookEntry {
  return {
    enabled: true,
    content: '',
    probability: 100,
    strategy: {
      type: 'selective',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: {
      type: 'after_character_definition',
      role: 'system',
      depth: 0,
      order: 100,
    },
    recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
    ...partial,
    strategy: {
      type: 'selective',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
      ...partial.strategy,
    },
    recursion: {
      prevent_incoming: false,
      prevent_outgoing: false,
      delay_until: null,
      ...partial.recursion,
    },
  };
}

function names(entries: WorldbookEntry[]): string[] {
  return entries.map(e => e.name).sort();
}

test('scanTriggeredWorldbookEntries drops disabled by default', () => {
  const entries = [entry({ uid: 1, name: 'c', enabled: false, strategy: { type: 'constant' } as never })];
  assert.equal(scanTriggeredWorldbookEntries(entries, 'x').length, 0);
});

test('scanTriggeredWorldbookEntries allowDisabled keeps constant disabled', () => {
  const entries = [entry({ uid: 1, name: 'c', enabled: false, strategy: { type: 'constant' } as never })];
  assert.equal(scanTriggeredWorldbookEntries(entries, 'x', { allowDisabled: true }).length, 1);
});

test('prevent_outgoing keeps constant content from lighting greens', () => {
  const entries = [
    entry({
      uid: 1,
      name: 'blue',
      content: 'secret-token appears here',
      strategy: { type: 'constant' } as never,
      recursion: { prevent_outgoing: true } as never,
    }),
    entry({
      uid: 2,
      name: 'green',
      content: 'green body',
      strategy: { type: 'selective', keys: ['secret-token'] } as never,
    }),
  ];
  assert.deepEqual(names(scanTriggeredWorldbookEntries(entries, '')), ['blue']);
});

test('prevent_incoming allows chat hit but not worldbook recursion', () => {
  const blue = entry({
    uid: 1,
    name: 'blue',
    content: 'lore-key in constant',
    strategy: { type: 'constant' } as never,
  });
  const green = entry({
    uid: 2,
    name: 'green',
    content: 'green body',
    strategy: { type: 'selective', keys: ['lore-key'] } as never,
    recursion: { prevent_incoming: true } as never,
  });
  assert.deepEqual(names(scanTriggeredWorldbookEntries([blue, green], '')), ['blue']);
  assert.deepEqual(names(scanTriggeredWorldbookEntries([blue, green], 'chat has lore-key')), ['blue', 'green']);
});

test('all incoming plus empty chat yields constants only', () => {
  const entries = [
    entry({
      uid: 1,
      name: 'blue',
      content: 'shared keyword blob',
      strategy: { type: 'constant' } as never,
    }),
    entry({
      uid: 2,
      name: 'green-a',
      content: 'a',
      strategy: { type: 'selective', keys: ['keyword'] } as never,
      recursion: { prevent_incoming: true } as never,
    }),
    entry({
      uid: 3,
      name: 'green-b',
      content: 'b',
      strategy: { type: 'selective', keys: ['shared'] } as never,
      recursion: { prevent_incoming: true } as never,
    }),
  ];
  assert.deepEqual(names(scanTriggeredWorldbookEntries(entries, '')), ['blue']);
});

test('delay_until 1 skips chat and can recurse from constant content', () => {
  const entries = [
    entry({
      uid: 1,
      name: 'blue',
      content: 'unlock-me',
      strategy: { type: 'constant' } as never,
    }),
    entry({
      uid: 2,
      name: 'delayed',
      content: 'delayed body',
      strategy: { type: 'selective', keys: ['unlock-me'] } as never,
      recursion: { delay_until: 1 } as never,
    }),
  ];
  assert.deepEqual(names(scanTriggeredWorldbookEntries(entries, 'unlock-me')), ['blue', 'delayed']);
  assert.deepEqual(
    names(scanTriggeredWorldbookEntries(entries, 'unlock-me', { recursionEnabled: false })),
    ['blue'],
  );
});

test('delay_until 3 still activates after idle earlier depths', () => {
  const entries = [
    entry({
      uid: 1,
      name: 'blue',
      content: 'late-key',
      strategy: { type: 'constant' } as never,
    }),
    entry({
      uid: 2,
      name: 'late',
      content: 'late body',
      strategy: { type: 'selective', keys: ['late-key'] } as never,
      recursion: { delay_until: 3 } as never,
    }),
  ];
  assert.deepEqual(names(scanTriggeredWorldbookEntries(entries, '')), ['blue', 'late']);
});

test('constant delay_until 1 is omitted at depth 0 then enters recursion buffer', () => {
  const entries = [
    entry({
      uid: 1,
      name: 'delayed-blue',
      content: 'payload-key',
      strategy: { type: 'constant' } as never,
      recursion: { delay_until: 1 } as never,
    }),
    entry({
      uid: 2,
      name: 'green',
      content: 'green body',
      strategy: { type: 'selective', keys: ['payload-key'] } as never,
    }),
  ];
  assert.deepEqual(
    names(scanTriggeredWorldbookEntries(entries, '', { recursionEnabled: false })),
    [],
  );
  assert.deepEqual(names(scanTriggeredWorldbookEntries(entries, '')), ['delayed-blue', 'green']);
});

test('recursionEnabled false does not scan worldbook content', () => {
  const entries = [
    entry({
      uid: 1,
      name: 'blue',
      content: 'chain-key',
      strategy: { type: 'constant' } as never,
    }),
    entry({
      uid: 2,
      name: 'green',
      content: 'green body',
      strategy: { type: 'selective', keys: ['chain-key'] } as never,
    }),
  ];
  assert.deepEqual(names(scanTriggeredWorldbookEntries(entries, '', { recursionEnabled: false })), ['blue']);
});

test('without recursion flags greens still chain from other entry content', () => {
  const entries = [
    entry({
      uid: 1,
      name: 'blue',
      content: 'alpha-key',
      strategy: { type: 'constant' } as never,
    }),
    entry({
      uid: 2,
      name: 'mid',
      content: 'beta-key from mid',
      strategy: { type: 'selective', keys: ['alpha-key'] } as never,
    }),
    entry({
      uid: 3,
      name: 'tail',
      content: 'tail body',
      strategy: { type: 'selective', keys: ['beta-key'] } as never,
    }),
  ];
  assert.deepEqual(names(scanTriggeredWorldbookEntries(entries, '')), ['blue', 'mid', 'tail']);
});

test('empty-key selective entries never trigger', () => {
  const entries = [
    entry({
      uid: 1,
      name: 'blue',
      content: 'anything',
      strategy: { type: 'constant' } as never,
    }),
    entry({
      uid: 2,
      name: 'empty',
      content: 'should stay out',
      strategy: { type: 'selective', keys: [] } as never,
    }),
  ];
  assert.deepEqual(names(scanTriggeredWorldbookEntries(entries, 'anything')), ['blue']);
});
