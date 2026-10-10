/** Explicit developer factory; does not register a live script or call a real model. */
import type { WorldEvolutionApiConfiguration } from '../api-config';
import { cloneT2Json } from './t2-template';
import { normalizeT7Input, type T7Input } from './t7-input';
import { createT7Sandbox } from './t7-sandbox';
import { createT8Control, type T8Options } from './t8-control';
import { createT8Queue } from './t8-queue';

export async function createT8Sandbox(
  options: Parameters<typeof createT7Sandbox>[0] & {
    runtime?: Partial<
      Pick<T8Options, 'reply' | 'queue' | 'pollMs' | 'prerequisiteTimeoutMs' | 'runTimeoutMs' | 'sqlTimeoutMs'>
    >;
  },
) {
  const sandbox = await createT7Sandbox(options);
  let input = normalizeT7Input(options.input),
    api = cloneT2Json(options.api) as unknown as WorldEvolutionApiConfiguration;
  const macro = createT8Control({
    ...options.runtime,
    ownerId: 't8-sandbox',
    queue: options.runtime?.queue ?? createT8Queue(),
    readState: () => sandbox.service.view().formal,
    readInput: () => input,
    readApi: () => api,
    readPrompts: () => sandbox.generation.view().prompts.enabled,
    execute: options.execute,
    canFreeze: () =>
      !sandbox.structure.dirty() &&
      !sandbox.structure.view().busy &&
      !sandbox.workbench.dirty() &&
      !sandbox.workbench.view().busy &&
      sandbox.workbench.view().history === null &&
      !sandbox.generation.view().busy &&
      !sandbox.generation.view().prompts.dirty &&
      (!sandbox.service.view().draft || sandbox.service.view().status === 'saved'),
  });
  return {
    ...sandbox,
    macro,
    setInput(next: T7Input) {
      const safe = normalizeT7Input(next);
      sandbox.generation.setInput(safe);
      input = safe;
    },
    setApi(next: WorldEvolutionApiConfiguration) {
      const safe = cloneT2Json(next) as unknown as WorldEvolutionApiConfiguration;
      sandbox.generation.setApi(safe);
      api = safe;
    },
  };
}
