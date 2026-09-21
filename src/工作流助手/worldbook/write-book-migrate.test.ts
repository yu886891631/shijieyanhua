import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatWorldbookWriteRule } from '../tasks/schema';
import {
  collectEntriesToMoveFromLedger,
  rewriteAppliedEntriesBookName,
  rewriteSnapshotEntriesBookName,
  shouldDeleteManagedEntryForRuleOnBook,
} from './write-book-migrate-utils';
import { ledgerEntryKey, mergeAppliedLedgerEntries } from './write-ledger-utils';
import type { WorldbookWriteAppliedEntry } from './write-sync';
import type { WorldbookWriteSnapshotEntry } from './write-from-template';

function baseRule(overrides: Partial<ChatWorldbookWriteRule> = {}): ChatWorldbookWriteRule {
  return {
    id: 'r1',
    targetTag: 'item@name',
    template: '{{item@name}}',
    entryName: '',
    bookSource: 'character',
    manualBookName: '',
    entryType: 'keyword',
    keywords: '',
    splitByAttr: true,
    wrapTagName: '',
    placement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
    preventRecursion: true,
    ...overrides,
  };
}

function applied(
  stableName: string,
  content: string,
  bookName = 'BookA',
  ruleId = 'r1',
): WorldbookWriteAppliedEntry {
  return {
    ruleId,
    bookName,
    stableName,
    partial: { name: stableName, content, enabled: true },
  };
}

test('collectEntriesToMoveFromLedger filters by ruleId and fromBook', () => {
  const ledger = mergeAppliedLedgerEntries([
    [
      applied('WorkflowHelper-item name-圣剑', 'a', 'OldBook', 'r1'),
      applied('WorkflowHelper-item name-断剑', 'b', 'OldBook', 'r1'),
      applied('WorkflowHelper-item name-其他', 'c', 'NewBook', 'r1'),
      applied('WorkflowHelper-item name-另一', 'd', 'OldBook', 'r2'),
    ],
  ]);
  const toMove = collectEntriesToMoveFromLedger(ledger, 'r1', 'OldBook');
  assert.equal(toMove.length, 2);
  const names = toMove.map(e => e.stableName).sort();
  assert.deepEqual(names, ['WorkflowHelper-item name-圣剑', 'WorkflowHelper-item name-断剑']);
});

test('collectEntriesToMoveFromLedger dedupes stableName', () => {
  const ledger = mergeAppliedLedgerEntries([
    [
      applied('WorkflowHelper-content', 'first', 'OldBook'),
      applied('WorkflowHelper-content', 'second', 'OldBook'),
    ],
  ]);
  const toMove = collectEntriesToMoveFromLedger(ledger, 'r1', 'OldBook');
  assert.equal(toMove.length, 1);
});

test('shouldDeleteManagedEntryForRuleOnBook deletes migrated stable names', () => {
  const rule = baseRule();
  const migrate = new Set(['WorkflowHelper-item name-圣剑']);
  const keepOnBook = new Set(['WorkflowHelper-item name-断剑']);
  assert.equal(
    shouldDeleteManagedEntryForRuleOnBook('WorkflowHelper-item name-圣剑', rule, migrate, keepOnBook),
    true,
  );
});

test('shouldDeleteManagedEntryForRuleOnBook deletes rule orphans not in ledger', () => {
  const rule = baseRule();
  const migrate = new Set<string>();
  const keepOnBook = new Set(['WorkflowHelper-item name-断剑']);
  assert.equal(
    shouldDeleteManagedEntryForRuleOnBook('WorkflowHelper-item name-孤儿', rule, migrate, keepOnBook),
    true,
  );
  assert.equal(
    shouldDeleteManagedEntryForRuleOnBook('WorkflowHelper-item name-断剑', rule, migrate, keepOnBook),
    false,
  );
});

test('shouldDeleteManagedEntryForRuleOnBook ignores other rules and unmanaged names', () => {
  const rule = baseRule({ targetTag: 'result' });
  const migrate = new Set<string>();
  const keepOnBook = new Set<string>();
  assert.equal(
    shouldDeleteManagedEntryForRuleOnBook('WorkflowHelper-item name-圣剑', rule, migrate, keepOnBook),
    false,
  );
  assert.equal(shouldDeleteManagedEntryForRuleOnBook('ManualEntry', rule, migrate, keepOnBook), false);
});

test('rewriteAppliedEntriesBookName updates matching entries only', () => {
  const appliedList: WorldbookWriteAppliedEntry[] = [
    applied('WorkflowHelper-a', 'a', 'OldBook', 'r1'),
    applied('WorkflowHelper-b', 'b', 'OldBook', 'r2'),
    applied('WorkflowHelper-c', 'c', 'OtherBook', 'r1'),
  ];
  const { next, changed } = rewriteAppliedEntriesBookName(appliedList, 'r1', 'OldBook', 'NewBook');
  assert.equal(changed, 1);
  assert.equal(next[0]!.bookName, 'NewBook');
  assert.equal(next[1]!.bookName, 'OldBook');
  assert.equal(next[2]!.bookName, 'OtherBook');
});

test('rewriteSnapshotEntriesBookName updates migrated stable names on fromBook', () => {
  const snapshots: WorldbookWriteSnapshotEntry[] = [
    { entryName: 'WorkflowHelper-a', bookName: 'OldBook', uid: 1, content: 'a', enabled: true, existed: true },
    { entryName: 'WorkflowHelper-b', bookName: 'OldBook', uid: 2, content: 'b', enabled: true, existed: true },
    { entryName: 'WorkflowHelper-a', bookName: 'OtherBook', uid: 3, content: 'c', enabled: true, existed: true },
  ];
  const migrate = new Set(['WorkflowHelper-a']);
  const { next, changed } = rewriteSnapshotEntriesBookName(snapshots, 'OldBook', migrate, 'NewBook');
  assert.equal(changed, 1);
  assert.equal(next[0]!.bookName, 'NewBook');
  assert.equal(next[1]!.bookName, 'OldBook');
  assert.equal(next[2]!.bookName, 'OtherBook');
});

test('ledgerEntryKey used in collectEntriesToMoveFromLedger keys', () => {
  const ledger = mergeAppliedLedgerEntries([[applied('WorkflowHelper-x', 'x', 'OldBook')]]);
  assert.ok(ledger.has(ledgerEntryKey('OldBook', 'WorkflowHelper-x')));
});

console.log('write-book-migrate.test.ts: all passed');
