import _ from 'lodash';
import { findLatestAssistantFloorId } from './message-floor';
import {
  adjustNowMsForScheduleCompare,
  formatGameTimeFields,
  formatRemainingDuration,
  gameTimeIntervalUnitLabel,
  intervalToMs,
  isGameTimeAdequateForUnit,
  kindsCompatibleForSchedule,
  normalizeGameTimeRaw,
  parseGameTime,
  peelRangeEnd,
  type GameTimeIntervalUnit,
  type GameTimeParseResult,
} from './parse-game-time';
import type { PostProcessTask, ScheduleStateEntry, ScriptSettings, TaskSchedule } from './schema';
import { extractLastTagContent } from './utils';

export function resolveScheduleMode(schedule: TaskSchedule): 'round' | 'time' {
  if (schedule.mode) return schedule.mode;
  return schedule.timeInterval?.enabled ? 'time' : 'round';
}

/**
 * @deprecated 延后触发已改为「MVU 就绪即入队并适配额外模型解析」（见 mvu-trigger-defer），不再按本函数门控。
 * 保留供兼容；任一启用任务为「按游戏时间 + 最新消息楼层变量」时曾表示需等 stat_data。
 */
export function needsMvuDeferredRun(settings: ScriptSettings): boolean {
  return settings.tasks.some(t => {
    if (!t.enabled) return false;
    const s = t.schedule;
    if (!s || resolveScheduleMode(s) !== 'time') return false;
    const src = s.timeInterval?.timeSource;
    return src?.type === 'variable' && src.variableType === 'message';
  });
}

export interface ScheduleContext {
  currentRound: number;
  currentAiText: string;
  currentPairText: string;
  settings: ScriptSettings;
  bypassSchedule: boolean;
  /** 当前聊天键；与 scheduleState.lastRunChatKey 不一致时视为新开局 */
  chatKey?: string;
}

export function countAssistantRounds(): number {
  try {
    const lastId = getLastMessageId();
    if (lastId < 0) return 0;
    const msgs = getChatMessages(`0-${lastId}`);
    return msgs.filter(m => m.role === 'assistant').length;
  } catch {
    return 0;
  }
}

export function resolveTimeRaw(task: PostProcessTask, ctx: ScheduleContext): { raw: string | null; fail: boolean } {
  const ti = task.schedule?.timeInterval;
  if (!ti) return { raw: null, fail: false };
  const src = ti.timeSource;
  if (src.type === 'message_tag') {
    const text = src.scope === 'current_pair' ? ctx.currentPairText : ctx.currentAiText;
    for (const tag of src.tagNames) {
      const v = extractLastTagContent(text, tag);
      if (v) return { raw: v, fail: false };
    }
    return { raw: null, fail: true };
  }
  try {
    const opt =
      src.variableType === 'message'
        ? { type: 'message' as const, message_id: 'latest' as const }
        : { type: src.variableType };
    const vars = getVariables(opt);
    const val = _.get(vars, src.path);
    if (val == null || val === '') return { raw: null, fail: true };
    return { raw: String(val).trim(), fail: false };
  } catch {
    return { raw: null, fail: true };
  }
}

export type GameTimeProbeResult = {
  ok: boolean;
  stage: 'source' | 'parse';
  raw?: string;
  normalized?: string;
  rule?: string;
  message: string;
};

