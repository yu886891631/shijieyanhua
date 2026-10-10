/** Opt-in single-page projection. Ordinary host saving is NOT a prompt capture lock or server CAS. */
import { cloneT2Json, type T2Json } from './t2-template';
import { fingerprintT4, type T4Scope } from './t4-protocol';
import {
  activationT12,
  diffT12Book,
  materializeT12,
  normalizeT12Book,
  ownerT12,
  assertT12NoAmbiguousActive,
  confirmedT12Book,
  type T12Book,
  type T12Driver,
} from './t12-gateway';
import {
  copyT12,
  sameT12,
  T12Error,
  T12_NS,
  normalizeT12Binding,
  validateT12Generation,
  type T12Binding,
} from './t12-projection';
import type { createT15CompatibilityHost } from './t15-chat-compatibility';

type RawBook = Record<string, T2Json> & { entries: Record<string, Record<string, T2Json>> };
export interface T15WorldbookPort {
  current(): T12Binding;
  /** Independent persisted read, not loadWorldInfo's in-memory cache. */
  readRaw(name: string, signal?: AbortSignal): Promise<unknown>;
  saveRaw(name: string, raw: RawBook): Promise<void>;
  writable(): boolean;
  epoch(): number;
  subscribe(listener: (event: 'binding' | 'book') => void): () => void;
  /** Testable trusted boundary; not a JSON/user override. */
  writeTimeoutMs?: number;
}
function rawBook(value: unknown): RawBook {
  const raw = cloneT2Json(value);
  if (
    !raw ||
    Array.isArray(raw) ||
    typeof raw !== 'object' ||
    !raw.entries ||
    typeof raw.entries !== 'object' ||
    Array.isArray(raw.entries) ||
    Object.keys(raw.entries).length > 5000
  )
    throw new T12Error('INTEGRITY');
  for (const [key, e] of Object.entries(raw.entries)) {
    if (
      !e ||
      Array.isArray(e) ||
      typeof e !== 'object' ||
      !Number.isSafeInteger(e.uid) ||
      Number(e.uid) < 0 ||
      String(e.uid) !== key
    )
      throw new T12Error('INTEGRITY');
  }
  return raw as RawBook;
}
/** Unmanaged entries retain ALL their raw fields. Only own entries need the helper payload mapping. */
export function decodeT15Worldbook(value: unknown): T12Book {
  const raw = rawBook(value);
  const entries = Object.values(raw.entries).map(e => ({
    uid: e.uid,
    name: e.comment ?? '',
    content: e.content ?? '',
    enabled: e.disable !== true,
    extra: e.extra ?? {},
    strategy: {
      type: e.constant ? 'constant' : e.vectorized ? 'vectorized' : 'selective',
      keys: e.key ?? [],
      keys_secondary: {
        logic: ['and_any', 'not_all', 'not_any', 'and_all'][Number(e.selectiveLogic) || 0],
        keys: e.keysecondary ?? [],
      },
      scan_depth: e.scanDepth ?? 'same_as_global',
    },
    position: {
      type: e.position === 4 ? 'at_depth' : 'other',
      role: ['system', 'user', 'assistant'][Number(e.role) || 0],
      depth: e.depth ?? 0,
      order: e.order ?? 100,
    },
    probability: e.useProbability ? e.probability : 100,
    recursion: {
      prevent_incoming: e.excludeRecursion ?? false,
      prevent_outgoing: e.preventRecursion ?? false,
      delay_until:
        typeof e.delayUntilRecursion === 'number' && e.delayUntilRecursion > 0 ? e.delayUntilRecursion : null,
    },
    effect: { sticky: e.sticky || null, cooldown: e.cooldown || null, delay: e.delay || null },
  }));
  return normalizeT12Book({ entries, active: raw[T12_NS] ?? null, blocked: !raw[T12_NS] });
}
export function encodeT15Worldbook(
  value: unknown,
  generation: Parameters<typeof activationT12>[0],
  book: T12Book,
): RawBook {
  const raw = rawBook(value),
    next = copyT12(raw),
    previous = decodeT15Worldbook(raw);
  const desired = new Map(generation.entries.map(e => [e.key, e]));
  for (const e of previous.entries) {
    const o = ownerT12(e);
    if (!o) continue;
    const current = sameT12(o.scope, generation.scope) && o.characterId === generation.binding.characterId;
    if (current && !book.entries.some(v => v.uid === e.uid)) delete next.entries[String(e.uid)];
    else if (!current && next.entries[String(e.uid)]) next.entries[String(e.uid)].disable = true;
  }
  for (const e of book.entries) {
    const o = ownerT12(e);
    if (!o || !sameT12(o.scope, generation.scope) || o.characterId !== generation.binding.characterId) continue;
    const p = desired.get(o.key)?.payload;
    if (!p) throw new T12Error('INTEGRITY');
    const old = next.entries[String(e.uid)] ?? {};
    next.entries[String(e.uid)] = {
      ...old,
      uid: e.uid,
      displayIndex: old.displayIndex ?? e.uid,
      comment: p.name,
      content: p.content,
      disable: false,
      constant: p.strategy.type === 'constant',
      selective: p.strategy.type === 'selective',
      vectorized: false,
      key: p.strategy.keys,
      keysecondary: [],
      selectiveLogic: 0,
      scanDepth: null,
      position: 4,
      role: 0,
      depth: 2,
      order: 9800,
      useProbability: true,
      probability: 100,
      excludeRecursion: true,
      preventRecursion: true,
      delayUntilRecursion: false,
      sticky: null,
      cooldown: null,
      delay: null,
      extra: e.extra,
      // New entries must not inherit an editor's character/global filters.
      ...(Object.keys(old).length
        ? {}
        : {
            addMemo: true,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            automationId: '',
            ignoreBudget: false,
            outletName: '',
            triggers: [],
            characterFilter: { isExclude: false, names: [], tags: [] },
          }),
    };
  }
  next[T12_NS] = cloneT2Json(activationT12(generation));
  return rawBook(next);
}
export function createT15WorldbookCompatibility(input: T15WorldbookPort) {
  const port = Object.freeze({ ...input }),
    binding = normalizeT12Binding(port.current()),
    epoch = port.epoch();
  const writeTimeout = port.writeTimeoutMs ?? 15000;
  if (!Number.isSafeInteger(writeTimeout) || writeTimeout < 1 || writeTimeout > 15000) throw new T12Error('PERMISSION');
  let closed = false,
    uncertain = false,
    busy = false;
  const snapshots = new Map<string, RawBook>();
  const check = () => {
    if (closed || epoch !== port.epoch() || !sameT12(binding, port.current())) throw new T12Error('STALE');
  };
  const driver: T12Driver = {
    capabilities: Object.freeze({
      environment: 'compatibility-host',
      consistency: 'optimistic-single-page',
      evidence: ['仅当前角色卡主书；自有稳定键/原始书指纹复核、普通保存与独立读回；无捕获锁或服务端 CAS。'],
      durableRead: true,
      guardedWrites: false,
      guardedCapture: false,
      sourceFence: false,
      scope: 'single-server-book',
    }),
    writableNow: () => !closed && !uncertain && !busy && port.writable() && epoch === port.epoch(),
    current: async () => {
      check();
      return copyT12(binding);
    },
    subscribe: port.subscribe,
    async read(name) {
      check();
      if (!binding.primaryBook || name !== binding.primaryBook) throw new T12Error('TARGET');
      const raw = rawBook(await port.readRaw(name));
      check();
      snapshots.set(name, copyT12(raw));
      return decodeT15Worldbook(raw);
    },
    async synchronize(request) {
      if (!driver.writableNow!()) throw new T12Error('PERMISSION');
      const proposal = copyT12(request.generation),
        signal = request.signal,
        authorize = request.authorize,
        assertCurrent = request.assertCurrent,
        expectedFingerprint = request.expectedBookFingerprint;
      busy = true;
      let dispatched = false;
      try {
        const g = await validateT12Generation(proposal),
          name = binding.primaryBook;
        if (!name || !sameT12(binding, g.binding)) throw new T12Error('TARGET');
        const expected = snapshots.get(name);
        if (!expected) throw new T12Error('CONFIRM');
        check();
        if (signal?.aborted) throw new T12Error('STALE');
        await authorize();
        check();
        assertCurrent();
        const fresh = rawBook(await port.readRaw(name, signal));
        check();
        if (!sameT12(fresh, expected) || (await fingerprintT4(decodeT15Worldbook(fresh))) !== expectedFingerprint)
          throw new T12Error('CONFLICT');
        const book = decodeT15Worldbook(fresh);
        assertT12NoAmbiguousActive(book);
        const diff = await diffT12Book(g, book),
          desired = new Map(g.entries.map(p => [p.key, p]));
        let uid = book.entries.reduce((max, e) => Math.max(max, e.uid), -1) + 1;
        for (const d of diff) {
          if (d.kind === 'delete') book.entries = book.entries.filter(e => e.uid !== d.uid);
          else if (d.kind === 'deactivate') book.entries.find(e => e.uid === d.uid)!.enabled = false;
          else if (d.kind === 'create') {
            if (!Number.isSafeInteger(uid)) throw new T12Error('SIZE');
            book.entries.push(materializeT12(g, desired.get(d.key!)!, uid++));
          } else if (d.kind === 'update') {
            const i = book.entries.findIndex(e => e.uid === d.uid);
            book.entries[i] = materializeT12(g, desired.get(d.key!)!, book.entries[i].uid, book.entries[i]);
          }
        }
        const next = encodeT15Worldbook(fresh, g, book);
        // Recheck source after the asynchronous diff/hash work, then full book again before dispatch.
        await authorize();
        check();
        assertCurrent();
        if (!sameT12(await port.readRaw(name, signal), fresh)) throw new T12Error('CONFLICT');
        check();
        assertCurrent();
        if (signal?.aborted || !port.writable()) throw new T12Error('PERMISSION');
        dispatched = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            port.saveRaw(name, copyT12(next)),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new T12Error('PENDING')), writeTimeout);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        const actual = rawBook(await port.readRaw(name, signal));
        check();
        assertCurrent();
        await authorize();
        if (signal?.aborted || !sameT12(next, actual) || !(await confirmedT12Book(g, decodeT15Worldbook(actual))))
          throw new T12Error('PENDING');
        snapshots.set(name, copyT12(actual));
      } catch (error) {
        if (dispatched) {
          uncertain = true;
          throw new T12Error('PENDING');
        }
        throw error instanceof T12Error ? error : new T12Error('READ');
      } finally {
        busy = false;
      }
    },
    capture: async () => {
      throw new T12Error('ISOLATION');
    },
  };
  return {
    driver,
    close() {
      closed = true;
      snapshots.clear();
    },
    status: () => ({ busy, uncertain, closed }),
  };
}
/** Lazy native factory: no read/write until explicitly used by a real workspace. */
export function createT15NativeWorldbookCompatibility(
  host: ReturnType<typeof createT15CompatibilityHost>,
  scope: T4Scope,
) {
  const captured = host.driver.currentBinding();
  let epoch = 0;
  const listeners = new Set<(event: 'binding' | 'book') => void>();
  const off = host.driver.subscribe!(() => {
    epoch++;
    for (const fn of listeners) fn('binding');
  });
  const native = SillyTavern as typeof SillyTavern & {
    getWorldInfoNames(): string[];
    saveWorldInfo(name: string, data: unknown, immediately: boolean): Promise<void>;
  };
  let book: ReturnType<typeof createT15WorldbookCompatibility>;
  try {
    book = createT15WorldbookCompatibility({
      current() {
        if (!sameT12(captured, host.driver.currentBinding())) throw new T12Error('TARGET');
        return {
          chatId: scope.chatId,
          worldId: scope.worldId,
          branchId: scope.branchId,
          characterId: captured.characterId,
          primaryBook: getCharWorldbookNames('current').primary,
        };
      },
      epoch: () => epoch,
      writable: () => host.status().state === 'ready' && host.status().ownsPage,
      subscribe(fn) {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      async readRaw(name, signal) {
        if (
          !name.trim() ||
          /[\\/]/.test(name) ||
          Array.from(name).some(char => char.charCodeAt(0) < 32) ||
          name === '.' ||
          name === '..' ||
          !native.getWorldInfoNames?.().includes(name)
        )
          throw new T12Error('TARGET');
        const url = new URL('/api/worldinfo/get', window.parent.location.href).href;
        const headers = new Headers(native.getRequestHeaders());
        headers.set('Content-Type', 'application/json');
        if (headers.has('Authorization')) throw new T12Error('PERMISSION');
        const response = await window.parent.fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal,
          headers,
          body: JSON.stringify({ name }),
        });
        if (!response.ok || !response.body) throw new T12Error('READ');
        const reader = response.body.getReader(),
          parts: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (signal?.aborted) throw new T12Error('STALE');
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 8_000_000) throw new T12Error('SIZE');
            parts.push(next.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        const content = new Uint8Array(bytes);
        let offset = 0;
        for (const part of parts) {
          content.set(part, offset);
          offset += part.byteLength;
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
      },
      saveRaw: (name, raw) =>
        host.saveOwnedWorldbook(name, raw, async () => {
          if (typeof native.saveWorldInfo !== 'function') throw new T12Error('PERMISSION');
          await native.saveWorldInfo(name, raw, true); // Host cache + immediate ordinary save; not a durable receipt.
          native.reloadWorldInfoEditor?.(name);
        }),
    });
  } catch (error) {
    off();
    listeners.clear();
    throw error;
  }
  return {
    ...book,
    close() {
      book.close();
      off();
      listeners.clear();
    },
  };
}
