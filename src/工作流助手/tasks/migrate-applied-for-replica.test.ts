import assert from 'node:assert/strict';
import type { ChatWorldbookWriteRule } from './schema';
import {
  computeReplicaAttrRenameTargets,
  rebuildKeywordKeysAfterAttrRename,
  rebuildLiveWorldbookKeysAfterAttrRename,
  rewriteAppliedEntryForAttrRename,
  rewriteAppliedListForAttrRename,
  rewriteSnapshotListForAttrRename,
} from './migrate-applied-for-replica';
import type { WorldbookWriteAppliedEntry } from '../worldbook/write-sync';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function baseRule(overrides: Partial<ChatWorldbookWriteRule> = {}): ChatWorldbookWriteRule {
  return {
    id: 'rule-1',
    targetTag: 'item@id',
    template: '',
    entryName: '',
    bookSource: 'manual',
    manualBookName: 'BookA',
    splitByAttr: true,
    entryType: 'keyword',
    keywords: '',
    wrapTagName: '',
    placement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
    preventRecursion: true,
    ...overrides,
  };
}

test('computeReplicaAttrRenameTargets builds old/new stable names', () => {
  const targets = computeReplicaAttrRenameTargets('item@id', '断剑', '锈剑', [baseRule()]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0]!.bookName, 'BookA');
  assert.equal(targets[0]!.oldStableName, 'WorkflowHelper-item id-断剑');
  assert.equal(targets[0]!.newStableName, 'WorkflowHelper-item id-锈剑');
});

test('computeReplicaAttrRenameTargets ignores non-splitByAttr', () => {
  const targets = computeReplicaAttrRenameTargets('item@id', 'a', 'b', [
    baseRule({ splitByAttr: false }),
  ]);
  assert.equal(targets.length, 0);
});

test('rebuildKeywordKeysAfterAttrRename merges static keywords extra and name splits', () => {
  const keys = rebuildKeywordKeysAfterAttrRename(
    baseRule({ keywords: '约翰,npc' }),
    '玛丽·居里',
    ['别名'],
  );
  assert.deepEqual(keys, ['玛丽·居里', '玛丽', '居里', '约翰', 'npc', '别名']);
});

test('rebuildLiveWorldbookKeysAfterAttrRename keeps static extra and live-only keys', () => {
  const keys = rebuildLiveWorldbookKeysAfterAttrRename(
    baseRule({ keywords: '约翰' }),
    '约翰·史密斯',
    '玛丽·居里',
    ['约翰·史密斯', '约翰', '史密斯', '手改'],
    ['约翰'],
  );
  assert.deepEqual(keys, ['玛丽·居里', '玛丽', '居里', '约翰', '手改']);
  assert.ok(!keys.includes('史密斯'));
});

