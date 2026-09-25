import {
  createEmptyWorld,
  type WorldEvolutionEntity,
  type WorldEvolutionEvent,
  type WorldEvolutionRevision,
  type WorldEvolutionScheduledEvent,
  type WorldEvolutionRunRecord,
  type WorldEvolutionSettings,
  type WorldEvolutionWorld,
} from './types';

const DB_NAME = 'acu-world-evolution';
const DB_VERSION = 1;
const STORE_NAME = 'worlds';
const SCRIPT_SETTINGS_KEY = 'world_evolution_settings_v1';
const MAX_HISTORY_ITEMS = 200;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'chatKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('世界演变 IndexedDB 打开失败'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('世界演变 IndexedDB 请求失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('世界演变 IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('世界演变 IndexedDB 事务已中止'));
  });
}

export async function loadWorld(chatKey: string): Promise<WorldEvolutionWorld> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const value = await requestResult<WorldEvolutionWorld | undefined>(transaction.objectStore(STORE_NAME).get(chatKey));
    return value ? clone(value) : createEmptyWorld(chatKey);
  } finally {
    database.close();
  }
}

export async function saveWorld(world: WorldEvolutionWorld): Promise<void> {
  const normalized: WorldEvolutionWorld = {
    ...clone(world),
    updatedAt: Date.now(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(normalized);
    await transactionDone(transaction);
  } catch (error) {
    console.error('[世界演变] IndexedDB 写入失败:', error);
    throw error;
  } finally {
    database.close();
  }
}

export async function saveWorldIfRevisionMatches(
  world: WorldEvolutionWorld,
  expectedRevision: number,
): Promise<boolean> {
  const normalized: WorldEvolutionWorld = {
    ...clone(world),
    updatedAt: Date.now(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    return await new Promise<boolean>((resolve, reject) => {
      let revisionConflict = false;
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      transaction.oncomplete = () => finish(() => resolve(true));
      transaction.onerror = () => {
        if (revisionConflict) return;
        finish(() => reject(transaction.error ?? new Error('世界演变 IndexedDB 事务失败')));
      };
      transaction.onabort = () => {
        if (revisionConflict) {
          finish(() => resolve(false));
          return;
        }
        finish(() => reject(transaction.error ?? new Error('世界演变 IndexedDB 事务已中止')));
      };

      const request = store.get(world.chatKey);
      request.onsuccess = () => {
        const currentWorld = request.result as WorldEvolutionWorld | undefined;
        const currentRevision = currentWorld?.revision ?? 0;
        if (currentRevision !== expectedRevision) {
          revisionConflict = true;
          transaction.abort();
          return;
        }
        store.put(normalized);
      };
    });
  } catch (error) {
    console.error('[世界演变] 并发保护写入失败:', error);
    throw error;
  } finally {
    database.close();
  }
}

export async function clearWorld(chatKey: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(chatKey);
    await transactionDone(transaction);
  } catch (error) {
    console.error('[世界演变] 清除世界失败:', error);
    throw error;
  } finally {
    database.close();
  }
}

export function getWorldEvolutionRunRecordKey(chatKey: string, messageId: number): string {
  return `${chatKey}\u0000${messageId}`;
}

/**
 * 运行记录与世界状态分开更新，保证排队/失败等中间状态也能在面板或刷新后保留。
 * 世界演变任务本身是单并发的，因此这里用“读-改-写”即可；最终世界提交仍由
 * saveWorldIfRevisionMatches 负责并发保护。
 */
export async function updateWorldEvolutionRunRecord(
  chatKey: string,
  messageId: number,
  updater: (record: WorldEvolutionRunRecord | undefined) => WorldEvolutionRunRecord | undefined,
): Promise<WorldEvolutionWorld> {
  const world = await loadWorld(chatKey);
  const key = getWorldEvolutionRunRecordKey(chatKey, messageId);
  const index = world.runRecords.findIndex(record => record.key === key);
  const nextRecord = updater(index >= 0 ? clone(world.runRecords[index]) : undefined);
  if (nextRecord) {
    if (index >= 0) world.runRecords[index] = clone(nextRecord);
    else world.runRecords.push(clone(nextRecord));
  } else if (index >= 0) {
    world.runRecords.splice(index, 1);
  }
  await saveWorld(trimWorldHistory(world));
  return world;
}

export async function mutateWorldManually(
  chatKey: string,
  mutator: (world: WorldEvolutionWorld) => void,
): Promise<WorldEvolutionWorld> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await loadWorld(chatKey);
    const next = clone(current);
    mutator(next);
    next.revision += 1;
    next.revisions.push({
      revision: next.revision,
      messageId: -1,
      source: 'manual',
      changedEntityIds: [],
      createdEventIds: [],
      createdAt: Date.now(),
    });
    const saved = await saveWorldIfRevisionMatches(next, current.revision);
    if (saved) return trimWorldHistory(next);
  }
  throw new Error('世界演变正在被其他任务更新，请稍后重试');
}

