import { buildChronicle, parseInteractions, parseNpcBlock, splitNameList } from './parse';
import {
  BACK_TASK_NAME,
  FRONT_TASK_NAME,
  type ChronicleData,
  type NpcCard,
} from './types';

export const PREVIEW_TAG = '后台角色交互预演';
export const NPC_ACT_GROUP = 'npc_act';
export const REPLICA_STATE_KEY = '_post_process_replica_state';

type ReplicaRootState = {
  attrValues?: string[];
  launchedAttrValues?: string[];
  lastEnumAttrValues?: string[];
};

type ReplicaTask = {
  id: string;
  name?: string;
  replicaFamilyRootId?: string;
  replicaFamilySpec?: string;
  replicaFamilyEnumSpec?: string;
  replicaFamilyScheduleMode?: 'auto' | 'manual';
};

type RunStatusLike = {
  messageId?: number;
  taskResults?: Array<{
    skipped?: boolean;
    success?: boolean;
    extractedTags?: Record<string, string>;
  }>;
};

type ReplicaApi = {
  listTasks: () => ReplicaTask[];
  getRunStatusForFloor?: (messageId: number) => RunStatusLike | null;
};

export type ChronicleSources = {
  previewRaw: string;
  npcByName: Record<string, string>;
  frontNames: string[];
  backNames: string[];
};

function getChronicleApi(): ReplicaApi | null {
  try {
    const parentWin = window.parent as Window & { AcuPostProcessAPI?: ReplicaApi };
    const api = parentWin?.AcuPostProcessAPI;
    if (api && typeof api.listTasks === 'function') return api;
  } catch {
    /* cross-origin / unavailable */
  }
  return null;
}

/** 从本楼运行快照的 extractedTags 取预演原文（跳过 skipped / 失败） */
export function extractPreviewFromRunStatus(
  status: RunStatusLike | null | undefined,
  tagName: string = PREVIEW_TAG,
): string {
  if (!status || !Array.isArray(status.taskResults)) return '';
  for (const r of status.taskResults) {
    if (!r || r.skipped || r.success === false) continue;
    const text = String(r.extractedTags?.[tagName] ?? '').trim();
    if (text) return text;
  }
  return '';
}

function findRootByTaskName(api: ReplicaApi | null, taskName: string): ReplicaTask | null {
  if (!api) return null;
  const target = taskName.trim().toLowerCase();
  if (!target) return null;
  return (
    api.listTasks().find(t => {
      if (t.replicaFamilyRootId) return false;
      return String(t.name ?? '')
        .trim()
        .toLowerCase() === target;
    }) ?? null
  );
}

function listLastLaunched(
  root: ReplicaTask,
  snapshot: Record<string, ReplicaRootState>,
): string[] {
  const state = snapshot[root.id];
  if (!state) return [];
  const launched = (state.launchedAttrValues ?? []).map(v => String(v).trim()).filter(Boolean);
  const enums = (state.lastEnumAttrValues ?? []).map(v => String(v).trim()).filter(Boolean);
  const mode = root.replicaFamilyScheduleMode ?? 'auto';
  const primary = mode === 'manual' ? launched : enums;
  const fallback = mode === 'manual' ? enums : launched;
  const chosen = primary.length ? primary : fallback;
  return [...new Set(chosen)];
}

/** 从宏展开结果或顿号名单解析角色名 */
export function parseLaunchedNameList(raw: string): string[] {
  return splitNameList(raw);
}

function trySubstituteMacro(macro: string): string | null {
  try {
    const parentWin = window.parent as Window & {
      substituteParams?: (s: string) => string;
    };
    const fn = parentWin?.substituteParams;
    if (typeof fn !== 'function') return null;
    const out = String(fn(macro) ?? '');
    // 未展开时宏原文仍在
    if (!out || out.includes('{{replica:launched:')) return null;
    return out.trim();
  } catch {
    return null;
  }
}

