import assert from 'node:assert/strict';

const expectedMethods = [
  'listTasks',
  'getTask',
  'createTask',
  'updateTask',
  'deleteTask',
  'replaceTasks',
  'getChatScopeState',
  'clearChatScope',
  'promoteChatScopeToPreset',
  'saveChatSnapshotAsGlobalPreset',
  'setChatScopeActiveView',
  'updatePresetFields',
  'updateTaskPlotWorldbook',
  'updateTaskContext',
  'updatePromptGroup',
  'updateTaskStage',
  'updateTaskSchedule',
  'updateTaskExtractTags',
  'updateTaskExecutionOptions',
  'updateTaskApiPreset',
  'updateTaskApiPresetRouting',
  'updateTaskApiPresetMode',
  'addPromptGroup',
  'removePromptGroup',
  'movePromptGroup',
  'addPromptAutoSlot',
  'removePromptAutoSlot',
  'updatePromptAutoSlot',
  'addPromptAutoSegment',
  'removePromptAutoSegment',
  'updatePromptAutoSegment',
  'setTaskEnabled',
  'renameTask',
  'duplicateTask',
  'moveTask',
  'moveTaskToIndex',
  'rerunCurrentFloor',
  'triggerTask',
  'getEffectiveSettings',
  'getActivePresetName',
  'getLastPromptMessages',
  'getLastPlaceholderVars',
  'buildEffectivePromptGroups',
  'validateReplicaFamily',
  'listReplicaFamilyMembers',
  'updateReplicaFamilyScheduleMode',
  'updateReplicaMemberSchedule',
  'ensureReplicaFamilyMember',
  'listReplicaFamilySchedule',
  'getReplicaFamilyCleanupConfig',
  'updateReplicaFamilyCleanupConfig',
  'listReplicaFamilyCleanupCandidates',
  'applyReplicaFamilyCleanup',
  'resetReplicaFamilyCleanupCycle',
  'listTaskWorkflowPresets',
  'saveTaskWorkflowPreset',
  'applyTaskWorkflowPreset',
  'deleteTaskWorkflowPreset',
  'getLastRunStatus',
  'getRunStatusForFloor',
  'listApiPresets',
  'resolveTaskApiPresetName',
  'resetTaskScheduleState',
] as const;

async function main(): Promise<void> {
  try {
    const g = globalThis as Record<string, unknown>;
    g.getVariables = () => ({});
    g.getScriptId = () => 'test-script';
    g.insertOrAssignVariables = () => {};
    g.defineStore = () => () => ({});
    g.ref = (v: unknown) => ({ value: v });
    g.computed = (fn: () => unknown) => ({ value: fn() });
    g.watch = () => {};
    g.eventOn = () => {};
    g.eventOff = () => {};
    g.eventEmit = () => {};
    g.getCurrentMessageId = () => 0;
    g.getChatMessages = () => [];
    g.substituteParams = (s: string) => s;
    g.generateRaw = async () => '';
    g.TavernHelper = {};

    const { acuPostProcessTaskApi } = await import('./post-process-api.js');
    const missing = expectedMethods.filter(m => typeof acuPostProcessTaskApi[m] !== 'function');
    assert.deepEqual(missing, []);
    assert.equal(expectedMethods.length, 61);

    const exposed = acuPostProcessTaskApi.getEffectiveSettings();
    assert.equal(exposed.apiConfig.apiKey, '');
    for (const preset of exposed.apiPresets) {
      assert.equal(preset.apiConfig.apiKey, '');
    }

    console.log('ok acuPostProcessTaskApi exposes all P0-P2 methods');
  } catch (e) {
    console.error('FAIL acuPostProcessTaskApi exposes all P0-P2 methods', e);
    process.exitCode = 1;
  }
}

main().then(() => {
  if (process.exitCode) process.exit(process.exitCode);
});
