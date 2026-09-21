/** 与 encodeCalendarMs 日轴对齐：月=31 日，年=12×31=372 日 */
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 31 * 86_400_000,
  year: 372 * 86_400_000,
};

const MS_PER_MIN = UNIT_MS.minute;

const CN_NUM_CHARS = '一二三四五六七八九十百千万两零〇';
const CN_NUM_CLASS = `[${CN_NUM_CHARS}]`;

const TIME_LABEL_PREFIX_RE = /^(?:时间|当前时间|游戏时间)\s*[:：]\s*/;

export type GameTimeKind = 'calendar' | 'day_count' | 'time_only';

export interface GameTimeFields {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  /** day_count 用：第 N 天 */
  dayIndex?: number;
}

export interface GameTimeParseResult {
  ms: number;
  kind: GameTimeKind;
  fields: GameTimeFields;
  rule: string;
  normalized: string;
}

type MatcherHit = {
  kind: GameTimeKind;
  fields: GameTimeFields;
  rule: string;
};

type ClockHit = {
  /** 结束时刻（时段取右端；单时刻即自身） */
  hour: number;
  minute: number;
  /** 时段起点（fromRange 时有值；用于跨夜 +1 日） */
  rangeStartHour?: number;
  rangeStartMinute?: number;
  start: number;
  end: number;
  fromRange: boolean;
};

/** 时段右端早于左端 → 结束落在次日 */
function overnightDayOffset(clock: ClockHit | null): number {
  if (!clock?.fromRange || clock.rangeStartHour == null || clock.rangeStartMinute == null) return 0;
  const startMin = clock.rangeStartHour * 60 + clock.rangeStartMinute;
  const endMin = clock.hour * 60 + clock.minute;
  return endMin < startMin ? 1 : 0;
}

/** 将年月日时分编码为可比较的毫秒值（游戏内日历轴，非 Unix 时间戳） */
function encodeCalendarMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const y = Math.max(0, Math.floor(year));
  const mo = Math.min(12, Math.max(1, Math.floor(month)));
  const d = Math.min(31, Math.max(1, Math.floor(day)));
  const h = Math.min(23, Math.max(0, Math.floor(hour)));
  const mi = Math.min(59, Math.max(0, Math.floor(minute)));
  const dayIndex = y * 372 + (mo - 1) * 31 + (d - 1);
  return ((dayIndex * 24 + h) * 60 + mi) * MS_PER_MIN;
}

function encodeHit(hit: MatcherHit): number {
  const { kind, fields } = hit;
  if (kind === 'day_count') {
    const day = fields.dayIndex ?? 0;
    const hour = fields.hour ?? 0;
    const minute = fields.minute ?? 0;
    return day * UNIT_MS.day + hour * UNIT_MS.hour + minute * UNIT_MS.minute;
  }
  if (kind === 'time_only') {
    return (fields.hour ?? 0) * UNIT_MS.hour + (fields.minute ?? 0) * UNIT_MS.minute;
  }
  return encodeCalendarMs(
    fields.year ?? 0,
    fields.month ?? 1,
    fields.day ?? 1,
    fields.hour ?? 0,
    fields.minute ?? 0,
  );
}

function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
}

/** 行首「时间/当前时间/游戏时间：」后内容（多行块优先截取该行） */
const TIME_LABELED_LINE_RE = /(?:^|\n)\s*(?:时间|当前时间|游戏时间)\s*[:：]\s*(.+)/;

/**
 * 最小清洗：全角数字、折叠空白（含换行）、剥时间标签前缀、@ 后当地点截断。
 * 多行块若含「时间：」行则只保留该行内容。不截断 `|`（周几/时段/天气留给抽取器忽略）。
 */
export function normalizeGameTimeRaw(raw: string): string {
  let text = String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!text) return '';
  text = toHalfWidthDigits(text);
  const labeled = text.match(TIME_LABELED_LINE_RE);
  if (labeled?.[1]) {
    text = labeled[1].replace(/\n[\s\S]*$/, '').trim();
  }
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(TIME_LABEL_PREFIX_RE, '').trim();
  const at = text.indexOf('@');
  if (at >= 0) text = text.slice(0, at).trim();
  return text;
}

