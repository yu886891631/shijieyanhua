import {
  buildCompositeKey,
  findAllTagInstances,
  findLastTagInstance,
  parseCompositeKey,
  parseExtractTagSpec,
  sortAttrValues,
  type ExtractTagSpec,
} from './tag-extract';
import { tryParseJsonObject } from './strict-variable-response';
import { normalizeReplicaAttrValue } from './replica-attr-identity';

export type RelayTagMap = Map<string, string[]>;

export const REPLICA_ENUM_TAG = 'ReplicaEnum';
export const ENUM_REGISTRY_MARKER = '\u0000';
/** 定向枚举 registry 键前缀：`#replica:<rootId>|tag@attr=value` */
export const REPLICA_ENUM_DIRECTED_PREFIX = '#replica:';
export const REPLICA_ENUM_DIRECTED_SEP = '|';

export type ReplicaEnumRename = {
  from: string;
  to: string;
};

export type ReplicaEnumEntry = {
  specKey: string;
  values: string[];
  /** 已有副本身份改名：from → to；缺省视为 [] */
  renames?: ReplicaEnumRename[];
  /** 原始 task 引用（任务名 / baseName / id），未解析 */
  taskRef?: string;
};

export type ReplicaEnumParseResult = {
  entries: ReplicaEnumEntry[];
};

/** 待应用的改名指令（含 spec / 可选定向 task） */
export type PendingReplicaRename = {
  specKey: string;
  taskRef?: string;
  from: string;
  to: string;
};

export type ResolveReplicaEnumTaskRef = (
  taskRef: string,
) => { rootId: string; specKey: string } | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSpecKey(spec: string): string | null {
  const parsed = parseExtractTagSpec(spec);
  if (!parsed?.attrName) return null;
  return `${parsed.tagName}@${parsed.attrName}`;
}

function normalizeValues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    const text = normalizeReplicaAttrValue(String(v ?? ''));
    if (text) out.push(text);
  }
  return sortAttrValues([...new Set(out)]);
}

function normalizeRenames(renames: unknown): ReplicaEnumRename[] {
  if (!Array.isArray(renames)) return [];
  const byFrom = new Map<string, string>();
  for (const item of renames) {
    if (!isPlainObject(item)) continue;
    const from = normalizeReplicaAttrValue(String(item.from ?? ''));
    const to = normalizeReplicaAttrValue(String(item.to ?? ''));
    if (!from || !to || from === to) continue;
    byFrom.set(from, to);
  }
  return [...byFrom.entries()].map(([from, to]) => ({ from, to }));
}

function entryRenames(entry: ReplicaEnumEntry): ReplicaEnumRename[] {
  return entry.renames ?? [];
}

/** 写入 registry 的属性值：values ∪ renames.to */
export function registryAttrValuesForEntry(entry: ReplicaEnumEntry): string[] {
  const set = new Set<string>(entry.values);
  for (const r of entryRenames(entry)) set.add(r.to);
  return sortAttrValues([...set]);
}

function entryBucketKey(specKey: string, taskRef?: string): string {
  return `${specKey}\0${taskRef ?? ''}`;
}

function mergeRenames(existing: ReplicaEnumRename[], incoming: ReplicaEnumRename[]): ReplicaEnumRename[] {
  const byFrom = new Map<string, string>();
  for (const r of existing) byFrom.set(r.from, r.to);
  for (const r of incoming) byFrom.set(r.from, r.to);
  return [...byFrom.entries()].map(([from, to]) => ({ from, to }));
}

function mergeEnumEntry(target: ReplicaEnumEntry[], entry: ReplicaEnumEntry): void {
  const renames = entryRenames(entry);
  if (!entry.values.length && !renames.length) return;
  const key = entryBucketKey(entry.specKey, entry.taskRef);
  const existing = target.find(e => entryBucketKey(e.specKey, e.taskRef) === key);
  if (existing) {
    existing.values = sortAttrValues([...new Set([...existing.values, ...entry.values])]);
    existing.renames = mergeRenames(entryRenames(existing), renames);
    return;
  }
  target.push({
    specKey: entry.specKey,
    values: [...entry.values],
    renames: [...renames],
    taskRef: entry.taskRef,
  });
}

function parseEnumEntry(obj: Record<string, unknown>): ReplicaEnumEntry | null {
  const specKey = normalizeSpecKey(String(obj.spec ?? ''));
  if (!specKey) return null;
  const values = normalizeValues(obj.values);
  const renames = normalizeRenames(obj.renames);
  if (!values.length && !renames.length) return null;
  const taskRaw = String(obj.task ?? '').trim();
  return {
    specKey,
    values,
    renames,
    taskRef: taskRaw || undefined,
  };
}

export function extractReplicaEnumBlockInners(text: string): string[] {
  const source = String(text ?? '');
  if (!source) return [];
  return findAllTagInstances(source, REPLICA_ENUM_TAG).map(inst => inst.inner.trim()).filter(Boolean);
}

