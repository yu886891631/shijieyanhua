import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import { applyMvuLikePatch } from './patch';
import {
  canonicalizeJsonPointer,
  canonicalizePatchOps,
  canonicalizeSegments,
  formatPathCanonicalizeHealMessage,
  significantPathRewrites,
  verifyCanonicalWrites,
} from './patch-canonicalize';
import { AddonSchema, normalizeAddonData, type AddonData } from './schema';

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
      },
    },
    位面交汇: false,
  });
}

function applyCanonOps(base: AddonData, ops: Parameters<typeof applyMvuLikePatch>[1]) {
  const { ops: canonOps } = canonicalizePatchOps(ops, base);
  return applyMvuLikePatch(_.cloneDeep(base) as Record<string, unknown>, canonOps);
}

function assertNormalizedValid(data: unknown): void {
  const parsed = AddonSchema.safeParse(data);
  assert.ok(parsed.success, parsed.success ? '' : String(parsed.error));
}

test('canonicalize 贸易政策缺层 inserts 贸易格局', () => {
  const { path } = canonicalizeJsonPointer('/阿斯塔利亚/世界经济简报/贸易政策/奥古斯提姆帝国');
  assert.equal(path, '/世界/阿斯塔利亚/世界经济简报/贸易格局/贸易政策/奥古斯提姆帝国');
});

test('canonicalize 主要商路缺层 inserts 贸易格局', () => {
  const { path } = canonicalizeJsonPointer('/阿斯塔利亚/世界经济简报/主要商路/环海航线/状态');
  assert.equal(path, '/世界/阿斯塔利亚/世界经济简报/贸易格局/主要商路/环海航线/状态');
});

test('canonicalize 流通货币缺层 inserts 货币与金融', () => {
  const { path } = canonicalizeJsonPointer('/阿斯塔利亚/世界经济简报/流通货币/兽盟币(BE)/汇率/本期');
  assert.equal(path, '/世界/阿斯塔利亚/世界经济简报/货币与金融/流通货币/兽盟币(BE)/汇率/本期');
});

test('canonicalize 潜在时代演化缺层 inserts 世界时局演进动态', () => {
  const { path } = canonicalizeJsonPointer('/阿斯塔利亚/时代快讯/潜在时代演化/魔导工业萌芽/进度');
  assert.equal(path, '/世界/阿斯塔利亚/时代快讯/世界时局演进动态/潜在时代演化/魔导工业萌芽/进度');
});

test('canonicalize 已正确路径仅补容器段', () => {
  const original = '/阿斯塔利亚/世界经济简报/贸易格局/贸易政策/奥古斯提姆帝国';
  const { path, rewrites } = canonicalizeJsonPointer(original);
  assert.equal(path, '/世界/阿斯塔利亚/世界经济简报/贸易格局/贸易政策/奥古斯提姆帝国');
  assert.deepEqual(rewrites, ['补容器段 /世界']);
});

test('canonicalize 社交圈 显式容器 不应改写', () => {
  const { path, rewrites } = canonicalizeJsonPointer('/社交圈/码头苦力圈/当前动态');
  assert.equal(path, '/社交圈/码头苦力圈/当前动态');
  assert.deepEqual(rewrites, []);
});

test('canonicalize 歧义固定段 状态 不补层', () => {
  const original = '/阿斯塔利亚/世界经济简报/状态';
  const { path, rewrites } = canonicalizeJsonPointer(original);
  assert.equal(path, '/世界/阿斯塔利亚/世界经济简报/状态');
  assert.deepEqual(rewrites, ['补容器段 /世界']);
});

test('canonicalize move from/to 均补层', () => {
  const base = baseWorld();
  _.set(base, '世界.阿斯塔利亚.世界经济简报.贸易格局.贸易政策.旧势力', '禁运');
  const { ops } = canonicalizePatchOps(
    [
      {
        op: 'move',
        from: '/阿斯塔利亚/世界经济简报/贸易政策/旧势力',
        to: '/阿斯塔利亚/世界经济简报/贸易政策/新势力',
      },
    ],
    base,
  );
  assert.equal(ops[0]?.from, '/世界/阿斯塔利亚/世界经济简报/贸易格局/贸易政策/旧势力');
  assert.equal(ops[0]?.to, '/世界/阿斯塔利亚/世界经济简报/贸易格局/贸易政策/新势力');
});

test('e2e insert 贸易政策缺层 writes after normalize', () => {
  const base = baseWorld();
  const { data, issues } = applyCanonOps(base, [
    {
      op: 'insert',
      path: '/阿斯塔利亚/世界经济简报/贸易政策/奥古斯提姆帝国',
      value: '降低关税',
    },
  ]);
  assert.ok(!issues.some(i => i.message.includes('路径不存在')));
  const normalized = normalizeAddonData(data);
  assert.equal(_.get(normalized, '世界.阿斯塔利亚.世界经济简报.贸易格局.贸易政策.奥古斯提姆帝国'), '降低关税');
  assertNormalizedValid(normalized);
  assert.equal(
    verifyCanonicalWrites(
      [
        {
          op: 'insert',
          path: '/世界/阿斯塔利亚/世界经济简报/贸易格局/贸易政策/奥古斯提姆帝国',
          value: '降低关税',
        },
      ],
      normalized,
    ).length,
    0,
  );
});

