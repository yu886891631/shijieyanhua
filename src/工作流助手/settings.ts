import { getActivePinia } from 'pinia';
import { getDefaultSettingsPartial } from './tasks/example-presets';
import { normalizeContextTagRules } from './tasks/context-tags';
import { migrateImportedPreset } from './tasks/import-preset-migrate';
import { ensureReplicaFamilyCleanupDefaults } from './tasks/replica-family-cleanup';
import { stripReplicaFamilyMembers } from './tasks/replica-family';
import {
  buildPresetFromSettings,
  detectSecretsInImportRaw,
  importedSettingsHadApiConfig,
} from './settings-security';
import {
  extractLegacySecretsFromRaw,
  extractSecretsFromSettings,
  legacySecretsPayloadHasData,
  loadApiSecretsPayload,
  mergeApiSecretsPayload,
  mergeSecretsIntoSettings,
  saveApiSecretsPayload,
  stripSecretsForPersistence,
} from './settings/api-secrets';
import { isChatOverrideActive, readChatTaskScope } from './tasks/chat-task-scope';
import { applyPresetFieldsToSettings } from './tasks/effective-settings';
import {
  PostProcessPresetSchema,
  ScriptSettingsSchema,
  type PostProcessPreset,
  type ScriptSettings,
} from './tasks/schema';

export type ImportPresetResult = {
  name: string;
  strippedApiSecrets: boolean;
};

function loadRawSettings(): Record<string, unknown> {
  try {
    return getVariables({ type: 'script', script_id: getScriptId() }) ?? {};
  } catch {
    return {};
  }
}

function migrateSettingsRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...raw };
  const legacyRules = merged.contextExcludeRules;
  const hasExtract = Array.isArray(merged.contextExtractRules) && merged.contextExtractRules.length > 0;

  if (!hasExtract && Array.isArray(legacyRules) && legacyRules.length > 0) {
    const isLegacy = legacyRules.some(
      r => r && typeof r === 'object' && 'tag' in r && !('start' in r),
    );
    if (isLegacy) {
      const extract: { start: string; end: string }[] = [];
      const exclude: { start: string; end: string }[] = [];
      for (const r of legacyRules) {
        if (!r || typeof r !== 'object' || !('tag' in r)) continue;
        const tag = String((r as { tag: string }).tag).replace(/[<>]/g, '');
        const rule = { start: `<${tag}>`, end: `</${tag}>` };
        if ((r as { mode?: string }).mode === 'extract') extract.push(rule);
        else exclude.push(rule);
      }
      merged.contextExtractRules = extract;
      merged.contextExcludeRules = exclude;
    }
  }

  merged.contextExtractRules = normalizeContextTagRules(merged.contextExtractRules);
  merged.contextExcludeRules = normalizeContextTagRules(merged.contextExcludeRules);

  delete merged.apiMode;
  delete merged.tavernProfile;

  if (merged.apiConfig && typeof merged.apiConfig === 'object') {
    const cfg = { ...(merged.apiConfig as Record<string, unknown>) };
    delete cfg.useMainApi;
    merged.apiConfig = cfg;
  }

  if (Array.isArray(merged.apiPresets)) {
    merged.apiPresets = merged.apiPresets.map(p => {
      if (!p || typeof p !== 'object') return p;
      const item = p as Record<string, unknown>;
      const rawCfg =
        typeof item.apiConfig === 'object' && item.apiConfig ? (item.apiConfig as Record<string, unknown>) : {};
      const { useMainApi: _omit, ...restCfg } = rawCfg;
      return {
        name: item.name,
        apiConfig: {
          ...restCfg,
          bodyParams: restCfg.bodyParams ?? '',
          excludeBodyParams: restCfg.excludeBodyParams ?? '',
          requestHeaders: restCfg.requestHeaders ?? '',
        },
      };
    });
  }

  if (!merged.defaultApiPresetName && typeof merged.defaultTaskApiPreset === 'string') {
    merged.defaultApiPresetName = merged.defaultTaskApiPreset;
  }

  const presets = merged.apiPresets;
  const apiConfig = merged.apiConfig;
  if (Array.isArray(presets) && presets.length === 0 && apiConfig && typeof apiConfig === 'object') {
    const cfg = apiConfig as Record<string, unknown>;
    const { useMainApi: _omit, ...restCfg } = cfg;
    if (String(restCfg.url || '').trim() || String(restCfg.model || '').trim()) {
      const name = '默认';
      merged.apiPresets = [{ name, apiConfig: restCfg }];
      merged.defaultApiPresetName = name;
      merged.activeApiPresetName = name;
      merged.defaultTaskApiPreset = name;
    }
  }

  return merged;
}

