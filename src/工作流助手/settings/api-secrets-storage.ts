/** 禁止用 localStorage 存 API 凭据（与 shujuku 策略一致） */
const FORBID_BROWSER_LOCAL_STORAGE = true;

const STORAGE_KEY = 'secrets';
const IDB_DB_NAME = 'workflow_assistant_api_secrets_v1';
const IDB_STORE_NAME = 'kv';

let tavernNamespace: Record<string, string> | null = null;
let tavernSaveFn: (() => void) | null = null;
let idbCache: string | null | undefined = undefined;
let idbInitStarted = false;

function getSecretsNamespaceId(): string {
  try {
    return `${getScriptId()}__api_secrets_v1`;
  } catch {
    return 'workflow_assistant__api_secrets_v1';
  }
}

function getHostWindow(): Window {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      return window.parent;
    }
  } catch {
    /* cross-origin parent */
  }
  return typeof window !== 'undefined' ? window : (globalThis as unknown as Window);
}

function tryInitTavernBridge(): void {
  if (tavernNamespace) return;
  try {
    const host = getHostWindow();
    const st = (host as Window & { SillyTavern?: { getContext?: () => Record<string, unknown> } }).SillyTavern;
    const ctx = st?.getContext?.() as
      | { extensionSettings?: Record<string, unknown>; saveSettingsDebounced?: () => void }
      | undefined;
    const root = ctx?.extensionSettings;
    if (root && typeof root === 'object') {
      const userscripts = root.__userscripts as Record<string, Record<string, string>> | undefined;
      if (!userscripts || typeof userscripts !== 'object') {
        (root as Record<string, unknown>).__userscripts = {};
      }
      const nsRoot = (root as Record<string, unknown>).__userscripts as Record<string, Record<string, string>>;
      if (!nsRoot[getSecretsNamespaceId()]) nsRoot[getSecretsNamespaceId()] = {};
      tavernNamespace = nsRoot[getSecretsNamespaceId()];
      if (typeof ctx?.saveSettingsDebounced === 'function') {
        tavernSaveFn = ctx.saveSettingsDebounced;
      }
    }
  } catch {
    /* bridge unavailable */
  }
}

function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function openConfigDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadIdbCacheAsync(): Promise<void> {
  if (idbCache !== undefined) return;
  idbCache = null;
  const db = await openConfigDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(STORAGE_KEY);
      req.onsuccess = () => {
        idbCache = typeof req.result === 'string' ? req.result : null;
        resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function writeIdbCache(value: string): Promise<void> {
  idbCache = value;
  const db = await openConfigDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.put(value, STORAGE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 启动时初始化存储桥接；IDB 预加载异步进行，不阻塞脚本注册 */
export function initApiSecretsStorage(): void {
  tryInitTavernBridge();
  if (!idbInitStarted) {
    idbInitStarted = true;
    void loadIdbCacheAsync();
  }
  if (FORBID_BROWSER_LOCAL_STORAGE) {
    /* intentional no-op */
  }
}

export function loadApiSecretsJson(): string | null {
  tryInitTavernBridge();
  if (tavernNamespace && Object.prototype.hasOwnProperty.call(tavernNamespace, STORAGE_KEY)) {
    const v = tavernNamespace[STORAGE_KEY];
    if (typeof v === 'string' && v.trim()) return v;
  }
  if (idbCache !== undefined && idbCache) return idbCache;
  return null;
}

export function saveApiSecretsJson(json: string): void {
  tryInitTavernBridge();
  if (tavernNamespace) {
    tavernNamespace[STORAGE_KEY] = json;
    try {
      tavernSaveFn?.();
    } catch {
      /* ignore */
    }
  }
  void writeIdbCache(json);
}
