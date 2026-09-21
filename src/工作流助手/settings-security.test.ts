import assert from 'node:assert/strict';
import lodash from 'lodash';
import { PostProcessPresetSchema, ScriptSettingsSchema } from './tasks/schema';
import {
  buildPresetFromSettings,
  buildShareablePresetExport,
  detectSecretsInImportRaw,
  redactScriptSettingsForShare,
} from './settings-security';

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

function minimalSettings() {
  return ScriptSettingsSchema.parse({
    activePresetName: '我的预设',
    enabled: true,
    uiThemeId: 'creamy-minimal',
    scheduleState: { t1: { lastRunRound: 3 } },
    lastRunStatus: { messageId: 9, at: 1, taskResults: [] },
    tasks: [
      {
        id: 't1',
        name: '任务',
        recommendedModel: 'deepseek-chat',
        apiPresetName: 'GG:gemini-3-flash-preview',
        apiPresetFallbackNames: ['备用'],
        apiPrimaryMaxConcurrency: 2,
        apiFallbackMaxConcurrencies: [1],
        taskWorkflowPresets: [
          {
            name: 'wf',
            savedAt: 1,
            snapshot: {
              name: '任务',
              recommendedModel: 'deepseek-reasoner',
            },
          },
        ],
      },
    ],
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
    apiConfig: {
      url: 'https://legacy.example.com',
      apiKey: 'legacy-key',
      model: 'legacy',
    },
  });
}

test('redactScriptSettingsForShare clears apiKey but keeps recommendedModel', () => {
  const settings = minimalSettings();
  const redacted = redactScriptSettingsForShare(settings);
  assert.equal(redacted.apiConfig.apiKey, '');
  assert.equal(redacted.apiPresets[0]?.apiConfig.apiKey, '');
  assert.equal(redacted.apiPresets[0]?.apiConfig.url, 'https://api.example.com');
  assert.equal(redacted.apiPresets[0]?.apiConfig.model, 'm');
  assert.equal(redacted.tasks[0]?.recommendedModel, 'deepseek-chat');
  assert.equal(
    redacted.tasks[0]?.taskWorkflowPresets?.[0]?.snapshot.recommendedModel,
    'deepseek-reasoner',
  );
  assert.ok(!redacted.apiPresets[0]?.apiConfig.requestHeaders?.toLowerCase().includes('authorization'));
});

test('detectSecretsInImportRaw finds apiKey in nested object', () => {
  assert.equal(detectSecretsInImportRaw({ apiPresets: [{ apiConfig: { apiKey: 'x' } }] }), true);
  assert.equal(detectSecretsInImportRaw({ tasks: [{ id: 'a', name: 'n' }] }), false);
});

test('buildPresetFromSettings strips replica family members', () => {
  const settings = minimalSettings();
  settings.tasks = [
    {
      id: 'root-1',
      name: '副本族',
      enabled: true,
      stage: 1,
      extractInjectTags: [],
      promptGroups: [],
      syncAsReplicaFamily: true,
      replicaFamilySpec: 'item@id',
    },
    {
      id: 'rep-1',
      name: '副本族 1',
      enabled: true,
      stage: 1,
      extractInjectTags: [],
      promptGroups: [],
      replicaFamilyRootId: 'root-1',
      replicaFamilyAttrValue: '1',
    },
    {
      id: 'plain',
      name: '普通',
      enabled: true,
      stage: 1,
      extractInjectTags: [],
      promptGroups: [],
    },
  ] as typeof settings.tasks;

  const preset = buildPresetFromSettings(settings, '另存预设');
  assert.equal(preset.name, '另存预设');
  assert.equal(preset.tasks.length, 2);
  assert.ok(preset.tasks.every(t => !t.replicaFamilyRootId));
  assert.deepEqual(
    preset.tasks.map(t => t.id).sort(),
    ['plain', 'root-1'],
  );
});