export function loadSettings(): ScriptSettings {
  const defaults = getDefaultSettingsPartial();
  try {
    const raw = loadRawSettings();
    const merged = migrateSettingsRaw({ ...defaults, ...raw });
    const legacySecrets = extractLegacySecretsFromRaw(merged);
    const hadLegacyInScriptVars = legacySecretsPayloadHasData(legacySecrets);
    const storedSecrets = loadApiSecretsPayload();
    const combinedSecrets = hadLegacyInScriptVars
      ? mergeApiSecretsPayload(storedSecrets, legacySecrets)
      : storedSecrets;

    const migrated = migrateImportedPreset(merged) as Record<string, unknown>;
    let settings = ScriptSettingsSchema.parse(migrated);
    ensureReplicaFamilyCleanupDefaults(settings);
    settings = mergeSecretsIntoSettings(settings, combinedSecrets);

    if (hadLegacyInScriptVars) {
      saveSettings(settings);
    }

    return settings;
  } catch (error) {
    console.error('[工作流助手] 设置解析失败，已回退默认配置:', error);
    return ScriptSettingsSchema.parse(defaults);
  }
}

export function saveSettings(settings: ScriptSettings): void {
  const secrets = extractSecretsFromSettings(settings);
  saveApiSecretsPayload(secrets);
  insertOrAssignVariables(stripSecretsForPersistence(settings), {
    type: 'script',
    script_id: getScriptId(),
  });
}

/**
 * 将脚本级字段从展示态拷到目标（不含任务预设展示字段）。
 * 有聊天快照时用于安全落盘，避免把 sync 叠写的 tasks 等污染全局。
 */
export function applyScriptLevelSettings(from: ScriptSettings, target: ScriptSettings): void {
  target.enabled = from.enabled;
  target.apiConfig = _.cloneDeep(from.apiConfig);
  target.apiPresets = _.cloneDeep(from.apiPresets);
  target.defaultApiPresetName = from.defaultApiPresetName;
  target.activeApiPresetName = from.activeApiPresetName;
  target.apiPresetBindingsByChat = _.cloneDeep(from.apiPresetBindingsByChat);
  target.defaultTaskApiPreset = from.defaultTaskApiPreset;
  target.taskApiPresetOverridesById = _.cloneDeep(from.taskApiPresetOverridesById);
  target.messageVarRetention = _.cloneDeep(from.messageVarRetention);
  target.replicaFamilyCleanup = _.cloneDeep(from.replicaFamilyCleanup);
  target.uiThemeId = from.uiThemeId;
  target.progressHudPosition = _.cloneDeep(from.progressHudPosition);
}

/** 有快照时：以磁盘全局为底，只合并脚本级字段后保存 */
export function saveScriptLevelSettingsFrom(display: ScriptSettings): void {
  const base = loadSettings();
  applyScriptLevelSettings(display, base);
  saveSettings(base);
}

/**
 * 合并脚本级字段并写回 presets[]（可选同步活动预设顶层真源）。
 * 用于有快照时导入/删除任务预设，避免 script-level persist 丢槽。
 */
export function savePresetsCatalogToDisk(
  display: ScriptSettings,
  options?: {
    activePresetName?: string;
    rehydrateWorkingCopyFromActive?: boolean;
  },
): ScriptSettings {
  const base = loadSettings();
  applyScriptLevelSettings(display, base);
  base.presets = _.cloneDeep(display.presets);
  if (options?.activePresetName !== undefined) {
    base.activePresetName = options.activePresetName.trim();
  }
  if (options?.rehydrateWorkingCopyFromActive) {
    const activeName = base.activePresetName.trim();
    const preset = activeName ? base.presets.find(p => p.name === activeName) : undefined;
    if (preset) {
      const cleanedTasks = stripReplicaFamilyMembers(_.cloneDeep(preset.tasks));
      const cleanedPreset = { ...preset, tasks: cleanedTasks };
      const idx = base.presets.findIndex(p => p.name === activeName);
      if (idx >= 0) base.presets[idx] = cleanedPreset;
      applyPresetFieldsToSettings(base, cleanedPreset);
      ensureReplicaFamilyCleanupDefaults(base);
    }
  }
  saveSettings(base);
  return base;
}

