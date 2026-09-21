import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beginWorldbookReadCache,
  clearWorldbookReadCache,
  getWorldbookCached,
  getWorldbookReadCacheStats,
} from './read-cache';

test('getWorldbookCached coalesces and reuses in-flight reads when cache is active', async () => {
  let calls = 0;
  (globalThis as typeof globalThis & { getWorldbook: (name: string) => Promise<unknown[]> }).getWorldbook =
    async (name: string) => {
      calls += 1;
      await Promise.resolve();
      return [{ name, uid: calls }];
    };

  beginWorldbookReadCache();
  try {
    const [a, b, c] = await Promise.all([
      getWorldbookCached('BookA'),
      getWorldbookCached('BookA'),
      getWorldbookCached('BookA'),
    ]);
    assert.equal(calls, 1);
    assert.equal(a, b);
    assert.equal(b, c);
    const again = await getWorldbookCached('BookA');
    assert.equal(calls, 1);
    assert.equal(again, a);
    const stats = getWorldbookReadCacheStats();
    assert.equal(stats.enabled, true);
    assert.equal(stats.misses, 1);
    assert.ok(stats.hits >= 2);
  } finally {
    clearWorldbookReadCache();
  }
});

test('getWorldbookCached bypasses cache when not begun', async () => {
  let calls = 0;
  (globalThis as typeof globalThis & { getWorldbook: (name: string) => Promise<unknown[]> }).getWorldbook =
    async () => {
      calls += 1;
      return [];
    };

  await getWorldbookCached('BookA');
  await getWorldbookCached('BookA');
  assert.equal(calls, 2);
});
