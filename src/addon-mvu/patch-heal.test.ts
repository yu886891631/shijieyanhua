import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import { applyMvuLikePatch } from './patch';
import { ensurePathForWrite, pathExists } from './patch-heal';
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

function applyOps(base: AddonData, ops: Parameters<typeof applyMvuLikePatch>[1]) {
  return applyMvuLikePatch(_.cloneDeep(base) as Record<string, unknown>, ops);
}

function assertNoPathMissingIssues(issues: { message: string }[]): void {
  assert.ok(!issues.some(i => i.message.includes('路径不存在')), issues.map(i => i.message).join('\n'));
}

function assertNormalizedValid(data: unknown): void {
  const parsed = AddonSchema.safeParse(data);
  assert.ok(parsed.success, parsed.success ? '' : String(parsed.error));
}

test('heal replace 团体 当前动态 when group missing', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'replace',
      path: '/世界/阿斯塔利亚/世界剧情态势/团体动态/当前区域团体/雾晶学院/当前动态',
      value: '正在招生',
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(_.get(data, '世界.阿斯塔利亚.世界剧情态势.团体动态.当前区域团体.雾晶学院.当前动态'), '正在招生');
  assertNormalizedValid(normalizeAddonData(data));
});

test('heal insert 事件脉络 date when event missing', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'insert',
      path: '/世界/阿斯塔利亚/世界剧情态势/时局动态/当前区域事件/雾晶港的暗流/事件脉络/复兴纪元-488年-06月-24日-15:45',
      value: '暗流涌动',
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(
    _.get(
      data,
      '世界.阿斯塔利亚.世界剧情态势.时局动态.当前区域事件.雾晶港的暗流.事件脉络.复兴纪元-488年-06月-24日-15:45',
    ),
    '暗流涌动',
  );
  assertNormalizedValid(normalizeAddonData(data));
});

test('heal insert 传闻 流变历程 when rumor missing', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'insert',
      path: '/世界/阿斯塔利亚/世界剧情态势/时局动态/传闻/旧塔的爆炸声/流变历程/2',
      value: {
        流变日期: '复兴纪元-488年-06月-24日',
        预计时效: '复兴纪元-488年-07月-24日',
        真相: '实验事故',
        传闻描述: '塔顶爆炸',
        事实偏差: '夸大',
        流变诱因: '目击者口述',
      },
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(
    _.get(data, '世界.阿斯塔利亚.世界剧情态势.时局动态.传闻.旧塔的爆炸声.流变历程.2.真相'),
    '实验事故',
  );
  assertNormalizedValid(normalizeAddonData(data));
});

test('heal replace 潜在时代演化 进度 when era missing', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'replace',
      path: '/世界/阿斯塔利亚/时代快讯/世界时局演进动态/潜在时代演化/魔导工业萌芽/进度',
      value: '45%',
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(
    _.get(data, '世界.阿斯塔利亚.时代快讯.世界时局演进动态.潜在时代演化.魔导工业萌芽.进度'),
    '45%',
  );
  assertNormalizedValid(normalizeAddonData(data));
});

test('heal replace 流通货币 汇率 when currency missing', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'replace',
      path: '/世界/阿斯塔利亚/世界经济简报/货币与金融/流通货币/兽盟币(BE)/汇率/本期',
      value: '1 BE = 1.20 AU',
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(
    _.get(data, '世界.阿斯塔利亚.世界经济简报.货币与金融.流通货币.兽盟币(BE).汇率.本期'),
    '1 BE = 1.20 AU',
  );
  assertNormalizedValid(normalizeAddonData(data));
});

test('heal replace 经济事件 when event missing', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'replace',
      path: '/世界/阿斯塔利亚/世界经济简报/经济事件/某城饥荒/描述',
      value: '粮价飞涨',
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(_.get(data, '世界.阿斯塔利亚.世界经济简报.经济事件.某城饥荒.描述'), '粮价飞涨');
  assertNormalizedValid(normalizeAddonData(data));
});

test('heal insert 正史 when chronicle missing', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'insert',
      path: '/世界/阿斯塔利亚/时代快讯/岁月史书/正史/环海争贡之乱',
      value: {
        前时代称谓: '封建',
        后时代称谓: '重商',
        演变起止: '复兴纪元-400年 ~ 复兴纪元-450年',
        描述: '诸港开战',
        历史影响: '贸易路线改道',
        关键转折: '某临界事件',
      },
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.ok(_.get(data, '世界.阿斯塔利亚.时代快讯.岁月史书.正史.环海争贡之乱'));
  assertNormalizedValid(normalizeAddonData(data));
});

