import { readMvuCandidates, readReplicaEnumCandidates, readShujukuCandidates, readWorkflowCandidates, worldEvolutionRowCandidate, worldEvolutionRowName } from './adapters';
import type {
  WorldEvolutionCandidate,
  WorldEvolutionCandidateRow,
  WorldEvolutionQueryContext,
  WorldEvolutionQueryInput,
} from './types';

const SOURCE_PRIORITY: Record<WorldEvolutionCandidate['source'], number> = {
  manual: 1000,
  replica_enum: 900,
  mvu: 800,
  workflow: 700,
  message: 600,
  pending_plan: 550,
  shujuku: 500,
  recent_event: 450,
  rotation: 100,
};

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isNpcTable(table: string): boolean {
  return /(^|[^a-z])(npc|character|role|actor)([^a-z]|$)|角色|人物/i.test(table);
}

function candidateIdentity(candidate: WorldEvolutionCandidate): string {
  return normalizeName(candidate.name).toLocaleLowerCase();
}

function rowIdentity(row: WorldEvolutionCandidateRow): string {
  return `${row.table}\u0000${row.rowId ?? normalizeName(row.name ?? '')}`;
}

function addCandidate(
  target: Map<string, WorldEvolutionCandidate>,
  rows: WorldEvolutionCandidateRow[],
  candidate: WorldEvolutionCandidate,
  row?: WorldEvolutionCandidateRow,
): void {
  const name = normalizeName(candidate.name);
  if (!name) return;
  const normalized: WorldEvolutionCandidate = {
    ...candidate,
    name,
    priority: candidate.priority || SOURCE_PRIORITY[candidate.source],
    evidence: [...new Set(candidate.evidence.filter(Boolean))],
  };
  const key = candidateIdentity(normalized);
  const existing = target.get(key);
  if (existing) {
    existing.evidence = [...new Set([...existing.evidence, ...normalized.evidence])];
    if (normalized.priority > existing.priority) {
      existing.priority = normalized.priority;
      existing.source = normalized.source;
      existing.table = normalized.table;
      existing.rowId = normalized.rowId;
    }
  } else {
    target.set(key, normalized);
  }
  if (row) {
    const duplicate = rows.some(existingRow => rowIdentity(existingRow) === rowIdentity(row));
    if (!duplicate) rows.push(row);
  }
}

function addAdapterResults(
  target: Map<string, WorldEvolutionCandidate>,
  rows: WorldEvolutionCandidateRow[],
  candidates: WorldEvolutionCandidate[],
  adapterRows: WorldEvolutionCandidateRow[],
): void {
  const rowsByName = new Map(adapterRows.map(row => [normalizeName(row.name ?? ''), row]));
  for (const candidate of candidates) {
    addCandidate(target, rows, candidate, rowsByName.get(normalizeName(candidate.name)));
  }
}

function addOwnDatabaseCandidates(
  target: Map<string, WorldEvolutionCandidate>,
  rows: WorldEvolutionCandidateRow[],
  input: WorldEvolutionQueryInput,
): void {
  const message = input.messageText;
  for (const table of Object.keys(input.databaseSnapshot.rows)) {
    const typedTable = table as keyof typeof input.databaseSnapshot.rows;
    for (const row of input.databaseSnapshot.rows[typedTable]) {
      const name = worldEvolutionRowName(row);
      if (!name) continue;
      const baseEvidence = [`世界演变数据库表: ${table}`, `行: ${row.id}`, `revision: ${row.revision}`];
      const mentioned = message.includes(name);
      if (mentioned) {
        const candidate = worldEvolutionRowCandidate(table, row, 'message', SOURCE_PRIORITY.message, [
          ...baseEvidence,
          '当前楼层正文提及',
        ]);
        if (candidate) {
          addCandidate(target, rows, candidate, {
            table,
            rowId: row.id,
            name,
            row,
            source: 'message',
            evidence: candidate.evidence,
          });
        }
      }

      if (table === 'plan' && row.status !== 'completed' && row.status !== 'cancelled') {
        const actors = Array.isArray(row.data.actors) ? row.data.actors : [];
        for (const actor of actors) {
          if (typeof actor !== 'string' || !actor.trim()) continue;
          const actorName = actor.trim();
          addCandidate(
            target,
            rows,
            {
              table: 'npc',
              rowId: actorName,
              name: actorName,
              source: 'pending_plan',
              priority: SOURCE_PRIORITY.pending_plan,
              evidence: [...baseEvidence, `待办计划: ${name}`],
            },
            {
              table: 'plan',
              rowId: row.id,
              name,
              row,
              source: 'pending_plan',
              evidence: [...baseEvidence, `待办计划参与者: ${actorName}`],
            },
          );
        }
      }

      if (table === 'event') {
        const actors = Array.isArray(row.data.actors)
          ? row.data.actors
          : Array.isArray(row.data.actorIds)
            ? row.data.actorIds
            : [];
        for (const actor of actors) {
          if (typeof actor !== 'string' || !actor.trim()) continue;
          addCandidate(target, rows, {
            table: 'npc',
            rowId: actor.trim(),
            name: actor.trim(),
            source: 'recent_event',
            priority: SOURCE_PRIORITY.recent_event,
            evidence: [...baseEvidence, `最近事件: ${name}`],
          });
        }
      }

      if (table === 'event' || table === 'plan') continue;

      addCandidate(
        target,
        rows,
        worldEvolutionRowCandidate(
          table,
          row,
          'rotation',
          SOURCE_PRIORITY.rotation,
          [...baseEvidence, '后台轮转补位'],
        ) ?? {
          table,
          rowId: row.id,
          name,
          source: 'rotation',
          priority: SOURCE_PRIORITY.rotation,
          evidence: [...baseEvidence, '后台轮转补位'],
        },
        {
          table,
          rowId: row.id,
          name,
          row,
          source: 'rotation',
          evidence: [...baseEvidence, '后台轮转补位'],
        },
      );
    }
  }
}

