import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPlotWorldbookEntryListed,
  isPlotWorldbookEntrySelectable,
  isStWorldbookEntryEnabled,
  sanitizePlotWorldbookEnabledUids,
  selectablePlotWorldbookEntryUids,
  shouldIncludePlotWorldbookEntryInDollar1,
} from './plot-entry-select';
import { scanTriggeredWorldbookEntries } from './scan';

test('selectablePlotWorldbookEntryUids only includes ST-enabled visible entries', () => {
  const uids = selectablePlotWorldbookEntryUids([
    { uid: 1, name: '普通条目', enabled: true } as never,
    { uid: 2, name: '普通条目2', enabled: false } as never,
    { uid: 3, name: 'TavernDB-ACU-foo', enabled: true } as never,
    { uid: 4, name: 'WorkflowHelper-result', enabled: true } as never,
  ]);
  assert.deepEqual(uids, [1]);
});

test('sanitizePlotWorldbookEnabledUids keeps ST-disabled listed uids', () => {
  const entries = [
    { uid: 1, name: 'a', enabled: true } as never,
    { uid: 2, name: 'b', enabled: false } as never,
  ];
  assert.deepEqual(sanitizePlotWorldbookEnabledUids(entries, [1, 2]), [1, 2]);
});

test('sanitizePlotWorldbookEnabledUids removes auto-included WorkflowHelper uids', () => {
  const entries = [
    { uid: 1, name: '普通', enabled: true } as never,
    { uid: 2, name: 'WorkflowHelper-x', enabled: true } as never,
  ];
  assert.deepEqual(sanitizePlotWorldbookEnabledUids(entries, [1, 2]), [1]);
});

test('isPlotWorldbookEntrySelectable respects enabled flag', () => {
  assert.equal(isPlotWorldbookEntrySelectable({ uid: 1, name: 'x', enabled: false } as never), false);
  assert.equal(isPlotWorldbookEntrySelectable({ uid: 2, name: 'x', enabled: true } as never), true);
});

test('isPlotWorldbookEntryListed includes ST-disabled visible entries', () => {
  assert.equal(isPlotWorldbookEntryListed({ uid: 1, name: 'x', enabled: false } as never), true);
  assert.equal(isStWorldbookEntryEnabled({ uid: 1, name: 'x', enabled: false } as never), false);
});

test('isPlotWorldbookEntrySelectable hides WorkflowHelper even when ST-enabled', () => {
  assert.equal(
    isPlotWorldbookEntrySelectable({ uid: 1, name: 'WorkflowHelper-result', enabled: true } as never),
    false,
  );
});

test('shouldIncludePlotWorldbookEntryInDollar1 requires explicit opt-in for ST-disabled', () => {
  const entry = { uid: 2, name: 'off', enabled: false } as never;
  const decorated = { bookName: 'Book', uid: 2, normalizedComment: 'off' };
  assert.equal(
    shouldIncludePlotWorldbookEntryInDollar1(entry, decorated, { enabledEntries: {} } as never),
    false,
  );
  assert.equal(
    shouldIncludePlotWorldbookEntryInDollar1(entry, decorated, {
      enabledEntries: { Book: [2] },
    } as never),
    true,
  );
});

test('shouldIncludePlotWorldbookEntryInDollar1 keeps ST-enabled when selected', () => {
  const entry = { uid: 1, name: 'on', enabled: true } as never;
  const decorated = { bookName: 'Book', uid: 1, normalizedComment: 'on' };
  assert.equal(
    shouldIncludePlotWorldbookEntryInDollar1(entry, decorated, { enabledEntries: {} } as never, [], {
      isSelected: true,
    }),
    true,
  );
  assert.equal(
    shouldIncludePlotWorldbookEntryInDollar1(entry, decorated, { enabledEntries: { Book: [] } } as never, [], {
      isSelected: false,
    }),
    false,
  );
});

test('scanTriggeredWorldbookEntries drops disabled by default', () => {
  const entries = [
    {
      uid: 1,
      name: 'c',
      enabled: false,
      content: 'const',
      strategy: { type: 'constant', keys: [] },
    } as never,
  ];
  assert.equal(scanTriggeredWorldbookEntries(entries, 'x').length, 0);
});

test('scanTriggeredWorldbookEntries allowDisabled keeps constant disabled', () => {
  const entries = [
    {
      uid: 1,
      name: 'c',
      enabled: false,
      content: 'const',
      strategy: { type: 'constant', keys: [] },
    } as never,
  ];
  assert.equal(scanTriggeredWorldbookEntries(entries, 'x', { allowDisabled: true }).length, 1);
});
