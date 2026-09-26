import { parseReplicaEnumFromResponse } from '../../工作流助手/tasks/replica-enum-parse';
import type { WorldEvolutionDbRow } from '../../世界演变数据库/types';
import type {
  WorldEvolutionCandidate,
  WorldEvolutionCandidateRow,
  WorldEvolutionCandidateSource,
} from './types';

const NAME_KEYS = [
  'name',
  '名称',
  '姓名',
  '角色名',
  '角色名称',
  '显示名',
  'title',
  '名称全称',
  'canonicalName',
  'canonical_name',
];

const ID_KEYS = ['id', '_id', 'key', 'uid', 'ID', '编号', '稳定ID', 'stableId', 'stable_id'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneIfPossible<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeName(value: string): boolean {
  if (!value || value.length > 120) return false;
  if (/^(true|false|null|undefined|unknown|none)$/i.test(value)) return false;
  if (/^[\d\s.,:;+\-_/\\]+$/.test(value)) return false;
  return true;
}

function firstText(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeText(record[key]);
    if (looksLikeName(value)) return value;
  }
  return undefined;
}

function firstId(record: Record<string, unknown>): string | undefined {
  for (const key of ID_KEYS) {
    const value = normalizeText(record[key]);
    if (value) return value;
  }
  return undefined;
}

function pathTable(path: string[], fallback: string): string {
  const table = path.findLast(segment => segment && !/^\d+$/.test(segment));
  return table || fallback;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function addUniqueRow(
  rows: WorldEvolutionCandidateRow[],
  row: WorldEvolutionCandidateRow,
): void {
  const key = `${row.table}\u0000${row.rowId ?? row.name ?? stableStringify(row.row)}`;
  if (
    rows.some(
      existing =>
        `${existing.table}\u0000${existing.rowId ?? existing.name ?? stableStringify(existing.row)}` === key,
    )
  ) {
    return;
  }
  rows.push(row);
}

export function readReplicaEnumCandidates(text: string): {
  candidates: WorldEvolutionCandidate[];
  rows: WorldEvolutionCandidateRow[];
} {
  const parsed = parseReplicaEnumFromResponse(text);
  const candidates: WorldEvolutionCandidate[] = [];
  const rows: WorldEvolutionCandidateRow[] = [];
  for (const entry of parsed.entries) {
    const table = entry.specKey.split('@', 1)[0] || 'npc';
    for (const name of entry.values) {
      const evidence = [`ReplicaEnum ${entry.specKey}${entry.taskRef ? ` / ${entry.taskRef}` : ''}`];
      candidates.push({
        table,
        rowId: name,
        name,
        source: 'replica_enum',
        priority: 900,
        evidence,
      });
      addUniqueRow(rows, {
        table,
        rowId: name,
        name,
        row: { name, spec: entry.specKey, task: entry.taskRef },
        source: 'replica_enum',
        evidence,
      });
    }
  }
  return { candidates, rows };
}

type MvuReadResult = {
  candidates: WorldEvolutionCandidate[];
  rows: WorldEvolutionCandidateRow[];
  changedNames: string[];
};

function collectNamedRecords(
  value: unknown,
  previous: unknown,
  path: string[],
  candidates: WorldEvolutionCandidate[],
  rows: WorldEvolutionCandidateRow[],
  changedNames: Set<string>,
  visited: Set<unknown>,
): void {
  if (value == null || visited.has(value)) return;
  if (typeof value !== 'object') return;
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const previousItem = Array.isArray(previous) ? previous[index] : undefined;
      collectNamedRecords(item, previousItem, [...path, String(index)], candidates, rows, changedNames, visited);
    });
    return;
  }

  const record = value as Record<string, unknown>;
  const name = firstText(record, NAME_KEYS);
  const rowId = firstId(record);
  if (name) {
    const previousRecord = isRecord(previous) ? previous : undefined;
    const changed = stableStringify(record) !== stableStringify(previousRecord);
    const table = pathTable(path, 'mvu');
    const evidence = [`MVU 路径: ${path.length ? `/${path.join('/')}` : '/'}`];
    if (changed) {
      evidence.push('与上一份 MVU 快照不同');
      changedNames.add(name);
    }
    candidates.push({
      table,
      rowId,
      name,
      source: 'mvu',
      priority: changed ? 800 : 300,
      evidence,
    });
    addUniqueRow(rows, {
      table,
      rowId,
      name,
      row: cloneIfPossible(record),
      source: 'mvu',
      evidence,
    });
  }

  for (const [key, child] of Object.entries(record)) {
    if (child == null || typeof child !== 'object') continue;
    const previousChild = isRecord(previous) ? previous[key] : Array.isArray(previous) ? undefined : undefined;
    const collectionPath = path.at(-1) ?? '';
    if (
      isRecord(child) &&
      /(?:npc|npcs|character|characters|role|roles|actor|actors|角色|人物|角色表|名单)/i.test(collectionPath) &&
      looksLikeName(key.trim())
    ) {
      const changed = stableStringify(child) !== stableStringify(previousChild);
      const evidence = [`MVU 路径: /${[...path, key].join('/')}`];
      if (changed) {
        evidence.push('与上一份 MVU 快照不同');
        changedNames.add(key.trim());
      }
      candidates.push({
        table: collectionPath || 'mvu',
        rowId: firstId(child) ?? key.trim(),
        name: key.trim(),
        source: 'mvu',
        priority: changed ? 800 : 300,
        evidence,
      });
      addUniqueRow(rows, {
        table: collectionPath || 'mvu',
        rowId: firstId(child) ?? key.trim(),
        name: key.trim(),
        row: cloneIfPossible(child),
        source: 'mvu',
        evidence,
      });
    }
    collectNamedRecords(child, previousChild, [...path, key], candidates, rows, changedNames, visited);
  }
}

