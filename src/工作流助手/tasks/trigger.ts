import { captureDataSnapshot } from '../bridge/database-api';
import { loadSettings, saveSettings } from '../settings';
import { resolveEffectiveSettings } from './effective-settings';
import { injectToAiFloor } from './inject';
import {
  beginRun,
  endRun,
  getRunEpoch,
  requestCancelRun,
  RunCancelledError,
} from './run-control';
import {
  isPostProcessSilent,
  runPostProcessTasks,
  tryMarkProcessing,
  unmarkProcessing,
} from './runtime';
import { clearPendingReplicaRenames } from './replica-enum-pending';
import { applyPendingReplicaRenames } from './replica-enum-rename';
import { applyAssistantChatTagExtract } from './chat-tag-extract';
import {
  clearStalePostProcessRunMarkers,
  ensureBodyReplaceOriginCaptured,
  hasConfiguredChatBodyTagReplaceRules,
  restoreBodyReplaceOrigin,
} from './chat-body-tag-replace';
import {
  clearWorldbookWriteMessageKeys,
  reconcileWorldbookWritesFromChat,
} from '../worldbook/write-reconcile';
import {
  applyTagVariableInjectTemplate,
  mergeAiFloorInjectBlock,
  restorePostProcessTagsFromPreviousFloor,
} from './tag-variables';
import {
  hideTaskProgressToast,
  isTaskProgressStopping,
  showTaskProgressToast,
  updateTaskProgressToast,
  type TaskProgressUpdate,
} from '../ui/task-progress-toast';
import { registerMvuDeferredTrigger, isMvuDeferActive } from './mvu-trigger-defer';
import {
  markChatGenerationAborted,
  markChatGenerationStarted,
  shouldSuppressAutoTriggerAfterAbort,
} from './trigger-guard';
import { acuToast } from '../ui/toast';
import { SCRIPT_LOG_PREFIX } from '../ui/brand';
import { persistRuntimeTaskChanges } from './persist-runtime-tasks';
import { resetNewlyCreatedReplicaLaunched } from './replica-family';
import {
  applyReplicaFamilyCleanup,
  computeAutoKeepSet,
  incrementReplicaRunCounts,
  incrementReplicaOpportunityCounts,
  incrementReplicaScheduleWaitCounts,
  shouldTriggerCleanup,
  tickCleanupRound,
  type RemovedReplicaCleanupInfo,
} from './replica-family-cleanup';
import { pruneWorldbookForRemovedReplicas } from './prune-applied-for-replica';
import {
  clearReplicaStateMessageKeys,
  reconcileReplicaTasksForRerun,
  writeReplicaStateSnapshot,
} from './replica-reconcile';
import { showReplicaFamilyCleanupDialog } from '../ui/mount-cleanup-dialog';
import type { ScriptSettings } from './schema';
import {
  resolveManualRerunFloorId,
  resolveAutoTriggerMessageId,
} from './message-floor';
import { writeRunStatusToMessage, cleanupOldRunStatusSnapshots } from './run-status';

async function persistRunStatus(
  settings: ReturnType<typeof loadSettings>,
  messageId: number,
  results: Awaited<ReturnType<typeof runPostProcessTasks>>['results'],
) {
  const status = {
    messageId,
    at: Date.now(),
    taskResults: results.map(r => ({
      taskId: r.taskId,
      taskName: r.taskName,
      stage: r.stage,
      skipped: r.skipped,
      skipReason: r.skipReason,
      success: r.success,
      preview: r.extractedBlock.slice(0, 200),
      extractedTags: _.cloneDeep(r.extractedTags),
      durationMs: r.durationMs,
      promptMessages: _.cloneDeep(r.promptMessages),
      aiOutput: r.rawResponse,
      aiReasoning: r.reasoningContent?.trim() || '',
      apiPresetUsed: r.apiPresetUsed,
    })),
  };
  await writeRunStatusToMessage(messageId, status);
  settings.lastRunStatus = status;
  saveSettings(settings);
}

async function finalizeReplicaRuntimeState(
  baseSettings: ScriptSettings,
  effectiveSettings: ScriptSettings,
  newlyCreatedReplicaIds: string[],
): Promise<void> {
  if (newlyCreatedReplicaIds.length) {
    effectiveSettings.tasks = resetNewlyCreatedReplicaLaunched(
      effectiveSettings.tasks,
      newlyCreatedReplicaIds,
    );
  }
  await persistRuntimeTaskChanges(baseSettings, effectiveSettings);
}

