import {
  buildExtractSpecKey,
  buildCompositeKey,
  compositePlaceholderToKey,
  extractInjectTagsFromResponse,
  formatAttrTagBlock,
  formatBareTagBlock,
  formatEmptyAttrTagBlock,
  isCompositeUnderAttrSpec,
  parseCompositeKey,
  parseCompositePlaceholder,
  parseDynamicAttrPlaceholder,
  parseExtractTagSpec,
  parseTotalLastLaunchedPlaceholder,
  parseTotalLaunchedPlaceholder,
  parseTotalPlaceholder,
  sortAttrValues,
  storedTagValueToInner,
  findAllTagInstances,
} from './tag-extract';
import { isEnumRegistryMarker } from './replica-enum-parse';
import {
  findReplicaFamilyRootByRef,
  findReplicaFamilyRootsByAttrSpec,
  getReplicaFamilyEnumSpecKey,
  listLaunchedReplicaSuffixes,
  listLastLaunchedAttrValues,
  listLastLaunchedAttrValuesForSpec,
  parseReplicaLaunchedPlaceholder,
  resolveReplicaLaunchedPlaceholder,
} from './replica-family';
import type { ReplicaStateSnapshot } from './replica-state';
import type { PostProcessTask } from './schema';

export type RelayTagMap = Map<string, string[]>;

export {
  buildAttrGroupKey,
  buildCompositeKey,
  buildExtractSpecKey,
  compositePlaceholderToKey,
  parseCompositeKey,
  parseCompositePlaceholder,
  parseDynamicAttrPlaceholder,
  parseExtractTagSpec,
  parseTotalLastLaunchedPlaceholder,
  parseTotalLaunchedPlaceholder,
  parseTotalPlaceholder,
  sortAttrValues,
  type ExtractTagSpec,
} from './tag-extract';

export function extractLastTagContent(text: string, tagName: string): string | null {
  if (!text || !tagName) return null;
  const lower = text.toLowerCase();
  const open = `<${tagName.toLowerCase()}>`;
  const close = `</${tagName.toLowerCase()}>`;
  const closeIdx = lower.lastIndexOf(close);
  if (closeIdx === -1) return null;
  const openIdx = lower.lastIndexOf(open, closeIdx);
  if (openIdx === -1) return null;
  return text.slice(openIdx + open.length, closeIdx);
}

export function extractAllTagsFromResponse(text: string, tagNames: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tag of tagNames) {
    const content = extractLastTagContent(text, tag);
    if (content != null) result[tag] = content.trim();
  }
  return result;
}

export interface PlotTagExtractionResult {
  tagNames: string[];
  extractedTags: Record<string, string>;
  /** 全部摘取片段，用于 {{task:任务名}} */
  injectedFragments: string[];
  injectOnlyTagNames: string[];
}

/** @deprecated 请使用 isStoredFullBlockForKey(key, value) */
export function isFullBlockTagValue(value: string): boolean {
  const v = String(value ?? '').trimStart();
  return v.startsWith('<') && v.includes('>');
}

export function bareTagNameFromKey(key: string): string {
  const at = key.indexOf('@');
  return at === -1 ? key : key.slice(0, at);
}

/** 判断 value 是否已是 key 对应标签名的完整开标签块（避免裸名 inner 含子标签时误判） */
export function isStoredFullBlockForKey(key: string, value: string): boolean {
  const v = String(value ?? '').trimStart();
  if (!v.startsWith('<') || !v.includes('>')) return false;

  const bare = bareTagNameFromKey(key);
  if (!bare) return false;

  const openPrefix = `<${bare.toLowerCase()}`;
  const vLower = v.toLowerCase();
  if (!vLower.startsWith(openPrefix)) return false;

  const next = vLower[openPrefix.length];
  if (next === undefined) return true;
  if (next === '>' || next === '/' || next === ' ' || next === '\t' || next === '\n' || next === '\r') {
    return true;
  }
  if (/[a-z0-9_-]/i.test(next)) return false;
  return true;
}

export function formatTagValueForInject(key: string, value: string): string {
  const v = String(value ?? '').trim();
  if (!v || isEnumRegistryMarker(v)) return '';
  const inner = isStoredFullBlockForKey(key, v) ? storedTagValueToInner(key, v) : v;
  const parsed = parseCompositeKey(key);
  if (parsed) return formatAttrTagBlock(parsed.tagName, parsed.attrName, parsed.attrValue, inner);
  const bare = bareTagNameFromKey(key);
  return formatBareTagBlock(bare, inner);
}

export function formatTagValuesForInject(key: string, values: string[]): string {
  const inners = values
    .filter(v => !isEnumRegistryMarker(v))
    .map(v => storedTagValueToInner(key, v))
    .filter(Boolean);
  if (!inners.length) return '';
  return formatTagValueForInject(key, inners.join('\n\n'));
}

