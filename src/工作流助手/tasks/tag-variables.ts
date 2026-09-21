import { processTemplateText } from './template-process';
import type { ScriptSettings } from './schema';
import {
  clearUnresolvedTaskPlaceholders,
  expandWritableKeysFromPlaceholder,
  formatTagValueForInject,
  getPlotPlaceholderTagNames,
  joinWritableRelayValues,
  mergeRelayTagMap,
  replacePlotTagPlaceholdersWithHistory,
  type RelayTagMap,
} from './utils';
import { parseExtractTagSpec } from './tag-extract';
import { isDynamicAttrPlaceholder } from './tag-variables-nested';
import {
  applyTagsToRawContainer,
  buildDynamicAttrWritePlan,
  flattenTagContainerToRelayKeys,
  mergeNestedGroupIntoRawContainer,
  mergeRawTagContainers,
  normalizeTagContainerRaw,
  removeTagKeyFromRawContainer,
  type TagContainerRaw,
} from './tag-variables-nested';
import { isAccessibleMessageFloor, normalizeMessageFloorId } from './message-floor';

export const TAG_DATA_ROOT_KEY = 'post_process_tags';

const LEGACY_TAG_VAR_PREFIX = 'pp_tag__';

function readTagContainerRaw(variables: Record<string, unknown>): TagContainerRaw {
  const raw = variables[TAG_DATA_ROOT_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as TagContainerRaw) };
}

export function readTagContainer(variables: Record<string, unknown>): Record<string, string> {
  return flattenTagContainerToRelayKeys(readTagContainerRaw(variables));
}

function readLegacyTagContainer(variables: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (!key.startsWith(LEGACY_TAG_VAR_PREFIX)) continue;
    if (value === undefined || value === null) continue;
    const tag = key.slice(LEGACY_TAG_VAR_PREFIX.length);
    const text = String(value).trim();
    if (tag && text) out[tag] = text;
  }
  return out;
}

function tagContainerToRelayMap(container: Record<string, string>): RelayTagMap {
  const map: RelayTagMap = new Map();
  for (const [tag, text] of Object.entries(container)) {
    map.set(tag, [text]);
  }
  return map;
}

/** 读取指定楼层的 post_process_tags 整包（含旧 pp_tag__ 兼容） */
export function buildFloorTagMap(floorId: number): RelayTagMap {
  if (!isAccessibleMessageFloor(floorId)) return new Map();
  try {
    const variables = getVariables({ type: 'message', message_id: floorId }) ?? {};
    const container = readTagContainer(variables);
    if (Object.keys(container).length) return tagContainerToRelayMap(container);
    return tagContainerToRelayMap(readLegacyTagContainer(variables));
  } catch {
    return new Map();
  }
}

/** 正常后处理：读当前楼 post_process_tags（应为继承后的快照） */
export function buildCurrentFloorTagMap(messageId: number): RelayTagMap {
  return buildFloorTagMap(messageId);
}

/** 重跑模式：仅读取上一楼 post_process_tags */
export function buildPreviousFloorTagMap(messageId: number): RelayTagMap {
  return buildFloorTagMap(messageId - 1);
}

