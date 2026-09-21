import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskApiRouteConcurrencyPool } from './route-concurrency-pool';

function limitsOf(entries: Array<[string, number]>): ReadonlyMap<string, number> {
  return new Map(entries);
}

test('distributes concurrent calls with heterogeneous per-route caps', async () => {
  const pool = new TaskApiRouteConcurrencyPool(
    ['primary', 'fb1', 'fb2'],
    limitsOf([
      ['primary', 5],
      ['fb1', 2],
      ['fb2', 10],
    ]),
  );
  const peakByRoute = new Map<string, number>();

  const jobs = Array.from({ length: 12 }, () =>
    pool.run(async route => {
      const active = pool.getActiveCount(route);
      peakByRoute.set(route, Math.max(peakByRoute.get(route) ?? 0, active));
      assert.ok(active <= (route === 'fb1' ? 2 : route === 'fb2' ? 10 : 5));
      await new Promise(r => setTimeout(r, 5));
      return route;
    }),
  );

  await Promise.all(jobs);
  assert.ok((peakByRoute.get('fb1') ?? 0) <= 2);
  assert.ok((peakByRoute.get('primary') ?? 0) <= 5);
});

test('unlimited route accepts unbounded concurrency', async () => {
  const pool = new TaskApiRouteConcurrencyPool(['only'], limitsOf([['only', 0]]));
  let maxInFlight = 0;
  let inFlight = 0;

  const jobs = Array.from({ length: 8 }, () =>
    pool.run(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
    }),
  );

  await Promise.all(jobs);
  assert.equal(maxInFlight, 8);
});

test('single capped route queues beyond max concurrency', async () => {
  const pool = new TaskApiRouteConcurrencyPool(['only'], limitsOf([['only', 5]]));
  let inFlight = 0;
  let maxInFlight = 0;

  const jobs = Array.from({ length: 8 }, () =>
    pool.run(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 20));
      inFlight--;
    }),
  );

  await Promise.all(jobs);
  assert.equal(maxInFlight, 5);
});

test('release wakes queued acquirers preferring freed route', async () => {
  const pool = new TaskApiRouteConcurrencyPool(
    ['a', 'b'],
    limitsOf([
      ['a', 1],
      ['b', 1],
    ]),
  );

  const holdA = await pool.acquire();
  const holdB = await pool.acquire();
  assert.equal(holdA, 'a');
  assert.equal(holdB, 'b');

  const thirdPromise = pool.acquire();
  let thirdResolved = false;
  void thirdPromise.then(route => {
    thirdResolved = true;
    assert.equal(route, 'a');
  });

  await new Promise(r => setTimeout(r, 10));
  assert.equal(thirdResolved, false);

  pool.release('a');
  const third = await thirdPromise;
  assert.equal(third, 'a');
  pool.release(third);
  pool.release(holdB);
});