/** 合并 relay 多段值为可写入内文，排除 ReplicaEnum 注册标记 */
export function joinWritableRelayValues(values: string[]): string {
  const parts = values
    .map(v => String(v ?? '').trim())
    .filter(v => v && !isEnumRegistryMarker(v));
  return parts.join('\n\n');
}

/** 运行日志等 UI：仅展示经 XML 摘取的真实内文，排除 ReplicaEnum 注册标记 */
export function filterXmlExtractedTagsForDisplay(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags).filter(([, v]) => String(v ?? '').trim() && !isEnumRegistryMarker(v)),
  );
}

function extractTagsList(tags: string[]): string[] {
  return tags.map(t => t.trim()).filter(Boolean);
}

export function extractPlotTagsFromResponse(text: string, extractInjectTags: string[] = []): PlotTagExtractionResult {
  const injectTagNames = extractTagsList(extractInjectTags);
  const { extractedTags, injectedFragments, resolvedKeys } = extractInjectTagsFromResponse(text, injectTagNames);

  return {
    tagNames: injectTagNames,
    extractedTags,
    injectedFragments,
    injectOnlyTagNames: [...new Set([...injectTagNames, ...resolvedKeys])],
  };
}

/** @deprecated 请使用 extractPlotTagsFromResponse */
export function extractTagsFromText(text: string, tagNames: string[]): string {
  const parts: string[] = [];
  for (const tag of tagNames) {
    const content = extractLastTagContent(text, tag);
    if (content != null) parts.push(formatBareTagBlock(tag, content));
  }
  return parts.join('\n\n');
}

export const PLOT_TAG_PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

/** 副本族成员任务专用：解析为当前副本的 replicaFamilyAttrValue */
export const REPLICA_ATTR_VALUE_PLACEHOLDER = 'replica:val';

export function isReplicaAttrValuePlaceholder(name: string): boolean {
  return name.trim().toLowerCase() === REPLICA_ATTR_VALUE_PLACEHOLDER;
}

function isPlotTagPlaceholderName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !trimmed.toLowerCase().startsWith('task:');
}

export function getPlotPlaceholderTagNames(text: string): string[] {
  const names: string[] = [];
  const re = new RegExp(PLOT_TAG_PLACEHOLDER_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(text || ''))) !== null) {
    const name = match[1]?.trim();
    if (name && isPlotTagPlaceholderName(name)) names.push(name);
  }
  return [...new Set(names)];
}

function findMapKeyIgnoreCase(tagMap: RelayTagMap, key: string): string | undefined {
  if (tagMap.has(key)) return key;
  const lower = key.toLowerCase();
  for (const candidate of tagMap.keys()) {
    if (candidate.toLowerCase() === lower) return candidate;
  }
  return undefined;
}

export function collectRelayKeysForBareTag(tagMap: RelayTagMap, bareTagName: string): string[] {
  const lower = bareTagName.toLowerCase();
  const keys: string[] = [];
  for (const k of tagMap.keys()) {
    if (k.toLowerCase() === lower) keys.push(k);
  }
  return keys.sort((a, b) => a.localeCompare(b));
}

/** 收集 tag@attr=* 复合 key（不含裸 tag key） */
export function collectCompositeKeysForAttrSpec(
  tagMap: RelayTagMap,
  spec: { tagName: string; attrName: string },
): string[] {
  const prefix = `${spec.tagName}@${spec.attrName}=`.toLowerCase();
  const keyByAttr = new Map<string, string>();
  for (const k of tagMap.keys()) {
    if (!k.toLowerCase().startsWith(prefix)) continue;
    const parsed = parseCompositeKey(k);
    if (parsed) keyByAttr.set(parsed.attrValue, k);
  }
  return sortAttrValues([...keyByAttr.keys()]).map(v => keyByAttr.get(v)!);
}

export function collectAttrValuesFromRelay(
  tagMap: RelayTagMap,
  spec: { tagName: string; attrName: string },
): string[] {
  const values: string[] = [];
  for (const key of collectCompositeKeysForAttrSpec(tagMap, spec)) {
    const parsed = parseCompositeKey(key);
    if (parsed) values.push(parsed.attrValue);
  }
  return sortAttrValues([...new Set(values)]);
}

export function resolveDynamicAttrInjectText(
  tagMap: RelayTagMap,
  placeholderName: string,
): string {
  const dyn = parseDynamicAttrPlaceholder(placeholderName);
  if (!dyn) return '';
  const keys = collectCompositeKeysForAttrSpec(tagMap, dyn);
  const parts: string[] = [];
  for (const key of keys) {
    const values = tagMap.get(key) ?? [];
    const formatted = formatTagValuesForInject(key, values);
    if (formatted) parts.push(formatted);
  }
  return parts.join('\n\n');
}

