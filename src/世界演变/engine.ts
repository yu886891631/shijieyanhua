import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import { loadSettings, saveSettings, loadWorld, saveWorld, trimWorldHistory } from './store';
import type {
  WorldEvolutionAiEvent,
  WorldEvolutionAiResult,
  WorldEvolutionAiUpdate,
  WorldEvolutionEntity,
  WorldEvolutionEntityType,
  WorldEvolutionEvent,
  WorldEvolutionInput,
  WorldEvolutionSettings,
  WorldEvolutionWorld,
} from './types';
import { DEFAULT_WORLD_EVOLUTION_SETTINGS } from './types';
import { syncWorldEvolutionWorldbook } from './worldbook';

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
let running = false;
const recentMvuSnapshots = new Map<string, unknown>();

export function setWorldEvolutionStatusListener(listener: WorldEvolutionStatusListener | undefined): void {
  statusListener = listener;
}

function report(status: WorldEvolutionRunStatus, message: string, result?: WorldEvolutionRunResult): void {
  statusListener?.({ status, message, result });
  console.info(`[世界演变] ${message}`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
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

function normalizeUpdate(update: WorldEvolutionAiUpdate): WorldEvolutionAiUpdate | null {
  if (!update || typeof update !== 'object') return null;
  if (!['npc', 'organization', 'location', 'environment', 'social'].includes(update.type)) return null;
  if (
    update.visibility != null &&
    !['backstage', 'ai_context', 'protagonist_known', 'revealed'].includes(update.visibility)
  ) {
    return null;
  }
  if (typeof update.name !== 'string' || !update.name.trim()) return null;
  if (!update.changes || typeof update.changes !== 'object' || Array.isArray(update.changes)) return null;
  return {
    ...update,
    name: update.name.trim(),
    changes: clone(update.changes),
  };
}

function parseWorldEvolutionResponse(raw: string): WorldEvolutionAiResult {
  let text = raw.trim();
  const tagged = text.match(/<WorldEvolution>([\s\S]*?)<\/WorldEvolution>/i);
  if (tagged?.[1]) text = tagged[1].trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(text) as WorldEvolutionAiResult;
  if (!parsed || typeof parsed !== 'object') throw new Error('世界演变 AI 返回的不是 JSON 对象');
  return parsed;
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
    `当前 MVU 快照：\n${compactJson(input.mvuSnapshot, 12000)}`,
    `本轮主AI消息：\n${input.latestMessage.slice(-12000)}`,
    `候选对象：${input.candidateNames.join('、') || '无'}`,
    `本轮上限：NPC 最多 ${settings.maxNpcPerRun} 个，其他对象最多 ${settings.maxOtherEntitiesPerRun} 个。`,
    `已有世界演变状态：\n${compactJson(entities, 10000)}`,
    `最近后台事件：\n${compactJson(world.events.slice(-20), 6000)}`,
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

async function callEvolutionAi(prompt: string): Promise<string> {
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
    databaseSummary: '',
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
  if (parsed.baseRevision != null && parsed.baseRevision !== world.revision) {
    throw new Error(`世界演变版本冲突：AI基于 ${parsed.baseRevision}，当前是 ${world.revision}`);
  }
  if (parsed.baseRevision == null) throw new Error('世界演变结果缺少 baseRevision，已拒绝提交');

  const updates = (parsed.updates ?? []).map(normalizeUpdate).filter((item): item is WorldEvolutionAiUpdate => item !== null);
  const npcCount = updates.filter(update => isNpcLike(update.type)).length;
  const otherCount = updates.length - npcCount;
  if (npcCount > settings.maxNpcPerRun) throw new Error(`本轮 NPC 更新 ${npcCount} 条，超过上限 ${settings.maxNpcPerRun}`);
  if (otherCount > settings.maxOtherEntitiesPerRun) {
    throw new Error(`本轮其他对象更新 ${otherCount} 条，超过上限 ${settings.maxOtherEntitiesPerRun}`);
  }

  const next = clone(world);
  const changedEntityIds: string[] = [];
  const now = Date.now();
  for (const update of updates) {
    if (!input.candidateNames.includes(update.name) && !settings.manualCandidates.includes(update.name)) {
      throw new Error(`AI 修改了非候选对象：${update.name}`);
    }
    const id = resolveEntityId(next, update);
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
  for (const rawEvent of parsed.events ?? []) {
    if (!rawEvent || typeof rawEvent.summary !== 'string' || !rawEvent.summary.trim()) continue;
    const event = rawEvent as WorldEvolutionAiEvent;
    const id = event.id?.trim() || `EV-${input.messageId}-${next.revision + eventIds.length + 1}`;
    if (next.events.some(item => item.id === id)) continue;
    const normalized: WorldEvolutionEvent = {
      id,
      type: event.type?.trim() || 'world_change',
      actors: Array.isArray(event.actors) ? event.actors.filter(value => typeof value === 'string') : [],
      summary: event.summary.trim(),
      details: event.details?.trim(),
      time: event.time?.trim(),
      location: event.location?.trim(),
      visibility:
        event.visibility && ['backstage', 'ai_context', 'protagonist_known', 'revealed'].includes(event.visibility)
          ? event.visibility
          : 'ai_context',
      sourceMessageId: input.messageId,
      createdAt: now,
    };
    next.events.push(normalized);
    eventIds.push(id);
  }

  for (const rawEvent of parsed.scheduledEvents ?? []) {
    if (!rawEvent || typeof rawEvent.title !== 'string' || !rawEvent.title.trim()) continue;
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
      title: rawEvent.title.trim(),
      trigger: rawEvent.trigger?.trim(),
      actors: Array.isArray(rawEvent.actors) ? rawEvent.actors.filter(value => typeof value === 'string') : [],
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
    source,
    changedEntityIds,
    createdEventIds: eventIds,
    createdAt: now,
  });
  next.processedMessageKeys.push(`${input.messageId}`);
  return { world: trimWorldHistory(next), changedEntityIds, eventIds };
}

export async function runWorldEvolution(
  messageId?: number,
  options?: { source?: 'auto' | 'manual' },
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
  if (running) {
    result.status = 'skipped';
    result.reason = '已有世界演变任务正在运行';
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
  const world = await loadWorld(chatKey);
  const messageKey = `${targetMessageId}`;
  if (world.processedMessageKeys.includes(messageKey)) {
    result.status = 'skipped';
    result.reason = `消息楼层 ${targetMessageId} 已处理`;
    report('skipped', result.reason, result);
    return result;
  }

  running = true;
  try {
    report('collecting', `正在收集第 ${targetMessageId} 楼输入`);
    const input = buildInput(chatKey, targetMessageId, latest.text, settings);
    const candidateNames = collectCandidateNames(world, input, settings);
    result.candidateNames = candidateNames;
    if (!candidateNames.length) {
      result.status = 'skipped';
      result.reason = '没有候选对象；可在面板中添加手动候选 NPC';
      report('skipped', result.reason, result);
      return result;
    }

    input.candidateNames = candidateNames.slice(0, settings.maxNpcPerRun + settings.maxOtherEntitiesPerRun);
    report('generating', `正在批量演变 ${input.candidateNames.length} 个候选对象`);
    const rawResponse = await callEvolutionAi(buildPrompt(input, world, settings));
    result.rawResponse = rawResponse;
    const parsed = parseWorldEvolutionResponse(rawResponse);

    report('committing', '正在校验并提交世界演变结果');
    const committed = validateAndCommit(world, parsed, input, settings, options?.source ?? 'manual');
    await saveWorld(committed.world);
    result.status = 'done';
    result.world = committed.world;
    result.changedEntityIds = committed.changedEntityIds;
    result.eventIds = committed.eventIds;

    if (settings.worldbookAutoSync && settings.worldbookName.trim()) {
      report('syncing', '正在同步 WorldEvolution 世界书条目');
      await syncWorldEvolutionWorldbook(settings.worldbookName.trim(), committed.world);
    }
    report('done', `世界演变完成：${committed.changedEntityIds.length} 个对象，${committed.eventIds.length} 条事件`, result);
    return result;
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    report('failed', result.error, result);
    return result;
  } finally {
    running = false;
  }
}

export function getDefaultSettings(): WorldEvolutionSettings {
  return clone(DEFAULT_WORLD_EVOLUTION_SETTINGS);
}

export { loadSettings, saveSettings };
