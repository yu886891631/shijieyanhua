import assert from 'node:assert/strict';
import { shouldRunTask, updateScheduleStateAfterRun, type ScheduleContext } from './schedule';
import type { PostProcessTask, ScriptSettings } from './schema';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function makeTask(schedule: PostProcessTask['schedule']): PostProcessTask {
  return {
    id: 't1',
    name: 'task',
    enabled: true,
    stage: 1,
    extractInjectTags: ['result'],
    promptGroups: [],
    schedule,
  };
}

function makeCtx(overrides?: Partial<ScheduleContext>): ScheduleContext {
  return {
    currentRound: 5,
    currentAiText: '<time>第1天 08:00</time>',
    currentPairText: '<time>第1天 08:00</time>',
    settings: { scheduleState: {} } as ScriptSettings,
    bypassSchedule: false,
    ...overrides,
  };
}

test('round interval 0 runs every floor', () => {
  const task = makeTask({ mode: 'round', roundInterval: 0 });
  const ctx = makeCtx({ currentRound: 3 });
  assert.equal(shouldRunTask(task, undefined, ctx).run, true);
});

test('round interval 3 skips until gap met', () => {
  const task = makeTask({ mode: 'round', roundInterval: 3 });
  const ctx = makeCtx({ currentRound: 5 });
  assert.equal(shouldRunTask(task, { lastRunRound: 5, lastRunAt: 1, lastRunChatKey: 'c1' }, { ...ctx, chatKey: 'c1' }).run, false);
  assert.equal(shouldRunTask(task, { lastRunRound: 2, lastRunAt: 1, lastRunChatKey: 'c1' }, { ...ctx, chatKey: 'c1' }).run, true);
});

test('round interval first run without lastRunAt always allows', () => {
  const task = makeTask({ mode: 'round', roundInterval: 5 });
  const ctx = makeCtx({ currentRound: 1, chatKey: 'new' });
  assert.equal(shouldRunTask(task, undefined, ctx).run, true);
  assert.equal(shouldRunTask(task, { lastRunRound: 0 }, ctx).run, true);
});

test('round interval allows when chat key changes', () => {
  const task = makeTask({ mode: 'round', roundInterval: 5 });
  const state = { lastRunRound: 2, lastRunAt: 99, lastRunChatKey: 'old' };
  const ctx = makeCtx({ currentRound: 2, chatKey: 'new' });
  assert.equal(shouldRunTask(task, state, ctx).run, true);
  assert.equal(state.lastRunAt, undefined);
});

test('round interval heals round regression by allowing first run', () => {
  const task = makeTask({ mode: 'round', roundInterval: 2 });
  const state = { lastRunRound: 6, lastRunAt: 1, lastRunChatKey: 'c1' };
  const ctx = makeCtx({ currentRound: 4, chatKey: 'c1' });
  const check = shouldRunTask(task, state, ctx);
  assert.equal(check.run, true);
  assert.equal(state.lastRunAt, undefined);
  assert.equal(state.lastRunRound, 0);
});

test('time mode with message tag runs when parse ok', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 1,
      unit: 'hour',
      timeSource: { type: 'message_tag', tagNames: ['time'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx();
  assert.equal(shouldRunTask(task, undefined, ctx).run, true);
});

test('time mode skip when source missing', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 1,
      unit: 'hour',
      timeSource: { type: 'message_tag', tagNames: ['missing'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx();
  const check = shouldRunTask(task, undefined, ctx);
  assert.equal(check.run, false);
  assert.equal(check.reason, '读不到游戏时间，已跳过');
});

test('time mode skip includes remaining game time', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 1,
      unit: 'hour',
      timeSource: { type: 'message_tag', tagNames: ['time'], scope: 'current_ai' },
    },
  });
  // 第1天 08:00 → 上次；当前 08:30 → 还剩 30 分钟
  const lastMs = 1 * 86_400_000 + 8 * 3_600_000;
  const ctx = makeCtx({
    currentAiText: '<time>第1天 08:30</time>',
    currentPairText: '<time>第1天 08:30</time>',
  });
  const check = shouldRunTask(task, { lastRunRound: 1, lastRunGameTimeMs: lastMs }, ctx);
  assert.equal(check.run, false);
  assert.match(check.reason ?? '', /^游戏时间间隔未到，还剩 /);
  assert.ok(check.reason?.includes('30分钟'));
});

test('legacy onParseFail wall_clock still skips when source missing', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 1,
      unit: 'hour',
      timeSource: { type: 'message_tag', tagNames: ['missing'], scope: 'current_ai' },
      onParseFail: 'wall_clock',
    },
  });
  const ctx = makeCtx();
  const last = Date.now() - 15 * 60_000;
  const check = shouldRunTask(task, { lastRunRound: 0, lastRunAt: last }, ctx);
  assert.equal(check.run, false);
  assert.equal(check.reason, '读不到游戏时间，已跳过');
});