function resolveLaunchedNamesByTask(
  taskName: string,
  api: ReplicaApi | null,
  snapshot: Record<string, ReplicaRootState>,
): string[] {
  const macro = `{{replica:launched:${taskName}}}`;
  const fromMacro = trySubstituteMacro(macro);
  if (fromMacro != null && fromMacro.length) {
    return parseLaunchedNameList(fromMacro);
  }

  const root = findRootByTaskName(api, taskName);
  if (!root) return [];
  return listLastLaunched(root, snapshot);
}

function readPreviewRawFromFloor(messageId: number, api: ReplicaApi | null): string {
  if (!api || typeof api.getRunStatusForFloor !== 'function') return '';
  try {
    return extractPreviewFromRunStatus(api.getRunStatusForFloor(messageId));
  } catch {
    return '';
  }
}

/** 从 post_process_tags 扁平/嵌套读取全部 npc@act=* 内文 */
export function flattenNpcActTags(tags: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const group = tags[NPC_ACT_GROUP];
  if (group && typeof group === 'object' && !Array.isArray(group)) {
    for (const [attr, block] of Object.entries(group as Record<string, unknown>)) {
      const text = String(block ?? '').trim();
      if (text) out[attr] = text;
    }
  }
  for (const [k, v] of Object.entries(tags)) {
    const m = /^npc@act=(.+)$/i.exec(k);
    if (!m) continue;
    const name = String(m[1] ?? '').trim();
    const text = String(v ?? '').trim();
    if (name && text && !out[name]) out[name] = text;
  }
  return out;
}

function readReplicaSnapshot(messageId: number): Record<string, ReplicaRootState> {
  try {
    const msgs = getChatMessages(messageId);
    const data = (msgs?.[0] as { data?: Record<string, unknown> } | undefined)?.data;
    const raw = data?.[REPLICA_STATE_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, ReplicaRootState>;
  } catch {
    return {};
  }
}

/** 读取本楼 chronicle 原始素材（前台/后台名单 + npc 正文 + 预演原文） */
export function readChronicleSources(messageId?: number): ChronicleSources {
  const mid =
    messageId ??
    (() => {
      try {
        return getCurrentMessageId();
      } catch {
        return -1;
      }
    })();

  let previewRaw = '';
  let npcByName: Record<string, string> = {};
  let frontNames: string[] = [];
  let backNames: string[] = [];

  const api = getChronicleApi();
  previewRaw = readPreviewRawFromFloor(mid, api);

  try {
    const vars = getVariables({ type: 'message', message_id: mid }) ?? {};
    const tags = (vars.post_process_tags ?? {}) as Record<string, unknown>;
    npcByName = flattenNpcActTags(tags);
  } catch {
    /* ignore */
  }

  try {
    const snap = readReplicaSnapshot(mid);
    frontNames = resolveLaunchedNamesByTask(FRONT_TASK_NAME, api, snap);
    backNames = resolveLaunchedNamesByTask(BACK_TASK_NAME, api, snap);
  } catch {
    /* ignore */
  }

  return { previewRaw, npcByName, frontNames, backNames };
}

export function loadChronicle(messageId?: number): ChronicleData {
  const { previewRaw, npcByName, frontNames, backNames } = readChronicleSources(messageId);
  const interactions = parseInteractions(previewRaw);
  return buildChronicle({ frontNames, backNames, interactions }, npcByName);
}

export function hasChronicleSource(messageId?: number): boolean {
  const { previewRaw, npcByName, frontNames, backNames } = readChronicleSources(messageId);
  if (frontNames.length || backNames.length) return true;
  if (Object.keys(npcByName).length > 0) return true;
  if (previewRaw && parseInteractions(previewRaw).length > 0) return true;
  return false;
}

/** 供测试：内文 → NpcCard 映射 */
export function parseNpcMap(npcByName: Record<string, string>): Record<string, NpcCard> {
  const out: Record<string, NpcCard> = {};
  for (const [name, body] of Object.entries(npcByName)) {
    out[name] = parseNpcBlock(body, name);
  }
  return out;
}
