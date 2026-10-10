/** Explicit developer fixture only. No live entry, host adapter, network or shared artifact. */
import type { WorldEvolutionApiConfiguration } from '../api-config';
import { cloneT2Json } from './t2-template';
import { normalizeT7Input, type T7Input } from './t7-input';
import { createT7Sandbox } from './t7-sandbox';
import { createT8Queue } from './t8-queue';
import { createT9Round, type T9Options } from './t9-round';
export async function createT9Sandbox(
  options: Parameters<typeof createT7Sandbox>[0] & {
    runtime?: Partial<
      Pick<
        T9Options,
        'reply' | 'queue' | 'pollMs' | 'prerequisiteTimeoutMs' | 'runTimeoutMs' | 'sqlTimeoutMs' | 'canRun'
      >
    >;
  },
) {
  const sandbox = await createT7Sandbox(options);
  let input = normalizeT7Input(options.input),
    api = cloneT2Json(options.api) as unknown as WorldEvolutionApiConfiguration;
  if (options.withMockAnchor !== false) sandbox.store.registerAnchor(input.anchor);
  const round = createT9Round({
    ...options.runtime,
    service: sandbox.service,
    ownerId: 't9-sandbox',
    queue: options.runtime?.queue ?? createT8Queue(),
    readInput: () => input,
    readApi: () => api,
    readPrompts: () => sandbox.generation.view().prompts.enabled,
    execute: options.execute,
    afterSaved: () => {
      sandbox.workbench.refreshSaved();
    },
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
    round,
    setInput(next: T7Input) {
      input = normalizeT7Input(next);
      sandbox.generation.setInput(input);
    },
    setApi(next: WorldEvolutionApiConfiguration) {
      api = cloneT2Json(next) as unknown as WorldEvolutionApiConfiguration;
      sandbox.generation.setApi(api);
    },
  };
}
