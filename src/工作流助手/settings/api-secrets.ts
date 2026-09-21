import { z } from 'zod';
import { redactApiConfig } from '../settings-security';
import type { ApiConfig, ScriptSettings } from '../tasks/schema';
import { loadApiSecretsJson, saveApiSecretsJson } from './api-secrets-storage';

/** 旧版顶层 apiConfig 凭据在 secrets 中的键 */
export const LEGACY_GLOBAL_SECRET_KEY = '__legacy_global__';

export const PresetSecretEntrySchema = z.object({
  apiKey: z.string().default(''),
  authRequestHeaders: z.string().optional(),
});

export const ApiSecretsPayloadSchema = z.object({
  version: z.literal(1),
  byPreset: z.record(z.string(), PresetSecretEntrySchema).default({}),
});

export type PresetSecretEntry = z.infer<typeof PresetSecretEntrySchema>;
export type ApiSecretsPayload = z.infer<typeof ApiSecretsPayloadSchema>;

export function createEmptyApiSecretsPayload(): ApiSecretsPayload {
  return { version: 1, byPreset: {} };
}

function extractAuthRequestHeaders(headers: string): string {
  const lines = String(headers || '')
    .split('\n')
    .filter(line => {
      const lower = line.trim().toLowerCase();
      return lower.startsWith('authorization:') || lower.includes('bearer ');
    });
  return lines.join('\n');
}

function mergeAuthRequestHeaders(publicHeaders: string, authHeaders?: string): string {
  const auth = String(authHeaders || '').trim();
  const pub = String(publicHeaders || '').trim();
  if (!auth) return pub;
  if (!pub) return auth;
  return `${auth}\n${pub}`;
}

function secretEntryFromApiConfig(cfg: ApiConfig): PresetSecretEntry | null {
  const apiKey = String(cfg.apiKey || '').trim();
  const authRequestHeaders = extractAuthRequestHeaders(cfg.requestHeaders || '');
  if (!apiKey && !authRequestHeaders) return null;
  return {
    apiKey,
    ...(authRequestHeaders ? { authRequestHeaders } : {}),
  };
}

function applySecretToApiConfig(cfg: ApiConfig, entry?: PresetSecretEntry | null): ApiConfig {
  if (!entry) return { ...cfg, apiKey: '' };
  return {
    ...cfg,
    apiKey: entry.apiKey || '',
    requestHeaders: mergeAuthRequestHeaders(cfg.requestHeaders || '', entry.authRequestHeaders),
  };
}

export function extractSecretsFromSettings(settings: ScriptSettings): ApiSecretsPayload {
  const byPreset: Record<string, PresetSecretEntry> = {};
  for (const preset of settings.apiPresets) {
    const name = String(preset.name || '').trim();
    if (!name) continue;
    const entry = secretEntryFromApiConfig(preset.apiConfig);
    if (entry) byPreset[name] = entry;
  }
  const legacyEntry = secretEntryFromApiConfig(settings.apiConfig);
  if (legacyEntry) byPreset[LEGACY_GLOBAL_SECRET_KEY] = legacyEntry;
  return { version: 1, byPreset };
}

export function stripSecretsForPersistence(settings: ScriptSettings): ScriptSettings {
  const cloned = _.cloneDeep(settings);
  cloned.apiConfig = redactApiConfig(cloned.apiConfig);
  cloned.apiPresets = cloned.apiPresets.map(preset => ({
    ...preset,
    apiConfig: redactApiConfig(preset.apiConfig),
  }));
  return cloned;
}

export function mergeSecretsIntoSettings(
  settings: ScriptSettings,
  secrets: ApiSecretsPayload | null | undefined,
): ScriptSettings {
  if (!secrets?.byPreset || !Object.keys(secrets.byPreset).length) {
    return settings;
  }
  const cloned = _.cloneDeep(settings);
  cloned.apiPresets = cloned.apiPresets.map(preset => {
    const name = String(preset.name || '').trim();
    return {
      ...preset,
      apiConfig: applySecretToApiConfig(preset.apiConfig, secrets.byPreset[name]),
    };
  });
  cloned.apiConfig = applySecretToApiConfig(
    cloned.apiConfig,
    secrets.byPreset[LEGACY_GLOBAL_SECRET_KEY],
  );
  return cloned;
}

export function loadApiSecretsPayload(): ApiSecretsPayload {
  const json = loadApiSecretsJson();
  if (!json) return createEmptyApiSecretsPayload();
  try {
    const parsed = JSON.parse(json);
    const result = ApiSecretsPayloadSchema.safeParse(parsed);
    return result.success ? result.data : createEmptyApiSecretsPayload();
  } catch {
    return createEmptyApiSecretsPayload();
  }
}

export function saveApiSecretsPayload(payload: ApiSecretsPayload): void {
  saveApiSecretsJson(JSON.stringify(payload));
}

/** 从脚本变量 raw（迁移前）提取仍留在其中的凭据 */
export function extractLegacySecretsFromRaw(raw: Record<string, unknown>): ApiSecretsPayload {
  const byPreset: Record<string, PresetSecretEntry> = {};
  const presets = raw.apiPresets;
  if (Array.isArray(presets)) {
    for (const item of presets) {
      if (!item || typeof item !== 'object') continue;
      const name = String((item as Record<string, unknown>).name || '').trim();
      const cfg = (item as Record<string, unknown>).apiConfig;
      if (!name || !cfg || typeof cfg !== 'object') continue;
      const entry = secretEntryFromApiConfig(cfg as ApiConfig);
      if (entry) byPreset[name] = entry;
    }
  }
  const apiConfig = raw.apiConfig;
  if (apiConfig && typeof apiConfig === 'object') {
    const entry = secretEntryFromApiConfig(apiConfig as ApiConfig);
    if (entry) byPreset[LEGACY_GLOBAL_SECRET_KEY] = entry;
  }
  return { version: 1, byPreset };
}

export function mergeApiSecretsPayload(
  base: ApiSecretsPayload,
  incoming: ApiSecretsPayload,
): ApiSecretsPayload {
  return {
    version: 1,
    byPreset: { ...base.byPreset, ...incoming.byPreset },
  };
}

export function legacySecretsPayloadHasData(payload: ApiSecretsPayload): boolean {
  return Object.keys(payload.byPreset).length > 0;
}

export function renamePresetSecret(
  secrets: ApiSecretsPayload,
  oldName: string,
  newName: string,
): ApiSecretsPayload {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  if (!from || !to || from === to) return secrets;
  if (!secrets.byPreset[from]) return secrets;
  const next = { ...secrets.byPreset };
  next[to] = next[from]!;
  delete next[from];
  return { version: 1, byPreset: next };
}

export function deletePresetSecret(secrets: ApiSecretsPayload, name: string): ApiSecretsPayload {
  const key = String(name || '').trim();
  if (!key || !secrets.byPreset[key]) return secrets;
  const next = { ...secrets.byPreset };
  delete next[key];
  return { version: 1, byPreset: next };
}

export function renameApiPresetSecretInStore(oldName: string, newName: string): void {
  const current = loadApiSecretsPayload();
  const next = renamePresetSecret(current, oldName, newName);
  if (next !== current) saveApiSecretsPayload(next);
}

export function deleteApiPresetSecretInStore(name: string): void {
  const current = loadApiSecretsPayload();
  const next = deletePresetSecret(current, name);
  if (next !== current) saveApiSecretsPayload(next);
}
