import type { ChatWorldbookWriteRule } from '../tasks/schema';
import { isManagedWorldbookEntryName } from './write-ledger-utils';
import { WORKFLOW_HELPER_ENTRY_PREFIX } from './write-sync';

const BLOCKED_KEYWORDS = [
  '规则',
  '思维链',
  'cot',
  'MVU',
  'mvu',
  '变量',
  '状态',
  'Status',
  'Rule',
  'rule',
  '检定',
  '判断',
  '叙事',
  '文风',
  'InitVar',
  '格式',
];

export function normalizeWorldbookComment(comment: string): string {
  let normalized = String(comment || '').replace(/^ACU-\[[^\]]+\]-/, '');
  normalized = normalized.replace(/^外部导入-(?:[^-]+-)?/, '');
  return normalized;
}

export function isDbGeneratedEntry(normalizedComment: string): boolean {
  return (
    normalizedComment.startsWith('TavernDB-ACU-') ||
    normalizedComment.startsWith('总结条目') ||
    normalizedComment.startsWith('小总结条目') ||
    normalizedComment.startsWith('重要人物条目')
  );
}

const CUSTOM_EXPORT_CHRONICLE_ROW_RE = /CustomExport-纪要-\d+$/;
const CUSTOM_EXPORT_CHRONICLE_WRAP_RE = /CustomExport-纪要-包裹-(上|下)$/;
const CUSTOM_EXPORT_CHRONICLE_HEADER_RE = /CustomExport-纪要-表头$/;
export const READABLE_DATATABLE_COMMENT = 'TavernDB-ACU-ReadableDataTable';

/** shujuku CustomExport 纪要数据行（及遗留总结条目）→ $6 按 AM 取最近 N 条 */
export function isChronicleMemoryRowEntry(normalizedComment: string): boolean {
  if (CUSTOM_EXPORT_CHRONICLE_ROW_RE.test(normalizedComment)) return true;
  return (
    normalizedComment.startsWith('总结条目') || normalizedComment.startsWith('小总结条目')
  );
}

/** CustomExport 纪要 3-depth 包裹上下 → $6 头尾、$1 排除 */
export function isChronicleMemoryWrapEntry(normalizedComment: string): boolean {
  return CUSTOM_EXPORT_CHRONICLE_WRAP_RE.test(normalizedComment);
}

export function isChronicleMemoryWrapBefore(normalizedComment: string): boolean {
  return /CustomExport-纪要-包裹-上$/.test(normalizedComment);
}

export function isChronicleMemoryWrapAfter(normalizedComment: string): boolean {
  return /CustomExport-纪要-包裹-下$/.test(normalizedComment);
}

/** 纪要相关（行 / 包裹 / 表头）→ $1 排除；行+包裹供 $6 */
export function isChronicleMemoryWorldbookEntry(normalizedComment: string): boolean {
  if (isChronicleMemoryRowEntry(normalizedComment)) return true;
  if (isChronicleMemoryWrapEntry(normalizedComment)) return true;
  if (CUSTOM_EXPORT_CHRONICLE_HEADER_RE.test(normalizedComment)) return true;
  return false;
}

const DEFAULT_PROTAGONIST_EXPORT_ENTRY_NAME = '主角信息';
const DEFAULT_PROTAGONIST_TABLE_NAME = '主角信息表';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readExportConfigEntryName(table: unknown): string {
  if (!table || typeof table !== 'object') return '';
  const exportConfig = (table as { exportConfig?: { entryName?: unknown } }).exportConfig;
  const entryName = String(exportConfig?.entryName ?? '').trim();
  return entryName;
}

function readTableName(table: unknown): string {
  if (!table || typeof table !== 'object') return '';
  return String((table as { name?: unknown }).name ?? '').trim();
}

/** 从 shujuku tablesJson 快照解析「主角信息」CustomExport entryName */
export function resolveProtagonistExportEntryName(
  tablesJson: Record<string, unknown> | null | undefined,
): string {
  if (!tablesJson || typeof tablesJson !== 'object') return DEFAULT_PROTAGONIST_EXPORT_ENTRY_NAME;
  for (const table of Object.values(tablesJson)) {
    if (!table || typeof table !== 'object') continue;
    const tableName = readTableName(table);
    if (tableName !== DEFAULT_PROTAGONIST_TABLE_NAME) continue;
    const entryName = readExportConfigEntryName(table);
    return entryName || DEFAULT_PROTAGONIST_EXPORT_ENTRY_NAME;
  }
  return DEFAULT_PROTAGONIST_EXPORT_ENTRY_NAME;
}

export function resolveProtagonistTableName(
  tablesJson: Record<string, unknown> | null | undefined,
): string {
  if (!tablesJson || typeof tablesJson !== 'object') return DEFAULT_PROTAGONIST_TABLE_NAME;
  for (const table of Object.values(tablesJson)) {
    if (!table || typeof table !== 'object') continue;
    const tableName = readTableName(table);
    if (tableName === DEFAULT_PROTAGONIST_TABLE_NAME) return tableName;
  }
  return DEFAULT_PROTAGONIST_TABLE_NAME;
}

function buildProtagonistInfoCommentPatterns(entryName: string): RegExp[] {
  const escaped = escapeRegExp(entryName.trim() || DEFAULT_PROTAGONIST_EXPORT_ENTRY_NAME);
  return [
    new RegExp(`^TavernDB-ACU-CustomExport-${escaped}(?:-(?:表头|包裹-上|包裹-下|[1-9]\\d*))?$`),
    new RegExp(`^TavernDB-ACU-CustomExport-${escaped}-索引$`),
  ];
}

