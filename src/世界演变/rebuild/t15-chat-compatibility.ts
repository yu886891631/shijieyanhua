/** Explicit single-page front-end save adapter. NOT a server CAS; no startup reads/writes. */
import { cloneT2Json, type T2Json } from './t2-template';
import { fingerprintT4 } from './t4-protocol';
import { T4StoreError } from './t4-store';
import type { T10Driver } from './t10-host-gateway';
import {
  T10Error,
  T10_NAMESPACE as NS,
  copyT10,
  normalizeT10Document,
  sameT10,
  validateT10Envelope,
  type T10Document,
} from './t10-host-protocol';
import { decodeT15Chat, type T15ChatSnapshot } from './t15-host-read';
import { createT15TavernHost, type T15TavernPort } from './t15-tavern-host';
import { copyT15NativeJson } from './t15-native-json';

function jsonObject(value: unknown): Record<string, T2Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new T10Error('CONFLICT');
  return value as Record<string, T2Json>;
}
function withoutOwned(doc: T10Document) {
  const result = copyT10(doc);
  delete result.variables[NS];
  for (const message of result.messages) for (const data of message.swipes_data) delete data[NS];
  return result;
}
/** Only header.variables[NS] and message.variables[*][NS] may change. Raw aliases in the
 * normalized proposal are intentionally NOT writable. Unknown fields remain byte-logically intact. */
export async function encodeT15OwnedChat(snapshot: T15ChatSnapshot, input: T10Document) {
  const next = normalizeT10Document(input),
    base = await decodeT15Chat(next.binding, snapshot.raw);
  if (
    base.rawFingerprint !== snapshot.rawFingerprint ||
    !sameT10(base.document, snapshot.document) ||
    !sameT10(withoutOwned(base.document), withoutOwned(next))
  )
    throw new T10Error('CONFLICT');
  await validateT10Envelope(next.variables[NS], next);
  const raw = copyT10(base.raw),
    metadata = jsonObject(raw[0].chat_metadata),
    variables = metadata.variables === undefined ? {} : jsonObject(metadata.variables);
  variables[NS] = cloneT2Json(next.variables[NS]);
  metadata.variables = variables;
  for (const [i, message] of next.messages.entries()) {
    const old = base.document.messages[i];
    if (sameT10(old.swipes_data, message.swipes_data)) continue;
    const record = raw[i + 1],
      data = record.variables === undefined ? [] : (record.variables as Record<string, T2Json>[]);
    for (const [s, values] of message.swipes_data.entries()) {
      if (sameT10(old.swipes_data[s], values)) continue;
      while (data.length <= s) data.push({});
      if (Object.hasOwn(values, NS)) data[s][NS] = cloneT2Json(values[NS]);
      else delete data[s][NS];
    }
    record.variables = data;
  }
  const result = await decodeT15Chat(next.binding, raw);
  await validateT10Envelope(result.document.variables[NS], result.document);
  return result;
}

export interface T15CompatibilityPort extends T15TavernPort {
  /** Shared parent-window object across script iframes; injected object in tests. Not a cross-tab lock. */
  leaseTarget: object;
  metadata(): Record<string, unknown>;
  characterName(): string;
}
const leaseKey = Symbol.for('world-evolution.t15.single-page-writer');
function acquire(target: object) {
  const shared = target as { [leaseKey]?: object },
    owner = Object.freeze({});
  if (shared[leaseKey]) throw new T10Error('CONFLICT');
  try {
    Object.defineProperty(shared, leaseKey, { value: owner, configurable: true });
  } catch {
    throw new T10Error('CAPABILITY');
  }
  return {
    owns: () => shared[leaseKey] === owner,
    release() {
      if (shared[leaseKey] === owner) delete shared[leaseKey];
    },
  };
}
/** Validate every slot before touching memory. Accessors/frozen objects are unsupported. */
function assignment(object: Record<string, unknown>, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor ? !('value' in descriptor) || !descriptor.writable : !Object.isExtensible(object))
    throw new T10Error('CAPABILITY');
  return {
    apply: () => {
      object[key] = value;
    },
    undo: () => {
      if (descriptor) object[key] = descriptor.value;
      else delete object[key];
    },
  };
}

