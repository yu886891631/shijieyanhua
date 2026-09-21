import type { NormalizedPromptRole } from './prompt-role';

export type TavernRegexSource =
  | 'user_input'
  | 'ai_output'
  | 'slash_command'
  | 'world_info'
  | 'reasoning';

export type ApplyTavernPromptMacrosOptions = {
  role?: NormalizedPromptRole;
  /** 显式指定时优先于 role 映射（如世界书条目） */
  source?: TavernRegexSource;
};

/**
 * 酒馆助手「禁用酒馆助手宏」对应 settings.macro.enabled === false。
 * 路径：extensionSettings.tavern_helper.macro.enabled（兼容旧键 TavernHelper）
 */
export function isTavernHelperMacroEnabled(): boolean {
  try {
    const host =
      typeof window !== 'undefined' && window.parent && window.parent !== window ? window.parent : window;
    const ctx = (
      host as Window & {
        SillyTavern?: { getContext?: () => { extensionSettings?: Record<string, unknown> } };
      }
    ).SillyTavern?.getContext?.();
    const root = ctx?.extensionSettings;
    if (!root || typeof root !== 'object') return true;

    const modern = root.tavern_helper as { macro?: { enabled?: boolean } } | undefined;
    if (modern && typeof modern === 'object' && modern.macro && typeof modern.macro.enabled === 'boolean') {
      return modern.macro.enabled;
    }

    const legacy = root.TavernHelper as { macro?: { enabled?: boolean } } | undefined;
    if (legacy && typeof legacy === 'object' && legacy.macro && typeof legacy.macro.enabled === 'boolean') {
      return legacy.macro.enabled;
    }

    return true;
  } catch {
    return true;
  }
}

export function resolveFormatSource(options?: ApplyTavernPromptMacrosOptions): TavernRegexSource {
  if (options?.source) return options.source;
  switch (options?.role) {
    case 'user':
      return 'user_input';
    case 'assistant':
      return 'ai_output';
    case 'system':
    default:
      return 'slash_command';
  }
}

function applySubstitudeMacrosOnly(text: string): string {
  try {
    return substitudeMacros(text);
  } catch (error) {
    console.warn('[工作流助手] substitudeMacros 失败:', error);
    return text;
  }
}

/**
 * 通过酒馆助手公开 API 展开提示词中的宏。
 *
 * - 禁用助手宏时：仅 `substitudeMacros`（对齐 demacroOnPrompt 关闭行为）
 * - 启用时：`formatAsTavernRegexedString`（正则 + ST 宏 + 全部 MacroLike）
 *
 * @see https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/功能详情/酒馆助手宏.html
 */
export function applyTavernPromptMacros(
  text: string,
  messageId: number,
  options?: ApplyTavernPromptMacrosOptions,
): string {
  if (!text?.trim()) return text ?? '';

  if (!isTavernHelperMacroEnabled()) {
    return applySubstitudeMacrosOnly(text);
  }

  const source = resolveFormatSource(options);
  try {
    const lastId = getLastMessageId();
    const depth = Number.isFinite(lastId) ? Math.max(0, lastId - messageId) : undefined;
    return formatAsTavernRegexedString(text, source, 'prompt', {
      ...(depth !== undefined ? { depth } : {}),
    });
  } catch (error) {
    console.warn('[工作流助手] formatAsTavernRegexedString 失败，回退 substitudeMacros:', error);
    return applySubstitudeMacrosOnly(text);
  }
}
