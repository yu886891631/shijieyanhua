import type { ApiPresetDraft } from './api-preset-utils';

export const DEEPSEEK_STRUCTURED_BODY_PARAMS_BASE = `response_format:
  type: json_object`;

export const DEEPSEEK_STRUCTURED_EXCLUDE_BODY_PARAMS = 'top_p, reasoning_effort';

export const DEEPSEEK_STRUCTURED_HELP_LINES = [
  '开启「严格 JSON 变量响应」时写入 response_format: json_object，并启用 custom_prompt_post_processing: strict、排除 top_p / reasoning_effort。',
  '关闭严格 JSON 时仅从附加主体参数移除 response_format，保留 thinking；Prompt 后处理与排除参数不变。',
  '开启 COT 后改为 thinking: enabled，并设置 include_reasoning: true。',
];

export type ThinkingMode = 'disabled' | 'enabled';

export type DeepSeekDraftSnapshot = Pick<
  ApiPresetDraft,
  'bodyParams' | 'excludeBodyParams' | 'customPromptPostProcessing' | 'includeReasoning' | 'reasoningEffort'
>;

export function snapshotDeepSeekDraftFields(draft: ApiPresetDraft): DeepSeekDraftSnapshot {
  return {
    bodyParams: draft.bodyParams,
    excludeBodyParams: draft.excludeBodyParams,
    customPromptPostProcessing: draft.customPromptPostProcessing,
    includeReasoning: draft.includeReasoning,
    reasoningEffort: draft.reasoningEffort,
  };
}

export function restoreDeepSeekDraftSnapshot(draft: ApiPresetDraft, snapshot: DeepSeekDraftSnapshot): void {
  draft.bodyParams = snapshot.bodyParams;
  draft.excludeBodyParams = snapshot.excludeBodyParams;
  draft.customPromptPostProcessing = snapshot.customPromptPostProcessing;
  draft.includeReasoning = snapshot.includeReasoning;
  draft.reasoningEffort = snapshot.reasoningEffort;
}

export function buildDeepSeekBodyParams(cotEnabled: boolean, strictJson = true): string {
  const thinkingType: ThinkingMode = cotEnabled ? 'enabled' : 'disabled';
  const thinkingBlock = `thinking:\n  type: ${thinkingType}`;
  if (!strictJson) return thinkingBlock;
  return `${DEEPSEEK_STRUCTURED_BODY_PARAMS_BASE}\n\n${thinkingBlock}`;
}

export function isDeepSeekStructuredBodyParams(bodyParams: string): boolean {
  return /response_format\s*:[\s\S]*json_object/i.test(String(bodyParams || ''));
}

export function readThinkingMode(bodyParams: string): ThinkingMode | null {
  const match = String(bodyParams || '').match(/thinking\s*:\s*\n\s*type\s*:\s*(enabled|disabled)/i);
  if (!match?.[1]) return null;
  return match[1].toLowerCase() as ThinkingMode;
}

export function applyThinkingModeToBodyParams(bodyParams: string, mode: ThinkingMode): string {
  const thinkingBlock = `thinking:\n  type: ${mode}`;
  const source = String(bodyParams || '').trim();
  if (/thinking\s*:\s*\n\s*type\s*:\s*(enabled|disabled)/i.test(source)) {
    return source.replace(/thinking\s*:\s*\n\s*type\s*:\s*(enabled|disabled)/i, thinkingBlock);
  }
  if (!source) return thinkingBlock;
  return `${source}\n\n${thinkingBlock}`;
}

export function applyThinkingModeToDraft(draft: ApiPresetDraft, mode: ThinkingMode): void {
  draft.bodyParams = applyThinkingModeToBodyParams(draft.bodyParams, mode);
  draft.includeReasoning = mode === 'enabled';
}

/** 切换是否写入 response_format: json_object；开启时一并写入 strict 后处理与排除参数 */
export function applyStrictJsonToDraft(
  draft: ApiPresetDraft,
  strictJson: boolean,
  cotEnabled: boolean,
): void {
  draft.bodyParams = buildDeepSeekBodyParams(cotEnabled, strictJson);
  if (strictJson) {
    draft.excludeBodyParams = DEEPSEEK_STRUCTURED_EXCLUDE_BODY_PARAMS;
    draft.customPromptPostProcessing = 'strict';
  }
  draft.includeReasoning = cotEnabled;
  draft.reasoningEffort = 'medium';
}

/** 一键写入 DeepSeek 推荐参数（默认含严格 JSON + thinking disabled） */
export function applyDeepSeekStructuredTemplate(
  draft: ApiPresetDraft,
  options?: { cotEnabled?: boolean; strictJson?: boolean },
): void {
  const cotEnabled = options?.cotEnabled ?? false;
  const strictJson = options?.strictJson !== false;
  applyStrictJsonToDraft(draft, strictJson, cotEnabled);
}

export const DEEPSEEK_STRUCTURED_TEMPLATE_HINT =
  'DeepSeek 预设：已应用 thinking disabled；严格 JSON 与 COT 可在下方开关调整。';
