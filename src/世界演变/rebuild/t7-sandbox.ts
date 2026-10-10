/** Explicit developer factory. Does not install a script or read real chat/API variables. */
import type { WorldEvolutionApiConfiguration } from '../api-config';
import type { T7Input } from './t7-input';
import { createT6Sandbox } from './t6-sandbox';
import { createT7Workbench } from './t7-workbench';

export async function createT7Sandbox(
  options: Parameters<typeof createT6Sandbox>[0] & { input: T7Input; api: WorldEvolutionApiConfiguration },
) {
  const sandbox = await createT6Sandbox(options);
  const generation = await createT7Workbench({
    readState: () => sandbox.service.view().formal,
    input: options.input,
    api: options.api,
    canFreeze: () =>
      !sandbox.structure.dirty() &&
      !sandbox.structure.view().busy &&
      !sandbox.workbench.dirty() &&
      !sandbox.workbench.view().busy &&
      sandbox.workbench.view().history === null &&
      (!sandbox.service.view().draft || sandbox.service.view().status === 'saved'),
  });
  return { ...sandbox, generation };
}
