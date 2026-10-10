import { copyT10 } from './t10-host-protocol';
import type { T10Driver } from './t10-host-gateway';
import { inspectT10Host, type T10RecoveryView } from './t10-recovery';
export function createT10RecoveryController(driver: T10Driver, candidateCache?: unknown) {
  let busy = false,
    closed = false,
    epoch = 0,
    recovery: T10RecoveryView | null = null;
  const listeners = new Set<() => void>(),
    notify = () => listeners.forEach(fn => fn());
  const stop = driver.subscribe?.(() => {
    epoch++;
    recovery = null;
    notify();
  });
  return Object.freeze({
    view: () => ({ busy, recovery: recovery ? copyT10(recovery) : null }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async refresh() {
      if (closed || busy) return;
      busy = true;
      const revision = epoch;
      notify();
      try {
        const next = await inspectT10Host(driver, candidateCache);
        if (!closed && revision === epoch) recovery = next;
      } finally {
        busy = false;
        if (!closed) notify();
      }
    },
    close() {
      closed = true;
      epoch++;
      stop?.();
      listeners.clear();
    },
  });
}
export type T10RecoveryController = ReturnType<typeof createT10RecoveryController>;
