import { resolveTaskApiPresetChain } from '../api/resolve';
import { buildRoutePoolKey, RouteConcurrencyPoolRegistry } from '../api/route-concurrency-pool';
import {
  buildRouteConcurrencyLimits,
  hasAnyRouteConcurrencyCap,
} from '../api/route-concurrency-limits';
import { callTaskApiWithRouteFallback } from '../api/task-api-route';
import {
  buildSharedContext,
  renderTaskMessages,
  resolveTaskPlaceholders,
  type SharedContext,
} from './placeholders';
import { countAssistantRounds, shouldRunTask, updateScheduleStateAfterRun, type ScheduleContext } from './schedule';
import { getCurrentChatKey } from '../api/chat-key';
import {
  abortableDelay,
  checkRunCancelled,
  createSerialGate,
  isRunCancelled,
  RunCancelledError,
  type SerialGate,
} from './run-control';
import {
  extractPlotTagsFromResponse,
  mergeRelayTagMap,
  type RelayTagMap,
} from './utils';
import {
  collectReplicaEnumRenames,
  parseReplicaEnumFromResponse,
  replicaEnumResultToRegistryTags,
} from './replica-enum-parse';
import { recordPendingReplicaRenames } from './replica-enum-pending';
import { applyPendingReplicaRenames } from './replica-enum-rename';
import {
  extractStrictVariableResponse,
  hasCompleteVariableXml,
  type ActiveStructuredOutputMode,
} from './strict-variable-response';
import { acuToast } from '../ui/toast';
import type { PostProcessTask, RunLogMessage, ScriptSettings } from './schema';
import type { DataSnapshot } from '../bridge/database-api';
import type { TaskProgressItem, TaskProgressSnapshot, TaskProgressUpdate } from '../ui/task-progress-toast';
import { applyChatBodyTagReplaceAfterStage } from './chat-body-tag-replace';
import {
  applyVariableUpdatesAfterStage,
  clearAddonPatchLogForWorkflowRound,
  restoreInjectVarBaselineForRerun,
} from './inject-variable-update';
import { applyChatWorldbookWriteAfterStage } from '../worldbook/write-from-template';
import { beginWorldbookReadCache, clearWorldbookReadCache } from '../worldbook/read-cache';
import { beginTemplateProcessMemo, endTemplateProcessMemo } from './template-process';
import {
  buildStageProgressDisplayItems,
  disableReplicaFamilyOnTasks,
  enableReplicaFamilyOnTask,
  prepareStageTasksWithReplicaSync,
  resolveReplicaEnumTaskRef,
  type ReplicaMemberProgressState,
} from './replica-family';

export interface TaskRunResult {
  taskId: string;
  taskName: string;
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
  /** 已过任务调度门（shouldRunTask）；用于副本清理「试过」计数 */
  schedulePassed?: boolean;
  /** 全部摘取内容，用于 {{task:任务名}} */
  extractedBlock: string;
  extractedTags: Record<string, string>;
  injectOnlyTagNames: string[];
  rawResponse: string;
  /**
   * 用于阶段末变量更新的全文（processedResponse || rawResponse）。
   * 不可用 extractedBlock：其它 extractInjectTags 命中时 UpdateVariable 可能不在 block 里。
   */
  variableUpdateSource?: string;
  reasoningContent?: string;
  promptMessages: RunLogMessage[];
  durationMs: number;
  stage: number;
  apiPresetUsed?: string;
}

const processingIds = new Set<number>();
let silentGenerationDepth = 0;
let lastPromptMessages: RunLogMessage[] = [];
let lastPlaceholderVars: Record<string, string> = {};

export function getLastPromptMessages(): RunLogMessage[] {
  return _.cloneDeep(lastPromptMessages);
}

export function getLastPlaceholderVars(): Record<string, string> {
  return _.cloneDeep(lastPlaceholderVars);
}

export function isPostProcessSilent(): boolean {
  return silentGenerationDepth > 0;
}

export function markProcessing(messageId: number): void {
  processingIds.add(messageId);
}

