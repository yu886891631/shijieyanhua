import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import {
  makeSingularityKey,
  normalizeAddonArchive,
  remapArchiveWorldKeys,
  removeArchiveWorldKeys,
  type AddonArchive,
} from './archive';
import {
  activateSingularity,
  createWorld,
  deactivateSingularity,
  deleteWorld,
  reconcileSingularityAfterPatch,
  renameWorld,
  setWorldDescent,
  setWorldParallel,
} from './control';
import { stripAddonHiddenFieldsForDisplay } from './display';
import {
  applyMvuLikePatch,
  isForbiddenParallelEvolutionPath,
  isForbiddenPlaneMergePath,
  isForbiddenWorldRootPath,
} from './patch';
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

function worldWithSingularity(name: string, 降临 = false): AddonData {
  return normalizeAddonData({
    世界: {
      阿斯塔利亚: {
        降临: false,
        平行演化: false,
        时代快讯: {
          岁月史书: {
            特异点: {
              [name]: { 降临, 分歧源头: 'x' },
            },
          },
        },
      },
    },
    位面交汇: false,
  });
}

test('archive normalize defaults', () => {
  const a = normalizeAddonArchive(undefined);
  assert.equal(a.activeKey, null);
  assert.deepEqual(a.snapshots, {});
});

test('makeSingularityKey', () => {
  assert.equal(makeSingularityKey('A', 'B'), 'A/B');
});

test('activate singularity snapshots and mutual exclusive', () => {
  let data = normalizeAddonData({
    世界: {
      阿斯塔利亚: {
        时代快讯: {
          岁月史书: {
            特异点: {
              甲: { 降临: false },
              乙: { 降临: false },
            },
          },
        },
      },
    },
    位面交汇: false,
  });
  let archive: AddonArchive = { activeKey: null, snapshots: {} };
  const r1 = activateSingularity(data, archive, '阿斯塔利亚', '甲');
  data = r1.data;
  archive = r1.archive;
  assert.equal(archive.activeKey, '阿斯塔利亚/甲');
  assert.ok(archive.snapshots['阿斯塔利亚/甲']);
  assert.equal(_.get(data, '世界.阿斯塔利亚.时代快讯.岁月史书.特异点.甲.降临'), true);
  assert.equal(_.get(data, '世界.阿斯塔利亚.时代快讯.岁月史书.特异点.乙.降临'), false);

  const r2 = activateSingularity(data, archive, '阿斯塔利亚', '乙');
  data = r2.data;
  archive = r2.archive;
  assert.equal(archive.activeKey, '阿斯塔利亚/乙');
  assert.equal(_.get(data, '世界.阿斯塔利亚.时代快讯.岁月史书.特异点.甲.降临'), false);
  assert.equal(_.get(data, '世界.阿斯塔利亚.时代快讯.岁月史书.特异点.乙.降临'), true);
});

test('deactivate singularity restores snapshot', () => {
  let data = worldWithSingularity('风暴', false);
  _.set(data, '世界.阿斯塔利亚.刊报日期', 'before');
  let archive: AddonArchive = { activeKey: null, snapshots: {} };
  const act = activateSingularity(data, archive, '阿斯塔利亚', '风暴');
  data = act.data;
  archive = act.archive;
  _.set(data, '世界.阿斯塔利亚.刊报日期', 'during-singularity');
  const deact = deactivateSingularity(data, archive, '阿斯塔利亚', '风暴');
  assert.equal(deact.archive.activeKey, null);
  assert.equal(_.get(deact.data, '世界.阿斯塔利亚.刊报日期'), 'before');
  assert.equal(_.get(deact.data, '世界.阿斯塔利亚.时代快讯.岁月史书.特异点.风暴.降临'), false);
});

