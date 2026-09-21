import { isAccessibleMessageFloor, resolveMessageRetentionCutoff } from './message-floor';

/**
 * 保留最近 `keepFloors` 楼，清空更早楼层的全部消息楼层变量（含 stat_data、addon_data、post_process_tags 等）。
 *
 * 与 MVU / addon-mvu 的遍历守卫保持一致（getChatMessages(-1) 判空、getLastMessageId 循环、
 * isAccessibleMessageFloor 逐层防御）；因 cutoff = last - keepFloors，最新楼必然保留，
 * 故 MVU/addon 的向后继承链不会断裂。
 *
 * @param keepFloors 需保留的最近楼层数（至少为 1）
 * @returns 实际被清空的楼层数
 */
export function cleanupOldMessageFloorVariables(keepFloors: number): number {
  const window = resolveMessageRetentionCutoff(keepFloors);
  if (!window || window.cutoff < 0) return 0;

  const { keep, cutoff } = window;
  let cleared = 0;
  for (let message_id = 0; message_id <= cutoff; message_id++) {
    if (!isAccessibleMessageFloor(message_id)) continue;
    try {
      const variables = getVariables({ type: 'message', message_id }) ?? {};
      if (Object.keys(variables).length === 0) continue;
      replaceVariables({}, { type: 'message', message_id });
      cleared++;
    } catch (error) {
      console.warn(`[工作流助手] 清理第 ${message_id} 楼消息变量失败:`, error);
    }
  }

  if (cleared > 0) {
    console.info(`[工作流助手] 已清理 0~${cutoff} 楼中 ${cleared} 层消息变量（保留最近 ${keep} 楼）`);
  }
  return cleared;
}
