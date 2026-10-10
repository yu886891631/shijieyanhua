/** Explicit fake durable worldbook + single-active capture boundary. Never a TavernHelper fallback. */
import { canonicalT4Json, fingerprintT4, type T4Scope, type T4Archive } from './t4-protocol';
import { headT4Token } from './t4-store';
import {
  T12Error,
  copyT12,
  normalizeT12Binding,
  sameT12,
  validateT12Generation,
  type T12Binding,
  type T12Generation,
} from './t12-projection';
import {
  activationT12,
  assertT12NoAmbiguousActive,
  canWriteT12,
  confirmedT12Book,
  diffT12Book,
  materializeT12,
  normalizeT12Book,
  ownerT12,
  type T12Book,
  type T12BookEntry,
  type T12Capabilities,
  type T12Driver,
  type T12Guard,
} from './t12-gateway';
export type T12Fault = 'write-failed' | 'partial' | 'ack-lost';
export function createT12SimulatedBook(
  bindingInput: T12Binding,
  initial: Record<string, T12Book> = {},
  capabilities?: Partial<T12Capabilities>,
) {
  let binding = normalizeT12Binding(bindingInput);
  const books = new Map<string, string>(
    Object.entries(initial).map(([name, book]) => [name, JSON.stringify(normalizeT12Book(book))]),
  );
  if (binding.primaryBook && !books.has(binding.primaryBook))
    books.set(binding.primaryBook, JSON.stringify({ entries: [], active: null, blocked: false }));
  const caps: T12Capabilities = Object.freeze({
    environment: 'simulated',
    evidence: ['T12 fake JSON authority; shared sync/capture lock; source guard revalidated before mutation/capture'],
    durableRead: true,
    guardedWrites: true,
    guardedCapture: true,
    sourceFence: true,
    scope: 'fixture',
    ...copyT12(capabilities ?? {}),
  });
  let tail = Promise.resolve(),
    failedReads = 0;
  const faults: T12Fault[] = [],
    stats = { reads: 0, writes: 0, captures: 0 };
  const listeners = new Set<(event: 'binding' | 'book') => void>();
  // Trusted fixture authority readers, not JSON flags or cached service views. All final checks are synchronous.
  const sources = new Map<string, () => T4Archive>();
  const sourceStamp = (g: T12Generation) => {
    const reader = sources.get(canonicalT4Json(g.scope));
    if (!reader) throw new T12Error('SOURCE');
    const archive = reader();
    if (!sameT12(archive.scope, g.scope) || !sameT12(headT4Token(archive), g.head)) throw new T12Error('STALE');
    return canonicalT4Json(archive);
  };
  const assertSource = (g: T12Generation, expected: string) => {
    if (sourceStamp(g) !== expected) throw new T12Error('STALE');
  };
  const emit = (event: 'binding' | 'book') => {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        /* UI observers are not authority. */
      }
    }
  };
  async function lock<T>(job: () => Promise<T>): Promise<T> {
    const before = tail;
    let release!: () => void;
    tail = new Promise<void>(r => {
      release = r;
    });
    await before;
    try {
      return await job();
    } finally {
      release();
    }
  }
  const read = async (name: string) => {
    stats.reads++;
    if (failedReads > 0) {
      failedReads--;
      throw new T12Error('READ');
    }
    const serialized = books.get(name);
    if (!serialized) throw new T12Error('TARGET');
    return normalizeT12Book(JSON.parse(serialized));
  };
  const guard = async (g: T12Generation, input: T12Guard) => {
    if (!canWriteT12(caps)) throw new T12Error('ISOLATION');
    if (input.signal?.aborted) throw new T12Error('STALE');
    if (!sameT12(binding, g.binding)) throw new T12Error('STALE');
    const before = sourceStamp(g);
    await input.authorize();
    input.assertCurrent();
    assertSource(g, before);
    if (input.signal?.aborted || !sameT12(binding, g.binding)) throw new T12Error('STALE');
    return before;
  };
  const write = (name: string, book: T12Book) => {
    books.set(name, JSON.stringify(book));
    stats.writes++;
    emit('book');
  };
  const assertBook = (name: string, expected: T12Book) => {
    const raw = books.get(name);
    if (!raw || canonicalT4Json(JSON.parse(raw)) !== canonicalT4Json(expected)) throw new T12Error('CONFLICT');
  };
  const driver: T12Driver = {
    capabilities: caps,
    current: async () => copyT12(binding),
    read,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    synchronize: input =>
      lock(async () => {
        const g = await validateT12Generation(input.generation),
          name = g.binding.primaryBook!;
        await guard(g, input);
        const book = await read(name);
        if ((await fingerprintT4(book)) !== input.expectedBookFingerprint) throw new T12Error('CONFLICT');
        assertT12NoAmbiguousActive(book);
        const diff = await diffT12Book(g, book);
        if (await confirmedT12Book(g, book)) {
          await guard(g, input);
          return;
        }
        const stamp = await guard(g, input);
        const fault = faults.shift();
        if (fault === 'write-failed') throw new T12Error('WRITE');
        // Withdraw only this new protocol's managed entries. Unknown/user/legacy entries are untouched.
        const staged: T12Book = {
          active: null,
          blocked: true,
          entries: book.entries.map(e => (ownerT12(e) ? { ...e, enabled: false } : copyT12(e))),
        };
        const desired = new Map(g.entries.map(e => [e.key, e]));
        let uid = book.entries.reduce((max, e) => Math.max(max, e.uid), -1) + 1;
        for (const d of diff) {
          if (d.kind === 'delete') staged.entries = staged.entries.filter(e => e.uid !== d.uid);
          else if (d.kind === 'create') {
            if (!Number.isSafeInteger(uid)) throw new T12Error('SIZE');
            staged.entries.push({ ...materializeT12(g, desired.get(d.key!)!, uid++), enabled: false });
          } else if (d.kind === 'update')
            staged.entries = staged.entries.map(e =>
              e.uid === d.uid ? { ...materializeT12(g, desired.get(d.key!)!, e.uid, e), enabled: false } : e,
            );
          if (fault === 'partial' && d.kind !== 'keep') {
            assertSource(g, stamp);
            assertBook(name, book);
            input.assertCurrent();
            write(name, staged);
            throw new T12Error('PENDING');
          }
        }
        // No async gap between final revocation check, all-entry activation and authoritative write.
        input.assertCurrent();
        assertSource(g, stamp);
        assertBook(name, book);
        if (input.signal?.aborted || !sameT12(binding, g.binding)) throw new T12Error('STALE');
        for (const e of staged.entries) {
          const o = ownerT12(e);
          if (o && sameT12(o.scope, g.scope) && o.characterId === g.binding.characterId) e.enabled = true;
        }
        staged.blocked = false;
        staged.active = activationT12(g);
        write(name, staged);
        if (fault === 'ack-lost') throw new T12Error('PENDING');
      }),
    capture: (input, consume) =>
      lock(async () => {
        const g = await validateT12Generation(input.generation);
        await guard(g, input);
        const book = await read(g.binding.primaryBook!);
        if (!(await confirmedT12Book(g, book))) throw new T12Error('PENDING');
        const stamp = await guard(g, input);
        const entries: T12BookEntry[] = book.entries.filter(e => e.enabled === true).map(copyT12);
        assertSource(g, stamp);
        stats.captures++;
        const result = await consume(entries);
        // A switch/revocation during capture rejects its result; no queued activation overlaps capture.
        await guard(g, input);
        assertBook(g.binding.primaryBook!, book);
        return result;
      }),
  };
  return {
    driver,
    registerSource: (scope: T4Scope, reader: () => T4Archive) => {
      sources.set(canonicalT4Json(scope), reader);
    },
    statistics: stats,
    switchBinding: (v: T12Binding) => {
      binding = normalizeT12Binding(v);
      emit('binding');
    },
    queueFault: (v: T12Fault) => {
      faults.push(v);
    },
    queueReadFailure: (count = 1) => {
      failedReads += count;
    },
    mutate: (name: string, operation: (book: T12Book) => T12Book) => {
      const serialized = books.get(name);
      if (!serialized) throw new T12Error('TARGET');
      books.set(name, JSON.stringify(normalizeT12Book(operation(JSON.parse(serialized)))));
      emit('book');
    },
    exportBooks: () =>
      Object.fromEntries([...books.entries()].map(([name, raw]) => [name, JSON.parse(raw) as T12Book])),
  };
}