async function runReplicaFamilyCleanupIfDue(
  baseSettings: ScriptSettings,
  effectiveSettings: ScriptSettings,
  messageId: number,
  newlyCreatedReplicaIds: string[] = [],
): Promise<void> {
  tickCleanupRound(effectiveSettings);
  if (!shouldTriggerCleanup(effectiveSettings)) {
    // 未到周期也要落盘，否则下一轮 loadSettings 会丢弃 tick（N>1 永远到不了阈值）
    await persistRuntimeTaskChanges(baseSettings, effectiveSettings);
    return;
  }

  const cleanup = effectiveSettings.replicaFamilyCleanup;
  if (cleanup.mode === 'auto') {
    const keepSet = computeAutoKeepSet(effectiveSettings, newlyCreatedReplicaIds);
    const removedOut: RemovedReplicaCleanupInfo[] = [];
    const next = applyReplicaFamilyCleanup(effectiveSettings, keepSet, messageId, { removedOut });
    Object.assign(effectiveSettings, next);
    await persistRuntimeTaskChanges(baseSettings, effectiveSettings);
    await pruneWorldbookForRemovedReplicas(removedOut, effectiveSettings.chatWorldbookWriteRules ?? []);
    return;
  }

  await new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

  const result = await showReplicaFamilyCleanupDialog(effectiveSettings, newlyCreatedReplicaIds);
  if (!result) {
    // 跳过/无候选：仍落盘当前计数，避免下一轮回退；阈值已达则会在下轮再次触发
    await persistRuntimeTaskChanges(baseSettings, effectiveSettings);
    return;
  }
  const removedOut: RemovedReplicaCleanupInfo[] = [];
  const next = applyReplicaFamilyCleanup(effectiveSettings, result.keepBySpec, messageId, {
    ...(result.persistManualKeep ? { persistManualKeepBySpec: result.keepBySpec } : {}),
    removedOut,
  });
  Object.assign(effectiveSettings, next);
  await persistRuntimeTaskChanges(baseSettings, effectiveSettings);
  await pruneWorldbookForRemovedReplicas(removedOut, effectiveSettings.chatWorldbookWriteRules ?? []);
}

/** 自动触发时接受的消息类型（手动 force 不受限） */
const AUTO_TRIGGER_MESSAGE_TYPES = new Set([
  'normal',
  'regenerate',
  'continue',
  'impersonate',
  'append',
  'appendFinal',
  'swipe',
]);

const CONTENT_REFRESH_MESSAGE_TYPES = new Set(['regenerate', 'swipe', 'continue', 'append', 'appendFinal']);

/** 防止 GENERATION_ENDED 与 MESSAGE_RECEIVED 重复触发 */
const recentAutoTriggerAt = new Map<number, number>();
const AUTO_TRIGGER_DEDUP_MS = 3000;

function isAutoTriggerMessageType(type: string): boolean {
  return AUTO_TRIGGER_MESSAGE_TYPES.has(type);
}

function isContentRefreshMessageType(type: string): boolean {
  return CONTENT_REFRESH_MESSAGE_TYPES.has(type);
}

function shouldDedupAutoTrigger(messageId: number): boolean {
  const now = Date.now();
  const last = recentAutoTriggerAt.get(messageId) ?? 0;
  if (now - last < AUTO_TRIGGER_DEDUP_MS) return true;
  recentAutoTriggerAt.set(messageId, now);
  if (recentAutoTriggerAt.size > 32) {
    for (const [id, at] of recentAutoTriggerAt) {
      if (now - at > 60_000) recentAutoTriggerAt.delete(id);
    }
  }
  return false;
}

function isMvuExtraAnalysisActiveSafe(): boolean {
  try {
    return typeof Mvu !== 'undefined' && Mvu.isDuringExtraAnalysis?.() === true;
  } catch {
    return false;
  }
}

function scheduleAutoTrigger(
  messageId: number,
  type: string,
  source: 'message_received' | 'generation_ended',
): void {
  if (isMvuDeferActive() && source === 'message_received') return;
  // MVU 额外模型解析期间也会触发 GENERATION_ENDED，不应启动工作流（防双跑；变量就绪以 defer 的 ENDED 为准）
  if (source === 'generation_ended' && isMvuExtraAnalysisActiveSafe()) return;
  if (shouldSuppressAutoTriggerAfterAbort()) return;

  const resolved = resolveAutoTriggerMessageId(messageId);
  const targetId = resolved?.id;
  if (targetId == null) return;

  const launch = () => {
    if (source === 'generation_ended' && isMvuExtraAnalysisActiveSafe()) return;
    if (shouldDedupAutoTrigger(targetId)) return;
    void handleMessageReceived(messageId, type, { fromGenerationEnded: source === 'generation_ended' });
  };

  // GENERATION_ENDED 的 messageId 常与 MESSAGE_RECEIVED 不同，按楼层去重；并略延迟让 regenerate 等先占坑
  if (source === 'generation_ended') {
    setTimeout(launch, 80);
    return;
  }
  launch();
}

