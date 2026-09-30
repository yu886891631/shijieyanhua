import type { ScriptSettings } from '../tasks/schema';

export type ExternalApiRouteOptions = {
  presetName?: string;
  fallbackNames?: string[];
};

export type ExternalApiPresetDetails = {
  name: string;
  model: string;
  endpointConfigured: boolean;
  keyConfigured: boolean;
};

export type ExternalApiPresetInfo = {
  available: true;
  activePresetName: string;
  defaultConfig: Omit<ExternalApiPresetDetails, 'name'>;
  presets: ExternalApiPresetDetails[];
};

function configuredPreset(settings: ScriptSettings, name: unknown) {
  const normalized = String(name || '').trim();
  return normalized ? settings.apiPresets.find(preset => preset.name === normalized) : undefined;
}

/** Resolve the effective named preset; an empty name means the legacy top-level API config. */
export function resolveExternalApiPresetName(settings: ScriptSettings, chatKey: string): string {
  const candidates = [
    settings.apiPresetBindingsByChat[chatKey]?.presetName,
    settings.activeApiPresetName,
    settings.defaultApiPresetName,
    settings.defaultTaskApiPreset,
  ];
  for (const candidate of candidates) {
    const preset = configuredPreset(settings, candidate);
    if (preset) return preset.name;
  }
  return settings.apiPresets[0]?.name ?? '';
}

/** Return safe status only; endpoint URLs, headers and credentials stay inside the helper. */
export function listExternalApiPresetDetails(settings: ScriptSettings, chatKey: string): ExternalApiPresetInfo {
  const describe = (name: string, apiConfig: ScriptSettings['apiConfig']): ExternalApiPresetDetails => ({
    name,
    model: apiConfig.model,
    endpointConfigured: Boolean(apiConfig.url.trim()),
    keyConfigured: Boolean(apiConfig.apiKey.trim()),
  });
  return {
    available: true,
    activePresetName: resolveExternalApiPresetName(settings, chatKey),
    defaultConfig: {
      model: settings.apiConfig.model,
      endpointConfigured: Boolean(settings.apiConfig.url.trim()),
      keyConfigured: Boolean(settings.apiConfig.apiKey.trim()),
    },
    presets: settings.apiPresets.map(preset => describe(preset.name, preset.apiConfig)),
  };
}

/** Build a validated route chain without exposing or copying API credentials. */
export function buildExternalApiPresetChain(
  settings: ScriptSettings,
  chatKey: string,
  options?: ExternalApiRouteOptions,
): string[] {
  const requestedPrimary = String(options?.presetName || '').trim();
  const primary = requestedPrimary || resolveExternalApiPresetName(settings, chatKey);
  if (requestedPrimary && !configuredPreset(settings, requestedPrimary)) {
    throw new Error(`API 预设「${requestedPrimary}」不存在，请检查工作流助手 API 设置。`);
  }

  const routeNames: string[] = [];
  if (primary) routeNames.push(primary);
  else if (settings.apiConfig.url.trim() && settings.apiConfig.model.trim()) routeNames.push('');

  for (const candidate of options?.fallbackNames ?? []) {
    const name = String(candidate || '').trim();
    if (!name || routeNames.includes(name)) continue;
    // Removed or renamed fallbacks should not block an otherwise valid primary route.
    if (!configuredPreset(settings, name)) continue;
    routeNames.push(name);
  }

  if (routeNames.length) return routeNames;
  throw new Error('尚未配置 API 预设。请先在工作流助手中创建并保存 API 配置。');
}

export function resolveExternalApiPresetChain(
  settings: ScriptSettings,
  chatKey: string,
  options?: ExternalApiRouteOptions,
): string[] {
  const primary = String(options?.presetName || '').trim() || resolveExternalApiPresetName(settings, chatKey);
  const names = buildExternalApiPresetChain(settings, chatKey, options);
  if (names[0] === '' && settings.apiConfig.url.trim() && settings.apiConfig.model.trim()) return names;
  const valid = names.filter(name => {
    const preset = configuredPreset(settings, name);
    return Boolean(preset?.apiConfig.url.trim() && preset.apiConfig.model.trim());
  });
  if (primary && !valid.includes(primary)) {
    throw new Error(`主 API 预设「${primary}」没有有效端点或模型名，请检查工作流助手 API 设置。`);
  }
  if (!valid.length) throw new Error('没有可用的 API 端点和模型名，请检查工作流助手 API 设置。');
  return valid;
}
