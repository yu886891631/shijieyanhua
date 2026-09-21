import assert from 'node:assert/strict';
import lodash from 'lodash';
import {
  defaultTimeInterval,
  mergeTaskSchedule,
  parseTaskSchedule,
} from './task-schedule-merge';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('mergeTaskSchedule round mode + roundInterval', () => {
  const merged = mergeTaskSchedule(undefined, { mode: 'round', roundInterval: 3 });
  assert.equal(merged.mode, 'round');
  assert.equal(merged.roundInterval, 3);
  assert.equal(merged.timeInterval?.enabled, false);
});

test('mergeTaskSchedule time mode enables timeInterval', () => {
  const merged = mergeTaskSchedule({ mode: 'round', roundInterval: 1 }, { mode: 'time' });
  assert.equal(merged.mode, 'time');
  assert.equal(merged.timeInterval?.enabled, true);
});

test('mergeTaskSchedule nested patch preserves unchanged fields', () => {
  const existing = {
    mode: 'time' as const,
    timeInterval: {
      ...defaultTimeInterval(),
      enabled: true,
      value: 5,
      unit: 'day' as const,
    },
  };
  const merged = mergeTaskSchedule(existing, {
    timeInterval: { value: 2 },
  });
  assert.equal(merged.timeInterval?.value, 2);
  assert.equal(merged.timeInterval?.unit, 'day');
});

test('parseTaskSchedule validates output', () => {
  const parsed = parseTaskSchedule(mergeTaskSchedule(undefined, { mode: 'round', roundInterval: 0 }));
  assert.equal(parsed.roundInterval, 0);
});
