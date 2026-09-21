import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWorldbookEntryPartial,
  buildWrapperEntryPartial,
  defaultWorldbookEntryName,
  mergeEntryKeys,
  resolveEntryKeys,
  resolveStableEntryName,
  resolveWrapTagName,
  resolveWrapperContent,
  resolveWrapperEntryBaseName,
  resolveWrapperStableNames,
  resolveWorldbookWriteContent,
  resolveWriteTargetBookName,
  rewriteAttrSpecDocPlaceholders,
} from './write-from-template';
import type { ChatWorldbookWriteRule } from '../tasks/schema';

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

test('resolveStableEntryName splitByAttr uses tag attr and value', () => {
  const name = resolveStableEntryName(baseRule(), '断剑');
  assert.equal(name, 'WorkflowHelper-item name-断剑');
});

test('resolveStableEntryName bare tag uses tag name only', () => {
  const name = resolveStableEntryName(baseRule({ targetTag: 'content', splitByAttr: false }));
  assert.equal(name, 'WorkflowHelper-content');
});

test('resolveStableEntryName ignores legacy custom entryName', () => {
  const name = resolveStableEntryName(
    baseRule({ entryName: 'MyEntry-{attrValue}' }),
    '断剑',
  );
  assert.equal(name, 'WorkflowHelper-item name-断剑');
});

test('resolveStableEntryName ignores legacy custom entryName without placeholder', () => {
  const name = resolveStableEntryName(baseRule({ entryName: 'MyEntry' }), '断剑');
  assert.equal(name, 'WorkflowHelper-item name-断剑');
});

test('defaultWorldbookEntryName matches resolveStableEntryName', () => {
  const rule = baseRule();
  assert.equal(defaultWorldbookEntryName(rule, '断剑'), resolveStableEntryName(rule, '断剑'));
});

test('resolveWorldbookWriteContent split keeps full tag block with newlines', () => {
  const content = resolveWorldbookWriteContent(
    'item@name=断剑',
    { 'item@name=断剑': '锈迹斑斑' },
    '',
    true,
  );
  assert.equal(content, '<item name="断剑">\n锈迹斑斑\n</item>');
});

test('resolveWorldbookWriteContent non-split uses rendered as-is', () => {
  const rendered = '<content>polished</content>';
  const content = resolveWorldbookWriteContent('content', {}, rendered, false);
  assert.equal(content, rendered);
});

test('rewriteAttrSpecDocPlaceholders maps legend stubs to targetTag', () => {
  const out = rewriteAttrSpecDocPlaceholders(
    'x{{标签@属性}} {{total:标签@属性}} {{total:launched:标签@属性}} {{total:last-launched:标签@属性}}y',
    'npc@act',
  );
  assert.equal(
    out,
    'x{{npc@act}} {{total:npc@act}} {{total:launched:npc@act}} {{total:last-launched:npc@act}}y',
  );
});

test('rewriteAttrSpecDocPlaceholders leaves concrete placeholders untouched', () => {
  const tpl = '<后台角色动态>\n{{npc@act}}\n</后台角色动态>';
  assert.equal(rewriteAttrSpecDocPlaceholders(tpl, 'npc@act'), tpl);
});

test('resolveEntryKeys binds attrValue for keyword splitByAttr', () => {
  const keys = resolveEntryKeys(baseRule(), 'item@name=圣剑');
  assert.deepEqual(keys, ['圣剑']);
});

test('resolveEntryKeys merges static keywords', () => {
  const keys = resolveEntryKeys(baseRule({ keywords: 'foo,bar' }), 'item@name=圣剑');
  assert.deepEqual(keys, ['圣剑', 'foo', 'bar']);
});

test('resolveEntryKeys bare tag keyword defaults to tag name', () => {
  const keys = resolveEntryKeys(baseRule({ targetTag: 'result', splitByAttr: false }));
  assert.deepEqual(keys, ['result']);
});

test('resolveEntryKeys expands name-separator attr values', () => {
  const keys = resolveEntryKeys(baseRule(), 'item@name=阿尔伯特·爱因斯坦');
  assert.deepEqual(keys, ['阿尔伯特·爱因斯坦', '阿尔伯特', '爱因斯坦']);
});

test('buildWorldbookEntryPartial writes expanded name-separator keys', () => {
  const partial = buildWorldbookEntryPartial(baseRule(), 'content', 'item@name=阿尔伯特·爱因斯坦');
  assert.deepEqual(partial.strategy?.keys, ['阿尔伯特·爱因斯坦', '阿尔伯特', '爱因斯坦']);
});

test('buildWorldbookEntryPartial keyword selective', () => {
  const partial = buildWorldbookEntryPartial(baseRule(), 'content', 'item@name=圣剑');
  assert.equal(partial.strategy?.type, 'selective');
  assert.deepEqual(partial.strategy?.keys, ['圣剑']);
  assert.equal(partial.position?.type, 'at_depth');
  assert.equal(partial.position?.depth, 2);
});

