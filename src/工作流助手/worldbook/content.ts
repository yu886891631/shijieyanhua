import {
  READABLE_DATATABLE_COMMENT,
  isChronicleMemoryWorldbookEntry,
  isEntryBlocked,
  isManagedPlotWorldbookEntry,
  isOutlineOrSummaryIndexEntry,
  isPlotDollar1AutoIncludedEntry,
  isProtagonistInfoWorldbookEntry,
  removeMarkdownSection,
  normalizeWorldbookComment,
  resolveProtagonistExportEntryName,
  resolveProtagonistTableName,
} from './blocked';
import {
  composePlaceholderEntryBlock,
  prepareRawPlaceholderEntryContent,
} from './entry-placeholder-format';
import { shouldIncludePlotWorldbookEntryInDollar1 } from './plot-entry-select';
import { applyExcludeRulesToText } from '../tasks/context-tags';
import { processTemplateText } from '../tasks/template-process';
import { sortPlotWorldbookEntries } from './entry-order';
import { scanTriggeredWorldbookEntries } from './scan';
import { getWorldbookCached } from './read-cache';
import { resolveWriteTargetBookName } from './write-from-template';
import type { ChatWorldbookWriteRule, ContextTagRule, PlotWorldbookConfig } from '../tasks/schema';

import type { WorldbookEntry } from '@types/function/worldbook';

type DecoratedEntry = WorldbookEntry & {
  bookName: string;
  normalizedComment: string;
  placeholderOriginalIndex: number;
};

/** 条目宏/EJS 完成后：排除规则 + worldbook_context 包装（对齐 shujuku 剧情 $1 替换） */
export function finalizePlotWorldbookPlaceholderContent(
  raw: string,
  excludeRules: ContextTagRule[],
): string {
  const filtered = applyExcludeRulesToText(raw, excludeRules).trim();
  if (!filtered) return '';
  return `\n<worldbook_context>\n${filtered}\n</worldbook_context>\n`;
}

/** $2：排除规则 + worldbook_extra 包装（与 $1 区分，避免与标签占位符重复时难拆） */
export function finalizeManagedWorldbookPlaceholderContent(
  raw: string,
  excludeRules: ContextTagRule[],
): string {
  const filtered = applyExcludeRulesToText(raw, excludeRules).trim();
  if (!filtered) return '';
  return `\n<worldbook_extra>\n${filtered}\n</worldbook_extra>\n`;
}

async function resolveBookNames(config: PlotWorldbookConfig): Promise<string[]> {
  if (config.source === 'manual') {
    return [...new Set(config.manualSelection.filter(Boolean))];
  }
  try {
    const charBooks = getCharWorldbookNames('current');
    const names: string[] = [];
    if (charBooks.primary) names.push(charBooks.primary);
    names.push(...charBooks.additional);
    return [...new Set(names.filter(Boolean))];
  } catch {
    return [];
  }
}

function resolveManagedBookNames(writeRules: ChatWorldbookWriteRule[]): string[] {
  const names: string[] = [];
  for (const rule of writeRules) {
    const book = resolveWriteTargetBookName(rule);
    if (book) names.push(book);
  }
  if (names.length > 0) return [...new Set(names)];
  try {
    const charBooks = getCharWorldbookNames('current');
    const fallback: string[] = [];
    if (charBooks.primary) fallback.push(charBooks.primary);
    fallback.push(...charBooks.additional);
    return [...new Set(fallback.filter(Boolean))];
  } catch {
    return [];
  }
}

function decorateEntry(
  entry: WorldbookEntry,
  bookName: string,
  placeholderOriginalIndex: number,
): DecoratedEntry {
  const normalizedComment = normalizeWorldbookComment(entry.name);
  return { ...entry, bookName, normalizedComment, placeholderOriginalIndex };
}

/** 对齐 shujuku isSelected：$1 仅对非纪要 DB 条目旁路；托管条目不走 $1 */
export function isSelectedPlotWorldbookEntry(
  entry: { bookName: string; uid: number; normalizedComment: string },
  config: PlotWorldbookConfig,
  protagonistEntryName?: string,
): boolean {
  const enabledMap = config.enabledEntries || {};
  const hasAnySelection = Object.keys(enabledMap).length > 0;
  if (!hasAnySelection) return true;
  if (isPlotDollar1AutoIncludedEntry(entry.normalizedComment, protagonistEntryName)) return true;
  const list = enabledMap[entry.bookName];
  if (list == null || !Array.isArray(list)) return true;
  return list.includes(entry.uid);
}