/** 同步占坑：已在处理则返回 false，避免同楼双开竞态 */
export function tryMarkProcessing(messageId: number): boolean {
  if (processingIds.has(messageId)) return false;
  processingIds.add(messageId);
  return true;
}

export function unmarkProcessing(messageId: number): void {
  processingIds.delete(messageId);
}

export function isProcessing(messageId: number): boolean {
  return processingIds.has(messageId);
}

function taskHasSkipTags(task: PostProcessTask, aiText: string): boolean {
  if (!task.skipIfTagsFound?.length) return false;
  return task.skipIfTagsFound.some(tag => aiText.toLowerCase().includes(`<${tag.toLowerCase()}>`));
}

function getStructuredOutputMode(task: PostProcessTask): ActiveStructuredOutputMode | null {
  const mode = task.structuredOutputMode ?? 'off';
  if (mode === 'off') return null;
  return mode;
}

function resolveStructuredResponse(
  rawResponse: string,
  mode: ActiveStructuredOutputMode,
): {
  ok: true;
  text: string;
  recovered?: boolean;
  skippedOpCount?: number;
} | { ok: false; error: string } {
  const strict = extractStrictVariableResponse(rawResponse, mode);
  if (strict.ok && strict.normalizedXml) {
    return {
      ok: true,
      text: strict.normalizedXml,
      recovered: strict.recovered,
      skippedOpCount: strict.skippedOpCount,
    };
  }
  if (hasCompleteVariableXml(rawResponse, mode)) {
    return { ok: true, text: rawResponse.trim() };
  }
  return { ok: false, error: strict.retryHint || strict.error || '严格 JSON 解析失败' };
}