export function readMvuCandidates(current: unknown, previous?: unknown): MvuReadResult {
  const candidates: WorldEvolutionCandidate[] = [];
  const rows: WorldEvolutionCandidateRow[] = [];
  const changedNames = new Set<string>();
  collectNamedRecords(current, previous, [], candidates, rows, changedNames, new Set());
  return { candidates, rows, changedNames: [...changedNames] };
}

function collectWorkflowNamedRecords(
  value: unknown,
  path: string[],
  candidates: WorldEvolutionCandidate[],
  rows: WorldEvolutionCandidateRow[],
  visited: Set<unknown>,
): void {
  if (value == null || visited.has(value) || typeof value !== 'object') return;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectWorkflowNamedRecords(item, [...path, String(index)], candidates, rows, visited));
    return;
  }

  const record = value as Record<string, unknown>;
  const name = firstText(record, NAME_KEYS);
  if (name) {
    const evidence = [`工作流字段: ${path.length ? `/${path.join('/')}` : '/'}`];
    const table = pathTable(path, 'workflow');
    candidates.push({ table, rowId: firstId(record), name, source: 'workflow', priority: 700, evidence });
    addUniqueRow(rows, {
      table,
      rowId: firstId(record),
      name,
      row: cloneIfPossible(record),
      source: 'workflow',
      evidence,
    });
  }

  for (const [key, child] of Object.entries(record)) {
    if (
      typeof child === 'string' &&
      /(?:name|role|actor|character|npc|姓名|角色|人物|名称|副本)/i.test(key) &&
      looksLikeName(child.trim())
    ) {
      const normalized = child.trim();
      const evidence = [`工作流字段: ${[...path, key].join('/')}`];
      candidates.push({
        table: pathTable([...path, key], 'workflow'),
        rowId: normalized,
        name: normalized,
        source: 'workflow',
        priority: 650,
        evidence,
      });
      addUniqueRow(rows, {
        table: pathTable([...path, key], 'workflow'),
        rowId: normalized,
        name: normalized,
        row: { value: normalized, path: [...path, key].join('/') },
        source: 'workflow',
        evidence,
      });
      continue;
    }
    if (child == null || typeof child !== 'object') continue;
    collectWorkflowNamedRecords(child, [...path, key], candidates, rows, visited);
  }
}

export function readWorkflowCandidates(workflowSnapshot: unknown): {
  candidates: WorldEvolutionCandidate[];
  rows: WorldEvolutionCandidateRow[];
} {
  const candidates: WorldEvolutionCandidate[] = [];
  const rows: WorldEvolutionCandidateRow[] = [];
  collectWorkflowNamedRecords(workflowSnapshot, [], candidates, rows, new Set());
  return { candidates, rows };
}

function rowArrays(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ['rows', 'data', 'items', 'records', 'list', 'values']) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  return [value];
}

export function readShujukuCandidates(shujukuSnapshot: unknown): {
  candidates: WorldEvolutionCandidate[];
  rows: WorldEvolutionCandidateRow[];
} {
  const candidates: WorldEvolutionCandidate[] = [];
  const rows: WorldEvolutionCandidateRow[] = [];
  if (!isRecord(shujukuSnapshot)) return { candidates, rows };

  for (const [table, tableValue] of Object.entries(shujukuSnapshot)) {
    for (const rawRow of rowArrays(tableValue)) {
      if (!isRecord(rawRow)) continue;
      const name = firstText(rawRow, NAME_KEYS);
      const rowId = firstId(rawRow);
      if (!name && !rowId) continue;
      const displayName = name ?? rowId!;
      const evidence = [`shujuku 表: ${table}${rowId ? ` / 行: ${rowId}` : ''}`];
      candidates.push({
        table,
        rowId,
        name: displayName,
        source: 'shujuku',
        priority: 500,
        evidence,
      });
      addUniqueRow(rows, {
        table,
        rowId,
        name,
        row: cloneIfPossible(rawRow),
        source: 'shujuku',
        evidence,
      });
    }
  }
  return { candidates, rows };
}

export function worldEvolutionRowName(row: WorldEvolutionDbRow): string | undefined {
  const direct = normalizeText(row.name) || normalizeText(row.title);
  if (direct) return direct;
  return isRecord(row.data) ? firstText(row.data, NAME_KEYS) : undefined;
}

export function worldEvolutionRowCandidate(
  table: string,
  row: WorldEvolutionDbRow,
  source: WorldEvolutionCandidateSource,
  priority: number,
  evidence: string[],
): WorldEvolutionCandidate | null {
  const name = worldEvolutionRowName(row);
  if (!name) return null;
  return { table, rowId: row.id, name, source, priority, evidence };
}
