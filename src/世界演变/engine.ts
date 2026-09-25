import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import {
  loadSettings,
  saveSettings,
  loadWorld,
  saveWorldIfRevisionMatches,
  trimWorldHistory,
  getWorldEvolutionRunRecordKey,
  updateWorldEvolutionRunRecord,
} from './store';
import type {
  WorldEvolutionAiEvent,
  WorldEvolutionAiResult,
  WorldEvolutionAiUpdate,
  WorldEvolutionEntity,
  WorldEvolutionEntityType,
  WorldEvolutionEvent,
  WorldEvolutionInput,
  WorldEvolutionSettings,
  WorldEvolutionVisibility,
  WorldEvolutionWorld,
  WorldEvolutionRunRecord,
} from './types';
import { DEFAULT_WORLD_EVOLUTION_SETTINGS } from './types';
import { syncWorldEvolutionWorldbook } from './worldbook';
import {
  waitForStableSnapshot,
  WorldEvolutionFloorQueue,
} from './floor-queue';

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

export type WorldEvolutionAiCaller = (
  prompt: string,
  settings: WorldEvolutionSettings,
) => Promise<string>;

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
    await updateWorldEvolutionRunRecord(chatKey, messageId, updater);
  } catch (error) {
    // 运行记录是诊断信息，不能让它的写入失败覆盖真正的世界演变结果。
    console.warn('[世界演变] 运行记录写入失败:', error);
  }
}

