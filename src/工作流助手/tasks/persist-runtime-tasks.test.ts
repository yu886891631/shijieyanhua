import assert from 'node:assert/strict';
import lodash from 'lodash';
import { shouldWriteRuntimeTasksToGlobal } from './persist-runtime-tasks-logic';
import type { PostProcessTask, ScriptSettings } from './schema';

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
  eventEmit?: (name?: unknown, payload?: unknown) => Promise<void>;
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

function makeRoot(): PostProcessTask {
  return {
    id: 'root-1',
    name: '副本族',
    enabled: true,
    stage: 1,
    extractInjectTags: [],
    promptGroups: [],
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
  } as PostProcessTask;
}

function makeMember(): PostProcessTask {
  return {
    id: 'rep-1',
    name: '副本族 1',
    enabled: true,
    stage: 1,
    extractInjectTags: [],
    promptGroups: [],
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
  } as PostProcessTask;
}

function resetState(): void {
  for (const key of Object.keys(chatMetadata)) delete chatMetadata[key];
  for (const key of Object.keys(savedVars)) delete savedVars[key];
}

async function main() {
  const { loadSettings, saveSettings } = await import('../settings');
  const { readChatTaskScope, clearChatTaskScope } = await import('./chat-task-scope');
  const {
    persistRuntimeTaskChanges,
    sanitizeGlobalTasksAfterChatChange,
    sanitizeNamedGlobalPresetMembers,
  } = await import('./persist-runtime-tasks');

  assert.equal(shouldWriteRuntimeTasksToGlobal(true), false);
  assert.equal(shouldWriteRuntimeTasksToGlobal(false), true);
  console.log('ok shouldWriteRuntimeTasksToGlobal is false when chat override active');

  {
    resetState();
    const base = loadSettings();
    const root = makeRoot();
    base.tasks = [root];
    base.activePresetName = base.presets[0]?.name || '空模板';
    if (base.presets[0]) {
      base.presets[0] = { ...base.presets[0], tasks: [root] };
    }
    saveSettings(base);

    const effective = _.cloneDeep(loadSettings()) as ScriptSettings;
    effective.tasks = [root, makeMember()];
    await persistRuntimeTaskChanges(loadSettings(), effective);

    const scope = readChatTaskScope();
    assert.ok(scope?.snapshot);
    assert.equal(scope!.snapshot!.tasks.filter(t => t.replicaFamilyRootId).length, 1);

    const global = loadSettings();
    assert.equal(global.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    const active = global.presets.find(p => p.name === global.activePresetName);
    assert.ok(active);
    assert.equal(active!.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    console.log('ok persistRuntimeTaskChanges with members creates chat snapshot and keeps global clean');
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    const root = makeRoot();
    const member = makeMember();
    const activeName = base.presets[0]?.name || '空模板';
    base.tasks = [root, member];
    base.activePresetName = activeName;
    if (base.presets[0]) {
      base.presets[0] = { ...base.presets[0], name: activeName, tasks: [root, member] };
    }
    // 非活动预设槽也塞入成员
    base.presets.push({
      ...base.presets[0]!,
      name: '非活动预设-含成员',
      tasks: [root, member],
    });
    saveSettings(base);

    const changed = sanitizeGlobalTasksAfterChatChange();
    assert.equal(changed, true);
    const after = loadSettings();
    assert.equal(after.tasks.length, 1);
    assert.equal(after.tasks[0]?.id, 'root-1');
    const active = after.presets.find(p => p.name === after.activePresetName);
    assert.equal(active?.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    const inactive = after.presets.find(p => p.name === '非活动预设-含成员');
    assert.ok(inactive);
    assert.equal(inactive!.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    console.log('ok sanitizeGlobalTasksAfterChatChange strips members from all preset slots');
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    const root = makeRoot();
    const member = makeMember();
    const name = base.presets[0]?.name || '空模板';
    base.activePresetName = name;
    base.tasks = [root, member];
    base.presets[0] = { ...base.presets[0]!, name, tasks: [root, member] };
    saveSettings(base);

    const changed = sanitizeNamedGlobalPresetMembers(name);
    assert.equal(changed, true);
    const after = loadSettings();
    assert.equal(after.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    assert.equal(after.presets[0]!.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    console.log('ok sanitizeNamedGlobalPresetMembers strips bound preset slot');
  }

  {
    resetState();
    await clearChatTaskScope();
    const base = loadSettings();
    const root = makeRoot();
    base.tasks = [root];
    base.activePresetName = base.presets[0]?.name || '空模板';
    if (base.presets[0]) base.presets[0] = { ...base.presets[0], tasks: [root] };
    saveSettings(base);

    const effective = _.cloneDeep(loadSettings()) as ScriptSettings;
    effective.tasks = [root];
    await persistRuntimeTaskChanges(loadSettings(), effective);

    assert.equal(readChatTaskScope(), null);
    assert.equal(loadSettings().tasks.length, 1);
    console.log('ok persistRuntimeTaskChanges without members writes global stripped');
  }

  {
    resetState();
    await clearChatTaskScope();
    const { writeChatTaskScope, buildChatSnapshotFromSettings } = await import('./chat-task-scope');
    const { promoteChatScopeToPreset, saveChatSnapshotAsGlobalPreset } = await import('./task-store');
    const { ChatTaskScopeStateSchema } = await import('./schema');

    const base = loadSettings();
    const root = makeRoot();
    const member = makeMember();
    base.tasks = [root];
    base.activePresetName = base.presets[0]?.name || '空模板';
    if (base.presets[0]) base.presets[0] = { ...base.presets[0], tasks: [root] };
    saveSettings(base);

    const snapshotSettings = _.cloneDeep(loadSettings()) as ScriptSettings;
    snapshotSettings.tasks = [root, member];
    const snapshot = buildChatSnapshotFromSettings(snapshotSettings);
    await writeChatTaskScope(
      ChatTaskScopeStateSchema.parse({
        mode: 'chat_override',
        snapshot,
        originPresetName: base.activePresetName,
        updatedAt: Date.now(),
        source: 'ui',
        activeView: 'snapshot',
        boundGlobalPresetName: '',
      }),
    );

    const beforeCount = loadSettings().presets.length;
    const savedName = await saveChatSnapshotAsGlobalPreset('全局另存-剥离成员');
    assert.equal(savedName, '全局另存-剥离成员');
    const afterSave = loadSettings();
    assert.equal(afterSave.presets.length, beforeCount + 1);
    const saved = afterSave.presets.find(p => p.name === savedName);
    assert.ok(saved);
    assert.equal(saved!.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    assert.equal(saved!.tasks.map(t => t.id).sort().join(','), 'root-1');
    assert.equal(readChatTaskScope()?.snapshot?.tasks.filter(t => t.replicaFamilyRootId).length, 1);
    console.log('ok saveChatSnapshotAsGlobalPreset strips members from new global preset');

    const promoteName = await promoteChatScopeToPreset('全局提升-剥离成员');
    assert.equal(promoteName, '全局提升-剥离成员');
    const afterPromote = loadSettings();
    const promoted = afterPromote.presets.find(p => p.name === promoteName);
    assert.ok(promoted);
    assert.equal(promoted!.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    assert.equal(afterPromote.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    assert.equal(afterPromote.activePresetName, promoteName);
    assert.equal(readChatTaskScope(), null);
    console.log('ok promoteChatScopeToPreset strips members from preset and top-level tasks');
  }

  {
    resetState();
    await clearChatTaskScope();
    const { writeChatTaskScope, buildChatSnapshotFromSettings } = await import('./chat-task-scope');
    const { replaceTasks, setChatScopeActiveView } = await import('./task-store');
    const { ChatTaskScopeStateSchema } = await import('./schema');

    const base = loadSettings();
    const root = makeRoot();
    const member = makeMember();
    const presetName = base.presets[0]?.name || '空模板';
    base.tasks = [root];
    base.activePresetName = presetName;
    base.presets[0] = { ...base.presets[0]!, name: presetName, tasks: [root] };
    saveSettings(base);

    const oldSnapTasks = [
      { ...root, id: 'old-root', name: '旧快照根' } as PostProcessTask,
    ];
    const snapSettings = _.cloneDeep(loadSettings()) as ScriptSettings;
    snapSettings.tasks = oldSnapTasks;
    await writeChatTaskScope(
      ChatTaskScopeStateSchema.parse({
        mode: 'chat_override',
        snapshot: buildChatSnapshotFromSettings(snapSettings),
        originPresetName: '旧来源名',
        updatedAt: Date.now(),
        source: 'ui',
        activeView: 'global',
        boundGlobalPresetName: presetName,
      }),
    );

    const effective = _.cloneDeep(loadSettings()) as ScriptSettings;
    effective.tasks = [root, member];
    await persistRuntimeTaskChanges(loadSettings(), effective);

    const after = loadSettings();
    const bound = after.presets.find(p => p.name === presetName);
    assert.ok(bound);
    assert.equal(bound!.tasks.filter(t => t.replicaFamilyRootId).length, 1);
    const scope = readChatTaskScope();
    assert.equal(scope?.activeView, 'snapshot');
    assert.equal(scope?.boundGlobalPresetName, '');
    assert.equal(scope?.snapshot?.tasks.filter(t => t.replicaFamilyRootId).length, 1);
    assert.ok(!scope?.snapshot?.tasks.some(t => t.id === 'old-root'));
    assert.equal(scope?.originPresetName, presetName);
    console.log('ok persistRuntime browsing global writes bound then forks snapshot');

    await setChatScopeActiveView({ view: 'global', presetName });
    const rebound = loadSettings().presets.find(p => p.name === presetName);
    assert.equal(rebound!.tasks.filter(t => t.replicaFamilyRootId).length, 1);
    assert.equal(readChatTaskScope()?.activeView, 'global');
    console.log('ok reselect global keeps members (no sanitize on select)');
  }

  {
    resetState();
    await clearChatTaskScope();
    const { writeChatTaskScope, buildChatSnapshotFromSettings } = await import('./chat-task-scope');
    const { replaceTasks } = await import('./task-store');
    const { ChatTaskScopeStateSchema } = await import('./schema');

    const base = loadSettings();
    const root = makeRoot();
    const member = makeMember();
    const presetName = base.presets[0]?.name || '空模板';
    base.tasks = [root];
    base.activePresetName = presetName;
    base.presets[0] = { ...base.presets[0]!, name: presetName, tasks: [root] };
    saveSettings(base);

    const snapSettings = _.cloneDeep(loadSettings()) as ScriptSettings;
    snapSettings.tasks = [root];
    await writeChatTaskScope(
      ChatTaskScopeStateSchema.parse({
        mode: 'chat_override',
        snapshot: buildChatSnapshotFromSettings(snapSettings),
        originPresetName: presetName,
        updatedAt: Date.now(),
        source: 'ui',
        activeView: 'global',
        boundGlobalPresetName: presetName,
      }),
    );

    await replaceTasks([root, member], 'ui');
    const afterUi = loadSettings();
    assert.equal(
      afterUi.presets.find(p => p.name === presetName)!.tasks.filter(t => t.replicaFamilyRootId).length,
      1,
    );
    const scopeAfterUi = readChatTaskScope();
    assert.equal(scopeAfterUi?.activeView, 'global');
    assert.equal(scopeAfterUi?.snapshot?.tasks.filter(t => t.replicaFamilyRootId).length, 0);
    console.log('ok UI replaceTasks browsing global writes bound only (no fork)');

    await replaceTasks([root, member], 'api');
    const afterApi = loadSettings();
    assert.equal(
      afterApi.presets.find(p => p.name === presetName)!.tasks.filter(t => t.replicaFamilyRootId).length,
      1,
    );
    const scopeAfterApi = readChatTaskScope();
    assert.equal(scopeAfterApi?.activeView, 'snapshot');
    assert.equal(scopeAfterApi?.snapshot?.tasks.filter(t => t.replicaFamilyRootId).length, 1);
    console.log('ok API replaceTasks browsing global writes bound then forks snapshot');
  }

  {
    resetState();
    await clearChatTaskScope();
    const { writeChatTaskScope, buildChatSnapshotFromSettings } = await import('./chat-task-scope');
    const { clearChatScope } = await import('./task-store');
    const { ChatTaskScopeStateSchema } = await import('./schema');

    const base = loadSettings();
    const root = makeRoot();
    const presetName = base.presets[0]?.name || '空模板';
    base.tasks = [root];
    base.activePresetName = presetName;
    base.presets[0] = {
      ...base.presets[0]!,
      name: presetName,
      tasks: [root],
      finalInjectTemplate: 'ACTIVE_INJECT',
    };
    saveSettings(base);

    const polluted = loadSettings();
    polluted.tasks = [{ ...root, id: 'polluted', name: '污染' } as PostProcessTask];
    polluted.finalInjectTemplate = 'POLLUTED';
    const snapSettings = _.cloneDeep(polluted) as ScriptSettings;
    await writeChatTaskScope(
      ChatTaskScopeStateSchema.parse({
        mode: 'chat_override',
        snapshot: buildChatSnapshotFromSettings(snapSettings),
        originPresetName: presetName,
        updatedAt: Date.now(),
        source: 'ui',
        activeView: 'snapshot',
        boundGlobalPresetName: '',
      }),
    );
    // 模拟展示叠写已落盘
    saveSettings(polluted);

    await clearChatScope('api');
    const afterClear = loadSettings();
    assert.equal(readChatTaskScope(), null);
    assert.equal(afterClear.tasks.map(t => t.id).join(','), 'root-1');
    assert.equal(afterClear.finalInjectTemplate, 'ACTIVE_INJECT');
    console.log('ok clearChatScope rehydrates working copy from active preset');
  }

  {
    resetState();
    await clearChatTaskScope();
    const chatScopeEmits: Array<{ createdSnapshot?: boolean }> = [];
    const prevEmit = g.eventEmit;
    g.eventEmit = async (name?: unknown, payload?: unknown) => {
      if (name === 'acu-pp:chat-scope-changed' && payload && typeof payload === 'object') {
        chatScopeEmits.push(payload as { createdSnapshot?: boolean });
      }
    };

    const { ensureChatOverride } = await import('./chat-task-scope');
    const base = loadSettings();
    const root = makeRoot();
    base.tasks = [root];
    base.activePresetName = base.presets[0]?.name || '空模板';
    if (base.presets[0]) base.presets[0] = { ...base.presets[0], tasks: [root] };
    saveSettings(base);

    const first = await ensureChatOverride(loadSettings(), 'api');
    assert.equal(first.created, true);
    assert.ok(first.scope.snapshot);
    const second = await ensureChatOverride(loadSettings(), 'api');
    assert.equal(second.created, false);

    // 经 persistSnapshotTasks（createTask）路径应带 createdSnapshot
    chatScopeEmits.length = 0;
    await clearChatTaskScope();
    const { createTask, clearChatScope } = await import('./task-store');
    await createTask({ name: '触发建快照' }, 'api');
    assert.ok(chatScopeEmits.some(e => e.createdSnapshot === true));
    await clearChatScope('api');
    g.eventEmit = prevEmit;
    console.log('ok ensureChatOverride created flag and createTask emits createdSnapshot');
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
