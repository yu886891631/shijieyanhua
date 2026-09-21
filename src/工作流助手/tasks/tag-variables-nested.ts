import {
  buildAttrGroupKey,
  buildCompositeKey,
  parseCompositeKey,
  parseDynamicAttrPlaceholder,
  storedTagValueToInner,
} from './tag-extract';
import { isEnumRegistryMarker } from './replica-enum-parse';

export type TagContainerRaw = Record<string, unknown>;

/** 从楼层变量 raw 容器扁平化为 relay flat keys */
export function flattenTagContainerToRelayKeys(raw: TagContainerRaw): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const groupKey = key;
      const parts = groupKey.split('_');
      if (parts.length >= 2) {
        const attrName = parts.pop()!;
        const tagName = parts.join('_');
        for (const [attrValue, block] of Object.entries(value as Record<string, unknown>)) {
          if (block === undefined || block === null) continue;
          const text = String(block).trim();
          if (!text) continue;
          out[buildCompositeKey(tagName, attrName, attrValue)] = text;
        }
        continue;
      }
    }
    const text = String(value).trim();
    if (text) out[key] = text;
  }
  return out;
}

/** 读取楼层变量容器：flat string + nested group 均支持 */
export function readTagContainerExtended(variables: Record<string, unknown>): Record<string, string> {
  const raw = variables.post_process_tags;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return flattenTagContainerToRelayKeys(raw as TagContainerRaw);
}

export type DynamicAttrWritePlan = {
  groupKey: string;
  spec: { tagName: string; attrName: string };
  entries: Record<string, string>;
};

export function buildDynamicAttrWritePlan(
  placeholderName: string,
  aggregatedFlat: Record<string, string>,
): DynamicAttrWritePlan | null {
  const dyn = parseDynamicAttrPlaceholder(placeholderName);
  if (!dyn) return null;

  const groupKey = buildAttrGroupKey(dyn.tagName, dyn.attrName);
  const prefix = `${dyn.tagName}@${dyn.attrName}=`.toLowerCase();
  const entries: Record<string, string> = {};

  for (const [key, value] of Object.entries(aggregatedFlat)) {
    if (!key.toLowerCase().startsWith(prefix)) continue;
    const parsed = parseCompositeKey(key);
    if (!parsed) continue;
    const text = String(value ?? '').trim();
    if (!text || isEnumRegistryMarker(text)) continue;
    entries[parsed.attrValue] = text;
  }

  if (!Object.keys(entries).length) return null;

  return {
    groupKey,
    spec: dyn,
    entries,
  };
}

/** 将 nested group 合并进 raw post_process_tags 对象（旧 key 保留，同 key 覆盖，新 key 新增） */
export function mergeNestedGroupIntoRawContainer(
  raw: TagContainerRaw,
  plan: DynamicAttrWritePlan,
): TagContainerRaw {
  const next: TagContainerRaw = { ...raw };
  const existing = next[plan.groupKey];
  const merged: Record<string, string> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, string>) }
      : {};

  for (const [attrValue, block] of Object.entries(plan.entries)) {
    const compositeKey = buildCompositeKey(plan.spec.tagName, plan.spec.attrName, attrValue);
    merged[attrValue] = storedTagValueToInner(compositeKey, block);
  }

  next[plan.groupKey] = merged;
  return stripFlatCompositeKeysForPlan(next, plan);
}

/** 移除与 nested group 重复的扁平 composite keys（如 item@id=1） */
export function stripFlatCompositeKeysForPlan(
  raw: TagContainerRaw,
  plan: DynamicAttrWritePlan,
): TagContainerRaw {
  const next = { ...raw };
  const prefix = `${plan.spec.tagName}@${plan.spec.attrName}=`.toLowerCase();
  for (const key of Object.keys(next)) {
    if (key.toLowerCase().startsWith(prefix)) delete next[key];
  }
  return next;
}

/** 将 raw 中所有 nested group 对应的扁平 composite keys 一并移除，并将完整块规范为内文 */
export function normalizeTagContainerRaw(raw: TagContainerRaw): TagContainerRaw {
  let next: TagContainerRaw = { ...raw };
  for (const [key, value] of Object.entries({ ...next })) {
    if (typeof value === 'string') {
      const inner = storedTagValueToInner(key, value);
      if (inner !== value) next[key] = inner;
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const parts = key.split('_');
    if (parts.length < 2) continue;
    const attrName = parts.pop()!;
    const tagName = parts.join('_');
    const normalized: Record<string, string> = {};
    for (const [attrValue, block] of Object.entries(value as Record<string, string>)) {
      const compositeKey = buildCompositeKey(tagName, attrName, attrValue);
      normalized[attrValue] = storedTagValueToInner(compositeKey, String(block ?? ''));
    }
    next[key] = normalized;
    next = stripFlatCompositeKeysForPlan(next, {
      groupKey: key,
      spec: { tagName, attrName },
      entries: normalized,
    });
  }
  return next;
}

export function groupCompositeTagsForNestedWrite(tags: Record<string, string>): {
  nestedPlans: DynamicAttrWritePlan[];
  bare: Record<string, string>;
} {
  const flatBySpec: Record<string, Record<string, string>> = {};
  const bare: Record<string, string> = {};

  for (const [key, value] of Object.entries(tags)) {
    const parsed = parseCompositeKey(key);
    if (!parsed) {
      bare[key] = value;
      continue;
    }
    const spec = `${parsed.tagName}@${parsed.attrName}`;
    if (!flatBySpec[spec]) flatBySpec[spec] = {};
    flatBySpec[spec][key] = value;
  }

  const nestedPlans: DynamicAttrWritePlan[] = [];
  for (const [spec, flat] of Object.entries(flatBySpec)) {
    const plan = buildDynamicAttrWritePlan(spec, flat);
    if (plan) nestedPlans.push(plan);
    else Object.assign(bare, flat);
  }

  return { nestedPlans, bare };
}

export function mergeRawTagContainers(base: TagContainerRaw, override: TagContainerRaw): TagContainerRaw {
  const next: TagContainerRaw = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const existing = next[key];
      const merged =
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? { ...(existing as Record<string, string>), ...(value as Record<string, string>) }
          : { ...(value as Record<string, string>) };
      next[key] = merged;
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function applyTagsToRawContainer(raw: TagContainerRaw, tags: Record<string, string>): TagContainerRaw {
  const { nestedPlans, bare } = groupCompositeTagsForNestedWrite(tags);
  let next = { ...raw };
  for (const plan of nestedPlans) {
    next = mergeNestedGroupIntoRawContainer(next, plan);
  }
  for (const [key, value] of Object.entries(bare)) {
    const text = String(value ?? '').trim();
    if (text) next[key] = text;
    else delete next[key];
  }
  return normalizeTagContainerRaw(next);
}

export function removeTagKeyFromRawContainer(raw: TagContainerRaw, tagKey: string): TagContainerRaw {
  const parsed = parseCompositeKey(tagKey);
  if (!parsed) {
    const next = { ...raw };
    delete next[tagKey];
    return next;
  }

  const groupKey = buildAttrGroupKey(parsed.tagName, parsed.attrName);
  const next = { ...raw };
  const existing = next[groupKey];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const group = { ...(existing as Record<string, string>) };
    delete group[parsed.attrValue];
    if (Object.keys(group).length) next[groupKey] = group;
    else delete next[groupKey];
  }
  delete next[tagKey];
  return next;
}

export function isDynamicAttrPlaceholder(placeholderName: string): boolean {
  return parseDynamicAttrPlaceholder(placeholderName) != null;
}
