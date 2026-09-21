import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import {
  applyMvuLikePatch,
  extractAddonJsonPatchOpsWithIssues,
  parseJsonPatchOpsWithIssues,
} from './patch';
import { canonicalizePatchOps } from './patch-canonicalize';
import { normalizeAddonData, type AddonData } from './schema';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function baseWorld(): AddonData {
  return normalizeAddonData({
    世界: {
      阿斯塔利亚: {
        降临: true,
        平行演化: false,
        刊报日期: '旧',
      },
    },
    位面交汇: false,
  });
}

function applyParsedOps(base: AddonData, ops: Parameters<typeof applyMvuLikePatch>[1]) {
  const { ops: canonOps } = canonicalizePatchOps(ops, base);
  return applyMvuLikePatch(_.cloneDeep(base) as Record<string, unknown>, canonOps);
}

test('parseJsonPatchOpsWithIssues: valid array unchanged', () => {
  const { ops, issues } = parseJsonPatchOpsWithIssues(
    `[{"op":"replace","path":"/阿斯塔利亚/刊报日期","value":"新"}]`,
  );
  assert.equal(ops.length, 1);
  assert.equal(issues.length, 0);
  assert.equal((ops[0] as { path: string }).path, '/阿斯塔利亚/刊报日期');
});

test('parseJsonPatchOpsWithIssues: heals missing trailing braces on insert', () => {
  const raw = `[
    { "op": "insert", "path": "/阿斯塔利亚/rumor/bad", "value": { "影响力": "圈内谈资", "流变历程": { "1": { "真相": "x" } } },
    { "op": "replace", "path": "/阿斯塔利亚/刊报日期", "value": "d1" }
  ]`;
  const { ops, issues, failedFragments } = parseJsonPatchOpsWithIssues(raw);
  assert.equal(ops.length, 2);
  assert.equal((ops[0] as { op: string; path: string }).op, 'insert');
  assert.equal((ops[0] as { path: string }).path, '/阿斯塔利亚/rumor/bad');
  assert.equal((ops[1] as { op: string }).op, 'replace');
  const healWithOp = issues.filter(i => i.kind === 'heal' && i.op);
  assert.equal(healWithOp.length, 1);
  assert.equal((healWithOp[0]!.op as { path: string }).path, '/阿斯塔利亚/rumor/bad');
  assert.match(healWithOp[0]!.message, /语法修复/);
  assert.equal(failedFragments.length, 0);
});

test('extractAddonJsonPatchOpsWithIssues: heals missing braces in XML patch', () => {
  const message = `前文
<AddonJSONPatch>
[
  { "op": "insert", "path": "/阿斯塔利亚/x", "value": { "a": 1 },
  { "op": "replace", "path": "/阿斯塔利亚/刊报日期", "value": "d2" }
]
</AddonJSONPatch>
后文`;
  const { ops, issues, failedFragments } = extractAddonJsonPatchOpsWithIssues(message);
  assert.equal(ops.length, 2);
  const healWithOp = issues.filter(i => i.kind === 'heal' && i.op);
  assert.equal(healWithOp.length, 1);
  assert.equal((healWithOp[0]!.op as { path: string }).path, '/阿斯塔利亚/x');
  assert.equal(failedFragments.length, 0);

  const { data } = applyParsedOps(baseWorld(), ops);
  assert.equal(_.get(data, '世界.阿斯塔利亚.刊报日期'), 'd2');
  assert.deepEqual(_.get(data, '世界.阿斯塔利亚.x'), { a: 1 });
});

test('extractAddonJsonPatchOpsWithIssues: skips orphan open in think', () => {
  const message = `<think>
确保 <UpdateVariable> 包含 <Analysis> 和 <AddonJSONPatch>。
</think>
<UpdateVariable>
<Analysis>新建社交圈</Analysis>
<AddonJSONPatch>
[
  { "op": "insert", "path": "/社交圈/帝国宫廷决策圈", "value": { "描述": "女皇中枢", "性质": "宫廷" } },
  { "op": "insert", "path": "/社交圈/潮汐王座地下暗网", "value": { "描述": "暗巷", "性质": "黑市" } }
]
</AddonJSONPatch>
</UpdateVariable>`;
  const { ops, failedFragments } = extractAddonJsonPatchOpsWithIssues(message);
  assert.equal(ops.length, 2);
  assert.equal((ops[0] as { path: string }).path, '/社交圈/帝国宫廷决策圈');
  assert.equal((ops[1] as { path: string }).path, '/社交圈/潮汐王座地下暗网');
  assert.equal(failedFragments.length, 0);

  const base = normalizeAddonData({ 社交圈: {}, 位面交汇: false });
  const { data } = applyParsedOps(base, ops);
  assert.equal(_.get(data, '社交圈.帝国宫廷决策圈.描述'), '女皇中枢');
  assert.equal(_.get(data, '社交圈.潮汐王座地下暗网.性质'), '黑市');
});

