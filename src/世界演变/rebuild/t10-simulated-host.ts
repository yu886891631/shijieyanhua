/** Test-only durable host. Reopen exported JSON with shared driver to test refresh/multi-instance. */
import { fingerprintT4 } from './t4-protocol';
import { T4StoreError } from './t4-store';
import { copyT10, normalizeT10Document, sameT10, type T10Binding, type T10Document } from './t10-host-protocol';
import type { T10Driver, T10Event } from './t10-host-gateway';
export function createT10SimulatedHost(initial: T10Document) {
  let raw = JSON.stringify(normalizeT10Document(initial)),
    binding = copyT10(initial.binding),
    reads = 0,
    writes = 0,
    readFailures = 0;
  let delay: (() => Promise<void>) | null = null;
  const faults: ('save-failed' | 'ack-lost' | 'readback-failed')[] = [],
    listeners = new Set<(event: T10Event) => void>();
  const driver: T10Driver = Object.freeze({
    capabilities: Object.freeze({
      environment: 'simulated-host' as const,
      version: 't10-fixture-v1',
      evidence: 'synchronous JSON assignment CAS after full-document validation; NOT actual SillyTavern evidence',
      durableRead: true,
      atomicDocumentCas: true,
      writeScope: 'fixture' as const,
    }),
    currentBinding: () => copyT10(binding),
    async readDurable(expected: T10Binding) {
      reads++;
      if (!sameT10(expected, binding)) throw new T4StoreError('IDENTITY');
      if (readFailures > 0) {
        readFailures--;
        throw new T4StoreError('READ_FAILED');
      }
      return normalizeT10Document(JSON.parse(raw));
    },
    async compareDocument(input: Parameters<T10Driver['compareDocument']>[0]) {
      const frozen = copyT10({
        binding: input.binding,
        expectedFingerprint: input.expectedFingerprint,
        document: input.document,
      });
      const next = JSON.stringify(normalizeT10Document(frozen.document));
      if (delay) await delay();
      const observedRaw = raw;
      if ((await fingerprintT4(JSON.parse(observedRaw))) !== frozen.expectedFingerprint)
        throw new T4StoreError('CONFLICT');
      try {
        if (input.authorize() !== undefined) throw new Error();
      } catch {
        throw new T4StoreError('ABORTED');
      }
      if (input.signal?.aborted) throw new T4StoreError('ABORTED');
      if (!sameT10(binding, frozen.binding)) throw new T4StoreError('IDENTITY');
      if (raw !== observedRaw) throw new T4StoreError('CONFLICT');
      const fault = faults.shift();
      if (fault === 'save-failed') throw new T4StoreError('SAVE_FAILED');
      raw = next;
      writes++;
      if (fault === 'readback-failed') readFailures++;
      if (fault === 'ack-lost') throw new T4StoreError('ACK_LOST');
    },
    subscribe(fn: (event: T10Event) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  });
  return {
    driver,
    exportStorage: () => raw,
    get statistics() {
      return { reads, writes };
    },
    queueFault(fault: (typeof faults)[number]) {
      faults.push(fault);
    },
    failReads(count = 1) {
      readFailures += count;
    },
    delayWrites(fn: (() => Promise<void>) | null) {
      delay = fn;
    },
    /** Fault injection only: this is not an editing API exposed to the live user. */
    mutate(fn: (doc: T10Document) => void, event: T10Event = 'edited') {
      const doc = JSON.parse(raw) as T10Document;
      fn(doc);
      raw = JSON.stringify(doc);
      for (const listener of listeners) listener(event);
    },
    switchBinding(next: T10Binding) {
      binding = copyT10(next);
      for (const listener of listeners) listener('chat-changed');
    },
    emit(event: T10Event) {
      for (const listener of listeners) listener(event);
    },
  };
}
