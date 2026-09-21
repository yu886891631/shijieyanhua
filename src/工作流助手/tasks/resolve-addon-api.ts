/**
 * 同步探测 Addon API（本页或父页），禁止 waitGlobalInitialized('Addon')。
 * addon-mvu 会 initializeGlobal 并 exposeAddonOnParent；工作流助手未必已注入本页全局。
 */

export type ResolvedAddonApi = {
  getAddonData: (options: {
    type: 'message';
    message_id: number | 'latest';
  }) => { addon_data: Addon.AddonData };
  replaceAddonData: (
    data: { addon_data: Addon.AddonData },
    options: { type: 'message'; message_id: number | 'latest' },
  ) => void;
  applyAddonUpdateFromMessage: (message: string, messageId: number) => Promise<unknown> | unknown;
  clearPatchLog?: () => void;
};

export function isAddonApiShape(value: unknown): value is ResolvedAddonApi {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.getAddonData === 'function' &&
    typeof v.replaceAddonData === 'function' &&
    typeof v.applyAddonUpdateFromMessage === 'function'
  );
}

/** 纯函数：便于单测本页 / 父页优先级 */
export function resolveAddonApiFromScopes(
  local: unknown,
  parent: unknown,
): ResolvedAddonApi | null {
  if (isAddonApiShape(local)) return local;
  if (isAddonApiShape(parent)) return parent;
  return null;
}

export function resolveAddonApi(): ResolvedAddonApi | null {
  const local = typeof Addon !== 'undefined' ? Addon : undefined;
  let parent: unknown;
  try {
    if (typeof window !== 'undefined') {
      parent = (window.parent as Window & { Addon?: unknown }).Addon;
    }
  } catch {
    parent = undefined;
  }
  return resolveAddonApiFromScopes(local, parent);
}

/** 供 clearAddonPatchLog 与单测共用：无 API 时立即 no-op */
export function invokeClearAddonPatchLog(api: ResolvedAddonApi | null): boolean {
  if (!api) return false;
  api.clearPatchLog?.();
  return true;
}
