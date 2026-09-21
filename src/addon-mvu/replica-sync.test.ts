import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import { ensureWorldReplicaMember, WORLD_REPLICA_SPEC } from './replica-sync';

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok ${name}`))
    .catch(e => {
      console.error(`FAIL ${name}`, e);
      process.exitCode = 1;
    });
}

void (async () => {
  const g = globalThis as typeof globalThis & { window?: { parent?: unknown } };

  await test('ensureWorldReplicaMember warns when API missing', async () => {
    g.window = { parent: {} };
    const warnings = await ensureWorldReplicaMember('测试世界', false);
    assert.ok(warnings.some(w => w.includes('AcuPostProcessAPI')));
  });

  await test('ensureWorldReplicaMember creates via mock API', async () => {
    const calls: Array<{ rootId: string; attr: string; launched?: boolean }> = [];
    const root = {
      id: 'root-1',
      syncAsReplicaFamily: true,
      replicaFamilySpec: WORLD_REPLICA_SPEC,
      replicaFamilyEnumSpec: WORLD_REPLICA_SPEC,
      replicaFamilyScheduleMode: 'auto' as const,
      name: '世界时局',
    };
    const members: Array<{
      id: string;
      replicaFamilyRootId?: string;
      replicaFamilyAttrValue?: string;
      replicaFamilyLaunched?: boolean;
    }> = [];

    g.window = {
      parent: {
        AcuPostProcessAPI: {
          listTasks: () => [root],
          listReplicaFamilyMembers: () => [root, ...members],
          updateReplicaFamilyScheduleMode: async (_id: string, mode: 'auto' | 'manual') => {
            root.replicaFamilyScheduleMode = mode;
            return root;
          },
          updateReplicaMemberSchedule: async () => members[0],
          ensureReplicaFamilyMember: async (rootId: string, attr: string, options?: { launched?: boolean }) => {
            calls.push({ rootId, attr, launched: options?.launched });
            const m = {
              id: `m-${attr}`,
              replicaFamilyRootId: rootId,
              replicaFamilyAttrValue: attr,
              replicaFamilyLaunched: options?.launched ?? false,
            };
            members.push(m);
            return m;
          },
          replaceTasks: async () => {},
        },
      },
    };

    const warnings = await ensureWorldReplicaMember('新世界', false);
    assert.equal(warnings.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.attr, '新世界');
    assert.equal(calls[0]?.launched, false);
    assert.equal(root.replicaFamilyScheduleMode, 'manual');
  });
})();
