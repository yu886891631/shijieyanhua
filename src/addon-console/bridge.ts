/** 与 addon-mvu AddonEvent 对齐 */
export type AddonConsoleEvents = {
  VARIABLE_UPDATE_STARTED: string;
  PATCH_PARSED: string;
  VARIABLE_UPDATE_ENDED: string;
  PATCH_LOG_UPDATED: string;
};

export type AddonPatchLogEntry = {
  messageId?: number;
  timestamp: number;
  ops: unknown[];
  issues: Array<{ kind: 'parse' | 'apply' | 'heal'; message: string; op?: unknown }>;
  failedFragments: Array<{ index: number; snippet: string; message: string }>;
  manualFixedOps?: unknown[];
  changed: boolean;
};

export type AddonConsoleApi = {
  events: AddonConsoleEvents;
  getAddonData: (options: { type: 'message'; message_id: number | 'latest' }) => { addon_data: Record<string, any> };
  getUiState: (options?: { type: 'message'; message_id: number | 'latest' }) => {
    位面交汇: boolean;
    theme?: 'light' | 'dark';
  };
  setTheme: (theme: 'light' | 'dark', options?: { type: 'message'; message_id: number | 'latest' }) => unknown;
  setPlaneMerge: (value: boolean, options?: { type: 'message'; message_id: number | 'latest' }) => unknown;
  setWorldDescent: (
    world: string,
    value: boolean,
    options?: { type: 'message'; message_id: number | 'latest' },
  ) => Promise<{ data: Record<string, any>; warnings?: string[] }>;
  setWorldParallel: (
    world: string,
    value: boolean,
    options?: { type: 'message'; message_id: number | 'latest' },
  ) => Promise<{ data: Record<string, any>; warnings?: string[] }>;
  createWorld: (
    name: string,
    options?: { type: 'message'; message_id: number | 'latest' },
  ) => Promise<{ data: Record<string, any>; warnings?: string[] }>;
  renameWorld: (
    oldName: string,
    newName: string,
    options?: { type: 'message'; message_id: number | 'latest' },
  ) => Promise<{ data: Record<string, any>; warnings?: string[] }>;
  deleteWorld: (
    name: string,
    options?: { type: 'message'; message_id: number | 'latest' },
  ) => Promise<{ data: Record<string, any>; warnings?: string[] }>;
  setSingularityDescent: (
    world: string,
    name: string,
    value: boolean,
    options?: { type: 'message'; message_id: number | 'latest' },
  ) => Promise<{ data: Record<string, any>; warnings?: string[] }>;
  getLastPatchLog?: () => AddonPatchLogEntry | null;
  clearPatchLog?: () => void;
  applyManualPatchOps?: (
    ops: unknown[],
    options?: {
      type: 'message';
      message_id: number | 'latest';
      fragmentIndexes?: number[];
    },
  ) => Promise<{
    data: Record<string, any>;
    changed: boolean;
    ops: unknown[];
    issues: AddonPatchLogEntry['issues'];
    failedFragments: AddonPatchLogEntry['failedFragments'];
  }>;
  processFloor?: (message_id?: number | 'latest') => Promise<void>;
};

function parentAddon(): AddonConsoleApi | undefined {
  try {
    return _.get(window.parent, 'Addon') as AddonConsoleApi | undefined;
  } catch {
    return undefined;
  }
}

function localAddon(): AddonConsoleApi | undefined {
  try {
    return _.get(window, 'Addon') as AddonConsoleApi | undefined;
  } catch {
    return undefined;
  }
}

/** 等待 Addon 全局 API（本页或父页） */
export async function waitAddon(timeoutMs = 15000): Promise<AddonConsoleApi> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (typeof waitGlobalInitialized === 'function') {
        const api = (await Promise.race([
          waitGlobalInitialized('Addon'),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 200)),
        ])) as AddonConsoleApi | null;
        if (api) return api;
      }
    } catch {
      /* ignore */
    }
    const fromParent = parentAddon();
    if (fromParent?.getAddonData) return fromParent;
    const local = localAddon();
    if (local?.getAddonData) return local;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Addon API 未就绪，请确认 addon-mvu 脚本已加载');
}

export function latestOpts() {
  return { type: 'message' as const, message_id: 'latest' as const };
}
