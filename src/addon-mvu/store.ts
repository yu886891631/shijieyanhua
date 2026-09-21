import { prettifyErrorWithInput } from '@util/common';

import { ensureAddonArchive, inheritAddonArchive } from './archive';
import { refreshNarrativeGuidanceDetails } from './narrative-guidance';
import { stripInvalidStrictBooleans } from './schema';
import { coerceAddonData } from './coerce';
import { updateAddonFromMessage } from './update';
import { ADDON_KEY, AddonData, AddonSchema, normalizeAddonData } from './schema';

/** 当前聊天是否至少有一楼可访问的消息 */
export function hasChatMessages(): boolean {
  return getChatMessages(-1).length > 0;
}

/** 楼层是否真实存在 (防御空聊天或 getLastMessageId 与 chat 数组不同步) */
export function isAccessibleMessageFloor(message_id: number): boolean {
  return message_id >= 0 && getChatMessages(message_id).length > 0;
}

export function resolveMessageId(message_id: number | 'latest' | undefined = 'latest'): number {
  if (message_id === undefined || message_id === 'latest') {
    const last_message_id = getLastMessageId();
    if (!isAccessibleMessageFloor(last_message_id)) {
      throw new Error('当前聊天没有任何消息楼层');
    }
    return last_message_id;
  }
  if (message_id < 0) {
    const last_message_id = getLastMessageId();
    const resolved = last_message_id + 1 + message_id;
    if (!isAccessibleMessageFloor(resolved)) {
      throw new Error(`消息楼层号 ${message_id} 超出范围`);
    }
    return resolved;
  }
  if (!isAccessibleMessageFloor(message_id)) {
    throw new Error(`消息楼层号 ${message_id} 超出范围`);
  }
  return message_id;
}

export function getAddonData(message_id: number): AddonData | undefined {
  if (!isAccessibleMessageFloor(message_id)) {
    return undefined;
  }
  const raw = _.get(getVariables({ type: 'message', message_id }), ADDON_KEY);
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const coerced = coerceAddonData(raw);
  const result = AddonSchema.safeParse(stripInvalidStrictBooleans(coerced));
  if (result.success) {
    const normalized = normalizeAddonData(result.data);
    if (!_.isEqual(raw, normalized)) {
      writeAddonData(message_id, normalized);
    }
    return normalized;
  }
  console.warn(`[addon-mvu] 第 ${message_id} 楼 addon_data 校验失败, 将尝试 prefault 修复:\n`, prettifyErrorWithInput(result.error));
  const normalized = normalizeAddonData(raw);
  writeAddonData(message_id, normalized);
  return normalized;
}

export function writeAddonData(message_id: number, addon: AddonData): void {
  if (!isAccessibleMessageFloor(message_id)) {
    return;
  }
  const parsed = normalizeAddonData(addon);
  updateVariablesWith(
    variables => {
      _.set(variables, ADDON_KEY, parsed);
      return variables;
    },
    { type: 'message', message_id },
  );
}

/** 将上一楼 addon_data 拷贝到当前楼; 首楼或无前楼时使用默认值 */
export function inheritAddon(message_id: number): AddonData {
  const previous = message_id > 0 ? getAddonData(message_id - 1) : undefined;
  const inherited = normalizeAddonData(previous);
  writeAddonData(message_id, inherited);
  inheritAddonArchive(message_id);
  return inherited;
}

export function ensureAddonData(message_id: number): AddonData {
  const existing = getAddonData(message_id);
  if (existing !== undefined) {
    return existing;
  }
  return inheritAddon(message_id);
}

/**
 * 展示用读取：本楼无 addon_data 键时只读回退上一楼，不写变量。
 * 与 ensureAddonData 不同，不会 inherit 落盘。
 */
export function resolveAddonDataForRead(message_id: number): AddonData {
  const own = getAddonData(message_id);
  if (own !== undefined) {
    return own;
  }
  if (message_id > 0) {
    const prev = getAddonData(message_id - 1);
    if (prev !== undefined) {
      return prev;
    }
  }
  return normalizeAddonData(undefined);
}

/**
 * 从消息文本解析 `<AddonJSONPatch>` 并对 addon_data 应用 JSON Patch.
 * 无更新块或 patch 后无变化时返回 undefined (对齐 MVU parseMessage).
 */
export async function parseAddonMessage(message: string, old_addon: AddonData): Promise<AddonData | undefined> {
  const result = await updateAddonFromMessage(message, old_addon);
  return result?.data;
}

/** 继承上一楼 addon_data, 再解析当前楼消息中的 AddonJSONPatch 更新块 */
export async function processFloor(message_id: number): Promise<void> {
  if (!isAccessibleMessageFloor(message_id)) {
    return;
  }
  const inherited = inheritAddon(message_id);
  const chat_message = getChatMessages(message_id)[0];
  if (!chat_message?.message) {
    return;
  }

  const result = await updateAddonFromMessage(chat_message.message, inherited, {
    emitEvents: true,
    message_content: chat_message.message,
    message_id,
  });

  let data = inherited;
  if (result !== undefined) {
    data = result.data;
  }

  const refreshed = refreshNarrativeGuidanceDetails(data);
  if (!_.isEqual(refreshed, inherited)) {
    writeAddonData(message_id, refreshed);
  }
}

/** 为当前聊天中缺失 addon_data 的楼层补全继承链 */
export function backfillChatAddonData(): void {
  if (!hasChatMessages()) {
    return;
  }
  const last_message_id = getLastMessageId();
  for (let message_id = 0; message_id <= last_message_id; message_id++) {
    if (getAddonData(message_id) === undefined) {
      inheritAddon(message_id);
    } else {
      ensureAddonArchive(message_id);
    }
  }
}

/**
 * generate 等同层未新建楼层时使用: 解析 message 并写回指定楼层的 addon_data.
 * 会先 inherit 以确保有基底数据.
 */
export async function applyAddonUpdateFromMessage(
  message: string,
  message_id: number = getLastMessageId(),
): Promise<AddonData> {
  const base = ensureAddonData(message_id);
  const result = await updateAddonFromMessage(message, base, {
    emitEvents: true,
    message_content: message,
    message_id,
    // 工作流多阶段同楼注入：变更日志按 path 合并，避免后阶段覆盖前阶段
    mergeIntoLastLog: true,
  });

  const data = result !== undefined ? result.data : base;
  const refreshed = refreshNarrativeGuidanceDetails(data);
  if (!_.isEqual(refreshed, base)) {
    writeAddonData(message_id, refreshed);
  }
  return refreshed;
}

/** 从第 0 楼起依次 inherit + parse, 重建全部 addon_data 链 */
export async function reprocessAllAddonFloors(): Promise<void> {
  if (!hasChatMessages()) {
    return;
  }
  const last_message_id = getLastMessageId();
  for (let message_id = 0; message_id <= last_message_id; message_id++) {
    await processFloor(message_id);
  }
  console.info(`[addon-mvu] 已重新处理 0~${last_message_id} 楼 addon_data`);
}
