/**
 * 集成单测：模拟 runtime / trigger 中 rename pending 的阶段 apply、轮末 flush、异常 flush。
 * 不调用真实 API；覆盖副本族两阶段、单阶段、无副本族等路径。
 */
import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import type { PostProcessTask, ScriptSettings } from './schema';
import {
  clearPendingReplicaRenames,
  recordPendingReplicaRenames,
  takePendingReplicaRenames,
} from './replica-enum-pending';
import {
  collectReplicaEnumRenames,
  parseReplicaEnumFromResponse,
  replicaEnumResultToRegistryTags,
} from './replica-enum-parse';
import { applyPendingReplicaRenames } from './replica-enum-rename';
import { mergeReplicaFamilyFromRelay, prepareStageTasksWithReplicaSync } from './replica-family';
import { mergeRelayTagMap, type RelayTagMap } from './utils';

function baseRoot(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
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
    replicaFamilyScheduleMode: 'auto',
    ...overrides,
  };
}

function minimalSettings(tasks: PostProcessTask[]): ScriptSettings {
  return {
    enabled: true,
    tasks,
    chatWorldbookWriteRules: [],
    replicaFamilyCleanup: {
      enabled: false,
      mode: 'manual',
      intervalRounds: 10,
      runCountSinceLastCleanup: 0,
      lastManualKeepBySpec: {},
    },
  } as unknown as ScriptSettings;
}

async function applyRenameAtStageStart(
  messageId: number,
  settings: ScriptSettings,
): Promise<void> {
  settings.tasks = await applyPendingReplicaRenames({
    messageId,
    tasks: settings.tasks,
    rules: settings.chatWorldbookWriteRules ?? [],
    settings,
  });
}

async function flushRenameAtRoundEnd(
  messageId: number,
  settings: ScriptSettings,
  cancelled = false,
): Promise<void> {
  if (cancelled) return;
  settings.tasks = await applyPendingReplicaRenames({
    messageId,
    tasks: settings.tasks,
    rules: settings.chatWorldbookWriteRules ?? [],
    settings,
  });
}

async function flushRenameOnWorkflowError(
  messageId: number,
  settings: ScriptSettings,
): Promise<void> {
  settings.tasks = await applyPendingReplicaRenames({
    messageId,
    tasks: settings.tasks,
    rules: settings.chatWorldbookWriteRules ?? [],
    settings,
  });
  clearPendingReplicaRenames(messageId);
}

function simulateStage1EnumRecord(
  messageId: number,
  response: string,
): { relayTags: Record<string, string> } {
  const enumParsed = parseReplicaEnumFromResponse(response);
  recordPendingReplicaRenames(messageId, collectReplicaEnumRenames(enumParsed));
  return { relayTags: replicaEnumResultToRegistryTags(enumParsed) };
}

