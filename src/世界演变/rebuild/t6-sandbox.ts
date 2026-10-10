import { createT5Sandbox } from './t5-sandbox';
import { createT6DefaultStore } from './t6-defaults';
import { createT6Workbench, type T6Workbench } from './t6-workbench';

/** One data/structure sandbox, not a runtime entry and never a production store. */
export async function createT6Sandbox(options: Parameters<typeof createT5Sandbox>[0] & { defaultStorage?: string }) {
  let structure: T6Workbench | null = null;
  let refreshing = false;
  const sandbox = await createT5Sandbox({
    ...options,
    canEdit: () => refreshing || (!structure?.dirty() && !structure?.view().busy),
  });
  const defaults = await createT6DefaultStore(sandbox.service.view().formal.template, options.defaultStorage);
  structure = createT6Workbench({
    service: sandbox.service,
    execute: options.execute,
    runSpec: sandbox.runSpec,
    defaults,
    dataIdle: () =>
      !sandbox.workbench.dirty() && !sandbox.workbench.view().busy && sandbox.workbench.view().history === null,
    afterSaved: async () => {
      refreshing = true;
      try {
        await sandbox.workbench.reload(false);
      } finally {
        refreshing = false;
      }
    },
  });
  await structure.readDefault();
  return { ...sandbox, defaults, structure };
}
