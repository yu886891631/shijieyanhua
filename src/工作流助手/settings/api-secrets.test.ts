import assert from 'node:assert/strict';
import lodash from 'lodash';
import { ScriptSettingsSchema } from '../tasks/schema';
import {
  extractLegacySecretsFromRaw,
  extractSecretsFromSettings,
  LEGACY_GLOBAL_SECRET_KEY,
  mergeSecretsIntoSettings,
  renamePresetSecret,
  stripSecretsForPersistence,
} from './api-secrets';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function settingsWithApi() {
  return ScriptSettingsSchema.parse({
    tasks: [{ id: 't1', name: '任务' }],
    apiPresets: [
      {
        name: '主线路',
        apiConfig: {
          url: 'https://api.example.com',
          apiKey: 'secret-key',
          model: 'm',
          requestHeaders: 'Authorization: Bearer tok\nX-Custom: 1',
        },
      },
    ],
    apiConfig: { url: '', apiKey: '', model: '', source: 'openai' },
  });
}

test('stripSecretsForPersistence clears apiKey and Authorization headers', () => {
  const stripped = stripSecretsForPersistence(settingsWithApi());
  assert.equal(stripped.apiPresets[0]?.apiConfig.apiKey, '');
  assert.ok(!stripped.apiPresets[0]?.apiConfig.requestHeaders?.toLowerCase().includes('authorization'));
  assert.equal(stripped.apiPresets[0]?.apiConfig.requestHeaders, 'X-Custom: 1');
});

test('extractSecretsFromSettings captures apiKey and auth headers', () => {
  const secrets = extractSecretsFromSettings(settingsWithApi());
  assert.equal(secrets.byPreset['主线路']?.apiKey, 'secret-key');
  assert.match(secrets.byPreset['主线路']?.authRequestHeaders ?? '', /Bearer tok/);
});

test('mergeSecretsIntoSettings restores credentials', () => {
  const stripped = stripSecretsForPersistence(settingsWithApi());
  const secrets = extractSecretsFromSettings(settingsWithApi());
  const merged = mergeSecretsIntoSettings(stripped, secrets);
  assert.equal(merged.apiPresets[0]?.apiConfig.apiKey, 'secret-key');
  assert.match(merged.apiPresets[0]?.apiConfig.requestHeaders ?? '', /Authorization: Bearer tok/);
});

test('extractLegacySecretsFromRaw reads script variable shape', () => {
  const legacy = extractLegacySecretsFromRaw({
    apiPresets: [{ name: 'p1', apiConfig: { apiKey: 'k1', requestHeaders: '' } }],
    apiConfig: { apiKey: 'global', requestHeaders: '' },
  });
  assert.equal(legacy.byPreset.p1?.apiKey, 'k1');
  assert.equal(legacy.byPreset[LEGACY_GLOBAL_SECRET_KEY]?.apiKey, 'global');
});

test('renamePresetSecret moves key', () => {
  const secrets = {
    version: 1 as const,
    byPreset: { old: { apiKey: 'x' } },
  };
  const next = renamePresetSecret(secrets, 'old', 'new');
  assert.equal(next.byPreset.new?.apiKey, 'x');
  assert.equal(next.byPreset.old, undefined);
});
