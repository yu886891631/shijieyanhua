/**
 * 楼层消息是否可读（getChatMessages）。
 */
export function isChatMessageFloorAccessible(message_id: number): boolean {
  return message_id >= 0 && getChatMessages(message_id).length > 0;
}

/** 是否可对 message 类型变量执行 getVariables / updateVariablesWith */
export function isAccessibleMessageFloor(message_id: number): boolean {
  if (!isChatMessageFloorAccessible(message_id) && message_id >= 0) return false;
  try {
    getVariables({ type: 'message', message_id });
    return true;
  } catch {
    return false;
  }
}

/**
 * 消息楼层变量 / 运行快照清理共用的保留窗口。
 * 与历史变量清理一致：空聊天返回 null；last 取 getLastMessageId()。
 */
export function resolveMessageRetentionCutoff(keepFloors: number): {
  keep: number;
  last: number;
  cutoff: number;
} | null {
  if (getChatMessages(-1).length === 0) return null;
  const keep = Math.max(1, Math.floor(keepFloors));
  const last = getLastMessageId();
  return { keep, last, cutoff: last - keep };
}

export function findLatestAccessibleFloorId(): number | null {
  try {
    const latest = getChatMessages(-1)[0];
    if (latest && isAccessibleMessageFloor(latest.message_id)) {
      return latest.message_id;
    }
    let id = getLastMessageId();
    while (id >= 0) {
      if (isAccessibleMessageFloor(id)) return id;
      id--;
    }
    return null;
  } catch {
    return null;
  }
}

/** getLastMessageId() 偶发为 count 上界，需回退到最新可访问楼 */
export function normalizeMessageFloorId(messageId: number): number | null {
  if (isAccessibleMessageFloor(messageId)) return messageId;
  if (messageId > 0 && isAccessibleMessageFloor(messageId - 1)) {
    return messageId - 1;
  }
  return findLatestAccessibleFloorId();
}

/** 中止生成后可能残留空 assistant 占位楼，不应触发后处理 */
export function isSubstantiveAssistantMessage(msg: { role: string; message?: string }): boolean {
  return msg.role === 'assistant' && (msg.message?.trim().length ?? 0) > 0;
}

export function findLatestAssistantFloorId(upToId?: number): number | null {
  try {
    const latest = getChatMessages(-1)[0];
    if (
      latest &&
      latest.role === 'assistant' &&
      isAccessibleMessageFloor(latest.message_id) &&
      (upToId == null || latest.message_id <= upToId)
    ) {
      return latest.message_id;
    }
  } catch {
    /* fall through */
  }
  const ceiling = upToId ?? findLatestAccessibleFloorId();
  if (ceiling == null) return null;
  for (let id = ceiling; id >= 0; id--) {
    if (!isAccessibleMessageFloor(id)) continue;
    const msg = getChatMessages(id)[0];
    if (msg?.role === 'assistant') return id;
  }
  return null;
}

/** 手动重跑：以 getChatMessages(-1) 为准解析目标 assistant 楼 */
export function resolveManualRerunFloorId(): number | null {
  return findLatestAssistantFloorId();
}

/** MESSAGE_RECEIVED / GENERATION_ENDED 解析为可后处理的 assistant 楼层 */
export function resolveAutoTriggerMessageId(messageId: number): { id: number; role: string } | null {
  const latest = findLatestAccessibleFloorId();
  if (latest == null) return null;
  const latestMsg = getChatMessages(latest)[0];
  if (!latestMsg || !isSubstantiveAssistantMessage(latestMsg)) return null;

  const normalized = normalizeMessageFloorId(messageId);
  if (normalized == null) return null;

  const direct = getChatMessages(normalized)[0];
  if (direct?.role === 'assistant') return { id: normalized, role: direct.role };

  if (direct?.role === 'user') {
    return { id: latest, role: latestMsg.role };
  }

  return null;
}
