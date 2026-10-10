/** Node-only visual fixture producer; no real host, network or old IndexedDB. Not a plugin entry. */
import { setupT12Test } from './t12-test-fixtures';
import { createDefaultT2Fixture } from './t2-defaults';
import { createT5Workbench } from './t5-workbench';
import { createT6Workbench } from './t6-workbench';
import { createT6DefaultStore } from './t6-defaults';
import { createT7Workbench } from './t7-workbench';
import { createT13Controller } from './t13-controller';
import { executeT8Test } from './t8-test-fixtures';
export async function createT14VisualViews() {
  const f = await setupT12Test(createDefaultT2Fixture());
  const data = createT5Workbench({
    service: f.service,
    runSpec: f.spec,
    nextId: () => 'visual-new-id',
    readArchive: () => f.store.read(f.scope),
  });
  data.selectTable('npc');
  const structure = createT6Workbench({
    service: f.service,
    execute: executeT8Test,
    defaults: await createT6DefaultStore(f.state.template),
    runSpec: f.spec,
    dataIdle: () => !data.dirty(),
    afterSaved: async () => {},
  });
  structure.selectTable('npc');
  await structure.readDefault();
  const generation = await createT7Workbench({ readState: () => f.service.view().formal, input: f.input, api: f.api });
  const backup = createT13Controller({
    scope: f.scope,
    service: f.service,
    store: f.store,
    execute: executeT8Test,
    runSpec: async () => f.spec(),
    canBackupPrivate: () => false,
  });
  await f.controller.refresh();
  await f.projection.inspect();
  const result = {
    data: data.view(),
    structure: structure.view(),
    generation: generation.view(),
    daily: f.controller.view(),
    projection: f.projection.view(),
    backup: backup.view(),
  };
  const json = JSON.stringify(result);
  if (json.includes(f.api.presets[0].apiKey)) throw new Error('Visual fixture contains a credential');
  backup.close();
  f.close();
  f.service.close();
  return JSON.parse(json) as typeof result;
}
