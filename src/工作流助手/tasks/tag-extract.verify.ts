/**
 * 提取写入标签全面验证脚本（计划修订 v2）
 * 运行: npx tsx src/工作流助手/tasks/tag-extract.verify.ts
 */
import assert from 'node:assert/strict';
import { extractInjectTagsFromResponse } from './tag-extract';
import {
  expandWritableKeysFromPlaceholder,
  extractPlotTagsFromResponse,
  formatTagValueForInject,
  formatTagValuesForInject,
  mergeRelayTagMap,
  overwriteRelayTagMap,
  replacePlotTagPlaceholdersWithHistory,
  type RelayTagMap,
} from './utils';
import { buildExtractedBlockFromTags } from './tag-variables';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}`, e);
  }
}

// --- 摘取：item@id 分实例 ---
check('item@id 多实例不聚合', () => {
  const text = '<item id="1">A</item><item id="2">B</item>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['item@id']);
  assert.equal(Object.keys(extractedTags).length, 2);
  assert.equal(extractedTags['item@id=1'], 'A');
  assert.equal(extractedTags['item@id=2'], 'B');
});

check('item@id 缺 id 忽略裸标签', () => {
  const text = '<item id="1">A</item><item>无id</item>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['item@id']);
  assert.equal(extractedTags['item@id=1'], 'A');
  assert.equal(extractedTags.item, undefined);
});

check('item@id 仅无 id 实例为空', () => {
  const { extractedTags } = extractInjectTagsFromResponse('<item>仅无id</item>', ['item@id']);
  assert.equal(Object.keys(extractedTags).length, 0);
});

check('item@id 多个无 id 不摘取', () => {
  const { extractedTags } = extractInjectTagsFromResponse('<item>first</item><item>second</item>', ['item@id']);
  assert.equal(Object.keys(extractedTags).length, 0);
});

check('npc@act 思维链裸开标签不吞带属性块', () => {
  const text =
    '<think>仅限更新佐久夜的<npc>内容，确保其行为的独立性。</think>\n' +
    '<npc act="佐久夜">正文</npc>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['npc@act']);
  assert.equal(extractedTags['npc@act=佐久夜'], '正文');
  assert.equal(extractedTags.npc, undefined);
});

check('npc@act 同名孤儿开标签取最后一对', () => {
  const text =
    '<npc act="缪尔">标签正确，字段完整。\n[思维演化细节补充]：噪声</think>\n' +
    '<npc act="缪尔">行为链: 静默祭奠\n当前状态: 悬空静坐</npc>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['npc@act']);
  assert.equal(extractedTags['npc@act=缪尔'], '行为链: 静默祭奠\n当前状态: 悬空静坐');
  assert.ok(!extractedTags['npc@act=缪尔']?.includes('思维演化'));
  assert.ok(!extractedTags['npc@act=缪尔']?.includes('标签正确'));
});

check('npc@act 双孤儿开标签仍取最后一对', () => {
  const text =
    '<npc act="佐久夜">`。</think>\n' +
    '<npc act="佐久夜">噪声2\n' +
    '<npc act="佐久夜">行为链: 观测→锁定</npc>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['npc@act']);
  assert.equal(extractedTags['npc@act=佐久夜'], '行为链: 观测→锁定');
});

check('item@id 同 key 后者覆盖', () => {
  const text = '<item id="1">A</item><item id="1">B</item>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['item@id']);
  assert.equal(extractedTags['item@id=1'], 'B');
});

check('裸 result 向后兼容取最后内文', () => {
  const text = '<result>x</result><result type="a">y</result>';
  const { extractedTags, injectedFragments } = extractPlotTagsFromResponse(text, ['result']);
  assert.equal(extractedTags.result, 'y');
  assert.equal(injectedFragments[0], '<result>\ny\n</result>');
});

check('裸 item 配置取最后一次', () => {
  const text = '<item id="1">A</item><item id="2">B</item>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['item']);
  assert.equal(extractedTags.item, 'B');
});

check('带属性开标签裸 result 仍可摘', () => {
  const { extractedTags } = extractInjectTagsFromResponse('<result type="sum">hello</result>', ['result']);
  assert.equal(extractedTags.result, 'hello');
});

// --- 引用：完整块与避免双重包裹 ---
check('{{item@id=1}} 精确引用完整块', () => {
  const map: RelayTagMap = new Map([['item@id=1', ['<item id="1">A</item>']]]);
  const out = replacePlotTagPlaceholdersWithHistory('X{{item@id=1}}Y', map, new Map(), new Set(['item@id']));
  assert.equal(out, 'X<item id="1">\nA\n</item>Y');
  assert.ok(!out.includes('<item><item'));
  assert.ok(!out.includes('<item@id=1>'));
});

