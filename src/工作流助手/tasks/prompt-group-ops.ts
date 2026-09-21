import type { z } from 'zod';
import { PromptGroupSchema } from './schema';

type PromptGroup = z.infer<typeof PromptGroupSchema>;

export function defaultPromptGroup(): PromptGroup {
  return { name: '', role: 'user', content: '', enabled: true };
}

export function appendPromptGroup(groups: PromptGroup[], group?: Partial<PromptGroup>): PromptGroup[] {
  const next = _.cloneDeep(groups);
  next.push(PromptGroupSchema.parse({ ...defaultPromptGroup(), ...group }));
  return next;
}

export function removePromptGroupAt(groups: PromptGroup[], index: number): PromptGroup[] {
  if (index < 0 || index >= groups.length) {
    throw new Error(`提示词段索引无效: ${index}`);
  }
  if (groups.length <= 1) {
    throw new Error('至少保留一个提示词段');
  }
  return groups.filter((_, i) => i !== index);
}

export function movePromptGroupAt(
  groups: PromptGroup[],
  index: number,
  delta: -1 | 1,
): PromptGroup[] {
  if (index < 0 || index >= groups.length) {
    throw new Error(`提示词段索引无效: ${index}`);
  }
  const target = index + delta;
  if (target < 0 || target >= groups.length) {
    throw new Error(`提示词段无法移动: 索引 ${index} 方向 ${delta}`);
  }
  const next = _.cloneDeep(groups);
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** 将 fromIndex 段搬到 toIndex（目标为最终数组下标）；越界抛错，相同下标原样返回。 */
export function reorderPromptGroupsAt(
  groups: PromptGroup[],
  fromIndex: number,
  toIndex: number,
): PromptGroup[] {
  if (fromIndex < 0 || fromIndex >= groups.length) {
    throw new Error(`提示词段索引无效: ${fromIndex}`);
  }
  if (toIndex < 0 || toIndex >= groups.length) {
    throw new Error(`提示词段目标索引无效: ${toIndex}`);
  }
  if (fromIndex === toIndex) return groups;
  const next = _.cloneDeep(groups);
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/** 手动段重排后，重映射折叠键 `m-${index}`（其它键保持不变）。 */
export function remapManualExpandedKeys(
  keys: Iterable<string>,
  fromIndex: number,
  toIndex: number,
): Set<string> {
  const next = new Set<string>();
  if (fromIndex === toIndex) {
    for (const key of keys) next.add(key);
    return next;
  }
  for (const key of keys) {
    if (!key.startsWith('m-')) {
      next.add(key);
      continue;
    }
    const i = Number(key.slice(2));
    if (!Number.isInteger(i)) {
      next.add(key);
      continue;
    }
    let newI = i;
    if (i === fromIndex) {
      newI = toIndex;
    } else if (fromIndex < toIndex) {
      if (i > fromIndex && i <= toIndex) newI = i - 1;
    } else if (i >= toIndex && i < fromIndex) {
      newI = i + 1;
    }
    next.add(`m-${newI}`);
  }
  return next;
}

/** 删除手动段后，去掉 `m-${removedIndex}`，并将更大下标的键左移一位。 */
export function remapManualExpandedKeysAfterRemove(
  keys: Iterable<string>,
  removedIndex: number,
): Set<string> {
  const next = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith('m-')) {
      next.add(key);
      continue;
    }
    const i = Number(key.slice(2));
    if (!Number.isInteger(i)) {
      next.add(key);
      continue;
    }
    if (i === removedIndex) continue;
    next.add(i > removedIndex ? `m-${i - 1}` : `m-${i}`);
  }
  return next;
}
