import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractXmlTagInners,
  hasXmlTagBlock,
  neutralizeOrphanXmlOpens,
} from './xml-tag-blocks';

test('extractXmlTagInners: skips orphan open before real block', () => {
  const text = `<think>确保包含 <AddonJSONPatch>。</think>
<UpdateVariable>
<AddonJSONPatch>
[{"op":"insert","path":"/社交圈/a","value":{"描述":"x"}}]
</AddonJSONPatch>
</UpdateVariable>`;
  const inners = extractXmlTagInners(text, 'AddonJSONPatch');
  assert.equal(inners.length, 1);
  assert.match(inners[0]!, /"path":\s*"\/社交圈\/a"/);
});

test('extractXmlTagInners: keeps multiple real blocks', () => {
  const text = `<AddonJSONPatch>[1]</AddonJSONPatch>
<AddonJSONPatch>[2]</AddonJSONPatch>`;
  const inners = extractXmlTagInners(text, 'AddonJSONPatch');
  assert.deepEqual(
    inners.map(s => s.trim()),
    ['[1]', '[2]'],
  );
});

test('hasXmlTagBlock: false when only orphan open', () => {
  assert.equal(hasXmlTagBlock('提及 <JSONPatch> 即可', 'JSONPatch'), false);
});

test('hasXmlTagBlock: true when complete pair exists', () => {
  assert.equal(hasXmlTagBlock('<JSONPatch>[]</JSONPatch>', 'JSONPatch'), true);
});

test('neutralizeOrphanXmlOpens: removes orphan open angle brackets', () => {
  const text = `think <JSONPatch> mention
<JSONPatch>
[{"op":"replace","path":"/a","value":1}]
</JSONPatch>`;
  const out = neutralizeOrphanXmlOpens(text, ['JSONPatch']);
  assert.match(out, /think JSONPatch mention/);
  assert.match(out, /<JSONPatch>\s*\[\{"op":"replace"/);
  assert.equal(extractXmlTagInners(out, 'JSONPatch').length, 1);
});

test('neutralizeOrphanXmlOpens: AddonJSONPatch orphan in think', () => {
  const text = `<think>和 <AddonJSONPatch>。</think>
<AddonJSONPatch>
[{"op":"insert","path":"/社交圈/x","value":{}}]
</AddonJSONPatch>`;
  const out = neutralizeOrphanXmlOpens(text, ['JSONPatch', 'AddonJSONPatch']);
  const inners = extractXmlTagInners(out, 'AddonJSONPatch');
  assert.equal(inners.length, 1);
  assert.match(inners[0]!, /\/社交圈\/x/);
});
