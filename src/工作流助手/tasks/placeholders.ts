import { resolveSummaryIndexContent } from '../bridge/summary-index';
import { buildAssistantContextSlice, buildPlotWorldbookBaseScanText } from './assistant-context';
import {
  finalizeManagedWorldbookPlaceholderContent,
  finalizePlotWorldbookPlaceholderContent,
  getManagedWorldbookContentForPostProcess,
  getWorldbookContentForPostProcess,
} from '../worldbook/content';
import { getMemoryRecallContentForPostProcess } from '../worldbook/memory-recall';
import {
  buildCurrentFloorTagMap,
  buildInjectOnlyTagsUnion,
  buildPreviousFloorTagMap,
  inheritTagVariables,
} from './tag-variables';
import { processTemplateText } from './template-process';
import { resolveDollarUContent } from './user-placeholder';
import { getReplicaAttrSpecForTask } from './replica-family';
import {
  buildTaskWorldbookTriggerText,
  isPromptGroupEnabled,
  replacePlaceholdersInText,
  replacePlotTagPlaceholdersWithHistory,
  type PlotPlaceholderResolveOptions,
  type RelayTagMap,
} from './utils';
import { resolveTaskPlotWorldbookConfig } from './plot-worldbook-config';
import { sanitizeUserInputForPostProcess } from './sanitize-context';
import { settingsWithTaskContext } from './context-config';
import { normalizeContextTagRules } from './context-tags';
import type { DataSnapshot } from '../bridge/database-api';
import type { ChatWorldbookWriteRule, PlotWorldbookConfig, PostProcessTask, RunLogMessage, ScriptSettings } from './schema';
import { normalizePromptRole } from './prompt-role';
import { buildEffectivePromptGroups, iterTaskPromptContents } from './prompt-auto-segments';
import type { ReplicaStateSnapshot } from './replica-state';
import { resolveReplicaStateForMessage } from './replica-reconcile';

export interface SharedContext {
  messageId: number;
  aiText: string;
  userText: string;
  snapshot: DataSnapshot;
  settings: ScriptSettings;
  vars: Record<string, string>;
  taskWorldbookCache: Map<string, string>;
  taskManagedWorldbookCache: Map<string, string>;
  messageVarHistoryMap: RelayTagMap;
  injectOnlyTagsUnion: Set<string>;
  /** 楼层副本状态快照，供 {{total:last-launched:…}} */
  replicaState: ReplicaStateSnapshot;
}

function buildContext7(settings: ScriptSettings, messageId: number, aiText: string): string {
  return buildAssistantContextSlice(settings, messageId, aiText);
}

async function resolve$5(settings: ScriptSettings, snapshot: DataSnapshot, messageId: number): Promise<string> {
  const raw = await resolveSummaryIndexContent(snapshot.tablesJson, settings.plotWorldbookConfig);
  return processTemplateText(raw, messageId, { role: 'system' });
}

async function resolve$6(settings: ScriptSettings, messageId: number): Promise<string> {
  return getMemoryRecallContentForPostProcess(
    settings.plotWorldbookConfig,
    settings.memoryRecallRecentCount ?? 10,
    messageId,
  );
}

export async function buildSharedContext(
  messageId: number,
  settings: ScriptSettings,
  snapshot: DataSnapshot,
  options?: { isRerun?: boolean },
): Promise<SharedContext> {
  const msg = getChatMessages(messageId)[0];
  const aiText = msg?.message ?? '';
  let userText = '';
  try {
    const prev = getChatMessages(messageId - 1)[0];
    if (prev?.role === 'user') userText = prev.message;
  } catch {
    userText = '';
  }

  const $7 = buildContext7(settings, messageId, aiText);
  const $5 = await resolve$5(settings, snapshot, messageId);
  const $6 = await resolve$6(settings, messageId);

  let $U = '';
  let $C = '';
  try {
    $U = await resolveDollarUContent(snapshot, messageId);
  } catch {
    $U = '';
  }
  try {
    const char = await getCharacter('current');
    $C = await processTemplateText(char.description ?? '', messageId, { role: 'system' });
  } catch {
    $C = '';
  }

  const vars: Record<string, string> = {
    $1: '',
    $2: '',
    $5,
    $6,
    $7,
    $8: sanitizeUserInputForPostProcess(userText),
    $U: $U ?? '',
    $C: $C ?? '',
  };

  if (!options?.isRerun) {
    inheritTagVariables(messageId);
  }

  const messageVarHistoryMap = options?.isRerun
    ? buildPreviousFloorTagMap(messageId)
    : buildCurrentFloorTagMap(messageId);
  const injectOnlyTagsUnion = buildInjectOnlyTagsUnion(settings.tasks);
  const replicaState = resolveReplicaStateForMessage(messageId);

  return {
    messageId,
    aiText,
    userText,
    snapshot,
    settings,
    vars,
    taskWorldbookCache: new Map(),
    taskManagedWorldbookCache: new Map(),
    messageVarHistoryMap,
    injectOnlyTagsUnion,
    replicaState,
  };
}