async function runSingleTask(
  task: PostProcessTask,
  ctx: SharedContext,
  relayTagMap: RelayTagMap,
  scheduleCtx: ScheduleContext,
  options?: {
    signal?: AbortSignal;
    routePoolRegistry?: RouteConcurrencyPoolRegistry;
    promptPrepGate?: SerialGate;
  },
): Promise<TaskRunResult> {
  const start = Date.now();
  checkRunCancelled(options?.signal);
  const state = ctx.settings.scheduleState[task.id];
  const scheduleCheck = shouldRunTask(task, state, scheduleCtx);
  if (!scheduleCheck.run) {
    return {
      taskId: task.id,
      taskName: task.name,
      success: false,
      skipped: true,
      skipReason: scheduleCheck.reason,
      schedulePassed: false,
      extractedBlock: '',
      extractedTags: {},
      injectOnlyTagNames: [],
      rawResponse: '',
      variableUpdateSource: '',
      promptMessages: [],
      durationMs: Date.now() - start,
      stage: task.stage,
    };
  }

  if (taskHasSkipTags(task, ctx.aiText)) {
    return {
      taskId: task.id,
      taskName: task.name,
      success: false,
      skipped: true,
      skipReason: 'AI 正文已含跳过标签',
      schedulePassed: true,
      extractedBlock: '',
      extractedTags: {},
      injectOnlyTagNames: [],
      rawResponse: '',
      variableUpdateSource: '',
      promptMessages: [],
      durationMs: Date.now() - start,
      stage: task.stage,
    };
  }

  const prepareMessages = async () => {
    const resolved = await resolveTaskPlaceholders(task, ctx, relayTagMap);
    checkRunCancelled(options?.signal);
    lastPlaceholderVars = _.cloneDeep(resolved);
    return renderTaskMessages(
      task,
      resolved,
      relayTagMap,
      ctx.messageVarHistoryMap,
      ctx.injectOnlyTagsUnion,
      ctx.messageId,
      ctx.settings.tasks,
      ctx.replicaState,
    );
  };
  const messages = options?.promptPrepGate
    ? await options.promptPrepGate.run(prepareMessages, options.signal)
    : await prepareMessages();
  if (!messages.length) {
    return {
      taskId: task.id,
      taskName: task.name,
      success: false,
      skipReason: '无有效提示词',
      schedulePassed: true,
      extractedBlock: '',
      extractedTags: {},
      injectOnlyTagNames: [],
      rawResponse: '',
      variableUpdateSource: '',
      promptMessages: [],
      durationMs: Date.now() - start,
      stage: task.stage,
    };
  }

  const presetChain = resolveTaskApiPresetChain(ctx.settings, task.id, task);
  const routeLimits = buildRouteConcurrencyLimits(ctx.settings, task.id, task);
  const poolScopeId = task.replicaFamilyRootId ?? task.id;
  const poolKey = buildRoutePoolKey(poolScopeId, presetChain, routeLimits);
  const routePool = hasAnyRouteConcurrencyCap(routeLimits)
    ? options?.routePoolRegistry?.getOrCreate(poolKey, presetChain, routeLimits)
    : null;
  const structuredMode = getStructuredOutputMode(task);
  const apiMessages = messages;
  const maxRetries = task.maxRetries ?? 3;
  let rawResponse = '';
  let reasoningContent: string | undefined;
  let lastError = '';
  let processedResponse = '';
  let apiPresetUsed: string | undefined;
  let retryOnPrimaryOnly = false;

  lastPromptMessages = _.cloneDeep(apiMessages);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    checkRunCancelled(options?.signal);
    try {
      silentGenerationDepth++;
      const apiResult = await callTaskApiWithRouteFallback(
        apiMessages,
        ctx.settings,
        presetChain,
        structuredMode,
        `post-process-${task.id}-${ctx.messageId}-${attempt}`,
        {
          routePool,
          preferPrimaryOnly: retryOnPrimaryOnly,
          signal: options?.signal,
        },
      );
      rawResponse = apiResult.content;
      reasoningContent = apiResult.reasoningContent;
      apiPresetUsed = apiResult.usedPresetName;
      retryOnPrimaryOnly = false;
    } catch (e) {
      if (
        e instanceof RunCancelledError ||
        isRunCancelled(options?.signal) ||
        (e instanceof DOMException && e.name === 'AbortError')
      ) {
        throw new RunCancelledError();
      }
      lastError = e instanceof Error ? e.message : String(e);
      retryOnPrimaryOnly = false;
      continue;
    } finally {
      silentGenerationDepth = Math.max(0, silentGenerationDepth - 1);
    }
    checkRunCancelled(options?.signal);

    if (structuredMode) {
      const resolved = resolveStructuredResponse(rawResponse, structuredMode);
      if (resolved.ok) {
        processedResponse = resolved.text;
        // MVU：坏 op 已在工作流过滤，需显式提示；Addon 交由 addon-mvu notifyIssues
        if (
          structuredMode === 'mvu_json_patch' &&
          (resolved.skippedOpCount ?? 0) > 0
        ) {
          acuToast(
            'warning',
            `变量更新：已跳过 ${resolved.skippedOpCount} 条无法解析的 MVU patch op`,
          );
        }
        break;
      }
      lastError = resolved.error;
      retryOnPrimaryOnly = true;
      if (attempt < maxRetries - 1) {
        await abortableDelay(1000, options?.signal);
      }
      continue;
    }

    processedResponse = rawResponse;
    if ((rawResponse?.trim().length ?? 0) >= (task.minLength ?? 0)) break;
    lastError = '响应过短';
    retryOnPrimaryOnly = true;
    if (attempt < maxRetries - 1) {
      await abortableDelay(1000, options?.signal);
    }
  }

  if (!processedResponse && rawResponse) {
    processedResponse = structuredMode ? '' : rawResponse;
  }

  const plotExtraction = extractPlotTagsFromResponse(processedResponse || rawResponse, task.extractInjectTags ?? []);
  const enumParsed = parseReplicaEnumFromResponse(processedResponse || rawResponse);
  recordPendingReplicaRenames(ctx.messageId, collectReplicaEnumRenames(enumParsed));
  const enumRegistryTags = replicaEnumResultToRegistryTags(enumParsed, taskRef =>
    resolveReplicaEnumTaskRef(taskRef, ctx.settings.tasks),
  );
  const hasEnumRegistry = Object.keys(enumRegistryTags).length > 0;
  const extractedTags = { ...plotExtraction.extractedTags, ...enumRegistryTags };
  const hasTags = Object.keys(extractedTags).length > 0;
  const responseForBlock = processedResponse || rawResponse;
  const extractedBlock = hasTags
    ? plotExtraction.injectedFragments.join('\n\n')
    : responseForBlock.trim();

  const structuredSuccess = structuredMode != null && processedResponse.trim().length > 0;
  const success = structuredSuccess || hasTags || hasEnumRegistry || extractedBlock.length >= (task.minLength ?? 0);
  if (success) {
    updateScheduleStateAfterRun(ctx.settings, task, scheduleCtx);
  }

  return {
    taskId: task.id,
    taskName: task.name,
    success,
    skipReason: success ? undefined : lastError || '提取失败',
    schedulePassed: true,
    extractedBlock,
    extractedTags,
    injectOnlyTagNames: plotExtraction.injectOnlyTagNames,
    rawResponse,
    variableUpdateSource: responseForBlock,
    reasoningContent,
    promptMessages: messages,
    durationMs: Date.now() - start,
    stage: task.stage,
    apiPresetUsed,
  };
}