function cloneTagContainerRaw(raw: TagContainerRaw): TagContainerRaw {
  const next: TagContainerRaw = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = { ...(value as Record<string, string>) };
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** 重跑前将当前楼 post_process_tags 整包替换为上一楼快照 */
export function restorePostProcessTagsFromPreviousFloor(messageId: number): void {
  if (!isAccessibleMessageFloor(messageId) || messageId <= 0) return;

  let previous: Record<string, unknown>;
  try {
    previous = getVariables({ type: 'message', message_id: messageId - 1 }) ?? {};
  } catch {
    return;
  }

  const prevRaw = readTagContainerRaw(previous);
  for (const [tag, text] of Object.entries(readLegacyTagContainer(previous))) {
    if (tag && text) prevRaw[tag] = text;
  }

  const snapshot = cloneTagContainerRaw(prevRaw);

  updateVariablesWith(
    variables => {
      if (Object.keys(snapshot).length) {
        variables[TAG_DATA_ROOT_KEY] = cloneTagContainerRaw(snapshot);
      } else {
        delete variables[TAG_DATA_ROOT_KEY];
      }
      return variables;
    },
    { type: 'message', message_id: messageId },
  );
}

export function buildInjectOnlyTagsUnion(tasks: ScriptSettings['tasks']): Set<string> {
  const set = new Set<string>();
  for (const task of tasks) {
    if (!task.enabled) continue;
    for (const tag of task.extractInjectTags ?? []) {
      const t = tag.trim();
      if (!t) continue;
      set.add(t);
      const spec = parseExtractTagSpec(t);
      if (spec && !spec.attrName) {
        set.add(spec.tagName);
      }
    }
  }
  return set;
}

function migrateLegacyTagsOnFloor(variables: Record<string, unknown>): boolean {
  const legacy = readLegacyTagContainer(variables);
  if (!Object.keys(legacy).length) return false;

  let raw = readTagContainerRaw(variables);
  raw = applyTagsToRawContainer(raw, legacy);
  variables[TAG_DATA_ROOT_KEY] = raw;
  for (const key of Object.keys(variables)) {
    if (key.startsWith(LEGACY_TAG_VAR_PREFIX)) delete variables[key];
  }
  return true;
}

export function inheritTagVariables(message_id: number): void {
  if (!isAccessibleMessageFloor(message_id) || message_id <= 0) return;

  let previous: Record<string, unknown>;
  try {
    previous = getVariables({ type: 'message', message_id: message_id - 1 }) ?? {};
  } catch {
    return;
  }

  const prevRaw = readTagContainerRaw(previous);
  for (const [tag, text] of Object.entries(readLegacyTagContainer(previous))) {
    if (tag && text) prevRaw[tag] = text;
  }
  if (!Object.keys(prevRaw).length) return;

  updateVariablesWith(
    variables => {
      migrateLegacyTagsOnFloor(variables);
      let raw = readTagContainerRaw(variables);
      raw = mergeRawTagContainers(prevRaw, raw);
      raw = normalizeTagContainerRaw(raw);
      variables[TAG_DATA_ROOT_KEY] = raw;
      return variables;
    },
    { type: 'message', message_id },
  );
}

export function backfillChatTagVariables(): void {
  if (getChatMessages(-1).length === 0) return;
  const last = getLastMessageId();
  for (let message_id = 0; message_id < last; message_id++) {
    if (!isAccessibleMessageFloor(message_id)) continue;
    let variables: Record<string, unknown>;
    try {
      variables = getVariables({ type: 'message', message_id }) ?? {};
    } catch {
      continue;
    }

    const hasLegacy = Object.keys(variables).some(k => k.startsWith(LEGACY_TAG_VAR_PREFIX));
    const hasContainer = Object.keys(readTagContainer(variables)).length > 0;

    if (hasLegacy) {
      updateVariablesWith(
        vars => {
          migrateLegacyTagsOnFloor(vars);
          return vars;
        },
        { type: 'message', message_id },
      );
      continue;
    }

    if (!hasContainer && message_id > 0) {
      inheritTagVariables(message_id);
    }
  }
}

type TagAggregateInput = {
  success: boolean;
  skipped?: boolean;
  extractedTags: Record<string, string>;
  extractedBlock: string;
  taskId: string;
  taskName: string;
};

function aggregateTaskTagResults(results: TagAggregateInput[]): RelayTagMap {
  const aggregated: RelayTagMap = new Map();
  for (const r of results) {
    if (!r.success || r.skipped) continue;
    mergeRelayTagMap(aggregated, r.extractedTags);
  }
  return aggregated;
}

function getTagNamesFromVariableTemplate(template: string, successful: TagAggregateInput[]): Set<string> {
  let text = template.trim();
  for (const r of successful) {
    text = text.split(`{{task:${r.taskName}}}`).join(r.extractedBlock);
    text = text.split(`{{task:${r.taskId}}}`).join(r.extractedBlock);
  }
  return new Set(getPlotPlaceholderTagNames(text));
}

export type PostProcessWritableTaskResult = {
  success?: boolean;
  skipped?: boolean;
  taskId: string;
  taskName: string;
  extractedTags?: Record<string, string>;
};

export function buildExtractedBlockFromTags(tags: Record<string, string> | undefined): string {
  if (!tags || typeof tags !== 'object') return '';
  return Object.entries(tags)
    .filter(([, value]) => String(value ?? '').trim())
    .map(([tag, content]) => formatTagValueForInject(tag, content))
    .join('\n\n');
}

function toTagAggregateInput(r: PostProcessWritableTaskResult): TagAggregateInput {
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

export function getPostProcessWritableTagNames(
  settings: ScriptSettings,
  taskResults: PostProcessWritableTaskResult[],
): Set<string> {
  const template = settings.tagVariableInjectTemplate?.trim();
  if (!template) return new Set();

  const successful = taskResults.filter(r => r.success && !r.skipped).map(toTagAggregateInput);
  const placeholderNames = getTagNamesFromVariableTemplate(template, successful);
  const aggregated = aggregateTaskTagResults(successful);
  const availableKeys = [...aggregated.keys()];

  const writable = new Set<string>();
  for (const name of placeholderNames) {
    for (const key of expandWritableKeysFromPlaceholder(name, availableKeys)) {
      writable.add(key);
    }
  }
  return writable;
}

export function pickTagsForPostProcessWrite(
  tags: Record<string, string>,
  writable: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tagName of writable) {
    if (!(tagName in tags)) continue;
    out[tagName] = tags[tagName] ?? '';
  }
  return out;
}

export function registerTagVariableInheritance(): EventOnReturn {
  const onMessage = (message_id: number) => {
    const normalized = normalizeMessageFloorId(message_id);
    if (normalized == null) return;
    errorCatched(() => inheritTagVariables(normalized))();
  };

  const offReceived = eventOn(tavern_events.MESSAGE_RECEIVED, onMessage);
  const offSent = eventOn(tavern_events.MESSAGE_SENT, onMessage);
  const offChat = eventOn(tavern_events.CHAT_CHANGED, () => {
    errorCatched(backfillChatTagVariables)();
  });

  errorCatched(backfillChatTagVariables)();

  return {
    stop: () => {
      offReceived.stop();
      offSent.stop();
      offChat.stop();
    },
  };
}

export function writeFloorTagValues(messageId: number, tags: Record<string, string>): void {
  if (!isAccessibleMessageFloor(messageId)) {
    throw new Error(`消息楼层 ${messageId} 不可访问`);
  }

  updateVariablesWith(
    variables => {
      migrateLegacyTagsOnFloor(variables);
      let raw = readTagContainerRaw(variables);
      raw = applyTagsToRawContainer(raw, tags);
      variables[TAG_DATA_ROOT_KEY] = raw;
      return variables;
    },
    { type: 'message', message_id: messageId },
  );
}

export function removeFloorTagKey(messageId: number, tagKey: string): void {
  if (!isAccessibleMessageFloor(messageId)) return;

  updateVariablesWith(
    variables => {
      migrateLegacyTagsOnFloor(variables);
      let raw = readTagContainerRaw(variables);
      raw = removeTagKeyFromRawContainer(raw, tagKey);
      raw = normalizeTagContainerRaw(raw);
      if (Object.keys(raw).length) variables[TAG_DATA_ROOT_KEY] = raw;
      else delete variables[TAG_DATA_ROOT_KEY];
      return variables;
    },
    { type: 'message', message_id: messageId },
  );
}

export async function applyTagVariableInjectTemplate(
  settings: ScriptSettings,
  results: TagAggregateInput[],
  messageId: number,
): Promise<void> {
  const template = settings.tagVariableInjectTemplate?.trim();
  if (!template) return;

  const successful = results.filter(r => r.success && !r.skipped);
  if (!successful.length) return;

  const aggregated = aggregateTaskTagResults(successful);
  const tagNames = getTagNamesFromVariableTemplate(template, successful);
  if (!tagNames.size) return;

  const flatAggregated: Record<string, string> = {};
  for (const [key, values] of aggregated.entries()) {
    const inner = joinWritableRelayValues(values);
    if (inner) flatAggregated[key] = inner;
  }

  const flatToWrite: Record<string, string> = {};
  const dynamicPlans: ReturnType<typeof buildDynamicAttrWritePlan>[] = [];

  for (const placeholderName of tagNames) {
    if (isDynamicAttrPlaceholder(placeholderName)) {
      const plan = buildDynamicAttrWritePlan(placeholderName, flatAggregated);
      if (!plan) continue;
      dynamicPlans.push(plan);
      continue;
    }
    for (const key of expandWritableKeysFromPlaceholder(placeholderName, aggregated.keys())) {
      const mapKey = [...aggregated.keys()].find(k => k.toLowerCase() === key.toLowerCase());
      if (!mapKey) continue;
      const inner = joinWritableRelayValues(aggregated.get(mapKey) ?? []);
      if (!inner) continue;
      flatToWrite[mapKey] = inner;
    }
  }

  if (!dynamicPlans.length && !Object.keys(flatToWrite).length) return;

  updateVariablesWith(
    variables => {
      migrateLegacyTagsOnFloor(variables);
      let raw = readTagContainerRaw(variables);
      for (const plan of dynamicPlans) {
        raw = mergeNestedGroupIntoRawContainer(raw, plan);
      }
      for (const [key, value] of Object.entries(flatToWrite)) {
        raw[key] = value;
      }
      raw = normalizeTagContainerRaw(raw);
      variables[TAG_DATA_ROOT_KEY] = raw;
      return variables;
    },
    { type: 'message', message_id: messageId },
  );
}

export async function mergeAiFloorInjectBlock(
  settings: ScriptSettings,
  results: TagAggregateInput[],
  messageId: number,
): Promise<string> {
  const successful = results.filter(r => r.success && !r.skipped);
  const aggregated = aggregateTaskTagResults(successful);
  const historyMap = buildCurrentFloorTagMap(messageId);

  const template = settings.finalInjectTemplate?.trim();
  if (!template) return '';

  let out = template;
  for (const r of successful) {
    out = out.split(`{{task:${r.taskName}}}`).join(r.extractedBlock);
    out = out.split(`{{task:${r.taskId}}}`).join(r.extractedBlock);
  }
  out = clearUnresolvedTaskPlaceholders(out);
  out = replacePlotTagPlaceholdersWithHistory(out, aggregated, historyMap, new Set(), {
    historyFallback: 'all-tags',
    allTasks: settings.tasks,
    // 惰性加载，避免单测经 tag-variables → reconcile → settings → Pinia
    replicaState: (
      require('./replica-reconcile') as typeof import('./replica-reconcile')
    ).resolveReplicaStateForMessage(messageId),
  });
  return processTemplateText(out, messageId, { role: 'system' });
}
