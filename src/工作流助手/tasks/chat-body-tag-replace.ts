import {
  findAllTagInstances,
  findLastTagInstance,
  parseCompositeKey,
  parseExtractTagSpec,
  storedTagValueToInner,
  type ExtractTagSpec,
} from './tag-extract';
import { isEnumRegistryMarker } from './replica-enum-parse';
import { processTemplateText } from './template-process';
import {
  buildCurrentFloorTagMap,
  buildExtractedBlockFromTags,
  writeFloorTagValues,
} from './tag-variables';
import {
  clearUnresolvedTaskPlaceholders,
  overwriteRelayTagMap,
  replacePlotTagPlaceholdersWithHistory,
  type RelayTagMap,
} from './utils';
import type { SharedContext } from './placeholders';
import type {
  ChatBodyTagReplaceRule,
  ChatWorldbookWriteRule,
  PostProcessTask,
  ScriptSettings,
} from './schema';
import type { TaskRunResult } from './runtime';

export const BODY_REPLACE_ORIGIN_KEY = '_post_process_body_replace_origin';

function isMvuExtraAnalysisActive(): boolean {
  try {
    return typeof Mvu !== 'undefined' && Mvu.isDuringExtraAnalysis?.() === true;
  } catch {
    return false;
  }
}

function keyMatchesExtractSpec(key: string, spec: ExtractTagSpec): boolean {
  if (!spec.attrName) return key === spec.tagName;
  const parsed = parseCompositeKey(key);
  if (!parsed) return false;
  return parsed.tagName === spec.tagName && parsed.attrName === spec.attrName;
}

/** 运行日志等：判断摘取键是否由世界书写入规则的目标标签管理（会写入 post_process_tags） */
export function isTagKeyManagedByWorldbookWriteRules(
  tagKey: string,
  rules: ChatWorldbookWriteRule[],
): boolean {
  for (const rule of rules) {
    const targetTag = rule.targetTag?.trim();
    if (!targetTag) continue;
    const spec = parseExtractTagSpec(targetTag);
    if (!spec) continue;
    if (keyMatchesExtractSpec(tagKey, spec)) return true;
  }
  return false;
}

export function collectStageTagsForRule(stageResults: TaskRunResult[], targetTag: string): Record<string, string> {
  const spec = parseExtractTagSpec(targetTag);
  if (!spec) return {};

  const merged: Record<string, string> = {};
  for (const r of stageResults) {
    if (!r.success || r.skipped) continue;
    for (const [key, value] of Object.entries(r.extractedTags ?? {})) {
      if (!String(value ?? '').trim()) continue;
      // ReplicaEnum 仅注册键名，不含可写入正文；不当作成写入/替换的有效摘取
      if (isEnumRegistryMarker(String(value))) continue;
      if (!keyMatchesExtractSpec(key, spec)) continue;
      merged[key] = value;
    }
  }
  return merged;
}

export function replaceBareTagLastInner(text: string, tagName: string, newInner: string): string {
  const inst = findLastTagInstance(text, tagName);
  if (!inst) return text;
  const blockStart = text.lastIndexOf(inst.fullBlock);
  if (blockStart < 0) return text;
  const openEnd = text.indexOf('>', blockStart);
  if (openEnd < 0) return text;
  const closeTag = `</${tagName}>`;
  const closeStart = blockStart + inst.fullBlock.length - closeTag.length;
  return text.slice(0, openEnd + 1) + newInner + text.slice(closeStart);
}

export function replaceAttrTagInners(
  text: string,
  tagName: string,
  attrName: string,
  attrValueToInner: Record<string, string>,
): string {
  let result = text;
  const lowerAttr = attrName.toLowerCase();
  for (const [attrValue, newInner] of Object.entries(attrValueToInner)) {
    const instances = findAllTagInstances(result, tagName);
    const inst = instances.find(i => i.attrs[lowerAttr] === attrValue);
    if (!inst) continue;
    const blockStart = result.indexOf(inst.fullBlock);
    if (blockStart < 0) continue;
    const openEnd = result.indexOf('>', blockStart);
    if (openEnd < 0) continue;
    const closeTag = `</${tagName}>`;
    const closeStart = blockStart + inst.fullBlock.length - closeTag.length;
    result = result.slice(0, openEnd + 1) + newInner + result.slice(closeStart);
  }
  return result;
}

