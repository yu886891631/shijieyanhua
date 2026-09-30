import type { WorldEvolutionSettings } from './types';

export const WORLD_EVOLUTION_API_CONFIG_VERSION = 1 as const;
export const WORLD_EVOLUTION_API_CONFIG_KEY = 'world_evolution_api_config_v1';

export type WorldEvolutionApiProvider = 'openai-compatible' | 'custom';

export type WorldEvolutionApiPreset = {
  id: string;
  name: string;
  provider: WorldEvolutionApiProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
};

export type WorldEvolutionApiRouting = {
  primaryPresetId: string | null;
  fallbackPresetIds: string[];
  /** 旧版工作流助手预设名称，供后续兼容桥接阶段使用。 */
  workflowAssistantPresetName: string;
  workflowAssistantFallbackPresetNames: string[];
  preferBuiltin: boolean;
  allowWorkflowAssistantBridge: boolean;
  testBeforeRun: boolean;
};

export type WorldEvolutionApiConfiguration = {
  schemaVersion: typeof WORLD_EVOLUTION_API_CONFIG_VERSION;
  presets: WorldEvolutionApiPreset[];
  routing: WorldEvolutionApiRouting;
  updatedAt: number;
};

export type WorldEvolutionApiPresetPublic = Omit<WorldEvolutionApiPreset, 'apiKey'> & {
  keyConfigured: boolean;
};

export type WorldEvolutionApiConfigurationPublic = Omit<WorldEvolutionApiConfiguration, 'presets'> & {
  presets: WorldEvolutionApiPresetPublic[];
};

export type LegacyWorldEvolutionApiSettings = Pick<
  WorldEvolutionSettings,
  'apiPresetName' | 'apiFallbackPresetNames'
>;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_RETRIES = 8;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function deterministicPresetId(name: string, index: number): string {
  return `we-api-${slug(name) || 'preset'}-${index + 1}`;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeText).filter(Boolean))];
}