async function formatWorldbookEntries(
  entries: Array<WorldbookEntry & { normalizedComment?: string }>,
  messageId: number,
): Promise<string> {
  const parts: string[] = [];
  for (const entry of entries) {
    const rawContent = prepareRawPlaceholderEntryContent(entry);
    const content = await processTemplateText(rawContent, messageId, { source: 'world_info' });
    const block = composePlaceholderEntryBlock(entry, content);
    if (!block) continue;
    parts.push(block);
  }
  return parts.join('\n\n');
}

export async function getWorldbookContentForPostProcess(
  config: PlotWorldbookConfig,
  baseScanText: string,
  messageId: number,
  writeRules: ChatWorldbookWriteRule[] = [],
  tablesJson: Record<string, unknown> | null = null,
): Promise<string> {
  const bookNames = await resolveBookNames(config);
  if (bookNames.length === 0) return '';
  const protagonistEntryName = resolveProtagonistExportEntryName(tablesJson);
  const protagonistTableName = resolveProtagonistTableName(tablesJson);

  const allEntries: DecoratedEntry[] = [];
  let placeholderOriginalIndex = 0;
  for (const bookName of bookNames) {
    try {
      const entries = await getWorldbookCached(bookName);
      for (const entry of entries) {
        const decorated = decorateEntry(entry, bookName, placeholderOriginalIndex++);
        if (isOutlineOrSummaryIndexEntry(decorated.normalizedComment)) continue;
        if (isChronicleMemoryWorldbookEntry(decorated.normalizedComment)) continue;
        if (isManagedPlotWorldbookEntry(decorated.normalizedComment, writeRules)) continue;
        if (isProtagonistInfoWorldbookEntry(decorated.normalizedComment, protagonistEntryName)) continue;
        const autoIncluded = isPlotDollar1AutoIncludedEntry(decorated.normalizedComment, protagonistEntryName);
        if (!autoIncluded && isEntryBlocked(entry)) continue;
        const selected = isSelectedPlotWorldbookEntry(decorated, config, protagonistEntryName);
        if (
          !shouldIncludePlotWorldbookEntryInDollar1(entry, decorated, config, writeRules, {
            autoIncluded,
            isSelected: selected,
          })
        ) {
          continue;
        }
        if (decorated.normalizedComment === READABLE_DATATABLE_COMMENT) {
          const sanitizedContent =
            removeMarkdownSection(entry.content || '', protagonistTableName) ||
            removeMarkdownSection(entry.content || '', protagonistEntryName);
          if (!sanitizedContent.trim()) continue;
          allEntries.push({ ...decorated, content: sanitizedContent });
          continue;
        }
        allEntries.push(decorated);
      }
    } catch {
      continue;
    }
  }

  if (allEntries.length === 0) return '';
  const triggered = sortPlotWorldbookEntries(
    scanTriggeredWorldbookEntries(allEntries, baseScanText, { allowDisabled: true }),
  );
  return formatWorldbookEntries(triggered, messageId);
}

/** $2：仅托管条目，关键词扫描；恒定条目始终触发 */
export async function getManagedWorldbookContentForPostProcess(
  baseScanText: string,
  messageId: number,
  writeRules: ChatWorldbookWriteRule[] = [],
): Promise<string> {
  const bookNames = resolveManagedBookNames(writeRules);
  if (bookNames.length === 0) return '';

  const allEntries: DecoratedEntry[] = [];
  let placeholderOriginalIndex = 0;
  for (const bookName of bookNames) {
    try {
      const entries = await getWorldbookCached(bookName);
      for (const entry of entries) {
        if (!entry.enabled) continue;
        const decorated = decorateEntry(entry, bookName, placeholderOriginalIndex++);
        if (!isManagedPlotWorldbookEntry(decorated.normalizedComment, writeRules)) continue;
        allEntries.push(decorated);
      }
    } catch {
      continue;
    }
  }

  if (allEntries.length === 0) return '';
  const triggered = sortPlotWorldbookEntries(scanTriggeredWorldbookEntries(allEntries, baseScanText));
  return formatWorldbookEntries(triggered, messageId);
}

export { resolveBookNames, resolveManagedBookNames };