/** 轻量判断片段是否像日期/时刻（供空格短横线区间剥离） */
function looksLikeTemporal(segment: string): boolean {
  const s = segment.trim();
  if (!s) return false;
  return (
    /\d{4}\s*年/.test(s) ||
    /(?:\d+|[一二三四五六七八九十百千万两零〇]+)\s*年/.test(s) ||
    /第?\s*\d+\s*天/.test(s) ||
    /\d{1,2}\s*[:：时]\s*\d{1,2}/.test(s) ||
    /\d{3,}\s*-\s*\d{1,2}\s*-\s*\d{1,2}/.test(s) ||
    /\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}/.test(s)
  );
}

/**
 * 整段日期区间取右端（结束端）；不含无空格的 HH:mm-HH:mm。
 * `~`/`～`/`—` 直接取右段；空格短横线仅当相邻两端都像时间时才切（避免 Markdown 列表 `- item`）。
 */
export function peelRangeEnd(text: string): string {
  for (const re of [/\s*[~～]\s+/, /\s+—\s+/]) {
    if (!re.test(text)) continue;
    const parts = text
      .split(re)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1]!;
  }

  const dashRe = /\s+-\s+/;
  if (dashRe.test(text)) {
    const parts = text
      .split(dashRe)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]!;
      const prev = parts[parts.length - 2]!;
      if (looksLikeTemporal(last) && looksLikeTemporal(prev)) return last;
    }
  }
  return text;
}

function lastMatch(text: string, re: RegExp): RegExpExecArray | null {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    last = m;
    if (m[0].length === 0) global.lastIndex += 1;
  }
  return last;
}

function maskSpan(text: string, start: number, end: number): string {
  if (start < 0 || end <= start || start >= text.length) return text;
  const to = Math.min(end, text.length);
  return `${text.slice(0, start)}${' '.repeat(to - start)}${text.slice(to)}`;
}

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 将常见中文数字（约 0–9999）转为整数；无法识别时返回 null */
export function chineseNumeralToInt(raw: string): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);

  let total = 0;
  let section = 0;
  let num = 0;
  let hasDigit = false;

  for (const ch of s) {
    if (ch in CN_DIGIT) {
      num = CN_DIGIT[ch];
      hasDigit = true;
      continue;
    }
    if (ch === '十') {
      section += (num || 1) * 10;
      num = 0;
      hasDigit = true;
      continue;
    }
    if (ch === '百') {
      section += (num || 1) * 100;
      num = 0;
      hasDigit = true;
      continue;
    }
    if (ch === '千') {
      section += (num || 1) * 1000;
      num = 0;
      hasDigit = true;
      continue;
    }
    if (ch === '万') {
      total += (section + num) * 10_000;
      section = 0;
      num = 0;
      hasDigit = true;
      continue;
    }
    return null;
  }

  if (!hasDigit) return null;
  return total + section + num;
}

function parseMonthToken(tok: string): number | null {
  if (tok === '正') return 1;
  if (tok === '腊') return 12;
  return chineseNumeralToInt(tok);
}

function parseDayToken(tok: string): number | null {
  if (tok.startsWith('初')) {
    const rest = tok.slice(1);
    if (rest === '十') return 10;
    return chineseNumeralToInt(rest);
  }
  return chineseNumeralToInt(tok);
}

const YEAR_TOKEN_RE = new RegExp(`(?:(\\d+)|(元)|(${CN_NUM_CLASS}+))\\s*年`);

function parseYearFromText(text: string): number | null {
  const m = text.match(YEAR_TOKEN_RE);
  if (!m) return null;
  if (m[1] != null) return Number(m[1]);
  if (m[2] != null) return 1;
  return chineseNumeralToInt(m[3]!);
}