test('buildShareablePresetExport drops API and runtime fields', () => {
  const settings = minimalSettings();
  settings.plotWorldbookConfig = {
    source: 'manual',
    manualSelection: ['写卡'],
    enabledEntries: { 写卡: [1, 2] },
  };
  settings.chatWorldbookWriteRules = [
    {
      id: 'r1',
      targetTag: 'result',
      template: '{{result}}',
      entryName: '',
      bookSource: 'manual',
      manualBookName: '写卡',
      entryType: 'constant',
      keywords: '',
      splitByAttr: false,
      wrapTagName: '',
      placement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
      preventRecursion: true,
    },
  ];

  const exported = buildShareablePresetExport(settings);
  const parsed = PostProcessPresetSchema.safeParse(exported);
  assert.equal(parsed.success, true);
  assert.equal(exported.name, '我的预设');
  assert.equal(exported.tasks[0]?.recommendedModel, 'deepseek-chat');
  assert.equal(exported.tasks[0]?.apiPresetName, '');
  assert.deepEqual(exported.tasks[0]?.apiPresetFallbackNames, []);
  assert.equal(exported.tasks[0]?.apiPrimaryMaxConcurrency, 5);
  assert.deepEqual(exported.tasks[0]?.apiFallbackMaxConcurrencies, []);
  assert.equal(exported.plotWorldbookConfig.source, 'character');
  assert.equal(exported.chatWorldbookWriteRules[0]?.manualBookName, '');

  const raw = exported as Record<string, unknown>;
  assert.equal('apiConfig' in raw, false);
  assert.equal('apiPresets' in raw, false);
  assert.equal('scheduleState' in raw, false);
  assert.equal('lastRunStatus' in raw, false);
  assert.equal('enabled' in raw, false);
  assert.equal('uiThemeId' in raw, false);
  assert.equal('presets' in raw, false);
  assert.equal(settings.tasks[0]?.apiPresetName, 'GG:gemini-3-flash-preview');
  assert.equal(settings.apiPresets[0]?.apiConfig.apiKey, 'secret-key');
  assert.equal(settings.plotWorldbookConfig.source, 'manual');
});

test('buildShareablePresetExport uses fallback name when active preset empty', () => {
  const settings = minimalSettings();
  settings.activePresetName = '';
  assert.equal(buildShareablePresetExport(settings).name, '导出预设');
  assert.equal(buildShareablePresetExport(settings, '自定义名').name, '自定义名');
});

test('redactScriptSettingsForShare strips machine-local worldbook bindings', () => {
  const settings = minimalSettings();
  settings.plotWorldbookConfig = {
    source: 'manual',
    manualSelection: ['写卡'],
    enabledEntries: { 写卡: [1, 2] },
  };
  settings.chatWorldbookWriteRules = [
    {
      id: 'r1',
      targetTag: 'result',
      template: '{{result}}',
      entryName: '',
      bookSource: 'manual',
      manualBookName: '写卡',
      entryType: 'constant',
      keywords: '',
      splitByAttr: false,
      wrapTagName: '',
      placement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
      preventRecursion: true,
    },
  ];
  settings.tasks[0]!.plotWorldbookMode = 'custom';
  settings.tasks[0]!.plotWorldbookConfig = {
    source: 'manual',
    manualSelection: ['写卡'],
    enabledEntries: { 写卡: [9] },
  };
  settings.presets = [
    {
      name: '分享预设',
      tasks: [],
      finalInjectTemplate: '',
      userInputEndInjectTemplate: '',
      tagVariableInjectTemplate: '',
      chatExtractTags: { user: [], assistant: [] },
      chatBodyTagReplaceRules: [],
      chatWorldbookWriteRules: [
        {
          id: 'r2',
          targetTag: 'result',
          template: '',
          entryName: '',
          bookSource: 'manual',
          manualBookName: '写卡',
          entryType: 'constant',
          keywords: '',
          splitByAttr: false,
          wrapTagName: '',
          placement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
          preventRecursion: true,
        },
      ],
      contextTurnCount: 3,
      contextExtractRules: [],
      contextExcludeRules: [],
      plotWorldbookConfig: {
        source: 'manual',
        manualSelection: ['写卡'],
        enabledEntries: {},
      },
      taskPlotWorldbookOverridesEnabled: false,
      taskContextOverridesEnabled: false,
      memoryRecallRecentCount: 10,
    },
  ];

  const redacted = redactScriptSettingsForShare(settings);
  assert.equal(redacted.plotWorldbookConfig.source, 'character');
  assert.deepEqual(redacted.plotWorldbookConfig.manualSelection, []);
  assert.deepEqual(redacted.plotWorldbookConfig.enabledEntries, {});
  assert.equal(redacted.chatWorldbookWriteRules[0]?.bookSource, 'character');
  assert.equal(redacted.chatWorldbookWriteRules[0]?.manualBookName, '');
  assert.equal(redacted.tasks[0]?.plotWorldbookConfig?.source, 'character');
  assert.deepEqual(redacted.tasks[0]?.plotWorldbookConfig?.manualSelection, []);
  assert.equal(redacted.presets[0]?.plotWorldbookConfig.source, 'character');
  assert.equal(redacted.presets[0]?.chatWorldbookWriteRules[0]?.manualBookName, '');
  // 本机设置未被原地修改
  assert.equal(settings.plotWorldbookConfig.source, 'manual');
  assert.equal(settings.chatWorldbookWriteRules[0]?.manualBookName, '写卡');
});
