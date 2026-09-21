import type {
  ApiConfig,
  ChatWorldbookWriteRule,
  PlotWorldbookConfig,
  PostProcessPreset,
  PostProcessTask,
  ScriptSettings,
  TaskWorkflowPresetSnapshot,
} from './tasks/schema';
import { stripReplicaFamilyMembers } from './tasks/replica-family';

export function redactRequestHeaders(headers: string): string {
  return String(headers || '')
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      const lower = trimmed.toLowerCase();
      return !lower.startsWith('authorization:') && !lower.includes('bearer ');
    })
    .join('\n');
}

export function redactApiConfig(cfg: ApiConfig): ApiConfig {
  return {
    ...cfg,
    apiKey: '',
    requestHeaders: redactRequestHeaders(cfg.requestHeaders || ''),
  };
}

/** 分享导出：本机世界书名对他人不可用，重置为角色卡绑定 */
export function emptyPlotWorldbookConfigForShare(): PlotWorldbookConfig {
  return { source: 'character', manualSelection: [], enabledEntries: {} };
}

export function sanitizePlotWorldbookConfigForShare(_config: PlotWorldbookConfig): PlotWorldbookConfig {
  return emptyPlotWorldbookConfigForShare();
}

export function sanitizeChatWorldbookWriteRulesForShare(
  rules: ChatWorldbookWriteRule[],
): ChatWorldbookWriteRule[] {
  return rules.map(rule => ({
    ...rule,
    bookSource: 'character' as const,
    manualBookName: '',
  }));
}

function sanitizeTaskWorkflowSnapshotForShare(
  snapshot: TaskWorkflowPresetSnapshot,
): TaskWorkflowPresetSnapshot {
  if (!snapshot.plotWorldbookConfig) return snapshot;
  return {
    ...snapshot,
    plotWorldbookConfig: sanitizePlotWorldbookConfigForShare(snapshot.plotWorldbookConfig),
  };
}

function sanitizeTaskForShare(task: PostProcessTask): PostProcessTask {
  const next: PostProcessTask = { ...task };
  if (next.plotWorldbookConfig) {
    next.plotWorldbookConfig = sanitizePlotWorldbookConfigForShare(next.plotWorldbookConfig);
  }
  if (next.taskWorkflowPresets?.length) {
    next.taskWorkflowPresets = next.taskWorkflowPresets.map(entry => ({
      ...entry,
      snapshot: sanitizeTaskWorkflowSnapshotForShare(entry.snapshot),
    }));
  }
  return next;
}

/** 导出预设：去掉本机 API 预设路由，保留 recommendedModel */
function stripTaskApiPresetRefsForShare(task: PostProcessTask): PostProcessTask {
  return {
    ...task,
    apiPresetName: '',
    apiPresetFallbackNames: [],
    apiPrimaryMaxConcurrency: 5,
    apiFallbackMaxConcurrencies: [],
  };
}

export function sanitizePresetWorldbookRefsForShare(preset: PostProcessPreset): PostProcessPreset {
  return {
    ...preset,
    plotWorldbookConfig: sanitizePlotWorldbookConfigForShare(preset.plotWorldbookConfig),
    chatWorldbookWriteRules: sanitizeChatWorldbookWriteRulesForShare(preset.chatWorldbookWriteRules ?? []),
    tasks: (preset.tasks ?? []).map(sanitizeTaskForShare),
  };
}

/** 从当前设置抽出 PostProcessPreset（不含 API / 运行时字段；不含副本族成员） */
export function buildPresetFromSettings(settings: ScriptSettings, name: string): PostProcessPreset {
  return {
    name,
    tasks: stripReplicaFamilyMembers(_.cloneDeep(settings.tasks)),
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
    taskPlotWorldbookOverridesEnabled: settings.taskPlotWorldbookOverridesEnabled,
    taskContextOverridesEnabled: settings.taskContextOverridesEnabled,
    memoryRecallRecentCount: settings.memoryRecallRecentCount ?? 10,
  };
}

/** UI 导出预设 JSON：仅工作流预设 + 清洗本机世界书绑定与任务 API 预设名 */
export function buildShareablePresetExport(
  settings: ScriptSettings,
  name?: string,
): PostProcessPreset {
  const resolved =
    name?.trim() || settings.activePresetName.trim() || '导出预设';
  const preset = sanitizePresetWorldbookRefsForShare(buildPresetFromSettings(settings, resolved));
  return {
    ...preset,
    tasks: preset.tasks.map(stripTaskApiPresetRefsForShare),
  };
}

/** 分享导出 / 外部 API：剥离 API 凭据与本机世界书绑定，保留 url/model/name 与任务 recommendedModel */
export function redactScriptSettingsForShare(settings: ScriptSettings): ScriptSettings {
  const cloned = _.cloneDeep(settings);
  cloned.apiConfig = redactApiConfig(cloned.apiConfig);
  cloned.apiPresets = cloned.apiPresets.map(preset => ({
    ...preset,
    apiConfig: redactApiConfig(preset.apiConfig),
  }));

  cloned.plotWorldbookConfig = sanitizePlotWorldbookConfigForShare(cloned.plotWorldbookConfig);
  cloned.chatWorldbookWriteRules = sanitizeChatWorldbookWriteRulesForShare(
    cloned.chatWorldbookWriteRules ?? [],
  );
  cloned.tasks = (cloned.tasks ?? []).map(sanitizeTaskForShare);
  cloned.presets = (cloned.presets ?? []).map(sanitizePresetWorldbookRefsForShare);

  return cloned;
}

export const sanitizeSettingsForExternalApi = redactScriptSettingsForShare;

export function importedSettingsHadApiConfig(imported: ScriptSettings): boolean {
  if (imported.apiPresets.length > 0) return true;
  if (String(imported.defaultTaskApiPreset || '').trim()) return true;
  if (String(imported.apiConfig?.apiKey || '').trim()) return true;
  if (String(imported.apiConfig?.url || '').trim()) return true;
  return false;
}

export function detectSecretsInImportRaw(raw: unknown): boolean {
  return walkForSecrets(raw);
}

function walkForSecrets(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'string') return /bearer\s+\S+/i.test(raw);
  if (Array.isArray(raw)) return raw.some(walkForSecrets);
  if (typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (obj.apiKey !== undefined && String(obj.apiKey).trim()) return true;
  if (typeof obj.requestHeaders === 'string' && /authorization\s*:/i.test(obj.requestHeaders)) return true;
  return Object.values(obj).some(walkForSecrets);
}