function createQueuedRunRecord(
  chatKey: string,
  messageId: number,
  source: 'auto' | 'manual' | 'retry',
  messageFingerprint?: string,
): WorldEvolutionRunRecord {
  return {
    key: getWorldEvolutionRunRecordKey(chatKey, messageId),
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

function messageKey(messageId: number, text: string): string {
  return `${messageId}:${fingerprintText(text)}`;
}

function isMessageAlreadyProcessed(world: WorldEvolutionWorld, messageId: number, text: string): boolean {
  const fingerprint = fingerprintText(text);
  const exactKey = messageKey(messageId, text);
  if (world.processedMessageKeys.includes(exactKey)) return true;
  if (!world.processedMessageKeys.includes(`${messageId}`)) return false;
  const priorRecord = world.runRecords.find(record => record.messageId === messageId);
  return !priorRecord?.messageFingerprint || priorRecord.messageFingerprint === fingerprint;
}

function rollbackLatestRegeneratedMessage(
  world: WorldEvolutionWorld,
  messageId: number,
  currentFingerprint: string,
): boolean {
  const revision = world.revisions.at(-1);
  if (
    !revision ||
    revision.messageId !== messageId ||
    !revision.messageFingerprint ||
    revision.messageFingerprint === currentFingerprint ||
    !revision.beforeEntities ||
    revision.beforeEventCount == null ||
    !revision.beforeScheduledEvents ||
    !revision.beforeProcessedMessageKeys
  ) {
    return false;
  }

  for (const [entityId, previous] of Object.entries(revision.beforeEntities)) {
    if (previous) world.entities[entityId] = clone(previous);
    else delete world.entities[entityId];
  }
  world.events = world.events.slice(0, revision.beforeEventCount);
  world.scheduledEvents = clone(revision.beforeScheduledEvents);
  world.processedMessageKeys = [...revision.beforeProcessedMessageKeys];
  world.revisions = world.revisions.slice(0, -1);
  world.revision = Math.max(0, revision.revision - 1);
  return true;
}

function getLatestMessage(messageId?: number): { id: number; text: string } | null {
  const fallback = getChatMessages(-1)[0] as Record<string, unknown> | undefined;
  const message = messageId != null ? (getChatMessages(messageId)[0] as Record<string, unknown> | undefined) : fallback;
  if (!message) return null;
  const id = typeof message.message_id === 'number' ? message.message_id : messageId ?? getLastMessageId();
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

function getWorkflowSummary(messageId: number): string {
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
    if (!status?.taskResults?.length) return '';
    return compactJson(
      status.taskResults.map(task => ({
        taskName: task.taskName,
        success: task.success,
        skipped: task.skipped,
        skipReason: task.skipReason,
        preview: task.preview,
        extractedTags: task.extractedTags,
      })),
      8000,
    );
  } catch {
    return '';
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

function collectCandidateNames(world: WorldEvolutionWorld, input: WorldEvolutionInput, settings: WorldEvolutionSettings): string[] {
  const entities = Object.values(world.entities);
  const byName = new Map(entities.map(entity => [entity.name, entity]));
  const selected = new Set<string>();
  let npcSlots = settings.maxNpcPerRun;
  let otherSlots = settings.maxOtherEntitiesPerRun;

  const tryAdd = (name: string, expectedType?: WorldEvolutionEntityType) => {
    const normalized = name.trim();
    if (!normalized || selected.has(normalized)) return;
    const entity = byName.get(normalized);
    const type = entity?.type ?? expectedType ?? 'npc';
    if (isNpcLike(type)) {
      if (npcSlots <= 0) return;
      npcSlots -= 1;
    } else {
      if (otherSlots <= 0) return;
      otherSlots -= 1;
    }
    selected.add(normalized);
  };

  // 本轮明示角色与用户手动指定优先，避免候选过多时被旧实体挤掉。
  for (const name of [...settings.manualCandidates, ...input.candidateNames]) tryAdd(name);

  // 到期/待办事件涉及的对象其次；再按最久未更新排序轮转，让后台 NPC 有机会自主行动。
  const scheduledActors = world.scheduledEvents
    .filter(event => event.status === 'pending')
    .flatMap(event => event.actors);
  for (const name of scheduledActors) tryAdd(name);
  for (const entity of entities.sort((left, right) => left.updatedAt - right.updatedAt)) {
    tryAdd(entity.name, entity.type);
  }
  return [...selected];
}

function isNpcLike(entityType: WorldEvolutionEntityType): boolean {
  return entityType === 'npc';
}

function resolveEntityId(world: WorldEvolutionWorld, update: WorldEvolutionAiUpdate): string {
  if (update.id && world.entities[update.id]) {
    const byId = world.entities[update.id];
    if (byId.name !== update.name || byId.type !== update.type) {
      throw new Error(`对象 ID 与名称/类型不匹配：${update.id} → ${update.name}`);
    }
    return update.id;
  }
  const byName = Object.values(world.entities).find(entity => entity.name === update.name && entity.type === update.type);
  if (byName) return byName.id;
  return `${update.type}:${slugify(update.name)}`;
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `entity-${Date.now()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isVisibility(value: unknown): value is WorldEvolutionVisibility {
  return (
    typeof value === 'string' &&
    ['backstage', 'ai_context', 'protagonist_known', 'revealed'].includes(value)
  );
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`);
  return value.trim() || undefined;
}

function stringList(value: unknown, label: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label}必须是字符串数组`);
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function normalizeUpdate(update: unknown, index: number): WorldEvolutionAiUpdate {
  const label = `第 ${index + 1} 条对象更新`;
  if (!isRecord(update)) throw new Error(`${label}不是对象`);
  if (
    typeof update.type !== 'string' ||
    !['npc', 'organization', 'location', 'environment', 'social'].includes(update.type)
  ) {
    throw new Error(`${label}的 type 无效`);
  }
  if (update.visibility != null && !isVisibility(update.visibility)) {
    throw new Error(`${label}的 visibility 无效`);
  }
  if (typeof update.name !== 'string' || !update.name.trim()) {
    throw new Error(`${label}缺少有效的 name`);
  }
  if (update.id != null && (typeof update.id !== 'string' || !update.id.trim())) {
    throw new Error(`${label}的 id 无效`);
  }
  if (!isRecord(update.changes)) throw new Error(`${label}的 changes 必须是对象`);

  return {
    type: update.type as WorldEvolutionEntityType,
    id: typeof update.id === 'string' ? update.id.trim() : undefined,
    name: update.name.trim(),
    visibility: update.visibility as WorldEvolutionAiUpdate['visibility'],
    changes: clone(update.changes),
  };
}

function normalizeEvent(event: unknown, index: number): WorldEvolutionAiEvent {
  const label = `第 ${index + 1} 条事件`;
  if (!isRecord(event)) throw new Error(`${label}不是对象`);
  const summary = optionalText(event.summary, `${label}的 summary`);
  if (!summary) throw new Error(`${label}缺少有效的 summary`);
  if (event.visibility != null && !isVisibility(event.visibility)) {
    throw new Error(`${label}的 visibility 无效`);
  }
  return {
    id: optionalText(event.id, `${label}的 id`),
    type: optionalText(event.type, `${label}的 type`) ?? 'world_change',
    actors: stringList(event.actors, `${label}的 actors`),
    summary,
    details: optionalText(event.details, `${label}的 details`),
    time: optionalText(event.time, `${label}的 time`),
    location: optionalText(event.location, `${label}的 location`),
    visibility: event.visibility as WorldEvolutionVisibility | undefined,
  };
}

function normalizeScheduledEvent(
  event: unknown,
  index: number,
): WorldEvolutionAiResult['scheduledEvents'][number] {
  const label = `第 ${index + 1} 条待办计划`;
  if (!isRecord(event)) throw new Error(`${label}不是对象`);
  const title = optionalText(event.title, `${label}的 title`);
  if (!title) throw new Error(`${label}缺少有效的 title`);
  if (event.visibility != null && !isVisibility(event.visibility)) {
    throw new Error(`${label}的 visibility 无效`);
  }
  if (
    event.status != null &&
    event.status !== 'pending' &&
    event.status !== 'completed' &&
    event.status !== 'cancelled'
  ) {
    throw new Error(`${label}的 status 无效`);
  }
  return {
    id: optionalText(event.id, `${label}的 id`),
    title,
    trigger: optionalText(event.trigger, `${label}的 trigger`),
    actors: stringList(event.actors, `${label}的 actors`),
    visibility: event.visibility as WorldEvolutionVisibility | undefined,
    status: event.status as 'pending' | 'completed' | 'cancelled' | undefined,
  };
}

function parseWorldEvolutionResponse(raw: string): WorldEvolutionAiResult {
  let text = raw.trim();
  const tagged = text.match(/<WorldEvolution>([\s\S]*?)<\/WorldEvolution>/i);
  if (tagged?.[1]) text = tagged[1].trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error('世界演变 AI 返回的不是 JSON 对象');
  if (!Array.isArray(parsed.updates)) throw new Error('世界演变 AI 返回缺少 updates 数组');
  if (!Array.isArray(parsed.events)) throw new Error('世界演变 AI 返回缺少 events 数组');
  if (!Array.isArray(parsed.scheduledEvents)) throw new Error('世界演变 AI 返回缺少 scheduledEvents 数组');
  return parsed as unknown as WorldEvolutionAiResult;
}

function buildPrompt(input: WorldEvolutionInput, world: WorldEvolutionWorld, settings: WorldEvolutionSettings): string {
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
    '只输出 JSON，不要 Markdown，不要解释，不要输出 SQL。',
    '',
    '【当前输入】',
    `聊天标识：${input.chatKey}`,
    `消息楼层：${input.messageId}`,
    `当前时间：${input.currentTime || '未知'}`,
    `当前地点：${input.currentLocation || '未知'}`,
    `MVU变化摘要：${input.mvuChangeSummary || '无明显变化'}`,
    `前置工作流结果摘要：\n${input.databaseSummary || '无可用摘要'}`,
    `当前 MVU 快照：\n${compactJson(input.mvuSnapshot, 12000)}`,
    `本轮主AI消息：\n${input.latestMessage.slice(-12000)}`,
    `候选对象：${input.candidateNames.join('、') || '无'}`,
    `本轮上限：NPC 最多 ${settings.maxNpcPerRun} 个，其他对象最多 ${settings.maxOtherEntitiesPerRun} 个。`,
    `已有世界演变状态：\n${compactJson(entities, 10000)}`,
    `最近后台事件：\n${compactJson(world.events.slice(-20), 6000)}`,
    `待办演变计划：\n${compactJson(world.scheduledEvents.filter(event => event.status === 'pending').slice(-20), 6000)}`,
    '',
    '【输出结构】',
    JSON.stringify(
      {
        baseRevision: world.revision,
        updates: [
          {
            type: 'npc',
            id: '可选，已有对象优先使用',
            name: '角色全名',
            visibility: 'ai_context',
            changes: { current_location: '新状态', current_goal: '新目标' },
          },
        ],
        events: [
          {
            id: '可选，建议使用 EV-时间-序号',
            type: 'npc_action',
            actors: ['角色全名'],
            summary: '一句话描述后台行动',
            details: '可选的客观细节',
            visibility: 'ai_context',
          },
        ],
        scheduledEvents: [],
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
      description: '批量世界演变更新',
      // changes 是用户自定义世界状态键，必须允许扩展；用宽松 schema 后仍由本地校验完整性。
      strict: false,
      value: {
        type: 'object',
        properties: {
          baseRevision: { type: 'integer' },
          updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['npc', 'organization', 'location', 'environment', 'social'] },
                id: { type: 'string' },
                name: { type: 'string' },
                visibility: {
                  type: 'string',
                  enum: ['backstage', 'ai_context', 'protagonist_known', 'revealed'],
                },
                changes: { type: 'object', additionalProperties: true },
              },
              required: ['type', 'name', 'changes'],
              additionalProperties: false,
            },
          },
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                actors: { type: 'array', items: { type: 'string' } },
                summary: { type: 'string' },
                details: { type: 'string' },
                time: { type: 'string' },
                location: { type: 'string' },
                visibility: {
                  type: 'string',
                  enum: ['backstage', 'ai_context', 'protagonist_known', 'revealed'],
                },
              },
              required: ['summary'],
              additionalProperties: false,
            },
          },
          scheduledEvents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                trigger: { type: 'string' },
                actors: { type: 'array', items: { type: 'string' } },
                visibility: {
                  type: 'string',
                  enum: ['backstage', 'ai_context', 'protagonist_known', 'revealed'],
                },
                status: { type: 'string', enum: ['pending', 'completed', 'cancelled'] },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
        },
        required: ['baseRevision', 'updates', 'events', 'scheduledEvents'],
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

function buildInput(chatKey: string, messageId: number, text: string, settings: WorldEvolutionSettings): WorldEvolutionInput {
  const mvuSnapshot = getMvuSnapshot(messageId);
  const previous = recentMvuSnapshots.get(chatKey);
  recentMvuSnapshots.set(chatKey, clone(mvuSnapshot));
  const mvuChangeSummary =
    previous == null
      ? '本轮没有可比较的上一份 MVU 快照。'
      : compactJson({ previous, current: mvuSnapshot }, 8000);
  const replicaNames = extractReplicaNames(text);
  return {
    chatKey,
    messageId,
    latestMessage: text,
    mvuSnapshot,
    previousMvuSnapshot: previous,
    mvuChangeSummary,
    databaseSummary: getWorkflowSummary(messageId),
    candidateNames: [...new Set([...replicaNames, ...settings.manualCandidates])],
    currentTime: undefined,
    currentLocation: undefined,
  };
}

function validateAndCommit(
  world: WorldEvolutionWorld,
  parsed: WorldEvolutionAiResult,
  input: WorldEvolutionInput,
  settings: WorldEvolutionSettings,
  source: 'auto' | 'manual',
): { world: WorldEvolutionWorld; changedEntityIds: string[]; eventIds: string[] } {
  if (!Number.isInteger(parsed.baseRevision)) {
    throw new Error('世界演变结果缺少有效的 baseRevision，已拒绝提交');
  }
  if (parsed.baseRevision != null && parsed.baseRevision !== world.revision) {
    throw new Error(`世界演变版本冲突：AI基于 ${parsed.baseRevision}，当前是 ${world.revision}`);
  }

  if (!Array.isArray(parsed.updates)) throw new Error('世界演变结果缺少 updates 数组，已拒绝提交');
  const updates = parsed.updates.map((update, index) => normalizeUpdate(update, index));
  const events = parsed.events.map((event, index) => normalizeEvent(event, index));
  const scheduledEvents = parsed.scheduledEvents.map((event, index) => normalizeScheduledEvent(event, index));
  const updateIds = updates.map(update => {
    if (!input.candidateNames.includes(update.name) && !settings.manualCandidates.includes(update.name)) {
      throw new Error(`AI 修改了非候选对象：${update.name}`);
    }
    return resolveEntityId(world, update);
  });
  if (new Set(updateIds).size !== updateIds.length) {
    throw new Error('AI 更新批次包含重复对象，已拒绝整批提交');
  }

  const npcCount = updates.filter(update => isNpcLike(update.type)).length;
  const otherCount = updates.length - npcCount;
  if (npcCount > settings.maxNpcPerRun) throw new Error(`本轮 NPC 更新 ${npcCount} 条，超过上限 ${settings.maxNpcPerRun}`);
  if (otherCount > settings.maxOtherEntitiesPerRun) {
    throw new Error(`本轮其他对象更新 ${otherCount} 条，超过上限 ${settings.maxOtherEntitiesPerRun}`);
  }

  const beforeEntities: Record<string, WorldEvolutionEntity | null> = {};
  for (const id of updateIds) {
    beforeEntities[id] = world.entities[id] ? clone(world.entities[id]) : null;
  }
  const beforeEventCount = world.events.length;
  const beforeScheduledEvents = clone(world.scheduledEvents);
  const beforeProcessedMessageKeys = [...world.processedMessageKeys];
  const next = clone(world);
  const changedEntityIds: string[] = [];
  const now = Date.now();
  for (const [index, update] of updates.entries()) {
    const id = updateIds[index];
    const previous = next.entities[id];
    const entity: WorldEvolutionEntity = previous ?? {
      id,
      type: update.type,
      name: update.name,
      state: {},
      visibility: update.visibility ?? 'ai_context',
      updatedAt: now,
      sourceMessageId: input.messageId,
    };
    entity.state = { ...entity.state, ...clone(update.changes) };
    entity.visibility = update.visibility ?? entity.visibility;
    entity.updatedAt = now;
    entity.sourceMessageId = input.messageId;
    next.entities[id] = entity;
    changedEntityIds.push(id);
  }

  const eventIds: string[] = [];
  for (const event of events) {
    const id = event.id?.trim() || `EV-${input.messageId}-${next.revision + eventIds.length + 1}`;
    if (next.events.some(item => item.id === id)) continue;
    const normalized: WorldEvolutionEvent = {
      id,
      type: event.type ?? 'world_change',
      actors: event.actors ?? [],
      summary: event.summary,
      details: event.details,
      time: event.time,
      location: event.location,
      visibility: event.visibility ?? 'ai_context',
      sourceMessageId: input.messageId,
      createdAt: now,
    };
    next.events.push(normalized);
    eventIds.push(id);
  }

  for (const rawEvent of scheduledEvents) {
    const id = rawEvent.id?.trim() || `SE-${input.messageId}-${next.revision + next.scheduledEvents.length + 1}`;
    const existing = next.scheduledEvents.find(item => item.id === id);
    if (existing) {
      if (
        existing.status === 'pending' &&
        (rawEvent.status === 'completed' || rawEvent.status === 'cancelled')
      ) {
        existing.status = rawEvent.status;
      }
      continue;
    }
    next.scheduledEvents.push({
      id,
      title: rawEvent.title,
      trigger: rawEvent.trigger,
      actors: rawEvent.actors ?? [],
      visibility: rawEvent.visibility ?? 'ai_context',
      status:
        rawEvent.status === 'completed' || rawEvent.status === 'cancelled'
          ? rawEvent.status
          : 'pending',
      createdAt: now,
    });
  }

  next.revision += 1;
  next.revisions.push({
    revision: next.revision,
    messageId: input.messageId,
    messageFingerprint: fingerprintText(input.latestMessage),
    source,
    changedEntityIds,
    createdEventIds: eventIds,
    createdAt: now,
    beforeEntities,
    beforeEventCount,
    beforeScheduledEvents,
    beforeProcessedMessageKeys,
  });
  next.processedMessageKeys.push(messageKey(input.messageId, input.latestMessage));
  return { world: trimWorldHistory(next), changedEntityIds, eventIds };
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
  const storedWorld = await loadWorld(chatKey);
  const expectedRevision = storedWorld.revision;
  const fingerprint = fingerprintText(latest.text);
  const world = clone(storedWorld);
  const regeneratedLatest = rollbackLatestRegeneratedMessage(world, targetMessageId, fingerprint);
  const wasProcessed = !regeneratedLatest && isMessageAlreadyProcessed(world, targetMessageId, latest.text);
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
    const candidateNames = collectCandidateNames(world, input, settings);
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
    const rawResponse = await callEvolutionAi(buildPrompt(input, world, settings), settings);
    result.rawResponse = rawResponse;
    const parsed = parseWorldEvolutionResponse(rawResponse);

    report('committing', '正在校验并提交世界演变结果');
    const committed = validateAndCommit(world, parsed, input, settings, options?.source ?? 'manual');
    const saved = await saveWorldIfRevisionMatches(committed.world, expectedRevision);
    if (!saved) {
      throw new Error('世界演变数据已被其他任务更新；为避免覆盖，本轮结果未写入，请重新运行');
    }
    result.status = 'done';
    result.world = committed.world;
    result.changedEntityIds = committed.changedEntityIds;
    result.eventIds = committed.eventIds;

    await updateRunRecord(chatKey, targetMessageId, record => ({
      ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, runSource, fingerprint)),
      source: runSource,
      messageFingerprint: fingerprint,
      status: 'done',
      attempt,
      finishedAt: Date.now(),
      candidateNames: [...input.candidateNames],
      changedEntityIds: [...committed.changedEntityIds],
      eventIds: [...committed.eventIds],
      error: undefined,
    }));

    if (settings.worldbookAutoSync && settings.worldbookName.trim()) {
      try {
        report('syncing', '正在同步 WorldEvolution 世界书条目');
        await syncWorldEvolutionWorldbook(settings.worldbookName.trim(), committed.world);
      } catch (error) {
        // 世界书是投影层；同步失败不应让已提交的世界状态再次调用 AI。
        result.error = `世界书同步失败：${error instanceof Error ? error.message : String(error)}`;
        await updateRunRecord(chatKey, targetMessageId, record => ({
          ...(record ?? createQueuedRunRecord(chatKey, targetMessageId, runSource, fingerprint)),
          source: runSource,
          status: 'done',
          attempt,
          finishedAt: Date.now(),
          candidateNames: [...input.candidateNames],
          changedEntityIds: [...committed.changedEntityIds],
          eventIds: [...committed.eventIds],
          error: result.error,
        }));
        console.warn('[世界演变] 世界书同步失败，保留已提交状态:', error);
      }
    }
    report('done', `世界演变完成：${committed.changedEntityIds.length} 个对象，${committed.eventIds.length} 条事件`, result);
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
  const world = await loadWorld(chatKey);
  if (latest && isMessageAlreadyProcessed(world, targetMessageId, latest.text)) {
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
  return (await ensureWorldEvolutionQueue(settings).schedule(chatKey, targetMessageId, source)) as WorldEvolutionRunResult;
}

export function getDefaultSettings(): WorldEvolutionSettings {
  return clone(DEFAULT_WORLD_EVOLUTION_SETTINGS);
}

export { loadSettings, saveSettings };
