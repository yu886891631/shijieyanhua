/** Test-only SQLite + fake transport + simulated durable gateway. No browser entry. */
import { createT4SandboxStore, type T4ArchiveGateway } from './t4-store';
import { createT4CommitService } from './t4-service';
import type { T4State } from './t4-protocol';
import { createT9Round, type T9Options } from './t9-round';
import { setupT8Test, executeT8Test } from './t8-test-fixtures';
export async function setupT9Test(
  state?: T4State,
  extras: Partial<T9Options> = {},
  gateway?: (store: T4ArchiveGateway) => T4ArchiveGateway,
) {
  const f = setupT8Test(state, extras);
  const store = createT4SandboxStore();
  const scope = {
    mode: 't4-sandbox' as const,
    chatId: f.input.anchor.chatId,
    worldId: f.input.worldId,
    branchId: f.input.branchId,
  };
  await store.initialize(scope, f.state);
  store.registerAnchor(f.input.anchor, { externalMvu: 'unchanged', externalDatabase: 'unchanged' });
  const service = await createT4CommitService({
    scope,
    store: gateway?.(store) ?? store,
    execute: extras.execute ?? executeT8Test,
  });
  const options: T9Options = { ...f.options, ...extras, service };
  const round = createT9Round(options);
  return { ...f, store, scope, service, options, round };
}
export async function finishT9Test(f: Awaited<ReturnType<typeof setupT9Test>>, runId = 't9-run') {
  await (
    await f.round.start(runId)
  ).done;
  return f.round.view();
}
export async function untilT9Test(check: () => boolean) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 20000) throw new Error('T9 test timeout');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