export function createT15CompatibilityHost(input: T15CompatibilityPort) {
  const port = Object.freeze({ ...input }); // Capture endpoints/functions; never retarget an in-flight writer.
  if (!port.version.trim() || port.version.length > 128) throw new T10Error('CAPABILITY');
  const lease = acquire(port.leaseTarget);
  let state: 'ready' | 'invalidated' | 'uncertain' | 'closed' = 'ready',
    busy = false,
    baseline: T15ChatSnapshot | null = null,
    activeAbort: AbortController | null = null;
  let ownedBookWrite: { name: string; raw: unknown } | null = null;
  let host: ReturnType<typeof createT15TavernHost>;
  try {
    host = createT15TavernHost({
      ...port,
      on(event, listener) {
        return port.on(event, (...args) => {
          // Do not revoke our own source session for the exact saveWorldInfo notification.
          // Busy alone, the book name alone, or a metadata flag never exempts an external edit.
          if (
            event === port.events.WORLDINFO_UPDATED &&
            ownedBookWrite &&
            args[0] === ownedBookWrite.name &&
            args.length >= 2
          ) {
            try {
              if (sameT10(copyT15NativeJson(args[1]), ownedBookWrite.raw)) return;
            } catch {
              /* Malformed edits still revoke. */
            }
          }
          listener(...args);
        });
      },
      onPageHide(listener) {
        return port.onPageHide(() => {
          state = 'closed';
          activeAbort?.abort();
          if (!busy && !ownedBookWrite) lease.release();
          listener();
        });
      },
    });
  } catch (error) {
    lease.release();
    throw error;
  }
  const stop = host.driver.subscribe!(() => {
    if (state !== 'closed' && state !== 'uncertain') state = 'invalidated';
    activeAbort?.abort();
  });
  const writable = () => state === 'ready' && lease.owns();
  function liveMatches(snapshot: T15ChatSnapshot) {
    if (
      !sameT10(copyT15NativeJson(port.metadata()), snapshot.raw[0].chat_metadata) ||
      !sameT10(copyT15NativeJson(port.context().chat), snapshot.raw.slice(1))
    )
      throw new T10Error('CONFLICT'); // Unsaved data from MVU/DB/host must not be replaced.
  }
  const driver = Object.freeze<T10Driver>({
    capabilities: Object.freeze({
      environment: 'compatibility-host' as const,
      version: port.version,
      evidence: '整份 JSONL 写前独立复核、仅合并自有字段、force=false、写后独立确认；无服务端 CAS。',
      durableRead: true,
      atomicDocumentCas: false,
      consistency: 'optimistic-single-page' as const,
      writeScope: 'single-server-chat' as const,
    }),
    currentBinding: host.driver.currentBinding,
    writableNow: () => writable() && !ownedBookWrite,
    subscribe: host.driver.subscribe,
    async readDurable(binding) {
      if (busy || ownedBookWrite) throw new T10Error('CONFLICT');
      try {
        const snapshot = await host.readSnapshot(binding);
        baseline = copyT10(snapshot);
        return copyT10(snapshot.document);
      } catch (error) {
        if (state === 'ready') state = 'invalidated';
        baseline = null;
        throw error;
      }
    },
    async compareDocument(input) {
      if (busy || ownedBookWrite) throw new T10Error('CONFLICT');
      if (!writable()) throw new T10Error('CAPABILITY');
      // Capture inputs/callback identities before any await; JSON flags grant no authority.
      const binding = copyT10(input.binding),
        document = normalizeT10Document(input.document),
        expected = input.expectedFingerprint,
        authorize = input.authorize,
        signal = input.signal,
        previous = baseline && copyT10(baseline),
        epoch = host.eventEpoch(),
        target = host.currentTarget(),
        controller = new AbortController();
      busy = true;
      activeAbort = controller;
      let dispatched = false;
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, 15000);
      function check() {
        if (signal?.aborted || controller.signal.aborted) throw new T10Error('ABORTED');
        if (!writable() || host.eventEpoch() !== epoch || !sameT10(host.currentTarget(), target))
          throw new T10Error('IDENTITY');
        if (!sameT10(binding, target.binding) || !sameT10(document.binding, binding)) throw new T10Error('IDENTITY');
      }
      try {
        check();
        if (!previous || (await fingerprintT4(previous.document)) !== expected) throw new T10Error('CONFLICT');
        const fresh = await host.readSnapshot(binding, controller.signal);
        check();
        if (fresh.rawFingerprint !== previous.rawFingerprint) throw new T10Error('CONFLICT');
        liveMatches(fresh);
        const proposal = await encodeT15OwnedChat(fresh, document),
          name = port.characterName(),
          headers = new Headers(port.context().getRequestHeaders());
        if (typeof name !== 'string' || !name.trim() || name.length > 512 || headers.has('Authorization'))
          throw new T10Error('CAPABILITY');
        headers.set('Content-Type', 'application/json');
        const body = JSON.stringify({
          ch_name: name,
          file_name: target.fileName,
          avatar_url: target.avatar,
          chat: proposal.raw,
          force: false,
        });
        if (new TextEncoder().encode(body).length > 8_000_000) throw new T10Error('LIMIT');
        // Keep the live host's own namespace in step with JSONL; a subsequent ordinary
        // SillyTavern save must not restore our stale data. Never replace messages/metadata.
        const changes = [
          assignment(port.metadata(), 'variables', copyT10(jsonObject(proposal.raw[0].chat_metadata).variables)),
        ];
        for (const [i, record] of proposal.raw.slice(1).entries())
          if (!sameT10(record.variables ?? null, fresh.raw[i + 1].variables ?? null))
            changes.push(
              assignment(port.context().chat[i] as Record<string, unknown>, 'variables', copyT10(record.variables)),
            );
        check();
        liveMatches(fresh);
        // Reject thenables and errors before dispatch; no async authorization window.
        const authorization = authorize() as unknown;
        if (authorization !== undefined) {
          if (authorization && typeof (authorization as Promise<unknown>).then === 'function')
            void Promise.resolve(authorization).catch(() => {});
          throw new T10Error('ABORTED');
        }
        check();
        liveMatches(fresh); // The authorization callback may have changed the host.
        try {
          for (const change of changes) change.apply();
        } catch {
          for (const change of [...changes].reverse()) change.undo();
          throw new T10Error('CAPABILITY');
        }
        dispatched = true; // From here even network/timeout/HTTP failure is conservatively unknown.
        const response = await port.fetchImpl(new URL('/api/chats/save', port.origin).href, {
          method: 'POST',
          headers,
          body,
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        check();
        if (!response.ok) throw new T4StoreError('ACK_LOST');
        const saved = await host.readSnapshot(binding, controller.signal);
        check();
        if (saved.rawFingerprint !== proposal.rawFingerprint) throw new T4StoreError('ACK_LOST');
        liveMatches(proposal);
        baseline = copyT10(saved);
      } catch (error) {
        if (dispatched) {
          if (state !== 'closed') state = 'uncertain';
          baseline = null;
          // Do not roll back live memory: the server may have accepted the write.
          // Read-only reconciliation is allowed; no retry or automatic new model request.
          throw new T4StoreError('ACK_LOST');
        }
        if (state !== 'closed') state = 'invalidated';
        if (error instanceof T10Error || error instanceof T4StoreError) throw error;
        throw new T4StoreError('SAVE_FAILED');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        busy = false;
        activeAbort = null;
        if (state === 'closed') lease.release();
      }
    },
  });
  return {
    driver,
    /** Trusted worldbook adapter only; keeps the shared lease until a potentially pending write settles. */
    async saveOwnedWorldbook(name: string, raw: unknown, save: () => Promise<void>) {
      if (!writable() || busy || ownedBookWrite) throw new T10Error('CAPABILITY');
      ownedBookWrite = { name, raw: copyT10(raw) };
      try {
        await save();
      } finally {
        ownedBookWrite = null;
        if (state === 'closed') lease.release();
      }
    },
    worldbook: host.worldbook, // Still read-only; no accidental expansion of this save permission.
    status: () => ({ state, busy, ownsPage: lease.owns(), consistency: 'optimistic-single-page' as const }),
    close() {
      if (state === 'closed') return;
      state = 'closed';
      activeAbort?.abort();
      stop();
      host.close();
      if (!busy && !ownedBookWrite) lease.release();
    },
  };
}
/** Explicit factory only. Call after readiness/consent, never from the isolated candidate entry. */
export function createT15NativeCompatibilityHost(version: string) {
  return createT15CompatibilityHost({
    origin: new URL(window.parent.location.href).origin,
    version,
    context: () => SillyTavern,
    fetchImpl: (url, init) => window.parent.fetch(url, init),
    on: (event, listener) => eventOn(event, listener),
    events: tavern_events,
    onPageHide(listener) {
      window.addEventListener('pagehide', listener);
      return () => window.removeEventListener('pagehide', listener);
    },
    getPrimary: () => getCharWorldbookNames('current'),
    getWorldbook,
    leaseTarget: window.parent,
    metadata: () => SillyTavern.chatMetadata,
    characterName: () => SillyTavern.characters[Number(SillyTavern.characterId)]?.name ?? '',
  });
}