test('rewriteAppliedEntryForAttrRename rewrites stableName keys extraKeys', () => {
  const entry: WorldbookWriteAppliedEntry = {
    ruleId: 'r1',
    bookName: 'BookA',
    stableName: 'WorkflowHelper-item id-断剑',
    partial: {
      name: 'WorkflowHelper-item id-断剑',
      content: 'body',
      strategy: { type: 'selective', keys: ['断剑', 'extra'], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
    },
    extraKeys: ['断剑', '自定义'],
  };
  const next = rewriteAppliedEntryForAttrRename(
    entry,
    'WorkflowHelper-item id-断剑',
    'WorkflowHelper-item id-锈剑',
    'BookA',
    '断剑',
    '锈剑',
    baseRule(),
  );
  assert.ok(next);
  assert.equal(next!.stableName, 'WorkflowHelper-item id-锈剑');
  assert.equal(next!.partial.name, 'WorkflowHelper-item id-锈剑');
  assert.deepEqual(next!.partial.strategy?.keys, ['锈剑', '自定义']);
  assert.deepEqual(next!.extraKeys, ['锈剑', '自定义']);
});

test('rewriteAppliedEntryForAttrRename keeps static keyword equal to old name part', () => {
  const rule = baseRule({ keywords: '约翰' });
  const entry: WorldbookWriteAppliedEntry = {
    ruleId: 'r1',
    bookName: 'BookA',
    stableName: 'WorkflowHelper-item id-约翰·史密斯',
    partial: {
      name: 'WorkflowHelper-item id-约翰·史密斯',
      content: 'body',
      strategy: {
        type: 'selective',
        keys: ['约翰·史密斯', '约翰', '史密斯'],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
    },
    extraKeys: [],
  };
  const next = rewriteAppliedEntryForAttrRename(
    entry,
    'WorkflowHelper-item id-约翰·史密斯',
    'WorkflowHelper-item id-玛丽·居里',
    'BookA',
    '约翰·史密斯',
    '玛丽·居里',
    rule,
  );
  assert.ok(next);
  assert.deepEqual(next!.partial.strategy?.keys, ['玛丽·居里', '玛丽', '居里', '约翰']);
  assert.ok(!next!.partial.strategy?.keys?.includes('史密斯'));
});

test('rewriteAppliedEntryForAttrRename expands name separators and restores extra equal to old part', () => {
  const entry: WorldbookWriteAppliedEntry = {
    ruleId: 'r1',
    bookName: 'BookA',
    stableName: 'WorkflowHelper-item id-约翰·史密斯',
    partial: {
      name: 'WorkflowHelper-item id-约翰·史密斯',
      content: 'body',
      strategy: {
        type: 'selective',
        keys: ['约翰·史密斯', '约翰', '史密斯', '自定义'],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
    },
    extraKeys: ['约翰', '自定义'],
  };
  const next = rewriteAppliedEntryForAttrRename(
    entry,
    'WorkflowHelper-item id-约翰·史密斯',
    'WorkflowHelper-item id-玛丽·居里',
    'BookA',
    '约翰·史密斯',
    '玛丽·居里',
    baseRule(),
  );
  assert.ok(next);
  assert.equal(next!.stableName, 'WorkflowHelper-item id-玛丽·居里');
  assert.deepEqual(next!.partial.strategy?.keys, ['玛丽·居里', '玛丽', '居里', '约翰', '自定义']);
  assert.deepEqual(next!.extraKeys, ['约翰', '自定义']);
});

test('rewriteAppliedListForAttrRename skips when newStable already present', () => {
  const list: WorldbookWriteAppliedEntry[] = [
    {
      ruleId: 'r1',
      bookName: 'BookA',
      stableName: 'WorkflowHelper-item id-a',
      partial: { name: 'WorkflowHelper-item id-a', content: 'old' },
    },
    {
      ruleId: 'r1',
      bookName: 'BookA',
      stableName: 'WorkflowHelper-item id-b',
      partial: { name: 'WorkflowHelper-item id-b', content: 'keep' },
    },
  ];
  const { next, changed } = rewriteAppliedListForAttrRename(
    list,
    'WorkflowHelper-item id-a',
    'WorkflowHelper-item id-b',
    'BookA',
    'a',
    'b',
    baseRule(),
  );
  assert.equal(changed, 0);
  assert.equal(next[0]!.stableName, 'WorkflowHelper-item id-a');
});

test('rewriteAppliedListForAttrRename migrates matching entry', () => {
  const list: WorldbookWriteAppliedEntry[] = [
    {
      ruleId: 'r1',
      bookName: 'BookA',
      stableName: 'WorkflowHelper-item id-a',
      partial: {
        name: 'WorkflowHelper-item id-a',
        content: 'old',
        strategy: { type: 'selective', keys: ['a'], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      },
      extraKeys: ['a'],
    },
  ];
  const { next, changed } = rewriteAppliedListForAttrRename(
    list,
    'WorkflowHelper-item id-a',
    'WorkflowHelper-item id-b',
    'BookA',
    'a',
    'b',
    baseRule(),
  );
  assert.equal(changed, 1);
  assert.equal(next[0]!.stableName, 'WorkflowHelper-item id-b');
  assert.deepEqual(next[0]!.partial.strategy?.keys, ['b']);
  assert.deepEqual(next[0]!.extraKeys, ['b']);
});

test('rewriteAppliedListForAttrRename does not rewrite other books with same stableName', () => {
  const list: WorldbookWriteAppliedEntry[] = [
    {
      ruleId: 'r1',
      bookName: 'BookA',
      stableName: 'WorkflowHelper-item id-断剑',
      partial: {
        name: 'WorkflowHelper-item id-断剑',
        strategy: { type: 'selective', keys: ['断剑'], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      },
      extraKeys: [],
    },
    {
      ruleId: 'r2',
      bookName: 'BookB',
      stableName: 'WorkflowHelper-item id-断剑',
      partial: {
        name: 'WorkflowHelper-item id-断剑',
        strategy: { type: 'selective', keys: ['keep'], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      },
      extraKeys: ['keep'],
    },
  ];
  const { next, changed } = rewriteAppliedListForAttrRename(
    list,
    'WorkflowHelper-item id-断剑',
    'WorkflowHelper-item id-锈剑',
    'BookA',
    '断剑',
    '锈剑',
    baseRule(),
  );
  assert.equal(changed, 1);
  assert.equal(next[0]!.stableName, 'WorkflowHelper-item id-锈剑');
  assert.equal(next[0]!.bookName, 'BookA');
  assert.equal(next[1]!.stableName, 'WorkflowHelper-item id-断剑');
  assert.equal(next[1]!.bookName, 'BookB');
  assert.deepEqual(next[1]!.partial.strategy?.keys, ['keep']);
});

test('rewriteAppliedListForAttrRename other book already having newStable does not block', () => {
  const list: WorldbookWriteAppliedEntry[] = [
    {
      ruleId: 'r1',
      bookName: 'BookA',
      stableName: 'WorkflowHelper-item id-断剑',
      partial: { name: 'WorkflowHelper-item id-断剑' },
    },
    {
      ruleId: 'r2',
      bookName: 'BookB',
      stableName: 'WorkflowHelper-item id-锈剑',
      partial: { name: 'WorkflowHelper-item id-锈剑' },
    },
  ];
  const { next, changed } = rewriteAppliedListForAttrRename(
    list,
    'WorkflowHelper-item id-断剑',
    'WorkflowHelper-item id-锈剑',
    'BookA',
    '断剑',
    '锈剑',
    baseRule(),
  );
  assert.equal(changed, 1);
  assert.equal(next[0]!.stableName, 'WorkflowHelper-item id-锈剑');
  assert.equal(next[0]!.bookName, 'BookA');
  assert.equal(next[1]!.stableName, 'WorkflowHelper-item id-锈剑');
  assert.equal(next[1]!.bookName, 'BookB');
});

test('rewriteAppliedEntryForAttrRename returns null for other book', () => {
  const entry: WorldbookWriteAppliedEntry = {
    ruleId: 'r1',
    bookName: 'BookB',
    stableName: 'WorkflowHelper-item id-断剑',
    partial: { name: 'WorkflowHelper-item id-断剑' },
  };
  const next = rewriteAppliedEntryForAttrRename(
    entry,
    'WorkflowHelper-item id-断剑',
    'WorkflowHelper-item id-锈剑',
    'BookA',
    '断剑',
    '锈剑',
    baseRule(),
  );
  assert.equal(next, null);
});

test('rewriteSnapshotListForAttrRename leaves other books untouched', () => {
  const { next, changed } = rewriteSnapshotListForAttrRename(
    [
      {
        bookName: 'BookA',
        entryName: 'WorkflowHelper-item id-old',
        uid: 1,
        content: 'a',
        enabled: true,
        existed: true,
      },
      {
        bookName: 'BookB',
        entryName: 'WorkflowHelper-item id-old',
        uid: 2,
        content: 'b',
        enabled: true,
        existed: true,
      },
    ],
    'WorkflowHelper-item id-old',
    'WorkflowHelper-item id-new',
    'BookA',
  );
  assert.equal(changed, 1);
  assert.equal(next[0]!.entryName, 'WorkflowHelper-item id-new');
  assert.equal(next[1]!.entryName, 'WorkflowHelper-item id-old');
});

test('rewriteSnapshotListForAttrRename renames entryName', () => {
  const { next, changed } = rewriteSnapshotListForAttrRename(
    [
      {
        bookName: 'BookA',
        entryName: 'WorkflowHelper-item id-old',
        uid: 1,
        content: 'c',
        enabled: true,
        existed: true,
      },
    ],
    'WorkflowHelper-item id-old',
    'WorkflowHelper-item id-new',
    'BookA',
  );
  assert.equal(changed, 1);
  assert.equal(next[0]!.entryName, 'WorkflowHelper-item id-new');
});

if (process.exitCode) process.exit(process.exitCode);