/** 全文最后一个开标签配对的闭合块内文（对齐 inject 裸标签 findLastTagInstance，避免思维链孤儿开标签吞掉正文） */
export function extractLastReplicaEnumBlockInner(text: string): string | null {
  const last = findLastTagInstance(text, REPLICA_ENUM_TAG);
  const inner = last?.inner.trim() ?? '';
  return inner || null;
}

export function parseReplicaEnumJson(inner: string): ReplicaEnumParseResult {
  const result: ReplicaEnumParseResult = { entries: [] };
  const trimmed = String(inner ?? '').trim();
  if (!trimmed) return result;

  let parsed: unknown;
  try {
    parsed = tryParseJsonObject(trimmed);
  } catch {
    return result;
  }
  if (!isPlainObject(parsed)) return result;

  if (Array.isArray(parsed.enums)) {
    for (const entry of parsed.enums) {
      if (!isPlainObject(entry)) continue;
      const item = parseEnumEntry(entry);
      if (!item) continue;
      mergeEnumEntry(result.entries, item);
    }
    return result;
  }

  const single = parseEnumEntry(parsed);
  if (single) mergeEnumEntry(result.entries, single);
  return result;
}

export function parseReplicaEnumFromResponse(text: string): ReplicaEnumParseResult {
  const inner = extractLastReplicaEnumBlockInner(text);
  if (!inner) return { entries: [] };
  return parseReplicaEnumJson(inner);
}

/** 从解析结果抽出待应用改名列表（顺序保留；同 from 后写覆盖已在 merge 完成） */
export function collectReplicaEnumRenames(result: ReplicaEnumParseResult): PendingReplicaRename[] {
  const out: PendingReplicaRename[] = [];
  for (const entry of result.entries) {
    for (const r of entryRenames(entry)) {
      out.push({
        specKey: entry.specKey,
        taskRef: entry.taskRef,
        from: r.from,
        to: r.to,
      });
    }
  }
  return composePendingReplicaRenames(out);
}

function renameBucketKey(specKey: string, taskRef?: string): string {
  return `${specKey.toLowerCase()}\0${taskRef ?? ''}`;
}

/** 对 bucket 内 from→to 边做 Kahn 拓扑排序；环上边丢弃 */
function topologicalSortRenameEdges(edges: Map<string, string>): Array<[string, string]> {
  if (!edges.size) return [];
  const nodes = new Set<string>();
  for (const [from, to] of edges) {
    nodes.add(from);
    nodes.add(to);
  }
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n, 0);
  for (const [, to] of edges) {
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const queue = [...nodes].filter(n => inDegree.get(n) === 0).sort();
  const sorted: Array<[string, string]> = [];
  while (queue.length) {
    const from = queue.shift()!;
    const to = edges.get(from);
    if (to === undefined) continue;
    sorted.push([from, to]);
    const nextDeg = (inDegree.get(to) ?? 1) - 1;
    inDegree.set(to, nextDeg);
    if (nextDeg === 0) {
      queue.push(to);
      queue.sort();
    }
  }
  if (sorted.length < edges.size) {
    console.warn('[工作流助手] ReplicaEnum rename 链存在环，已忽略环上边');
  }
  return sorted;
}

/**
 * 同 spec/task bucket 内对 rename 边拓扑排序（a→b + b→c 保为两条有序边），并检测环。
 */
export function composePendingReplicaRenames(renames: PendingReplicaRename[]): PendingReplicaRename[] {
  if (!renames.length) return [];
  const byBucket = new Map<string, PendingReplicaRename[]>();
  for (const r of renames) {
    const key = renameBucketKey(r.specKey, r.taskRef);
    const list = byBucket.get(key) ?? [];
    list.push(r);
    byBucket.set(key, list);
  }

  const out: PendingReplicaRename[] = [];
  for (const list of byBucket.values()) {
    const sample = list[0]!;
    const edges = new Map<string, string>();
    for (const r of list) {
      edges.set(r.from, r.to);
    }
    for (const [from, to] of topologicalSortRenameEdges(edges)) {
      out.push({
        specKey: sample.specKey,
        taskRef: sample.taskRef,
        from,
        to,
      });
    }
  }
  return out;
}

export function isEnumRegistryMarker(value: string): boolean {
  return String(value ?? '') === ENUM_REGISTRY_MARKER;
}

export function buildDirectedEnumRegistryKey(
  rootId: string,
  tagName: string,
  attrName: string,
  attrValue: string,
): string {
  return `${REPLICA_ENUM_DIRECTED_PREFIX}${rootId}${REPLICA_ENUM_DIRECTED_SEP}${buildCompositeKey(tagName, attrName, attrValue)}`;
}

export function isDirectedEnumRegistryKey(key: string): boolean {
  return String(key ?? '')
    .toLowerCase()
    .startsWith(REPLICA_ENUM_DIRECTED_PREFIX.toLowerCase());
}