test('all ops with only missing braces heal successfully', () => {
  const raw = `[
    { "op": "insert", "path": "/a", "value": { "x": 1 },
    { "op": "replace", "path": "/b", "value": { "y": 2 }
  ]`;
  const { ops, issues, failedFragments } = parseJsonPatchOpsWithIssues(raw);
  assert.equal(ops.length, 2);
  const healWithOp = issues.filter(i => i.kind === 'heal' && i.op);
  assert.equal(healWithOp.length, 2);
  assert.ok(!issues.some(i => i.kind === 'heal' && !i.op && /已对\s*\d+\s*条/.test(i.message)));
  assert.equal(failedFragments.length, 0);
});

test('unclosed string still fails and snippet does not bleed', () => {
  const longValue = '字'.repeat(200);
  const raw = `[
    { "op": "insert", "path": "/阿斯塔利亚/传闻/坏条", "value": { "描述": "${longValue}", "流变历程": { "1": { "真相": "未闭合
    { "op": "replace", "path": "/阿斯塔利亚/刊报日期", "value": "d-ok" }
  ]`;
  const { ops, failedFragments, issues } = parseJsonPatchOpsWithIssues(raw);
  assert.equal(ops.length, 1);
  assert.ok(failedFragments.length >= 1);
  assert.ok(issues.some(i => i.kind === 'parse'));
  const frag = failedFragments[0]!;
  const opKeys = frag.snippet.match(/"op"\s*:/g) || [];
  assert.equal(opKeys.length, 1, `snippet should be single op, got: ${frag.snippet.slice(0, 120)}`);
  assert.ok(!frag.snippet.includes('/阿斯塔利亚/刊报日期'), 'snippet must not bleed into next op');
  assert.ok(frag.snippet.includes('/阿斯塔利亚/传闻/坏条'));
});

test('shape-invalid op still rejected by isLikelyPatchOp', () => {
  const raw = `[
    { "op": "insert", "path": "/阿斯塔利亚/a" },
    { "op": "replace", "path": "/阿斯塔利亚/刊报日期", "value": "ok" }
  ]`;
  const { ops, failedFragments, issues } = parseJsonPatchOpsWithIssues(raw);
  assert.equal(ops.length, 1);
  assert.equal((ops[0] as { path: string }).path, '/阿斯塔利亚/刊报日期');
  assert.ok(failedFragments.length >= 1 || issues.some(i => i.kind === 'parse'));
});

test('healed deep insert (multiple missing braces) applies', () => {
  const raw = `[
    { "op": "insert", "path": "/阿斯塔利亚/传闻/珍珠湾夜影", "value": { "影响力": "街头巷议", "流变历程": { "1": { "真相": "夜影初现", "流传": "码头" } },
    { "op": "replace", "path": "/阿斯塔利亚/刊报日期", "value": "新日" }
  ]`;
  const { ops, issues, failedFragments } = parseJsonPatchOpsWithIssues(raw);
  assert.equal(ops.length, 2);
  const healWithOp = issues.filter(i => i.kind === 'heal' && i.op);
  assert.equal(healWithOp.length, 1);
  assert.equal((healWithOp[0]!.op as { path: string }).path, '/阿斯塔利亚/传闻/珍珠湾夜影');
  assert.equal(failedFragments.length, 0);
  const { data } = applyParsedOps(baseWorld(), ops);
  assert.equal(_.get(data, '世界.阿斯塔利亚.刊报日期'), '新日');
  assert.equal(
    _.get(data, '世界.阿斯塔利亚.世界剧情态势.时局动态.传闻.珍珠湾夜影.影响力'),
    '街头巷议',
  );
});