export async function updateWorldEntityManually(
  chatKey: string,
  entityId: string,
  patch: { state?: Record<string, unknown>; visibility?: WorldEvolutionEntity['visibility'] },
): Promise<WorldEvolutionWorld> {
  return mutateWorldManually(chatKey, world => {
    const entity = world.entities[entityId];
    if (!entity) throw new Error(`对象不存在：${entityId}`);
    if (patch.state) entity.state = { ...entity.state, ...clone(patch.state) };
    if (patch.visibility) entity.visibility = patch.visibility;
    entity.updatedAt = Date.now();
  });
}

export async function deleteWorldEntityManually(
  chatKey: string,
  entityId: string,
): Promise<WorldEvolutionWorld> {
  return mutateWorldManually(chatKey, world => {
    if (!world.entities[entityId]) throw new Error(`对象不存在：${entityId}`);
    delete world.entities[entityId];
  });
}

export async function exportWorld(chatKey: string): Promise<string> {
  return JSON.stringify(await loadWorld(chatKey), null, 2);
}

export async function importWorld(chatKey: string, raw: string): Promise<WorldEvolutionWorld> {
  const parsed = JSON.parse(raw) as Partial<WorldEvolutionWorld>;
  if (!parsed || typeof parsed !== 'object') throw new Error('世界演变备份不是对象');

  const world = createEmptyWorld(chatKey);
  world.revision = Number.isInteger(parsed.revision) ? Number(parsed.revision) : 0;
  world.entities = isRecord(parsed.entities) ? (parsed.entities as Record<string, WorldEvolutionEntity>) : {};
  world.events = Array.isArray(parsed.events) ? (parsed.events as WorldEvolutionEvent[]) : [];
  world.scheduledEvents = Array.isArray(parsed.scheduledEvents)
    ? (parsed.scheduledEvents as WorldEvolutionScheduledEvent[]).map(event => ({
        ...event,
        visibility: event.visibility ?? 'ai_context',
      }))
    : [];
  world.revisions = Array.isArray(parsed.revisions)
    ? (parsed.revisions as WorldEvolutionRevision[]).map(revision => ({
        ...revision,
        messageFingerprint:
          typeof revision.messageFingerprint === 'string' ? revision.messageFingerprint : undefined,
      }))
    : [];
  world.processedMessageKeys = Array.isArray(parsed.processedMessageKeys)
    ? parsed.processedMessageKeys.filter(value => typeof value === 'string')
    : [];
  world.runRecords = Array.isArray(parsed.runRecords)
    ? parsed.runRecords
        .filter(value => isRecord(value))
        .map(value => ({
          key: typeof value.key === 'string' ? value.key : '',
          chatKey,
          messageId: typeof value.messageId === 'number' ? value.messageId : -1,
          messageFingerprint:
            typeof value.messageFingerprint === 'string' ? value.messageFingerprint : undefined,
          source:
            value.source === 'manual' || value.source === 'retry' || value.source === 'auto'
              ? value.source
              : 'auto',
          status:
            value.status === 'queued' ||
            value.status === 'running' ||
            value.status === 'done' ||
            value.status === 'skipped' ||
            value.status === 'failed' ||
            value.status === 'cancelled'
              ? value.status
              : 'failed',
          attempt: typeof value.attempt === 'number' ? value.attempt : 1,
          enqueuedAt: typeof value.enqueuedAt === 'number' ? value.enqueuedAt : Date.now(),
          startedAt: typeof value.startedAt === 'number' ? value.startedAt : undefined,
          finishedAt: typeof value.finishedAt === 'number' ? value.finishedAt : undefined,
          candidateNames: Array.isArray(value.candidateNames)
            ? value.candidateNames.filter(item => typeof item === 'string')
            : [],
          changedEntityIds: Array.isArray(value.changedEntityIds)
            ? value.changedEntityIds.filter(item => typeof item === 'string')
            : [],
          eventIds: Array.isArray(value.eventIds)
            ? value.eventIds.filter(item => typeof item === 'string')
            : [],
          error: typeof value.error === 'string' ? value.error : undefined,
        }))
        .filter(value => value.key && value.messageId >= 0)
    : [];
  await saveWorld(world);
  return world;
}

