/** Shared, memory-only trigger ownership. Not a host lock or a durable receipt. */
export function createT8Queue(maxEntries = 64) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) throw new Error('队列容量无效');
  const entries = new Map<string, { runId: string; ownerId: string; revoked: boolean; done: Promise<void> }>();
  let tail = Promise.resolve();
  return {
    schedule(key: string, runId: string, ownerId: string, work: () => Promise<void>) {
      const previous = entries.get(key);
      if (previous) return { duplicate: true, runId: previous.runId, done: previous.done };
      if (entries.size >= maxEntries) throw new Error('模拟队列已满；不会遗忘去重记录后自动重发');
      const entry = { runId, ownerId, revoked: false, done: Promise.resolve() };
      entries.set(key, entry);
      entry.done = tail.then(work);
      tail = entry.done.catch(() => {});
      return { duplicate: false, runId, done: entry.done };
    },
    owns(key: string, runId: string, ownerId: string) {
      const entry = entries.get(key);
      return !!entry && !entry.revoked && entry.runId === runId && entry.ownerId === ownerId;
    },
    /** Explicit mock takeover; revoked ownership never silently comes back. */
    revoke(key: string) {
      const entry = entries.get(key);
      if (entry) entry.revoked = true;
    },
    /** Explicit same-run continuation; no new trigger or request counter. */
    continue(key: string, runId: string, ownerId: string, work: () => Promise<void>) {
      const entry = entries.get(key);
      if (!entry || entry.revoked || entry.runId !== runId || entry.ownerId !== ownerId)
        throw new Error('续跑已失去本轮所有权');
      const done = tail.then(work);
      tail = done.catch(() => {});
      entry.done = done;
      return done;
    },
    get size() {
      return entries.size;
    },
  };
}
export type T8Queue = ReturnType<typeof createT8Queue>;
