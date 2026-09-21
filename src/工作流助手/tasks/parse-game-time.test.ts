import assert from 'node:assert/strict';
import {
  adjustNowMsForScheduleCompare,
  chineseNumeralToInt,
  formatGameTimeFields,
  formatRemainingDuration,
  intervalToMs,
  isGameTimeAdequateForUnit,
  kindsCompatibleForSchedule,
  normalizeGameTimeRaw,
  parseGameTime,
  parseGameTimeToMs,
  peelRangeEnd,
} from './parse-game-time';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function assertAdequateAll(
  parsed: NonNullable<ReturnType<typeof parseGameTime>>,
  expectAll: boolean,
): void {
  for (const unit of ['minute', 'hour', 'day', 'week', 'month', 'year'] as const) {
    const ok = isGameTimeAdequateForUnit(parsed, unit);
    if (unit === 'minute' || unit === 'hour') {
      assert.equal(ok, true);
    } else {
      assert.equal(ok, expectAll, `unit=${unit}`);
    }
  }
}

test('formatRemainingDuration under one minute', () => {
  assert.equal(formatRemainingDuration(0), '不足1分钟');
  assert.equal(formatRemainingDuration(30_000), '不足1分钟');
  assert.equal(formatRemainingDuration(-100), '不足1分钟');
});

test('formatRemainingDuration minutes and hours', () => {
  assert.equal(formatRemainingDuration(intervalToMs(45, 'minute')), '45分钟');
  assert.equal(formatRemainingDuration(intervalToMs(2, 'hour') + intervalToMs(15, 'minute')), '2小时15分钟');
});

test('formatRemainingDuration days and hours max two parts', () => {
  const ms = intervalToMs(1, 'day') + intervalToMs(2, 'hour') + intervalToMs(30, 'minute');
  assert.equal(formatRemainingDuration(ms), '1天2小时');
});

test('chineseNumeralToInt common years', () => {
  assert.equal(chineseNumeralToInt('十'), 10);
  assert.equal(chineseNumeralToInt('十一'), 11);
  assert.equal(chineseNumeralToInt('二十'), 20);
  assert.equal(chineseNumeralToInt('一百'), 100);
  assert.equal(chineseNumeralToInt('二百三十'), 230);
  assert.equal(chineseNumeralToInt('一千'), 1000);
  assert.equal(chineseNumeralToInt('两千'), 2000);
  assert.equal(chineseNumeralToInt('488'), 488);
});

test('normalizeGameTimeRaw strips location and fullwidth digits, keeps pipe segment', () => {
  assert.equal(
    normalizeGameTimeRaw('复兴纪元488年-5月-14日-15:48 @ 某地| 晴'),
    '复兴纪元488年-5月-14日-15:48',
  );
  assert.equal(normalizeGameTimeRaw('２０２６-０６-３０ １５:４８'), '2026-06-30 15:48');
  assert.equal(
    normalizeGameTimeRaw('时间：2024-05-07 | 周二 15:30-18:00'),
    '2024-05-07 | 周二 15:30-18:00',
  );
  assert.equal(normalizeGameTimeRaw('2024-05-07\n15:30-18:00'), '2024-05-07 15:30-18:00');
});

test('normalizeGameTimeRaw prefers time-labeled line in multiline block', () => {
  const block = [
    '地点：县一中高二教室 & 校门口',
    '时间：2026年04月10日 周五 下午 17:05',
    '场景类型：SFW',
    '在场角色：',
    '- 珞珈|制服',
  ].join('\n');
  assert.equal(normalizeGameTimeRaw(block), '2026年04月10日 周五 下午 17:05');
});

test('peelRangeEnd takes right segment', () => {
  assert.equal(
    peelRangeEnd('自由纪元-427年-07月-12日 ~ 自由纪元-428年-01月-01日'),
    '自由纪元-428年-01月-01日',
  );
  assert.equal(peelRangeEnd('A — B'), 'B');
  assert.equal(peelRangeEnd('左端 - 右端'), '左端 - 右端');
  assert.equal(peelRangeEnd('在场角色： - 珞珈|制服'), '在场角色： - 珞珈|制服');
  assert.equal(
    peelRangeEnd('2024-05-07 15:00 - 2024-05-08 18:00'),
    '2024-05-08 18:00',
  );
  assert.equal(peelRangeEnd('单端日期'), '单端日期');
});