function groupTasksByStage(tasks: PostProcessTask[], listOrder: PostProcessTask[]): PostProcessTask[][] {
  const indexById = new Map(listOrder.map((t, i) => [t.id, i]));
  const sorted = [...tasks].sort((a, b) => {
    if (a.stage !== b.stage) return a.stage - b.stage;
    return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
  });
  const groups: PostProcessTask[][] = [];
  let currentStage = -1;
  for (const task of sorted) {
    if (task.stage !== currentStage) {
      groups.push([]);
      currentStage = task.stage;
    }
    groups[groups.length - 1].push(task);
  }
  return groups;
}

interface StageProgressReporter {
  setRunning(taskId: string): void;
  markAllRunning(): void;
  setFinished(taskId: string, result: TaskRunResult): void;
  pushSnapshot(): void;
}

function createStageProgressReporter(
  stageTasks: PostProcessTask[],
  stageNo: number,
  allTasks: PostProcessTask[],
  onProgress?: (update: TaskProgressUpdate) => void,
): StageProgressReporter {
  const memberStates = new Map<string, ReplicaMemberProgressState>();
  for (const task of stageTasks) {
    memberStates.set(task.id, { status: 'pending' });
  }

  let tasks: TaskProgressItem[] = buildStageProgressDisplayItems(stageTasks, allTasks, memberStates);

  const refreshDisplayItems = () => {
    tasks = buildStageProgressDisplayItems(stageTasks, allTasks, memberStates);
  };

  const pushSnapshot = () => {
    const snapshot: TaskProgressSnapshot = {
      headline: `正在执行阶段${stageNo}`,
      stageNo,
      tasks: tasks.map(t => ({ ...t })),
    };
    onProgress?.(snapshot);
  };

  return {
    setRunning(taskId: string) {
      const state = memberStates.get(taskId);
      if (!state) return;
      state.status = 'running';
      state.detail = undefined;
      refreshDisplayItems();
      pushSnapshot();
    },
    markAllRunning() {
      for (const task of stageTasks) {
        const state = memberStates.get(task.id);
        if (!state) continue;
        state.status = 'running';
        state.detail = undefined;
      }
      refreshDisplayItems();
      pushSnapshot();
    },
    setFinished(taskId: string, result: TaskRunResult) {
      const state = memberStates.get(taskId);
      if (!state) return;
      if (result.skipped) {
        state.status = 'skipped';
        state.detail = result.skipReason;
      } else if (result.success) {
        state.status = 'done';
        state.detail = undefined;
      } else {
        state.status = 'failed';
        state.detail = result.skipReason;
      }
      refreshDisplayItems();
      pushSnapshot();
    },
    pushSnapshot,
  };
}

