import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatWorldbookWriteRule } from '../tasks/schema';
import {
  customEntryNamePrefix,
  isManagedWorldbookEntryName,
  isManagedWorldbookEntryNameForRule,
  ledgerEntryKey,
  ledgerStableNamesForBook,
  mergeAppliedLedgerEntries,
  shouldDeleteManagedEntryAsOrphan,
} from './write-ledger-utils';
import type { WorldbookWriteAppliedEntry } from './write-sync';

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

function applied(stableName: string, content: string, bookName = 'BookA'): WorldbookWriteAppliedEntry {
  return {
    ruleId: 'r1',
    bookName,
    stableName,
    partial: { name: stableName, content, enabled: true },
  };
}

test('mergeAppliedLedgerEntries last-write-wins for same stableName', () => {
  const merged = mergeAppliedLedgerEntries([
    [applied('WorkflowHelper-content', 'first')],
    [applied('WorkflowHelper-content', 'second')],
  ]);
  assert.equal(merged.size, 1);
  assert.equal(merged.get(ledgerEntryKey('BookA', 'WorkflowHelper-content'))?.partial.content, 'second');
});

test('mergeAppliedLedgerEntries keeps distinct stable names', () => {
  const merged = mergeAppliedLedgerEntries([
    [applied('WorkflowHelper-a', 'a'), applied('WorkflowHelper-b', 'b')],
  ]);
  assert.equal(merged.size, 2);
});

test('isManagedWorldbookEntryName matches WorkflowHelper prefix', () => {
  const rules = [baseRule()];
  assert.equal(isManagedWorldbookEntryName('WorkflowHelper-content', rules), true);
  assert.equal(isManagedWorldbookEntryName('ManualEntry', rules), false);
});

test('isManagedWorldbookEntryName ignores legacy custom entryName', () => {
  const rules = [baseRule({ entryName: 'MyEntry-{attrValue}' })];
  assert.equal(isManagedWorldbookEntryName('MyEntry-断剑', rules), false);
  assert.equal(customEntryNamePrefix(rules[0]!), null);
  assert.equal(isManagedWorldbookEntryName('WorkflowHelper-item name-断剑', rules), true);
});

test('isManagedWorldbookEntryName legacy custom without placeholder is not managed', () => {
  const rules = [baseRule({ entryName: 'CustomPrefix' })];
  assert.equal(isManagedWorldbookEntryName('CustomPrefix-foo', rules), false);
});

test('shouldDeleteManagedEntryAsOrphan deletes only ledger orphans', () => {
  const rules = [baseRule()];
  const keep = new Set(['WorkflowHelper-a']);
  assert.equal(shouldDeleteManagedEntryAsOrphan('WorkflowHelper-a', rules, keep), false);
  assert.equal(shouldDeleteManagedEntryAsOrphan('WorkflowHelper-b', rules, keep), true);
  assert.equal(shouldDeleteManagedEntryAsOrphan('ManualEntry', rules, keep), false);
});

test('ledgerStableNamesForBook filters by book', () => {
  const ledger = mergeAppliedLedgerEntries([
    [applied('WorkflowHelper-a', 'a', 'BookA'), applied('WorkflowHelper-b', 'b', 'BookB')],
  ]);
  const names = ledgerStableNamesForBook(ledger, 'BookA');
  assert.deepEqual([...names], ['WorkflowHelper-a']);
});

test('isManagedWorldbookEntryNameForRule splitByAttr tag', () => {
  const rule = baseRule({ targetTag: 'item@name', splitByAttr: true });
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-item name-圣剑', rule), true);
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-item name-', rule), false);
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-result', rule), false);
});

test('isManagedWorldbookEntryNameForRule bare tag without split', () => {
  const rule = baseRule({ targetTag: 'result', splitByAttr: false });
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-result', rule), true);
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-result extra', rule), true);
});

test('isManagedWorldbookEntryNameForRule ignores legacy custom entryName', () => {
  const rule = baseRule({ entryName: 'MyEntry-{attrValue}', splitByAttr: true });
  assert.equal(isManagedWorldbookEntryNameForRule('MyEntry-断剑', rule), false);
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-item name-断剑', rule), true);
});

test('isManagedWorldbookEntryNameForRule wrapper entries when splitByAttr', () => {
  const rule = baseRule({ targetTag: 'item@name', splitByAttr: true });
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-item-包裹-上', rule), true);
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-item-包裹-下', rule), true);
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-item-包裹-上', baseRule({ splitByAttr: false })), false);
});

test('isManagedWorldbookEntryNameForRule legacy custom wrapper base is not managed', () => {
  const rule = baseRule({ entryName: 'MyEntry-{attrValue}', splitByAttr: true });
  assert.equal(isManagedWorldbookEntryNameForRule('MyEntry-包裹-上', rule), false);
  assert.equal(isManagedWorldbookEntryNameForRule('MyEntry-包裹-下', rule), false);
  assert.equal(isManagedWorldbookEntryNameForRule('WorkflowHelper-item-包裹-上', rule), true);
});

console.log('write-reconcile.test.ts: all passed');
