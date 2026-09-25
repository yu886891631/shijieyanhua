import { getCurrentChatKey } from '../api/chat-key';

export const ACU_PP_TASKS_CHANGED = 'acu-pp:tasks-changed';
export const ACU_PP_CHAT_SCOPE_CHANGED = 'acu-pp:chat-scope-changed';
/** 工作流全部后处理阶段完成后发出，供可选增强插件订阅。 */
export const ACU_PP_WORKFLOW_COMPLETED = 'acu-pp:workflow-completed';

export type TaskChangeAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'replace'
  | 'clear'
  | 'preset'
  | 'schedule_reset';

export type TasksChangedPayload = {
  chatKey: string;
  action: TaskChangeAction;
  taskId?: string;
  source: 'api' | 'ui';
};

export type ChatScopeChangedPayload = {
  chatKey: string;
  mode: 'chat_override' | 'inherit_global';
  originPresetName?: string;
  /** 本次因 ensureChatOverride 等新创建了本聊快照 */
  createdSnapshot?: boolean;
};

export type WorkflowCompletedPayload = {
  chatKey: string;
  messageId: number;
  type: string;
  isRerun: boolean;
  /** 本轮工作流是否至少有一个任务成功完成。 */
  hasSuccess: boolean;
  /** 是否被取消；取消时不会触发依赖完整结果的插件。 */
  cancelled: boolean;
};

export async function emitTasksChanged(
  action: TaskChangeAction,
  source: 'api' | 'ui',
  taskId?: string,
): Promise<void> {
  const payload: TasksChangedPayload = {
    chatKey: getCurrentChatKey(),
    action,
    taskId,
    source,
  };
  await eventEmit(ACU_PP_TASKS_CHANGED, payload);
}

export async function emitChatScopeChanged(
  mode: 'chat_override' | 'inherit_global',
  originPresetName?: string,
  options?: { createdSnapshot?: boolean },
): Promise<void> {
  const payload: ChatScopeChangedPayload = {
    chatKey: getCurrentChatKey(),
    mode,
    originPresetName,
    createdSnapshot: options?.createdSnapshot,
  };
  await eventEmit(ACU_PP_CHAT_SCOPE_CHANGED, payload);
}

export async function emitWorkflowCompleted(payload: WorkflowCompletedPayload): Promise<void> {
  await eventEmit(ACU_PP_WORKFLOW_COMPLETED, payload);
}
