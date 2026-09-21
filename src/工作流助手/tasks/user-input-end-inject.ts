import { SCRIPT_LOG_PREFIX } from '../ui/brand';
import { resolveEffectiveSettings } from './effective-settings';
import {
  findLatestAccessibleFloorId,
  findLatestAssistantFloorId,
  isChatMessageFloorAccessible,
} from './message-floor';
import { processTemplateText } from './template-process';
import { buildExtractedBlockFromTags } from './tag-variables';
import {
  clearUnresolvedTaskPlaceholders,
  mergeRelayTagMap,
  replacePlotTagPlaceholdersWithHistory,
  type RelayTagMap,
} from './utils';
import {
  normalizeReplicaStateSnapshot,
  POST_PROCESS_REPLICA_STATE_KEY,
  type ReplicaStateSnapshot,
} from './replica-state';
import { resolveRunStatusForFloor } from './run-status';
import type { RunLogTaskResult, ScriptSettings } from './schema';

function readReplicaStateFromAssistantFloor(messageId: number): ReplicaStateSnapshot {
  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return {};
  const data = (msg.data ?? {}) as Record<string, unknown>;
  return normalizeReplicaStateSnapshot(data[POST_PROCESS_REPLICA_STATE_KEY]) ?? {};
}

/** 固定 id：覆盖写入 + 换聊/卸载时清理 */
export const USER_INPUT_END_INJECT_ID = 'workflow-helper:user-input-end-inject';

export function buildRelayFromLastRunStatus(
  lastRunStatus: ScriptSettings['lastRunStatus'] | undefined,
  previousAssistantFloorId: number | null,
): { relay: RelayTagMap; taskBlocks: Array<{ taskId: string; taskName: string; extractedBlock: string }> } {
  const relay: RelayTagMap = new Map();
  const taskBlocks: Array<{ taskId: string; taskName: string; extractedBlock: string }> = [];

  if (
    previousAssistantFloorId == null ||
    !lastRunStatus ||
    lastRunStatus.messageId !== previousAssistantFloorId ||
    !Array.isArray(lastRunStatus.taskResults)
  ) {
    return { relay, taskBlocks };
  }

  for (const r of lastRunStatus.taskResults as RunLogTaskResult[]) {
    if (!r || r.skipped || r.success === false) continue;
    const extractedTags = r.extractedTags ?? {};
    mergeRelayTagMap(relay, extractedTags);
    taskBlocks.push({
      taskId: r.taskId,
      taskName: r.taskName,
      extractedBlock: buildExtractedBlockFromTags(extractedTags),
    });
  }

  return { relay, taskBlocks };
}

export async function expandUserInputEndInjectTemplate(
  settings: ScriptSettings,
  userMessageId: number,
): Promise<string> {
  const template = settings.userInputEndInjectTemplate?.trim();
  if (!template) return '';
  if (!settings.enabled) return '';
  if (!isChatMessageFloorAccessible(userMessageId)) return '';

  const msg = getChatMessages(userMessageId)[0];
  if (!msg || msg.role !== 'user') return '';

  const prevAiId = findLatestAssistantFloorId(userMessageId - 1);
  const floorStatus = resolveRunStatusForFloor(prevAiId);
  const runStatus =
    floorStatus ??
    (settings.lastRunStatus?.messageId === prevAiId ? settings.lastRunStatus : undefined);
  const { relay, taskBlocks } = buildRelayFromLastRunStatus(runStatus, prevAiId);

  let out = template;
  for (const r of taskBlocks) {
    out = out.split(`{{task:${r.taskName}}}`).join(r.extractedBlock);
    out = out.split(`{{task:${r.taskId}}}`).join(r.extractedBlock);
  }
  out = clearUnresolvedTaskPlaceholders(out);

  const replicaState =
    prevAiId != null ? readReplicaStateFromAssistantFloor(prevAiId) : {};

  // 仅用上一 AI 楼工作流摘取（relay）；不用本楼继承的 post_process_tags 回退，
  // 避免后续用户楼在未跑工作流时仍注入历史标签。
  out = replacePlotTagPlaceholdersWithHistory(out, relay, new Map(), new Set(), {
    historyFallback: 'all-tags',
    allTasks: settings.tasks,
    replicaState,
  });

  return processTemplateText(out, userMessageId, { role: 'user' });
}

