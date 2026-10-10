/** Independent server read only. Never saves a chat or treats a local snapshot as durable. */
import { cloneT2Json, type T2Json } from './t2-template';
import { fingerprintT4 } from './t4-protocol';
import { T10Error, normalizeT10Document, sameT10, type T10Binding, type T10Document } from './t10-host-protocol';

export interface T15ChatTarget {
  binding: T10Binding;
  avatar: string;
  fileName: string;
}
export interface T15ChatSnapshot {
  source: 'server-jsonl';
  raw: Record<string, T2Json>[];
  rawFingerprint: string;
  document: T10Document;
}
function object(value: unknown): Record<string, T2Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new T10Error('READ');
  return value as Record<string, T2Json>;
}
export function normalizeT15ChatTarget(input: T15ChatTarget): T15ChatTarget {
  const target = cloneT2Json(input) as unknown as T15ChatTarget;
  for (const name of [target.avatar, target.fileName])
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 256 ||
      /[\\/]/.test(name) ||
      [...name].some(c => c.charCodeAt(0) < 32) ||
      name === '.' ||
      name === '..'
    )
      throw new T10Error('IDENTITY');
  if (target.binding.characterId !== target.avatar || target.binding.hostChatId !== target.fileName)
    throw new T10Error('IDENTITY');
  normalizeT10Document({ binding: target.binding, variables: {}, messages: [] });
  return target;
}
/** Keep the complete raw JSONL alongside the normalized view. A future CAS must compare raw,
 * not just our variables: metadata, message extras and other plugins' fields are significant. */
export async function decodeT15Chat(binding: T10Binding, input: unknown): Promise<T15ChatSnapshot> {
  try {
    const raw = cloneT2Json(input);
    if (!Array.isArray(raw) || !raw.length || raw.length > 2001) throw new T10Error('READ');
    const records = raw.map(object),
      metadata = object(records[0].chat_metadata);
    const variables = metadata.variables === undefined ? {} : object(metadata.variables);
    const messages = records.slice(1).map((m, index) => {
      if (
        typeof m.name !== 'string' ||
        typeof m.mes !== 'string' ||
        (m.is_user !== undefined && typeof m.is_user !== 'boolean') ||
        (m.is_system !== undefined && typeof m.is_system !== 'boolean')
      )
        throw new T10Error('READ');
      const extra = m.extra === undefined ? {} : object(m.extra);
      // is_system is the hidden flag, NOT the role. Matches TavernHelper's narrator mapping.
      if (extra.type === 'narrator' && m.is_user) throw new T10Error('READ');
      const role = extra.type === 'narrator' ? 'system' : m.is_user ? 'user' : 'assistant';
      const swipes = m.swipes === undefined ? [m.mes] : m.swipes;
      if (!Array.isArray(swipes) || !swipes.length || swipes.length > 256 || swipes.some(s => typeof s !== 'string'))
        throw new T10Error('READ');
      const data = m.variables === undefined ? [{}] : m.variables;
      const info = m.swipe_info === undefined ? [extra] : m.swipe_info;
      if (!Array.isArray(data) || !Array.isArray(info) || data.length > swipes.length || info.length > swipes.length)
        throw new T10Error('READ');
      return {
        ...m,
        message_id: index,
        role,
        is_hidden: m.is_system ?? false,
        swipe_id: m.swipe_id ?? 0,
        swipes,
        swipes_data: swipes.map((_, i) => (data[i] === undefined ? {} : object(data[i]))),
        swipes_info: swipes.map((_, i) => (info[i] === undefined ? {} : object(info[i]))),
      };
    });
    return {
      source: 'server-jsonl',
      raw: records,
      rawFingerprint: await fingerprintT4(records),
      document: normalizeT10Document({ binding, variables, messages }),
    };
  } catch {
    throw new T10Error('READ');
  }
}
/** The caller resolves an already loaded, existing single-character chat. Group/temporary
 * chats are unsupported. Binding + event epoch must stay unchanged throughout the read. */
export function createT15ChatReader(port: {
  origin: string;
  current(): T15ChatTarget;
  epoch(): number;
  headers(): HeadersInit;
  fetchImpl(input: string, init: RequestInit): Promise<Response>;
}) {
  const origin = new URL(port.origin);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new T10Error('IDENTITY');
  return {
    async read(expected: T10Binding, signal?: AbortSignal): Promise<T15ChatSnapshot> {
      const target = normalizeT15ChatTarget(port.current()),
        epoch = port.epoch();
      const check = () => {
        if (signal?.aborted) throw new T10Error('ABORTED');
        if (
          port.epoch() !== epoch ||
          !sameT10(normalizeT15ChatTarget(port.current()), target) ||
          !sameT10(expected, target.binding)
        )
          throw new T10Error('IDENTITY');
      };
      check();
      try {
        const headers = new Headers(port.headers());
        headers.set('Content-Type', 'application/json');
        // Host authentication only; never carry an evolution API credential to the chat endpoint.
        if (headers.has('Authorization')) throw new T10Error('READ');
        async function request(path: string, body: Record<string, T2Json>) {
          check();
          const response = await port.fetchImpl(new URL(path, origin).href, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            signal,
          });
          check();
          if (!response.ok || !response.body) throw new T10Error('READ');
          const reader = response.body.getReader(),
            parts: Uint8Array[] = [];
          let bytes = 0;
          try {
            for (;;) {
              const next = await reader.read();
              check();
              if (next.done) break;
              bytes += next.value.byteLength;
              if (bytes > 8_000_000) throw new T10Error('LIMIT');
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
          check();
          return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as unknown;
        }
        // /get can mkdir a missing character chat directory. Check the non-creating file
        // listing first and never probe arbitrary/unpersisted chat names with /get.
        const listing = await request('/api/characters/chats', { avatar_url: target.avatar, simple: true });
        const files = Array.isArray(listing) ? listing : Object.values(object(listing));
        if (files.length > 10000 || !files.some(file => object(file).file_name === `${target.fileName}.jsonl`))
          throw new T10Error('READ');
        const result = await decodeT15Chat(
          target.binding,
          await request('/api/chats/get', { avatar_url: target.avatar, file_name: target.fileName }),
        );
        check();
        return result;
      } catch (error) {
        check();
        if (error instanceof T10Error) throw error;
        throw new T10Error('READ'); // Drop raw network/provider messages and headers.
      }
    },
  };
}