/** 先抽时间段（取右端），否则取最后一个单时刻 */
function extractClockOrRange(text: string): ClockHit | null {
  const hits: ClockHit[] = [];

  const rangePatterns = [
    /(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~～—]\s*(\d{1,2})\s*[:：]\s*(\d{2})/g,
    /(\d{1,2})\s*时\s*(\d{1,2})\s*分?\s*[-~～—]\s*(\d{1,2})\s*时\s*(\d{1,2})\s*分?/g,
  ];
  for (const re of rangePatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({
        hour: Number(m[3]),
        minute: Number(m[4]),
        rangeStartHour: Number(m[1]),
        rangeStartMinute: Number(m[2]),
        start: m.index,
        end: m.index + m[0].length,
        fromRange: true,
      });
    }
  }

  const singlePatterns = [
    /(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*\d{2})?/g,
    /(\d{1,2})\s*时\s*(\d{1,2})\s*分?/g,
  ];
  for (const re of singlePatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const insideRange = hits.some(h => h.fromRange && start >= h.start && end <= h.end);
      if (insideRange) continue;
      hits.push({
        hour: Number(m[1]),
        minute: Number(m[2]),
        start,
        end,
        fromRange: false,
      });
    }
  }

  if (!hits.length) return null;
  hits.sort((a, b) => a.end - b.end || Number(a.fromRange) - Number(b.fromRange));
  return hits[hits.length - 1]!;
}

function applyPreferredClock(fields: GameTimeFields, clock: ClockHit | null): GameTimeFields {
  if (!clock) return fields;
  return { ...fields, hour: clock.hour, minute: clock.minute };
}

function withRuleSuffix(rule: string, clock: ClockHit | null): string {
  if (clock?.fromRange) return `${rule}+range`;
  return rule;
}

/** 公历/数字年月日：串内取最后一次完整匹配 */
function matchNumericYmd(text: string, clock: ClockHit | null): MatcherHit | null {
  if (/年|星期|纪元|第\s*\d+\s*天/.test(text) && !/\d{4}\s*年/.test(text)) return null;

  const isoLike = lastMatch(
    text,
    /(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[ T](\d{1,2})\s*[:：]\s*(\d{2})(?::(\d{2}))?)?/,
  );
  if (isoLike) {
    let fields: GameTimeFields = {
      year: Number(isoLike[1]),
      month: Number(isoLike[2]),
      day: Number(isoLike[3]),
      hour: isoLike[4] != null ? Number(isoLike[4]) : 0,
      minute: isoLike[5] != null ? Number(isoLike[5]) : 0,
    };
    if (clock) fields = applyPreferredClock(fields, clock);
    return { kind: 'calendar', fields, rule: withRuleSuffix('numeric_ymd', clock) };
  }

  const cnYmd = lastMatch(
    text,
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})\s*[:：时]\s*(\d{1,2})\s*分?)?/,
  );
  if (cnYmd) {
    let fields: GameTimeFields = {
      year: Number(cnYmd[1]),
      month: Number(cnYmd[2]),
      day: Number(cnYmd[3]),
      hour: cnYmd[4] != null ? Number(cnYmd[4]) : 0,
      minute: cnYmd[5] != null ? Number(cnYmd[5]) : 0,
    };
    fields = applyPreferredClock(fields, clock);
    return { kind: 'calendar', fields, rule: withRuleSuffix('numeric_ymd', clock) };
  }

  return null;
}

/**
 * 年 + 斜杠/点/横杠月日（可无「月」「日」字）
 * 新王国历十年-01/01/10:15、复兴纪元488年-5-14-15:48
 */
function matchChineseSlash(text: string, clock: ClockHit | null): MatcherHit | null {
  const year = parseYearFromText(text);
  if (year == null || Number.isNaN(year)) return null;

  const slashM = text.match(
    new RegExp(
      `(?:(?:\\d+)|(?:元)|(?:${CN_NUM_CLASS}+))\\s*年\\s*[-/]?\\s*(\\d{1,2})\\s*[/.-]\\s*(\\d{1,2})(?:\\s*[/.\\-\\s]\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2}))?`,
    ),
  );
  if (!slashM) return null;

  let fields: GameTimeFields = {
    year,
    month: Number(slashM[1]),
    day: Number(slashM[2]),
    hour: slashM[3] != null ? Number(slashM[3]) : 0,
    minute: slashM[4] != null ? Number(slashM[4]) : 0,
  };
  fields = applyPreferredClock(fields, clock);
  return { kind: 'calendar', fields, rule: withRuleSuffix('chinese_slash', clock) };
}

