import type { WorldEvolutionEntity, WorldEvolutionWorld } from './types';
import { replaceWorldbookProjectionLedger } from '../世界演变数据库/store';
import type { WorldEvolutionDbWorldbookProjection, WorldEvolutionProjectionTable } from '../世界演变数据库/types';

const ENTRY_PREFIX = 'WorldEvolution-';
const MANAGED_BY = 'world-evolution-db-v1';
const LEGACY_MANAGED_BY = 'world-evolution-v1';
const worldbookLocks = new Map<string, Promise<void>>();

/**
 * 解析当前角色卡的主世界书。
 *
 * 工作流助手的默认写入目标同样是当前角色卡的 primary 世界书。
 * additional 世界书仍可被酒馆调用，但世界演变不会擅自把投影写入其中，
 * 也不会使用旧设置里手动填写的任意书名。
 */
export function resolveCurrentCharacterWorldbookName(): string | null {
  try {
    const books = getCharWorldbookNames('current');
    const primary = books.primary?.trim();
    return primary || null;
  } catch {
    return null;
  }
}

type Projection = {
  chatKey: string;
  table: WorldEvolutionProjectionTable;
  rowId: string;
  projectionKey: string;
  stableName: string;
  legacyNames: string[];
  partial: TypeFest.PartialDeep<WorldbookEntry>;
  contentFingerprint: string;
};

type ManagedEntry = {
  entry: WorldbookEntry;
  projectionKey?: string;
  chatKey?: string;
  legacy: boolean;
};

export type WorldEvolutionWorldbookInspection = {
  bookName: string;
  projectionCount: number;
  managedCount: number;
  missingCount: number;
  orphanCount: number;
  driftCount: number;
  legacyCount: number;
};

function entityTable(entity: WorldEvolutionEntity): Exclude<WorldEvolutionProjectionTable, 'index' | 'event' | 'plan'> {
  return entity.type === 'social' ? 'society' : entity.type;
}

function entityLabel(entity: WorldEvolutionEntity): string {
  const table = entityTable(entity);
  return table === 'npc'
    ? 'NPC'
    : table === 'organization'
      ? '组织'
      : table === 'location'
        ? '地点'
        : table === 'society'
          ? '社会'
          : '环境';
}

function entityStableName(entity: WorldEvolutionEntity): string {
  return `${ENTRY_PREFIX}${entityLabel(entity)}-${entity.id}`;
}

function entityLegacyName(entity: WorldEvolutionEntity): string {
  return `${ENTRY_PREFIX}${entityLabel(entity)}-${entity.name}`;
}

