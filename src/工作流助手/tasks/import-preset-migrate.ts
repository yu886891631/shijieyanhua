import { normalizePromptRole } from './prompt-role';

type MutableRecord = Record<string, unknown>;

function migrateExtractTags(task: MutableRecord): void {
  const legacy = Array.isArray(task.extractTags) ? (task.extractTags as string[]) : [];
  const inject = Array.isArray(task.extractInjectTags) ? (task.extractInjectTags as string[]) : [];
  if (legacy.length) {
    const merged = [...new Set([...inject, ...legacy].map(t => String(t).trim()).filter(Boolean))];
    task.extractInjectTags = merged;
  }
  delete task.extractTags;
}

function migratePromptGroups(task: MutableRecord): void {
  if (!Array.isArray(task.promptGroups) && Array.isArray(task.promptGroup)) {
    task.promptGroups = task.promptGroup;
    delete task.promptGroup;
  }

  if (!Array.isArray(task.promptGroups)) return;

  task.promptGroups = task.promptGroups.map(group => {
    if (!group || typeof group !== 'object') return group;
    const item = group as MutableRecord;
    return {
      ...item,
      name: typeof item.name === 'string' ? item.name : '',
      role: normalizePromptRole(item.role),
      enabled: item.enabled !== false,
    };
  });
}

function migrateTaskList(tasks: unknown): void {
  if (!Array.isArray(tasks)) return;
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    migrateExtractTags(task as MutableRecord);
    migratePromptGroups(task as MutableRecord);
    delete (task as MutableRecord).order;
  }
}

export function migrateImportedPreset(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const clone = _.cloneDeep(raw) as MutableRecord;

  migrateTaskList(clone.tasks);
  migrateTaskList(clone.plotTasks);

  if (Array.isArray(clone.plotTasks) && !Array.isArray(clone.tasks)) {
    clone.tasks = clone.plotTasks;
    delete clone.plotTasks;
  }

  if (Array.isArray(clone.presets)) {
    for (const preset of clone.presets) {
      if (!preset || typeof preset !== 'object') continue;
      migrateTaskList((preset as MutableRecord).tasks);
      migrateTaskList((preset as MutableRecord).plotTasks);
    }
  }

  return clone;
}
