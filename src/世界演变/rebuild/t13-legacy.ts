/** Conservative legacy baseline. Unknown fields/history survive in sealed material, not guessed SQL. */
import { cloneT2Json, normalizeT2Template, type T2Json, type T2Reference } from './t2-template';
import { createDefaultT2Template, T2_DEFAULT_TABLE_IDS } from './t2-defaults';
import { createT2EmptyWorld, normalizeT2WorldData, prepareT2NewRow } from './t2-values';
import { newT6Field } from './t6-editor';
import { fingerprintT4, normalizeT4State, type T4State } from './t4-protocol';
import { copyT13, redactT13, T13Error } from './t13-backup';
import type { T13Evidence } from './t13-evidence';
type Obj = Record<string, T2Json>;
export const objectT13 = (x: T2Json): Obj => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new T13Error('FORMAT');
  return x;
};
const array = (x: T2Json | undefined): T2Json[] => {
  if (!Array.isArray(x)) throw new T13Error('FORMAT');
  return x;
};
const text = (x: T2Json | undefined): string => {
  if (typeof x !== 'string' || !x.length || x.length > 512) throw new T13Error('FORMAT');
  return x;
};
const visibility = (x: T2Json | undefined) => {
  if (!['backstage', 'ai_context', 'protagonist_known', 'revealed'].includes(String(x))) throw new T13Error('FORMAT');
  return { user: true, evolutionAi: true, mainAi: x === 'revealed' || x === 'protagonist_known' };
};
export interface T13LegacyPlan {
  state: T4State;
  evidence: T13Evidence;
  counts: { tableId: string; rows: number }[];
}
/** Recognized envelope shapes, never arbitrary object -> NPC guessing. */
export function kindT13Legacy(input: unknown): 'alpha11' | 'legacy005' {
  const root = objectT13(cloneT2Json(input));
  if (
    root.rows &&
    root.meta &&
    ['floorRuns', 'revisions', 'checkpoints', 'projections'].every(k => Array.isArray(root[k]))
  ) {
    if (root.version !== undefined && root.version !== 'A0.1.0-alpha.11') throw new T13Error('FORMAT');
    return 'alpha11';
  }
  if (root.entities && Array.isArray(root.events) && Array.isArray(root.scheduledEvents)) {
    if (root.version !== undefined && root.version !== 'A0.0.5') throw new T13Error('FORMAT');
    return 'legacy005';
  }
  throw new T13Error('FORMAT');
}
export async function planT13Legacy(
  input: unknown,
  baseInput: T4State,
  keepUnresolved: boolean,
  secrets: readonly string[] = [],
): Promise<T13LegacyPlan> {
  const frozen = cloneT2Json(input),
    sourceKind = kindT13Legacy(frozen),
    base = normalizeT4State(baseInput);
  const sourceFingerprint = await fingerprintT4(frozen),
    redacted = redactT13(frozen, secrets),
    root = objectT13(redacted.value);
  const sourceChat = sourceKind === 'alpha11' ? text(objectT13(root.meta).chatKey) : text(root.chatKey);
  const template = createDefaultT2Template();
  template.id = base.template.id;
  template.templateVersion = base.template.templateVersion + 1;
  template.name = '旧世界迁移基线（宏观 / 微观）';
  for (const table of template.tables) {
    const name = newT6Field('name', '名称');
    name.required = true;
    name.nullable = false;
    const payload = newT6Field('legacy_data', '旧版完整资料');
    payload.nullable = false;
    payload.required = true;
    payload.constraints.maxLength = 200_000;
    payload.visibility.mainAi = false;
    payload.description = '无损保留旧版资料，不猜测类型；在结构页明确拆列后再用于演变。';
    payload.permissions = { manualWrite: false, aiWrite: false };
    payload.readonly = true;
    const links = newT6Field('links', '已验证关联', 'reference-list', template);
    links.constraints.reference = { tableIds: [...T2_DEFAULT_TABLE_IDS], onDelete: 'restrict' };
    links.constraints.maxItems = 256;
    links.defaultValue = [];
    links.visibility.mainAi = false;
    const status = newT6Field('legacy_status', '旧状态原文');
    status.visibility.mainAi = false;
    table.fields = [name, payload, links, status];
    table.runtime.enabled = false;
    table.export.enabled = false;
    table.export.fieldIds = ['name'];
    table.export.keyFieldIds = ['name'];
    table.context.fieldIds = ['name'];
    table.context.relatedTableIds = [];
  }
  const normalized = normalizeT2Template(template),
    data = createT2EmptyWorld(normalized, base.data.worldId, base.data.branchId);
  data.revision = base.data.revision;
  const records: {
    tableId: string;
    id: string;
    name: string;
    raw: Obj;
    body: Obj;
    visible: ReturnType<typeof visibility>;
    archived: boolean;
  }[] = [];
  if (sourceKind === 'alpha11') {
    const rows = objectT13(root.rows);
    for (const tableId of T2_DEFAULT_TABLE_IDS)
      for (const item of array(rows[tableId])) {
        const r = objectT13(item);
        if (r.table !== tableId || r.chatKey !== sourceChat) throw new T13Error('TARGET');
        const id = text(r.id),
          name = text(r.name ?? r.title ?? id);
        records.push({
          tableId,
          id,
          name,
          raw: r,
          body: objectT13(r.data),
          visible: visibility(r.visibility),
          archived: r.deletedAt !== undefined,
        });
      }
  } else {
    const entities = objectT13(root.entities);
    for (const [key, item] of Object.entries(entities)) {
      const r = objectT13(item),
        tableId = r.type === 'social' ? 'society' : String(r.type);
      if (!['npc', 'organization', 'location', 'society', 'environment'].includes(tableId))
        throw new T13Error('FORMAT');
      records.push({
        tableId,
        id: text(r.id ?? key),
        name: text(r.name),
        raw: r,
        body: objectT13(r.state),
        visible: visibility(r.visibility),
        archived: false,
      });
    }
    for (const [tableId, key] of [
      ['event', 'events'],
      ['plan', 'scheduledEvents'],
    ])
      for (const item of array(root[key])) {
        const r = objectT13(item);
        records.push({
          tableId,
          id: text(r.id),
          name: text(r.title ?? r.summary),
          raw: r,
          body: r,
          visible: visibility(r.visibility),
          archived: false,
        });
      }
  }
  if (records.length > 5000) throw new T13Error('SIZE');
  const mapping: T13Evidence['mapping'] = [],
    identities = new Set<string>();
  for (const record of records) {
    const k = `${record.tableId}/${record.id}`;
    if (identities.has(k)) throw new T13Error('CONFLICT');
    identities.add(k);
    // Hash includes legacy chat and table; even equal names/IDs across tables stay independent.
    const hash = await fingerprintT4([sourceChat, record.tableId, record.id]);
    mapping.push({ tableId: record.tableId, sourceId: record.id, rowId: `old-${hash.slice(0, 40)}` });
  }
  let unresolved = 0;
  for (const [i, record] of records.entries()) {
    const refs: T2Reference[] = [];
    const link = (id: string, allowed: readonly string[]) => {
      const found = mapping.filter(m => m.sourceId === id && allowed.includes(m.tableId));
      if (found.length !== 1) {
        unresolved++;
        if (!keepUnresolved) throw new T13Error('REFERENCE');
        return;
      }
      const target = { tableId: found[0].tableId, rowId: found[0].rowId };
      if (!refs.some(r => r.tableId === target.tableId && r.rowId === target.rowId)) refs.push(target);
    };
    const keyTargets: Record<string, readonly string[]> = {
      locationId: ['location'],
      organizationIds: ['organization'],
      memberIds: ['npc'],
      actorIds: ['npc'],
      relationIds: [...T2_DEFAULT_TABLE_IDS],
      relatedIds: [...T2_DEFAULT_TABLE_IDS],
    };
    for (const [key, targets] of Object.entries(keyTargets))
      if (Object.hasOwn(record.body, key)) {
        const value = record.body[key],
          ids = key.endsWith('Ids') ? array(value) : [value];
        for (const id of ids) link(text(id), targets);
      }
    // Early legacy actors are names, not stable IDs. Only exact, unique name matches may be linked.
    if (sourceKind === 'legacy005' && Array.isArray(record.body.actors))
      for (const actor of record.body.actors) {
        const found = records.filter(r => ['npc', 'organization'].includes(r.tableId) && r.name === text(actor));
        if (found.length !== 1) {
          unresolved++;
          if (!keepUnresolved) throw new T13Error('REFERENCE');
        } else link(found[0].id, [found[0].tableId]);
      }
    const values: Record<string, import('./t2-template').T2Cell> = {
      name: record.name,
      legacy_data: JSON.stringify(record.raw),
      links: refs,
    };
    if (typeof record.raw.status === 'string') values.legacy_status = record.raw.status;
    const row = prepareT2NewRow(normalized, record.tableId, mapping[i].rowId, values, {
      revision: base.data.revision,
      source: { kind: 'import', detail: `${sourceKind} 独立迁移基线` },
    });
    row.meta.visibility = record.visible;
    row.meta.archived = record.archived;
    data.tables[record.tableId].push(row);
  }
  const limitations = [
    '旧账本、检查点、未支持字段和投影清单仅作为原始审计材料，不伪造成可重放 SQL；只迁移当前行状态。',
    '旧资料原文完整保存在只读资料列；本阶段不猜测任意 JSON 的类型、历法或领域语义。请在结构页明确拆列后再启用演变。',
    '导入后演变和世界书导出默认关闭；旧世界书 UID / 同步状态不作为新系统所有权，仍需 T12 隔离检查。',
    '旧版本资料仍留在原库；回退前备份新世界，禁止两个写入器同时运行。',
  ];
  if (unresolved) limitations.push(`有 ${unresolved} 项不能唯一确认的关联；经明确选择仅保留原文，不建立假引用。`);
  if (redacted.redactions)
    limitations.push('凭据已移除；迁移材料不是含凭据原件的字节级副本。原件仍在原来源，不被本向导修改。');
  return {
    state: normalizeT4State({ template: normalized, data: normalizeT2WorldData(normalized, data) }),
    evidence: {
      version: 1,
      action: 'legacy',
      sourceKind,
      sourceFingerprint,
      material: redacted.value,
      materialFingerprint: await fingerprintT4(redacted.value),
      redactions: redacted.redactions,
      mapping,
      limitations,
      ledger: null,
    },
    counts: T2_DEFAULT_TABLE_IDS.map(tableId => ({ tableId, rows: data.tables[tableId].length })),
  };
}
