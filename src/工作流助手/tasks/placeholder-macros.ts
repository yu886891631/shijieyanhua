import { parseExtractTagSpec } from './tag-extract';
import {
  buildDirectedEnumRegistryKey,
  ENUM_REGISTRY_MARKER,
} from './replica-enum-parse';
import { getReplicaFamilyEnumSpecKey, isReplicaFamilyRootTemplate } from './replica-family';
import { buildFloorTagMap } from './tag-variables';
import { resolvePlaceholderForInject, type RelayTagMap } from './utils';
import type { PostProcessTask } from './schema';
import type { ReplicaStateSnapshot } from './replica-state';
import { SCRIPT_LOG_PREFIX } from '../ui/brand';

function resolveMacroMessageId(contextMessageId?: number): number {
  if (typeof contextMessageId === 'number' && Number.isFinite(contextMessageId) && contextMessageId >= 0) {
    return contextMessageId;
  }
  try {
    return getLastMessageId();
  } catch {
    return -1;
  }
}

function resolveReplicaStateForMacro(messageId: number): ReplicaStateSnapshot {
  if (messageId < 0) return {};
  // 惰性加载，避免单测经 reconcile → settings → Pinia
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveReplicaStateForMessage } =
    require('./replica-reconcile') as typeof import('./replica-reconcile');
  return resolveReplicaStateForMessage(messageId);
}

function loadEffectiveTasks(): PostProcessTask[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadSettings } = require('../settings') as typeof import('../settings');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveEffectiveSettings } = require('./effective-settings') as typeof import('./effective-settings');
  return resolveEffectiveSettings(loadSettings()).tasks;
}

/** 用楼层 lastEnumAttrValues 按根写定向 registry 键，供 auto {{replica:launched}} 过滤（多族同 spec 不串） */
export function buildMacroRelayFromReplicaState(
  tasks: PostProcessTask[],
  snapshot: ReplicaStateSnapshot,
): RelayTagMap {
  const relay: RelayTagMap = new Map();
  for (const root of tasks) {
    if (!isReplicaFamilyRootTemplate(root)) continue;
    const values = snapshot[root.id]?.lastEnumAttrValues;
    if (!values?.length) continue;
    const parsed = parseExtractTagSpec(getReplicaFamilyEnumSpecKey(root));
    if (!parsed?.attrName) continue;
    for (const value of values) {
      const key = buildDirectedEnumRegistryKey(root.id, parsed.tagName, parsed.attrName, value);
      relay.set(key, [ENUM_REGISTRY_MARKER]);
    }
  }
  return relay;
}

export function resolveWorkflowPlaceholderMacro(
  placeholderName: string,
  messageId: number,
  options?: {
    tasks?: PostProcessTask[];
    historyMap?: RelayTagMap;
    replicaState?: ReplicaStateSnapshot;
  },
): string {
  const trimmed = placeholderName.trim();
  if (!trimmed) return '';

  const tasks = options?.tasks ?? loadEffectiveTasks();
  const historyMap =
    options?.historyMap ?? (messageId >= 0 ? buildFloorTagMap(messageId) : new Map());
  const snapshot = options?.replicaState ?? resolveReplicaStateForMacro(messageId);
  const relayMap = buildMacroRelayFromReplicaState(tasks, snapshot);

  return resolvePlaceholderForInject(trimmed, relayMap, historyMap, new Set(), {
    historyFallback: 'all-tags',
    allTasks: tasks,
    replicaState: snapshot,
  });
}

function replaceMacroMatch(
  context: { message_id?: number },
  fullPlaceholderName: string,
): string {
  try {
    const messageId = resolveMacroMessageId(context.message_id);
    return resolveWorkflowPlaceholderMacro(fullPlaceholderName, messageId);
  } catch (error) {
    console.warn(
      `${SCRIPT_LOG_PREFIX} 占位符宏解析失败 (${fullPlaceholderName}):`,
      error,
    );
    return '';
  }
}

export function registerPlaceholderMacros(): { stop(): void } {
  const handles = [
    registerMacroLike(/\{\{(total:last-launched:[^}]+)\}\}/gi, (context, _substring, inner) =>
      replaceMacroMatch(context, String(inner ?? '')),
    ),
    registerMacroLike(/\{\{(total:launched:[^}]+)\}\}/gi, (context, _substring, inner) =>
      replaceMacroMatch(context, String(inner ?? '')),
    ),
    // 排除 launched: / last-launched:，避免被普通 total: 吃掉
    registerMacroLike(/\{\{(total:(?!launched:|last-launched:)[^}]+)\}\}/gi, (context, _substring, inner) =>
      replaceMacroMatch(context, String(inner ?? '')),
    ),
    registerMacroLike(/\{\{(replica:launched:[^}]+)\}\}/gi, (context, _substring, inner) =>
      replaceMacroMatch(context, String(inner ?? '')),
    ),
  ];

  return {
    stop: () => {
      for (const h of handles) {
        try {
          h.unregister();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** 设置页「已注册酒馆助手宏」说明（与 registerPlaceholderMacros 保持同步） */
export const REGISTERED_MACRO_LEGEND: { code: string; desc: string }[] = [
  {
    code: '{{total:标签@属性}}',
    desc: '展开楼层 post_process_tags 中该规格的全部复合实例，例如 {{total:item@id}}。',
  },
  {
    code: '{{total:launched:标签@属性}}',
    desc: '覆盖该 spec 下全部副本族：优先展开本轮可运行副本正文，空则回退 last-launched。可写 {{total:launched:标签@属性:任务名}} 收窄到指定副本族。',
  },
  {
    code: '{{total:last-launched:标签@属性}}',
    desc: '覆盖该 spec 下全部副本族的楼层上次启动正文。可写 {{total:last-launched:标签@属性:任务名}} 收窄。manual 用 launchedAttrValues，auto 用 lastEnumAttrValues。',
  },
  {
    code: '{{replica:launched:任务名}}',
    desc: '输出可运行副本属性值列表（顿号连接）；本轮优先，空则回退楼层 last-launched 名单。支持任务名或 Id。',
  },
];