/** 按当前任务时间来源读取并解析游戏时间（供设置页「测试时间解析」） */
export function probeTaskGameTime(task: PostProcessTask): GameTimeProbeResult {
  const ti = task.schedule?.timeInterval;
  if (!ti) {
    return { ok: false, stage: 'source', message: '未配置游戏时间间隔' };
  }

  const src = ti.timeSource;
  let currentAiText = '';
  let currentPairText = '';

  if (src.type === 'message_tag') {
    const floorId = findLatestAssistantFloorId();
    if (floorId == null) {
      return { ok: false, stage: 'source', message: '当前没有可访问的 AI 回复楼层' };
    }
    try {
      const aiMsg = getChatMessages(floorId)[0];
      currentAiText = aiMsg?.message ?? '';
      const prev = getChatMessages(floorId - 1)[0];
      const userText = prev?.role === 'user' ? (prev.message ?? '') : '';
      currentPairText = [userText, currentAiText].filter(Boolean).join('\n');
    } catch {
      return { ok: false, stage: 'source', message: '读取聊天楼层失败' };
    }
  }

  const ctx: ScheduleContext = {
    currentRound: 0,
    currentAiText,
    currentPairText,
    settings: { tasks: [] } as ScriptSettings,
    bypassSchedule: false,
  };

  const { raw, fail } = resolveTimeRaw(task, ctx);
  if (fail || raw == null) {
    if (src.type === 'message_tag') {
      const tags = src.tagNames.filter(Boolean).join('、') || '（未填写）';
      return {
        ok: false,
        stage: 'source',
        message: `未在正文中读到时间标签：${tags}`,
      };
    }
    const path = src.path?.trim() || '（未填写路径）';
    return {
      ok: false,
      stage: 'source',
      message: `未读到楼层变量时间：${src.variableType} / ${path}`,
    };
  }

  const parsed = parseGameTime(raw);
  if (!parsed) {
    const normalized = peelRangeEnd(normalizeGameTimeRaw(raw));
    return {
      ok: false,
      stage: 'parse',
      raw,
      normalized,
      message: `已读到原文但格式无法解析：${normalized || raw}`,
    };
  }

  const unit = ti.unit as GameTimeIntervalUnit;
  if (!isGameTimeAdequateForUnit(parsed, unit)) {
    const unitLabel = gameTimeIntervalUnitLabel(unit);
    const detail =
      parsed.kind === 'time_only'
        ? `已解析为仅时刻（${formatGameTimeFields(parsed)}），不足以支撑「${unitLabel}」间隔，请提供含日期的时间`
        : `已解析结果精度不足，不足以支撑「${unitLabel}」间隔：${formatGameTimeFields(parsed)}`;
    return {
      ok: false,
      stage: 'parse',
      raw,
      normalized: parsed.normalized,
      rule: parsed.rule,
      message: detail,
    };
  }

  return {
    ok: true,
    stage: 'parse',
    raw,
    normalized: parsed.normalized,
    rule: parsed.rule,
    message: `解析成功〔${parsed.rule}〕：${formatGameTimeFields(parsed)}`,
  };
}

