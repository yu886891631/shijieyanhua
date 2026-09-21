import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import { ADDON_KEY, normalizeAddonData } from './schema';
import { getAddonData, resolveAddonDataForRead, writeAddonData } from './store';

const floorVars: Record<number, Record<string, unknown>> = {};

(globalThis as any).getChatMessages = (id: number) => {
  if (typeof id === 'number' && id >= 0 && id <= 2) {
    return [{ message: '' }];
  }
  return [];
};

(globalThis as any).getVariables = (opt: { type: string; message_id: number }) => {
  return floorVars[opt.message_id] ?? {};
};

(globalThis as any).updateVariablesWith = (
  updater: (vars: Record<string, unknown>) => Record<string, unknown>,
  opt: { type: string; message_id: number },
) => {
  const next = updater({ ...(floorVars[opt.message_id] ?? {}) });
  floorVars[opt.message_id] = next;
};

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function resetFloors(): void {
  for (const k of Object.keys(floorVars)) {
    delete floorVars[Number(k)];
  }
}

test('resolveAddonDataForRead falls back to previous floor without writing', () => {
  resetFloors();
  const prev = normalizeAddonData({
    世界: { 阿斯塔利亚: { 降临: true, 平行演化: false, 刊报日期: '旧' } },
    位面交汇: false,
  });
  writeAddonData(0, prev);
  assert.equal(getAddonData(1), undefined);

  const resolved = resolveAddonDataForRead(1);
  assert.equal(_.get(resolved, '世界.阿斯塔利亚.刊报日期'), '旧');
  assert.equal(getAddonData(1), undefined, 'must not write current floor');
});

test('resolveAddonDataForRead does not fall back when key exists with empty worlds', () => {
  resetFloors();
  writeAddonData(
    0,
    normalizeAddonData({
      世界: { 阿斯塔利亚: { 降临: true, 平行演化: false } },
      位面交汇: false,
    }),
  );
  writeAddonData(1, normalizeAddonData({ 世界: {}, 位面交汇: false }));

  const resolved = resolveAddonDataForRead(1);
  assert.deepEqual(Object.keys(resolved.世界 ?? {}), []);
  assert.ok(floorVars[1]?.[ADDON_KEY], 'current floor key remains');
});

test('resolveAddonDataForRead floor 0 missing returns default empty', () => {
  resetFloors();
  const resolved = resolveAddonDataForRead(0);
  assert.deepEqual(Object.keys(resolved.世界 ?? {}), []);
  assert.equal(getAddonData(0), undefined);
});