export function resolvePlaceholderBlocks(tagMap: RelayTagMap, placeholderName: string): string[] {
  const dyn = parseDynamicAttrPlaceholder(placeholderName);
  if (dyn) {
    const blocks: string[] = [];
    for (const key of collectCompositeKeysForAttrSpec(tagMap, dyn)) {
      for (const v of tagMap.get(key) ?? []) {
        if (v) blocks.push(v);
      }
    }
    return blocks;
  }

  const compositeKey = compositePlaceholderToKey(placeholderName);
  if (compositeKey) {
    const mapKey = findMapKeyIgnoreCase(tagMap, compositeKey);
    if (!mapKey) return [];
    return (tagMap.get(mapKey) ?? []).filter(Boolean);
  }

  const keys = collectRelayKeysForBareTag(tagMap, placeholderName);
  const blocks: string[] = [];
  for (const key of keys) {
    const values = tagMap.get(key) ?? [];
    for (const v of values) {
      if (v) blocks.push(v);
    }
  }
  return blocks;
}

export function resolvePlaceholderInjectTextFromMap(tagMap: RelayTagMap, placeholderName: string): string {
  const dynOut = resolveDynamicAttrInjectText(tagMap, placeholderName);
  if (dynOut) return dynOut;
  if (parseDynamicAttrPlaceholder(placeholderName)) return '';

  const compositeKey = compositePlaceholderToKey(placeholderName);
  if (compositeKey) {
    const mapKey = findMapKeyIgnoreCase(tagMap, compositeKey);
    if (!mapKey) return '';
    return formatTagValuesForInject(mapKey, tagMap.get(mapKey) ?? []);
  }

  const keys = collectRelayKeysForBareTag(tagMap, placeholderName);
  const parts: string[] = [];
  for (const key of keys) {
    const values = tagMap.get(key) ?? [];
    const formatted = formatTagValuesForInject(key, values);
    if (formatted) parts.push(formatted);
  }
  return parts.join('\n\n');
}

/** @deprecated 单 map 解析，不含嵌套刷新；请优先使用 resolvePlaceholderForInject */
export function resolvePlaceholderInjectText(tagMap: RelayTagMap, placeholderName: string): string {
  return resolvePlaceholderInjectTextFromMap(tagMap, placeholderName);
}

export type PlotPlaceholderResolveOptions = {
  restrictToInjectOnly?: boolean;
  historyFallback?: 'inject-only' | 'all-tags';
  replicaAttrSpec?: { tagName: string; attrName: string };
  /** 副本族成员当前实例的属性值（如 item@id=1 时为 "1"） */
  replicaAttrValue?: string;
  /** 全部任务列表，供 {{replica:launched:…}} 解析 */
  allTasks?: PostProcessTask[];
  /** 楼层副本状态快照，供 {{total:last-launched:…}} 解析 */
  replicaState?: ReplicaStateSnapshot;
};

/** 裸名酒馆核心宏：脚本阶段保留字面量，交给后续 processTemplateText */
const DEFERRED_BARE_TAVERN_MACROS = new Set(['char', 'user']);

/** 留给酒馆宏 / 酒馆助手宏（formatAsTavernRegexedString / substitudeMacros），脚本 {{}} 阶段不认领、不清空 */
export function isDeferredToTavernMacros(placeholderName: string): boolean {
  const trimmed = placeholderName.trim();
  if (!trimmed) return false;

  // 酒馆原生与助手 MacroLike 普遍以 :: 分隔参数（getvar、get_message_variable、format_*_variable 等）
  if (trimmed.includes('::')) return true;

  // 现代缩写 {{.localVar}} / {{$globalVar}}
  if (/^[.$]/.test(trimmed)) return true;

  // {{char}} / {{user}} 等无 :: 的核心宏，须存活到宏管线
  if (DEFERRED_BARE_TAVERN_MACROS.has(trimmed.toLowerCase())) return true;

  return false;
}

/** 写入模板中未命中成功任务的 {{task:…}} 清空为空白 */
export function clearUnresolvedTaskPlaceholders(text: string): string {
  return String(text || '').replace(/\{\{\s*task:[^}]*\}\}/gi, '');
}

