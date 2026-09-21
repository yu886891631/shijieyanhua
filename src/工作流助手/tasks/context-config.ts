import type { PostProcessTask, ScriptSettings, TaskContextConfig } from './schema';

export function pickGlobalContextConfig(settings: ScriptSettings): TaskContextConfig {
  return {
    contextTurnCount: settings.contextTurnCount,
    contextExtractRules: settings.contextExtractRules,
    contextExcludeRules: settings.contextExcludeRules,
  };
}

export function resolveTaskContextConfig(task: PostProcessTask, settings: ScriptSettings): TaskContextConfig {
  if (!settings.taskContextOverridesEnabled) {
    return pickGlobalContextConfig(settings);
  }
  if (task.contextMode === 'custom' && task.contextConfig) {
    return task.contextConfig;
  }
  return pickGlobalContextConfig(settings);
}

/** 将任务有效上下文配置合并进 settings 切片，供 buildAssistantContextSlice 等复用 */
export function settingsWithTaskContext(settings: ScriptSettings, task: PostProcessTask): ScriptSettings {
  const cfg = resolveTaskContextConfig(task, settings);
  return {
    ...settings,
    contextTurnCount: cfg.contextTurnCount,
    contextExtractRules: cfg.contextExtractRules,
    contextExcludeRules: cfg.contextExcludeRules,
  };
}