export function replaceTagInnersInMessage(
  message: string,
  targetTag: string,
  renderedInnerByKey: Record<string, string>,
): string {
  const spec = parseExtractTagSpec(targetTag);
  if (!spec || !Object.keys(renderedInnerByKey).length) return message;

  if (!spec.attrName) {
    const inner = renderedInnerByKey[spec.tagName] ?? renderedInnerByKey[targetTag];
    if (inner == null) return message;
    return replaceBareTagLastInner(message, spec.tagName, inner);
  }

  const attrValues: Record<string, string> = {};
  for (const [key, inner] of Object.entries(renderedInnerByKey)) {
    const parsed = parseCompositeKey(key);
    if (!parsed) continue;
    attrValues[parsed.attrValue] = inner;
  }
  return replaceAttrTagInners(message, spec.tagName, spec.attrName, attrValues);
}

function toTagAggregateInput(r: TaskRunResult) {
  const extractedTags = r.extractedTags ?? {};
  return {
    success: !!r.success,
    skipped: r.skipped,
    extractedTags,
    extractedBlock: buildExtractedBlockFromTags(extractedTags),
    taskId: r.taskId,
    taskName: r.taskName,
  };
}

function aggregateTaskResults(results: TaskRunResult[]): RelayTagMap {
  const aggregated: RelayTagMap = new Map();
  for (const r of results) {
    if (!r.success || r.skipped) continue;
    overwriteRelayTagMap(aggregated, r.extractedTags ?? {});
  }
  return aggregated;
}

export async function renderChatBodyTagReplaceTemplate(
  template: string,
  allStageResults: TaskRunResult[],
  messageId: number,
  allTasks: PostProcessTask[],
): Promise<string> {
  const trimmed = template.trim();
  if (!trimmed) return '';

  const successful = allStageResults.filter(r => r.success && !r.skipped).map(toTagAggregateInput);
  const aggregated = aggregateTaskResults(allStageResults);
  const historyMap = buildCurrentFloorTagMap(messageId);

  let out = trimmed;
  for (const r of successful) {
    out = out.split(`{{task:${r.taskName}}}`).join(r.extractedBlock);
    out = out.split(`{{task:${r.taskId}}}`).join(r.extractedBlock);
  }
  out = clearUnresolvedTaskPlaceholders(out);
  out = replacePlotTagPlaceholdersWithHistory(out, aggregated, historyMap, new Set(), {
    historyFallback: 'all-tags',
    allTasks,
    replicaState: (
      require('./replica-reconcile') as typeof import('./replica-reconcile')
    ).resolveReplicaStateForMessage(messageId),
  });
  return processTemplateText(out, messageId, { role: 'system' });
}

function templateInnerForKey(key: string, rendered: string): string {
  const trimmed = rendered.trim();
  if (!trimmed) return '';
  return storedTagValueToInner(key, trimmed);
}

function isRuleActive(rule: ChatBodyTagReplaceRule, assistantTags: string[]): boolean {
  const targetTag = rule.targetTag.trim();
  const template = rule.template.trim();
  if (!targetTag || !template) return false;
  return assistantTags.some(t => t.trim() === targetTag);
}

/** 是否配置了可用的聊天正文标签替换规则（无需对照 assistant 提取标签） */
export function hasConfiguredChatBodyTagReplaceRules(settings: ScriptSettings): boolean {
  return (settings.chatBodyTagReplaceRules ?? []).some(
    r => r.targetTag.trim().length > 0 && r.template.trim().length > 0,
  );
}

