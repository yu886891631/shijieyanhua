import type { WorldEvolutionQueryContext } from './query/types';

export type WorldEvolutionEntityType = 'npc' | 'organization' | 'location' | 'environment' | 'social';
export const WORLD_EVOLUTION_VERSION = 'A0.1.0-alpha.8';

export type WorldEvolutionVisibility = 'backstage' | 'ai_context' | 'protagonist_known' | 'revealed';

export type WorldEvolutionSettings = {
  enabled: boolean;
  autoRun: boolean;
  maxRetries: number;
  retryDelayMs: number;
  stablePollMs: number;
  stableSamples: number;
  maxNpcPerRun: number;
  maxOtherEntitiesPerRun: number;
  /**
   * 旧版兼容字段。M6+ 的实际写入目标由当前角色卡的 primary 世界书自动解析，
   * 不再使用此字段作为默认目标。
   */
  worldbookName: string;
  worldbookAutoSync: boolean;
  manualCandidates: string[];
  modelInstruction: string;
};

export type WorldEvolutionEntity = {
  id: string;
  type: WorldEvolutionEntityType;
  name: string;
  state: Record<string, unknown>;
  visibility: WorldEvolutionVisibility;
  updatedAt: number;
  sourceMessageId?: number;
};

export type WorldEvolutionEvent = {
  id: string;
  type: string;
  actors: string[];
  summary: string;
  details?: string;
  time?: string;
  location?: string;
  visibility: WorldEvolutionVisibility;
  sourceMessageId: number;
  createdAt: number;
};

export type WorldEvolutionScheduledEvent = {
  id: string;
  title: string;
  trigger?: string;
  actors: string[];
  visibility: WorldEvolutionVisibility;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: number;
};

export type WorldEvolutionRevision = {
  revision: number;
  messageId: number;
  messageFingerprint?: string;
  source: 'auto' | 'manual';
  changedEntityIds: string[];
  createdEventIds: string[];
  createdAt: number;
  beforeEntities?: Record<string, WorldEvolutionEntity | null>;
  beforeEventCount?: number;
  beforeScheduledEvents?: WorldEvolutionScheduledEvent[];
  beforeProcessedMessageKeys?: string[];
  rollbackFromCheckpointId?: string;
};

export type WorldEvolutionCheckpoint = {
  id: string;
  revision: number;
  messageId: number;
  messageFingerprint?: string;
  reason: 'auto' | 'manual' | 'rollback';
  createdAt: number;
  entities: Record<string, WorldEvolutionEntity>;
  events: WorldEvolutionEvent[];
  scheduledEvents: WorldEvolutionScheduledEvent[];
  processedMessageKeys: string[];
};

export type WorldEvolutionWorldbookSyncState = {
  status: 'never' | 'pending' | 'synced' | 'failed';
  worldbookName?: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  error?: string;
};

export type WorldEvolutionRunRecord = {
  key: string;
  chatKey: string;
  messageId: number;
  messageFingerprint?: string;
  source: 'auto' | 'manual' | 'retry';
  status: 'queued' | 'running' | 'done' | 'skipped' | 'failed' | 'cancelled';
  attempt: number;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  candidateNames: string[];
  changedEntityIds: string[];
  eventIds: string[];
  error?: string;
};

export type WorldEvolutionWorld = {
  chatKey: string;
  revision: number;
  entities: Record<string, WorldEvolutionEntity>;
  events: WorldEvolutionEvent[];
  scheduledEvents: WorldEvolutionScheduledEvent[];
  revisions: WorldEvolutionRevision[];
  checkpoints: WorldEvolutionCheckpoint[];
  processedMessageKeys: string[];
  runRecords: WorldEvolutionRunRecord[];
  worldbookSync: WorldEvolutionWorldbookSyncState;
  updatedAt: number;
};

export type WorldEvolutionInput = {
  chatKey: string;
  messageId: number;
  latestMessage: string;
  mvuSnapshot: unknown;
  previousMvuSnapshot?: unknown;
  mvuChangeSummary: string;
  databaseSummary: string;
  databaseSnapshot: unknown;
  candidateNames: string[];
  queryContext?: WorldEvolutionQueryContext;
  currentTime?: string;
  currentLocation?: string;
};

export const DEFAULT_WORLD_EVOLUTION_SETTINGS: WorldEvolutionSettings = {
  enabled: false,
  autoRun: false,
  maxRetries: 2,
  retryDelayMs: 1500,
  stablePollMs: 200,
  stableSamples: 2,
  maxNpcPerRun: 3,
  maxOtherEntitiesPerRun: 2,
  worldbookName: '',
  worldbookAutoSync: true,
  manualCandidates: [],
  modelInstruction:
    '只处理给定候选对象。让 NPC、组织、社会和环境在主角视线之外合理行动；不要改写主角已经知道的事实，不要凭空结束剧情。',
};

export function createEmptyWorld(chatKey: string): WorldEvolutionWorld {
  return {
    chatKey,
    revision: 0,
    entities: {},
    events: [],
    scheduledEvents: [],
    revisions: [],
    checkpoints: [],
    processedMessageKeys: [],
    runRecords: [],
    worldbookSync: { status: 'never' },
    updatedAt: Date.now(),
  };
}
