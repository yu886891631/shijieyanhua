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

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}
void (async () => {
  const { loadSettings } = await import('../settings');
  const { readChatTaskScope } = await import('./chat-task-scope');
  const {
    createTask,
    listTasks,
    clearChatScope,
    updateTaskStage,
    updateTaskSchedule,
    addPromptAutoSlot,
    addPromptAutoSegment,
    getEffectiveSettings,
    getActivePresetName,
    validateReplicaFamily,
    listReplicaFamilyMembers,
  } = await import('./task-store');
  const { buildEffectivePromptGroups } = await import('./prompt-auto-segments');

  test('createTask via API does not mutate global tasks', async () => {
    const before = loadSettings();
    const globalCount = before.tasks.length;
    await createTask({ name: 'API Task' }, 'api');
    const after = loadSettings();
    assert.equal(after.tasks.length, globalCount);
    assert.ok(readChatTaskScope()?.snapshot?.tasks.some(t => t.name === 'API Task'));
    assert.ok(listTasks().some(t => t.name === 'API Task'));
    await clearChatScope('api');
  });

  test('updateTaskStage rejects invalid stage', async () => {
    await assert.rejects(() => updateTaskStage('fake-id', 0, 'api'), /执行阶段无效/);
  });

  test('updateTaskStage and updateTaskSchedule via API', async () => {
    await clearChatScope('api');
    const task = await createTask({ name: 'Schedule Test' }, 'api');
    const staged = await updateTaskStage(task.id, 3, 'api');
    assert.equal(staged.stage, 3);
    const scheduled = await updateTaskSchedule(task.id, { mode: 'round', roundInterval: 2 }, 'api');
    assert.equal(scheduled.schedule?.mode, 'round');
    assert.equal(scheduled.schedule?.roundInterval, 2);
    await clearChatScope('api');
  });

  test('prompt auto slot/segment CRUD via API', async () => {
    await clearChatScope('api');
    const task = await createTask({ name: 'Auto Segment Test' }, 'api');
    const withSlot = await addPromptAutoSlot(task.id, 0, 'api');
    const slotId = withSlot.promptAutoSlots?.[0]?.id;
    assert.ok(slotId);
    const withSeg = await addPromptAutoSegment(
      task.id,
      slotId!,
      { name: '风味', content: 'hello-auto', inserted: true },
      'api',
    );
    assert.equal(withSeg.promptAutoSegments?.length, 1);
    const merged = buildEffectivePromptGroups(withSeg);
    assert.ok(merged.some(g => g.content === 'hello-auto'));
    await clearChatScope('api');
  });

  test('getEffectiveSettings and getActivePresetName', () => {
    const effective = getEffectiveSettings();
    assert.ok(Array.isArray(effective.tasks));
    assert.equal(getActivePresetName(), String(effective.activePresetName ?? '').trim());
  });

  test('validateReplicaFamily rejects task without dynamic placeholder', async () => {
    await clearChatScope('api');
    const task = await createTask({ name: 'No Replica' }, 'api');
    const result = validateReplicaFamily(task.id);
    assert.equal(result.ok, false);
    await clearChatScope('api');
  });

  test('listReplicaFamilyMembers returns root only when no replicas', async () => {
    await clearChatScope('api');
    const task = await createTask({ name: 'Solo Root' }, 'api');
    const family = listReplicaFamilyMembers(task.id);
    assert.equal(family.length, 1);
    assert.equal(family[0]?.id, task.id);
    await clearChatScope('api');
  });

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`ok ${t.name}`);
    } catch (e) {
      console.error(`FAIL ${t.name}`, e);
      process.exitCode = 1;
    }
  }
})();