const CUSTOM_EXPORT_INDEX_RE = /CustomExport-.+-索引$/;

/** shujuku CustomExport 附加索引条目（含纪要索引）→ 占位符输出保留包裹标签 */
export function isCustomExportIndexEntry(normalizedComment: string): boolean {
  const normalized = String(normalizedComment || '').trim();
  if (!normalized) return false;
  if (normalized === 'TavernDB-ACU-CustomExport-纪要索引') return true;
  return CUSTOM_EXPORT_INDEX_RE.test(normalized);
}

/** shujuku CustomExport「主角信息」→ $1 排除、$U 最新数据 */
export function isProtagonistInfoWorldbookEntry(
  normalizedComment: string,
  entryName: string = DEFAULT_PROTAGONIST_EXPORT_ENTRY_NAME,
): boolean {
  const normalized = String(normalizedComment || '').trim();
  if (!normalized) return false;
  return buildProtagonistInfoCommentPatterns(entryName).some(pattern => pattern.test(normalized));
}

function escapeMarkdownHeaderTitle(title: string): string {
  return escapeRegExp(title.trim());
}

export function extractMarkdownSection(content: string, sectionTitle: string): string {
  const trimmedTitle = sectionTitle.trim();
  if (!trimmedTitle) return '';
  const body = String(content || '').replace(/\r\n/g, '\n');
  const pattern = new RegExp(
    `(?:^|\\n)# ${escapeMarkdownHeaderTitle(trimmedTitle)}\\n\\n([\\s\\S]*?)(?=\\n# |$)`,
  );
  const match = pattern.exec(body);
  return (match?.[1] ?? '').trim();
}

export function removeMarkdownSection(content: string, sectionTitle: string): string {
  const trimmedTitle = sectionTitle.trim();
  if (!trimmedTitle) return String(content || '').trim();
  const body = String(content || '').replace(/\r\n/g, '\n');
  const pattern = new RegExp(
    `(?:^|\\n)# ${escapeMarkdownHeaderTitle(trimmedTitle)}\\n\\n[\\s\\S]*?(?=(\\n# )|$)`,
    'g',
  );
  const removed = body.replace(pattern, (match, nextHeader) => (nextHeader ? '\n' : ''));
  return removed.replace(/\n{3,}/g, '\n\n').trim();
}

/** 默认前缀托管条目（规范化后） */
export function isWorkflowHelperManagedEntry(normalizedComment: string): boolean {
  return normalizedComment.startsWith(WORKFLOW_HELPER_ENTRY_PREFIX);
}

/** 工作流助手托管条目（WorkflowHelper- 前缀）→ 专供 $2 */
export function isManagedPlotWorldbookEntry(
  nameOrNormalized: string,
  writeRules: ChatWorldbookWriteRule[] = [],
): boolean {
  const normalized = normalizeWorldbookComment(nameOrNormalized);
  if (isWorkflowHelperManagedEntry(normalized)) return true;
  if (writeRules.length > 0 && isManagedWorldbookEntryName(normalized, writeRules)) return true;
  return false;
}

/**
 * $1 扫描始终纳入：非纪要记忆 / 非主角信息的 DB 生成条目（不含 WorkflowHelper / CustomExport 纪要相关）。
 * 对齐 shujuku 对 isDbGenerated 的旁路，但托管、纪要记忆与主角信息已拆到 $2/$6/$U。
 */
export function isPlotDollar1AutoIncludedEntry(
  nameOrNormalized: string,
  protagonistEntryName: string = DEFAULT_PROTAGONIST_EXPORT_ENTRY_NAME,
): boolean {
  const normalized = normalizeWorldbookComment(nameOrNormalized);
  if (isChronicleMemoryWorldbookEntry(normalized)) return false;
  if (isProtagonistInfoWorldbookEntry(normalized, protagonistEntryName)) return false;
  if (isWorkflowHelperManagedEntry(normalized)) return false;
  return isDbGeneratedEntry(normalized);
}

/**
 * UI 隐藏 / 非手动勾选清单条目：DB 生成 + 工作流助手托管。
 */
export function isAutoIncludedPlotWorldbookEntry(
  nameOrNormalized: string,
  writeRules: ChatWorldbookWriteRule[] = [],
): boolean {
  const normalized = normalizeWorldbookComment(nameOrNormalized);
  if (isDbGeneratedEntry(normalized)) return true;
  return isManagedPlotWorldbookEntry(normalized, writeRules);
}

export function isOutlineOrSummaryIndexEntry(normalizedComment: string): boolean {
  return (
    normalizedComment.startsWith('TavernDB-ACU-OutlineTable') ||
    normalizedComment.startsWith('TavernDB-ACU-CustomExport-纪要索引')
  );
}

export function isEntryBlocked(entry: { name?: string }): boolean {
  const name = entry.name || '';
  return BLOCKED_KEYWORDS.some(keyword => name.includes(keyword));
}

export function shouldShowEntryInUi(
  entry: { name?: string },
  writeRules: ChatWorldbookWriteRule[] = [],
): boolean {
  const normalized = normalizeWorldbookComment(entry.name || '');
  if (isOutlineOrSummaryIndexEntry(normalized)) return false;
  if (isAutoIncludedPlotWorldbookEntry(normalized, writeRules)) return false;
  if (isEntryBlocked({ name: entry.name })) return false;
  return true;
}
