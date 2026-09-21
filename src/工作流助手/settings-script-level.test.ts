import assert from 'node:assert/strict';
import lodash from 'lodash';
import type { PostProcessTask, ScriptSettings } from './tasks/schema';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

const savedVars: Record<string, unknown> = {};
const chatMetadata: Record<string, unknown> = {};

const g = globalThis as typeof globalThis & {
  getVariables?: (opt: unknown) => Record<string, unknown>;
  insertOrAssignVariables?: (data: unknown, opt: unknown) => void;
  getScriptId?: () => string;
  defineStore?: (...args: unknown[]) => unknown;
  ref?: <T>(v: T) => { value: T };
  watchEffect?: (fn: () => void) => void;
  window?: {
    parent?: {
      SillyTavern?: {
        getContext?: () => {
          chatMetadata: Record<string, unknown>;
          updateChatMetadata: (v: Record<string, unknown>, reset: boolean) => void;
          saveChat: () => Promise<void>;
        };
      };
    };
  };
  eventEmit?: () => Promise<void>;
};

g.getScriptId = () => '工作流助手';
g.getVariables = () => ({ ...savedVars });
g.insertOrAssignVariables = (data: unknown) => {
  Object.assign(savedVars, data as Record<string, unknown>);
};
g.defineStore = () => () => ({});
g.ref = <T>(v: T) => ({ value: v });
g.watchEffect = () => {};
g.eventEmit = async () => {};
g.window = {
  parent: {
    SillyTavern: {
      getContext: () => ({
        chatMetadata,
        updateChatMetadata: (v, reset) => {
          if (reset) {
            for (const key of Object.keys(chatMetadata)) delete chatMetadata[key];
          }
          Object.assign(chatMetadata, v);
        },
        saveChat: async () => {},
      }),
    },
  },
};

function resetState(): void {
  for (const key of Object.keys(chatMetadata)) delete chatMetadata[key];
  for (const key of Object.keys(savedVars)) delete savedVars[key];
}