/**
 * 中文/架空历法：年/月/日各自可选，至少一项命中。
 * 复兴纪元488年-5月-14日-星期三-15:48、十月十四日、五月初一 / 正月初一、元年-01月-01日
 */
function matchChineseYmd(text: string, clock: ClockHit | null): MatcherHit | null {
  const fields: GameTimeFields = {};

  const year = parseYearFromText(text);
  if (year != null && !Number.isNaN(year)) fields.year = year;

  const monthM = text.match(new RegExp(`(正|腊|\\d+|${CN_NUM_CLASS}+)\\s*月`));
  if (monthM) {
    const month = parseMonthToken(monthM[1]!);
    if (month != null && !Number.isNaN(month)) fields.month = month;
  }

  const chuM = text.match(/初([一二三四五六七八九]|十)/);
  if (chuM) {
    const day = parseDayToken(`初${chuM[1]}`);
    if (day != null && !Number.isNaN(day)) fields.day = day;
  } else {
    const dayM = text.match(new RegExp(`(\\d+|${CN_NUM_CLASS}+)\\s*日`));
    if (dayM) {
      const day = parseDayToken(dayM[1]!);
      if (day != null && !Number.isNaN(day)) fields.day = day;
    }
  }

  if (fields.year == null && fields.month == null && fields.day == null) return null;

  return {
    kind: 'calendar',
    fields: applyPreferredClock(fields, clock),
    rule: withRuleSuffix('chinese_ymd', clock),
  };
}

/** 简写：488-5-14 15:48（无「年月日」汉字）；串内取最后一次 */
function matchDashYmd(text: string, clock: ClockHit | null): MatcherHit | null {
  const m = lastMatch(
    text,
    /(\d{3,})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})(?:\s+(\d{1,2})\s*[:：]\s*(\d{2}))?/,
  );
  if (!m) return null;
  let fields: GameTimeFields = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] != null ? Number(m[4]) : 0,
    minute: m[5] != null ? Number(m[5]) : 0,
  };
  fields = applyPreferredClock(fields, clock);
  return { kind: 'calendar', fields, rule: withRuleSuffix('dash_ymd', clock) };
}

function matchDayCount(text: string, clock: ClockHit | null): MatcherHit | null {
  const cn = text.match(/第?\s*(\d+)\s*天(?:\s*(\d{1,2})\s*[:：时]\s*(\d{1,2}))?/);
  if (!cn) return null;
  let fields: GameTimeFields = {
    dayIndex: Number(cn[1]),
    hour: cn[2] != null ? Number(cn[2]) : 0,
    minute: cn[3] != null ? Number(cn[3]) : 0,
  };
  fields = applyPreferredClock(fields, clock);
  return {
    kind: 'day_count',
    rule: withRuleSuffix('day_count', clock),
    fields,
  };
}

const DATE_MATCHERS: Array<(text: string, clock: ClockHit | null) => MatcherHit | null> = [
  matchNumericYmd,
  matchChineseSlash,
  matchChineseYmd,
  matchDashYmd,
  matchDayCount,
];

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

/** 将解析字段格式化为探针可读短串（只展示已解析到的字段） */
export function formatGameTimeFields(result: Pick<GameTimeParseResult, 'kind' | 'fields'>): string {
  const { kind, fields } = result;
  if (kind === 'day_count') {
    const t =
      fields.hour != null || fields.minute != null
        ? ` ${pad2(fields.hour ?? 0)}:${pad2(fields.minute ?? 0)}`
        : '';
    return `第${fields.dayIndex ?? 0}天${t}`;
  }
  if (kind === 'time_only') {
    return `${pad2(fields.hour ?? 0)}:${pad2(fields.minute ?? 0)}`;
  }
  const dateParts: string[] = [];
  if (fields.year != null) dateParts.push(`${fields.year}年`);
  if (fields.month != null) dateParts.push(`${fields.month}月`);
  if (fields.day != null) dateParts.push(`${fields.day}日`);
  const hasClock = fields.hour != null || fields.minute != null;
  const time = hasClock ? `${pad2(fields.hour ?? 0)}:${pad2(fields.minute ?? 0)}` : '';
  return [dateParts.join(''), time].filter(Boolean).join(' ');
}

