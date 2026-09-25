import {
  createEmptyWorld,
  type WorldEvolutionEntity,
  type WorldEvolutionEvent,
  type WorldEvolutionRevision,
  type WorldEvolutionScheduledEvent,
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
    ? (parsed.revisions as WorldEvolutionRevision[])
    : [];
  world.processedMessageKeys = Array.isArray(parsed.processedMessageKeys)
    ? parsed.processedMessageKeys.filter(value => typeof value === 'string')
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function trimWorldHistory(world: WorldEvolutionWorld): WorldEvolutionWorld {
  const next = clone(world);
  next.events = next.events.slice(-MAX_HISTORY_ITEMS);
  next.revisions = next.revisions.slice(-MAX_HISTORY_ITEMS);
  next.processedMessageKeys = next.processedMessageKeys.slice(-MAX_HISTORY_ITEMS);
  return next;
}
