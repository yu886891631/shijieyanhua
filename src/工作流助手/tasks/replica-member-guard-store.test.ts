import assert from 'node:assert/strict';
import lodash from 'lodash';

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

void (async () => {
  const { clearChatScope, createTask, deleteTask, listTasks, replaceTasks, updateTask, updateTaskPlotWorldbook, updateTaskApiPresetRouting, updateTaskApiPresetMode } = await import(
    './task-store'
  );
  const { updateReplicaMemberSchedule } = await import('./task-store');
  const { syncReplicaFamily } = await import('./replica-family');

  try {
    await clearChatScope('api');

    const root = await createTask(
      {
        name: '处理 item',
        stage: 2,
        promptGroups: [{ name: '', role: 'user', content: 'do {{item@id}}', enabled: true }],
        extractInjectTags: ['item@id'],
        syncAsReplicaFamily: true,
        replicaFamilySpec: 'item@id',
        apiPresetName: 'root-api',
      },
      'api',
    );
    const withReplicas = syncReplicaFamily(root, ['1'], listTasks());
    await replaceTasks(withReplicas, 'api');

    const replica = listTasks().find(t => t.replicaFamilyRootId === root.id);
    assert.ok(replica);

    await assert.rejects(() => updateTask(replica!.id, { stage: 9 }, 'api'), /副本为原本镜像/);

    const memberConfig = {
      source: 'manual' as const,
      manualSelection: ['MemberBook'],
      enabledEntries: { MemberBook: [1] },
    };
    const wbUpdated = await updateTaskPlotWorldbook(
      replica!.id,
      { mode: 'custom', config: memberConfig },
      'api',
    );
    assert.equal(wbUpdated.plotWorldbookMode, 'custom');
    assert.deepEqual(wbUpdated.plotWorldbookConfig, memberConfig);

    const inheritRootUpdated = await updateTaskPlotWorldbook(replica!.id, { mode: 'inheritRoot' }, 'api');
    assert.equal(inheritRootUpdated.plotWorldbookMode, 'inheritRoot');

    const apiUpdated = await updateTaskApiPresetRouting(
      replica!.id,
      { primary: 'replica-api', primaryMaxConcurrency: 3 },
      'api',
    );
    assert.equal(apiUpdated.apiPresetMode, 'custom');
    assert.equal(apiUpdated.apiPresetName, 'replica-api');
    assert.equal(apiUpdated.apiPrimaryMaxConcurrency, 3);

    const modeInherit = await updateTaskApiPresetMode(replica!.id, 'inheritRoot', 'api');
    assert.equal(modeInherit.apiPresetMode, 'inheritRoot');
    assert.equal(modeInherit.apiPresetName, 'root-api');

    const modeCustom = await updateTaskApiPresetMode(replica!.id, 'custom', 'api');
    assert.equal(modeCustom.apiPresetMode, 'custom');
    assert.equal(modeCustom.apiPresetName, 'root-api');

    // 仅改路由字段也应自动升为 custom，避免下次镜像盖掉
    const bareRouting = await updateTask(replica!.id, { apiPresetName: 'solo-via-patch' }, 'api');
    assert.equal(bareRouting.apiPresetMode, 'custom');
    assert.equal(bareRouting.apiPresetName, 'solo-via-patch');

    const scheduled = await updateReplicaMemberSchedule(replica!.id, { launched: true }, 'api');
    assert.equal(scheduled.replicaFamilyLaunched, true);

    const deleted = await deleteTask(replica!.id, 'api');
    assert.equal(deleted, true);
    assert.ok(!listTasks().some(t => t.id === replica!.id));

    console.log('ok replica member guard store integration');
  } catch (e) {
    console.error('FAIL replica member guard store integration', e);
    process.exitCode = 1;
  } finally {
    await clearChatScope('api');
  }

  if (process.exitCode) process.exit(process.exitCode);
})();