export function parseGameTime(raw: string): GameTimeParseResult | null {
  const normalized = normalizeGameTimeRaw(raw);
  if (!normalized) return null;
  const text = peelRangeEnd(normalized);
  if (!text) return null;

  const clock = extractClockOrRange(text);
  const forDate = clock ? maskSpan(text, clock.start, clock.end) : text;

  for (const match of DATE_MATCHERS) {
    const hit = match(forDate, clock);
    if (!hit) continue;
    const ms = encodeHit(hit) + overnightDayOffset(clock) * UNIT_MS.day;
    if (Number.isNaN(ms)) continue;
    return {
      ms,
      kind: hit.kind,
      fields: hit.fields,
      rule: hit.rule,
      normalized: text,
    };
  }

  if (clock) {
    const hit: MatcherHit = {
      kind: 'time_only',
      rule: withRuleSuffix('time_only', clock),
      fields: { hour: clock.hour, minute: clock.minute },
    };
    return {
      ms: encodeHit(hit) + overnightDayOffset(clock) * UNIT_MS.day,
      kind: hit.kind,
      fields: hit.fields,
      rule: hit.rule,
      normalized: text,
    };
  }

  return null;
}

export function parseGameTimeToMs(raw: string): number | null {
  return parseGameTime(raw)?.ms ?? null;
}

export type GameTimeIntervalUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const UNIT_LABEL_ZH: Record<GameTimeIntervalUnit, string> = {
  minute: '分钟',
  hour: '小时',
  day: '天',
  week: '周',
  month: '月',
  year: '年',
};

export function gameTimeIntervalUnitLabel(unit: GameTimeIntervalUnit): string {
  return UNIT_LABEL_ZH[unit] ?? unit;
}

/**
 * 解析结果是否足以支撑所选间隔单位。
 * 与天数计数对齐：有线性日序（dayIndex，或 calendar 的月+日）则全部单位充足；
 * 仅时刻只能用于分钟/小时。
 */
export function isGameTimeAdequateForUnit(
  parsed: GameTimeParseResult,
  unit: GameTimeIntervalUnit,
): boolean {
  if (unit === 'minute' || unit === 'hour') return true;
  if (parsed.kind === 'time_only') return false;

  if (parsed.kind === 'day_count') {
    return parsed.fields.dayIndex != null;
  }

  const { year, month, day } = parsed.fields;
  const hasDayLevel = month != null && day != null;
  const hasMonthLevel = year != null && month != null;
  const hasYearLevel = year != null;

  if (unit === 'day' || unit === 'week') return hasDayLevel;
  if (unit === 'month') return hasDayLevel || hasMonthLevel;
  return hasDayLevel || hasYearLevel;
}

export function intervalToMs(value: number, unit: keyof typeof UNIT_MS): number {
  return value * (UNIT_MS[unit] ?? UNIT_MS.hour);
}

/** 调度比较要求 last/now 同属一种时间轴编码 */
export function kindsCompatibleForSchedule(lastKind: GameTimeKind, nowKind: GameTimeKind): boolean {
  return lastKind === nowKind;
}

type ScheduleComparePoint = Pick<GameTimeParseResult, 'ms' | 'kind' | 'fields'>;

/**
 * 负 elapsed 时尝试跨午夜/跨年折算当前时刻。
 * - time_only：+1 日
 * - calendar 同月日钟点回拨：+1 日
 * - 双方无年且仍为负：+1 年（372 日轴）
 */
