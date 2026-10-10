import { createT3BrowserRuntime } from './t3-browser-runtime';

// Test-only worker entry, deliberately not imported by t3-worker or a production entry.
// The expensive statement proves termination interrupts SQLite, rather than checking elapsed time after it returns.
const scope = globalThis as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: { data: { request: { sql: string; markers?: SharedArrayBuffer } } }) => void,
  ): void;
  postMessage(message: unknown): void;
};
scope.addEventListener('message', async event => {
  const SQL = await createT3BrowserRuntime();
  const db = new SQL.Database();
  const markers = event.data.request.markers ? new Int32Array(event.data.request.markers) : null;
  try {
    scope.postMessage({ type: 'test-started' });
    if (markers) Atomics.store(markers, 0, 1);
    const result = db.exec(event.data.request.sql);
    if (markers) Atomics.store(markers, 1, 1);
    scope.postMessage({ type: 'result', result: { testRows: result } });
  } finally {
    db.close();
  }
});
