import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  diffExtraKeys,
  expandNameSeparatorKeywords,
  mergeEntryKeys,
  normalizeKeywordList,
  remapKeywordsForAttrRename,
  resolveAppliedExtraKeys,
} from './entry-keys';
import type { WorldbookWriteAppliedEntry } from './write-sync';

test('normalizeKeywordList splits comma and fullwidth comma', () => {
  assert.deepEqual(normalizeKeywordList('a, b，c'), ['a', 'b', 'c']);
  assert.deepEqual(normalizeKeywordList([' x ', '', 'y']), ['x', 'y']);
  assert.deepEqual(normalizeKeywordList(null), []);
});

test('mergeEntryKeys keeps order and dedupes', () => {
  assert.deepEqual(mergeEntryKeys(['圣剑', 'foo'], ['foo', 'bar']), ['圣剑', 'foo', 'bar']);
  assert.deepEqual(mergeEntryKeys(['圣剑'], []), ['圣剑']);
});

test('diffExtraKeys strips defaults', () => {
  assert.deepEqual(diffExtraKeys(['圣剑', 'foo', 'bar'], ['圣剑']), ['foo', 'bar']);
  assert.deepEqual(diffExtraKeys(['圣剑'], ['圣剑']), []);
});

test('resolveAppliedExtraKeys prefers explicit extraKeys', () => {
  const applied: WorldbookWriteAppliedEntry = {
    ruleId: 'r1',
    bookName: 'BookA',
    stableName: 'WorkflowHelper-item name-圣剑',
    partial: {
      strategy: {
        type: 'selective',
        keys: ['圣剑', 'old'],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
    },
    extraKeys: ['alias'],
  };
  assert.deepEqual(resolveAppliedExtraKeys(applied), ['alias']);
});

test('resolveAppliedExtraKeys returns empty when extraKeys missing (no strategy.keys backfill)', () => {
  const applied: WorldbookWriteAppliedEntry = {
    ruleId: 'r1',
    bookName: 'BookA',
    stableName: 'WorkflowHelper-item name-圣剑',
    partial: {
      strategy: {
        type: 'selective',
        keys: ['圣剑', 'foo'],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
    },
  };
  assert.deepEqual(resolveAppliedExtraKeys(applied), []);
});

test('resolveAppliedExtraKeys empty array does not smuggle strategy.keys', () => {
  const applied: WorldbookWriteAppliedEntry = {
    ruleId: 'r1',
    bookName: 'BookA',
    stableName: 'x',
    partial: {
      strategy: {
        type: 'selective',
        keys: ['圣剑', 'stale'],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
    },
    extraKeys: [],
  };
  assert.deepEqual(resolveAppliedExtraKeys(applied), []);
});

test('resolveAppliedExtraKeys returns empty when unset', () => {
  assert.deepEqual(resolveAppliedExtraKeys(undefined), []);
  assert.deepEqual(
    resolveAppliedExtraKeys({
      ruleId: 'r1',
      bookName: 'BookA',
      stableName: 'x',
      partial: {},
      extraKeys: [],
    }),
    [],
  );
});

test('expandNameSeparatorKeywords keeps original and splits middle dots', () => {
  assert.deepEqual(expandNameSeparatorKeywords(['阿尔伯特·爱因斯坦']), [
    '阿尔伯特·爱因斯坦',
    '阿尔伯特',
    '爱因斯坦',
  ]);
  assert.deepEqual(expandNameSeparatorKeywords(['阿尔伯特・爱因斯坦']), [
    '阿尔伯特・爱因斯坦',
    '阿尔伯特',
    '爱因斯坦',
  ]);
  assert.deepEqual(expandNameSeparatorKeywords(['阿尔伯特･爱因斯坦']), [
    '阿尔伯特･爱因斯坦',
    '阿尔伯特',
    '爱因斯坦',
  ]);
});

test('expandNameSeparatorKeywords splits mixed separators in one name', () => {
  assert.deepEqual(expandNameSeparatorKeywords(['阿尔伯特·爱因斯坦・Jr']), [
    '阿尔伯特·爱因斯坦・Jr',
    '阿尔伯特',
    '爱因斯坦',
    'Jr',
  ]);
});

test('expandNameSeparatorKeywords keeps single CJK parts and drops latin singles', () => {
  assert.deepEqual(expandNameSeparatorKeywords(['玛丽·安·史密斯']), [
    '玛丽·安·史密斯',
    '玛丽',
    '安',
    '史密斯',
  ]);
  assert.deepEqual(expandNameSeparatorKeywords(['J·K·罗琳']), ['J·K·罗琳', '罗琳']);
});

test('expandNameSeparatorKeywords drops empty parts and leaves plain keys', () => {
  assert.deepEqual(expandNameSeparatorKeywords(['·爱因斯坦', '圣剑']), ['·爱因斯坦', '爱因斯坦', '圣剑']);
  assert.deepEqual(expandNameSeparatorKeywords(['阿尔伯特·']), ['阿尔伯特·', '阿尔伯特']);
  assert.deepEqual(expandNameSeparatorKeywords(['圣剑']), ['圣剑']);
});

test('expandNameSeparatorKeywords is idempotent', () => {
  const once = expandNameSeparatorKeywords(['阿尔伯特·爱因斯坦']);
  assert.deepEqual(expandNameSeparatorKeywords(once), once);
});

test('mergeEntryKeys expands extras that contain name separators', () => {
  assert.deepEqual(mergeEntryKeys(['圣剑'], ['玛丽·居里']), [
    '圣剑',
    '玛丽·居里',
    '玛丽',
    '居里',
  ]);
});

test('remapKeywordsForAttrRename drops old parts and expands the new name', () => {
  assert.deepEqual(
    remapKeywordsForAttrRename(
      ['约翰·史密斯', '约翰', '史密斯', '自定义'],
      '约翰·史密斯',
      '玛丽·居里',
    ),
    ['玛丽·居里', '玛丽', '居里', '自定义'],
  );
});

test('remapKeywordsForAttrRename then merge restores extra equal to old name part', () => {
  const remapped = remapKeywordsForAttrRename(
    ['约翰·史密斯', '约翰', '史密斯'],
    '约翰·史密斯',
    '玛丽·居里',
  );
  assert.deepEqual(mergeEntryKeys(remapped, ['约翰']), ['玛丽·居里', '玛丽', '居里', '约翰']);
});

console.log('entry-keys.test.ts: all passed');
