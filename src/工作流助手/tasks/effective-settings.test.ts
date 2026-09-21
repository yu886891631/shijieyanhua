import assert from 'node:assert/strict';
import lodash from 'lodash';
import { resolveEffectiveSettings } from './effective-settings';
import type { PlotWorldbookConfig, PostProcessPreset, ScriptSettings } from './schema';
import { CHAT_SCOPE_METADATA_KEY } from './schema';

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

const globalTasks = [{ id: 'g1', name: 'Global', enabled: true, stage: 1 }] as ScriptSettings['tasks'];
const snapshotTasks = [{ id: 's1', name: 'Snapshot', enabled: true, stage: 1 }] as ScriptSettings['tasks'];
const presetBTasks = [{ id: 'b1', name: 'PresetB', enabled: true, stage: 1 }] as ScriptSettings['tasks'];

const globalConfig: PlotWorldbookConfig = {
  source: 'manual',
  manualSelection: ['GlobalBook'],
  enabledEntries: { GlobalBook: [1] },
};

const snapshotConfig: PlotWorldbookConfig = {
  source: 'manual',
  manualSelection: ['SnapBook'],
  enabledEntries: { SnapBook: [2] },
};

const presetBConfig: PlotWorldbookConfig = {
  source: 'manual',
  manualSelection: ['BookB'],
  enabledEntries: { BookB: [3] },
};

const baseSettings = {
  tasks: globalTasks,
  activePresetName: '空模板',
  contextTurnCount: 3,
  plotWorldbookConfig: globalConfig,
  taskPlotWorldbookOverridesEnabled: false,
  presets: [
    {
      name: '空模板',
      tasks: globalTasks,
      finalInjectTemplate: '',
      tagVariableInjectTemplate: '',
      chatExtractTags: { user: [], assistant: [] },
      chatBodyTagReplaceRules: [],
      chatWorldbookWriteRules: [],
      contextTurnCount: 3,
      contextExtractRules: [],
      contextExcludeRules: [],
      plotWorldbookConfig: globalConfig,
    },
    {
      name: '预设B',
      tasks: presetBTasks,
      finalInjectTemplate: 'b-final',
      tagVariableInjectTemplate: '',
      chatExtractTags: { user: [], assistant: [] },
      chatBodyTagReplaceRules: [],
      chatWorldbookWriteRules: [],
      contextTurnCount: 7,
      contextExtractRules: [],
      contextExcludeRules: [],
      plotWorldbookConfig: presetBConfig,
    },
  ],
} as ScriptSettings;

const snapshotPreset: PostProcessPreset = {
  name: '__chat_snapshot__',
  tasks: snapshotTasks,
  finalInjectTemplate: 'snap-final',
  tagVariableInjectTemplate: 'snap-tags',
  chatExtractTags: { user: ['user_tag'], assistant: ['ai_tag'] },
  chatBodyTagReplaceRules: [{ id: 'r1', targetTag: 'ai_tag', template: '{{ai_tag}}' }],
  contextTurnCount: 5,
  contextExtractRules: [],
  contextExcludeRules: [],
  plotWorldbookConfig: snapshotConfig,
  taskPlotWorldbookOverridesEnabled: true,
  taskContextOverridesEnabled: false,
};

const g = globalThis as typeof globalThis & {
  window?: { parent?: { SillyTavern?: { getContext?: () => unknown } } };
};

function mockStContext(metadata: Record<string, unknown>) {
  const ctx = {
    chatMetadata: metadata,
    updateChatMetadata: () => {},
    saveChat: async () => {},
  };
  g.window = { parent: { SillyTavern: { getContext: () => ctx } } };
}

function mockScope(partial: Record<string, unknown>) {
  mockStContext({
    [CHAT_SCOPE_METADATA_KEY]: {
      mode: 'chat_override',
      snapshot: snapshotPreset,
      originPresetName: '空模板',
      updatedAt: Date.now(),
      source: 'api',
      activeView: 'snapshot',
      boundGlobalPresetName: '',
      ...partial,
    },
  });
}

mockScope({});

test('resolveEffectiveSettings prefers chat snapshot tasks', () => {
  const resolved = resolveEffectiveSettings(baseSettings);
  assert.equal(resolved.tasks[0]?.id, 's1');
  assert.equal(resolved.contextTurnCount, 5);
  assert.equal(resolved.plotWorldbookConfig.manualSelection[0], 'SnapBook');
  assert.deepEqual(resolved.chatExtractTags, { user: ['user_tag'], assistant: ['ai_tag'] });
  assert.equal(resolved.chatBodyTagReplaceRules?.[0]?.targetTag, 'ai_tag');
});

test('resolveEffectiveSettings keeps global tasks when no snapshot', () => {
  mockStContext({});
  const resolved = resolveEffectiveSettings(baseSettings);
  assert.equal(resolved.tasks[0]?.id, 'g1');
});

test('resolveEffectiveSettings uses bound global preset when activeView=global', () => {
  mockScope({ activeView: 'global', boundGlobalPresetName: '预设B' });
  const resolved = resolveEffectiveSettings(baseSettings);
  assert.equal(resolved.tasks[0]?.id, 'b1');
  assert.equal(resolved.contextTurnCount, 7);
  assert.equal(resolved.finalInjectTemplate, 'b-final');
  // 全局工作副本未变
  assert.equal(baseSettings.tasks[0]?.id, 'g1');
  assert.equal(baseSettings.activePresetName, '空模板');
});

test('resolveEffectiveSettings falls back to snapshot when bound preset missing', () => {
  mockScope({ activeView: 'global', boundGlobalPresetName: '不存在' });
  const resolved = resolveEffectiveSettings(baseSettings);
  assert.equal(resolved.tasks[0]?.id, 's1');
});

test('legacy scope without activeView defaults to snapshot overlay', () => {
  mockStContext({
    [CHAT_SCOPE_METADATA_KEY]: {
      mode: 'chat_override',
      snapshot: snapshotPreset,
      originPresetName: '空模板',
      updatedAt: Date.now(),
      source: 'api',
    },
  });
  const resolved = resolveEffectiveSettings(baseSettings);
  assert.equal(resolved.tasks[0]?.id, 's1');
});