test('parseGameTime SceneInfo block with list dash', () => {
  const block = [
    '地点：县一中高二教室 & 校门口',
    '时间：2026年04月10日 周五 下午 17:05',
    '场景类型：SFW',
    '在场角色：',
    '- 珞珈|制服',
  ].join('\n');
  const r = parseGameTime(block);
  assert.ok(r);
  assert.equal(r.fields.year, 2026);
  assert.equal(r.fields.month, 4);
  assert.equal(r.fields.day, 10);
  assert.equal(r.fields.hour, 17);
  assert.equal(r.fields.minute, 5);
});

test('numeric_ymd gregorian uses calendar axis not Date.getTime', () => {
  const a = parseGameTime('2026-06-30 15:48');
  const b = parseGameTime('2026/06/30 15:48');
  assert.ok(a);
  assert.equal(a.rule, 'numeric_ymd');
  assert.equal(a.fields.year, 2026);
  assert.equal(a.fields.month, 6);
  assert.equal(a.fields.day, 30);
  assert.equal(a.fields.hour, 15);
  assert.equal(a.fields.minute, 48);
  assert.equal(a.ms, b?.ms);
  assert.notEqual(a.ms, new Date(2026, 5, 30, 15, 48, 0).getTime());
});

test('numeric_ymd chinese style leading year', () => {
  const r = parseGameTime('2026年6月30日15时30分');
  assert.ok(r);
  assert.equal(r.rule, 'numeric_ymd');
  assert.equal(r.fields.hour, 15);
  assert.equal(r.fields.minute, 30);
});

test('chinese_slash with chinese year', () => {
  const a = parseGameTime('新王国历十年-01/01/10:15');
  const b = parseGameTime('新王国历10年-01/01/10:15');
  assert.ok(a);
  assert.equal(a.rule, 'chinese_slash');
  assert.equal(a.fields.year, 10);
  assert.equal(a.fields.month, 1);
  assert.equal(a.fields.day, 1);
  assert.equal(a.fields.hour, 10);
  assert.equal(a.fields.minute, 15);
  assert.equal(a.ms, b?.ms);
});

test('chinese_slash spaced time equals slash time', () => {
  const a = parseGameTimeToMs('新王国历十年-01/01 10:15');
  const b = parseGameTimeToMs('新王国历十年-01/01/10:15');
  assert.ok(a != null);
  assert.equal(a, b);
});

test('chinese_slash dash month-day after year', () => {
  const a = parseGameTime('复兴纪元488年-5-14-15:48');
  const b = parseGameTime('复兴纪元488年-5月-14日-15:48');
  assert.ok(a);
  assert.equal(a.rule, 'chinese_slash');
  assert.ok(b);
  assert.equal(b.rule, 'chinese_ymd');
  assert.equal(a.ms, b.ms);
});

test('chinese_slash 元年', () => {
  const r = parseGameTime('无名纪元元年-01/01/10:15');
  assert.ok(r);
  assert.equal(r.rule, 'chinese_slash');
  assert.equal(r.fields.year, 1);
  assert.equal(r.fields.month, 1);
  assert.equal(r.fields.day, 1);
  assert.equal(r.fields.hour, 10);
  assert.equal(r.fields.minute, 15);
});

test('chinese_ymd classic fantasy calendar', () => {
  const r = parseGameTime('复兴纪元488年-5月-14日-星期三-15:48');
  assert.ok(r);
  assert.equal(r.rule, 'chinese_ymd');
  assert.equal(r.fields.year, 488);
  assert.equal(r.fields.month, 5);
  assert.equal(r.fields.day, 14);
  assert.equal(r.fields.hour, 15);
  assert.equal(r.fields.minute, 48);
});

