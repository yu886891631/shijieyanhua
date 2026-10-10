/** Explicitly invoked read-only acquisition, NOT a startup probe or legacy writer import. */
import { T13Error, copyT13 } from './t13-backup';
const DB = 'acu-world-evolution-db';
const tables = ['npc', 'organization', 'location', 'society', 'environment', 'event', 'plan'];
const extra = {
  floorRuns: 'floor_run',
  revisions: 'evolution_revision',
  checkpoints: 'evolution_checkpoint',
  projections: 'worldbook_projection',
  migrationBackups: 'migration_backup',
};
/** Listing is required: do not open/create an absent DB or upgrade an old DB just to inspect it. */
export async function readT13IndexedDb(
  factory: IDBFactory,
  range: typeof IDBKeyRange,
  chatKey: string,
): Promise<unknown> {
  if (!chatKey || chatKey.length > 512 || typeof factory.databases !== 'function') throw new T13Error('READ');
  const listed = await factory.databases();
  if (!listed.some(d => d.name === DB)) throw new T13Error('SOURCE');
  return new Promise((resolve, reject) => {
    let database: IDBDatabase | null = null,
      settled = false;
    const finish = (error?: T13Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      database?.close();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new T13Error('READ')), 5000),
      request = factory.open(DB);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      finish(new T13Error('READ'));
    };
    request.onerror = () => finish(new T13Error('READ'));
    request.onblocked = () => finish(new T13Error('READ'));
    request.onsuccess = () => {
      database = request.result;
      if (settled) {
        database.close();
        return;
      }
      try {
        if (database.version !== 4) throw new T13Error('FORMAT');
        const names = [
          'world_meta',
          ...tables,
          ...Object.values(extra).filter(n => database!.objectStoreNames.contains(n)),
        ];
        if (names.some(n => !database!.objectStoreNames.contains(n))) throw new T13Error('FORMAT');
        const tx = database.transaction(names, 'readonly'),
          result: Record<string, unknown> = { rows: {} };
        let total = 0;
        for (const name of names) {
          const store = tx.objectStore(name),
            query =
              name === 'world_meta' ? store.get(chatKey) : store.index('chatKey').getAll(range.only(chatKey), 5001);
          query.onsuccess = () => {
            try {
              if (name === 'world_meta') {
                if (!query.result) throw new T13Error('SOURCE');
                result.meta = query.result;
              } else {
                const values = query.result as unknown[];
                total += values.length;
                if (total > 5000) throw new T13Error('SIZE');
                if (tables.includes(name)) (result.rows as Record<string, unknown>)[name] = values;
                else result[Object.entries(extra).find(([, v]) => v === name)![0]] = values;
              }
            } catch {
              tx.abort();
              finish(new T13Error('READ'));
            }
          };
        }
        tx.oncomplete = () => {
          try {
            for (const key of Object.keys(extra)) result[key] ??= [];
            finish(undefined, copyT13(result));
          } catch {
            finish(new T13Error('FORMAT'));
          }
        };
        tx.onerror = tx.onabort = () => finish(new T13Error('READ'));
      } catch {
        finish(new T13Error('READ'));
      }
    };
  });
}