test('world descent mutual exclusive', () => {
  let data = normalizeAddonData({ 世界: { A: {}, B: {} }, 位面交汇: false });
  data = setWorldDescent(data, 'A', true);
  assert.equal(data.世界.A?.降临, true);
  assert.equal(data.世界.B?.降临, false);
  data = setWorldDescent(data, 'B', true);
  assert.equal(data.世界.A?.降临, false);
  assert.equal(data.世界.B?.降临, true);
});

test('setWorldParallel only toggles parallel', () => {
  let data = normalizeAddonData({ 世界: { A: { 降临: true } }, 位面交汇: false });
  data = setWorldParallel(data, 'A', true);
  assert.equal(data.世界.A?.平行演化, true);
  assert.equal(data.世界.A?.降临, true);
});

test('createWorld and renameWorld', () => {
  let data = normalizeAddonData({});
  data = createWorld(data, '新世界');
  assert.ok(data.世界['新世界']);
  assert.equal(data.世界['新世界']?.降临, false);
  assert.equal(data.世界['新世界']?.平行演化, false);

  let archive: AddonArchive = {
    activeKey: '新世界/点',
    snapshots: { '新世界/点': _.cloneDeep(data) },
  };
  const renamed = renameWorld(data, archive, '新世界', '改名世界');
  assert.ok(renamed.data.世界['改名世界']);
  assert.equal(renamed.data.世界['新世界'], undefined);
  assert.equal(renamed.archive.activeKey, '改名世界/点');
  assert.ok(renamed.archive.snapshots['改名世界/点']);
});

test('deleteWorld removes data key and archive entries', () => {
  let data = normalizeAddonData({
    世界: {
      甲: { 刊报日期: '1' },
      乙: { 刊报日期: '2' },
    },
    位面交汇: false,
  });
  const archive: AddonArchive = {
    activeKey: '甲/特异点',
    snapshots: {
      '甲/特异点': _.cloneDeep(data),
      '乙/另一点': normalizeAddonData({
        世界: { 甲: { 刊报日期: 'x' }, 乙: { 刊报日期: 'y' } },
        位面交汇: false,
      }),
    },
  };
  const deleted = deleteWorld(data, archive, '甲');
  assert.equal(deleted.data.世界['甲'], undefined);
  assert.ok(deleted.data.世界['乙']);
  assert.equal(deleted.archive.activeKey, null);
  assert.equal(deleted.archive.snapshots['甲/特异点'], undefined);
  assert.ok(deleted.archive.snapshots['乙/另一点']);
  assert.equal(deleted.archive.snapshots['乙/另一点']?.世界['甲'], undefined);
  assert.ok(deleted.archive.snapshots['乙/另一点']?.世界['乙']);

  assert.throws(() => deleteWorld(data, archive, '不存在'), /世界不存在/);
  assert.throws(() => deleteWorld(data, archive, '  '), /世界名不能为空/);
});

test('removeArchiveWorldKeys', () => {
  const archive: AddonArchive = {
    activeKey: '旧/甲',
    snapshots: {
      '旧/甲': normalizeAddonData({ 世界: { 旧: { 刊报日期: '1' }, 他: {} }, 位面交汇: false }),
      '他/乙': normalizeAddonData({ 世界: { 旧: { 刊报日期: '2' }, 他: {} }, 位面交汇: false }),
    },
  };
  const next = removeArchiveWorldKeys(archive, '旧');
  assert.equal(next.activeKey, null);
  assert.equal(next.snapshots['旧/甲'], undefined);
  assert.ok(next.snapshots['他/乙']);
  assert.equal(next.snapshots['他/乙']?.世界['旧'], undefined);
});

test('remapArchiveWorldKeys', () => {
  const archive: AddonArchive = {
    activeKey: '旧/甲',
    snapshots: {
      '旧/甲': normalizeAddonData({ 世界: { 旧: { 刊报日期: '1' } }, 位面交汇: false }),
    },
  };
  const next = remapArchiveWorldKeys(archive, '旧', '新');
  assert.equal(next.activeKey, '新/甲');
  assert.ok(next.snapshots['新/甲']?.世界['新']);
});

