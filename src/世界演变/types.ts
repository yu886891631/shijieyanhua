export type WorldEvolutionEntityType = 'npc' | 'organization' | 'location' | 'environment' | 'social';

export type WorldEvolutionVisibility = 'backstage' | 'ai_context' | 'protagonist_known' | 'revealed';

export type WorldEvolutionSettings = {
  enabled: boolean;
  autoRun: boolean;
  maxNpcPerRun: number;
  maxOtherEntitiesPerRun: number;
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
  source: 'auto' | 'manual';
  changedEntityIds: string[];
  createdEventIds: string[];
  createdAt: number;
};

export type WorldEvolutionWorld = {
  chatKey: string;
  revision: number;
  entities: Record<string, WorldEvolutionEntity>;
  events: WorldEvolutionEvent[];
  scheduledEvents: WorldEvolutionScheduledEvent[];
  revisions: WorldEvolutionRevision[];
  processedMessageKeys: string[];
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
  candidateNames: string[];
  currentTime?: string;
  currentLocation?: string;
};

export type WorldEvolutionAiUpdate = {
  type: WorldEvolutionEntityType;
  id?: string;
  name: string;
  visibility?: WorldEvolutionVisibility;
  changes: Record<string, unknown>;
};

export type WorldEvolutionAiEvent = {
  id?: string;
  type?: string;
  actors?: string[];
  summary: string;
  details?: string;
  time?: string;
  location?: string;
  visibility?: WorldEvolutionVisibility;
};

export type WorldEvolutionAiResult = {
  baseRevision: number;
  updates: WorldEvolutionAiUpdate[];
  events: WorldEvolutionAiEvent[];
  scheduledEvents: Array<{
    id?: string;
    title: string;
    trigger?: string;
    actors?: string[];
    visibility?: WorldEvolutionVisibility;
    status?: 'pending' | 'completed' | 'cancelled';
  }>;
};

export const DEFAULT_WORLD_EVOLUTION_SETTINGS: WorldEvolutionSettings = {
  enabled: false,
  autoRun: false,
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
    processedMessageKeys: [],
    updatedAt: Date.now(),
  };
}