/** 脚本认领的占位符：无数据时也替换为空，不留给酒馆宏 */
export function isScriptOwnedPlaceholder(
  placeholderName: string,
  injectOnlyTags: Set<string>,
  options?: PlotPlaceholderResolveOptions,
): boolean {
  const trimmed = placeholderName.trim();
  if (!trimmed) return false;

  if (isDeferredToTavernMacros(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('replica:')) return true;
  if (lower.startsWith('total:')) return true;

  if (parseDynamicAttrPlaceholder(trimmed)) return true;
  if (compositePlaceholderToKey(trimmed)) return true;

  const replicaSpec = options?.replicaAttrSpec;
  if (replicaSpec && isCompositeUnderAttrSpec(trimmed, replicaSpec)) return true;

  if (isPlaceholderInjectAllowed(trimmed, injectOnlyTags)) return true;

  if (!/^[\w]+$/.test(trimmed)) return true;

  return false;
}

function applyNestedRefresh(
  text: string,
  relayTagMap: RelayTagMap,
  messageVarHistoryMap: RelayTagMap,
  injectOnlyTags: Set<string>,
  historyFallback: 'inject-only' | 'all-tags',
  skipKeys?: Set<string>,
): string {
  if (!text) return text;
  return refreshNestedExtractTagsInContent(text, relayTagMap, messageVarHistoryMap, injectOnlyTags, {
    historyFallback,
    skipKeys,
  });
}

function resolveRootsForTotalLaunched(
  spec: { tagName: string; attrName: string; taskRef?: string },
  allTasks: PostProcessTask[],
): PostProcessTask[] {
  if (spec.taskRef?.trim()) {
    const root = findReplicaFamilyRootByRef(spec.taskRef, allTasks);
    if (!root) return [];
    const expected = buildExtractSpecKey(spec.tagName, spec.attrName).toLowerCase();
    if (getReplicaFamilyEnumSpecKey(root).toLowerCase() !== expected) return [];
    return [root];
  }
  return findReplicaFamilyRootsByAttrSpec(spec, allTasks);
}

function resolveTotalLastLaunchedInject(
  spec: { tagName: string; attrName: string; taskRef?: string },
  messageVarHistoryMap: RelayTagMap,
  options?: PlotPlaceholderResolveOptions,
): string {
  if (!options?.allTasks?.length) return '';
  const suffixes = listLastLaunchedAttrValuesForSpec(
    spec,
    options.allTasks,
    options.replicaState ?? {},
    spec.taskRef,
  );
  const parts: string[] = [];
  for (const suffix of suffixes) {
    const key = buildCompositeKey(spec.tagName, spec.attrName, suffix);
    // 仅读楼层落盘，忽略本轮 relay
    const part = resolvePlaceholderInjectTextFromMap(messageVarHistoryMap, key);
    if (part) parts.push(part);
  }
  return parts.join('\n\n');
}

function expandTotalLaunchedSuffixesFromHistory(
  spec: { tagName: string; attrName: string },
  suffixes: string[],
  messageVarHistoryMap: RelayTagMap,
): string[] {
  const parts: string[] = [];
  for (const suffix of suffixes) {
    const key = buildCompositeKey(spec.tagName, spec.attrName, suffix);
    const part = resolvePlaceholderInjectTextFromMap(messageVarHistoryMap, key);
    if (part) parts.push(part);
  }
  return parts;
}

export function resolvePlaceholderForInject(
  placeholderName: string,
  relayTagMap: RelayTagMap,
  messageVarHistoryMap: RelayTagMap,
  injectOnlyTags: Set<string>,
  options?: PlotPlaceholderResolveOptions,
): string {
  if (isReplicaAttrValuePlaceholder(placeholderName)) {
    return options?.replicaAttrValue ?? '';
  }

  const launchedRef = parseReplicaLaunchedPlaceholder(placeholderName);
  if (launchedRef != null) {
    if (!options?.allTasks?.length) return '';
    return resolveReplicaLaunchedPlaceholder(
      launchedRef,
      options.allTasks,
      relayTagMap,
      options.replicaState ?? {},
    );
  }

  const totalLastLaunchedSpec = parseTotalLastLaunchedPlaceholder(placeholderName);
  if (totalLastLaunchedSpec) {
    return resolveTotalLastLaunchedInject(
      totalLastLaunchedSpec,
      messageVarHistoryMap,
      options,
    );
  }

  const totalLaunchedSpec = parseTotalLaunchedPlaceholder(placeholderName);
  if (totalLaunchedSpec) {
    if (!options?.allTasks?.length) return '';
    const roots = resolveRootsForTotalLaunched(totalLaunchedSpec, options.allTasks);
    const snapshot = options.replicaState ?? {};
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      const current = listLaunchedReplicaSuffixes(root, options.allTasks, relayTagMap);
      if (current.length) {
        for (const suffix of current) {
          if (seen.has(suffix)) continue;
          seen.add(suffix);
          const key = buildCompositeKey(totalLaunchedSpec.tagName, totalLaunchedSpec.attrName, suffix);
          const part = resolvePlaceholderForInject(
            key,
            relayTagMap,
            messageVarHistoryMap,
            injectOnlyTags,
            options,
          );
          if (part) parts.push(part);
        }
      } else {
        // 该根本轮空 → 回退该根 last-launched，正文只读 history
        for (const suffix of listLastLaunchedAttrValues(root, snapshot)) {
          if (seen.has(suffix)) continue;
          seen.add(suffix);
          parts.push(
            ...expandTotalLaunchedSuffixesFromHistory(
              totalLaunchedSpec,
              [suffix],
              messageVarHistoryMap,
            ),
          );
        }
      }
    }
    return parts.join('\n\n');
  }

  const totalSpec = parseTotalPlaceholder(placeholderName);
  if (totalSpec) {
    const dynName = `${totalSpec.tagName}@${totalSpec.attrName}`;
    return resolvePlaceholderForInject(
      dynName,
      relayTagMap,
      messageVarHistoryMap,
      injectOnlyTags,
      options,
    );
  }

  const historyFallback = options?.historyFallback ?? 'inject-only';
  const replicaSpec = options?.replicaAttrSpec;

  if (replicaSpec && isCompositeUnderAttrSpec(placeholderName, replicaSpec)) {
    const parsed = parseCompositePlaceholder(placeholderName);
    const compositeKey = compositePlaceholderToKey(placeholderName);
    const skipKeys = compositeKey ? new Set([compositeKey]) : undefined;
    const histOut = resolvePlaceholderInjectTextFromMap(messageVarHistoryMap, placeholderName);
    if (histOut) {
      return applyNestedRefresh(
        histOut,
        relayTagMap,
        messageVarHistoryMap,
        injectOnlyTags,
        historyFallback,
        skipKeys,
      );
    }
    if (parsed) {
      return formatEmptyAttrTagBlock(parsed.tagName, parsed.attrName, parsed.attrValue);
    }
    return '';
  }

  const relayOut = resolvePlaceholderInjectTextFromMap(relayTagMap, placeholderName);
  if (relayOut) {
    return applyNestedRefresh(relayOut, relayTagMap, messageVarHistoryMap, injectOnlyTags, historyFallback);
  }

  if (shouldUseHistoryFallback(placeholderName, injectOnlyTags, historyFallback)) {
    const histOut = resolvePlaceholderInjectTextFromMap(messageVarHistoryMap, placeholderName);
    if (histOut) {
      return applyNestedRefresh(histOut, relayTagMap, messageVarHistoryMap, injectOnlyTags, historyFallback);
    }
  }
  return '';
}

