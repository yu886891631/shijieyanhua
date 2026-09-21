import type { WorldbookEntry } from '@types/function/worldbook';

let entriesByBook: Map<string, WorldbookEntry[]> | null = null;
let inflightByBook: Map<string, Promise<WorldbookEntry[]>> | null = null;
let hits = 0;
let misses = 0;

export function beginWorldbookReadCache(): void {
  entriesByBook = new Map();
  inflightByBook = new Map();
  hits = 0;
  misses = 0;
}

export function clearWorldbookReadCache(): void {
  entriesByBook = null;
  inflightByBook = null;
  hits = 0;
  misses = 0;
}

export function getWorldbookReadCacheStats(): { hits: number; misses: number; enabled: boolean } {
  return { hits, misses, enabled: entriesByBook != null };
}

/** 同轮并行 $1/$2 共用一次 getWorldbook；世界书写入后须 clear。 */
export async function getWorldbookCached(bookName: string): Promise<WorldbookEntry[]> {
  if (!entriesByBook || !inflightByBook) {
    return getWorldbook(bookName);
  }

  const cached = entriesByBook.get(bookName);
  if (cached) {
    hits += 1;
    return cached;
  }

  let pending = inflightByBook.get(bookName);
  if (!pending) {
    misses += 1;
    pending = getWorldbook(bookName).then(
      entries => {
        entriesByBook?.set(bookName, entries);
        inflightByBook?.delete(bookName);
        return entries;
      },
      err => {
        inflightByBook?.delete(bookName);
        throw err;
      },
    );
    inflightByBook.set(bookName, pending);
  } else {
    hits += 1;
  }
  return pending;
}