export async function handleMessageReceived(
  messageId: number,
  type: string,
  options?: {
    bypassSchedule?: boolean;
    force?: boolean;
    isRerun?: boolean;
    taskIdFilter?: string;
    fromGenerationEnded?: boolean;
  },
): Promise<void> {
  const baseSettings = loadSettings();
  const settings = resolveEffectiveSettings(baseSettings);
  const resolved = resolveAutoTriggerMessageId(messageId);
  const targetId = resolved?.id;
  if (targetId == null) return;
  if (!settings.enabled && !options?.force) return;
  if (!isAutoTriggerMessageType(type) && !options?.force && !options?.fromGenerationEnded) return;
  if (isPostProcessSilent()) return;

  // 在任何 await 之前占坑，避免 GENERATION_ENDED / MESSAGE_RECEIVED 同楼双开
  if (!tryMarkProcessing(targetId)) return;

  let runEpoch: number | undefined;
  try {
    let msg = getChatMessages(targetId)[0];
    if (!msg || msg.role !== 'assistant') return;

    const explicitIsRerun = options?.isRerun === true;
    const bodyReplaceEnabled = hasConfiguredChatBodyTagReplaceRules(settings);
    // GENERATION_ENDED 兜底触发不是用户刷新生文；MVU 额外模型解析改写正文后 inject 后缀可能丢失，
    // 若仍按「陈旧 done」清理会误判为 rerun，导致额外模型结束后再跑一遍工作流。
    const allowStaleClear =
      !options?.fromGenerationEnded || isContentRefreshMessageType(type);
    const clearedStale = allowStaleClear
      ? await clearStalePostProcessRunMarkers(targetId)
      : false;
    if (clearedStale) {
      msg = getChatMessages(targetId)[0];
      if (!msg || msg.role !== 'assistant') return;
    }

    const hadDoneFlag = !!(msg.data as Record<string, unknown>)?._post_process_done;
    // 自动重跑仅认 regenerate/swipe/continue 等。
    // clearedStale 只表示「继承了上一楼的 done/inject」，清理后应视为本楼首次跑，
    // 不得当成 isRerun（否则会 restore 继承来的空 baseline，清空已继承的 addon_data）。
    const isRerun = explicitIsRerun || (hadDoneFlag && isContentRefreshMessageType(type));

    if (!options?.force && hadDoneFlag && !isRerun) return;

    const { signal, epoch } = beginRun();
    runEpoch = epoch;
    showTaskProgressToast('正在准备工作流任务...', () => {
      requestCancelRun();
    });

    const onProgress = (update: TaskProgressUpdate) => {
      if (isTaskProgressStopping()) return;
      updateTaskProgressToast(update);
    };

    let newlyCreatedReplicaIds: string[] = [];

    try {
      if (isRerun) {
        restorePostProcessTagsFromPreviousFloor(targetId);
        // 仅手动重跑且启用正文替换时才 restore；自动路径若 restore 会把新楼/刷新生文打回上一轮 origin
        if (bodyReplaceEnabled && explicitIsRerun) {
          await restoreBodyReplaceOrigin(targetId);
        }
        await reconcileWorldbookWritesFromChat({ excludeMessageId: targetId, reason: 'rerun' });
        await clearWorldbookWriteMessageKeys(targetId);
        await reconcileReplicaTasksForRerun(targetId);
        await clearReplicaStateMessageKeys(targetId);
        const reconciled = resolveEffectiveSettings(loadSettings());
        settings.tasks = reconciled.tasks;
        settings.replicaFamilyCleanup = reconciled.replicaFamilyCleanup;
      }
      if (bodyReplaceEnabled) {
        await ensureBodyReplaceOriginCaptured(targetId);
      }
      applyAssistantChatTagExtract(targetId, settings, { isRerun });

      clearPendingReplicaRenames(targetId);

      const snapshot = captureDataSnapshot();
      const runResult = await runPostProcessTasks(
        settings,
        snapshot,
        targetId,
        {
          bypassSchedule: options?.bypassSchedule ?? false,
          isRerun,
          signal,
          onProgress,
          taskIdFilter: options?.taskIdFilter,
        },
      );
      const {
        results,
        cancelled,
        newlyCreatedReplicaIds: createdIds,
        executedMemberIds,
        opportunityMemberIds,
        scheduleWaitMemberIds,
      } = runResult;
      newlyCreatedReplicaIds = createdIds;

      baseSettings.scheduleState = _.cloneDeep(settings.scheduleState);
      await persistRunStatus(baseSettings, targetId, results);

      if (cancelled) {
        clearPendingReplicaRenames(targetId);
        acuToast('warning', '工作流已由用户取消');
        return;
      }

      const hasSuccess = results.some(r => r.success && !r.skipped);
      if (hasSuccess) {
        await applyTagVariableInjectTemplate(settings, results, targetId);
      }

      const aiBlock = await mergeAiFloorInjectBlock(settings, results, targetId);
      await injectToAiFloor(targetId, aiBlock, { isRerun });

      incrementReplicaScheduleWaitCounts(settings, scheduleWaitMemberIds);
      incrementReplicaOpportunityCounts(settings, opportunityMemberIds);
      incrementReplicaRunCounts(settings, executedMemberIds);
      await finalizeReplicaRuntimeState(baseSettings, settings, newlyCreatedReplicaIds);

      if (settings.messageVarRetention?.enabled) {
        const { cleanupOldMessageFloorVariables } = await import('./message-var-retention');
        cleanupOldMessageFloorVariables(settings.messageVarRetention.keepFloors);
        await cleanupOldRunStatusSnapshots(settings.messageVarRetention.keepFloors);
      }

      hideTaskProgressToast();
      await runReplicaFamilyCleanupIfDue(baseSettings, settings, targetId, newlyCreatedReplicaIds);
      await writeReplicaStateSnapshot(targetId, settings.tasks);
    } catch (e) {
      const superseded =
        e instanceof RunCancelledError && runEpoch !== undefined && getRunEpoch() !== runEpoch;
      if (superseded) {
        return;
      }
      if (e instanceof RunCancelledError) {
        clearPendingReplicaRenames(targetId);
        acuToast('warning', '工作流已由用户取消');
        return;
      }
      try {
        settings.tasks = await applyPendingReplicaRenames({
          messageId: targetId,
          tasks: settings.tasks,
          rules: settings.chatWorldbookWriteRules ?? [],
          settings,
        });
        await finalizeReplicaRuntimeState(baseSettings, settings, newlyCreatedReplicaIds);
      } catch (flushErr) {
        console.warn('[工作流助手] 异常后 flush pending rename 失败:', flushErr);
      }
      clearPendingReplicaRenames(targetId);
      console.error(SCRIPT_LOG_PREFIX, e);
      acuToast('error', `工作流执行失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      hideTaskProgressToast();
      endRun(runEpoch);
    }
  } finally {
    unmarkProcessing(targetId);
  }
}

export function registerTrigger(): EventOnReturn {
  const offDefer = registerMvuDeferredTrigger(handleMessageReceived);

  const offImmediate = eventOn(tavern_events.MESSAGE_RECEIVED, (messageId, type) => {
    if (!isAutoTriggerMessageType(type)) return;
    scheduleAutoTrigger(messageId, type, 'message_received');
  });

  const offGenerationEnded = eventMakeLast(tavern_events.GENERATION_ENDED, (messageId: number) => {
    scheduleAutoTrigger(messageId, 'normal', 'generation_ended');
  });

  const offGenerationStopped = eventOn(tavern_events.GENERATION_STOPPED, () => {
    markChatGenerationAborted();
  });

  const offGenerationStarted = eventOn(tavern_events.GENERATION_STARTED, () => {
    markChatGenerationStarted();
  });

  return {
    stop: () => {
      offImmediate.stop();
      offGenerationEnded.stop();
      offGenerationStopped.stop();
      offGenerationStarted.stop();
      offDefer.stop();
    },
  };
}

export type TriggerTaskOptions = {
  bypassSchedule?: boolean;
  isRerun?: boolean;
};

export async function rerunCurrentFloor(): Promise<void> {
  const lastId = resolveManualRerunFloorId();
  if (lastId == null) {
    acuToast('warning', '当前没有可执行工作流的 AI 回复楼层');
    return;
  }
  const msg = getChatMessages(lastId)[0];
  if (!msg || msg.role !== 'assistant') {
    acuToast('warning', '当前最后一楼不是 AI 回复');
    return;
  }
  await handleMessageReceived(lastId, 'normal', { bypassSchedule: true, force: true, isRerun: true });
}

export async function triggerTask(taskId: string, options?: TriggerTaskOptions): Promise<void> {
  const trimmed = taskId?.trim();
  if (!trimmed) throw new Error('任务 ID 不能为空');
  const lastId = resolveManualRerunFloorId();
  if (lastId == null) {
    acuToast('warning', '当前没有可执行工作流的 AI 回复楼层');
    return;
  }
  const msg = getChatMessages(lastId)[0];
  if (!msg || msg.role !== 'assistant') {
    acuToast('warning', '当前最后一楼不是 AI 回复');
    return;
  }
  await handleMessageReceived(lastId, 'normal', {
    bypassSchedule: options?.bypassSchedule ?? true,
    force: true,
    isRerun: options?.isRerun ?? true,
    taskIdFilter: trimmed,
  });
}