function buildPlotPlaceholderOptions(
  task: PostProcessTask,
  allTasks: PostProcessTask[],
  replicaState?: ReplicaStateSnapshot,
): PlotPlaceholderResolveOptions {
  const replicaAttrSpec = getReplicaAttrSpecForTask(task);
  return {
    historyFallback: 'all-tags',
    allTasks,
    ...(replicaState ? { replicaState } : {}),
    ...(replicaAttrSpec ? { replicaAttrSpec } : {}),
    ...(task.replicaFamilyAttrValue ? { replicaAttrValue: task.replicaFamilyAttrValue } : {}),
  };
}

function buildWorldbookScanText(
  task: PostProcessTask,
  ctx: SharedContext,
  relayTagMap: RelayTagMap,
  taskContextSettings: ScriptSettings,
  needs$8InScan: boolean,
): string {
  const baseScan = buildPlotWorldbookBaseScanText(taskContextSettings, ctx.messageId, ctx.aiText);
  const triggerText = buildTaskWorldbookTriggerText(
    buildEffectivePromptGroups(task),
    relayTagMap,
    ctx.messageVarHistoryMap,
    ctx.injectOnlyTagsUnion,
    buildPlotPlaceholderOptions(task, ctx.settings.tasks, ctx.replicaState),
  );
  return [baseScan, triggerText, needs$8InScan ? (ctx.vars.$8?.trim() ?? '') : '']
    .filter(Boolean)
    .join('\n');
}

function plotWorldbookCacheKey(config: PlotWorldbookConfig, scanText: string): string {
  return `plot\0${config.source}\0${config.manualSelection.join('\0')}\0${JSON.stringify(config.enabledEntries ?? {})}\0${scanText}`;
}

function managedWorldbookCacheKey(scanText: string, writeRules: ChatWorldbookWriteRule[]): string {
  return `managed\0${writeRules.map(r => r.id).join(',')}\0${scanText}`;
}

export async function resolveTaskPlaceholders(
  task: PostProcessTask,
  ctx: SharedContext,
  relayTagMap: RelayTagMap,
): Promise<Record<string, string>> {
  const promptContents = iterTaskPromptContents(task);
  const needs$1 = promptContents.some(c => c.includes('$1'));
  const needs$2 = promptContents.some(c => c.includes('$2'));
  const needs$7 = promptContents.some(c => c.includes('$7'));
  const needs$8InScan = promptContents.some(c => c.includes('$8'));
  const taskContextSettings = settingsWithTaskContext(ctx.settings, task);
  const vars = { ...ctx.vars };

  if (needs$7) {
    vars.$7 = buildContext7(taskContextSettings, ctx.messageId, ctx.aiText);
  }

  const scanText =
    needs$1 || needs$2
      ? buildWorldbookScanText(task, ctx, relayTagMap, taskContextSettings, needs$8InScan)
      : '';
  const excludeRules = normalizeContextTagRules(taskContextSettings.contextExcludeRules);

  if (needs$1) {
    const wbConfig = resolveTaskPlotWorldbookConfig(task, ctx.settings);
    const cacheKey = plotWorldbookCacheKey(wbConfig, scanText);
    if (!ctx.taskWorldbookCache.has(cacheKey)) {
      const wb = await getWorldbookContentForPostProcess(
        wbConfig,
        scanText,
        ctx.messageId,
        ctx.settings.chatWorldbookWriteRules,
        ctx.snapshot.tablesJson,
      );
      ctx.taskWorldbookCache.set(cacheKey, finalizePlotWorldbookPlaceholderContent(wb, excludeRules));
    }
    vars.$1 = ctx.taskWorldbookCache.get(cacheKey) ?? '';
  }

  if (needs$2) {
    const cacheKey = managedWorldbookCacheKey(scanText, ctx.settings.chatWorldbookWriteRules ?? []);
    if (!ctx.taskManagedWorldbookCache.has(cacheKey)) {
      const wb = await getManagedWorldbookContentForPostProcess(
        scanText,
        ctx.messageId,
        ctx.settings.chatWorldbookWriteRules,
      );
      ctx.taskManagedWorldbookCache.set(
        cacheKey,
        finalizeManagedWorldbookPlaceholderContent(wb, excludeRules),
      );
    }
    vars.$2 = ctx.taskManagedWorldbookCache.get(cacheKey) ?? '';
  }

  return vars;
}

export async function renderTaskMessages(
  task: PostProcessTask,
  vars: Record<string, string>,
  relayTagMap: RelayTagMap,
  messageVarHistoryMap: RelayTagMap,
  injectOnlyTagsUnion: Set<string>,
  messageId: number,
  allTasks: PostProcessTask[],
  replicaState?: ReplicaStateSnapshot,
): Promise<RunLogMessage[]> {
  const messages: RunLogMessage[] = [];
  const plotOptions = buildPlotPlaceholderOptions(task, allTasks, replicaState);
  for (const g of buildEffectivePromptGroups(task)) {
    if (!isPromptGroupEnabled(g)) continue;
    let content = g.content;
    content = replacePlaceholdersInText(content, vars);
    content = replacePlotTagPlaceholdersWithHistory(
      content,
      relayTagMap,
      messageVarHistoryMap,
      injectOnlyTagsUnion,
      plotOptions,
    );
    // 预设段不套用「用户输入/AI输出」正则作用域，固定 slash_command；API role 仍按段配置
    content = await processTemplateText(content, messageId, { source: 'slash_command' });
    if (!content.trim()) continue;
    messages.push({
      role: normalizePromptRole(g.role),
      content,
      name: g.name ?? '',
    });
  }
  return messages;
}