check('{{item}} 仅展开裸 key', () => {
  const map: RelayTagMap = new Map([
    ['item@id=2', ['<item id="2">B</item>']],
    ['item@id=1', ['<item id="1">A</item>']],
    ['item', ['<item>无id</item>']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory('{{item}}', map, new Map(), new Set(['item@id', 'item']));
  assert.equal(out, '<item>\n无id\n</item>');
  assert.ok(!out.includes('<item id="1">'));
  assert.ok(!out.includes('<item id="2">'));
});

check('{{result}} 内文仍包裸标签', () => {
  const map: RelayTagMap = new Map([['result', ['hello']]]);
  const out = replacePlotTagPlaceholdersWithHistory('{{result}}', map, new Map(), new Set(['result']));
  assert.equal(out, '<result>\nhello\n</result>');
});

check('formatTagValueForInject 完整块重包换行', () => {
  const block = '<item id="1">A</item>';
  assert.equal(formatTagValueForInject('item@id=1', block), '<item id="1">\nA\n</item>');
});

check('formatTagValueForInject 裸名 inner 含子标签仍包外层', () => {
  const inner = '<npc act="李明">李明</npc>';
  const out = formatTagValueForInject('不在场npc', inner);
  assert.equal(out, `<不在场npc>\n${inner}\n</不在场npc>`);
});

check('formatTagValueForInject 裸名已是自身完整块重包换行', () => {
  const inner = '<npc act="李明">李明</npc>';
  const block = `<不在场npc>${inner}</不在场npc>`;
  assert.equal(formatTagValueForInject('不在场npc', block), `<不在场npc>\n${inner}\n</不在场npc>`);
});

check('formatTagValueForInject npc@act 复合 key 完整块重包换行', () => {
  const block = '<npc act="李明">李明</npc>';
  assert.equal(formatTagValueForInject('npc@act=李明', block), '<npc act="李明">\n李明\n</npc>');
});

check('formatTagValueForInject item 不匹配 itemize 前缀', () => {
  const inner = '<itemize>list</itemize>';
  assert.equal(formatTagValueForInject('item', inner), `<item>\n${inner}\n</item>`);
});

check('{{不在场npc}} 引用保留外层', () => {
  const inner = '<npc act="李明">李明</npc>';
  const map: RelayTagMap = new Map([['不在场npc', [inner]]]);
  const out = replacePlotTagPlaceholdersWithHistory('{{不在场npc}}', map, new Map(), new Set(['不在场npc']));
  assert.equal(out, `<不在场npc>\n${inner}\n</不在场npc>`);
});

check('buildExtractedBlockFromTags 不双重包裹', () => {
  const block = buildExtractedBlockFromTags({
    'item@id=1': 'A',
    result: 'hello',
  });
  assert.ok(block.includes('<item id="1">\nA\n</item>'));
  assert.equal(block.includes('<item@id=1>'), false);
  assert.ok(block.includes('<result>\nhello\n</result>'));
  assert.ok(!block.includes('<item><item'));
});

// --- 聚合：不同复合 key 不合并 ---
check('mergeRelayTagMap 不同 item@id 不聚合', () => {
  const map: RelayTagMap = new Map();
  mergeRelayTagMap(map, { 'item@id=1': '<item id="1">A</item>' });
  mergeRelayTagMap(map, { 'item@id=2': '<item id="2">B</item>' });
  assert.equal(map.size, 2);
  assert.equal(map.get('item@id=1')?.[0], '<item id="1">A</item>');
});

check('mergeRelayTagMap 同 key 追加', () => {
  const map: RelayTagMap = new Map();
  mergeRelayTagMap(map, { 'item@id=1': 'S1' });
  mergeRelayTagMap(map, { 'item@id=1': 'S2' });
  assert.equal(map.get('item@id=1')?.length, 2);
  assert.deepEqual(map.get('item@id=1'), ['S1', 'S2']);
});

check('overwriteRelayTagMap 同 key 覆盖', () => {
  const map: RelayTagMap = new Map();
  overwriteRelayTagMap(map, { 'item@id=1': '<item id="1">S1</item>' });
  overwriteRelayTagMap(map, { 'item@id=1': '<item id="1">S2</item>' });
  assert.equal(map.get('item@id=1')?.length, 1);
  assert.equal(map.get('item@id=1')?.[0], '<item id="1">S2</item>');
});

check('formatTagValuesForInject 多段合并单外层', () => {
  const out = formatTagValuesForInject('result', ['hello', 'world']);
  assert.equal(out, '<result>\nhello\n\nworld\n</result>');
});

check('expandWritableKeys {{item}} 仅裸 key', () => {
  const keys = expandWritableKeysFromPlaceholder('item', ['item', 'item@id=1', 'item@id=2', 'result']);
  assert.deepEqual(keys, ['item']);
});

check('expandWritableKeys {{item@id=1}} 精确', () => {
  const keys = expandWritableKeysFromPlaceholder('item@id=1', ['item@id=1', 'item@id=2']);
  assert.deepEqual(keys, ['item@id=1']);
});

console.log(`\n--- 结果: ${passed} 通过, ${failed} 失败 ---`);
process.exit(failed > 0 ? 1 : 0);