test('chinese_ymd addon journal date', () => {
  const r = parseGameTime('自由纪元-427年-07月-12日');
  assert.ok(r);
  assert.equal(r.rule, 'chinese_ymd');
  assert.equal(r.fields.year, 427);
  assert.equal(r.fields.month, 7);
  assert.equal(r.fields.day, 12);
});

test('chinese_ymd chinese month and day', () => {
  const r = parseGameTime('复兴纪元十年十月十四日');
  assert.ok(r);
  assert.equal(r.rule, 'chinese_ymd');
  assert.equal(r.fields.year, 10);
  assert.equal(r.fields.month, 10);
  assert.equal(r.fields.day, 14);
});

test('chinese_ymd 正月初一', () => {
  const r = parseGameTime('新王国历十年正月初一');
  assert.ok(r);
  assert.equal(r.fields.year, 10);
  assert.equal(r.fields.month, 1);
  assert.equal(r.fields.day, 1);
});

test('chinese_ymd 元年 with weekday and clock', () => {
  const r = parseGameTime('无名纪元元年-01月-01日-星期一-14:00');
  assert.ok(r);
  assert.equal(r.rule, 'chinese_ymd');
  assert.equal(r.kind, 'calendar');
  assert.equal(r.fields.year, 1);
  assert.equal(r.fields.month, 1);
  assert.equal(r.fields.day, 1);
  assert.equal(r.fields.hour, 14);
  assert.equal(r.fields.minute, 0);
  assert.equal(isGameTimeAdequateForUnit(r, 'week'), true);
});

test('chinese_ymd 元年 with location and weather', () => {
  const r = parseGameTime(
    '无名纪元元年-01月-01日-星期一-14:00 @ 虚海边缘-未知区域-无阵营-边境聚落-老橡木酒馆-角落座位 | 阴冷，薄雾',
  );
  assert.ok(r);
  assert.equal(r.kind, 'calendar');
  assert.equal(r.fields.year, 1);
  assert.equal(r.fields.month, 1);
  assert.equal(r.fields.day, 1);
  assert.equal(r.fields.hour, 14);
  assert.equal(r.fields.minute, 0);
  assert.equal(isGameTimeAdequateForUnit(r, 'week'), true);
});

test('chinese_ymd month+day without year adequate for all units', () => {
  const r = parseGameTime('5月14日 15:48');
  assert.ok(r);
  assert.equal(r.rule, 'chinese_ymd');
  assert.equal(r.fields.year, undefined);
  assert.equal(r.fields.month, 5);
  assert.equal(r.fields.day, 14);
  assert.equal(r.fields.hour, 15);
  assert.equal(r.fields.minute, 48);
  assertAdequateAll(r, true);
});

test('chinese_ymd year only adequate for year', () => {
  const r = parseGameTime('复兴纪元488年');
  assert.ok(r);
  assert.equal(r.rule, 'chinese_ymd');
  assert.equal(r.fields.year, 488);
  assert.equal(r.fields.month, undefined);
  assert.equal(r.fields.day, undefined);
  assert.equal(isGameTimeAdequateForUnit(r, 'hour'), true);
  assert.equal(isGameTimeAdequateForUnit(r, 'day'), false);
  assert.equal(isGameTimeAdequateForUnit(r, 'week'), false);
  assert.equal(isGameTimeAdequateForUnit(r, 'month'), false);
  assert.equal(isGameTimeAdequateForUnit(r, 'year'), true);
});

test('chinese_ymd month only inadequate beyond hour', () => {
  const r = parseGameTime('5月');
  assert.ok(r);
  assert.equal(r.fields.month, 5);
  assert.equal(r.fields.year, undefined);
  assert.equal(r.fields.day, undefined);
  assert.equal(isGameTimeAdequateForUnit(r, 'hour'), true);
  assert.equal(isGameTimeAdequateForUnit(r, 'day'), false);
  assert.equal(isGameTimeAdequateForUnit(r, 'week'), false);
  assert.equal(isGameTimeAdequateForUnit(r, 'month'), false);
  assert.equal(isGameTimeAdequateForUnit(r, 'year'), false);
});