async function main() {
  const {
    loadSettings,
    saveSettings,
    applyScriptLevelSettings,
    saveScriptLevelSettingsFrom,
    savePresetsCatalogToDisk,
    saveProgressHudPosition,
  } = await import('./settings');
  const { writeChatTaskScope, clearChatTaskScope, buildChatSnapshotFromSettings } = await import(
    './tasks/chat-task-scope'
  );
  const { ChatTaskScopeStateSchema, PostProcessPresetSchema } = await import('./tasks/schema');

  function makeTask(id: string, name: string): PostProcessTask {
    return {
      id,
      name,
      enabled: true,
      stage: 1,
      extractInjectTags: [],
      promptGroups: [],
    } as PostProcessTask;
  }

  async function ensureOverride(origin: string): Promise<void> {
    const snapSettings = _.cloneDeep(loadSettings()) as ScriptSettings;
    await writeChatTaskScope(
      ChatTaskScopeStateSchema.parse({
        mode: 'chat_override',
        snapshot: buildChatSnapshotFromSettings(snapSettings),
        originPresetName: origin,
        updatedAt: Date.now(),
        source: 'ui',
        activeView: 'snapshot',
        boundGlobalPresetName: '',
      }),
    );
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    const diskTasks = [
      {
        id: 'disk-task',
        name: '磁盘任务',
        enabled: true,
        stage: 1,
        extractInjectTags: [],
        promptGroups: [],
      } as PostProcessTask,
    ];
    base.tasks = diskTasks;
    base.enabled = false;
    base.apiPresets = [
      {
        name: '旧API',
        apiConfig: { url: 'https://old.example', apiKey: '', model: 'old', source: 'openai' },
      },
    ];
    base.activePresetName = base.presets[0]?.name || '空模板';
    if (base.presets[0]) base.presets[0] = { ...base.presets[0], tasks: diskTasks };
    saveSettings(base);

    const snapSettings = _.cloneDeep(loadSettings()) as ScriptSettings;
    snapSettings.tasks = [
      {
        id: 'snap-task',
        name: '快照任务',
        enabled: true,
        stage: 1,
        extractInjectTags: [],
        promptGroups: [],
      } as PostProcessTask,
    ];
    await writeChatTaskScope(
      ChatTaskScopeStateSchema.parse({
        mode: 'chat_override',
        snapshot: buildChatSnapshotFromSettings(snapSettings),
        originPresetName: base.activePresetName,
        updatedAt: Date.now(),
        source: 'ui',
        activeView: 'snapshot',
        boundGlobalPresetName: '',
      }),
    );

    const display = _.cloneDeep(loadSettings()) as ScriptSettings;
    // 模拟展示叠写：tasks 变成快照内容
    display.tasks = _.cloneDeep(snapSettings.tasks);
    display.enabled = true;
    display.apiPresets = [
      {
        name: '新API',
        apiConfig: { url: 'https://new.example', apiKey: 'k', model: 'new', source: 'openai' },
      },
    ];
    display.finalInjectTemplate = 'SHOULD_NOT_PERSIST';

    saveScriptLevelSettingsFrom(display);

    const after = loadSettings();
    assert.equal(after.enabled, true);
    assert.equal(after.apiPresets[0]?.name, '新API');
    assert.equal(after.tasks.map(t => t.id).join(','), 'disk-task');
    assert.notEqual(after.finalInjectTemplate, 'SHOULD_NOT_PERSIST');
    console.log('ok saveScriptLevelSettingsFrom persists enabled/apiPresets without polluting tasks');
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    base.enabled = false;
    base.tasks = [
      {
        id: 't1',
        name: 'T1',
        enabled: true,
        stage: 1,
        extractInjectTags: [],
        promptGroups: [],
      } as PostProcessTask,
    ];
    saveSettings(base);

    const from = _.cloneDeep(loadSettings());
    from.enabled = true;
    from.uiThemeId = 'dark-test';
    from.progressHudPosition = { x: 0.25, y: 0.4 };
    const target = _.cloneDeep(loadSettings());
    applyScriptLevelSettings(from, target);
    assert.equal(target.enabled, true);
    assert.equal(target.uiThemeId, 'dark-test');
    assert.deepEqual(target.progressHudPosition, { x: 0.25, y: 0.4 });
    assert.equal(target.tasks[0]?.id, 't1');
    console.log('ok applyScriptLevelSettings copies script fields only');
  }

  {
    resetState();
    await clearChatTaskScope();
    saveSettings(loadSettings());
    saveProgressHudPosition({ x: 0.3, y: 0.55 });
    assert.deepEqual(loadSettings().progressHudPosition, { x: 0.3, y: 0.55 });
    saveProgressHudPosition(null);
    assert.equal(loadSettings().progressHudPosition, null);
    console.log('ok saveProgressHudPosition writes and clears script vars');
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    base.enabled = false;
    base.tasks = [
      {
        id: 'keep',
        name: 'Keep',
        enabled: true,
        stage: 1,
        extractInjectTags: [],
        promptGroups: [],
      } as PostProcessTask,
    ];
    saveSettings(base);

    // 无快照：整份 saveSettings 仍可用
    const full = loadSettings();
    full.enabled = true;
    full.tasks = [
      {
        id: 'replaced',
        name: 'Replaced',
        enabled: true,
        stage: 1,
        extractInjectTags: [],
        promptGroups: [],
      } as PostProcessTask,
    ];
    saveSettings(full);
    const after = loadSettings();
    assert.equal(after.enabled, true);
    assert.equal(after.tasks[0]?.id, 'replaced');
    console.log('ok full saveSettings without override still replaces tasks');
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    const activeName = base.presets[0]?.name || '空模板';
    base.activePresetName = activeName;
    base.tasks = [makeTask('disk-1', '磁盘')];
    base.presets[0] = {
      ...base.presets[0]!,
      name: activeName,
      tasks: [makeTask('disk-1', '磁盘')],
    };
    saveSettings(base);
    await ensureOverride(activeName);

    const display = _.cloneDeep(loadSettings()) as ScriptSettings;
    display.tasks = [makeTask('polluted', '污染展示')];
    const imported = PostProcessPresetSchema.parse({
      name: '导入预设-测试',
      tasks: [makeTask('imp-1', '导入任务')],
    });
    display.presets.push(imported);
    savePresetsCatalogToDisk(display);

    const after = loadSettings();
    assert.ok(after.presets.some(p => p.name === '导入预设-测试'));
    assert.equal(after.tasks.map(t => t.id).join(','), 'disk-1');
    console.log('ok savePresetsCatalogToDisk upserts preset with override without polluting tasks');
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    const activeName = base.presets[0]?.name || '空模板';
    base.activePresetName = activeName;
    base.tasks = [makeTask('keep-top', '保留顶层')];
    base.presets = [
      {
        ...base.presets[0]!,
        name: activeName,
        tasks: [makeTask('keep-top', '保留顶层')],
      },
      PostProcessPresetSchema.parse({
        name: '可删预设',
        tasks: [makeTask('del-1', '待删')],
      }),
    ];
    saveSettings(base);
    await ensureOverride(activeName);

    const display = _.cloneDeep(loadSettings()) as ScriptSettings;
    display.tasks = [makeTask('polluted', '污染')];
    display.presets = display.presets.filter(p => p.name !== '可删预设');
    savePresetsCatalogToDisk(display);

    const after = loadSettings();
    assert.equal(after.presets.some(p => p.name === '可删预设'), false);
    assert.equal(after.activePresetName, activeName);
    assert.equal(after.tasks.map(t => t.id).join(','), 'keep-top');
    console.log('ok savePresetsCatalogToDisk deletes non-active preset with override');
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    base.presets = [
      PostProcessPresetSchema.parse({
        name: '活动预设',
        tasks: [makeTask('a1', 'A')],
        finalInjectTemplate: 'FROM_A',
      }),
      PostProcessPresetSchema.parse({
        name: '下一预设',
        tasks: [makeTask('b1', 'B')],
        finalInjectTemplate: 'FROM_B',
      }),
    ];
    base.activePresetName = '活动预设';
    base.tasks = [makeTask('a1', 'A')];
    base.finalInjectTemplate = 'FROM_A';
    saveSettings(base);
    await ensureOverride('活动预设');

    const display = _.cloneDeep(loadSettings()) as ScriptSettings;
    display.presets = display.presets.filter(p => p.name !== '活动预设');
    display.tasks = [makeTask('polluted', '污染')];
    savePresetsCatalogToDisk(display, {
      activePresetName: '下一预设',
      rehydrateWorkingCopyFromActive: true,
    });

    const after = loadSettings();
    assert.equal(after.presets.some(p => p.name === '活动预设'), false);
    assert.equal(after.activePresetName, '下一预设');
    assert.equal(after.tasks.map(t => t.id).join(','), 'b1');
    assert.equal(after.finalInjectTemplate, 'FROM_B');
    console.log('ok savePresetsCatalogToDisk switches active and rehydrates when deleting active');
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
