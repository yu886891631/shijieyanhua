import type { ApiConfig, ApiPreset, PostProcessTask, ScriptSettings } from '../tasks/schema';

export interface ResolvedApi {
  apiConfig: ApiConfig;
}

export function findApiPreset(settings: ScriptSettings, name: string): ApiPreset | null {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  return settings.apiPresets.find(p => p.name === normalized) ?? null;
}

export function resolveApiPreset(settings: ScriptSettings, presetName: string): ApiConfig {
  return resolveApiPresetFull(settings, presetName).apiConfig;
}

export function resolveApiPresetFull(settings: ScriptSettings, presetName: string): ResolvedApi {
  const preset = findApiPreset(settings, presetName);
  if (preset) {
    return { apiConfig: preset.apiConfig };
  }
  return { apiConfig: settings.apiConfig };
}

export function normalizeApiPresetFallbackNames(fallbacks: string[] | undefined, primary: string): string[] {
  const primaryNorm = String(primary || '').trim();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of fallbacks ?? []) {
    const normalized = String(name || '').trim();
    if (!normalized || normalized === primaryNorm || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function resolveTaskApiPreset(settings: ScriptSettings, taskId: string, taskPresetName?: string): string {
  const override = String(settings.taskApiPresetOverridesById[taskId] || '').trim();
  if (override) return override;
  const onTask = String(taskPresetName || '').trim();
  if (onTask) return onTask;
  return String(settings.defaultTaskApiPreset || settings.defaultApiPresetName || '').trim();
}

export function resolveTaskApiPresetChain(
  settings: ScriptSettings,
  taskId: string,
  task: Pick<PostProcessTask, 'apiPresetName' | 'apiPresetFallbackNames'>,
): string[] {
  const primary = resolveTaskApiPreset(settings, taskId, task.apiPresetName);
  const chain: string[] = [];
  if (primary) chain.push(primary);

  const fallbacks = normalizeApiPresetFallbackNames(task.apiPresetFallbackNames, primary);
  for (const name of fallbacks) {
    if (!findApiPreset(settings, name)) {
      console.warn(`[工作流助手] 备用 API 预设「${name}」不存在，已跳过`);
      continue;
    }
    chain.push(name);
  }

  if (chain.length) return chain;
  return primary ? [primary] : [''];
}

export function getEffectiveApi(settings: ScriptSettings, taskId: string, taskPresetName?: string): ResolvedApi {
  const presetName = resolveTaskApiPreset(settings, taskId, taskPresetName);
  return resolveApiPresetFull(settings, presetName);
}

/** @deprecated 使用 getEffectiveApi */
export function getEffectiveApiConfig(
  settings: ScriptSettings,
  taskId: string,
  taskPresetName?: string,
): ApiConfig {
  return getEffectiveApi(settings, taskId, taskPresetName).apiConfig;
}
