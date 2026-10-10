/** Query-only, permission-filtered history. Never executes SQL or changes a commit head. */
import { cloneT2Json, type T2Json } from './t2-template';
import { parseT3Sql } from './t3-sql';
import type { T4Archive, T4Commit, T4State, T4Step } from './t4-protocol';
import { createT4PreviewModel, type T4PreviewChange } from './t4-preview';

const copy = <T>(v: T): T => cloneT2Json(v) as unknown as T;
export interface T11HistoryItem {
  id: string;
  seq: number;
  revision: number;
  kind: T4Commit['kind'];
  runId: string;
  messageId: string;
  swipeId: string;
  parent: string | null;
  source: string | null;
  templateName: string;
  templateVersion: number;
  worldTime: { calendarId: string; ordinalMinute: number } | null;
  sent: number | null;
  changes: T4PreviewChange[];
  macro: number;
  micro: number;
  truncated: boolean;
  checkpoint: { fingerprint: string; throughCommitId: string; throughSeq: number };
  sql: { batchId: string; sql: string | null; parameters: T2Json[] | null; reason: string | null }[];
}

/** Current permissions also constrain older snapshots, not just the permissions at that old revision. */
export function maskT11State(historical: T4State, current: T4State): T4State {
  const value = copy(historical);
  for (const table of value.template.tables) {
    const live = current.template.tables.find(t => t.id === table.id);
    table.visibility.user &&= !!live?.visibility.user;
    for (const field of table.fields) {
      const f = live?.fields.find(f => f.id === field.id);
      field.visibility.user &&= !!f?.visibility.user && !f.hiddenUi;
    }
    for (const row of value.data.tables[table.id]) {
      const r = current.data.tables[table.id]?.find(r => r.meta.id === row.meta.id);
      row.meta.visibility.user &&= !r || r.meta.visibility.user;
    }
  }
  return value;
}

function publicLog(step: T4Step, states: T4State[], secrets: string[]): boolean {
  const serialized = JSON.stringify(step);
  if (secrets.some(s => s && serialized.includes(s))) return false;
  const rowVisible = (tableId: string, rowId: string) => {
    const found = states.flatMap(s => s.data.tables[tableId]?.filter(r => r.meta.id === rowId) ?? []);
    return found.length > 0 && found.every(r => r.meta.visibility.user);
  };
  const fieldVisible = (tableId: string, fieldId: string) =>
    states.every(s => {
      const t = s.template.tables.find(t => t.id === tableId);
      const f = t?.fields.find(f => f.id === fieldId);
      return t?.visibility.user && f?.visibility.user && !f.hiddenUi;
    });
  const publicValue = (v: T2Json): boolean => {
    if (Array.isArray(v)) return v.every(publicValue);
    if (v && typeof v === 'object') {
      if (typeof v.tableId === 'string' && typeof v.rowId === 'string')
        return (
          states.every(s => s.template.tables.some(t => t.id === v.tableId && t.visibility.user)) &&
          rowVisible(v.tableId, v.rowId)
        );
      return Object.values(v).every(publicValue);
    }
    if (typeof v === 'string') {
      // A bound value may be a JSON-encoded reference/list. Treat it the same as a logical JSON cell.
      try {
        return publicValue(JSON.parse(v) as T2Json);
      } catch {
        return true;
      }
    }
    return true;
  };
  for (const g of [...step.policy.read, ...step.policy.write])
    if (!g.fieldIds.every(f => fieldVisible(g.tableId, f)) || !g.rowIds.every(r => rowVisible(g.tableId, r)))
      return false;
  try {
    for (const statement of parseT3Sql(step.sql)) {
      const table = states[0].template.tables.find(t => t.sqlName === statement.table);
      if (!table || !states.every(s => s.template.tables.some(t => t.id === table.id && t.visibility.user)))
        return false;
      const columns =
        statement.kind === 'update'
          ? statement.assignments.map(a => a.column)
          : statement.kind === 'delete'
            ? []
            : statement.columns;
      if (
        columns.some(
          column =>
            column !== '__we_row_id' && !fieldVisible(table.id, table.fields.find(f => f.sqlName === column)?.id ?? ''),
        )
      )
        return false;
      const values =
        statement.kind === 'insert'
          ? statement.values
          : statement.kind === 'update'
            ? [...statement.assignments.map(a => a.value), ...statement.targets]
            : (statement.targets ?? []);
      if (!values.every(v => publicValue(v.kind === 'parameter' ? step.parameters[v.index] : v.value))) return false;
      if (
        'targets' in statement &&
        statement.targets?.some(target => {
          const id = target.kind === 'parameter' ? step.parameters[target.index] : target.value;
          return (
            typeof id === 'string' &&
            states.some(s => s.data.tables[table.id].some(r => r.meta.id === id && !r.meta.visibility.user))
          );
        })
      )
        return false;
      // Unrestricted SELECT can disclose hidden rows even if the textual SQL looks harmless.
      if (
        statement.kind === 'select' &&
        !statement.targets &&
        states.some(s => s.data.tables[table.id].some(r => !r.meta.visibility.user))
      )
        return false;
    }
    return step.parameters.every(publicValue);
  } catch {
    return false;
  }
}

export function projectT11History(archive: T4Archive, current: T4State, secrets: string[] = []): T11HistoryItem[] {
  let base = archive.genesis;
  return archive.commits.map(commit => {
    const after = commit.snapshot.state;
    const maskedBase = maskT11State(base, current),
      maskedAfter = maskT11State(after, current);
    const preview = createT4PreviewModel({
      status: 'private',
      scope: archive.scope,
      base: maskedBase,
      draft: maskedAfter,
      anchor: commit.anchor,
      kind: commit.kind,
    });
    const item: T11HistoryItem = {
      id: commit.commitId,
      seq: commit.seq,
      revision: after.data.revision,
      kind: commit.kind,
      runId: commit.runId,
      messageId: commit.anchor.messageId,
      swipeId: commit.anchor.swipeId,
      parent: commit.parentCommitId,
      source: commit.sourceCommitId,
      templateName: after.template.name,
      templateVersion: after.template.templateVersion,
      worldTime: commit.evolution?.worldTime ?? null,
      sent: commit.evolution?.sent ?? null,
      changes: preview.changes,
      macro: preview.changes.filter(c => c.groupName === '宏观世界').length,
      micro: preview.changes.filter(c => c.groupName === '微观世界').length,
      truncated: preview.summary.truncated,
      checkpoint: {
        fingerprint: commit.afterStateFingerprint,
        throughCommitId: commit.snapshot.throughCommitId,
        throughSeq: commit.snapshot.throughSeq,
      },
      sql: commit.steps.map(step => {
        const allowed = publicLog(step, [maskedBase, maskedAfter, current], secrets);
        return {
          batchId: step.batchId,
          sql: allowed ? step.sql : null,
          parameters: allowed ? copy(step.parameters) : null,
          reason: allowed ? null : '日志涉及未公开字段、记录、引用或凭据；整批 SQL/参数不展示，存档原文没有改动。',
        };
      }),
    };
    base = after;
    return item;
  });
}
