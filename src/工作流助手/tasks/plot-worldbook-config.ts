import type { PlotWorldbookConfig, PostProcessTask, ScriptSettings } from './schema';

function resolveRootPlotWorldbookConfig(
  root: PostProcessTask | undefined,
  settings: ScriptSettings,
): PlotWorldbookConfig | null {
  if (root?.plotWorldbookMode === 'custom' && root.plotWorldbookConfig) {
    return root.plotWorldbookConfig;
  }
  return null;
}

export function resolveTaskPlotWorldbookConfig(
  task: PostProcessTask,
  settings: ScriptSettings,
): PlotWorldbookConfig {
  if (!settings.taskPlotWorldbookOverridesEnabled) {
    return settings.plotWorldbookConfig;
  }
  if (task.plotWorldbookMode === 'custom' && task.plotWorldbookConfig) {
    return task.plotWorldbookConfig;
  }
  if (task.plotWorldbookMode === 'inheritRoot' && task.replicaFamilyRootId) {
    const root = settings.tasks.find(t => t.id === task.replicaFamilyRootId);
    const fromRoot = resolveRootPlotWorldbookConfig(root, settings);
    if (fromRoot) return fromRoot;
  }
  return settings.plotWorldbookConfig;
}
