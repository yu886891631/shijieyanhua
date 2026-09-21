import { TaskScheduleSchema, type TaskSchedule } from './schema';

export type TaskSchedulePatch = {
  mode?: 'round' | 'time';
  roundInterval?: number;
  timeInterval?: Partial<NonNullable<TaskSchedule['timeInterval']>>;
};

export function defaultTimeInterval(): NonNullable<TaskSchedule['timeInterval']> {
  return {
    enabled: false,
    value: 1,
    unit: 'hour',
    timeSource: { type: 'message_tag', tagNames: ['time'], scope: 'current_ai' },
  };
}

export function ensureScheduleShape(schedule?: TaskSchedule): TaskSchedule {
  const base: TaskSchedule = schedule ? _.cloneDeep(schedule) : { mode: 'round' };
  if (!base.timeInterval) {
    base.timeInterval = defaultTimeInterval();
  }
  return base;
}

export function mergeTaskSchedule(existing: TaskSchedule | undefined, patch: TaskSchedulePatch): TaskSchedule {
  const merged = ensureScheduleShape(existing);

  if (patch.roundInterval !== undefined) {
    merged.roundInterval = patch.roundInterval;
  }

  if (patch.timeInterval) {
    const ti = merged.timeInterval!;
    const p = patch.timeInterval;
    if (p.enabled !== undefined) ti.enabled = p.enabled;
    if (p.value !== undefined) ti.value = p.value;
    if (p.unit !== undefined) ti.unit = p.unit;
    // onParseFail / parseFormat 已废弃：读入旧配置时忽略
    if (p.timeSource !== undefined) {
      ti.timeSource = _.cloneDeep(p.timeSource) as typeof ti.timeSource;
    }
  }

  if (patch.mode !== undefined) {
    merged.mode = patch.mode;
    merged.timeInterval!.enabled = patch.mode === 'time';
  }

  return merged;
}

export function parseTaskSchedule(schedule: TaskSchedule): TaskSchedule {
  return TaskScheduleSchema.parse(schedule);
}

/** 确保任务对象含完整 schedule 骨架（供 UI 就地编辑） */
export function ensureTaskSchedule(task: { schedule?: TaskSchedule }): void {
  task.schedule = ensureScheduleShape(task.schedule);
}