test('e2e replace 流通货币缺层 writes nested field', () => {
  const base = baseWorld();
  const { data, issues } = applyCanonOps(base, [
    {
      op: 'replace',
      path: '/阿斯塔利亚/世界经济简报/流通货币/兽盟币(BE)/汇率/本期',
      value: '1 BE = 1.20 AU',
    },
  ]);
  assert.ok(!issues.some(i => i.message.includes('路径不存在')));
  const normalized = normalizeAddonData(data);
  assert.equal(
    _.get(normalized, '世界.阿斯塔利亚.世界经济简报.货币与金融.流通货币.兽盟币(BE).汇率.本期'),
    '1 BE = 1.20 AU',
  );
  assertNormalizedValid(normalized);
});

test('canonicalizeSegments preserves world name', () => {
  const { segments } = canonicalizeSegments(['阿斯塔利亚', '时代快讯', '岁月史书', '正史', '某纪']);
  assert.deepEqual(segments, ['阿斯塔利亚', '时代快讯', '岁月史书', '正史', '某纪']);
});

test('canonicalizePatchOps world-prefix-only emits no issue', () => {
  const { ops, issues } = canonicalizePatchOps(
    [{ op: 'replace', path: '/阿斯塔利亚/刊报日期', value: '复兴纪元-488年-06月-05日' }],
    baseWorld(),
  );
  assert.equal(ops[0]?.path, '/世界/阿斯塔利亚/刊报日期');
  assert.equal(issues.length, 0);
});

test('significantPathRewrites drops world prefix and dedupes', () => {
  assert.deepEqual(
    significantPathRewrites(['补容器段 /世界', '补全固定段 /贸易格局', '补容器段 /世界', '补全固定段 /贸易格局']),
    ['补全固定段 /贸易格局'],
  );
});

test('formatPathCanonicalizeHealMessage puts reasons first', () => {
  assert.equal(
    formatPathCanonicalizeHealMessage('/a → /世界/a/x', ['补容器段 /世界', '补全固定段 /大宗商品市场']),
    '补全固定段 /大宗商品市场: /a → /世界/a/x',
  );
  assert.equal(formatPathCanonicalizeHealMessage('/a → /世界/a', ['补容器段 /世界']), '路径规范化: /a → /世界/a');
});

test('canonicalizePatchOps emits heal with fixed-segment reason first', () => {
  const { ops, issues } = canonicalizePatchOps(
    [{ op: 'replace', path: '/阿斯塔利亚/世界经济简报/贸易政策/帝国', value: 'x' }],
    baseWorld(),
  );
  const heal = issues.find(i => i.kind === 'heal');
  assert.ok(heal);
  assert.ok(heal!.message.startsWith('补全固定段 /贸易格局:'));
  assert.ok(heal!.message.includes('/阿斯塔利亚/世界经济简报/贸易政策/帝国 →'));
  assert.equal(
    (heal!.op as { path: string }).path,
    '/世界/阿斯塔利亚/世界经济简报/贸易格局/贸易政策/帝国',
  );
  assert.deepEqual(heal!.op, ops[0]);
});

test('canonicalizePatchOps heal message for 大宗商品市场', () => {
  const { issues } = canonicalizePatchOps(
    [{ op: 'replace', path: '/阿斯塔利亚/世界经济简报/粮食/供需', value: '紧缺' }],
    baseWorld(),
  );
  const heal = issues.find(i => i.kind === 'heal');
  assert.ok(heal);
  assert.ok(heal!.message.startsWith('补全固定段 /大宗商品市场:'));
  assert.equal(
    (heal!.op as { path: string }).path,
    '/世界/阿斯塔利亚/世界经济简报/大宗商品市场/粮食/供需',
  );
});

test('canonicalizePatchOps heal message for 货币与金融', () => {
  const { issues } = canonicalizePatchOps(
    [{ op: 'replace', path: '/阿斯塔利亚/世界经济简报/流通货币/兽盟币(BE)/汇率/本期', value: '1' }],
    baseWorld(),
  );
  const heal = issues.find(i => i.kind === 'heal');
  assert.ok(heal);
  assert.ok(heal!.message.startsWith('补全固定段 /货币与金融:'));
});

test('canonicalizePatchOps move heal dedupes fixed-segment reason', () => {
  const { issues } = canonicalizePatchOps(
    [
      {
        op: 'move',
        from: '/阿斯塔利亚/世界经济简报/贸易政策/旧势力',
        to: '/阿斯塔利亚/世界经济简报/贸易政策/新势力',
      },
    ],
    baseWorld(),
  );
  const heal = issues.find(i => i.kind === 'heal');
  assert.ok(heal);
  assert.ok(heal!.message.startsWith('补全固定段 /贸易格局:'));
  assert.equal((heal!.message.match(/补全固定段 \/贸易格局/g) ?? []).length, 1);
});