test('chinese_ymd day only inadequate beyond hour', () => {
  const r = parseGameTime('14日');
  assert.ok(r);
  assert.equal(r.fields.day, 14);
  assert.equal(r.fields.month, undefined);
  assert.equal(isGameTimeAdequateForUnit(r, 'hour'), true);
  assert.equal(isGameTimeAdequateForUnit(r, 'week'), false);
});

test('formatGameTimeFields omits missing calendar parts', () => {
  const md = parseGameTime('5月14日 15:48');
  assert.ok(md);
  assert.equal(formatGameTimeFields(md), '5月14日 15:48');
  const y = parseGameTime('复兴纪元488年');
  assert.ok(y);
  assert.equal(formatGameTimeFields(y), '488年');
});

test('dash_ymd shorthand', () => {
  const r = parseGameTime('488-5-14 15:48');
  assert.ok(r);
  assert.equal(r.rule, 'dash_ymd');
  assert.equal(r.fields.year, 488);
  assert.equal(r.fields.month, 5);
  assert.equal(r.fields.day, 14);
  assert.equal(r.fields.hour, 15);
  assert.equal(r.fields.minute, 48);
});

test('day_count', () => {
  const r = parseGameTime('第 3 天 8:30');
  assert.ok(r);
  assert.equal(r.rule, 'day_count');
  assert.equal(r.fields.dayIndex, 3);
  assert.equal(r.fields.hour, 8);
  assert.equal(r.fields.minute, 30);
  assert.equal(r.ms, 3 * intervalToMs(1, 'day') + 8 * intervalToMs(1, 'hour') + 30 * intervalToMs(1, 'minute'));
});

test('day_count adequate for all interval units', () => {
  const r = parseGameTime('第12天');
  assert.ok(r);
  assert.equal(r.kind, 'day_count');
  assertAdequateAll(r, true);
});

test('time_only', () => {
  const a = parseGameTime('15:48');
  const b = parseGameTime('15时30分');
  assert.ok(a);
  assert.equal(a.rule, 'time_only');
  assert.equal(a.ms, 15 * intervalToMs(1, 'hour') + 48 * intervalToMs(1, 'minute'));
  assert.ok(b);
  assert.equal(b.fields.minute, 30);
});

test('isGameTimeAdequateForUnit: time_only only for minute/hour', () => {
  const clock = parseGameTime('15:48');
  assert.ok(clock);
  assert.equal(isGameTimeAdequateForUnit(clock, 'minute'), true);
  assert.equal(isGameTimeAdequateForUnit(clock, 'hour'), true);
  assert.equal(isGameTimeAdequateForUnit(clock, 'day'), false);
  assert.equal(isGameTimeAdequateForUnit(clock, 'week'), false);
  assert.equal(isGameTimeAdequateForUnit(clock, 'month'), false);
  assert.equal(isGameTimeAdequateForUnit(clock, 'year'), false);
});

test('isGameTimeAdequateForUnit: chinese_ymd adequate for week', () => {
  const cal = parseGameTime('复兴纪元488年-5月-14日-15:48');
  assert.ok(cal);
  assert.equal(isGameTimeAdequateForUnit(cal, 'week'), true);
  assert.equal(isGameTimeAdequateForUnit(cal, 'day'), true);
  assert.equal(isGameTimeAdequateForUnit(cal, 'year'), true);
});

test('range peel then parse uses right end', () => {
  const r = parseGameTime('自由纪元-427年-07月-12日 ~ 自由纪元-428年-01月-01日');
  assert.ok(r);
  assert.equal(r.fields.year, 428);
  assert.equal(r.fields.month, 1);
  assert.equal(r.fields.day, 1);
});

test('unparseable returns null', () => {
  assert.equal(parseGameTimeToMs('不是时间'), null);
  assert.equal(parseGameTimeToMs(''), null);
});

test('mixed title with weekday and compact time range uses end clock', () => {
  const r = parseGameTime('时间：2024-05-07 | 周二 15:30-18:00');
  assert.ok(r);
  assert.equal(r.fields.year, 2024);
  assert.equal(r.fields.month, 5);
  assert.equal(r.fields.day, 7);
  assert.equal(r.fields.hour, 18);
  assert.equal(r.fields.minute, 0);
  assert.match(r.rule, /^numeric_ymd/);
});