function normalizePreset(value: unknown, index: number, now: number): WorldEvolutionApiPreset | null {
  if (!isRecord(value)) return null;
  const name = normalizeText(value.name);
  if (!name) return null;
  const rawId = normalizeText(value.id);
  const id = rawId || deterministicPresetId(name, index);
  const createdAt = normalizeInteger(value.createdAt, now, 0, Number.MAX_SAFE_INTEGER);
  return {
    id,
    name,
    provider: value.provider === 'custom' ? 'custom' : 'openai-compatible',
    endpoint: normalizeText(value.endpoint),
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    model: normalizeText(value.model),
    enabled: normalizeBoolean(value.enabled, true),
    timeoutMs: normalizeInteger(value.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxRetries: normalizeInteger(value.maxRetries, DEFAULT_MAX_RETRIES, 0, MAX_RETRIES),
    createdAt,
    updatedAt: normalizeInteger(value.updatedAt, createdAt, 0, Number.MAX_SAFE_INTEGER),
  };
}

function normalizePresets(value: unknown, now: number): WorldEvolutionApiPreset[] {
  if (!Array.isArray(value)) return [];
  const result: WorldEvolutionApiPreset[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [index, item] of value.entries()) {
    const preset = normalizePreset(item, index, now);
    if (!preset || ids.has(preset.id) || names.has(preset.name)) continue;
    ids.add(preset.id);
    names.add(preset.name);
    result.push(preset);
  }
  return result;
}

function normalizeRouting(value: unknown, presets: WorldEvolutionApiPreset[]): WorldEvolutionApiRouting {
  const raw = isRecord(value) ? value : {};
  const ids = new Set(presets.map(preset => preset.id));
  const primaryPresetId = normalizeText(raw.primaryPresetId);
  return {
    primaryPresetId: primaryPresetId && ids.has(primaryPresetId) ? primaryPresetId : null,
    fallbackPresetIds: uniqueStrings(raw.fallbackPresetIds).filter(id => ids.has(id) && id !== primaryPresetId),
    workflowAssistantPresetName: normalizeText(raw.workflowAssistantPresetName),
    workflowAssistantFallbackPresetNames: uniqueStrings(raw.workflowAssistantFallbackPresetNames).filter(
      name => name !== normalizeText(raw.workflowAssistantPresetName),
    ),
    preferBuiltin: normalizeBoolean(raw.preferBuiltin, true),
    allowWorkflowAssistantBridge: normalizeBoolean(raw.allowWorkflowAssistantBridge, true),
    testBeforeRun: normalizeBoolean(raw.testBeforeRun, false),
  };
}

export function createEmptyWorldEvolutionApiConfiguration(now = Date.now()): WorldEvolutionApiConfiguration {
  return {
    schemaVersion: WORLD_EVOLUTION_API_CONFIG_VERSION,
    presets: [],
    routing: {
      primaryPresetId: null,
      fallbackPresetIds: [],
      workflowAssistantPresetName: '',
      workflowAssistantFallbackPresetNames: [],
      preferBuiltin: true,
      allowWorkflowAssistantBridge: true,
      testBeforeRun: false,
    },
    updatedAt: now,
  };
}

export function normalizeWorldEvolutionApiConfiguration(
  value: unknown,
  now = Date.now(),
): WorldEvolutionApiConfiguration {
  const raw = isRecord(value) ? value : {};
  const presets = normalizePresets(raw.presets, now);
  return {
    schemaVersion: WORLD_EVOLUTION_API_CONFIG_VERSION,
    presets,
    routing: normalizeRouting(raw.routing, presets),
    updatedAt: normalizeInteger(raw.updatedAt, now, 0, Number.MAX_SAFE_INTEGER),
  };
}

/**
 * 将 alpha.11 的工作流助手预设名称迁移为桥接路由引用。
 * 这里不会伪造内置 preset，也不会复制未知的 endpoint 或 API Key。
 */
export function migrateLegacyWorldEvolutionApiSettings(
  legacy: Partial<LegacyWorldEvolutionApiSettings> | undefined,
  now = Date.now(),
): WorldEvolutionApiConfiguration {
  const config = createEmptyWorldEvolutionApiConfiguration(now);
  config.routing.workflowAssistantPresetName = normalizeText(legacy?.apiPresetName);
  config.routing.workflowAssistantFallbackPresetNames = uniqueStrings(legacy?.apiFallbackPresetNames).filter(
    name => name !== config.routing.workflowAssistantPresetName,
  );
  return config;
}

export function redactWorldEvolutionApiConfiguration(
  value: WorldEvolutionApiConfiguration,
): WorldEvolutionApiConfigurationPublic {
  const config = normalizeWorldEvolutionApiConfiguration(value);
  return {
    schemaVersion: config.schemaVersion,
    presets: config.presets.map(({ apiKey, ...preset }) => ({
      ...preset,
      keyConfigured: Boolean(apiKey),
    })),
    routing: clone(config.routing),
    updatedAt: config.updatedAt,
  };
}

export function exportWorldEvolutionApiConfiguration(
  value: WorldEvolutionApiConfiguration,
): string {
  return JSON.stringify(redactWorldEvolutionApiConfiguration(value), null, 2);
}

export function getWorldEvolutionApiPreset(
  config: WorldEvolutionApiConfiguration,
  presetId: string,
): WorldEvolutionApiPreset | undefined {
  return config.presets.find(preset => preset.id === presetId);
}

export function upsertWorldEvolutionApiPreset(
  config: WorldEvolutionApiConfiguration,
  preset: Partial<WorldEvolutionApiPreset> & Pick<WorldEvolutionApiPreset, 'name'>,
  now = Date.now(),
): WorldEvolutionApiConfiguration {
  const current = normalizeWorldEvolutionApiConfiguration(config, now);
  const existingIndex = preset.id ? current.presets.findIndex(item => item.id === preset.id) : -1;
  const existing = existingIndex >= 0 ? current.presets[existingIndex] : undefined;
  const next = normalizePreset(
    {
      ...existing,
      ...preset,
      id: preset.id ?? existing?.id ?? deterministicPresetId(preset.name, current.presets.length),
      createdAt: existing?.createdAt ?? preset.createdAt ?? now,
      updatedAt: now,
    },
    existingIndex >= 0 ? existingIndex : current.presets.length,
    now,
  );
  if (!next) throw new Error('API 预设名称不能为空');
  const duplicate = current.presets.findIndex(item => item.name === next.name && item.id !== next.id);
  if (duplicate >= 0) throw new Error(`API 预设名称重复：${next.name}`);
  if (existingIndex >= 0) current.presets[existingIndex] = next;
  else current.presets.push(next);
  current.updatedAt = now;
  return normalizeWorldEvolutionApiConfiguration(current, now);
}

export function removeWorldEvolutionApiPreset(
  config: WorldEvolutionApiConfiguration,
  presetId: string,
  now = Date.now(),
): WorldEvolutionApiConfiguration {
  const current = normalizeWorldEvolutionApiConfiguration(config, now);
  current.presets = current.presets.filter(preset => preset.id !== presetId);
  if (current.routing.primaryPresetId === presetId) current.routing.primaryPresetId = null;
  current.routing.fallbackPresetIds = current.routing.fallbackPresetIds.filter(id => id !== presetId);
  current.updatedAt = now;
  return current;
}

export function loadWorldEvolutionApiConfiguration(
  legacy?: Partial<LegacyWorldEvolutionApiSettings>,
): WorldEvolutionApiConfiguration {
  try {
    const rawVariables = getVariables({ type: 'script', script_id: getScriptId() }) ?? {};
    const stored = rawVariables[WORLD_EVOLUTION_API_CONFIG_KEY];
    if (stored && typeof stored === 'object') return normalizeWorldEvolutionApiConfiguration(stored);
  } catch (error) {
    console.warn('[世界演变] API 配置读取失败，使用默认配置:', error);
  }
  return migrateLegacyWorldEvolutionApiSettings(legacy);
}

export function saveWorldEvolutionApiConfiguration(
  value: WorldEvolutionApiConfiguration,
): WorldEvolutionApiConfiguration {
  const normalized = normalizeWorldEvolutionApiConfiguration(value);
  insertOrAssignVariables(
    { [WORLD_EVOLUTION_API_CONFIG_KEY]: normalized },
    { type: 'script', script_id: getScriptId() },
  );
  return normalized;
}
