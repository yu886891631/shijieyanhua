import { isCustomExportIndexEntry, isDbGeneratedEntry } from './blocked';

import type { WorldbookEntry } from '@types/function/worldbook';

/** DB 条目：剥离 shujuku 默认内标题（# 表名 + 表格）。外层条目名已统一不注入。 */
export function shouldOmitEntryTitleInPlaceholder(normalizedComment: string): boolean {
  return isDbGeneratedEntry(String(normalizedComment || '').trim());
}

/** 仅剥离 shujuku buildEntryContent 默认形态：# 表名 + 空行 + 表格（中间无其他行） */
export function stripShujukuInnerTableTitle(content: string): string {
  const text = String(content || '').replace(/\r\n/g, '\n').trim();
  if (!text.startsWith('# ')) return text;
  const lines = text.split('\n');
  if (lines.length < 4) return text;
  if (lines[1]?.trim() !== '') return text;
  if (!lines[2]?.trim().startsWith('|') || !lines[3]?.trim().startsWith('|')) return text;
  const tableLines: string[] = [];
  for (const line of lines.slice(2)) {
    if (!line.trim().startsWith('|')) break;
    tableLines.push(line);
  }
  if (tableLines.length >= 2) return tableLines.join('\n').trim();
  return text;
}

export function prepareRawPlaceholderEntryContent(
  entry: Pick<WorldbookEntry, 'content'> & { normalizedComment?: string },
): string {
  const normalizedComment = entry.normalizedComment || '';
  const raw = String(entry.content || '').replace(/\r\n/g, '\n');
  if (!shouldOmitEntryTitleInPlaceholder(normalizedComment)) return raw;
  if (isCustomExportIndexEntry(normalizedComment)) return raw;
  return stripShujukuInnerTableTitle(raw);
}

export function normalizePlaceholderEntryContent(
  entry: Pick<WorldbookEntry, 'content'> & { normalizedComment?: string },
  content: string,
): string {
  return content.trim();
}

/** 占位符条目块：仅正文，不含世界书条目名称 */
export function composePlaceholderEntryBlock(
  entry: Pick<WorldbookEntry, 'content'> & { normalizedComment?: string },
  processedContent: string,
): string {
  return normalizePlaceholderEntryContent(entry, processedContent);
}
