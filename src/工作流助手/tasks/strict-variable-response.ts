import { extractBalancedJsonSlice, parseJsonPatchArrayLenient } from '@util/common';
import { hasXmlTagBlock } from '@util/xml-tag-blocks';

import type { ApiConfig } from './schema';

export type StructuredOutputMode = 'off' | 'mvu_json_patch' | 'addon_json_patch';
export type ActiveStructuredOutputMode = Exclude<StructuredOutputMode, 'off'>;

export { extractBalancedJsonSlice } from '@util/common';

export function stripCodeFence(text: string): string {
  const trimmed = String(text || '').trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

export function tryParseJsonObject(text: string): unknown {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('回复不是合法 JSON 对象。');
  }
}

/**
 * 当 analysis 字段含未转义引号导致整段 JSON.parse 失败时，
 * 仍尝试按键位切割取出 analysis 文本与 patch 数组。
 * 若 patch 数组整体非法，再按单条 op 尽力挽救可解析条目。
 */
export function tryParseStrictVariableObjectLenient(text: string): {
  analysis: string;
  patch: unknown[];
  patchSlice: string;
  skippedOpCount: number;
} {
  const cleaned = stripCodeFence(text);
  const patchKey = /"patch"\s*:\s*\[/.exec(cleaned);
  if (!patchKey || patchKey.index == null) {
    throw new Error('回复中未找到 patch 数组。');
  }
  const arrayStart = patchKey.index + patchKey[0].length - 1;
  let patchSlice: string;
  try {
    patchSlice = extractBalancedJsonSlice(cleaned, arrayStart);
  } catch {
    // 缺收尾 ] 时仍尝试从 [ 扫到文末
    patchSlice = cleaned.slice(arrayStart);
  }

  let patch: unknown[];
  let skippedOpCount = 0;
  try {
    const parsed = JSON.parse(patchSlice);
    if (!Array.isArray(parsed)) throw new Error('patch 必须是数组。');
    patch = parsed;
  } catch {
    const lenient = parseJsonPatchArrayLenient(patchSlice);
    patch = lenient.ops;
    skippedOpCount = lenient.skipped;
  }
  if (!patch.length) throw new Error('patch 数组无法解析出任何有效操作。');

  const analysisKey = /"analysis"\s*:\s*/.exec(cleaned);
  if (!analysisKey || analysisKey.index == null || analysisKey.index > patchKey.index) {
    throw new Error('analysis 必须是非空字符串。');
  }
  let analysisRaw = cleaned.slice(analysisKey.index + analysisKey[0].length, patchKey.index).trim();
  analysisRaw = analysisRaw.replace(/,\s*$/, '').trim();
  if (analysisRaw.startsWith('"') && analysisRaw.endsWith('"')) {
    analysisRaw = analysisRaw.slice(1, -1);
  }
  analysisRaw = analysisRaw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  if (!analysisRaw.trim()) throw new Error('analysis 必须是非空字符串。');
  return { analysis: analysisRaw, patch, patchSlice, skippedOpCount };
}

/**
 * patch 数组整体非法时，按对象括号逐条解析；
 * 括号不配或单条 JSON 坏掉则跳到下一条 `"op"`，保留其余有效操作。
 */
export function tryParsePatchArrayLenient(patchArrayText: string): unknown[] {
  return parseJsonPatchArrayLenient(patchArrayText).ops;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function bodyParamsHasResponseFormat(bodyParams: string): boolean {
  return /response_format\s*:/.test(String(bodyParams || ''));
}

const JSON_OBJECT_BODY_SNIPPET = `response_format:
  type: json_object`;

/** 结构化任务：preset 无 response_format 时自动注入 json_object */
export function enrichApiConfigForStructuredTask(
  apiConfig: ApiConfig,
  mode: ActiveStructuredOutputMode,
): ApiConfig {
  const next = structuredClone(apiConfig);
  if (!bodyParamsHasResponseFormat(next.bodyParams)) {
    const trimmed = next.bodyParams.trim();
    next.bodyParams = trimmed ? `${trimmed}\n${JSON_OBJECT_BODY_SNIPPET}` : JSON_OBJECT_BODY_SNIPPET;
  }
  if (next.customPromptPostProcessing !== 'strict') {
    next.customPromptPostProcessing = 'strict';
  }
  if (!next.excludeBodyParams.trim()) {
    next.excludeBodyParams = 'top_p, reasoning_effort';
  }
  void mode;
  return next;
}

export function buildStrictJsonPromptSuffix(_mode: ActiveStructuredOutputMode): string {
  return `[严格 JSON 输出]
你必须仅输出一个合法的 JSON 对象（不要使用 markdown 代码围栏，不要添加任何自然语言前缀或后缀）。本提示已包含 json 关键字以满足模型约束。

根对象结构：
{"analysis":"英文分析，不超过 80 词","patch":[...]}

其中 patch 必须是 JSON Patch (RFC 6902) 操作数组。禁止输出 XML、HTML 或 <JSONPatch>/<AddonJSONPatch> 标签。`;
}

/** @deprecated 结构化输出格式由提示词段承担，运行时不再向最后一条消息追加后缀。 */
export function appendStrictJsonPromptToMessages<T extends { role: string; content: string; name?: string }>(
  messages: T[],
  _mode: ActiveStructuredOutputMode,
): T[] {
  return messages.map(m => ({ ...m }));
}

export interface StrictVariableExtractionResult {
  ok: boolean;
  normalizedXml?: string;
  error?: string;
  retryHint?: string;
  /** 严格 JSON.parse 失败后，经键位切割恢复 */
  recovered?: boolean;
  /** MVU 路径：lenient 时跳过的坏 op 数；Addon 路径由 addon-mvu 报错 */
  skippedOpCount?: number;
}

function normalizePatchArray(patch: unknown): string {
  if (!Array.isArray(patch)) throw new Error('patch 必须是数组。');
  return JSON.stringify(patch, null, 2);
}

function buildNormalizedVariableXml(mode: ActiveStructuredOutputMode, analysis: string, patchJson: string): string {
  const patchTag = mode === 'mvu_json_patch' ? 'JSONPatch' : 'AddonJSONPatch';
  return `<UpdateVariable>
<Analysis>${analysis.trim()}</Analysis>
<${patchTag}>
${patchJson}
</${patchTag}>
</UpdateVariable>`;
}

function buildFromAnalysisAndPatch(
  mode: ActiveStructuredOutputMode,
  analysis: unknown,
  patch: unknown,
  recovered?: boolean,
  skippedOpCount?: number,
): StrictVariableExtractionResult {
  if (typeof analysis !== 'string' || !analysis.trim()) {
    throw new Error('analysis 必须是非空字符串。');
  }
  const patchJson = normalizePatchArray(patch);
  const normalizedXml = buildNormalizedVariableXml(mode, analysis, patchJson);
  return { ok: true, normalizedXml, recovered, skippedOpCount };
}

export function extractStrictVariableResponse(
  text: string,
  mode: ActiveStructuredOutputMode,
): StrictVariableExtractionResult {
  try {
    const parsed = tryParseJsonObject(text);
    if (!isPlainObject(parsed)) throw new Error('回复 JSON 根节点必须是对象。');
    return buildFromAnalysisAndPatch(mode, parsed.analysis, parsed.patch);
  } catch (strictError) {
    try {
      const lenient = tryParseStrictVariableObjectLenient(text);
      if (mode === 'addon_json_patch') {
        // 原始 patch 文本交给 addon-mvu 统一修复/报错
        const normalizedXml = buildNormalizedVariableXml(mode, lenient.analysis, lenient.patchSlice);
        return {
          ok: true,
          normalizedXml,
          recovered: true,
          skippedOpCount: lenient.skippedOpCount,
        };
      }
      // MVU：只写入可解析 op，跳过数供工作流 toast
      return buildFromAnalysisAndPatch(
        mode,
        lenient.analysis,
        lenient.patch,
        true,
        lenient.skippedOpCount,
      );
    } catch {
      const message =
        strictError instanceof Error ? strictError.message : '严格 JSON 变量响应解析失败。';
      return { ok: false, error: message, retryHint: message };
    }
  }
}

export function hasCompleteVariableXml(text: string, mode: ActiveStructuredOutputMode): boolean {
  const tag = mode === 'mvu_json_patch' ? 'JSONPatch' : 'AddonJSONPatch';
  return hasXmlTagBlock(String(text || ''), tag);
}

export function apiConfigRequiresChatCompletionPath(apiConfig: ApiConfig): boolean {
  return (
    apiConfig.customPromptPostProcessing === 'strict' ||
    Boolean(apiConfig.bodyParams?.trim()) ||
    Boolean(apiConfig.excludeBodyParams?.trim())
  );
}

export const STRUCTURED_OUTPUT_MODE_HELP = {
  intro:
    'DeepSeek 等模型易输出 markdown/思维链导致 MVU/addon 变量 XML 提取失败。开启后通过「变量输出规则」提示词段约束 JSON 格式，解析 AI 纯 JSON 并归一化为 <UpdateVariable> 包裹的 <JSONPatch> 或 <AddonJSONPatch>，在阶段末写入楼层变量。',
  apiPreset:
    '建议 API 预设使用「DeepSeek 结构化输出」模板（response_format: json_object、custom_prompt_post_processing: strict）。任务开启本模式时若 preset 无 response_format 会自动注入 json_object。',
  modes: [
    { value: 'off', title: '关闭', desc: '沿用 XML 标签输出，不做 JSON 解析。' },
    {
      value: 'mvu_json_patch',
      title: 'MVU JSON Patch',
      desc: '要求 {"analysis":"...","patch":[...]}，归一化为 <UpdateVariable><Analysis><JSONPatch>。',
    },
    {
      value: 'addon_json_patch',
      title: 'Addon JSON Patch',
      desc: '要求 {"analysis":"...","patch":[...]}，归一化为 <UpdateVariable><Analysis><AddonJSONPatch>。',
    },
  ],
  retry: 'JSON 解析失败会计入最大重试次数；若 raw 已含完整 XML 内层标签则回退走现有提取。',
};
