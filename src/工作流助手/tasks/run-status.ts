import { SCRIPT_LOG_PREFIX } from '../ui/brand';
import { resolveMessageRetentionCutoff } from './message-floor';
import type { RunLogTaskResult, ScriptSettings } from './schema';

/** shujuku 式：挂在聊天消息对象顶层，不进 message.data / post_process_tags */
export const ACU_WORKFLOW_RUN_STATUS_KEY = 'acu_workflow_run_status';

export type LastRunStatus = ScriptSettings['lastRunStatus'];

type ChatHost = {
  chat: Array<Record<string, unknown>>;
  saveChat: () => Promise<void>;
};

function getChatHost(): ChatHost | null {
  try {
    const ctx = (
      window.parent as Window & {
        SillyTavern?: {
          getContext?: () => {
            chat?: Array<Record<string, unknown>>;
            saveChat?: () => Promise<void>;
          };
        };
      }
    ).SillyTavern?.getContext?.();
    if (!ctx?.chat || typeof ctx.saveChat !== 'function') return null;
    return { chat: ctx.chat, saveChat: () => ctx.saveChat!() };
  } catch {
    return null;
  }
}

export function normalizeRunStatus(raw: unknown): LastRunStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.taskResults)) return null;
  return {
    messageId: typeof o.messageId === 'number' ? o.messageId : undefined,
    at: typeof o.at === 'number' ? o.at : undefined,
    taskResults: o.taskResults as LastRunStatus['taskResults'],
  };
}

/** 楼层快照：去掉 prompt/全文输出/思维链，只留注入与预演所需字段 */
export function toFloorRunStatus(status: LastRunStatus): LastRunStatus {
  return {
    messageId: status.messageId,
    at: status.at,
    taskResults: (status.taskResults ?? []).map((r: RunLogTaskResult) => ({
      taskId: r.taskId,
      taskName: r.taskName,
      stage: r.stage,
      skipped: r.skipped,
      skipReason: r.skipReason,
      success: r.success,
      preview: r.preview,
      extractedTags: _.cloneDeep(r.extractedTags),
      durationMs: r.durationMs,
      apiPresetUsed: r.apiPresetUsed,
      promptMessages: [],
      aiOutput: '',
      aiReasoning: '',
    })),
  };
}

function taskResultIsHeavy(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  if (typeof o.aiOutput === 'string' && o.aiOutput.length > 0) return true;
  if (typeof o.aiReasoning === 'string' && o.aiReasoning.length > 0) return true;
  if (Array.isArray(o.promptMessages) && o.promptMessages.length > 0) return true;
  return false;
}

export function runStatusIsHeavy(status: LastRunStatus | null | undefined): boolean {
  if (!status?.taskResults?.length) return false;
  return status.taskResults.some(taskResultIsHeavy);
}

export function readRunStatusFromMessage(messageId: number): LastRunStatus | null {
  if (messageId < 0) return null;
  const host = getChatHost();
  if (!host || messageId >= host.chat.length) return null;
  const msg = host.chat[messageId];
  if (!msg) return null;
  const status = normalizeRunStatus(msg[ACU_WORKFLOW_RUN_STATUS_KEY]);
  if (!status) return null;
  // 删楼后下标会变，内嵌 messageId 可能陈旧；以当前楼号为准
  return { ...status, messageId };
}

/**
 * 从指定楼向前扫描 assistant 消息上的运行快照（仿 shujuku getPlotFromHistory）。
 * @param beforeFloorExclusive 若给定，只看严格小于该 id 的楼
 */
export function resolveEffectiveRunStatus(beforeFloorExclusive?: number): LastRunStatus | null {
  const host = getChatHost();
  if (!host || host.chat.length === 0) return null;

  const upper =
    beforeFloorExclusive != null
      ? Math.min(beforeFloorExclusive - 1, host.chat.length - 1)
      : host.chat.length - 1;
  if (upper < 0) return null;

  for (let i = upper; i >= 0; i--) {
    const msg = host.chat[i];
    if (!msg || msg.is_user) continue;
    const status = normalizeRunStatus(msg[ACU_WORKFLOW_RUN_STATUS_KEY]);
    if (status) return { ...status, messageId: i };
  }
  return null;
}

export function resolveRunStatusForFloor(floorId: number | null): LastRunStatus | null {
  if (floorId == null || floorId < 0) return null;
  return readRunStatusFromMessage(floorId);
}

