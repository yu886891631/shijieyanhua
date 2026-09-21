import { compare } from 'compare-versions';
import JSON5 from 'json5';
import { jsonrepair } from 'jsonrepair';
import { toDotPath } from 'zod/v4/core';

export function assignInplace<T>(destination: T[], new_array: T[]): T[] {
  destination.length = 0;
  destination.push(...new_array);
  return destination;
}

// 修正 _.merge 对数组的合并逻辑, [1, 2, 3] 和 [4, 5] 合并后变成 [4, 5] 而不是 [4, 5, 3]
export function correctlyMerge<TObject, TSource>(lhs: TObject, rhs: TSource): TObject & TSource {
  return _.mergeWith(lhs, rhs, (_lhs, rhs) => (_.isArray(rhs) ? rhs : undefined));
}

export function chunkBy<T>(array: T[], predicate: (lhs: T, rhs: T) => boolean): T[][] {
  if (array.length === 0) {
    return [];
  }

  const chunks: T[][] = [[array[0]]];
  for (const [lhs, rhs] of _.zip(_.dropRight(array), _.drop(array))) {
    if (predicate(lhs!, rhs!)) {
      chunks[chunks.length - 1].push(rhs!);
    } else {
      chunks.push([rhs!]);
    }
  }
  return chunks;
}

export function regexFromString(input: string, replace_macros?: boolean): RegExp | null {
  if (!input) {
    return null;
  }
  const makeRegex = (pattern: string, flags: string) => {
    if (replace_macros) {
      pattern = substitudeMacros(pattern);
    }
    return new RegExp(pattern, flags);
  };
  try {
    const match = input.match(/\/(.+)\/([a-z]*)/i);
    if (!match) {
      return makeRegex(_.escapeRegExp(input), 'i');
    }
    if (match[2] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3])) {
      return makeRegex(input, 'i');
    }
    let flags = match[2] ?? '';
    _.pull(flags, 'g');
    if (flags.indexOf('i') === -1) {
      flags = flags + 'i';
    }
    return makeRegex(match[1], flags);
  } catch {
    return null;
  }
}

export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function checkMinimumVersion(expected: string, title: string) {
  if (compare(await getTavernHelperVersion(), expected, '<')) {
    toastr.error(`'${title}' 需要酒馆助手版本 >= '${expected}'`, '版本不兼容');
  }
}

export function prettifyErrorWithInput(error: z.ZodError) {
  return _([...error.issues])
    .sortBy(issue => issue.path?.length ?? 0)
    .flatMap(issue => {
      const lines = [`✖ ${issue.message}`];
      if (issue.path?.length) {
        lines.push(`  → 路径: ${toDotPath(issue.path)}`);
      }
      if (issue.input !== undefined) {
        lines.push(`  → 输入: ${JSON.stringify(issue.input)}`);
      }
      return lines;
    })
    .join('\n');
}

export function literalYamlify(value: any) {
  return YAML.stringify(value, { blockQuote: 'literal' });
}

const MAX_TRAILING_BRACE_HEAL = 32;

/** 从 start（必须是 `[` 或 `{`）提取括号平衡的子串 */
export function extractBalancedJsonSlice(text: string, start: number): string {
  const open = text[start];
  const close = open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) throw new Error('extractBalancedJsonSlice: start 必须指向 [ 或 {');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('JSON 括号不匹配。');
}

/**
 * 字符串感知扫描对象片段：剩余 `{}` 深度，以及是否仍落在未闭合字符串内。
 * 非以 `{` 开头时 depth 为 0；字符串内括号不计。
 */
export function scanJsonObjectSlice(text: string): { depth: number; inString: boolean } {
  const s = String(text || '').trim();
  if (!s.startsWith('{')) return { depth: 0, inString: false };
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return { depth, inString };
}

/** 从首字符 `{` 扫完后的剩余对象深度（字符串内括号不计）。 */
export function jsonObjectDepth(text: string): number {
  return scanJsonObjectSlice(text).depth;
}

/**
 * L1：去掉尾逗号后，若对象括号未闭合（depth ∈ (0, max]）且字符串已闭合，则在末尾补 `}`。
 * 字符串未闭合时不补，避免把后续内容糊进字符串后再被 jsonrepair 造伪 op。
 */
export function closeTrailingObjectBraces(
  text: string,
  maxHeal = MAX_TRAILING_BRACE_HEAL,
): { text: string; added: number; inString: boolean } {
  const s = String(text || '')
    .replace(/,?\s*$/, '')
    .trim();
  const { depth, inString } = scanJsonObjectSlice(s);
  if (inString || depth <= 0 || depth > maxHeal) return { text: s, added: 0, inString };
  return { text: s + '}'.repeat(depth), added: depth, inString: false };
}