test('multiline date then time range', () => {
  const r = parseGameTime('2024-05-07\n15:30-18:00');
  assert.ok(r);
  assert.equal(r.fields.day, 7);
  assert.equal(r.fields.hour, 18);
  assert.equal(r.fields.minute, 0);
});

test('time_only allows pipe weather residue', () => {
  const r = parseGameTime('15:48 | 晴');
  assert.ok(r);
  assert.equal(r.kind, 'time_only');
  assert.equal(r.fields.hour, 15);
  assert.equal(r.fields.minute, 48);
});

test('numeric_ymd prefers last date when multiple present', () => {
  const r = parseGameTime('记录 2020-01-01 当前 2024-05-07 | 18:00');
  assert.ok(r);
  assert.equal(r.fields.year, 2024);
  assert.equal(r.fields.month, 5);
  assert.equal(r.fields.day, 7);
  assert.equal(r.fields.hour, 18);
  assert.equal(r.fields.minute, 0);
});

test('location after at-sign still strips before parse', () => {
  const r = parseGameTime('复兴纪元488年-5月-14日-15:48 @ 某地| 晴');
  assert.ok(r);
  assert.equal(r.fields.year, 488);
  assert.equal(r.fields.hour, 15);
  assert.equal(r.fields.minute, 48);
});

test('intervalToMs month/year align with 31/372 calendar day axis', () => {
  assert.equal(intervalToMs(1, 'month'), 31 * intervalToMs(1, 'day'));
  assert.equal(intervalToMs(1, 'year'), 372 * intervalToMs(1, 'day'));
});

test('overnight clock range end encodes as next day', () => {
  const endOnly = parseGameTime('01:00');
  const overnight = parseGameTime('22:00-01:00');
  assert.ok(endOnly);
  assert.ok(overnight);
  assert.equal(overnight.kind, 'time_only');
  assert.equal(overnight.ms, endOnly.ms + intervalToMs(1, 'day'));
  assert.ok(overnight.ms > parseGameTime('22:00')!.ms);
});

test('overnight calendar range end encodes next calendar day', () => {
  const sameDayEnd = parseGameTime('2024-05-07 01:00');
  const overnight = parseGameTime('2024-05-07 22:00-01:00');
  assert.ok(sameDayEnd);
  assert.ok(overnight);
  assert.equal(overnight.ms, sameDayEnd.ms + intervalToMs(1, 'day'));
});

test('adjustNowMsForScheduleCompare time_only midnight wrap', () => {
  const last = parseGameTime('22:30')!;
  const now = parseGameTime('00:30')!;
  const adj = adjustNowMsForScheduleCompare(now, last);
  assert.equal(adj.adjusted, true);
  assert.equal(adj.nowMs, now.ms + intervalToMs(1, 'day'));
  assert.ok(adj.nowMs - last.ms === intervalToMs(2, 'hour'));
});

test('adjustNowMsForScheduleCompare calendar same-day clock wrap', () => {
  const last = parseGameTime('2024-05-07 22:30')!;
  const now = parseGameTime('2024-05-07 00:30')!;
  const adj = adjustNowMsForScheduleCompare(now, last);
  assert.equal(adj.adjusted, true);
  assert.ok(adj.nowMs > last.ms);
});

test('adjustNowMsForScheduleCompare yearless month wrap', () => {
  const last = parseGameTime('12月31日')!;
  const now = parseGameTime('1月1日')!;
  assert.ok(now.ms < last.ms);
  const adj = adjustNowMsForScheduleCompare(now, last);
  assert.equal(adj.adjusted, true);
  assert.ok(adj.nowMs >= last.ms);
});

test('kindsCompatibleForSchedule requires same kind', () => {
  assert.equal(kindsCompatibleForSchedule('time_only', 'time_only'), true);
  assert.equal(kindsCompatibleForSchedule('calendar', 'time_only'), false);
  assert.equal(kindsCompatibleForSchedule('day_count', 'calendar'), false);
});

if (process.exitCode) process.exit(process.exitCode);