test('heal batch child-before-parent ops', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'replace',
      path: '/世界/阿斯塔利亚/世界剧情态势/团体动态/世界背景团体/奥古斯提姆帝国/当前动态',
      value: '边境动员',
    },
    {
      op: 'replace',
      path: '/世界/阿斯塔利亚/世界剧情态势/时局动态/世界背景事件/北境冲突/参与角色',
      value: '某将领',
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(
    _.get(data, '世界.阿斯塔利亚.世界剧情态势.团体动态.世界背景团体.奥古斯提姆帝国.当前动态'),
    '边境动员',
  );
  assert.equal(
    _.get(data, '世界.阿斯塔利亚.世界剧情态势.时局动态.世界背景事件.北境冲突.参与角色'),
    '某将领',
  );
  assertNormalizedValid(normalizeAddonData(data));
});

test('reject missing world', () => {
  const base = baseWorld();
  const { issues } = applyOps(base, [
    { op: 'replace', path: '/世界/不存在世界/刊报日期', value: 'x' },
  ]);
  assert.ok(issues.some(i => i.message.includes('路径不存在')));
});

test('reject scalar child path 刊报日期/foo', () => {
  const base = baseWorld();
  const { issues } = applyOps(base, [
    { op: 'replace', path: '/世界/阿斯塔利亚/刊报日期/子路径', value: 'x' },
  ]);
  assert.ok(issues.some(i => i.message.includes('路径不存在')));
});

test('reject remove when parent path missing', () => {
  const base = baseWorld();
  const { issues } = applyOps(base, [
    { op: 'remove', path: '/世界/阿斯塔利亚/世界剧情态势/不存在分类/某事件' },
  ]);
  assert.ok(issues.some(i => i.message.includes('路径不存在')));
});

test('reject delta on missing path', () => {
  const base = baseWorld();
  const { issues } = applyOps(base, [
    { op: 'delta', path: '/世界/阿斯塔利亚/不存在/字段', value: 1 },
  ]);
  assert.ok(issues.some(i => i.message.includes('路径不存在')));
});

test('reject move.from missing', () => {
  const base = baseWorld();
  const { issues } = applyOps(base, [
    {
      op: 'move',
      from: '/世界/阿斯塔利亚/世界剧情态势/时局动态/传闻/不存在',
      to: '/世界/阿斯塔利亚/世界剧情态势/时局动态/传闻/新名',
    },
  ]);
  assert.ok(issues.some(i => i.message.includes('路径不存在')));
});

test('heal move.to missing parent', () => {
  const base = baseWorld();
  _.set(base, '世界.阿斯塔利亚.世界剧情态势.时局动态.传闻.旧闻.影响力', '局部焦点');
  const { data, issues } = applyOps(base, [
    {
      op: 'move',
      from: '/世界/阿斯塔利亚/世界剧情态势/时局动态/传闻/旧闻',
      to: '/世界/阿斯塔利亚/世界剧情态势/时局动态/传闻/新传闻名',
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(_.get(data, '世界.阿斯塔利亚.世界剧情态势.时局动态.传闻.新传闻名.影响力'), '局部焦点');
  assert.equal(_.get(data, '世界.阿斯塔利亚.世界剧情态势.时局动态.传闻.旧闻'), undefined);
});

test('heal insert 社交圈 当前动态 when circle missing', () => {
  const base = baseWorld();
  const { data, issues } = applyOps(base, [
    {
      op: 'insert',
      path: '/社交圈/码头苦力圈/当前动态',
      value: '因限流减船，众人商议绕开新税卡',
    },
  ]);
  assertNoPathMissingIssues(issues);
  assert.equal(_.get(data, '社交圈.码头苦力圈.当前动态'), '因限流减船，众人商议绕开新税卡');
  assertNormalizedValid(normalizeAddonData(data));
});

test('ensurePathForWrite materializes intermediate nodes', () => {
  const root = _.cloneDeep(baseWorld()) as Record<string, unknown>;
  const segments = ['世界', '阿斯塔利亚', '世界剧情态势', '团体动态', '当前区域团体', '新团体', '当前动态'];
  ensurePathForWrite(root, segments);
  assert.ok(pathExists(root, segments.slice(0, -1)));
  assert.ok(_.isPlainObject(_.get(root, '世界.阿斯塔利亚.世界剧情态势.团体动态.当前区域团体.新团体')));
});