/** 从定向键拆出 composite `tag@attr=value`；非定向键返回 null */
export function parseDirectedEnumRegistryKey(
  key: string,
): { rootId: string; compositeKey: string } | null {
  const raw = String(key ?? '');
  const prefix = REPLICA_ENUM_DIRECTED_PREFIX;
  if (!raw.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const rest = raw.slice(prefix.length);
  const sepIdx = rest.indexOf(REPLICA_ENUM_DIRECTED_SEP);
  if (sepIdx <= 0) return null;
  const rootId = rest.slice(0, sepIdx);
  const compositeKey = rest.slice(sepIdx + REPLICA_ENUM_DIRECTED_SEP.length);
  if (!rootId || !compositeKey) return null;
  return { rootId, compositeKey };
}

export function replicaEnumResultToRegistryTags(
  result: ReplicaEnumParseResult,
  resolveTaskRef?: ResolveReplicaEnumTaskRef,
): Record<string, string> {
  const out: Record<string, string> = {};
  // 某 spec 只要出现过带 task 的条目，该 spec 不再写广播键（避免 task 写错时静默吃广播全量）
  const directedIntentSpecs = new Set<string>();
  for (const entry of result.entries) {
    if (entry.taskRef) directedIntentSpecs.add(entry.specKey.toLowerCase());
  }

  for (const entry of result.entries) {
    const parsed = parseExtractTagSpec(entry.specKey);
    if (!parsed?.attrName) continue;
    const specLower = entry.specKey.toLowerCase();
    const attrValues = registryAttrValuesForEntry(entry);
    if (!attrValues.length) continue;

    if (!entry.taskRef) {
      if (directedIntentSpecs.has(specLower)) continue;
      for (const attrValue of attrValues) {
        const key = buildCompositeKey(parsed.tagName, parsed.attrName, attrValue);
        out[key] = ENUM_REGISTRY_MARKER;
      }
      continue;
    }

    if (!resolveTaskRef) {
      console.warn(`[工作流助手] ReplicaEnum 含 task="${entry.taskRef}" 但未提供任务解析器，已忽略`);
      continue;
    }
    const resolved = resolveTaskRef(entry.taskRef);
    if (!resolved) {
      console.warn(`[工作流助手] ReplicaEnum 无法解析 task="${entry.taskRef}"，已忽略`);
      continue;
    }
    if (resolved.specKey.toLowerCase() !== entry.specKey.toLowerCase()) {
      console.warn(
        `[工作流助手] ReplicaEnum task="${entry.taskRef}" 的 spec 为 ${resolved.specKey}，与条目 ${entry.specKey} 不一致，已忽略`,
      );
      continue;
    }
    for (const attrValue of attrValues) {
      const key = buildDirectedEnumRegistryKey(
        resolved.rootId,
        parsed.tagName,
        parsed.attrName,
        attrValue,
      );
      out[key] = ENUM_REGISTRY_MARKER;
    }
  }
  return out;
}

/**
 * 收集某 spec 的枚举值。
 * 传入 rootId 时：若存在该根的定向键则只用定向；否则用广播键（忽略其它根的定向键）。
 * 未传 rootId 时：仅收集广播键。
 */
export function collectEnumRegistryAttrValues(
  relayMap: RelayTagMap,
  spec: ExtractTagSpec,
  rootId?: string,
): string[] {
  if (!spec.attrName) return [];
  const broadcastPrefix = `${spec.tagName}@${spec.attrName}=`.toLowerCase();
  const directedPrefix = rootId
    ? `${REPLICA_ENUM_DIRECTED_PREFIX}${rootId}${REPLICA_ENUM_DIRECTED_SEP}${spec.tagName}@${spec.attrName}=`.toLowerCase()
    : null;

  const directed: string[] = [];
  const broadcast: string[] = [];

  for (const [key, entries] of relayMap.entries()) {
    if (!entries.some(isEnumRegistryMarker)) continue;
    const keyLower = key.toLowerCase();

    if (directedPrefix && keyLower.startsWith(directedPrefix)) {
      const parsedDirected = parseDirectedEnumRegistryKey(key);
      if (!parsedDirected) continue;
      const parsed = parseCompositeKey(parsedDirected.compositeKey);
      if (!parsed) continue;
      const attr = normalizeReplicaAttrValue(parsed.attrValue);
      if (attr) directed.push(attr);
      continue;
    }

    if (isDirectedEnumRegistryKey(key)) continue;

    if (keyLower.startsWith(broadcastPrefix)) {
      const parsed = parseCompositeKey(key);
      if (parsed) {
        const attr = normalizeReplicaAttrValue(parsed.attrValue);
        if (attr) broadcast.push(attr);
      }
    }
  }

  if (rootId && directed.length) {
    return sortAttrValues([...new Set(directed)]);
  }
  return sortAttrValues([...new Set(broadcast)]);
}
