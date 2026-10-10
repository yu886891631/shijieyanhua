import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { patchedDatabaseFixture } from './t15-db-patch-test-fixtures';
import type { T15DbEvent } from './t15-db-completion-protocol';
import { createT15DbCompletionPatch } from './t15-db-completion-patch';
const terminals = (events: T15DbEvent[]) => events.filter(e => e.type === 'terminal');
test('delivered compatibility patch matches the current pinned source hooks and portable protocol exactly', async () => {
  const reference = process.env.WE_T15_DB_REFERENCE ?? resolve(process.cwd(), '../shujuku-inspect-20260925');
  const generated = await createT15DbCompletionPatch(reference),
    saved = await readFile('compat/shujuku-round-completion/automatic-plan-v1.patch', 'utf8');
  assert.equal(saved, generated);
});

for (const legacy of [false, true])
  test(`pinned database source ${legacy ? 'legacy SQLite + staging' : 'grouped + staging'} emits only after the outer finally`, async () => {
    const f = await patchedDatabaseFixture({ legacy });
    try {
      const done = f.start();
      await f.afterGroups;
      assert.equal(terminals(f.events).length, 0, 'all groups are still not the whole terminal');
      f.apply();
      assert.equal((await f.gate.refresh()).ready, false);
      f.release();
      await done;
      assert.equal(terminals(f.events).length, 1);
      assert.equal(terminals(f.events)[0].outcome, 'success');
      f.apply();
      assert.equal((await f.gate.refresh()).ready, true);
      assert.equal(f.saves(), 1);
      assert.equal(f.bookSaves(), 0);
      f.busy(true);
      assert.equal(f.monitor.status().database, false, 'a later database job blocks reuse even before table changes');
      f.busy(false);
    } finally {
      f.close();
    }
  });
for (const [label, scenario, outcome] of [
  ['failed group despite aggregate success', { failed: true }, 'unverifiable'],
  ['missing runner despite aggregate success', { missingGroup: true }, 'unverifiable'],
  ['stopped', { stopped: true }, 'cancelled'],
  ['exception in runner', { throwGroup: true }, 'failure'],
  ['precondition unavailable', { preconditionFailure: true }, 'failure'],
  ['disabled', { disabled: true }, 'disabled'],
  ['no tables due', { noWork: true }, 'frequency-skipped'],
] as const)
  test(`pinned database source reports ${label} without changing its control flow`, async () => {
    const f = await patchedDatabaseFixture(scenario);
    try {
      const done = f.start();
      f.release();
      await done;
      const receipt = terminals(f.events);
      assert.equal(receipt.length, 1);
      assert.equal(receipt[0].outcome, outcome);
      f.apply();
      assert.equal((await f.gate.refresh()).ready, ['disabled', 'frequency-skipped'].includes(outcome));
      assert.equal(f.saves(), 1);
      assert.equal(f.bookSaves(), 0);
    } finally {
      f.close();
    }
  });
test('coalesced automatic follow-up cannot publish success for the prematurely closing first attempt', async () => {
  const f = await patchedDatabaseFixture({ coalesced: true });
  try {
    const done = f.start();
    f.release();
    await done;
    await new Promise(resolve => setTimeout(resolve, 0));
    const receipt = terminals(f.events);
    assert.equal(receipt[0].outcome, 'cancelled');
    assert.equal(
      receipt.some(e => e.outcome === 'success'),
      false,
    );
    assert.equal(receipt.at(-1)!.outcome, 'frequency-skipped');
  } finally {
    f.close();
  }
});
