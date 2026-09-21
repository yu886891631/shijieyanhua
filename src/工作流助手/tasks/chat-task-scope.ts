import {
  CHAT_SCOPE_METADATA_KEY,
  CHAT_SNAPSHOT_PRESET_NAME,
  ChatTaskScopeStateSchema,
  PostProcessPresetSchema,
  type ChatTaskScopeState,
  type PostProcessPreset,
  type ScriptSettings,
} from './schema';

type SillyTavernContext = {
  chatMetadata: Record<string, unknown>;
  updateChatMetadata: (new_values: Record<string, unknown>, reset: boolean) => void;
  saveChat: () => Promise<void>;
};

export function getStContext(): SillyTavernContext | null {
  try {
    const ctx = (
      window.parent as Window & { SillyTavern?: { getContext?: () => SillyTavernContext } }
    ).SillyTavern?.getContext?.();
    return ctx ?? null;
  } catch {
    return null;
  }
}

export function buildChatSnapshotFromSettings(settings: ScriptSettings): PostProcessPreset {
  return PostProcessPresetSchema.parse({
    name: CHAT_SNAPSHOT_PRESET_NAME,
    tasks: _.cloneDeep(settings.tasks),
    finalInjectTemplate: settings.finalInjectTemplate,
    userInputEndInjectTemplate: settings.userInputEndInjectTemplate ?? '',
    tagVariableInjectTemplate: settings.tagVariableInjectTemplate,
    chatExtractTags: _.cloneDeep(settings.chatExtractTags ?? { user: [], assistant: [] }),
    chatBodyTagReplaceRules: _.cloneDeep(settings.chatBodyTagReplaceRules ?? []),
    chatWorldbookWriteRules: _.cloneDeep(settings.chatWorldbookWriteRules ?? []),
    contextTurnCount: settings.contextTurnCount,
    contextExtractRules: _.cloneDeep(settings.contextExtractRules),
    contextExcludeRules: _.cloneDeep(settings.contextExcludeRules),
    plotWorldbookConfig: _.cloneDeep(settings.plotWorldbookConfig),
    taskPlotWorldbookOverridesEnabled: settings.taskPlotWorldbookOverridesEnabled ?? false,
    taskContextOverridesEnabled: settings.taskContextOverridesEnabled ?? false,
    memoryRecallRecentCount: settings.memoryRecallRecentCount ?? 10,
  });
}

export function isChatOverrideActive(scope?: ChatTaskScopeState | null): boolean {
  return scope?.mode === 'chat_override' && !!scope.snapshot;
}

export function hasChatSnapshot(scope?: ChatTaskScopeState | null): boolean {
  return isChatOverrideActive(scope);
}

/** 下拉当前选中值：有快照时为哨兵或绑定的全局预设名 */
export function getChatScopeDropdownValue(scope?: ChatTaskScopeState | null): string {
  const s = scope === undefined ? readChatTaskScope() : scope;
  if (!hasChatSnapshot(s) || !s) return '';
  if (s.activeView === 'global' && s.boundGlobalPresetName.trim()) {
    return s.boundGlobalPresetName.trim();
  }
  return CHAT_SNAPSHOT_PRESET_NAME;
}

export function readChatTaskScope(): ChatTaskScopeState | null {
  const ctx = getStContext();
  if (!ctx) return null;
  const raw = ctx.chatMetadata?.[CHAT_SCOPE_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const parsed = ChatTaskScopeStateSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (!isChatOverrideActive(parsed.data)) return null;
  return parsed.data;
}

async function persistChatMetadata(scope: ChatTaskScopeState | null): Promise<void> {
  const ctx = getStContext();
  if (!ctx) return;
  if (scope && isChatOverrideActive(scope)) {
    ctx.updateChatMetadata({ [CHAT_SCOPE_METADATA_KEY]: _.cloneDeep(scope) }, false);
  } else {
    const next = { ...ctx.chatMetadata };
    delete next[CHAT_SCOPE_METADATA_KEY];
    ctx.updateChatMetadata(next, true);
  }
  try {
    await ctx.saveChat();
  } catch (error) {
    console.warn('[工作流助手] 保存聊天快照到 chat 文件失败:', error);
  }
}

export async function writeChatTaskScope(
  state: ChatTaskScopeState,
  options?: { skipSave?: boolean },
): Promise<ChatTaskScopeState | null> {
  const normalized = ChatTaskScopeStateSchema.parse(state);
  if (!isChatOverrideActive(normalized)) {
    await clearChatTaskScope({ skipSave: options?.skipSave });
    return null;
  }
  if (!options?.skipSave) {
    await persistChatMetadata(normalized);
  } else {
    const ctx = getStContext();
    ctx?.updateChatMetadata({ [CHAT_SCOPE_METADATA_KEY]: _.cloneDeep(normalized) }, false);
  }
  return normalized;
}

export async function clearChatTaskScope(options?: { skipSave?: boolean }): Promise<void> {
  if (!options?.skipSave) {
    await persistChatMetadata(null);
  } else {
    const ctx = getStContext();
    if (ctx) {
      const next = { ...ctx.chatMetadata };
      delete next[CHAT_SCOPE_METADATA_KEY];
      ctx.updateChatMetadata(next, true);
    }
  }
}

export async function ensureChatOverride(
  settings: ScriptSettings,
  source: 'api' | 'ui',
): Promise<{ scope: ChatTaskScopeState; created: boolean }> {
  const existing = readChatTaskScope();
  if (existing?.snapshot) {
    return { scope: existing, created: false };
  }
  const snapshot = buildChatSnapshotFromSettings(settings);
  const state = ChatTaskScopeStateSchema.parse({
    mode: 'chat_override',
    snapshot,
    originPresetName: settings.activePresetName || '',
    updatedAt: Date.now(),
    source,
    activeView: 'snapshot',
    boundGlobalPresetName: '',
  });
  await writeChatTaskScope(state);
  return { scope: state, created: true };
}

/**
 * 切换本聊天下拉视图：不清快照、不改全局 settings。
 * presets 用于校验全局预设是否存在。
 */
export async function setChatScopeActiveView(
  input: { view: 'snapshot' } | { view: 'global'; presetName: string },
  presets: Array<{ name: string }>,
): Promise<ChatTaskScopeState | null> {
  const scope = readChatTaskScope();
  if (!scope?.snapshot) return null;

  if (input.view === 'snapshot') {
    return writeChatTaskScope({
      ...scope,
      activeView: 'snapshot',
      boundGlobalPresetName: '',
      updatedAt: Date.now(),
    });
  }

  const name = input.presetName.trim();
  if (!name || name === CHAT_SNAPSHOT_PRESET_NAME) return null;
  if (!presets.some(p => p.name === name)) return null;

  return writeChatTaskScope({
    ...scope,
    activeView: 'global',
    boundGlobalPresetName: name,
    updatedAt: Date.now(),
  });
}

/** 绑定的全局预设已删除时，纠正为 snapshot 视图 */
export async function repairChatScopeBoundPreset(
  presets: Array<{ name: string }>,
): Promise<ChatTaskScopeState | null> {
  const scope = readChatTaskScope();
  if (!scope?.snapshot) return null;
  if (scope.activeView !== 'global') return scope;
  const name = scope.boundGlobalPresetName.trim();
  if (name && presets.some(p => p.name === name)) return scope;
  return writeChatTaskScope({
    ...scope,
    activeView: 'snapshot',
    boundGlobalPresetName: '',
    updatedAt: Date.now(),
  });
}
