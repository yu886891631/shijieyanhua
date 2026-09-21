import { findAllTagInstances } from './tag-extract';

const BOILERPLATE_LINE_RE =
  /^\s*以上是(?:(?:用户|Participant)的本轮输入|<用户本轮输入>|<本轮用户输入>)\s*$/m;

const PRESET_WARNING_NOTICE_RE = /\(\s*⚠️\s*:[^)]*\)/g;

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function isUserInputTagName(name: string): boolean {
  return name.includes('输入') || /input/i.test(name);
}

export function parseTagNameFromOpenInner(inner: string): string {
  const trimmed = inner.trim();
  if (!trimmed || trimmed.startsWith('/')) return '';
  if (/\s[\w:-]+\s*=/.test(trimmed)) {
    return trimmed.split(/\s+/)[0] ?? trimmed;
  }
  return trimmed;
}

export function discoverUserInputTagNames(text: string): string[] {
  const names = new Set<string>();
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tagName = parseTagNameFromOpenInner(m[1]);
    if (tagName && isUserInputTagName(tagName)) {
      names.add(tagName);
    }
  }
  return [...names];
}

export function extractUserInputTagInner(text: string): string | null {
  let bestPos = -1;
  let bestInner = '';
  for (const tagName of discoverUserInputTagNames(text)) {
    const instances = findAllTagInstances(text, tagName);
    if (!instances.length) continue;
    const last = instances[instances.length - 1];
    const inner = last.inner.trim();
    if (!inner) continue;
    const pos = text.lastIndexOf(last.fullBlock);
    if (pos > bestPos) {
      bestPos = pos;
      bestInner = inner;
    }
  }
  return bestInner ? bestInner : null;
}

export function stripUserInputBoilerplatePrefix(text: string): string {
  const match = BOILERPLATE_LINE_RE.exec(text);
  if (!match || match.index === undefined) return text;
  return text.slice(0, match.index).trimEnd();
}

export function stripPresetWarningNotices(text: string): string {
  return collapseBlankLines(text.replace(PRESET_WARNING_NOTICE_RE, ''));
}

/** 提取预设包裹的用户输入内文，避免宏二次展开 */
export function sanitizeUserInputForPostProcess(text: string): string {
  if (!text?.trim()) return text ?? '';

  const fromTag = extractUserInputTagInner(text);
  const body =
    fromTag != null && fromTag.trim()
      ? fromTag.trim()
      : stripUserInputBoilerplatePrefix(text).trim();

  return stripPresetWarningNotices(body);
}