export function isPlaceholderInjectAllowed(placeholderName: string, injectOnlyTags: Set<string>): boolean {
  const lower = placeholderName.toLowerCase();
  if (lower.startsWith('replica:')) return false;

  const totalLastLaunchedSpec = parseTotalLastLaunchedPlaceholder(placeholderName);
  if (totalLastLaunchedSpec) {
    return isPlaceholderInjectAllowed(
      `${totalLastLaunchedSpec.tagName}@${totalLastLaunchedSpec.attrName}`,
      injectOnlyTags,
    );
  }

  const totalLaunchedSpec = parseTotalLaunchedPlaceholder(placeholderName);
  if (totalLaunchedSpec) {
    return isPlaceholderInjectAllowed(
      `${totalLaunchedSpec.tagName}@${totalLaunchedSpec.attrName}`,
      injectOnlyTags,
    );
  }

  const totalSpec = parseTotalPlaceholder(placeholderName);
  if (totalSpec) {
    return isPlaceholderInjectAllowed(`${totalSpec.tagName}@${totalSpec.attrName}`, injectOnlyTags);
  }

  for (const spec of injectOnlyTags) {
    if (spec.toLowerCase() === lower) return true;
  }

  const compositeKey = compositePlaceholderToKey(placeholderName);
  if (compositeKey) {
    const parsed = parseCompositePlaceholder(placeholderName);
    if (parsed) {
      const specKey = `${parsed.tagName}@${parsed.attrName}`.toLowerCase();
      for (const spec of injectOnlyTags) {
        if (spec.toLowerCase() === specKey) return true;
      }
    }
    return false;
  }

  const dyn = parseDynamicAttrPlaceholder(placeholderName);
  if (dyn) {
    const specKey = buildExtractSpecKey(dyn.tagName, dyn.attrName).toLowerCase();
    for (const spec of injectOnlyTags) {
      if (spec.toLowerCase() === specKey) return true;
    }
    return false;
  }

  for (const spec of injectOnlyTags) {
    const parsed = parseExtractTagSpec(spec);
    if (!parsed) continue;
    if (parsed.tagName.toLowerCase() === lower) return true;
  }
  return false;
}

export function buildPlotTagMapFromText(text: string, requestedTagNames?: string[] | null): RelayTagMap {
  const map: RelayTagMap = new Map();
  const source = String(text || '');
  if (!source.trim()) return map;

  const tagNames = requestedTagNames?.length
    ? [...new Set(requestedTagNames.map(t => String(t).trim()).filter(Boolean))]
    : getPlotPlaceholderTagNames(source);

  for (const tagName of tagNames) {
    const content = extractLastTagContent(source, tagName);
    if (content != null) map.set(tagName, [content.trim()]);
  }
  return map;
}

export function mergeRelayTagMap(target: RelayTagMap, extracted: Record<string, string>): void {
  for (const [tag, content] of Object.entries(extracted)) {
    if (!content) continue;
    const prev = target.get(tag);
    target.set(tag, prev?.length ? [...prev, content] : [content]);
  }
}

/** 同 key 覆盖（供正文标签替换等需保留后者优先的场景） */
export function overwriteRelayTagMap(target: RelayTagMap, extracted: Record<string, string>): void {
  for (const [tag, content] of Object.entries(extracted)) {
    if (!content) continue;
    target.set(tag, [content]);
  }
}

