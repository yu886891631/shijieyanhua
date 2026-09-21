import {
  extractMarkdownSection,
  isProtagonistInfoWorldbookEntry,
  normalizeWorldbookComment,
  READABLE_DATATABLE_COMMENT,
  resolveProtagonistExportEntryName,
  resolveProtagonistTableName,
} from './blocked';
import { sortPlotWorldbookEntries } from './entry-order';
import { processTemplateText } from '../tasks/template-process';

import type { WorldbookEntry } from '@types/function/worldbook';

type DecoratedEntry = WorldbookEntry & {
  bookName: string;
  normalizedComment: string;
  placeholderOriginalIndex: number;
};

function resolveCharacterBookNames(): string[] {
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

async function formatProtagonistEntryContents(entries: WorldbookEntry[], messageId: number): Promise<string> {
  const parts: string[] = [];
  for (const entry of entries) {
    const content = await processTemplateText(entry.content || '', messageId, { source: 'world_info' });
    const trimmed = content.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join('\n\n');
}

async function extractProtagonistFromReadableDataTable(
  entries: WorldbookEntry[],
  messageId: number,
  tablesJson: Record<string, unknown> | null,
): Promise<string> {
  const protagonistTableName = resolveProtagonistTableName(tablesJson);
  const protagonistEntryName = resolveProtagonistExportEntryName(tablesJson);
  for (const entry of entries) {
    if (!entry.enabled) continue;
    if (normalizeWorldbookComment(entry.name) !== READABLE_DATATABLE_COMMENT) continue;
    const content = await processTemplateText(entry.content || '', messageId, { source: 'world_info' });
    const section =
      extractMarkdownSection(content, protagonistTableName) ||
      extractMarkdownSection(content, protagonistEntryName);
    if (section) return section;
  }
  return '';
}

/** 从角色绑定世界书读取 shujuku CustomExport「主角信息」条目 content（全量、不扫描关键词） */
export async function getProtagonistInfoWorldbookContent(
  tablesJson: Record<string, unknown> | null,
  messageId: number,
): Promise<string> {
  const entryName = resolveProtagonistExportEntryName(tablesJson);
  const bookNames = resolveCharacterBookNames();
  if (bookNames.length === 0) return '';

  const matched: DecoratedEntry[] = [];
  let readableFallback = '';
  let placeholderOriginalIndex = 0;
  for (const bookName of bookNames) {
    try {
      const entries = await getWorldbook(bookName);
      if (!readableFallback) {
        readableFallback = await extractProtagonistFromReadableDataTable(entries, messageId, tablesJson);
      }
      for (const entry of entries) {
        const normalizedComment = normalizeWorldbookComment(entry.name);
        const decorated: DecoratedEntry = {
          ...entry,
          bookName,
          normalizedComment,
          placeholderOriginalIndex: placeholderOriginalIndex++,
        };
        if (!isProtagonistInfoWorldbookEntry(normalizedComment, entryName)) continue;
        if (!entry.enabled) continue;
        matched.push(decorated);
      }
    } catch {
      continue;
    }
  }

  if (matched.length === 0) return readableFallback;
  const ordered = sortPlotWorldbookEntries(matched);
  return formatProtagonistEntryContents(ordered, messageId);
}