export interface RunPostProcessOptions {
  bypassSchedule?: boolean;
  isRerun?: boolean;
  signal?: AbortSignal;
  onProgress?: (update: TaskProgressUpdate) => void;
  /** 设置时仅运行该 id 的已启用任务，不展开副本族 */
  taskIdFilter?: string;
}

export type RunPostProcessResult = {
  results: TaskRunResult[];
  ctx: SharedContext;
  cancelled?: boolean;
  newlyCreatedReplicaIds: string[];
  executedMemberIds: string[];
  opportunityMemberIds: string[];
  scheduleWaitMemberIds: string[];
};

export async function runPostProcessTasks(
  settings: ScriptSettings,
  snapshot: DataSnapshot,
  messageId: number,
  options?: RunPostProcessOptions,
): Promise<RunPostProcessResult> {
  if (options?.isRerun) {
    await restoreInjectVarBaselineForRerun(messageId);
  }
  // 每轮工作流从空变更日志开始；同轮多阶段 apply 再按 messageId 合并
  await clearAddonPatchLogForWorkflowRound();

  const ctx = await buildSharedContext(messageId, settings, snapshot, { isRerun: options?.isRerun });
  checkRunCancelled(options?.signal);
  beginTemplateProcessMemo();
  try {
  let enabledTasks = settings.tasks.filter(t => t.enabled);
  const allNewlyCreatedReplicaIds: string[] = [];
  const allExecutedMemberIds: string[] = [];
  const allOpportunityMemberIds: string[] = [];
  const allScheduleWaitMemberIds: string[] = [];
  if (options?.taskIdFilter) {
    enabledTasks = enabledTasks.filter(t => t.id === options.taskIdFilter);
    if (!enabledTasks.length) {
      throw new Error(`任务不存在或未启用: ${options.taskIdFilter}`);
    }
  }
  if (!enabledTasks.length) {
    return {
      results: [],
      ctx,
      newlyCreatedReplicaIds: [],
      executedMemberIds: [],
      opportunityMemberIds: [],
      scheduleWaitMemberIds: [],
    };
  }

  options?.onProgress?.('正在准备工作流任务...');
  const scheduleCtx: ScheduleContext = {
    currentRound: countAssistantRounds(),
    currentAiText: ctx.aiText,
    currentPairText: [ctx.userText, ctx.aiText].filter(Boolean).join('\n'),
    settings,
    bypassSchedule: options?.bypassSchedule ?? false,
    chatKey: getCurrentChatKey(),
  };

  if (options?.taskIdFilter) {
    const task = enabledTasks[0]!;
    beginWorldbookReadCache();
    const routePoolRegistry = new RouteConcurrencyPoolRegistry();
    const reporter = createStageProgressReporter([task], task.stage, settings.tasks, options?.onProgress);
    reporter.pushSnapshot();
    reporter.setRunning(task.id);
    const result = await runSingleTask(task, ctx, new Map(), scheduleCtx, {
      signal: options?.signal,
      routePoolRegistry,
    });
    reporter.setFinished(task.id, result);
    checkRunCancelled(options?.signal);
    await applyVariableUpdatesAfterStage(messageId, [result]);
    const isMember = !!task.replicaFamilyRootId;
    return {
      results: [result],
      ctx,
      newlyCreatedReplicaIds: [],
      executedMemberIds: result.success && !result.skipped && isMember ? [task.id] : [],
      opportunityMemberIds: result.schedulePassed && isMember ? [task.id] : [],
      scheduleWaitMemberIds: result.schedulePassed === false && isMember ? [task.id] : [],
    };
  }

  const results: TaskRunResult[] = [];
  const aggregatedRelayTags: RelayTagMap = new Map();
  const routePoolRegistry = new RouteConcurrencyPoolRegistry();
  let cancelled = false;

  try {
    for (const stageTasksRaw of groupTasksByStage(enabledTasks, settings.tasks)) {
      checkRunCancelled(options?.signal);
      const stageNo = stageTasksRaw[0]?.stage ?? 1;

      settings.tasks = await applyPendingReplicaRenames({
        messageId,
        tasks: settings.tasks,
        rules: settings.chatWorldbookWriteRules ?? [],
        settings,
      });
      beginWorldbookReadCache();

      const prepared = prepareStageTasksWithReplicaSync(stageTasksRaw, settings.tasks, aggregatedRelayTags);
      settings.tasks = prepared.allTasks;
      allNewlyCreatedReplicaIds.push(...prepared.newlyCreatedReplicaIds);

      const stageTasks = prepared.tasks;
      const skippedRootResults: TaskRunResult[] = prepared.skippedRoots.map(({ root, skipReason }) => ({
        taskId: root.id,
        taskName: root.name,
        success: false,
        skipped: true,
        skipReason,
        extractedBlock: '',
        extractedTags: {},
        injectOnlyTagNames: [],
        rawResponse: '',
        variableUpdateSource: '',
        promptMessages: [],
        durationMs: 0,
        stage: root.stage,
      }));

      if (!stageTasks.length) {
        results.push(...skippedRootResults);
        continue;
      }

      const reporter = createStageProgressReporter(stageTasks, stageNo, settings.tasks, options?.onProgress);
      reporter.pushSnapshot();
      reporter.markAllRunning();

      const stageRelayTagMap = new Map(aggregatedRelayTags);
      const promptPrepGate = createSerialGate();
      const runOptions = { signal: options?.signal, routePoolRegistry, promptPrepGate };
      const stageResults = await Promise.all(
        stageTasks.map(async task => {
          const result = await runSingleTask(task, ctx, stageRelayTagMap, scheduleCtx, runOptions);
          reporter.setFinished(task.id, result);
          return result;
        }),
      );
      checkRunCancelled(options?.signal);
      results.push(...skippedRootResults, ...stageResults);

      for (const r of stageResults) {
        if (r.success && !r.skipped) {
          const task = settings.tasks.find(t => t.id === r.taskId);
          if (task?.replicaFamilyRootId) allExecutedMemberIds.push(r.taskId);
        }
        if (r.schedulePassed) {
          const task = settings.tasks.find(t => t.id === r.taskId);
          if (task?.replicaFamilyRootId) allOpportunityMemberIds.push(r.taskId);
        } else if (r.schedulePassed === false) {
          const task = settings.tasks.find(t => t.id === r.taskId);
          if (task?.replicaFamilyRootId) allScheduleWaitMemberIds.push(r.taskId);
        }
        if (r.success && Object.keys(r.extractedTags).length) {
          mergeRelayTagMap(aggregatedRelayTags, r.extractedTags);
        }
      }

      await applyVariableUpdatesAfterStage(messageId, stageResults);

      await applyChatBodyTagReplaceAfterStage({
        messageId: ctx.messageId,
        settings,
        stageResults,
        allStageResults: results,
        ctx,
        onMessageUpdated: text => {
          scheduleCtx.currentAiText = text;
          scheduleCtx.currentPairText = [ctx.userText, text].filter(Boolean).join('\n');
        },
      });

      await applyChatWorldbookWriteAfterStage({
        messageId: ctx.messageId,
        settings,
        stageResults,
        allStageResults: results,
      });
      ctx.taskWorldbookCache.clear();
      ctx.taskManagedWorldbookCache.clear();
      clearWorldbookReadCache();
    }
  } catch (e) {
    if (e instanceof RunCancelledError || isRunCancelled(options?.signal)) {
      cancelled = true;
    } else {
      throw e;
    }
  }

  if (!cancelled) {
    settings.tasks = await applyPendingReplicaRenames({
      messageId,
      tasks: settings.tasks,
      rules: settings.chatWorldbookWriteRules ?? [],
      settings,
    });
  }

  return {
    results,
    ctx,
    cancelled,
    newlyCreatedReplicaIds: allNewlyCreatedReplicaIds,
    executedMemberIds: allExecutedMemberIds,
    opportunityMemberIds: allOpportunityMemberIds,
    scheduleWaitMemberIds: allScheduleWaitMemberIds,
  };
  } finally {
    clearWorldbookReadCache();
    endTemplateProcessMemo();
  }
}
