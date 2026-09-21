/** 半角/全角逗号分隔列表：解析与格式化 */

export function parseCommaSeparatedList(raw: string): string[] {
  return String(raw ?? '')
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function formatCommaSeparatedList(items: string[]): string {
  return (items ?? []).map(s => String(s).trim()).filter(Boolean).join(',');
}

export function commaSeparatedListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