function tryParseOpSlice(
  slice: string,
  options?: { repairOp?: boolean },
): { parsed?: unknown; repaired: boolean } {
  try {
    return { parsed: JSON.parse(slice), repaired: false };
  } catch {
    /* fall through to heal */
  }

  const closed = closeTrailingObjectBraces(slice);
  // 未闭合字符串：不 L1/L2，避免 jsonrepair 瞎补造伪 op
  if (closed.inString) return { repaired: false };

  if (closed.added > 0) {
    try {
      return { parsed: JSON.parse(closed.text), repaired: true };
    } catch {
      /* fall through */
    }
  }

  if (options?.repairOp) {
    try {
      const parsed = JSON.parse(jsonrepair(closed.text));
      return { parsed, repaired: true };
    } catch {
      return { repaired: false };
    }
  }
  return { repaired: false };
}

export type LenientFailedSlice = { index: number; slice: string };

/**
 * 将残缺的 JSON Patch 数组文本按单条 op 尽力解析。
 * 括号不配时：切到下一条 op，先补 `}`（L1），可选再 jsonrepair（L2）。
 * `failedSlices` 为仍无法解析的残片（供失败区展示，与 apply 路径一致）。
 */
export function parseJsonPatchArrayLenient(
  patchArrayText: string,
  options?: { repairOp?: boolean },
): {
  ops: unknown[];
  skipped: number;
  repaired: number;
  repairedOps: unknown[];
  failedSlices: LenientFailedSlice[];
} {
  const text = String(patchArrayText || '').trim();
  if (!text.startsWith('[')) {
    return { ops: [], skipped: 0, repaired: 0, repairedOps: [], failedSlices: [] };
  }
  const ops: unknown[] = [];
  const repairedOps: unknown[] = [];
  const failedSlices: LenientFailedSlice[] = [];
  let skipped = 0;
  let repaired = 0;
  let opIndex = 0;
  let i = 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i++;
    if (i >= text.length || text[i] === ']') break;
    if (text[i] !== '{') {
      const next = text.slice(i).search(/\{\s*"op"\s*:/);
      if (next < 0) break;
      i += next;
      continue;
    }
    opIndex += 1;
    try {
      const slice = extractBalancedJsonSlice(text, i);
      const result = tryParseOpSlice(slice, options);
      if (result.parsed !== undefined) {
        ops.push(result.parsed);
        if (result.repaired) {
          repaired++;
          repairedOps.push(result.parsed);
        }
      } else {
        skipped++;
        failedSlices.push({ index: opIndex, slice });
      }
      i += slice.length;
    } catch {
      const nextRel = text.slice(i + 1).search(/\{\s*"op"\s*:/);
      const end = nextRel < 0 ? text.length : i + 1 + nextRel;
      const rawSlice = text
        .slice(i, end)
        .replace(/,?\s*$/, '')
        .trim()
        .replace(/\s*\]\s*$/, '')
        .trim();
      const result = tryParseOpSlice(rawSlice, options);
      if (result.parsed !== undefined) {
        ops.push(result.parsed);
        if (result.repaired) {
          repaired++;
          repairedOps.push(result.parsed);
        }
      } else {
        skipped++;
        if (rawSlice) failedSlices.push({ index: opIndex, slice: rawSlice });
      }
      if (nextRel < 0) break;
      i = i + 1 + nextRel;
    }
  }
  return { ops, skipped, repaired, repairedOps, failedSlices };
}

export function parseString(content: string): any {
  const json_first = /^[[{]/s.test(content.trimStart());
  try {
    if (json_first) {
      throw Error(`expected error`);
    }
    return YAML.parseDocument(content, { merge: true }).toJS();
  } catch (yaml_error1) {
    try {
      // eslint-disable-next-line import-x/no-named-as-default-member
      return JSON5.parse(content);
    } catch (json5_error) {
      try {
        return JSON.parse(jsonrepair(content));
      } catch (json_error) {
        try {
          if (!json_first) {
            throw Error(`expected error`);
          }
          return YAML.parseDocument(content, { merge: true }).toJS();
        } catch (yaml_error2) {
          const toError = (error: unknown) =>
            error instanceof Error ? `${error.stack ? error.stack : error.message}` : String(error);

          throw new Error(
            literalYamlify({
              ['要解析的字符串不是有效的 YAML/JSON/JSON5 格式']: {
                字符串内容: content,
                YAML错误信息: toError(json_first ? yaml_error2 : yaml_error1),
                JSON5错误信息: toError(json5_error),
                JSON错误信息: toError(json_error),
              },
            }),
          );
        }
      }
    }
  }
}