/** 写入 AI 楼顶层轻量快照并 saveChat（不写 message.data） */
export async function writeRunStatusToMessage(
  messageId: number,
  status: LastRunStatus,
  options?: { skipSave?: boolean },
): Promise<boolean> {
  const host = getChatHost();
  if (!host || messageId < 0 || messageId >= host.chat.length) {
    console.warn(`${SCRIPT_LOG_PREFIX} 写入运行快照失败：找不到楼层 ${messageId}`);
    return false;
  }
  const msg = host.chat[messageId];
  if (!msg) {
    console.warn(`${SCRIPT_LOG_PREFIX} 写入运行快照失败：楼层 ${messageId} 为空`);
    return false;
  }
  msg[ACU_WORKFLOW_RUN_STATUS_KEY] = toFloorRunStatus(status);
  if (!options?.skipSave) {
    try {
      await host.saveChat();
    } catch (error) {
      console.warn(`${SCRIPT_LOG_PREFIX} saveChat 保存运行快照失败:`, error);
    }
  }
  return true;
}

/**
 * 与消息楼层变量保留策略一致：删除 cutoff 及更早楼的快照，并将保留楼上的肥快照压成轻量。
 * @returns 被删除或压扁的楼层数
 */
export async function cleanupOldRunStatusSnapshots(keepFloors: number): Promise<number> {
  const host = getChatHost();
  if (!host || host.chat.length === 0) return 0;

  const window = resolveMessageRetentionCutoff(keepFloors);
  if (!window) return 0;

  const { keep, last, cutoff } = window;
  let touched = 0;

  for (let message_id = 0; message_id < host.chat.length; message_id++) {
    const msg = host.chat[message_id];
    if (!msg || !(ACU_WORKFLOW_RUN_STATUS_KEY in msg)) continue;
    const raw = msg[ACU_WORKFLOW_RUN_STATUS_KEY];
    if (raw == null) continue;

    if (cutoff >= 0 && message_id <= cutoff) {
      delete msg[ACU_WORKFLOW_RUN_STATUS_KEY];
      touched++;
      continue;
    }

    // 仅压扁保留窗口内（> cutoff 且 ≤ last）的肥快照；越界跳过
    if (message_id > last) continue;

    const status = normalizeRunStatus(raw);
    if (status && runStatusIsHeavy(status)) {
      msg[ACU_WORKFLOW_RUN_STATUS_KEY] = toFloorRunStatus({ ...status, messageId: message_id });
      touched++;
    }
  }

  if (touched > 0) {
    try {
      await host.saveChat();
    } catch (error) {
      console.warn(`${SCRIPT_LOG_PREFIX} saveChat 清理运行快照失败:`, error);
    }
    console.info(
      `${SCRIPT_LOG_PREFIX} 已处理 ${touched} 层运行快照（删除 ≤${cutoff} 或压扁保留楼；保留最近 ${keep} 楼）`,
    );
  }
  return touched;
}

/**
 * 删楼/换聊后：若缓存指向的楼已不存在，回退到仍存在的最近快照。
 * 同楼 mes 仍在时不覆盖 settings（settings 可能是完整日志，mes 仅为轻量）。
 */
export function retargetRunStatusCache(): void {
  const { loadSettings, saveSettings } = require('../settings') as typeof import('../settings');
  const settings = loadSettings();
  const cachedId = settings.lastRunStatus?.messageId;
  if (cachedId != null) {
    const onFloor = readRunStatusFromMessage(cachedId);
    if (onFloor) {
      return;
    }
  }
  const effective = resolveEffectiveRunStatus();
  settings.lastRunStatus = effective
    ? _.cloneDeep(effective)
    : { taskResults: [] };
  saveSettings(settings);
}

/**
 * 最近一次运行：优先 settings 完整缓存（若其 messageId 对应楼仍在）；
 * 否则回退 mes 有效快照。
 */
export function resolveLastRunStatus(): LastRunStatus {
  const { loadSettings } = require('../settings') as typeof import('../settings');
  const cached = loadSettings().lastRunStatus;
  const cachedId = cached?.messageId;
  if (cachedId != null && readRunStatusFromMessage(cachedId)) {
    return _.cloneDeep(cached);
  }
  const effective = resolveEffectiveRunStatus();
  if (effective) return _.cloneDeep(effective);
  return _.cloneDeep(cached ?? { taskResults: [] });
}

export function registerRunStatusRetarget(): EventOnReturn {
  const onRetarget = () => {
    try {
      retargetRunStatusCache();
    } catch (error) {
      console.warn(`${SCRIPT_LOG_PREFIX} retarget 运行快照缓存失败:`, error);
    }
  };

  const offDeleted = eventOn(tavern_events.MESSAGE_DELETED, onRetarget);
  const offChat = eventOn(tavern_events.CHAT_CHANGED, onRetarget);

  return {
    stop: () => {
      offDeleted.stop();
      offChat.stop();
    },
  };
}