export function adjustNowMsForScheduleCompare(
  now: ScheduleComparePoint,
  last: ScheduleComparePoint,
): { nowMs: number; adjusted: boolean } {
  if (now.ms >= last.ms) return { nowMs: now.ms, adjusted: false };

  if (now.kind === 'time_only' && last.kind === 'time_only') {
    return { nowMs: now.ms + UNIT_MS.day, adjusted: true };
  }

  if (now.kind === 'calendar' && last.kind === 'calendar') {
    const nowYear = now.fields.year ?? 0;
    const lastYear = last.fields.year ?? 0;
    if (nowYear !== lastYear) return { nowMs: now.ms, adjusted: false };

    const sameMonthDay =
      now.fields.month != null &&
      last.fields.month != null &&
      now.fields.day != null &&
      last.fields.day != null &&
      now.fields.month === last.fields.month &&
      now.fields.day === last.fields.day;

    if (sameMonthDay) {
      return { nowMs: now.ms + UNIT_MS.day, adjusted: true };
    }

    const bothYearless = now.fields.year == null && last.fields.year == null;
    if (bothYearless) {
      const plusYear = now.ms + UNIT_MS.year;
      if (plusYear >= last.ms) return { nowMs: plusYear, adjusted: true };
    }
  }

  return { nowMs: now.ms, adjusted: false };
}

const REMAINING_PARTS: { unit: keyof typeof UNIT_MS; label: string }[] = [
  { unit: 'year', label: '年' },
  { unit: 'month', label: '月' },
  { unit: 'week', label: '周' },
  { unit: 'day', label: '天' },
  { unit: 'hour', label: '小时' },
  { unit: 'minute', label: '分钟' },
];

/** 将剩余毫秒格式化为简短中文时长（最多两个单位） */
export function formatRemainingDuration(remainingMs: number): string {
  let left = Math.max(0, Math.floor(remainingMs));
  if (left < UNIT_MS.minute) return '不足1分钟';

  const parts: string[] = [];
  for (const { unit, label } of REMAINING_PARTS) {
    const size = UNIT_MS[unit];
    if (left < size) continue;
    const n = Math.floor(left / size);
    parts.push(`${n}${label}`);
    left -= n * size;
    if (parts.length >= 2) break;
  }
  return parts.length ? parts.join('') : '不足1分钟';
}

export const GAME_TIME_FORMAT_HELP = {
  preprocess:
    '解析前：全角数字转半角；多行块若含「时间/当前时间/游戏时间：」行则只取该行；折叠空白；去掉开头同名标签；@ 之后视为地点并截断。不截断 |。先识别时间段（取结束时刻）再识别日期；整段日期区间（A ~ B / A — B）取右端；空格短横线 A - B 仅当两端都像时间时才取右端（避免列表 - 项）。',
  examples: [
    '混排：时间：2024-05-07 | 周二 15:30-18:00（取 2024-05-07 18:00）',
    '多行标签块：地点…\\n时间：2026年04月10日 周五 下午 17:05\\n在场角色：\\n- 角色|服装（只取时间行）',
    '中文/架空历法：复兴纪元488年5月14日15:48、自由纪元-427年-07月-12日、无名纪元元年-01月-01日-星期一-14:00',
    '中文月日：复兴纪元十年十月十四日、五月初一（年/月/日可缺；有月+日即可支撑天/周及更粗间隔）',
    '中文年份 + 斜杠月日：新王国历十年-01/01/10:15、新王国历十年-01/01 10:15、…元年-01/01/10:15',
    '横杠月日时：复兴纪元488年-5-14-15:48',
    '横杠简写：488-5-14 15:48',
    '公历数字：2026-06-30 15:48、2026/06/30 15:48、2026年6月30日15时30分',
    '天数计数：第12天、第 3 天 8:30（有日序即可用于天/周及更粗间隔，与「月+日」日历同一原则）',
    '仅时刻（可带 | 备注）：15:48、15:48 | 晴、15时30分',
  ],
  footnote:
    '含年月日的日历时间一律按游戏内日历轴比较间隔（非 Unix 时间戳）；有线性日序（第N天，或月+日）即可用于天/周及更粗间隔；仅时刻仅适用于分钟/小时间隔，跨午夜会自动按次日折算一次。无年份的月+日跨年（如 12/31→1/1）会按年轴折算；请勿在同一任务中混用「第N天」与完整历法/仅时刻，否则将重置上次运行时间。跨夜时段（如 22:00-01:00）结束时刻按次日编码。精度不足或无法识别时跳过本任务，原因见运行日志。',
} as const;