test('reconcileSingularityAfterPatch activate', () => {
  const oldData = worldWithSingularity('甲', false);
  const newData = _.cloneDeep(oldData);
  _.set(newData, '世界.阿斯塔利亚.时代快讯.岁月史书.特异点.甲.降临', true);
  const result = reconcileSingularityAfterPatch(oldData, newData, { activeKey: null, snapshots: {} });
  assert.equal(result.archive.activeKey, '阿斯塔利亚/甲');
  assert.equal(_.get(result.data, '世界.阿斯塔利亚.时代快讯.岁月史书.特异点.甲.降临'), true);
});

test('patch rejects world parallel evolution', () => {
  assert.equal(isForbiddenParallelEvolutionPath(['世界', '某世界', '平行演化']), true);
  assert.equal(isForbiddenParallelEvolutionPath(['世界', '某世界', '降临']), false);
  assert.equal(
    isForbiddenParallelEvolutionPath(['世界', '某世界', '时代快讯', '岁月史书', '特异点', '甲', '降临']),
    false,
  );

  const base = normalizeAddonData({ 世界: { 某世界: { 平行演化: false, 降临: false } }, 位面交汇: false });
  const { data, issues } = applyMvuLikePatch(_.cloneDeep(base) as Record<string, unknown>, [
    { op: 'replace', path: '/世界/某世界/平行演化', value: true },
    { op: 'replace', path: '/世界/某世界/降临', value: true },
  ]);
  assert.equal(_.get(data, '世界.某世界.平行演化'), false);
  assert.equal(_.get(data, '世界.某世界.降临'), true);
  assert.ok(issues.some(i => i.message.includes('平行演化')));
});

test('patch rejects world root create', () => {
  assert.equal(isForbiddenWorldRootPath(['世界']), true);
  assert.equal(isForbiddenWorldRootPath(['世界', '新世界']), true);
  assert.equal(isForbiddenWorldRootPath(['世界', '某世界', '刊报日期']), false);
  assert.equal(isForbiddenPlaneMergePath(['位面交汇']), true);

  const base = normalizeAddonData({ 世界: { 某世界: { 降临: false } }, 位面交汇: false });
  const { data, issues } = applyMvuLikePatch(_.cloneDeep(base) as Record<string, unknown>, [
    { op: 'insert', path: '/世界/新世界', value: { 降临: true } },
    {
      op: 'insert',
      path: '/世界/某世界/世界剧情态势/时局动态/世界背景事件/新事件',
      value: {
        叙事指导: { 宏观层: '', 发展层: '', 细节层: '' },
        参与角色: '',
        牵涉团体: '',
        事件脉络: {},
        结算条件: '',
      },
    },
  ]);
  assert.equal(data.世界?.['新世界'], undefined);
  assert.ok(_.get(data, '世界.某世界.世界剧情态势.时局动态.世界背景事件.新事件'));
  assert.ok(issues.some(i => i.message.includes('世界键')));
});

test('patch allows singularity descent', () => {
  const base = worldWithSingularity('甲', false);
  const { data, issues } = applyMvuLikePatch(_.cloneDeep(base) as Record<string, unknown>, [
    { op: 'replace', path: '/世界/阿斯塔利亚/时代快讯/岁月史书/特异点/甲/降临', value: true },
  ]);
  assert.equal(issues.length, 0);
  assert.equal(_.get(data, '世界.阿斯塔利亚.时代快讯.岁月史书.特异点.甲.降临'), true);
});

test('display strips 平行演化', () => {
  const data = normalizeAddonData({ 世界: { A: { 平行演化: true, 降临: true } }, 位面交汇: false });
  const stripped = stripAddonHiddenFieldsForDisplay(data) as Record<string, unknown>;
  assert.equal(_.get(stripped, '世界.A.平行演化'), undefined);
  assert.equal(_.get(stripped, '世界.A.降临'), true);
  assert.equal('位面交汇' in stripped, false);
});
