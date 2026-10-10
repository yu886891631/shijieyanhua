/** Deterministic IDB-port fixtures, not browser-engine persistence acceptance. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readT13IndexedDb } from './t13-indexeddb-reader';
import { legacyT13Fixture } from './t13-test-fixtures';
import { T13Error } from './t13-backup';
function fixture(
  config: {
    exists?: boolean;
    upgrade?: boolean;
    version?: number;
    missing?: boolean;
    error?: boolean;
    oversize?: boolean;
  } = {},
) {
  const raw = legacyT13Fixture(),
    rows = raw.rows as unknown as Record<string, unknown[]>;
  const stores: Record<string, unknown[]> = {
    world_meta: [raw.meta],
    ...rows,
    floor_run: raw.floorRuns,
    evolution_revision: raw.revisions,
    evolution_checkpoint: raw.checkpoints,
    worldbook_projection: raw.projections,
    migration_backup: [],
  };
  const stats = { opens: 0, closes: 0, aborts: 0, transactions: [] as string[], range: [] as unknown[] };
  let request: Record<string, unknown>;
  const factory = {
    databases: async () => (config.exists === false ? [] : [{ name: 'acu-world-evolution-db', version: 4 }]),
    open: (name: string) => {
      assert.equal(name, 'acu-world-evolution-db');
      stats.opens++;
      const tx: {
        oncomplete?: () => void;
        onerror?: () => void;
        onabort?: () => void;
        abort: () => void;
        objectStore: (n: string) => unknown;
      } = {
        abort: () => {
          stats.aborts++;
          tx.onabort?.();
        },
        objectStore: (name: string) => {
          const query = {
            result: config.oversize ? Array(5001).fill({}) : stores[name],
            onsuccess: undefined as (() => void) | undefined,
          };
          const getAll = (key: unknown, count: number) => {
            stats.range.push(key);
            assert.equal(count, 5001);
            queueMicrotask(() => query.onsuccess?.());
            return query;
          };
          return {
            get: (key: unknown) => {
              assert.equal(key, raw.meta.chatKey);
              query.result = raw.meta as unknown as unknown[];
              queueMicrotask(() => query.onsuccess?.());
              return query;
            },
            index: (key: string) => {
              assert.equal(key, 'chatKey');
              return { getAll };
            },
          };
        },
      };
      const db = {
        version: config.version ?? 4,
        objectStoreNames: { contains: (n: string) => !config.missing && n in stores },
        close: () => {
          stats.closes++;
        },
        transaction: (names: string[], mode: string) => {
          stats.transactions.push(mode);
          assert.equal(mode, 'readonly');
          assert.ok(names.includes('npc'));
          setTimeout(() => (config.error ? tx.onerror?.() : tx.oncomplete?.()), 0);
          return tx;
        },
      };
      request = {
        result: db,
        transaction: {
          abort: () => {
            stats.aborts++;
          },
        },
      };
      queueMicrotask(() => {
        if (config.upgrade) (request.onupgradeneeded as () => void)();
        else (request.onsuccess as () => void)();
      });
      return request;
    },
  } as unknown as IDBFactory;
  const range = { only: (key: unknown) => ({ selected: key }) } as unknown as typeof IDBKeyRange;
  return { factory, range, stats, raw };
}
test('T13 IDB reader explicitly uses a single readonly transaction scoped to chosen chat and closes without source writes', async () => {
  const f = fixture();
  const result = (await readT13IndexedDb(f.factory, f.range, f.raw.meta.chatKey)) as {
    rows: unknown;
    revisions: unknown;
  };
  assert.deepEqual(result.rows, f.raw.rows);
  assert.deepEqual(result.revisions, f.raw.revisions);
  assert.deepEqual(f.stats.transactions, ['readonly']);
  assert.equal(f.stats.closes, 1);
  assert.ok(f.stats.range.every(r => (r as { selected: string }).selected === f.raw.meta.chatKey));
  assert.equal(f.stats.aborts, 0);
});
test('T13 absent database or unavailable database listing never opens or creates a legacy DB', async () => {
  const f = fixture({ exists: false });
  await assert.rejects(() => readT13IndexedDb(f.factory, f.range, 'chosen'), new T13Error('SOURCE'));
  assert.equal(f.stats.opens, 0);
  const g = fixture();
  g.factory.databases = undefined as unknown as IDBFactory['databases'];
  await assert.rejects(() => readT13IndexedDb(g.factory, g.range, 'chosen'));
  assert.equal(g.stats.opens, 0);
});
test('T13 disappeared-between-list-and-open upgrade is aborted, never initialized', async () => {
  const f = fixture({ upgrade: true });
  await assert.rejects(() => readT13IndexedDb(f.factory, f.range, 'chosen'));
  assert.equal(f.stats.aborts, 1);
  assert.equal(f.stats.transactions.length, 0);
});
for (const config of [{ version: 9 }, { missing: true }, { error: true }, { oversize: true }])
  test(`T13 IDB incompatible/missing/failed/oversize read is closed with no writable transaction ${JSON.stringify(config)}`, async () => {
    const f = fixture(config);
    await assert.rejects(() => readT13IndexedDb(f.factory, f.range, f.raw.meta.chatKey));
    assert.equal(f.stats.closes, 1);
    assert.ok(f.stats.transactions.every(mode => mode === 'readonly'));
  });
