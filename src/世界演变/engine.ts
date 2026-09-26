import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import { captureDataSnapshot } from '../工作流助手/bridge/database-api';
import { loadSettings, saveSettings } from './store';
import {
  loadDbSnapshot,
  commitDbRevision,
  rebuildDbAfterDeletingFloor,
  updateDbFloorRunRecord,
  updateDbWorldbookSyncState,
} from '../世界演变数据库/store';
import { dbSnapshotToWorld, isDbMessageProcessed } from '../世界演变数据库/adapter';
import { parseWorldEvolutionOperations, validateWorldEvolutionOperations } from '../世界演变数据库/ai-operations';
import type {
  WorldEvolutionInput,
  WorldEvolutionSettings,
  WorldEvolutionWorld,
  WorldEvolutionRunRecord,
} from './types';
import type { WorldEvolutionDbFloorRun } from '../世界演变数据库/types';
import { DEFAULT_WORLD_EVOLUTION_SETTINGS } from './types';
import { resolveCurrentCharacterWorldbookName, syncWorldEvolutionWorldbook } from './worldbook';
import { waitForStableSnapshot, WorldEvolutionFloorQueue } from './floor-queue';
import { queryWorldEvolutionCandidates } from './query';

export type WorldEvolutionRunStatus =
  | 'idle'
  | 'waiting'
  | 'collecting'
  | 'generating'
  | 'committing'
  | 'syncing'
  | 'done'
  | 'skipped'
  | 'failed';

export type WorldEvolutionRunResult = {
  status: WorldEvolutionRunStatus;
  messageId: number;
  reason?: string;
  candidateNames: string[];
  changedEntityIds: string[];
  eventIds: string[];
  world?: WorldEvolutionWorld;
  rawResponse?: string;
  error?: string;
};

export type WorldEvolutionStatusListener = (status: {
  status: WorldEvolutionRunStatus;
  message: string;
  result?: WorldEvolutionRunResult;
}) => void;

let statusListener: WorldEvolutionStatusListener | undefined;
const recentMvuSnapshots = new Map<string, unknown>();
let worldEvolutionQueue: WorldEvolutionFloorQueue | undefined;

export type WorldEvolutionAiCaller = (prompt: string, settings: WorldEvolutionSettings) => Promise<string>;

let worldEvolutionAiCaller: WorldEvolutionAiCaller | undefined;

export function setWorldEvolutionStatusListener(listener: WorldEvolutionStatusListener | undefined): void {
  statusListener = listener;
}

function report(status: WorldEvolutionRunStatus, message: string, result?: WorldEvolutionRunResult): void {
  statusListener?.({ status, message, result });
  console.info(`[世界演变] ${message}`);
}

export function setWorldEvolutionAiCaller(caller: WorldEvolutionAiCaller | undefined): void {
  worldEvolutionAiCaller = caller;
}

function runRecordSource(source: 'auto' | 'manual' | 'retry'): WorldEvolutionRunRecord['source'] {
  return source;
}

async function updateRunRecord(
  chatKey: string,
  messageId: number,
  updater: (record: WorldEvolutionRunRecord | undefined) => WorldEvolutionRunRecord | undefined,
): Promise<void> {
  try {
    const snapshot = await loadDbSnapshot(chatKey);
    const existing = snapshot.floorRuns.find(run => run.messageId === messageId);
    const current = existing ? dbFloorRunToRunRecord(existing) : undefined;
    const next = updater(current);
    if (!next) {
      if (existing) {
        await updateDbFloorRunRecord(chatKey, messageId, existing.messageFingerprint, () => undefined);
      }
      return;
    }
    const messageFingerprint =
      next.messageFingerprint ??
      existing?.messageFingerprint ??
      fingerprintText(getLatestMessage(messageId)?.text ?? '');
    next.messageFingerprint = messageFingerprint;
    await updateDbFloorRunRecord(chatKey, messageId, messageFingerprint, previous => {
      const merged = runRecordToDbFloorRun(next, previous);
      return merged;
    });
  } catch (error) {
    // 运行记录是诊断信息，不能让它的写入失败覆盖真正的世界演变结果。
    console.warn('[世界演变] 运行记录写入失败:', error);
  }
}