test('time mode skip when format unparseable', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 1,
      unit: 'hour',
      timeSource: { type: 'message_tag', tagNames: ['time'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx({
    currentAiText: '<time>不是时间</time>',
    currentPairText: '<time>不是时间</time>',
  });
  const check = shouldRunTask(task, undefined, ctx);
  assert.equal(check.run, false);
  assert.equal(check.reason, '游戏时间格式无法解析，已跳过');
});

test('time mode skip when time_only inadequate for week unit', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 1,
      unit: 'week',
      timeSource: { type: 'message_tag', tagNames: ['time'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx({
    currentAiText: '<time>15:48</time>',
    currentPairText: '<time>15:48</time>',
  });
  const check = shouldRunTask(task, undefined, ctx);
  assert.equal(check.run, false);
  assert.equal(check.reason, '游戏时间精度不足（当前间隔单位：周），已跳过');
});

test('updateScheduleStateAfterRun records round and game time', () => {
  const settings = { scheduleState: {} } as ScriptSettings;
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 1,
      unit: 'hour',
      timeSource: { type: 'message_tag', tagNames: ['time'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx({ currentRound: 7 });
  updateScheduleStateAfterRun(settings, task, ctx);
  assert.equal(settings.scheduleState.t1?.lastRunRound, 7);
  assert.ok(settings.scheduleState.t1?.lastRunGameTimeRaw);
});

test('time_only midnight wrap: 22:30 then 00:30 with 30min interval runs', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 30,
      unit: 'minute',
      timeSource: { type: 'message_tag', tagNames: ['tp'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx({
    currentAiText: '<tp>00:30</tp>',
    currentPairText: '<tp>00:30</tp>',
  });
  const state = {
    lastRunRound: 1,
    lastRunGameTimeRaw: '22:30',
  };
  const check = shouldRunTask(task, state, ctx);
  assert.equal(check.run, true);
  assert.equal(check.reason, undefined);
});

test('time_only same morning: 08:00 then 08:20 with 30min still skips ~10min', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 30,
      unit: 'minute',
      timeSource: { type: 'message_tag', tagNames: ['tp'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx({
    currentAiText: '<tp>08:20</tp>',
    currentPairText: '<tp>08:20</tp>',
  });
  const check = shouldRunTask(task, { lastRunRound: 1, lastRunGameTimeRaw: '08:00' }, ctx);
  assert.equal(check.run, false);
  assert.match(check.reason ?? '', /^游戏时间间隔未到，还剩 /);
  assert.ok(check.reason?.includes('10分钟'));
});

test('calendar same-day clock wrap runs after +1 day adjust', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 30,
      unit: 'minute',
      timeSource: { type: 'message_tag', tagNames: ['tp'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx({
    currentAiText: '<tp>2024-05-07 00:30</tp>',
    currentPairText: '<tp>2024-05-07 00:30</tp>',
  });
  const check = shouldRunTask(task, { lastRunRound: 1, lastRunGameTimeRaw: '2024-05-07 22:30' }, ctx);
  assert.equal(check.run, true);
});

test('yearless Dec31 to Jan1 runs after year-axis adjust', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 1,
      unit: 'day',
      timeSource: { type: 'message_tag', tagNames: ['tp'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx({
    currentAiText: '<tp>1月1日</tp>',
    currentPairText: '<tp>1月1日</tp>',
  });
  const check = shouldRunTask(task, { lastRunRound: 1, lastRunGameTimeRaw: '12月31日' }, ctx);
  assert.equal(check.run, true);
});

test('kind mismatch calendar last + time_only now heals and runs', () => {
  const task = makeTask({
    mode: 'time',
    timeInterval: {
      enabled: true,
      value: 30,
      unit: 'minute',
      timeSource: { type: 'message_tag', tagNames: ['tp'], scope: 'current_ai' },
    },
  });
  const ctx = makeCtx({
    currentAiText: '<tp>00:30</tp>',
    currentPairText: '<tp>00:30</tp>',
  });
  const state = {
    lastRunRound: 1,
    lastRunGameTimeRaw: '2024-05-07 22:30',
    lastRunGameTimeMs: 1,
  };
  const check = shouldRunTask(task, state, ctx);
  assert.equal(check.run, true);
  assert.equal(state.lastRunGameTimeRaw, undefined);
  assert.equal(state.lastRunGameTimeMs, undefined);
  assert.ok(!check.reason?.includes('年'));
});

if (process.exitCode) process.exit(process.exitCode);