function collectRefreshKeys(
  injectOnlyTags: Set<string>,
  relayMap: RelayTagMap,
  historyMap: RelayTagMap,
): string[] {
  const keys = new Set<string>();
  for (const spec of injectOnlyTags) {
    const parsed = parseExtractTagSpec(spec);
    if (!parsed) continue;
    if (parsed.attrName) {
      const prefix = `${parsed.tagName}@${parsed.attrName}=`.toLowerCase();
      for (const map of [relayMap, historyMap]) {
        for (const k of map.keys()) {
          if (k.toLowerCase().startsWith(prefix)) keys.add(k);
        }
      }
    } else {
      keys.add(parsed.tagName);
    }
  }
  return [...keys].sort((a, b) => {
    const aComp = a.includes('@') && a.includes('=');
    const bComp = b.includes('@') && b.includes('=');
    if (aComp !== bComp) return aComp ? -1 : 1;
    return b.length - a.length;
  });
}

function isSkippedRefreshKey(key: string, skipKeys?: Set<string>): boolean {
  if (!skipKeys?.size) return false;
  const lower = key.toLowerCase();
  for (const sk of skipKeys) {
    if (sk.toLowerCase() === lower) return true;
  }
  return false;
}

function resolveCurrentFormattedBlockForKey(
  key: string,
  relayMap: RelayTagMap,
  historyMap: RelayTagMap,
  injectOnlyTags: Set<string>,
  historyFallback: 'inject-only' | 'all-tags',
): string {
  const parsed = parseCompositeKey(key);
  const placeholderName = parsed
    ? `${parsed.tagName}@${parsed.attrName}=${parsed.attrValue}`
    : key;

  const relayKey = findMapKeyIgnoreCase(relayMap, key);
  if (relayKey) {
    const out = formatTagValuesForInject(relayKey, relayMap.get(relayKey) ?? []);
    if (out) return out;
  }

  if (shouldUseHistoryFallback(placeholderName, injectOnlyTags, historyFallback)) {
    const histKey = findMapKeyIgnoreCase(historyMap, key);
    if (histKey) {
      const out = formatTagValuesForInject(histKey, historyMap.get(histKey) ?? []);
      if (out) return out;
    }
  }
  return '';
}

