import { loadSettings, saveSettings } from '../settings';
import {
  buildChatSnapshotFromSettings,
  ensureChatOverride,
  isChatOverrideActive,
  readChatTaskScope,
  writeChatTaskScope,
} from './chat-task-scope';
import { emitChatScopeChanged, emitTasksChanged } from './events';
import { shouldWriteRuntimeTasksToGlobal } from './persist-runtime-tasks-logic';
import { isReplicaFamilyMember, stripReplicaFamilyMembers } from './replica-family';
import {
  ChatTaskScopeStateSchema,
  PostProcessPresetSchema,
  type PostProcessTask,
  type ScriptSettings,
} from './schema';

export { shouldWriteRuntimeTasksToGlobal } from './persist-runtime-tasks-logic';

function tasksHaveReplicaMembers(tasks: PostProcessTask[]): boolean {
  return tasks.some(t => isReplicaFamilyMember(t));
}

/** 将运行时 tasks（已剥离成员）同步进当前活动任务预设，避免预设保留聊天内副本。 */
export function syncActivePresetTasksFromRuntime(settings: ScriptSettings): void {
  const name = settings.activePresetName?.trim();
  if (!name) return;
  const idx = settings.presets.findIndex(p => p.name === name);
  if (idx < 0) return;
  settings.presets[idx] = {
    ...settings.presets[idx]!,
    tasks: stripReplicaFamilyMembers(_.cloneDeep(settings.tasks)),
  };
}

/**
 * 退出/切换聊天后：剥掉全局工作副本与全部全局预设槽中泄漏的任务副本。
 * 不清除聊天快照（快照跟 chat 文件走）。
 */
export function sanitizeGlobalTasksAfterChatChange(): boolean {
  const settings = loadSettings();
  const strippedTasks = stripReplicaFamilyMembers(settings.tasks);
  let changed = strippedTasks.length !== settings.tasks.length;
  settings.tasks = strippedTasks;

  settings.presets = settings.presets.map(preset => {
    const strippedPresetTasks = stripReplicaFamilyMembers(preset.tasks);
    if (strippedPresetTasks.length !== preset.tasks.length) {
      changed = true;
      return { ...preset, tasks: strippedPresetTasks };
    }
    return preset;
  });

  if (!changed) return false;
  saveSettings(settings);
  void emitTasksChanged('replace', 'api');
  return true;
}

/** 剥掉指定全局预设槽中的任务副本；若为活动预设则同步顶层 tasks */
export function sanitizeNamedGlobalPresetMembers(presetName: string): boolean {
  const name = presetName.trim();
  if (!name) return false;
  const settings = loadSettings();
  const idx = settings.presets.findIndex(p => p.name === name);
  if (idx < 0) return false;

  const preset = settings.presets[idx]!;
  const stripped = stripReplicaFamilyMembers(preset.tasks);
  let changed = stripped.length !== preset.tasks.length;
  if (changed) {
    settings.presets[idx] = { ...preset, tasks: stripped };
  }

  if (settings.activePresetName.trim() === name) {
    const top = stripReplicaFamilyMembers(settings.tasks);
    if (top.length !== settings.tasks.length) {
      settings.tasks = top;
      changed = true;
    } else if (changed) {
      settings.tasks = _.cloneDeep(stripped);
    }
  }

  if (!changed) return false;
  saveSettings(settings);
  return true;
}

function writeBoundGlobalTasksInPlace(
  settings: ScriptSettings,
  tasks: PostProcessTask[],
  boundName: string,
): void {
  const idx = settings.presets.findIndex(p => p.name === boundName);
  if (idx < 0) {
    throw new Error(`绑定的全局预设不存在: ${boundName}`);
  }
  const prev = settings.presets[idx]!;
  settings.presets[idx] = PostProcessPresetSchema.parse({
    ...prev,
    name: boundName,
    tasks: _.cloneDeep(tasks),
  });
  if (settings.activePresetName.trim() === boundName) {
    settings.tasks = _.cloneDeep(tasks);
  }
}

/** 将运行时副本同步、launched 等变更写回持久化存储 */
export async function persistRuntimeTaskChanges(
  baseSettings: ScriptSettings,
  effectiveSettings: ScriptSettings,
): Promise<void> {
  baseSettings.replicaFamilyCleanup = _.cloneDeep(effectiveSettings.replicaFamilyCleanup);
  let scope = readChatTaskScope();
  let chatOverride = isChatOverrideActive(scope) && !!scope?.snapshot;
  const hasMembers = tasksHaveReplicaMembers(effectiveSettings.tasks);
  let createdSnapshot = false;

  // 有成员且尚无快照：强制进聊天快照，避免污染全局预设
  if (hasMembers && !chatOverride) {
    const ensured = await ensureChatOverride(baseSettings, 'api');
    scope = ensured.scope;
    createdSnapshot = ensured.created;
    chatOverride = true;
  }

  if (chatOverride) {
    const boundName =
      scope!.activeView === 'global' ? scope!.boundGlobalPresetName?.trim() || '' : '';

    if (boundName) {
      // 浏览全局：先写绑定槽，再覆盖快照并切回 snapshot 视图；更新来源名
      writeBoundGlobalTasksInPlace(baseSettings, effectiveSettings.tasks, boundName);
      const snapshot = buildChatSnapshotFromSettings(effectiveSettings);
      await writeChatTaskScope(
        ChatTaskScopeStateSchema.parse({
          ...scope!,
          snapshot,
          originPresetName: boundName,
          activeView: 'snapshot',
          boundGlobalPresetName: '',
          updatedAt: Date.now(),
          source: 'api',
        }),
      );
    } else {
      // 快照视图：只写 snapshot；写回后保持/切回 snapshot
      await writeChatTaskScope({
        ...scope!,
        snapshot: {
          ...scope!.snapshot!,
          tasks: _.cloneDeep(effectiveSettings.tasks),
        },
        activeView: 'snapshot',
        boundGlobalPresetName: '',
        updatedAt: Date.now(),
      });
    }
  } else if (shouldWriteRuntimeTasksToGlobal(chatOverride)) {
    baseSettings.tasks = stripReplicaFamilyMembers(_.cloneDeep(effectiveSettings.tasks));
    syncActivePresetTasksFromRuntime(baseSettings);
  }

  saveSettings(baseSettings);
  if (createdSnapshot) {
    await emitChatScopeChanged('chat_override', scope?.originPresetName, { createdSnapshot: true });
  }
  await emitTasksChanged('replace', 'api');
}
