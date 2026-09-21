/**
 * 聊天快照激活时，运行时任务变更只写快照，不得污染全局 tasks / 活动预设。
 * 本批含副本成员并已转入快照后同样不得把成员写回全局。
 */
export function shouldWriteRuntimeTasksToGlobal(chatOverrideActive: boolean): boolean {
  return !chatOverrideActive;
}