/** 将 content 内已配置的提取标签实例替换为 relay/history 中的最新内容（多轮直至稳定） */
export function refreshNestedExtractTagsInContent(
  content: string,
  relayMap: RelayTagMap,
  historyMap: RelayTagMap,
  injectOnlyTags: Set<string>,
  options?: { historyFallback?: 'inject-only' | 'all-tags'; skipKeys?: Set<string> },
): string {
  const source = String(content ?? '');
  if (!source.trim() || !injectOnlyTags.size) return source;

  const historyFallback = options?.historyFallback ?? 'inject-only';
  const skipKeys = options?.skipKeys;
  let result = source;

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const keys = collectRefreshKeys(injectOnlyTags, relayMap, historyMap);

    for (const key of keys) {
      if (isSkippedRefreshKey(key, skipKeys)) continue;
      const parsed = parseCompositeKey(key);
      const tagName = parsed ? parsed.tagName : key;
      const replacement = resolveCurrentFormattedBlockForKey(
        key,
        relayMap,
        historyMap,
        injectOnlyTags,
        historyFallback,
      );
      if (!replacement) continue;

      const instances = findAllTagInstances(result, tagName);
      for (const inst of instances) {
        if (parsed) {
          const attrVal = inst.attrs[parsed.attrName.toLowerCase()];
          if (attrVal !== parsed.attrValue) continue;
        }
        if (inst.fullBlock === replacement) continue;
        while (result.includes(inst.fullBlock)) {
          result = result.replace(inst.fullBlock, replacement);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return result;
}

export function getPlotTagMapValue(tagMap: RelayTagMap, tagName: string): { found: boolean; value: string[] } {
  const compositeKey = compositePlaceholderToKey(tagName);
  if (compositeKey) {
    const mapKey = findMapKeyIgnoreCase(tagMap, compositeKey);
    if (mapKey) return { found: true, value: tagMap.get(mapKey)! };
    return { found: false, value: [] };
  }

  if (tagMap.has(tagName)) {
    return { found: true, value: tagMap.get(tagName)! };
  }
  const lowered = tagName.toLowerCase();
  for (const [candidate, value] of tagMap.entries()) {
    if (candidate.toLowerCase() === lowered) {
      return { found: true, value };
    }
  }
  return { found: false, value: [] };
}

/** @deprecated 请使用 replacePlotTagPlaceholdersWithHistory */
export function replacePlotTagPlaceholders(
  text: string,
  relayTagMap: RelayTagMap,
  historyTagMap: RelayTagMap,
): string {
  return replacePlotTagPlaceholdersWithHistory(text, relayTagMap, historyTagMap, new Set());
}

function shouldUseHistoryFallback(
  tagName: string,
  injectOnlyTags: Set<string>,
  historyFallback: 'inject-only' | 'all-tags',
): boolean {
  return historyFallback === 'all-tags' || isPlaceholderInjectAllowed(tagName, injectOnlyTags);
}

export function replacePlotTagPlaceholdersWithHistory(
  text: string,
  relayTagMap: RelayTagMap,
  messageVarHistoryMap: RelayTagMap,
  injectOnlyTags: Set<string>,
  options?: PlotPlaceholderResolveOptions,
): string {
  const re = new RegExp(PLOT_TAG_PLACEHOLDER_RE.source, 'g');

  return String(text || '').replace(re, (placeholder, rawName: string) => {
    const tagName = rawName.trim();
    if (!tagName || !isPlotTagPlaceholderName(tagName)) return placeholder;

    if (options?.restrictToInjectOnly && !isPlaceholderInjectAllowed(tagName, injectOnlyTags)) {
      return '';
    }

    const out = resolvePlaceholderForInject(
      tagName,
      relayTagMap,
      messageVarHistoryMap,
      injectOnlyTags,
      options,
    );
    if (out) return out;
    // 无内容：仅延迟宏保留字面量，其余清空（不再残留 {{xxx}}）
    if (isDeferredToTavernMacros(tagName)) return placeholder;
    return '';
  });
}

export function isPromptGroupEnabled(group: { enabled?: boolean }): boolean {
  return group.enabled !== false;
}

export function buildTaskWorldbookTriggerText(
  promptGroups: { content: string; enabled?: boolean }[],
  relayTagMap: RelayTagMap,
  messageVarHistoryMap: RelayTagMap,
  injectOnlyTags: Set<string>,
  options?: PlotPlaceholderResolveOptions,
): string {
  const blocks: string[] = [];
  for (const group of promptGroups) {
    if (!isPromptGroupEnabled(group)) continue;
    const expanded = replacePlotTagPlaceholdersWithHistory(
      group.content,
      relayTagMap,
      messageVarHistoryMap,
      injectOnlyTags,
      options,
    );
    if (expanded.trim()) blocks.push(expanded);
  }
  return blocks.join('\n\n');
}

export function expandWritableKeysFromPlaceholder(
  placeholderName: string,
  availableKeys: Iterable<string>,
): string[] {
  const totalLastLaunchedSpec = parseTotalLastLaunchedPlaceholder(placeholderName);
  if (totalLastLaunchedSpec) {
    return expandWritableKeysFromPlaceholder(
      `${totalLastLaunchedSpec.tagName}@${totalLastLaunchedSpec.attrName}`,
      availableKeys,
    );
  }

  const totalLaunchedSpec = parseTotalLaunchedPlaceholder(placeholderName);
  if (totalLaunchedSpec) {
    return expandWritableKeysFromPlaceholder(
      `${totalLaunchedSpec.tagName}@${totalLaunchedSpec.attrName}`,
      availableKeys,
    );
  }

  const totalSpec = parseTotalPlaceholder(placeholderName);
  if (totalSpec) {
    return expandWritableKeysFromPlaceholder(
      `${totalSpec.tagName}@${totalSpec.attrName}`,
      availableKeys,
    );
  }

  const dyn = parseDynamicAttrPlaceholder(placeholderName);
  if (dyn) {
    return collectCompositeKeysForAttrSpec(
      new Map([...availableKeys].map(k => [k, []])),
      dyn,
    );
  }

  const compositeKey = compositePlaceholderToKey(placeholderName);
  if (compositeKey) {
    const keys = [...availableKeys];
    const found = keys.find(k => k.toLowerCase() === compositeKey.toLowerCase());
    return found ? [found] : [];
  }
  return collectRelayKeysForBareTag(new Map([...availableKeys].map(k => [k, []])), placeholderName);
}

export function replacePlaceholdersInText(text: string, vars: Record<string, string>): string {
  let result = text;
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const value = vars[key] ?? '';
    result = result.split(key).join(value);
  }
  return result;
}

export const PLACEHOLDER_LEGEND: { code: string; desc: string }[] = [
  {
    code: '$1',
    desc: '剧情世界书绿灯扫描，替换为 <worldbook_context> 块（仅条目正文，不含世界书条目名称；不含工作流助手托管条目、纪要记忆条目与 shujuku「主角信息」CustomExport）；触发扫描基底之一 = 最近 N 条 AI 楼，经与 $7 相同的「提取规则 / 排除规则」处理 + 提示词内已展开的 {{标签名}} +（提示词含 $8 时）过滤后的 $8；N 同 contextTurnCount。遵守条目「防止被递归 / 禁止递归激活他人」与 delay_until：世界书正文只作递归源，不并入第 0 层聊天扫描。可按任务配置 $1 世界书',
  },
  {
    code: '$2',
    desc: '工作流助手托管世界书条目（WorkflowHelper-*）关键词扫描，替换为 <worldbook_extra> 块（仅条目正文，不含世界书条目名称）；扫描基底同 $1。恒定条目始终触发（delay_until 到期后），绿灯按关键字命中，并遵守条目两套防递归',
  },
  { code: '$5', desc: '纪要索引（世界书条目或数据库表快照；支持酒馆宏/EJS）' },
  {
    code: '$6',
    desc: '从世界书读取 shujuku CustomExport-纪要-N（兼认遗留总结条目）中带 AM 编码的行条目，取最近 N 条；若存在 纪要-包裹-上/下 则一并附上（不计 N）。N 在「世界书与上下文」→「$6 记忆回溯」配置，全局非按任务',
  },
  { code: '$7', desc: '最近 N 条 AI 楼层上下文（提取/排除规则同「$7 默认上下文」）；在「世界书与上下文」开启「按任务配置 $7 上下文」后可逐任务自定义 N 与规则，否则全部沿用默认' },
  {
    code: '$8',
    desc: '上一楼用户输入。① 优先从标签名含「输入」或 input 的 XML 标签取最后一次内文；② 若无，则删除从首个「以上是」+（用户的本轮输入 | Participant的本轮输入 | <用户本轮输入> | <本轮用户输入>）行起至文末的全部内容，保留该行之前的文本为正文（「以下是…」不匹配）；③ 剔除 (⚠️:…) 预设警告块',
  },
  {
    code: '$U',
    desc: '用户占位符：<{{user}}初始设定> 内为酒馆 persona_description；<{{user}}最新数据> 内为 shujuku CustomExport「主角信息」世界书条目 content 拼接（支持酒馆宏/EJS）',
  },
  { code: '$C', desc: '当前角色 description（支持酒馆宏/EJS）' },
  {
    code: '{{标签名}}',
    desc: '同轮 relay 优先；relay 缺省时从 post_process_tags 回退。裸名 {{item}} 仅展开 key=item；{{total:item@id}} 展开全部 item@id=*；{{item@id=1}} 精确引用。副本族仅借 <ReplicaEnum> 注册的 relay key 决定副本数量（无内文），占位符内容读楼层变量。',
  },
  {
    code: '{{标签@属性}}',
    desc: '副本族识别占位符（无 = 值，如 {{item@id}}）：标识副本族原本的任务规格；生成副本时自动替换为 {{标签@属性=值}} 精确形式（如 {{item@id=1}}），在各副本中展开对应单实例。',
  },
  {
    code: '{{total:标签@属性}}',
    desc: '在注入模板或提示词中批量展开全部该属性规格的复合实例，例如 {{total:item@id}} 展开全部 item@id=*。亦注册为酒馆助手宏（读楼层 post_process_tags）。',
  },
  {
    code: '{{total:launched:标签@属性}}',
    desc: '覆盖该 spec 下全部副本族任务：优先展开本轮可运行副本正文（manual=replicaFamilyLaunched，auto=relay <ReplicaEnum>）；空则回退 last-launched。可写 {{total:launched:标签@属性:任务名}} 收窄到指定副本族。亦注册为酒馆助手宏。',
  },
  {
    code: '{{total:last-launched:标签@属性}}',
    desc: '覆盖该 spec 下全部副本族的楼层上次启动正文。可写 {{total:last-launched:标签@属性:任务名}} 收窄。manual 用 launchedAttrValues，auto 用 lastEnumAttrValues。脚本与酒馆助手宏均可使用。',
  },
  { code: '{{task:任务名}}', desc: 'AI楼层文末注入、用户输入文末注入与聊天正文标签替换模板中的任务结果占位' },
  {
    code: '{{replica:val}}',
    desc: '副本族成员任务专用。解析为当前副本实例的属性值（replicaFamilyAttrValue）；例如 replicaFamilySpec 为 item@id、副本对应 item@id=1 时解析为 1。根模板与普通任务中解析为空，不回退 relay/history。',
  },
  {
    code: '{{replica:launched:任务名}}',
    desc: '本轮可运行副本后缀名列表（顿号连接）；本轮为空则回退楼层 last-launched 名单。支持任务名或 Id。亦注册为酒馆助手宏。',
  },
  {
    code: '{{char}} 等',
    desc: '脚本 {{}} 阶段：解析无内容的占位符清空为空白；仅延迟宏（:: / . / $ 前缀，以及 char、user）保留字面量，再经 formatAsTavernRegexedString（酒馆正则 + ST 宏 + 全部 MacroLike）与 EJS 处理。任务提示词顺序：$ 变量 → 脚本 {{}} → 宏/EJS',
  },
  {
    code: 'post_process_tags',
    desc: '【非占位符】消息楼层标签变量；复合 key 如 post_process_tags.item@id=1。item@id 配置下缺少 id 的开标签忽略，不摘取',
  },
];
