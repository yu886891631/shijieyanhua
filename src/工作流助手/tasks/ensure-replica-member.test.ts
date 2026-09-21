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
  const { clearChatScope, createTask, deleteTask, ensureReplicaFamilyMember, listTasks, replaceTasks } = await import(
    './task-store'
  );
  const { syncReplicaFamily } = await import('./replica-family');

  function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    return Promise.resolve()
      .then(fn)
      .then(() => console.log(`ok ${name}`))
      .catch(e => {
        console.error(`FAIL ${name}`, e);
        process.exitCode = 1;
      });
  }

  await clearChatScope('api');

  const root = await createTask(
    {
      name: '世界时局',
      stage: 2,
      promptGroups: [{ name: '', role: 'user', content: 'do {{世界状态摘要@world}}', enabled: true }],
      extractInjectTags: ['世界状态摘要@world'],
      syncAsReplicaFamily: true,
      replicaFamilySpec: '世界状态摘要@world',
      replicaFamilyEnumSpec: '世界状态摘要@world',
      replicaFamilyScheduleMode: 'manual',
    },
    'api',
  );

  await test('ensure creates member with launched false', async () => {
    const member = await ensureReplicaFamilyMember(root.id, '阿斯塔利亚', { launched: false }, 'api');
    assert.equal(member.replicaFamilyRootId, root.id);
    assert.equal(member.replicaFamilyAttrValue, '阿斯塔利亚');
    assert.equal(member.replicaFamilyLaunched, false);
    assert.ok(listTasks().some(t => t.id === member.id));
  });

  await test('ensure is idempotent for same attr', async () => {
    const before = listTasks().filter(t => t.replicaFamilyRootId === root.id).length;
    const again = await ensureReplicaFamilyMember(root.id, '阿斯塔利亚', { launched: false }, 'api');
    const after = listTasks().filter(t => t.replicaFamilyRootId === root.id).length;
    assert.equal(before, after);
    assert.equal(again.replicaFamilyAttrValue, '阿斯塔利亚');
  });

  await test('ensure can update launched on existing', async () => {
    const updated = await ensureReplicaFamilyMember(root.id, '阿斯塔利亚', { launched: true }, 'api');
    assert.equal(updated.replicaFamilyLaunched, true);
  });

  await test('ensure creates second world member', async () => {
    const member = await ensureReplicaFamilyMember(root.id, '新世界', { launched: false }, 'api');
    assert.equal(member.replicaFamilyAttrValue, '新世界');
    assert.equal(member.replicaFamilyLaunched, false);
    const attrs = listTasks()
      .filter(t => t.replicaFamilyRootId === root.id)
      .map(t => t.replicaFamilyAttrValue)
      .sort();
    assert.deepEqual(attrs, ['阿斯塔利亚', '新世界'].sort());
  });

  // cleanup
  for (const t of [...listTasks()]) {
    await deleteTask(t.id, 'api');
  }
  // silence unused
  void syncReplicaFamily;
  void replaceTasks;
})();
