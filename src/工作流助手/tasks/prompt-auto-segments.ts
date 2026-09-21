import type { z } from 'zod';
import { sortSegmentsInSlot } from './prompt-auto-segment-ops';
import { PromptGroupSchema, type PostProcessTask } from './schema';

type PromptGroup = z.infer<typeof PromptGroupSchema>;

export type PromptPreviewRow =
  | {
      kind: 'auto';
      segmentId: string;
      slotId: string;
      slotName: string;
      group: PromptGroup;
    }
  | {
      kind: 'manual';
      manualIndex: number;
      group: PromptGroup;
    };

function segmentToPromptGroup(seg: PostProcessTask['promptAutoSegments'][number]): PromptGroup {
  return PromptGroupSchema.parse({
    name: seg.name,
    role: seg.role,
    content: seg.content,
    enabled: true,
  });
}

function getInsertedAutoGroupsAtOrder(task: PostProcessTask, order: number): PromptGroup[] {
  const slots = [...(task.promptAutoSlots ?? [])]
    .filter(s => s.order === order)
    .sort((a, b) => a.id.localeCompare(b.id));
  const segments = task.promptAutoSegments ?? [];
  const result: PromptGroup[] = [];
  for (const slot of slots) {
    for (const seg of sortSegmentsInSlot(segments, slot.id)) {
      if (!seg.inserted) continue;
      result.push(segmentToPromptGroup(seg));
    }
  }
  return result;
}

function getInsertedAutoPreviewRowsAtOrder(task: PostProcessTask, order: number): PromptPreviewRow[] {
  const slots = [...(task.promptAutoSlots ?? [])]
    .filter(s => s.order === order)
    .sort((a, b) => a.id.localeCompare(b.id));
  const segments = task.promptAutoSegments ?? [];
  const result: PromptPreviewRow[] = [];
  for (const slot of slots) {
    for (const seg of sortSegmentsInSlot(segments, slot.id)) {
      if (!seg.inserted) continue;
      result.push({
        kind: 'auto',
        segmentId: seg.id,
        slotId: slot.id,
        slotName: slot.name?.trim() || '未命名插入位',
        group: segmentToPromptGroup(seg),
      });
    }
  }
  return result;
}

/** 合并手动 promptGroups 与已启用的自动段（order=k 插在 manual[k] 之前） */
export function buildEffectivePromptGroups(task: PostProcessTask): PromptGroup[] {
  const manual = task.promptGroups ?? [];
  const result: PromptGroup[] = [];
  for (let i = 0; i <= manual.length; i++) {
    result.push(...getInsertedAutoGroupsAtOrder(task, i));
    if (i < manual.length) {
      result.push(manual[i]!);
    }
  }
  return result;
}

/** 提示词段合并预览行（与 buildEffectivePromptGroups 顺序一致） */
export function buildPromptPreviewRows(task: PostProcessTask): PromptPreviewRow[] {
  const manual = task.promptGroups ?? [];
  const result: PromptPreviewRow[] = [];
  for (let i = 0; i <= manual.length; i++) {
    result.push(...getInsertedAutoPreviewRowsAtOrder(task, i));
    if (i < manual.length) {
      result.push({ kind: 'manual', manualIndex: i, group: manual[i]! });
    }
  }
  return result;
}

/** 扫描任务提示词正文（手动启用段 + 已插入自动段，顺序与合并结果一致） */
export function iterTaskPromptContents(task: PostProcessTask): string[] {
  const manual = task.promptGroups ?? [];
  const texts: string[] = [];
  for (let i = 0; i <= manual.length; i++) {
    for (const g of getInsertedAutoGroupsAtOrder(task, i)) {
      texts.push(g.content);
    }
    if (i < manual.length) {
      const g = manual[i]!;
      if (g.enabled !== false) texts.push(g.content);
    }
  }
  return texts;
}