test('buildWorldbookEntryPartial merges extraKeys onto defaults', () => {
  const partial = buildWorldbookEntryPartial(baseRule(), 'content', 'item@name=圣剑', ['别名', '圣剑']);
  assert.deepEqual(partial.strategy?.keys, ['圣剑', '别名']);
});

test('mergeEntryKeys used by rewrite path preserves extras over defaults', () => {
  const defaults = resolveEntryKeys(baseRule({ keywords: 'static' }), 'item@name=圣剑');
  assert.deepEqual(mergeEntryKeys(defaults, ['extra']), ['圣剑', 'static', 'extra']);
});

test('buildWorldbookEntryPartial before_char position', () => {
  const partial = buildWorldbookEntryPartial(
    baseRule({
      placement: { position: 'before_character_definition', depth: 2, order: 10000 },
    }),
    'content',
  );
  assert.equal(partial.position?.type, 'before_character_definition');
  assert.equal(partial.position?.depth, 0);
});

test('buildWorldbookEntryPartial custom order', () => {
  const partial = buildWorldbookEntryPartial(
    baseRule({ placement: { position: 'at_depth_as_system', depth: 2, order: 42 } }),
    'content',
  );
  assert.equal(partial.position?.order, 42);
});

test('buildWorldbookEntryPartial invalid order falls back to minimum 1', () => {
  const partial = buildWorldbookEntryPartial(
    baseRule({ placement: { position: 'at_depth_as_system', depth: 2, order: 0 } }),
    'content',
  );
  assert.equal(partial.position?.order, 1);
});

test('buildWorldbookEntryPartial preventRecursion maps to both incoming and outgoing', () => {
  const on = buildWorldbookEntryPartial(baseRule({ preventRecursion: true }), 'content');
  const off = buildWorldbookEntryPartial(baseRule({ preventRecursion: false }), 'content');
  assert.equal(on.recursion?.prevent_incoming, true);
  assert.equal(on.recursion?.prevent_outgoing, true);
  assert.equal(off.recursion?.prevent_incoming, false);
  assert.equal(off.recursion?.prevent_outgoing, false);
});

test('buildWrapperEntryPartial preventRecursion maps to both incoming and outgoing', () => {
  const on = buildWrapperEntryPartial(baseRule({ preventRecursion: true }), 'before');
  const off = buildWrapperEntryPartial(baseRule({ preventRecursion: false }), 'after');
  assert.equal(on.recursion?.prevent_incoming, true);
  assert.equal(on.recursion?.prevent_outgoing, true);
  assert.equal(off.recursion?.prevent_incoming, false);
  assert.equal(off.recursion?.prevent_outgoing, false);
});

test('resolveWriteTargetBookName manual', () => {
  assert.equal(resolveWriteTargetBookName(baseRule({ bookSource: 'manual', manualBookName: 'MyBook' })), 'MyBook');
  assert.equal(resolveWriteTargetBookName(baseRule({ bookSource: 'manual', manualBookName: '' })), null);
});

test('resolveWrapTagName defaults to target tagName', () => {
  assert.equal(resolveWrapTagName(baseRule()), 'item');
  assert.equal(resolveWrapTagName(baseRule({ wrapTagName: '物品列表' })), '物品列表');
});

test('resolveWrapperEntryBaseName always uses WorkflowHelper prefix', () => {
  assert.equal(resolveWrapperEntryBaseName(baseRule()), 'WorkflowHelper-item');
  assert.equal(resolveWrapperEntryBaseName(baseRule({ entryName: 'MyEntry' })), 'WorkflowHelper-item');
  assert.equal(
    resolveWrapperEntryBaseName(baseRule({ entryName: 'MyEntry-{attrValue}' })),
    'WorkflowHelper-item',
  );
});

test('resolveWrapperStableNames appends 包裹-上/下', () => {
  assert.deepEqual(resolveWrapperStableNames(baseRule()), {
    before: 'WorkflowHelper-item-包裹-上',
    after: 'WorkflowHelper-item-包裹-下',
  });
});

test('resolveWrapperContent open/close tags', () => {
  assert.equal(resolveWrapperContent(baseRule(), 'before'), '<item>');
  assert.equal(resolveWrapperContent(baseRule(), 'after'), '</item>');
  assert.equal(resolveWrapperContent(baseRule({ wrapTagName: 'bag' }), 'before'), '<bag>');
});

test('buildWrapperEntryPartial constant with order offset', () => {
  const before = buildWrapperEntryPartial(baseRule(), 'before');
  const after = buildWrapperEntryPartial(baseRule(), 'after');
  assert.equal(before.strategy?.type, 'constant');
  assert.equal(before.content, '<item>');
  assert.equal(before.position?.order, 9999);
  assert.equal(after.content, '</item>');
  assert.equal(after.position?.order, 10001);
});

console.log('write-from-template.test.ts: all passed');