function clearUserInputEndInject(): void {
  try {
    uninjectPrompts([USER_INPUT_END_INJECT_ID]);
  } catch (error) {
    console.warn(`${SCRIPT_LOG_PREFIX} 清理用户输入文末注入失败:`, error);
  }
}

export async function applyUserInputEndInject(messageId: number, settings?: ScriptSettings): Promise<void> {
  let resolved = settings;
  if (!resolved) {
    // 惰性加载，避免单测顶层拉入 Pinia settings store
    const { loadSettings } = require('../settings') as typeof import('../settings');
    resolved = resolveEffectiveSettings(loadSettings());
  }
  const content = await expandUserInputEndInjectTemplate(resolved, messageId);

  if (!content.trim()) {
    clearUserInputEndInject();
    return;
  }

  injectPrompts(
    [
      {
        id: USER_INPUT_END_INJECT_ID,
        position: 'in_chat',
        depth: 0,
        role: 'user',
        content,
        should_scan: true,
      },
    ],
    { once: true },
  );
}

/** 先聊天摘取、再文末注入（策略1 改写后重跑 / MESSAGE_UPDATED） */
export async function applyUserFloorExtractThenInject(messageId: number): Promise<void> {
  // 惰性加载，避免与 chat-tag-extract → settings 形成单测顶层环
  const { applyUserChatTagExtract } = require('./chat-tag-extract') as typeof import('./chat-tag-extract');
  applyUserChatTagExtract(messageId);
  await applyUserInputEndInject(messageId);
}

/** dry_run 或非 user 楼时跳过 AFTER_COMMANDS / UPDATED 兜底 */
export function shouldSkipUserFloorExtractInjectFallback(
  dryRun: boolean | undefined,
  latestRole: string | undefined,
): boolean {
  if (dryRun === true) return true;
  return latestRole !== 'user';
}

/**
 * shujuku 策略1：GENERATION_AFTER_COMMANDS 内已改写最新 user 楼后调用。
 * 策略2 时最新楼通常是 assistant，直接跳过。
 */
export async function processLatestUserFloorExtractThenInject(options?: {
  dryRun?: boolean;
}): Promise<boolean> {
  if (options?.dryRun === true) return false;

  const latestId = findLatestAccessibleFloorId();
  if (latestId == null) return false;

  const msg = getChatMessages(latestId)[0];
  if (shouldSkipUserFloorExtractInjectFallback(false, msg?.role)) return false;

  await applyUserFloorExtractThenInject(latestId);
  return true;
}

export async function processUserFloorExtractThenInjectById(
  messageId: number,
): Promise<boolean> {
  if (!isChatMessageFloorAccessible(messageId)) return false;
  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'user') return false;
  await applyUserFloorExtractThenInject(messageId);
  return true;
}

export function registerUserInputEndInjectTrigger(): EventOnReturn {
  // 必须 return Promise，否则 ST emit 不会等待注入，世界书扫描可能吃到空 inject
  const offSent = eventMakeLast(tavern_events.MESSAGE_SENT, (messageId: number) =>
    errorCatched(async () => {
      await applyUserInputEndInject(messageId);
    })(),
  );

  // shujuku 策略1：改写 mes 后、WI 扫描前；makeLast 排在 shujuku 的 AFTER_COMMANDS 之后
  const offAfterCommands = eventMakeLast(
    tavern_events.GENERATION_AFTER_COMMANDS,
    (_type: string, _option: unknown, dryRun: boolean) =>
      errorCatched(async () => {
        await processLatestUserFloorExtractThenInject({ dryRun });
      })(),
  );

  // 其它路径（setChatMessages 等）若 await MESSAGE_UPDATED，可再跑一遍；与 AFTER_COMMANDS 幂等
  const offUpdated = eventMakeLast(tavern_events.MESSAGE_UPDATED, (messageId: number) =>
    errorCatched(async () => {
      await processUserFloorExtractThenInjectById(messageId);
    })(),
  );

  const offChat = eventOn(tavern_events.CHAT_CHANGED, () => {
    clearUserInputEndInject();
  });

  return {
    stop: () => {
      offSent.stop();
      offAfterCommands.stop();
      offUpdated.stop();
      offChat.stop();
      clearUserInputEndInject();
    },
  };
}
