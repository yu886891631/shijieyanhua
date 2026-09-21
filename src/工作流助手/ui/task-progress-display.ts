export type TaskProgressStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface TaskProgressItem {
  taskId: string;
  taskName: string;
  status: TaskProgressStatus;
  detail?: string;
}

export interface TaskProgressSnapshot {
  headline: string;
  stageNo?: number;
  tasks: TaskProgressItem[];
}

export const COMPLETION_HOLD_MS = 700;
export const LEAVE_ANIMATION_MS = 250;

export type DisplayPhase = 'pending' | 'running' | 'completing' | 'leaving';

export interface ProgressDisplayItem extends TaskProgressItem {
  displayPhase: DisplayPhase;
}

export type ProgressDisplayState = {
  stageNo?: number;
  items: Map<string, ProgressDisplayItem>;
  /** 已完成离开动画并移除的任务；同阶段后续快照仍为终态时不再重建为 completing */
  dismissed: Set<string>;
};

export function createProgressDisplayState(): ProgressDisplayState {
  return { stageNo: undefined, items: new Map(), dismissed: new Set() };
}

function isTerminalStatus(status: TaskProgressStatus): boolean {
  return status === 'done' || status === 'skipped' || status === 'failed';
}

function phaseFromStatus(status: TaskProgressStatus): DisplayPhase {
  if (status === 'running') return 'running';
  return 'pending';
}

function toDisplayItem(task: TaskProgressItem, phase: DisplayPhase): ProgressDisplayItem {
  return { ...task, displayPhase: phase };
}

export function applyProgressSnapshot(
  state: ProgressDisplayState,
  snapshot: TaskProgressSnapshot,
): ProgressDisplayState {
  const next: ProgressDisplayState = {
    stageNo: snapshot.stageNo,
    items: new Map(state.items),
    dismissed: new Set(state.dismissed),
  };

  if (state.stageNo !== undefined && snapshot.stageNo !== undefined && state.stageNo !== snapshot.stageNo) {
    next.items = new Map();
    next.dismissed = new Set();
  }

  const snapshotIds = new Set(snapshot.tasks.map(t => t.taskId));

  for (const task of snapshot.tasks) {
    const existing = next.items.get(task.taskId);
    const terminal = isTerminalStatus(task.status);

    if (!existing) {
      if (terminal) {
        if (next.dismissed.has(task.taskId)) continue;
        next.items.set(task.taskId, toDisplayItem(task, 'completing'));
      } else {
        next.dismissed.delete(task.taskId);
        next.items.set(task.taskId, toDisplayItem(task, phaseFromStatus(task.status)));
      }
      continue;
    }

    if (existing.displayPhase === 'leaving') {
      continue;
    }

    if (existing.displayPhase === 'completing') {
      next.items.set(task.taskId, {
        ...existing,
        taskName: task.taskName,
        status: task.status,
        detail: task.detail,
      });
      continue;
    }

    if (terminal) {
      next.items.set(task.taskId, {
        ...existing,
        status: task.status,
        taskName: task.taskName,
        detail: task.detail,
        displayPhase: 'completing',
      });
    } else {
      next.dismissed.delete(task.taskId);
      next.items.set(task.taskId, {
        ...existing,
        status: task.status,
        taskName: task.taskName,
        detail: task.detail,
        displayPhase: phaseFromStatus(task.status),
      });
    }
  }

  for (const [taskId] of next.items) {
    if (!snapshotIds.has(taskId) && next.items.get(taskId)?.displayPhase !== 'completing') {
      next.items.delete(taskId);
    }
  }

  return next;
}

export function markDisplayItemLeaving(state: ProgressDisplayState, taskId: string): ProgressDisplayState {
  const item = state.items.get(taskId);
  if (!item) return state;
  const next = new Map(state.items);
  next.set(taskId, { ...item, displayPhase: 'leaving' });
  return { ...state, items: next };
}

export function removeDisplayItem(state: ProgressDisplayState, taskId: string): ProgressDisplayState {
  if (!state.items.has(taskId) && state.dismissed.has(taskId)) return state;
  const next = new Map(state.items);
  next.delete(taskId);
  const dismissed = new Set(state.dismissed);
  dismissed.add(taskId);
  return { ...state, items: next, dismissed };
}

export function orderedDisplayItems(
  state: ProgressDisplayState,
  snapshot: TaskProgressSnapshot,
): ProgressDisplayItem[] {
  const order = snapshot.tasks.map(t => t.taskId);
  const seen = new Set<string>();
  const result: ProgressDisplayItem[] = [];

  for (const id of order) {
    const item = state.items.get(id);
    if (item) {
      result.push(item);
      seen.add(id);
    }
  }

  for (const [id, item] of state.items) {
    if (!seen.has(id)) result.push(item);
  }

  return result;
}

export function displayStatusSymbol(item: ProgressDisplayItem): string {
  if (item.displayPhase === 'completing' || item.displayPhase === 'leaving') {
    if (item.status === 'failed') return '✗';
    return '✔';
  }
  switch (item.status) {
    case 'running':
      return '⟳';
    case 'skipped':
      return '⊘';
    case 'failed':
      return '✗';
    case 'done':
      return '✔';
    default:
      return '○';
  }
}

export function displayItemClassName(item: ProgressDisplayItem): string {
  const classes = ['acu-pp-progress-hud__item'];
  if (item.displayPhase === 'leaving') {
    classes.push('acu-pp-progress-hud__item--leaving');
  }
  if (item.displayPhase === 'completing' || item.displayPhase === 'leaving') {
    if (item.status === 'failed') classes.push('acu-pp-progress-hud__item--failed');
    else classes.push('acu-pp-progress-hud__item--done');
  } else if (item.status === 'running') {
    classes.push('acu-pp-progress-hud__item--running');
  } else if (item.status === 'failed') {
    classes.push('acu-pp-progress-hud__item--failed');
  } else if (item.status === 'done' || item.status === 'skipped') {
    classes.push('acu-pp-progress-hud__item--done');
  }
  return classes.join(' ');
}

export function collectCompletingTaskIds(
  prev: ProgressDisplayState,
  next: ProgressDisplayState,
): string[] {
  const ids: string[] = [];
  for (const [taskId, item] of next.items) {
    const was = prev.items.get(taskId);
    if (item.displayPhase === 'completing' && was?.displayPhase !== 'completing') {
      ids.push(taskId);
    }
  }
  return ids;
}

export function resetProgressDisplayState(): ProgressDisplayState {
  return createProgressDisplayState();
}