export const useSettingsStore = defineStore('ai-post-process-settings', () => {
  const settings = ref<ScriptSettings>(loadSettings());

  function persist() {
    if (isChatOverrideActive(readChatTaskScope())) {
      saveScriptLevelSettingsFrom(settings.value);
      return;
    }
    saveSettings(settings.value);
  }

  function reload() {
    settings.value = loadSettings();
  }

  function buildPresetFromCurrent(name: string): PostProcessPreset {
    return buildPresetFromSettings(settings.value, name);
  }

  function saveActivePreset(): boolean {
    if (isChatOverrideActive(readChatTaskScope())) return false;
    const name = settings.value.activePresetName.trim();
    if (!name) return false;
    const preset = buildPresetFromCurrent(name);
    const idx = settings.value.presets.findIndex(p => p.name === name);
    if (idx >= 0) settings.value.presets[idx] = preset;
    else settings.value.presets.push(preset);
    persist();
    return true;
  }

  function saveAsNewPreset(newName: string): string | null {
    const name = newName.trim();
    if (!name) return null;
    if (settings.value.presets.some(p => p.name === name)) return null;
    return addOrUpdatePreset(buildPresetFromCurrent(name));
  }

  function applyPreset(presetName: string) {
    const preset = settings.value.presets.find(p => p.name === presetName);
    if (!preset) return;
    const cleanedTasks = stripReplicaFamilyMembers(_.cloneDeep(preset.tasks));
    if (cleanedTasks.length !== preset.tasks.length) {
      const idx = settings.value.presets.findIndex(p => p.name === presetName);
      if (idx >= 0) {
        settings.value.presets[idx] = { ...preset, tasks: cleanedTasks };
      }
    }
    settings.value.activePresetName = presetName;
    settings.value.tasks = cleanedTasks;
    settings.value.finalInjectTemplate = preset.finalInjectTemplate;
    settings.value.userInputEndInjectTemplate = preset.userInputEndInjectTemplate ?? '';
    settings.value.tagVariableInjectTemplate = preset.tagVariableInjectTemplate;
    settings.value.chatExtractTags = _.cloneDeep(preset.chatExtractTags ?? { user: [], assistant: [] });
    settings.value.chatBodyTagReplaceRules = _.cloneDeep(preset.chatBodyTagReplaceRules ?? []);
    settings.value.chatWorldbookWriteRules = _.cloneDeep(preset.chatWorldbookWriteRules ?? []);
    settings.value.contextTurnCount = preset.contextTurnCount;
    settings.value.contextExtractRules = _.cloneDeep(preset.contextExtractRules);
    settings.value.contextExcludeRules = _.cloneDeep(preset.contextExcludeRules);
    settings.value.plotWorldbookConfig = _.cloneDeep(preset.plotWorldbookConfig);
    settings.value.taskPlotWorldbookOverridesEnabled = preset.taskPlotWorldbookOverridesEnabled ?? false;
    settings.value.taskContextOverridesEnabled = preset.taskContextOverridesEnabled ?? false;
    settings.value.memoryRecallRecentCount = preset.memoryRecallRecentCount ?? 10;
    ensureReplicaFamilyCleanupDefaults(settings.value);
    persist();
  }

  function addOrUpdatePreset(preset: PostProcessPreset): string {
    const name = upsertPresetWithoutApply(preset);
    applyPreset(name);
    return name;
  }

  /** 只写入/更新 presets[]，不改 activePresetName / 顶层工作副本（有聊天快照时导入用） */
  function upsertPresetWithoutApply(preset: PostProcessPreset): string {
    const cloned = _.cloneDeep(preset);
    const name = cloned.name.trim();
    if (!name) throw new Error('预设名称不能为空');
    cloned.name = name;
    const idx = settings.value.presets.findIndex(p => p.name === name);
    if (idx >= 0) settings.value.presets[idx] = cloned;
    else settings.value.presets.push(cloned);
    savePresetsCatalogToDisk(settings.value);
    return name;
  }

  function deleteTaskPreset(name: string): boolean {
    if (settings.value.presets.length <= 1) return false;
    const idx = settings.value.presets.findIndex(p => p.name === name);
    if (idx < 0) return false;
    settings.value.presets.splice(idx, 1);
    const override = isChatOverrideActive(readChatTaskScope());
    if (settings.value.activePresetName === name) {
      const next = settings.value.presets[0]?.name;
      if (!next) return false;
      if (override) {
        savePresetsCatalogToDisk(settings.value, {
          activePresetName: next,
          rehydrateWorkingCopyFromActive: true,
        });
        settings.value.activePresetName = next;
      } else {
        applyPreset(next);
      }
    } else if (override) {
      savePresetsCatalogToDisk(settings.value);
    } else {
      persist();
    }
    return true;
  }

  function presetNameFromFileName(fileName?: string): string {
    const base = fileName?.replace(/\.json$/i, '').trim();
    return base || `导入预设-${new Date().toLocaleString('zh-CN')}`;
  }

  function parseImportedPreset(raw: unknown, fileName?: string): {
    preset: PostProcessPreset;
    strippedApiSecrets: boolean;
  } {
    const migrated = migrateImportedPreset(raw);
    const presetOnly = PostProcessPresetSchema.safeParse(migrated);
    if (presetOnly.success) {
      return { preset: presetOnly.data, strippedApiSecrets: false };
    }

    const fullSettings = ScriptSettingsSchema.safeParse(migrated);
    if (fullSettings.success) {
      const s = fullSettings.data;
      const name = s.activePresetName || presetNameFromFileName(fileName);
      const preset: PostProcessPreset = {
        name,
        tasks: s.tasks,
        finalInjectTemplate: s.finalInjectTemplate,
        userInputEndInjectTemplate: s.userInputEndInjectTemplate ?? '',
        tagVariableInjectTemplate: s.tagVariableInjectTemplate,
        chatExtractTags: _.cloneDeep(s.chatExtractTags ?? { user: [], assistant: [] }),
        chatBodyTagReplaceRules: _.cloneDeep(s.chatBodyTagReplaceRules ?? []),
        chatWorldbookWriteRules: _.cloneDeep(s.chatWorldbookWriteRules ?? []),
        contextTurnCount: s.contextTurnCount,
        contextExtractRules: s.contextExtractRules,
        contextExcludeRules: s.contextExcludeRules,
        plotWorldbookConfig: s.plotWorldbookConfig,
        taskPlotWorldbookOverridesEnabled: s.taskPlotWorldbookOverridesEnabled ?? false,
        taskContextOverridesEnabled: s.taskContextOverridesEnabled ?? false,
        memoryRecallRecentCount: s.memoryRecallRecentCount ?? 10,
      };
      const hadApiInFile = importedSettingsHadApiConfig(s) || detectSecretsInImportRaw(raw);
      return { preset, strippedApiSecrets: hadApiInFile };
    }

    throw new Error('无法识别的预设 JSON 格式（需为预设对象或完整设置导出文件）');
  }

  function importPresetFromJson(
    raw: unknown,
    fileName?: string,
    options?: { apply?: boolean },
  ): ImportPresetResult {
    const { preset, strippedApiSecrets } = parseImportedPreset(raw, fileName);
    const apply = options?.apply !== false;
    const name = apply ? addOrUpdatePreset(preset) : upsertPresetWithoutApply(preset);
    return { name, strippedApiSecrets };
  }

  watchEffect(() => {
    try {
      // 有聊天快照时 settings.value 常被用作展示缓冲：只落盘脚本级字段
      if (isChatOverrideActive(readChatTaskScope())) {
        saveScriptLevelSettingsFrom(settings.value);
        return;
      }
      saveSettings(settings.value);
    } catch (error) {
      console.error('[工作流助手] 自动保存设置失败:', error);
    }
  });

  return {
    settings,
    persist,
    reload,
    applyPreset,
    importPresetFromJson,
    upsertPresetWithoutApply,
    saveActivePreset,
    saveAsNewPreset,
    deleteTaskPreset,
  };
});

/** 进度 HUD 位置：脚本变量落盘，并同步已挂载的 Pinia store，避免设置窗 persist 冲掉 */
export function saveProgressHudPosition(
  ratio: NonNullable<ScriptSettings['progressHudPosition']> | null,
): void {
  const next = ratio == null ? null : _.cloneDeep(ratio);
  const settings = loadSettings();
  settings.progressHudPosition = next;
  saveSettings(settings);
  try {
    if (!getActivePinia()) return;
    useSettingsStore().settings.progressHudPosition =
      next == null ? null : _.cloneDeep(next);
  } catch {
    /* Pinia 未就绪时仅磁盘已更新 */
  }
}