/** 当前正文是否仍带有本轮工作流注入后缀（用于识别「已处理」vs「继承/刷新生文」） */
export function isPostProcessInjectSuffixPresent(message: string, inject: unknown): boolean {
  return typeof inject === 'string' && inject.length > 0 && message.endsWith(inject);
}

/**
 * 楼层变量常被 ST 复制到下一楼：新楼可能带着上一楼的 `_post_process_done` / origin。
 * 若 done 已置位但正文不再以 inject 结尾，视为陈旧状态，应清除后再按新楼处理。
 */
export function shouldClearStalePostProcessRunMarkers(options: {
  hadDone: boolean;
  message: string;
  inject: unknown;
  explicitIsRerun: boolean;
}): boolean {
  if (options.explicitIsRerun || !options.hadDone) return false;
  return !isPostProcessInjectSuffixPresent(options.message, options.inject);
}

/**
 * 是否应（重新）写入本楼 `_post_process_body_replace_origin`。
 * origin 不应随其它楼层变量继承；每层 AI 楼应在首次处理时用本楼正文重建。
 */
export function shouldRecaptureBodyReplaceOrigin(options: {
  existing: unknown;
  message: string;
  hadDone: boolean;
  inject: unknown;
}): boolean {
  if (typeof options.existing !== 'string') return true;
  // 与当前正文一致：本楼刚捕获，或重跑 restore 到正确 origin 之后
  if (options.existing === options.message) return false;
  // 本楼已合法处理完（done + inject 仍在）：保留 origin 供重跑 restore
  if (options.hadDone && isPostProcessInjectSuffixPresent(options.message, options.inject)) {
    return false;
  }
  // 其余（典型：继承自上一楼且与本楼正文不同）→ 按本楼正文重建
  return true;
}

function findPreviousAssistantMessage(messageId: number): ChatMessage | undefined {
  for (let i = messageId - 1; i >= 0; i--) {
    try {
      const m = getChatMessages(i)[0];
      if (m?.role === 'assistant') return m;
    } catch {
      /* continue */
    }
  }
  return undefined;
}

/** origin 是否与上一 AI 楼的 origin/正文相同（继承残留） */
export function isBodyReplaceOriginInheritedFromPreviousFloor(
  messageId: number,
  origin: string,
): boolean {
  const prev = findPreviousAssistantMessage(messageId);
  if (!prev) return false;
  const prevOrigin = (prev.data as Record<string, unknown> | undefined)?.[BODY_REPLACE_ORIGIN_KEY];
  if (typeof prevOrigin === 'string' && prevOrigin === origin) return true;
  return (prev.message ?? '') === origin;
}

/** 与 inject-variable-update 中 baseline 键一致；继承残留必须一并清除 */
const INJECT_VAR_BASELINE_KEY = '_post_process_inject_var_baseline';

/**
 * 清除陈旧的 done / inject / body-replace origin / 注入变量 baseline。
 * 新楼常从上一楼继承这些标记；若不清 baseline，后续误判 isRerun 时会 restore 空骨架并清空 addon_data。
 */
export async function clearStalePostProcessRunMarkers(messageId: number): Promise<boolean> {
  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return false;
  const data = { ...((msg.data ?? {}) as Record<string, unknown>) };
  const hadDone = !!data._post_process_done;
  if (
    !shouldClearStalePostProcessRunMarkers({
      hadDone,
      message: msg.message ?? '',
      inject: data._post_process_inject_block,
      explicitIsRerun: false,
    })
  ) {
    return false;
  }

  delete data._post_process_done;
  delete data._post_process_inject_block;
  delete data[BODY_REPLACE_ORIGIN_KEY];
  delete data[INJECT_VAR_BASELINE_KEY];

  await setChatMessages([{ message_id: messageId, data }], { refresh: 'none' });
  return true;
}