function projectionKey(chatKey: string, table: WorldEvolutionProjectionTable, rowId: string): string {
  return JSON.stringify([chatKey, table, rowId]);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function fingerprint(value: unknown): string {
  const text = stableJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createEntryContent(entity: WorldEvolutionEntity): string {
  return [
    '<世界演变后台状态>',
    `实体类型：${entity.type}`,
    `实体名称：${entity.name}`,
    `可见性：${entity.visibility}`,
    `最后更新楼层：${entity.sourceMessageId ?? '未知'}`,
    '当前后台状态：',
    JSON.stringify(entity.state, null, 2),
    '</世界演变后台状态>',
  ].join('\n');
}

function createEventContent(event: WorldEvolutionWorld['events'][number]): string {
  return [
    '<世界演变后台事件>',
    `事件编号：${event.id}`,
    `事件类型：${event.type}`,
    `相关对象：${event.actors.join('、') || '未指定'}`,
    `可见性：${event.visibility}`,
    event.time ? `发生时间：${event.time}` : '',
    event.location ? `地点：${event.location}` : '',
    `摘要：${event.summary}`,
    event.details ? `详情：${event.details}` : '',
    '</世界演变后台事件>',
  ]
    .filter(Boolean)
    .join('\n');
}

function createIndexContent(world: WorldEvolutionWorld): string {
  const entities = Object.values(world.entities)
    .filter(entity => entity.visibility !== 'backstage')
    .map(entity => `${entity.name}（${entity.type}）：${summarizeState(entity.state)}`)
    .join('\n');
  const events = world.events
    .filter(event => event.visibility !== 'backstage')
    .slice(-10)
    .map(event => `${event.id}：${event.summary}`)
    .join('\n');
  const scheduledEvents = world.scheduledEvents
    .filter(event => event.visibility !== 'backstage' && event.status === 'pending')
    .slice(-10)
    .map(event => `${event.id}：${event.title}${event.trigger ? `（${event.trigger}）` : ''}`)
    .join('\n');
  return [
    '<世界演变后台索引>',
    `当前世界演变版本：${world.revision}`,
    '活跃对象：',
    entities || '暂无',
    '近期后台事件：',
    events || '暂无',
    '待发生计划：',
    scheduledEvents || '暂无',
    '</世界演变后台索引>',
  ].join('\n');
}

function summarizeState(state: Record<string, unknown>): string {
  const entries = Object.entries(state)
    .slice(0, 3)
    .map(
      ([key, value]) => `${key}=${String(typeof value === 'object' ? JSON.stringify(value) : (value ?? '')).trim()}`,
    );
  return entries.join('；') || '暂无状态摘要';
}

function basePartial(
  content: string,
  strategy: 'constant' | 'selective',
  keys: string[],
): TypeFest.PartialDeep<WorldbookEntry> {
  return {
    enabled: true,
    content,
    strategy: {
      type: strategy,
      keys,
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    probability: 100,
    recursion: {
      prevent_incoming: true,
      prevent_outgoing: true,
      delay_until: null,
    },
    effect: {
      sticky: null,
      cooldown: null,
      delay: null,
    },
    position: {
      type: 'at_depth',
      role: 'system',
      depth: 2,
      order: 9800,
    },
  };
}

function withProjectionMetadata(
  partial: TypeFest.PartialDeep<WorldbookEntry>,
  input: {
    chatKey: string;
    table: WorldEvolutionProjectionTable;
    rowId: string;
    projectionKey: string;
    sourceRevision: number;
  },
): { partial: TypeFest.PartialDeep<WorldbookEntry>; contentFingerprint: string } {
  const fingerprintInput = {
    chatKey: input.chatKey,
    table: input.table,
    rowId: input.rowId,
    projectionKey: input.projectionKey,
    name: partial.name ?? '',
    enabled: partial.enabled !== false,
    content: partial.content ?? '',
    strategy: partial.strategy,
    probability: partial.probability,
    recursion: partial.recursion,
    effect: partial.effect,
    position: partial.position,
  };
  const contentFingerprint = fingerprint(fingerprintInput);
  return {
    contentFingerprint,
    partial: {
      ...partial,
      extra: {
        acuWorldEvolution: true,
        managedBy: MANAGED_BY,
        chatKey: input.chatKey,
        projectionKey: input.projectionKey,
        projectionTable: input.table,
        projectionRowId: input.rowId,
        contentFingerprint,
        sourceRevision: input.sourceRevision,
      },
    },
  };
}

function makeProjection(
  world: WorldEvolutionWorld,
  input: {
    table: WorldEvolutionProjectionTable;
    rowId: string;
    stableName: string;
    legacyNames?: string[];
    content: string;
    strategy: 'constant' | 'selective';
    keys: string[];
  },
): Projection {
  const key = projectionKey(world.chatKey, input.table, input.rowId);
  const named = withProjectionMetadata(
    { ...basePartial(input.content, input.strategy, input.keys), name: input.stableName },
    {
      chatKey: world.chatKey,
      table: input.table,
      rowId: input.rowId,
      projectionKey: key,
      sourceRevision: world.revision,
    },
  );
  return {
    chatKey: world.chatKey,
    table: input.table,
    rowId: input.rowId,
    projectionKey: key,
    stableName: input.stableName,
    legacyNames: input.legacyNames ?? [],
    partial: named.partial,
    contentFingerprint: named.contentFingerprint,
  };
}

function buildProjections(world: WorldEvolutionWorld): Projection[] {
  const projections: Projection[] = [
    makeProjection(world, {
      table: 'index',
      rowId: 'index',
      stableName: `${ENTRY_PREFIX}索引`,
      content: createIndexContent(world),
      strategy: 'constant',
      keys: [],
    }),
  ];

  for (const entity of Object.values(world.entities)) {
    if (entity.visibility === 'backstage') continue;
    projections.push(
      makeProjection(world, {
        table: entityTable(entity),
        rowId: entity.id,
        stableName: entityStableName(entity),
        legacyNames: [entityLegacyName(entity)],
        content: createEntryContent(entity),
        strategy: 'selective',
        keys: [entity.name, entity.id].filter(Boolean),
      }),
    );
  }

  for (const event of world.events.slice(-50)) {
    if (event.visibility === 'backstage') continue;
    projections.push(
      makeProjection(world, {
        table: 'event',
        rowId: event.id,
        stableName: `${ENTRY_PREFIX}事件-${event.id}`,
        legacyNames: [`${ENTRY_PREFIX}事件-${event.id}`],
        content: createEventContent(event),
        strategy: 'selective',
        keys: [event.id, ...event.actors].filter(Boolean),
      }),
    );
  }

  for (const event of world.scheduledEvents) {
    if (event.visibility === 'backstage' || event.status !== 'pending') continue;
    const content = [
      '<世界演变待办计划>',
      `计划编号：${event.id}`,
      `相关对象：${event.actors.join('、') || '未指定'}`,
      `计划：${event.title}`,
      event.trigger ? `触发条件：${event.trigger}` : '',
      '</世界演变待办计划>',
    ]
      .filter(Boolean)
      .join('\n');
    projections.push(
      makeProjection(world, {
        table: 'plan',
        rowId: event.id,
        stableName: `${ENTRY_PREFIX}计划-${event.id}`,
        legacyNames: [`${ENTRY_PREFIX}计划-${event.id}`],
        content,
        strategy: 'selective',
        keys: [event.id, ...event.actors].filter(Boolean),
      }),
    );
  }
  return projections;
}

function readManagedEntry(entry: WorldbookEntry): ManagedEntry | null {
  const extra = entry.extra;
  if (!extra?.acuWorldEvolution) return null;
  if (extra.managedBy !== MANAGED_BY && extra.managedBy !== LEGACY_MANAGED_BY) return null;
  return {
    entry,
    projectionKey: typeof extra.projectionKey === 'string' ? extra.projectionKey : undefined,
    chatKey: typeof extra.chatKey === 'string' ? extra.chatKey : undefined,
    legacy: extra.managedBy === LEGACY_MANAGED_BY,
  };
}

async function persistLedger(
  world: WorldEvolutionWorld,
  bookName: string,
  projections: Projection[],
  uidByProjectionKey: Map<string, number | string | undefined>,
  status: 'synced' | 'pending' | 'failed' | 'orphaned',
  error?: string,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const now = Date.now();
  const records: WorldEvolutionDbWorldbookProjection[] = projections.map(projection => ({
    key: '',
    chatKey: world.chatKey,
    bookName,
    projectionKey: projection.projectionKey,
    table: projection.table,
    rowId: projection.rowId,
    uid: uidByProjectionKey.get(projection.projectionKey),
    contentFingerprint: projection.contentFingerprint,
    sourceRevision: world.revision,
    status,
    error,
    updatedAt: now,
  }));
  try {
    await replaceWorldbookProjectionLedger(world.chatKey, bookName, records);
  } catch (ledgerError) {
    // 账本是恢复辅助层；宿主没有 IndexedDB（例如纯单元测试）时不阻断世界书投影。
    console.warn('[世界演变] 写入世界书投影账本失败:', ledgerError);
  }
}

function entryMatchesProjection(entry: WorldbookEntry, projection: Projection): boolean {
  const actualFingerprint = fingerprint({
    chatKey: projection.chatKey,
    table: projection.table,
    rowId: projection.rowId,
    projectionKey: projection.projectionKey,
    name: entry.name ?? '',
    enabled: entry.enabled !== false,
    content: entry.content ?? '',
    strategy: entry.strategy,
    probability: entry.probability,
    recursion: entry.recursion,
    effect: entry.effect,
    position: entry.position,
  });
  return (
    actualFingerprint === projection.contentFingerprint &&
    entry.extra?.contentFingerprint === projection.contentFingerprint &&
    entry.extra?.projectionKey === projection.projectionKey &&
    entry.extra?.managedBy === MANAGED_BY &&
    entry.extra?.chatKey === projection.chatKey
  );
}

/**
 * 将数据库投影精确收敛到 WorldEvolution-* 条目：
 * - updateWorldbookWith 只更新变更的 UID；
 * - deleteWorldbookEntries 只删除当前聊天明确托管的孤儿；
 * - createWorldbookEntries 只创建缺失条目；
 * - 用户条目、其它插件条目和其它 chatKey 的条目原样保留。
 */
async function syncWorldEvolutionWorldbookUnlocked(worldbookName: string, world: WorldEvolutionWorld): Promise<void> {
  const name = worldbookName.trim();
  if (!name) return;

  const projections = buildProjections(world);
  const desiredByKey = new Map(projections.map(projection => [projection.projectionKey, projection]));
  const current = await getWorldbook(name);
  const managed = current
    .map(readManagedEntry)
    .filter((item): item is ManagedEntry => item !== null)
    .filter(item => item.legacy || item.chatKey === world.chatKey);

  const matched = new Map<string, ManagedEntry>();
  const deleteEntries: WorldbookEntry[] = [];
  for (const item of managed) {
    let key = item.projectionKey;
    if (!key && item.legacy) {
      const migrated = projections.find(projection => projection.legacyNames.includes(item.entry.name.trim()));
      key = migrated?.projectionKey;
    }
    if (!key || !desiredByKey.has(key) || matched.has(key)) {
      deleteEntries.push(item.entry);
      continue;
    }
    matched.set(key, item);
  }

  const updatePairs = projections
    .map(projection => ({ projection, existing: matched.get(projection.projectionKey) }))
    .filter(
      (pair): pair is { projection: Projection; existing: ManagedEntry } =>
        !!pair.existing && !entryMatchesProjection(pair.existing.entry, pair.projection),
    );
  const createProjections = projections.filter(projection => !matched.has(projection.projectionKey));
  const uidByProjectionKey = new Map<string, number | string | undefined>();
  for (const projection of projections) {
    uidByProjectionKey.set(projection.projectionKey, matched.get(projection.projectionKey)?.entry.uid);
  }

  await persistLedger(world, name, projections, uidByProjectionKey, 'pending');
  try {
    if (deleteEntries.length) {
      const deleteUids = new Set(deleteEntries.map(entry => entry.uid).filter(uid => uid !== undefined));
      await deleteWorldbookEntries(
        name,
        entry =>
          (entry.uid !== undefined && deleteUids.has(entry.uid)) ||
          deleteEntries.some(
            candidate =>
              entry.name === candidate.name &&
              entry.extra?.acuWorldEvolution === true &&
              (entry.extra.managedBy === MANAGED_BY || entry.extra.managedBy === LEGACY_MANAGED_BY),
          ),
        { render: 'debounced' },
      );
    }

    if (updatePairs.length) {
      const byUid = new Map(
        updatePairs
          .filter(pair => pair.existing.entry.uid !== undefined)
          .map(pair => [pair.existing.entry.uid, pair.projection]),
      );
      await updateWorldbookWith(
        name,
        entries =>
          entries.map(entry => {
            const projection = byUid.get(entry.uid);
            return projection
              ? { ...entry, ...projection.partial, uid: entry.uid, name: projection.stableName }
              : entry;
          }),
        { render: 'debounced' },
      );
    }

    if (createProjections.length) {
      const created = await createWorldbookEntries(
        name,
        createProjections.map(projection => projection.partial),
        { render: 'debounced' },
      );
      for (const [index, projection] of createProjections.entries()) {
        uidByProjectionKey.set(projection.projectionKey, created.new_entries[index]?.uid);
      }
    }

    await persistLedger(world, name, projections, uidByProjectionKey, 'synced');
  } catch (error) {
    await persistLedger(
      world,
      name,
      projections,
      uidByProjectionKey,
      'failed',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

async function withWorldbookProjectionLock<T>(bookName: string, work: () => Promise<T>): Promise<T> {
  const previous = worldbookLocks.get(bookName) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  worldbookLocks.set(bookName, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (worldbookLocks.get(bookName) === current) worldbookLocks.delete(bookName);
  }
}

export async function syncWorldEvolutionWorldbook(worldbookName: string, world: WorldEvolutionWorld): Promise<void> {
  const name = worldbookName.trim();
  if (!name) return;
  await withWorldbookProjectionLock(name, () => syncWorldEvolutionWorldbookUnlocked(name, world));
}

/**
 * 强制清理当前聊天的插件托管条目后重新投影。
 * 其它聊天的世界演变条目、用户条目和其它插件条目均保留。
 */
export async function rebuildWorldEvolutionWorldbook(worldbookName: string, world: WorldEvolutionWorld): Promise<void> {
  const name = worldbookName.trim();
  if (!name) return;
  await withWorldbookProjectionLock(name, async () => {
    const current = await getWorldbook(name);
    const managed = current
      .map(readManagedEntry)
      .filter((item): item is ManagedEntry => item !== null)
      .filter(item => item.legacy || item.chatKey === world.chatKey);
    if (managed.length) {
      const deleteUids = new Set(managed.map(item => item.entry.uid).filter(uid => uid !== undefined));
      await deleteWorldbookEntries(
        name,
        entry =>
          (entry.uid !== undefined && deleteUids.has(entry.uid)) ||
          managed.some(
            item =>
              item.entry.name === entry.name &&
              entry.extra?.acuWorldEvolution === true &&
              (entry.extra.managedBy === MANAGED_BY || entry.extra.managedBy === LEGACY_MANAGED_BY),
          ),
        { render: 'debounced' },
      );
    }
    await syncWorldEvolutionWorldbookUnlocked(name, world);
  });
}

export async function inspectWorldEvolutionWorldbook(
  worldbookName: string,
  world: WorldEvolutionWorld,
): Promise<WorldEvolutionWorldbookInspection> {
  const name = worldbookName.trim();
  const projections = buildProjections(world);
  if (!name) {
    return {
      bookName: '',
      projectionCount: projections.length,
      managedCount: 0,
      missingCount: projections.length,
      orphanCount: 0,
      driftCount: 0,
      legacyCount: 0,
    };
  }

  const desiredByKey = new Map(projections.map(projection => [projection.projectionKey, projection]));
  const current = await getWorldbook(name);
  const managed = current
    .map(readManagedEntry)
    .filter((item): item is ManagedEntry => item !== null)
    .filter(item => item.legacy || item.chatKey === world.chatKey);
  const matched = new Set<string>();
  let orphanCount = 0;
  let driftCount = 0;
  let legacyCount = 0;

  for (const item of managed) {
    let key = item.projectionKey;
    if (item.legacy) {
      legacyCount += 1;
      if (!key) {
        key = projections.find(projection => projection.legacyNames.includes(item.entry.name.trim()))?.projectionKey;
      }
    }
    const projection = key ? desiredByKey.get(key) : undefined;
    if (!projection || matched.has(projection.projectionKey)) {
      orphanCount += 1;
      continue;
    }
    matched.add(projection.projectionKey);
    if (!entryMatchesProjection(item.entry, projection)) driftCount += 1;
  }

  return {
    bookName: name,
    projectionCount: projections.length,
    managedCount: managed.length,
    missingCount: projections.filter(projection => !matched.has(projection.projectionKey)).length,
    orphanCount,
    driftCount,
    legacyCount,
  };
}

export { buildProjections as buildWorldEvolutionProjections };