export function shouldRunTask(
  task: PostProcessTask,
  state: ScheduleStateEntry | undefined,
  ctx: ScheduleContext,
): { run: boolean; reason?: string } {
  if (ctx.bypassSchedule) return { run: true };
  const schedule = task.schedule;
  if (!schedule) return { run: true };

  const mode = resolveScheduleMode(schedule);

  if (mode === 'round') {
    const roundInterval = schedule.roundInterval ?? 0;
    if (roundInterval >= 2) {
      const hasLastRunAt = state?.lastRunAt != null;
      const chatKey = ctx.chatKey?.trim() || '';
      const stateChatKey = state?.lastRunChatKey?.trim() || '';
      const chatMismatch = Boolean(chatKey && (!stateChatKey || stateChatKey !== chatKey));
      // 从未真正执行，或换了聊天：开局首次必跑（对齐时间模式「无 lastMs 则放行」）
      const firstInChat = !hasLastRunAt || chatMismatch;
      const last = state?.lastRunRound ?? 0;
      // 删楼等导致回合回落：清空锚点并放行，避免压成 delta=0 后跳过首次
      const roundRegressed = hasLastRunAt && !chatMismatch && last > ctx.currentRound;
      if (firstInChat || roundRegressed) {
        if (state && (chatMismatch || roundRegressed)) {
          state.lastRunRound = 0;
          delete state.lastRunAt;
          delete state.lastRunChatKey;
          delete state.lastRunGameTimeRaw;
          delete state.lastRunGameTimeMs;
        }
        return { run: true };
      }
      const delta = ctx.currentRound - last;
      if (delta < roundInterval) {
        return { run: false, reason: `回合间隔未到 (${delta}/${roundInterval})` };
      }
    }
    return { run: true };
  }

  const ti = schedule.timeInterval;
  if (!ti) return { run: true };

  const chatKey = ctx.chatKey?.trim() || '';
  const stateChatKey = state?.lastRunChatKey?.trim() || '';
  const chatMismatch = Boolean(chatKey && (!stateChatKey || stateChatKey !== chatKey));
  if (chatMismatch && state) {
    delete state.lastRunAt;
    delete state.lastRunChatKey;
    delete state.lastRunGameTimeRaw;
    delete state.lastRunGameTimeMs;
    state.lastRunRound = 0;
  }

  const { raw, fail } = resolveTimeRaw(task, ctx);
  if (fail || !raw) {
    return { run: false, reason: '读不到游戏时间，已跳过' };
  }
  const parsed = parseGameTime(raw);
  if (!parsed) {
    return { run: false, reason: '游戏时间格式无法解析，已跳过' };
  }
  const unit = ti.unit as GameTimeIntervalUnit;
  if (!isGameTimeAdequateForUnit(parsed, unit)) {
    return {
      run: false,
      reason: `游戏时间精度不足（当前间隔单位：${gameTimeIntervalUnitLabel(unit)}），已跳过`,
    };
  }
  const nowMs = parsed.ms;
  // 优先用 raw 重解析，避免编码升级后旧 lastRunGameTimeMs 与新区不一致
  let lastParsed: GameTimeParseResult | null = null;
  let lastMs: number | undefined;
  if (state?.lastRunGameTimeRaw) {
    const candidate = parseGameTime(state.lastRunGameTimeRaw);
    if (candidate && isGameTimeAdequateForUnit(candidate, unit)) {
      lastParsed = candidate;
      lastMs = candidate.ms;
    }
  }
  const usedMsFallback = lastMs == null && state?.lastRunGameTimeMs != null;
  if (lastMs == null) lastMs = state?.lastRunGameTimeMs;

  if (lastMs != null) {
    const need = intervalToMs(ti.value, ti.unit);

    if (lastParsed && !kindsCompatibleForSchedule(lastParsed.kind, parsed.kind)) {
      if (state) {
        delete state.lastRunGameTimeRaw;
        delete state.lastRunGameTimeMs;
      }
      return { run: true };
    }

    let compareNowMs = nowMs;
    if (lastParsed) {
      compareNowMs = adjustNowMsForScheduleCompare(parsed, lastParsed).nowMs;
    } else if (usedMsFallback && compareNowMs < lastMs && need < intervalToMs(1, 'day')) {
      // 无 kind 的旧 ms：短间隔下尝试一次 +1 日跨午夜折算
      compareNowMs += intervalToMs(1, 'day');
    }

    let elapsed = compareNowMs - lastMs;
    if (elapsed < 0) {
      // 折算后仍为负：视为时间轴回拨/格式切换，自愈并放行（对齐回合模式）
      if (state) {
        state.lastRunGameTimeRaw = raw;
        state.lastRunGameTimeMs = nowMs;
      }
      return { run: true };
    }
    if (elapsed < need) {
      const left = formatRemainingDuration(need - elapsed);
      return { run: false, reason: `游戏时间间隔未到，还剩 ${left}` };
    }
  }

  return { run: true };
}

export function updateScheduleStateAfterRun(
  settings: ScriptSettings,
  task: PostProcessTask,
  ctx: ScheduleContext,
): void {
  const id = task.id;
  if (!settings.scheduleState[id]) {
    settings.scheduleState[id] = { lastRunRound: 0 };
  }
  const entry = settings.scheduleState[id];
  entry.lastRunRound = ctx.currentRound;
  entry.lastRunAt = Date.now();
  const chatKey = ctx.chatKey?.trim();
  if (chatKey) entry.lastRunChatKey = chatKey;
  else delete entry.lastRunChatKey;

  const schedule = task.schedule;
  if (schedule && resolveScheduleMode(schedule) === 'time') {
    const ti = schedule.timeInterval;
    if (ti) {
      const { raw } = resolveTimeRaw(task, ctx);
      if (raw) {
        entry.lastRunGameTimeRaw = raw;
        const parsed = parseGameTime(raw);
        if (parsed && isGameTimeAdequateForUnit(parsed, ti.unit as GameTimeIntervalUnit)) {
          entry.lastRunGameTimeMs = parsed.ms;
        }
      }
    }
  }
}
