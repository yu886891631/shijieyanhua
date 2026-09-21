import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import type { PostProcessTask, ScriptSettings } from './schema';
import {
  clearPendingReplicaRenames,
  recordPendingReplicaRenames,
  takePendingReplicaRenames,
} from './replica-enum-pending';
import { composePendingReplicaRenames } from './replica-enum-parse';
import { applyPendingReplicaRenames } from './replica-enum-rename';
import {
  canMigrateFloorTagKeysForReplica,
  createDefaultReplicaFamilyCleanup,
  remapLastManualKeepAttrValue,
} from './replica-family-cleanup';
import { mergeReplicaFamilyFromRelay, renameReplicaFamilyMemberAttr } from './replica-family';
import { rewriteSnapshotListForAttrRename } from './migrate-applied-for-replica';
import { remapReplicaRootAttrValueInSnapshot } from './replica-state';

function baseTask(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: 'root-1',
    name: '处理 item',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'do {{item@id}}', enabled: true }],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '处理 item',
    ...overrides,
  };
}

async function main(): Promise<void> {
  clearPendingReplicaRenames();
  recordPendingReplicaRenames(5, [
    { specKey: 'item@id', from: 'a', to: 'b' },
    { specKey: 'item@id', from: 'a', to: 'c' },
  ]);
  assert.deepEqual(takePendingReplicaRenames(5), [
    { specKey: 'item@id', from: 'a', to: 'c', taskRef: undefined },
  ]);
  assert.deepEqual(takePendingReplicaRenames(5), []);
  assert.deepEqual(takePendingReplicaRenames(99), []);
  console.log('ok pending renames scoped by messageId');

  {
    const composed = composePendingReplicaRenames([
      { specKey: 'item@id', from: 'a', to: 'b' },
      { specKey: 'item@id', from: 'b', to: 'c' },
    ]);
    assert.deepEqual(composed, [
      { specKey: 'item@id', from: 'a', to: 'b', taskRef: undefined },
      { specKey: 'item@id', from: 'b', to: 'c', taskRef: undefined },
    ]);
    console.log('ok composePendingReplicaRenames chains renames');
  }

  {
    const next = remapReplicaRootAttrValueInSnapshot(
      {
        'root-1': {
          attrValues: ['断剑', '药剂'],
          launchedAttrValues: ['断剑'],
          lastEnumAttrValues: ['断剑', '药剂'],
        },
      },
      'root-1',
      '断剑',
      '锈剑',
    );
    assert.deepEqual(next['root-1']?.attrValues, ['锈剑', '药剂']);
    console.log('ok remapReplicaRootAttrValueInSnapshot remaps lists');
  }

  {
    clearPendingReplicaRenames();
    const root = baseTask();
    let tasks = mergeReplicaFamilyFromRelay(root, ['断剑'], [root]).tasks;
    const memberId = tasks.find(t => t.replicaFamilyAttrValue === '断剑')!.id;
    tasks = await applyPendingReplicaRenames({
      messageId: -1,
      tasks,
      rules: [],
      renames: [{ specKey: 'item@id', from: '断剑', to: '锈剑' }],
      skipWorldbook: true,
      skipReplicaStateWrite: true,
    });
    const renamed = tasks.find(t => t.id === memberId)!;
    assert.equal(renamed.replicaFamilyAttrValue, '锈剑');
    console.log('ok applyPendingReplicaRenames renames member without worldbook');
  }

  {
    const root = baseTask();
    let tasks = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]).tasks;
    const member1Id = tasks.find(t => t.replicaFamilyAttrValue === '1')!.id;
    tasks = await applyPendingReplicaRenames({
      messageId: -1,
      tasks,
      rules: [],
      renames: [{ specKey: 'item@id', from: '1', to: '2' }],
      skipWorldbook: true,
      skipReplicaStateWrite: true,
    });
    assert.equal(tasks.find(t => t.id === member1Id)?.replicaFamilyAttrValue, '1');
    console.log('ok preflight skips rename when to member exists');
  }

  {
    const root = baseTask();
    let tasks = mergeReplicaFamilyFromRelay(root, ['b'], [root]).tasks;
    const memberId = tasks.find(t => t.replicaFamilyAttrValue === 'b')!.id;
    tasks = await applyPendingReplicaRenames({
      messageId: -1,
      tasks,
      rules: [],
      renames: [
        { specKey: 'item@id', from: 'a', to: 'b' },
        { specKey: 'item@id', from: 'b', to: 'c' },
      ],
      skipWorldbook: true,
      skipReplicaStateWrite: true,
    });
    assert.equal(tasks.find(t => t.id === memberId)?.replicaFamilyAttrValue, 'c');
    console.log('ok apply soft-skips missing from and applies next edge');
  }

  {
    const root = baseTask();
    let tasks = mergeReplicaFamilyFromRelay(root, ['断剑'], [root]).tasks;
    const memberId = tasks.find(t => t.replicaFamilyAttrValue === '断剑')!.id;
    const rules = [
      {
        id: 'rule-wb',
        targetTag: 'item@id',
        template: '',
        entryName: '',
        bookSource: 'manual',
        manualBookName: 'BookA',
        splitByAttr: true,
        entryType: 'keyword',
        keywords: '',
        wrapTagName: '',
        placement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        preventRecursion: true,
      },
    ] as import('./schema').ChatWorldbookWriteRule[];
    tasks = await applyPendingReplicaRenames({
      messageId: -1,
      tasks,
      rules,
      renames: [{ specKey: 'item@id', from: '断剑', to: '锈剑' }],
      skipReplicaStateWrite: true,
      worldbookMigrator: async () => ({
        migrated: 0,
        failedTargets: ['WorkflowHelper-item id-锈剑'],
        expectedEntryMigrations: 1,
      }),
    });
    assert.equal(tasks.find(t => t.id === memberId)?.replicaFamilyAttrValue, '断剑');
    console.log('ok migration failure rolls back task rename');
  }

  {
    const settings = {
      tasks: [],
      replicaFamilyCleanup: {
        ...createDefaultReplicaFamilyCleanup(true),
        lastManualKeepBySpec: { 'item@id': ['断剑', '药剂'] },
      },
    } as unknown as ScriptSettings;
    remapLastManualKeepAttrValue(settings, 'item@id', '断剑', '锈剑');
    assert.deepEqual(settings.replicaFamilyCleanup!.lastManualKeepBySpec!['item@id'], [
      '锈剑',
      '药剂',
    ]);
    console.log('ok remapLastManualKeepAttrValue');
  }

  {
    const { next, changed } = rewriteSnapshotListForAttrRename(
      [
        {
          bookName: 'BookA',
          entryName: 'WorkflowHelper-item id-断剑',
          uid: 1,
          content: 'x',
          enabled: true,
          existed: true,
        },
      ],
      'WorkflowHelper-item id-断剑',
      'WorkflowHelper-item id-锈剑',
      'BookA',
    );
    assert.equal(changed, 1);
    assert.equal(next[0]!.entryName, 'WorkflowHelper-item id-锈剑');
    console.log('ok rewriteSnapshotListForAttrRename');
  }

  {
    const g = globalThis as Record<string, unknown>;
    g.getChatMessages = (id: number) =>
      id === 0 ? [{ role: 'assistant', message: 'x', message_id: 0 }] : [];
    g.getVariables = () => ({
      post_process_tags: { item_id: { '断剑': 'a' }, 'item@id=b': 'exists' },
    });
    assert.equal(canMigrateFloorTagKeysForReplica('item@id', '断剑', 'b', 0), false);
    console.log('ok canMigrateFloorTagKeysForReplica detects flat target conflict');
  }

  {
    const root = baseTask();
    const tasks = mergeReplicaFamilyFromRelay(root, ['1'], [root]).tasks;
    const result = renameReplicaFamilyMemberAttr(
      tasks.find(t => t.id === root.id)!,
      'nope',
      'x',
      tasks,
    );
    assert.equal(result.renamed, false);
    console.log('ok renameReplicaFamilyMemberAttr missing from skips');
  }

  {
    const root = baseTask();
    const tasks = mergeReplicaFamilyFromRelay(root, ['波尔特・瓦伦'], [root]).tasks;
    const result = renameReplicaFamilyMemberAttr(
      tasks.find(t => t.id === root.id)!,
      '波尔特・瓦伦',
      '波尔特·瓦伦',
      tasks,
    );
    assert.equal(result.renamed, false);
    console.log('ok renameReplicaFamilyMemberAttr same identity is no-op');
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