export async function ensureBodyReplaceOriginCaptured(messageId: number): Promise<void> {
  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return;
  const data = (msg.data ?? {}) as Record<string, unknown>;
  const existing = data[BODY_REPLACE_ORIGIN_KEY];
  const message = msg.message ?? '';
  if (
    !shouldRecaptureBodyReplaceOrigin({
      existing,
      message,
      hadDone: !!data._post_process_done,
      inject: data._post_process_inject_block,
    })
  ) {
    return;
  }

  await setChatMessages(
    [
      {
        message_id: messageId,
        data: {
          ...data,
          [BODY_REPLACE_ORIGIN_KEY]: message,
        },
      },
    ],
    { refresh: 'none' },
  );
}

export async function restoreBodyReplaceOrigin(messageId: number): Promise<void> {
  const msg = getChatMessages(messageId)[0];
  if (!msg) return;
  const data = (msg.data ?? {}) as Record<string, unknown>;
  const origin = data[BODY_REPLACE_ORIGIN_KEY];
  if (typeof origin !== 'string') return;

  if (isBodyReplaceOriginInheritedFromPreviousFloor(messageId, origin)) {
    // 丢弃继承残留，避免把上一楼原文写进本楼；以当前正文作为本楼新 origin
    await setChatMessages(
      [
        {
          message_id: messageId,
          data: {
            ...data,
            [BODY_REPLACE_ORIGIN_KEY]: msg.message ?? '',
          },
        },
      ],
      { refresh: 'none' },
    );
    return;
  }

  await setChatMessages(
    [
      {
        message_id: messageId,
        message: origin,
        data: { ...data },
      },
    ],
    { refresh: 'affected' },
  );
}

export interface ApplyChatBodyTagReplaceAfterStageOptions {
  messageId: number;
  settings: ScriptSettings;
  stageResults: TaskRunResult[];
  allStageResults: TaskRunResult[];
  ctx: SharedContext;
  onMessageUpdated?: (text: string) => void;
}

export async function applyChatBodyTagReplaceAfterStage(
  options: ApplyChatBodyTagReplaceAfterStageOptions,
): Promise<void> {
  const { messageId, settings, stageResults, allStageResults, ctx, onMessageUpdated } = options;
  const rules = settings.chatBodyTagReplaceRules ?? [];
  if (!rules.length) return;

  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return;

  if (isMvuExtraAnalysisActive()) {
    console.warn('[工作流助手] MVU 额外模型解析进行中，已跳过本阶段聊天正文标签替换');
    return;
  }

  const assistantTags = settings.chatExtractTags?.assistant ?? [];
  let message = msg.message ?? '';
  let anyReplaced = false;

  for (const rule of rules) {
    if (!isRuleActive(rule, assistantTags)) continue;

    const stageTags = collectStageTagsForRule(stageResults, rule.targetTag);
    if (!Object.keys(stageTags).length) continue;

    writeFloorTagValues(messageId, stageTags);

    const rendered = await renderChatBodyTagReplaceTemplate(
      rule.template,
      allStageResults,
      messageId,
      settings.tasks,
    );
    const renderedInnerByKey: Record<string, string> = {};
    const spec = parseExtractTagSpec(rule.targetTag.trim());
    if (!spec) continue;

    if (!spec.attrName) {
      const inner = templateInnerForKey(spec.tagName, rendered);
      if (inner) renderedInnerByKey[spec.tagName] = inner;
    } else {
      for (const key of Object.keys(stageTags)) {
        const inner = templateInnerForKey(key, rendered);
        if (inner) renderedInnerByKey[key] = inner;
      }
    }

    const next = replaceTagInnersInMessage(message, rule.targetTag.trim(), renderedInnerByKey);
    if (next !== message) {
      message = next;
      anyReplaced = true;
    }
  }

  if (!anyReplaced) return;

  await setChatMessages(
    [
      {
        message_id: messageId,
        message,
        data: msg.data ?? {},
      },
    ],
    { refresh: 'affected' },
  );

  ctx.aiText = message;
  onMessageUpdated?.(message);
}