function sortedCandidates(candidates: Iterable<WorldEvolutionCandidate>): WorldEvolutionCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    const nameCompare = left.name.localeCompare(right.name, 'zh-Hans-CN');
    if (nameCompare !== 0) return nameCompare;
    return `${left.table}\u0000${left.rowId ?? ''}`.localeCompare(
      `${right.table}\u0000${right.rowId ?? ''}`,
      'zh-Hans-CN',
    );
  });
}

function limitCandidates(
  candidates: WorldEvolutionCandidate[],
  maxNpcCandidates: number,
  maxOtherCandidates: number,
): WorldEvolutionCandidate[] {
  let npcSlots = Math.max(0, Math.floor(maxNpcCandidates));
  let otherSlots = Math.max(0, Math.floor(maxOtherCandidates));
  const selected: WorldEvolutionCandidate[] = [];
  for (const candidate of candidates) {
    if (isNpcTable(candidate.table)) {
      if (npcSlots <= 0) continue;
      npcSlots -= 1;
    } else {
      if (otherSlots <= 0) continue;
      otherSlots -= 1;
    }
    selected.push(candidate);
  }
  return selected;
}

function buildTableGroups(rows: WorldEvolutionCandidateRow[]): WorldEvolutionQueryContext['tables'] {
  const groups = new Map<string, WorldEvolutionCandidateRow[]>();
  for (const row of rows) {
    const list = groups.get(row.table) ?? [];
    list.push(row);
    groups.set(row.table, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'))
    .map(([table, tableRows]) => ({ table, rows: tableRows }));
}

export function queryWorldEvolutionCandidates(input: WorldEvolutionQueryInput): WorldEvolutionQueryContext {
  const merged = new Map<string, WorldEvolutionCandidate>();
  const rows: WorldEvolutionCandidateRow[] = [];

  const replica = readReplicaEnumCandidates(input.messageText);
  addAdapterResults(merged, rows, replica.candidates, replica.rows);

  const mvu = readMvuCandidates(input.mvuSnapshot, input.previousMvuSnapshot);
  addAdapterResults(merged, rows, mvu.candidates, mvu.rows);

  const workflow = readWorkflowCandidates(input.workflowSnapshot);
  addAdapterResults(merged, rows, workflow.candidates, workflow.rows);

  const shujuku = readShujukuCandidates(input.shujukuSnapshot);
  addAdapterResults(merged, rows, shujuku.candidates, shujuku.rows);

  addOwnDatabaseCandidates(merged, rows, input);

  for (const name of input.manualCandidates ?? []) {
    const normalized = normalizeName(name);
    if (!normalized) continue;
    addCandidate(merged, rows, {
      table: 'npc',
      rowId: normalized,
      name: normalized,
      source: 'manual',
      priority: SOURCE_PRIORITY.manual,
      evidence: ['用户手动候选'],
    });
  }

  const candidates = limitCandidates(
    sortedCandidates(merged.values()),
    input.maxNpcCandidates,
    input.maxOtherCandidates,
  );
  const selectedNames = new Set(candidates.map(candidate => candidateIdentity(candidate)));
  const selectedRows = rows.filter(
    row =>
      !row.name ||
      selectedNames.has(normalizeName(row.name).toLocaleLowerCase()) ||
      row.source === 'pending_plan' ||
      row.source === 'recent_event',
  );

  return {
    candidates,
    candidateRows: selectedRows,
    tables: buildTableGroups(selectedRows),
    currentFloor: {
      messageId: input.messageId,
      text: input.messageText,
    },
    mvuSnapshot: input.mvuSnapshot,
    previousMvuSnapshot: input.previousMvuSnapshot,
    workflowSnapshot: input.workflowSnapshot ?? null,
    shujukuSnapshot: input.shujukuSnapshot ?? null,
  };
}
