/** Explicit local harness factory. No entry point, network, host state or automatic demo seeding. */
import { createDefaultT2Template } from './t2-defaults';
import { createT2EmptyWorld } from './t2-values';
import { fingerprintT4, type T4Scope, type T4State } from './t4-protocol';
import { createT4SandboxStore } from './t4-store';
import { createT4CommitService, type T4Executor } from './t4-service';
import { createT5Workbench } from './t5-workbench';

export async function createT5Sandbox(options: {
  execute: T4Executor;
  scope: T4Scope;
  /** Explicit developer fixture only; omitted means seven empty tables. */
  initial?: T4State;
  storage?: string;
  withMockAnchor?: boolean;
  canEdit?: () => boolean;
}) {
  const store = createT4SandboxStore(options.storage);
  const template = createDefaultT2Template();
  if (!options.storage)
    await store.initialize(
      options.scope,
      options.initial ?? {
        template,
        data: createT2EmptyWorld(template, options.scope.worldId, options.scope.branchId),
      },
    );
  const fingerprint = await fingerprintT4('T5 explicit local simulation, not a real plot message');
  const anchor = {
    chatId: options.scope.chatId,
    messageId: 'mock-assistant',
    swipeId: 'mock-swipe',
    inputFingerprint: fingerprint,
  };
  if (options.withMockAnchor) store.registerAnchor(anchor);
  const service = await createT4CommitService({ scope: options.scope, store, execute: options.execute });
  const nextId = () => globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const runSpec = () => ({
    runId: `r-${nextId()}`,
    commitId: `c-${nextId()}`,
    anchor: options.withMockAnchor ? anchor : null,
    context: {
      inputFingerprint: fingerprint,
      promptFingerprint: fingerprint,
      modelFingerprint: fingerprint,
      parametersFingerprint: fingerprint,
    },
  });
  const workbench = createT5Workbench({
    service,
    nextId,
    runSpec,
    readArchive: () => store.read(options.scope),
    ...(options.canEdit ? { canEdit: options.canEdit } : {}),
  });
  return { store, service, workbench, runSpec, exportStorage: () => store.exportStorage() };
}
