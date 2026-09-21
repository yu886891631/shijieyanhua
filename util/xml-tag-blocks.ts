/**
 * 从文本中提取 XML 风格标签块（大小写不敏感），跳过「孤儿开标签」：
 * 开标签到其第一个闭标签之间若还有同名开标签，则当前开标签视为提及/噪声，跳过。
 */

function isValidOpenTagPrefixMatch(source: string, startIdx: number, prefixLen: number): boolean {
  if (startIdx > 0 && source[startIdx - 1] === '/') return false;
  const ch = source[startIdx + prefixLen];
  if (ch === undefined) return true;
  if (ch === '>' || ch === '=') return true;
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return true;
  if (/[A-Za-z0-9_-]/.test(ch)) return false;
  return true;
}

function findOpenTagAt(source: string, tagName: string, fromIndex: number): number {
  const prefix = `<${tagName}`;
  const lowerSource = source.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  let idx = fromIndex;
  while (idx < source.length) {
    const found = lowerSource.indexOf(lowerPrefix, idx);
    if (found === -1) return -1;
    if (isValidOpenTagPrefixMatch(source, found, prefix.length)) return found;
    idx = found + 1;
  }
  return -1;
}

function findOpenTagEnd(source: string, openStart: number): number {
  return source.indexOf('>', openStart);
}

function findCloseTag(source: string, tagName: string, afterOpenEnd: number): number {
  const close = `</${tagName}>`;
  return source.toLowerCase().indexOf(close.toLowerCase(), afterOpenEnd);
}

export type XmlTagBlock = {
  /** 开标签起始下标 */
  openStart: number;
  /** 开标签 `>` 下标 */
  openEnd: number;
  /** 闭标签起始下标 */
  closeStart: number;
  /** 闭标签结束（不含） */
  closeEnd: number;
  inner: string;
};

/**
 * 提取所有完整、非孤儿的标签块。
 */
export function extractXmlTagBlocks(text: string, tagName: string): XmlTagBlock[] {
  const source = String(text ?? '');
  if (!source || !tagName) return [];

  const blocks: XmlTagBlock[] = [];
  let searchFrom = 0;
  const closeTagLen = `</${tagName}>`.length;

  while (searchFrom < source.length) {
    const openStart = findOpenTagAt(source, tagName, searchFrom);
    if (openStart === -1) break;
    const openEnd = findOpenTagEnd(source, openStart);
    if (openEnd === -1) break;

    const closeStart = findCloseTag(source, tagName, openEnd + 1);
    if (closeStart === -1) break;

    const nextOpen = findOpenTagAt(source, tagName, openEnd + 1);
    if (nextOpen !== -1 && nextOpen < closeStart) {
      // 孤儿开标签：跳过当前开标签，继续往后找
      searchFrom = openEnd + 1;
      continue;
    }

    const closeEnd = closeStart + closeTagLen;
    blocks.push({
      openStart,
      openEnd,
      closeStart,
      closeEnd,
      inner: source.slice(openEnd + 1, closeStart),
    });
    searchFrom = closeEnd;
  }

  return blocks;
}

export function extractXmlTagInners(text: string, tagName: string): string[] {
  return extractXmlTagBlocks(text, tagName).map(b => b.inner);
}

export function hasXmlTagBlock(text: string, tagName: string): boolean {
  return extractXmlTagBlocks(text, tagName).length > 0;
}

/**
 * 将判定为孤儿的开标签去掉尖括号（保留标签名文本），避免后续非贪婪正则再错配。
 * 从后往前替换，避免下标偏移。
 */
export function neutralizeOrphanXmlOpens(text: string, tagNames: string[]): string {
  let source = String(text ?? '');
  if (!source || !tagNames.length) return source;

  type Orphan = { openStart: number; openEnd: number; openText: string };
  const orphans: Orphan[] = [];

  for (const tagName of tagNames) {
    if (!tagName) continue;
    let searchFrom = 0;
    while (searchFrom < source.length) {
      const openStart = findOpenTagAt(source, tagName, searchFrom);
      if (openStart === -1) break;
      const openEnd = findOpenTagEnd(source, openStart);
      if (openEnd === -1) break;

      const closeStart = findCloseTag(source, tagName, openEnd + 1);
      if (closeStart === -1) {
        // 无任何闭标签：整段开标签都视为噪声开标签
        orphans.push({
          openStart,
          openEnd,
          openText: source.slice(openStart, openEnd + 1),
        });
        searchFrom = openEnd + 1;
        continue;
      }

      const nextOpen = findOpenTagAt(source, tagName, openEnd + 1);
      if (nextOpen !== -1 && nextOpen < closeStart) {
        orphans.push({
          openStart,
          openEnd,
          openText: source.slice(openStart, openEnd + 1),
        });
        searchFrom = openEnd + 1;
        continue;
      }

      // 合法块：跳过整块
      searchFrom = closeStart + `</${tagName}>`.length;
    }
  }

  orphans.sort((a, b) => b.openStart - a.openStart);
  for (const o of orphans) {
    const neutralized = o.openText.replace(/^</, '').replace(/>$/, '');
    source = source.slice(0, o.openStart) + neutralized + source.slice(o.openEnd + 1);
  }

  return source;
}
