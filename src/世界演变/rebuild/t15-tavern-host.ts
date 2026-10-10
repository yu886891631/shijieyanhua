/** Lazy native TavernHelper wiring. No import/startup request and no ordinary save masquerading as CAS. */
import { normalizeT4Scope, type T4Scope } from './t4-protocol';
import type { T10Driver, T10Event } from './t10-host-gateway';
import { T10Error, sameT10 } from './t10-host-protocol';
import { createT12ReadOnlyDriver, normalizeT12Book } from './t12-gateway';
import { T12Error, normalizeT12Binding, sameT12 } from './t12-projection';
import { createT15ChatReader, normalizeT15ChatTarget, type T15ChatTarget } from './t15-host-read';
import { createT15ApiTransport } from './t15-api-transport';
import { copyT15NativeJson } from './t15-native-json';

export interface T15NativeContext {
  groupId?: string | number | null;
  characterId?: string | number;
  characters: { avatar?: string; chat?: string }[];
  chat: unknown[];
  getCurrentChatId(): string | undefined;
  getRequestHeaders(): HeadersInit;
}
export interface T15TavernPort {
  origin: string;
  version: string;
  context(): T15NativeContext;
  fetchImpl(input: string, init: RequestInit): Promise<Response>;
  on(event: string, listener: (...args: unknown[]) => void): { stop(): void };
  events: Record<string, string>;
  onPageHide(listener: () => void): () => void;
  getPrimary(): { primary: string | null; additional: string[] };
  getWorldbook(name: string): Promise<unknown[]>;
}
const invalidations: [string, T10Event][] = [
  ['CHAT_CHANGED', 'chat-changed'],
  ['MESSAGE_DELETED', 'deleted'],
  ['MESSAGE_EDITED', 'edited'],
  ['MESSAGE_UPDATED', 'updated'],
  ['MESSAGE_SWIPED', 'swiped'],
  ['MESSAGE_SWIPE_DELETED', 'swipe-deleted'],
  ['MESSAGE_SENT', 'updated'],
  ['MESSAGE_RECEIVED', 'updated'],
  ['GENERATION_STARTED', 'regenerated'],
  ['GENERATION_STOPPED', 'cancelled'],
  ['CHARACTER_EDITED', 'chat-changed'],
  ['CHARACTER_DELETED', 'chat-changed'],
];
/** This creates only read/event ports. No paid request or worldbook/chat write is exposed. */
export function createT15TavernHost(port: T15TavernPort) {
  let closed = false,
    epoch = 0;
  const abort = new AbortController(),
    stops: (() => void)[] = [];
  const listeners = new Set<(event: T10Event) => void>(),
    bookListeners = new Set<(event: 'binding' | 'book') => void>();
  function current(): T15ChatTarget {
    if (closed) throw new T10Error('ABORTED');
    const c = port.context(),
      index = Number(c.characterId);
    if (
      (c.groupId !== undefined && c.groupId !== null && c.groupId !== '') ||
      c.characterId === undefined ||
      c.characterId === '' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      !c.chat.length
    )
      throw new T10Error('IDENTITY');
    const card = c.characters[index],
      fileName = c.getCurrentChatId();
    if (!card?.avatar || !fileName || card.chat !== fileName) throw new T10Error('IDENTITY');
    return normalizeT15ChatTarget({
      avatar: card.avatar,
      fileName,
      binding: { hostChatId: fileName, characterId: card.avatar },
    });
  }
  function publish(event: T10Event, book: 'binding' | 'book') {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* Consumers are not authority. */
      }
    }
    for (const listener of [...bookListeners]) {
      try {
        listener(book);
      } catch {
        /* Ditto. */
      }
    }
  }
  function revoke(event: T10Event, book: 'binding' | 'book' = 'binding') {
    if (closed) return;
    epoch += 1; // Detect A -> B -> A, not just a final name comparison.
    publish(event, book);
  }
  function close() {
    if (closed) return;
    closed = true;
    epoch += 1;
    abort.abort();
    publish('cancelled', 'binding');
    for (const stop of stops.splice(0)) {
      try {
        stop();
      } catch {
        /* Continue teardown. */
      }
    }
    listeners.clear();
    bookListeners.clear();
  }
  const reader = createT15ChatReader({
    ...port,
    current,
    epoch: () => epoch,
    headers: () => port.context().getRequestHeaders(),
  });
  const driver = Object.freeze<T10Driver>({
    capabilities: Object.freeze({
      environment: 'unverified-host' as const,
      version: port.version,
      evidence: '真实 /api/chats/get 独立读取适配；公开保存接口没有全聊天文档 CAS，拒绝写入。',
      durableRead: true,
      atomicDocumentCas: false,
      writeScope: 'none' as const,
    }),
    currentBinding: () => current().binding,
    readDurable: async binding => (await reader.read(binding, abort.signal)).document,
    compareDocument: async () => {
      throw new T10Error('CAPABILITY');
    },
    subscribe(listener) {
      if (closed) throw new T10Error('ABORTED');
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  try {
    for (const [name, event] of invalidations) {
      const id = port.events[name];
      if (typeof id !== 'string' || !id) throw new T10Error('CAPABILITY');
      const handle = port.on(id, () => revoke(event));
      stops.push(() => handle.stop());
    }
    for (const name of ['WORLDINFO_UPDATED', 'WORLDINFO_SETTINGS_UPDATED']) {
      const id = port.events[name];
      if (typeof id !== 'string' || !id) throw new T10Error('CAPABILITY');
      const handle = port.on(id, () => revoke('updated', 'book'));
      stops.push(() => handle.stop());
    }
    stops.push(port.onPageHide(close));
  } catch {
    close();
    throw new T10Error('CAPABILITY');
  }
  return {
    driver,
    currentTarget: current,
    eventEpoch: () => epoch,
    readSnapshot: async (binding = driver.currentBinding(), signal?: AbortSignal) =>
      reader.read(binding, signal ? AbortSignal.any([abort.signal, signal]) : abort.signal),
    worldbook(input: T4Scope) {
      const scope = normalizeT4Scope(input);
      if (scope.mode !== 't10-host') throw new T12Error('TARGET');
      const binding = driver.currentBinding();
      function cleanBinding() {
        const now = driver.currentBinding();
        if (!sameT10(now, binding)) throw new T12Error('TARGET');
        return normalizeT12Binding({
          chatId: scope.chatId,
          worldId: scope.worldId,
          branchId: scope.branchId,
          characterId: now.characterId,
          primaryBook: port.getPrimary().primary,
        });
      }
      // No helper rebind/create or additional/global fallback.
      return createT12ReadOnlyDriver({
        current: async () => cleanBinding(),
        async read(name) {
          const before = cleanBinding(),
            stamp = epoch;
          if (!before.primaryBook || name !== before.primaryBook) throw new T12Error('TARGET');
          try {
            const entries = await port.getWorldbook(name);
            if (epoch !== stamp || !sameT12(before, cleanBinding())) throw new T12Error('TARGET');
            return normalizeT12Book({ entries: copyT15NativeJson(entries), active: null, blocked: true });
          } catch (error) {
            if (error instanceof T12Error) throw error;
            throw new T12Error('READ');
          }
        },
        subscribe(listener) {
          if (closed) throw new T12Error('CLOSED');
          bookListeners.add(listener);
          return () => {
            bookListeners.delete(listener);
          };
        },
      });
    },
    close,
  };
}
/** Invoke in a TavernHelper script after host readiness. No UI changes or automatic run. */
export function createT15NativeTavernHost(version: string) {
  return createT15TavernHost({
    origin: new URL(window.parent.location.href).origin,
    version,
    context: () => SillyTavern,
    fetchImpl: (input, init) => window.parent.fetch(input, init),
    on: (event, listener) => eventOn(event, listener),
    events: tavern_events,
    onPageHide(listener) {
      window.addEventListener('pagehide', listener);
      return () => window.removeEventListener('pagehide', listener);
    },
    getPrimary: () => getCharWorldbookNames('current'),
    getWorldbook,
  });
}
/** Only for an explicitly selected session with a synchronous ownership/consent check.
 * The read-only host above cannot authorize real evolution by itself. */
export function createT15NativeApiTransport(authorize: () => void) {
  return createT15ApiTransport({ fetchImpl: (input, init) => window.fetch(input, init), authorize });
}
