import type { WorldEvolutionDbSnapshot, WorldEvolutionDbTable } from '../../世界演变数据库/types';

export type WorldEvolutionCandidateSource =
  | 'replica_enum'
  | 'mvu'
  | 'workflow'
  | 'message'
  | 'pending_plan'
  | 'recent_event'
  | 'manual'
  | 'shujuku'
  | 'rotation';

export type WorldEvolutionCandidate = {
  table: string;
  rowId?: string;
  name: string;
  source: WorldEvolutionCandidateSource;
  priority: number;
  evidence: string[];
};

export type WorldEvolutionCandidateRow = {
  table: string;
  rowId?: string;
  name?: string;
  row: unknown;
  source: WorldEvolutionCandidateSource;
  evidence: string[];
};

export type WorldEvolutionQueryContext = {
  candidates: WorldEvolutionCandidate[];
  candidateRows: WorldEvolutionCandidateRow[];
  tables: Array<{
    table: string;
    rows: WorldEvolutionCandidateRow[];
  }>;
  currentFloor: {
    messageId: number;
    text: string;
  };
  mvuSnapshot: unknown;
  previousMvuSnapshot?: unknown;
  workflowSnapshot: unknown;
  shujukuSnapshot: unknown;
};

export type WorldEvolutionQueryInput = {
  messageId: number;
  messageText: string;
  databaseSnapshot: WorldEvolutionDbSnapshot;
  mvuSnapshot: unknown;
  previousMvuSnapshot?: unknown;
  workflowSnapshot?: unknown;
  shujukuSnapshot?: unknown;
  manualCandidates?: string[];
  maxNpcCandidates: number;
  maxOtherCandidates: number;
};

export function isWorldEvolutionDbTable(value: string): value is WorldEvolutionDbTable {
  return (
    value === 'npc' ||
    value === 'organization' ||
    value === 'location' ||
    value === 'society' ||
    value === 'environment' ||
    value === 'event' ||
    value === 'plan'
  );
}
