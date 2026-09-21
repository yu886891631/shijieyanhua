import { PostProcessTaskSchema, type PostProcessTask } from './schema';
import { clearReplicaFamilyFieldsOnClone } from './replica-family';

export function newTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function uniqueTaskName(base: string, existingNames: string[]): string {
  const trimmed = base.trim() || '未命名任务';
  const existing = new Set(existingNames.map(n => n.trim()));
  if (!existing.has(trimmed)) return trimmed;

  const copyBase = `${trimmed} 副本`;
  if (!existing.has(copyBase)) return copyBase;

  let i = 2;
  while (existing.has(`${copyBase} ${i}`)) i++;
  return `${copyBase} ${i}`;
}

export function cloneTaskForInsert(source: PostProcessTask, existingTasks: PostProcessTask[]): PostProcessTask {
  const cloned = clearReplicaFamilyFieldsOnClone(_.cloneDeep(source));
  cloned.id = newTaskId();
  cloned.name = uniqueTaskName(
    source.name,
    existingTasks.map(t => t.name),
  );
  return PostProcessTaskSchema.parse(cloned);
}