function dbFloorRunToRunRecord(run: WorldEvolutionDbFloorRun): WorldEvolutionRunRecord {
  return {
    key: run.key,
    chatKey: run.chatKey,
    messageId: run.messageId,
    messageFingerprint: run.messageFingerprint,
    source: run.source === 'manual' || run.source === 'retry' ? run.source : 'auto',
    status:
      run.status === 'queued' ||
      run.status === 'running' ||
      run.status === 'done' ||
      run.status === 'skipped' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
        ? run.status
        : 'cancelled',
    attempt: run.attempt ?? 1,
    enqueuedAt: run.enqueuedAt ?? run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    candidateNames: [...run.candidateNames],
    changedEntityIds: [...run.changedEntityIds],
    eventIds: [...run.eventIds],
    error: run.error,
  };
}

function runRecordToDbFloorRun(
  record: WorldEvolutionRunRecord,
  previous?: WorldEvolutionDbFloorRun,
): WorldEvolutionDbFloorRun {
  const now = Date.now();
  return {
    key: record.key,
    id: previous?.id ?? `floor-${record.chatKey}-${record.messageId}-${record.messageFingerprint ?? ''}`,
    chatKey: record.chatKey,
    messageId: record.messageId,
    messageFingerprint: record.messageFingerprint ?? '',
    source: record.source,
    status: record.status,
    baseRevision: previous?.baseRevision ?? 0,
    resultRevision: previous?.resultRevision,
    operationCount: previous?.operationCount ?? 0,
    error: record.error,
    attempt: record.attempt,
    enqueuedAt: record.enqueuedAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    candidateNames: [...record.candidateNames],
    changedEntityIds: [...record.changedEntityIds],
    eventIds: [...record.eventIds],
    createdAt: previous?.createdAt ?? record.enqueuedAt ?? now,
    updatedAt: now,
  };
}

