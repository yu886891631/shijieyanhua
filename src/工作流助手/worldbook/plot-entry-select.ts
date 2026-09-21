import { shouldShowEntryInUi } from './blocked';
import type { ChatWorldbookWriteRule, PlotWorldbookConfig } from '../tasks/schema';

import type { WorldbookEntry } from '@types/function/worldbook';

/** 酒馆世界书设置中是否启用该条目 */
export function isStWorldbookEntryEnabled(entry: WorldbookEntry): boolean {
  return !!entry.enabled;
}

/** 可出现在 $1 勾选列表中（含 ST 未启用；不含托管/黑名单等） */
export function isPlotWorldbookEntryListed(
  entry: WorldbookEntry,
  writeRules: ChatWorldbookWriteRule[] = [],
): boolean {
  return shouldShowEntryInUi({ name: entry.name }, writeRules);
}

/**
 * 默认可勾选 / 全选目标：UI 可见且 ST 已启用。
 * （对齐历史 isPlotEntryAllowed；ST 未启用不进入默认勾选）
 */
export function isPlotWorldbookEntrySelectable(
  entry: WorldbookEntry,
  writeRules: ChatWorldbookWriteRule[] = [],
): boolean {
  if (!isStWorldbookEntryEnabled(entry)) return false;
  return isPlotWorldbookEntryListed(entry, writeRules);
}

export function selectablePlotWorldbookEntryUids(
  entries: WorldbookEntry[],
  writeRules: ChatWorldbookWriteRule[] = [],
): number[] {
  return entries.filter(e => isPlotWorldbookEntrySelectable(e, writeRules)).map(e => e.uid);
}

export function listedPlotWorldbookEntryUids(
  entries: WorldbookEntry[],
  writeRules: ChatWorldbookWriteRule[] = [],
): number[] {
  return entries.filter(e => isPlotWorldbookEntryListed(e, writeRules)).map(e => e.uid);
}

/**
 * 净化已保存勾选：只剔除不可列表展示的 UID。
 * 保留用户已勾选的 ST 未启用条目。
 */
export function sanitizePlotWorldbookEnabledUids(
  entries: WorldbookEntry[],
  uids: number[],
  writeRules: ChatWorldbookWriteRule[] = [],
): number[] {
  const listed = new Set(listedPlotWorldbookEntryUids(entries, writeRules));
  return uids.filter(uid => listed.has(uid));
}

/**
 * $1 是否应收录该条目。
 * - ST 未启用：仅当 enabledEntries 显式包含该 uid
 * - enabledEntries 为空：视为默认全选 ST 已启用，不拉入未启用
 */
export function shouldIncludePlotWorldbookEntryInDollar1(
  entry: WorldbookEntry,
  decorated: { bookName: string; uid: number; normalizedComment: string },
  config: PlotWorldbookConfig,
  writeRules: ChatWorldbookWriteRule[] = [],
  options?: {
    autoIncluded?: boolean;
    isSelected?: boolean;
  },
): boolean {
  if (options?.autoIncluded) {
    return options.isSelected !== false;
  }
  if (!isPlotWorldbookEntryListed(entry, writeRules)) return false;

  if (!isStWorldbookEntryEnabled(entry)) {
    const list = config.enabledEntries?.[decorated.bookName];
    return Array.isArray(list) && list.includes(decorated.uid);
  }

  return options?.isSelected !== false;
}
