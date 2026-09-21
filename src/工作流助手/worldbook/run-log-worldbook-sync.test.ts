import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatWorldbookWriteRule } from '../tasks/schema';
import { removeTagKeyFromRawContainer } from '../tasks/tag-variables-nested';
import {
  buildRunLogWorldbookRow,
  collectAppliedLedgerWithOwnersFromBatches,
  extractTagInnerFromWorldbookContent,
  resolveTagKeyForRow,
} from './run-log-worldbook-sync-utils';
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

function applied(
  stableName: string,
  bookName = 'BookA',
  ruleId = 'r1',
  overrides: Partial<WorldbookWriteAppliedEntry> = {},
): WorldbookWriteAppliedEntry {
  return {
    ruleId,
    bookName,
    stableName,
    partial: { name: stableName, content: 'content', enabled: true },
    ...overrides,
  };
}

test('collectAppliedLedgerWithOwnersFromBatches last floor wins owner', () => {
  const merged = collectAppliedLedgerWithOwnersFromBatches([
    { messageId: 1, entries: [applied('WorkflowHelper-item name-圣剑')] },
    { messageId: 3, entries: [applied('WorkflowHelper-item name-圣剑', 'BookA', 'r1')] },
  ]);
  assert.equal(merged.size, 1);
  const entry = merged.values().next().value!;
  assert.equal(entry.ownerMessageId, 3);
  assert.equal(entry.partial.content, 'content');
});

test('collectAppliedLedgerWithOwnersFromBatches keeps distinct stable names', () => {
  const merged = collectAppliedLedgerWithOwnersFromBatches([
    {
      messageId: 2,
      entries: [
        applied('WorkflowHelper-item name-圣剑'),
        applied('WorkflowHelper-item name-断剑'),
      ],
    },
  ]);
  assert.equal(merged.size, 2);
});

test('resolveTagKeyForRow splitByAttr from owner tags', () => {
  const rule = baseRule();
  const key = resolveTagKeyForRow(rule, 'WorkflowHelper-item name-圣剑', {
    'item@name=圣剑': 'inner',
  });
  assert.equal(key, 'item@name=圣剑');
});

test('resolveTagKeyForRow splitByAttr infers from stableName', () => {
  const rule = baseRule();
  const key = resolveTagKeyForRow(rule, 'WorkflowHelper-item name-断剑', {});
  assert.equal(key, 'item@name=断剑');
});

test('resolveTagKeyForRow bare tag', () => {
  const rule = baseRule({ targetTag: 'result', splitByAttr: false });
  const key = resolveTagKeyForRow(rule, 'WorkflowHelper-result', {});
  assert.equal(key, 'result');
});

test('extractTagInnerFromWorldbookContent parses full tag block', () => {
  const inner = extractTagInnerFromWorldbookContent(
    'result',
    '<result>\nhello\n</result>',
  );
  assert.equal(inner, 'hello');
});

test('extractTagInnerFromWorldbookContent keeps plain text', () => {
  const inner = extractTagInnerFromWorldbookContent('result', 'plain text');
  assert.equal(inner, 'plain text');
});

test('removeTagKeyFromRawContainer removes nested composite key', () => {
  const raw = removeTagKeyFromRawContainer(
    { item_name: { 圣剑: 'a', 断剑: 'b' }, 'item@name=圣剑': 'a' },
    'item@name=圣剑',
  );
  assert.deepEqual(raw.item_name, { 断剑: 'b' });
  assert.equal(raw['item@name=圣剑'], undefined);
});

test('buildRunLogWorldbookRow exposes defaultKeys and extraKeys', () => {
  const rule = baseRule();
  const entry = {
    ...applied('WorkflowHelper-item name-圣剑', 'BookA', 'r1', {
      extraKeys: ['别名'],
      partial: {
        name: 'WorkflowHelper-item name-圣剑',
        content: '<item name="圣剑">\nx\n</item>',
        enabled: true,
        strategy: {
          type: 'selective',
          keys: ['圣剑', '别名'],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
      },
    }),
    ownerMessageId: 2,
  };
  const row = buildRunLogWorldbookRow(entry, rule, { 'item@name=圣剑': 'x' }, entry.partial.content!);
  assert.ok(row);
  assert.equal(row!.entryType, 'keyword');
  assert.deepEqual(row!.defaultKeys, ['圣剑']);
  assert.deepEqual(row!.extraKeys, ['别名']);
});

test('buildRunLogWorldbookRow without extraKeys field yields empty extras', () => {
  const rule = baseRule({ keywords: 'static' });
  const entry = {
    ...applied('WorkflowHelper-item name-圣剑', 'BookA', 'r1', {
      partial: {
        name: 'WorkflowHelper-item name-圣剑',
        content: '<item name="圣剑">\nx\n</item>',
        enabled: true,
        strategy: {
          type: 'selective',
          keys: ['圣剑', 'static', 'extra'],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
      },
    }),
    ownerMessageId: 2,
  };
  const row = buildRunLogWorldbookRow(entry, rule, {}, entry.partial.content!);
  assert.ok(row);
  assert.deepEqual(row!.defaultKeys, ['圣剑', 'static']);
  assert.deepEqual(row!.extraKeys, []);
});

test('buildRunLogWorldbookRow explicit empty extraKeys ignores strategy.keys leftovers', () => {
  const rule = baseRule();
  const entry = {
    ...applied('WorkflowHelper-item name-圣剑', 'BookA', 'r1', {
      extraKeys: [],
      partial: {
        name: 'WorkflowHelper-item name-圣剑',
        content: '<item name="圣剑">\nx\n</item>',
        enabled: true,
        strategy: {
          type: 'selective',
          keys: ['圣剑', 'stale'],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
      },
    }),
    ownerMessageId: 2,
  };
  const row = buildRunLogWorldbookRow(entry, rule, {}, entry.partial.content!);
  assert.ok(row);
  assert.deepEqual(row!.extraKeys, []);
});

test('buildRunLogWorldbookRow constant entry has empty keys', () => {
  const rule = baseRule({ entryType: 'constant', splitByAttr: false, targetTag: 'world' });
  const entry = {
    ...applied('WorkflowHelper-world', 'BookA', 'r1'),
    ownerMessageId: 1,
  };
  const row = buildRunLogWorldbookRow(entry, rule, { world: 'body' }, '<world>\nbody\n</world>');
  assert.ok(row);
  assert.equal(row!.entryType, 'constant');
  assert.deepEqual(row!.defaultKeys, []);
  assert.deepEqual(row!.extraKeys, []);
});

console.log('run-log-worldbook-sync.test.ts: all passed');