function createQueuedRunRecord(
  chatKey: string,
  messageId: number,
  source: 'auto' | 'manual' | 'retry',
  messageFingerprint?: string,
): WorldEvolutionRunRecord {
  return {
    key: `${chatKey}\u0000${messageId}`,
    chatKey,
    messageId,
    messageFingerprint,
    source: runRecordSource(source),
    status: 'queued',
    attempt: 0,
    enqueuedAt: Date.now(),
    candidateNames: [],
    changedEntityIds: [],
    eventIds: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fingerprintText(value: string): string {
  // FNV-1a 32-bit：区分同一楼层的重新生成内容，但不把正文原文写入键名。
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function getLatestMessage(messageId?: number): { id: number; text: string } | null {
  const fallback = getChatMessages(-1)[0] as Record<string, unknown> | undefined;
  const message = messageId != null ? (getChatMessages(messageId)[0] as Record<string, unknown> | undefined) : fallback;
  if (!message) return null;
  const id = typeof message.message_id === 'number' ? message.message_id : (messageId ?? getLastMessageId());
  const text = String(message.message ?? message.mes ?? '');
  return { id, text };
}

function getMvuSnapshot(messageId: number): unknown {
  try {
    if (typeof Mvu === 'undefined') return null;
    return clone(Mvu.getMvuData({ type: 'message', message_id: messageId }));
  } catch (error) {
    console.warn('[世界演变] 读取 MVU 快照失败:', error);
    return null;
  }
}

function getWorkflowSnapshot(messageId: number): unknown {
  try {
    const hostWindow = (window.parent ?? window) as Window & {
      AcuPostProcessAPI?: {
        getRunStatusForFloor?: (floorId: number) => {
          taskResults?: Array<{
            taskName?: string;
            success?: boolean;
            skipped?: boolean;
            skipReason?: string;
            preview?: string;
            extractedTags?: unknown;
          }>;
        } | null;
      };
    };
    const status = hostWindow.AcuPostProcessAPI?.getRunStatusForFloor?.(messageId);
    return status?.taskResults?.length
      ? clone(
          status.taskResults.map(task => ({
            taskName: task.taskName,
            success: task.success,
            skipped: task.skipped,
            skipReason: task.skipReason,
            preview: task.preview,
            extractedTags: task.extractedTags,
          })),
        )
      : null;
  } catch {
    return null;
  }
}

function getWorkflowSummary(messageId: number): string {
  return compactJson(getWorkflowSnapshot(messageId), 8000);
}

function getDatabaseSnapshot(): Record<string, unknown> | null {
  try {
    return clone(captureDataSnapshot().tablesJson);
  } catch {
    return null;
  }
}

function compactJson(value: unknown, maxLength = 8000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n…(已截断)` : text;
  } catch {
    return String(value ?? '');
  }
}

function extractReplicaNames(text: string): string[] {
  const names = new Set<string>();
  const blocks = [...text.matchAll(/<ReplicaEnum>([\s\S]*?)<\/ReplicaEnum>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1] ?? '') as { enums?: Array<{ values?: unknown }> };
      for (const entry of parsed.enums ?? []) {
        const values = Array.isArray(entry.values) ? entry.values : [];
        for (const value of values) {
          if (typeof value === 'string' && value.trim()) names.add(value.trim());
        }
      }
    } catch {
      // ReplicaEnum 不是世界演变的硬依赖，解析失败时保留其他候选来源。
    }
  }
  return [...names];
}

export function buildWorldEvolutionPrompt(
  input: WorldEvolutionInput,
  world: WorldEvolutionWorld,
  settings: WorldEvolutionSettings,
): string {
  const entities = Object.values(world.entities)
    .filter(entity => input.candidateNames.includes(entity.name) || settings.manualCandidates.includes(entity.name))
    .map(entity => ({
      id: entity.id,
      type: entity.type,
      name: entity.name,
      state: entity.state,
      visibility: entity.visibility,
    }));

  return [
    '你是“世界演变”后台模拟器，不是主角，也不是正文写作者。',
    '你只处理候选对象，让主角视线之外的 NPC、组织、社会和环境继续合理行动。',
    settings.modelInstruction,
    '禁止改写主角已经知道的资料，禁止让后台秘密自动变成主角已知。',
    '只输出单个 JSON 对象：baseRevision 和 operations；不要 Markdown、标签、解释或 SQL。',
    '只允许 upsert 实体、append 新事件/计划、update_status 已有事件/计划、delete 无任何引用的 backstage 实体。',
    '实体必须同时给出本库稳定 id 和候选全名 name；已有实体沿用下方 ID，新实体使用表名:姓名（society 使用 social:姓名）。外部表行 ID 不是本库 ID。',
    'changes 仅更新实体 data 的普通状态键；不得改写元数据或姓名。event/plan 用 actorIds、locationId 等本库实体 ID 引用。',
    '不可自动写 protagonist_known/revealed；事件和计划每类最多为 NPC 与其他对象上限之和。无变化输出空 operations。',
    '',
    '【当前输入】',
    `聊天标识：${input.chatKey}`,
    `消息楼层：${input.messageId}`,
    `当前时间：${input.currentTime || '未知'}`,
    `当前地点：${input.currentLocation || '未知'}`,
    `MVU变化摘要：${input.mvuChangeSummary || '无明显变化'}`,
    `前置工作流结果摘要：\n${input.databaseSummary || '无可用摘要'}`,
    `数据库当前表快照：\n${compactJson(input.databaseSnapshot, 12000)}`,
    `当前 MVU 快照：\n${compactJson(input.mvuSnapshot, 12000)}`,
    `本轮主AI消息：\n${input.latestMessage.slice(-12000)}`,
    `候选对象：${input.candidateNames.join('、') || '无'}`,
    `候选来源与证据：\n${compactJson(
      input.queryContext?.candidates.map(candidate => ({
        table: candidate.table,
        rowId: candidate.rowId,
        name: candidate.name,
        source: candidate.source,
        priority: candidate.priority,
        evidence: candidate.evidence,
      })) ?? [],
      8000,
    )}`,
    `候选相关表格行（保留表名与行边界）：\n${compactJson(input.queryContext?.tables ?? [], 10000)}`,
    `本轮上限：NPC 最多 ${settings.maxNpcPerRun} 个，其他对象最多 ${settings.maxOtherEntitiesPerRun} 个。`,
    `已有世界演变状态：\n${compactJson(entities, 10000)}`,
    `最近后台事件：\n${compactJson(world.events.slice(-20), 6000)}`,
    `待办演变计划：\n${compactJson(world.scheduledEvents.filter(event => event.status === 'pending').slice(-20), 6000)}`,
    '',
    '【输出结构】',
    JSON.stringify(
      {
        baseRevision: world.revision,
        operations: [
          {
            op: 'upsert',
            table: 'npc',
            id: 'npc:角色全名',
            name: '角色全名',
            changes: { current_goal: '新目标' },
          },
          {
            op: 'append',
            table: 'event',
            data: {
              eventType: 'npc_action',
              actorIds: ['npc:角色全名'],
              summary: '一句话描述后台行动',
              visibility: 'ai_context',
            },
          },
        ],
      },
      null,
      2,
    ),
  ].join('\n');
}

async function defaultCallEvolutionAi(prompt: string): Promise<string> {
  const result = await generateRaw({
    ordered_prompts: [
      { role: 'system', content: '你负责严格生成世界演变 JSON。' },
      { role: 'user', content: prompt },
    ],
    should_silence: true,
    max_chat_history: 0,
    overrides: {
      world_info_before: '',
      world_info_after: '',
      persona_description: '',
      char_description: '',
      char_personality: '',
      scenario: '',
      dialogue_examples: '',
      chat_history: { with_depth_entries: false, prompts: [] },
    },
    json_schema: {
      name: 'world_evolution',
      description: 'baseRevision 和受限的批量数据库 operations',
      // 可扩展的实体 data 键由本地验证器做最终约束。
      strict: false,
      value: {
        type: 'object',
        properties: {
          baseRevision: { type: 'integer' },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['upsert', 'append', 'update_status', 'delete'] },
                table: {
                  type: 'string',
                  enum: ['npc', 'organization', 'location', 'society', 'environment', 'event', 'plan'],
                },
                id: { type: 'string' },
                name: { type: 'string' },
                changes: { type: 'object', additionalProperties: true },
                data: { type: 'object', additionalProperties: true },
                status: { type: 'string' },
                visibility: {
                  type: 'string',
                  enum: ['backstage', 'ai_context', 'protagonist_known', 'revealed'],
                },
              },
              required: ['op', 'table'],
              additionalProperties: false,
            },
          },
        },
        required: ['baseRevision', 'operations'],
        additionalProperties: false,
      },
    },
  });
  return typeof result === 'string' ? result : result.content;
}

async function callEvolutionAi(prompt: string, settings: WorldEvolutionSettings): Promise<string> {
  return (worldEvolutionAiCaller ?? defaultCallEvolutionAi)(prompt, settings);
}

/**
 * 测试/宿主注入入口：生产环境默认走 SillyTavern 的 generateRaw，
 * 模拟测试可注入纯函数而不消耗真实 API。
 */
export async function callWorldEvolutionAi(prompt: string, settings: WorldEvolutionSettings): Promise<string> {
  return callEvolutionAi(prompt, settings);
}

function buildInput(
  chatKey: string,
  messageId: number,
  text: string,
  settings: WorldEvolutionSettings,
): WorldEvolutionInput {
  const mvuSnapshot = getMvuSnapshot(messageId);
  const databaseSnapshot = getDatabaseSnapshot();
  const previous = recentMvuSnapshots.get(chatKey);
  recentMvuSnapshots.set(chatKey, clone(mvuSnapshot));
  const mvuChangeSummary =
    previous == null ? '本轮没有可比较的上一份 MVU 快照。' : compactJson({ previous, current: mvuSnapshot }, 8000);
  const replicaNames = extractReplicaNames(text);
  return {
    chatKey,
    messageId,
    latestMessage: text,
    mvuSnapshot,
    previousMvuSnapshot: previous,
    mvuChangeSummary,
    databaseSummary: compactJson({ workflow: getWorkflowSummary(messageId), tables: databaseSnapshot }, 10000),
    databaseSnapshot,
    candidateNames: [...new Set([...replicaNames, ...settings.manualCandidates])],
    currentTime: undefined,
    currentLocation: undefined,
  };
}

async function executeWorldEvolution(
  messageId?: number,
  options?: { source?: 'auto' | 'manual'; attempt?: number },
): Promise<WorldEvolutionRunResult> {
  const settings = loadSettings();
  const latest = getLatestMessage(messageId);
  const targetMessageId = latest?.id ?? messageId ?? getLastMessageId();
  const result: WorldEvolutionRunResult = {
    status: 'idle',
    messageId: targetMessageId,
    candidateNames: [],
    changedEntityIds: [],
    eventIds: [],
  };

  if (!latest) {
    result.status = 'skipped';
    result.reason = '当前聊天没有可处理的消息';
    report('skipped', result.reason, result);
    return result;
  }
  if (!settings.enabled) {
    result.status = 'skipped';
    result.reason = '世界演变插件未启用';
    report('skipped', result.reason, result);
    return result;
  }

  const chatKey = getCurrentChatKey();
  let dbSnapshot = await loadDbSnapshot(chatKey);
  const fingerprint = fingerprintText(latest.text);
  if (
    dbSnapshot.floorRuns.some(
      run => run.messageId === targetMessageId && run.status === 'done' && run.messageFingerprint !== fingerprint,
    )
  ) {
    dbSnapshot = await rebuildDbAfterDeletingFloor(chatKey, targetMessageId);
  }
  const world = dbSnapshotToWorld(dbSnapshot);
  const wasProcessed = isDbMessageProcessed(dbSnapshot, targetMessageId, fingerprint);
  if (wasProcessed) {
    result.status = 'skipped';
    result.reason = `消息楼层 ${targetMessageId} 已处理`;
    await updateRunRecord(chatKey, targetMessageId, record => ({
      ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, options?.source ?? 'auto', fingerprint)),
      status: 'skipped',
      messageFingerprint: fingerprint,
      finishedAt: Date.now(),
      error: result.reason,
    }));
    report('skipped', result.reason, result);
    return result;
  }

  const attempt = Math.max(1, options?.attempt ?? 1);
  const runSource: WorldEvolutionRunRecord['source'] =
    attempt > 1 ? 'retry' : options?.source === 'manual' ? 'manual' : 'auto';
  await updateRunRecord(chatKey, targetMessageId, record => ({
    ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, runSource, fingerprint)),
    source: runSource,
    messageFingerprint: fingerprint,
    status: 'running',
    attempt,
    startedAt: record?.startedAt ?? Date.now(),
    finishedAt: undefined,
    error: undefined,
  }));

  try {
    report('collecting', `正在收集第 ${targetMessageId} 楼输入`);
    const input = buildInput(chatKey, targetMessageId, latest.text, settings);
    input.databaseSnapshot = clone(dbSnapshot);
    input.databaseSummary = compactJson(
      {
        workflow: getWorkflowSnapshot(targetMessageId),
        worldEvolutionDatabase: dbSnapshot,
      },
      12000,
    );
    const externalDatabaseSnapshot = getDatabaseSnapshot();
    const queryContext = queryWorldEvolutionCandidates({
      messageId: targetMessageId,
      messageText: latest.text,
      databaseSnapshot: dbSnapshot,
      mvuSnapshot: input.mvuSnapshot,
      previousMvuSnapshot: input.previousMvuSnapshot,
      workflowSnapshot: getWorkflowSnapshot(targetMessageId),
      shujukuSnapshot: externalDatabaseSnapshot,
      manualCandidates: settings.manualCandidates,
      maxNpcCandidates: settings.maxNpcPerRun,
      maxOtherCandidates: settings.maxOtherEntitiesPerRun,
    });
    input.queryContext = queryContext;
    const candidateNames = queryContext.candidates.map(candidate => candidate.name);
    result.candidateNames = candidateNames;
    if (!candidateNames.length) {
      result.status = 'skipped';
      result.reason = '没有候选对象；可在面板中添加手动候选 NPC';
      await updateRunRecord(chatKey, targetMessageId, record => ({
        ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, runSource, fingerprint)),
        source: runSource,
        messageFingerprint: fingerprint,
        status: 'skipped',
        attempt,
        finishedAt: Date.now(),
        candidateNames: [],
        error: result.reason,
      }));
      report('skipped', result.reason, result);
      return result;
    }

    input.candidateNames = candidateNames.slice(0, settings.maxNpcPerRun + settings.maxOtherEntitiesPerRun);
    await updateRunRecord(chatKey, targetMessageId, record => ({
      ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, runSource, fingerprint)),
      source: runSource,
      messageFingerprint: fingerprint,
      status: 'running',
      attempt,
      candidateNames: [...input.candidateNames],
      changedEntityIds: [],
      eventIds: [],
      error: undefined,
    }));
    report('generating', `正在批量演变 ${input.candidateNames.length} 个候选对象`);
    const rawResponse = await callEvolutionAi(buildWorldEvolutionPrompt(input, world, settings), settings);
    result.rawResponse = rawResponse;
    const parsed = parseWorldEvolutionOperations(rawResponse);

    report('committing', '正在校验并提交世界演变结果');
    const converted = validateWorldEvolutionOperations(dbSnapshot, parsed, input, settings);
    const committed = await commitDbRevision({
      chatKey,
      messageId: targetMessageId,
      messageFingerprint: fingerprint,
      source: options?.source ?? 'auto',
      baseRevision: parsed.baseRevision,
      operations: converted.operations,
    });
    const committedWorld = dbSnapshotToWorld(committed.snapshot);
    result.status = 'done';
    result.world = committedWorld;
    result.changedEntityIds = converted.changedEntityIds;
    result.eventIds = converted.eventIds;

    await updateRunRecord(chatKey, targetMessageId, record => ({
      ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, runSource, fingerprint)),
      source: runSource,
      messageFingerprint: fingerprint,
      status: 'done',
      attempt,
      finishedAt: Date.now(),
      candidateNames: [...input.candidateNames],
      changedEntityIds: [...converted.changedEntityIds],
      eventIds: [...converted.eventIds],
      error: undefined,
    }));

    const worldbookName = settings.worldbookAutoSync ? resolveCurrentCharacterWorldbookName() : null;
    if (settings.worldbookAutoSync && worldbookName) {
      await updateDbWorldbookSyncState(chatKey, {
        status: 'pending',
        worldbookName,
        lastAttemptAt: Date.now(),
      }).catch(error => console.warn('[世界演变] 标记世界书待同步失败:', error));
      try {
        report('syncing', '正在同步 WorldEvolution 世界书条目');
        await syncWorldEvolutionWorldbook(worldbookName, committedWorld);
        await updateDbWorldbookSyncState(chatKey, {
          status: 'synced',
          worldbookName,
          lastAttemptAt: Date.now(),
          lastSuccessAt: Date.now(),
        });
      } catch (error) {
        // 世界书是投影层；同步失败不应让已提交的世界状态再次调用 AI。
        result.error = `世界书同步失败：${error instanceof Error ? error.message : String(error)}`;
        await updateDbWorldbookSyncState(chatKey, {
          status: 'failed',
          worldbookName,
          lastAttemptAt: Date.now(),
          error: result.error,
        }).catch(syncError => console.warn('[世界演变] 记录世界书失败状态失败:', syncError));
        await updateRunRecord(chatKey, targetMessageId, record => ({
          ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, runSource, fingerprint)),
          source: runSource,
          status: 'done',
          attempt,
          finishedAt: Date.now(),
          candidateNames: [...input.candidateNames],
          changedEntityIds: [...converted.changedEntityIds],
          eventIds: [...converted.eventIds],
          error: result.error,
        }));
        console.warn('[世界演变] 世界书同步失败，保留已提交状态:', error);
      }
    } else if (settings.worldbookAutoSync) {
      await updateDbWorldbookSyncState(chatKey, {
        status: 'never',
        error: '当前角色卡未绑定主世界书，已跳过世界书投影',
      }).catch(error => console.warn('[世界演变] 记录世界书跳过状态失败:', error));
    }
    report(
      'done',
      `世界演变完成：${converted.changedEntityIds.length} 个对象，${converted.eventIds.length} 条事件`,
      result,
    );
    return result;
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    await updateRunRecord(chatKey, targetMessageId, record => ({
      ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, runSource)),
      source: runSource,
      status: 'failed',
      attempt,
      finishedAt: Date.now(),
      candidateNames: [...result.candidateNames],
      changedEntityIds: [...result.changedEntityIds],
      eventIds: [...result.eventIds],
      error: result.error,
    }));
    report('failed', result.error, result);
    return result;
  }
}

export async function retryPendingWorldbookSync(
  chatKey = getCurrentChatKey(),
  settings = loadSettings(),
): Promise<boolean> {
  if (!settings.worldbookAutoSync) return false;
  const worldbookName = resolveCurrentCharacterWorldbookName();
  if (!worldbookName) {
    await updateDbWorldbookSyncState(chatKey, {
      status: 'never',
      error: '当前角色卡未绑定主世界书，已跳过世界书投影',
    }).catch(error => console.warn('[世界演变] 记录世界书跳过状态失败:', error));
    return false;
  }
  const world = dbSnapshotToWorld(await loadDbSnapshot(chatKey));
  const now = Date.now();
  await updateDbWorldbookSyncState(chatKey, {
    status: 'pending',
    worldbookName,
    lastAttemptAt: now,
  });
  try {
    await syncWorldEvolutionWorldbook(worldbookName, world);
    await updateDbWorldbookSyncState(chatKey, {
      status: 'synced',
      worldbookName,
      lastAttemptAt: now,
      lastSuccessAt: Date.now(),
    });
    return true;
  } catch (error) {
    await updateDbWorldbookSyncState(chatKey, {
      status: 'failed',
      worldbookName,
      lastAttemptAt: now,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function queueSourceToRunSource(source: string): 'auto' | 'manual' {
  return source === 'manual' ? 'manual' : 'auto';
}

function ensureWorldEvolutionQueue(settings: WorldEvolutionSettings): WorldEvolutionFloorQueue {
  if (!worldEvolutionQueue) {
    worldEvolutionQueue = new WorldEvolutionFloorQueue(
      async task => {
        const currentSettings = loadSettings();
        report('waiting', `正在等待第 ${task.messageId} 楼稳定`);
        await waitForStableSnapshot({
          read: () => getLatestMessage(task.messageId),
          equals: (left, right) => left?.id === right?.id && left?.text === right?.text,
          pollMs: currentSettings.stablePollMs,
          stableSamples: currentSettings.stableSamples,
        });
        return executeWorldEvolution(task.messageId, {
          source: queueSourceToRunSource(task.source),
          attempt: task.attempt,
        });
      },
      {
        maxRetries: settings.maxRetries,
        retryDelayMs: settings.retryDelayMs,
      },
    );
  } else {
    worldEvolutionQueue.configure({
      maxRetries: settings.maxRetries,
      retryDelayMs: settings.retryDelayMs,
    });
  }
  return worldEvolutionQueue;
}

export async function runWorldEvolution(
  messageId?: number,
  options?: { source?: 'auto' | 'manual' },
): Promise<WorldEvolutionRunResult> {
  const settings = loadSettings();
  const latest = getLatestMessage(messageId);
  const targetMessageId = latest?.id ?? messageId ?? getLastMessageId();
  const skipped: WorldEvolutionRunResult = {
    status: 'idle',
    messageId: targetMessageId,
    candidateNames: [],
    changedEntityIds: [],
    eventIds: [],
  };

  if (!latest) {
    skipped.status = 'skipped';
    skipped.reason = '当前聊天没有可处理的消息';
    report('skipped', skipped.reason, skipped);
    return skipped;
  }
  if (!settings.enabled) {
    skipped.status = 'skipped';
    skipped.reason = '世界演变插件未启用';
    report('skipped', skipped.reason, skipped);
    return skipped;
  }

  const chatKey = getCurrentChatKey();
  const dbSnapshot = await loadDbSnapshot(chatKey);
  if (latest && isDbMessageProcessed(dbSnapshot, targetMessageId, fingerprintText(latest.text))) {
    skipped.status = 'skipped';
    skipped.reason = `消息楼层 ${targetMessageId} 已处理`;
    await updateRunRecord(chatKey, targetMessageId, record => ({
      ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, options?.source ?? 'auto')),
      status: 'skipped',
      finishedAt: Date.now(),
      error: skipped.reason,
    }));
    report('skipped', skipped.reason, skipped);
    return skipped;
  }

  const source = options?.source === 'manual' ? 'manual' : 'workflow-completed';
  const recordSource: WorldEvolutionRunRecord['source'] = options?.source === 'manual' ? 'manual' : 'auto';
  await updateRunRecord(chatKey, targetMessageId, record => ({
    ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, recordSource)),
    source: recordSource,
    status: 'queued',
    enqueuedAt: record?.enqueuedAt ?? Date.now(),
    finishedAt: undefined,
    error: undefined,
  }));
  report('waiting', `第 ${targetMessageId} 楼已进入世界演变队列`);
  return (await ensureWorldEvolutionQueue(settings).schedule(
    chatKey,
    targetMessageId,
    source,
  )) as WorldEvolutionRunResult;
}

export function getDefaultSettings(): WorldEvolutionSettings {
  return clone(DEFAULT_WORLD_EVOLUTION_SETTINGS);
}

export { loadSettings, saveSettings };