async function main(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  g.getChatMessages = (id: number) =>
    typeof id === 'number' && id >= 0
      ? [{ role: 'assistant', message: 'x', message_id: id }]
      : [];
  g.getVariables = () => ({ post_process_tags: {} });
  g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) =>
    fn({ post_process_tags: {} });

  {
    const messageId = 10;
    clearPendingReplicaRenames(messageId);

    const root = baseRoot({ stage: 2 });
    const settings = minimalSettings(
      mergeReplicaFamilyFromRelay(root, ['断剑'], [root]).tasks,
    );
    const memberBefore = settings.tasks.find(t => t.replicaFamilyAttrValue === '断剑');
    assert.ok(memberBefore);

    const { relayTags } = simulateStage1EnumRecord(
      messageId,
      '<ReplicaEnum>{"spec":"item@id","renames":[{"from":"断剑","to":"锈剑"}],"values":["锈剑"]}</ReplicaEnum>',
    );
    assert.ok(Object.keys(relayTags).some(k => k.includes('锈剑')));

    await applyRenameAtStageStart(messageId, settings);

    const memberAfter = settings.tasks.find(t => t.id === memberBefore!.id);
    assert.equal(memberAfter?.replicaFamilyAttrValue, '锈剑');
    assert.deepEqual(takePendingReplicaRenames(messageId), []);

    const relayMap: RelayTagMap = new Map();
    mergeRelayTagMap(relayMap, relayTags);
    const prepared = prepareStageTasksWithReplicaSync(
      [settings.tasks.find(t => t.id === root.id)!],
      settings.tasks,
      relayMap,
    );
    const runnable = prepared.tasks.filter(t => t.replicaFamilyRootId === root.id);
    assert.equal(runnable.length, 1);
    assert.equal(runnable[0]!.replicaFamilyAttrValue, '锈剑');

    await flushRenameAtRoundEnd(messageId, settings);
    assert.equal(
      settings.tasks.find(t => t.id === memberBefore!.id)?.replicaFamilyAttrValue,
      '锈剑',
    );
    console.log('ok two-stage S1 rename S2 stage-start apply and prepare');
  }

  {
    const messageId = 11;
    clearPendingReplicaRenames(messageId);

    const root = baseRoot({ stage: 1 });
    const settings = minimalSettings(
      mergeReplicaFamilyFromRelay(root, ['断剑'], [root]).tasks,
    );
    const memberId = settings.tasks.find(t => t.replicaFamilyAttrValue === '断剑')!.id;

    await applyRenameAtStageStart(messageId, settings);
    simulateStage1EnumRecord(
      messageId,
      '<ReplicaEnum>{"spec":"item@id","renames":[{"from":"断剑","to":"锈剑"}],"values":["锈剑"]}</ReplicaEnum>',
    );

    await flushRenameAtRoundEnd(messageId, settings);
    assert.equal(
      settings.tasks.find(t => t.id === memberId)?.replicaFamilyAttrValue,
      '锈剑',
    );
    assert.deepEqual(takePendingReplicaRenames(messageId), []);
    console.log('ok single-stage end flush applies rename');
  }

  {
    const messageId = 12;
    clearPendingReplicaRenames(messageId);

    const root = baseRoot();
    const settings = minimalSettings(
      mergeReplicaFamilyFromRelay(root, ['a'], [root]).tasks,
    );
    recordPendingReplicaRenames(messageId, [{ specKey: 'item@id', from: 'a', to: 'b' }]);

    await applyRenameAtStageStart(messageId, settings);
    const tasksAfterStage = lodash.cloneDeep(settings.tasks);

    await flushRenameAtRoundEnd(messageId, settings);
    assert.deepEqual(settings.tasks, tasksAfterStage);
    console.log('ok end flush noop after stage-start consumed pending');
  }

  {
    const messageId = 13;
    clearPendingReplicaRenames(messageId);

    const root = baseRoot();
    const settings = minimalSettings(
      mergeReplicaFamilyFromRelay(root, ['旧名'], [root]).tasks,
    );
    const memberId = settings.tasks.find(t => t.replicaFamilyAttrValue === '旧名')!.id;

    recordPendingReplicaRenames(messageId, [{ specKey: 'item@id', from: '旧名', to: '新名' }]);
    await flushRenameOnWorkflowError(messageId, settings);

    assert.equal(settings.tasks.find(t => t.id === memberId)?.replicaFamilyAttrValue, '新名');
    assert.deepEqual(takePendingReplicaRenames(messageId), []);
    console.log('ok workflow error flush applies rename and clears pending');
  }

  {
    const messageId = 14;
    clearPendingReplicaRenames(messageId);

    const plain: PostProcessTask = {
      id: 'plain-1',
      name: 'plain',
      enabled: true,
      stage: 1,
      promptGroups: [{ name: '', role: 'user', content: 'hi', enabled: true }],
      extractInjectTags: ['result'],
      mergeStrategy: 'concat',
      maxRetries: 1,
      minLength: 0,
      apiPresetName: '',
      plotWorldbookMode: 'inherit',
      contextMode: 'inherit',
      structuredOutputMode: 'off',
    };
    const settings = minimalSettings([plain]);
    const before = lodash.cloneDeep(settings.tasks);

    await applyRenameAtStageStart(messageId, settings);
    await flushRenameAtRoundEnd(messageId, settings);

    assert.deepEqual(settings.tasks, before);
    assert.deepEqual(takePendingReplicaRenames(messageId), []);
    console.log('ok no replica family leaves plain tasks unchanged');
  }

  {
    const messageId = 15;
    clearPendingReplicaRenames(messageId);

    const root = baseRoot({ stage: 1 });
    const settings = minimalSettings(
      mergeReplicaFamilyFromRelay(root, ['x'], [root]).tasks,
    );
    const memberId = settings.tasks.find(t => t.replicaFamilyAttrValue === 'x')!.id;

    recordPendingReplicaRenames(messageId, [{ specKey: 'item@id', from: 'x', to: 'y' }]);
    await flushRenameAtRoundEnd(messageId, settings, true);

    assert.equal(settings.tasks.find(t => t.id === memberId)?.replicaFamilyAttrValue, 'x');
    assert.equal(takePendingReplicaRenames(messageId).length, 1);

    clearPendingReplicaRenames(messageId);
    console.log('ok cancelled round skips end flush');
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