export function loadSettings(): WorldEvolutionSettings {
  try {
    const raw = getVariables({ type: 'script', script_id: getScriptId() })?.[SCRIPT_SETTINGS_KEY];
    if (raw && typeof raw === 'object') {
      const value = raw as Partial<WorldEvolutionSettings>;
      return {
        enabled: value.enabled === true,
        autoRun: value.autoRun === true,
        maxRetries: normalizeLimit(value.maxRetries, 2),
        retryDelayMs: normalizeDelay(value.retryDelayMs, 1500),
        stablePollMs: normalizeDelay(value.stablePollMs, 200),
        stableSamples: Math.max(1, normalizeLimit(value.stableSamples, 2)),
        maxNpcPerRun: normalizeLimit(value.maxNpcPerRun, 3),
        maxOtherEntitiesPerRun: normalizeLimit(value.maxOtherEntitiesPerRun, 2),
        worldbookName: typeof value.worldbookName === 'string' ? value.worldbookName : '',
        worldbookAutoSync: value.worldbookAutoSync !== false,
        manualCandidates: Array.isArray(value.manualCandidates)
          ? value.manualCandidates.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
          : [],
        modelInstruction:
          typeof value.modelInstruction === 'string' && value.modelInstruction.trim()
            ? value.modelInstruction.trim()
            : '只处理给定候选对象。让 NPC、组织、社会和环境在主角视线之外合理行动；不要改写主角已经知道的事实，不要凭空结束剧情。',
      };
    }
  } catch (error) {
    console.warn('[世界演变] 读取设置失败，使用默认设置:', error);
  }

  return {
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
}

export function saveSettings(settings: WorldEvolutionSettings): void {
  insertOrAssignVariables(
    {
      [SCRIPT_SETTINGS_KEY]: {
        ...settings,
        maxRetries: normalizeLimit(settings.maxRetries, 2),
        retryDelayMs: normalizeDelay(settings.retryDelayMs, 1500),
        stablePollMs: normalizeDelay(settings.stablePollMs, 200),
        stableSamples: Math.max(1, normalizeLimit(settings.stableSamples, 2)),
        maxNpcPerRun: normalizeLimit(settings.maxNpcPerRun, 3),
        maxOtherEntitiesPerRun: normalizeLimit(settings.maxOtherEntitiesPerRun, 2),
        manualCandidates: settings.manualCandidates.map(item => item.trim()).filter(Boolean),
      },
    },
    { type: 'script', script_id: getScriptId() },
  );
}

function normalizeLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(50, Math.floor(value)));
}

function normalizeDelay(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(60_000, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function trimWorldHistory(world: WorldEvolutionWorld): WorldEvolutionWorld {
  const next = clone(world);
  next.events = next.events.slice(-MAX_HISTORY_ITEMS);
  next.revisions = next.revisions.slice(-MAX_HISTORY_ITEMS);
  next.processedMessageKeys = next.processedMessageKeys.slice(-MAX_HISTORY_ITEMS);
  next.runRecords = next.runRecords.slice(-MAX_HISTORY_ITEMS);
  return next;
}
