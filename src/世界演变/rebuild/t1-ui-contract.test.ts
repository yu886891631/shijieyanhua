import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { T1ActionId, T1Scope, T1UiPolicyContext } from './t1-ui-contract';

const productionContext: T1UiPolicyContext = {
  mode: 'production',
  worldStatus: 'ready',
  runStatus: 'idle',
  freshness: 'current',
  saveConfirmation: 'confirmed',
  hasAssistantAnchor: true,
  chatIdentityKnown: true,
  capabilities: {
    'chat-write': 'verified',
    'stable-anchor': 'verified',
    api: 'verified',
    'projection-isolation': 'verified',
    'worldbook-target': 'verified',
    'run-cancel': 'verified',
  },
};

test('T1 import, navigation, draft protection and policy evaluation access zero real capabilities', async t => {
  const accesses: string[] = [];
  const names = [
    'fetch',
    'indexedDB',
    'localStorage',
    'sessionStorage',
    'window',
    'parent',
    'document',
    'TavernHelper',
    'SillyTavern',
    'Mvu',
    'generate',
    'generateRaw',
    'getVariables',
    'replaceVariables',
    'getChatMessages',
    'setChatMessages',
    'getWorldbook',
    'replaceWorldbook',
    'eventOn',
  ];
  const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        accesses.push(name);
        throw new Error(`Real capability accessed: ${name}`);
      },
    });
  const model = await import('./t1-ui-contract');
  const controller = model.createT1SandboxController();
  controller.navigate({ page: 'history' });
  controller.markDraft('current-world', 'local fixture marker');
  controller.navigate({ page: 'data', tableId: 'custom-table' });
  controller.resolvePending('stay');
  controller.requestClose();
  controller.resolvePending('discard');
  for (const item of model.T1_ACTIONS) model.evaluateT1Action(item.id, productionContext);
  assert.deepEqual(accesses, []);
  assert.deepEqual(
    Object.keys(controller).sort(),
    ['getState', 'markDraft', 'mode', 'navigate', 'requestClose', 'resolvePending'].sort(),
  );
});

test('T1 nine page identities and each blueprint have consistent primary action metadata', async () => {
  const { T1_PAGE_IDS, T1_PAGE_ITEMS, T1_PAGE_BLUEPRINTS, describeT1Action } = await import('./t1-ui-contract');
  assert.equal(T1_PAGE_IDS.length, 9);
  assert.equal(new Set(T1_PAGE_IDS).size, 9);
  assert.deepEqual(
    T1_PAGE_ITEMS.map(item => item.id),
    [...T1_PAGE_IDS],
  );
  assert.deepEqual(Object.keys(T1_PAGE_BLUEPRINTS), [...T1_PAGE_IDS]);
  for (const page of T1_PAGE_ITEMS) {
    const blueprint = T1_PAGE_BLUEPRINTS[page.id];
    assert.equal(blueprint.title, page.label);
    assert.equal(blueprint.sections.length, 3);
    assert.ok(blueprint.emptyTitle && blueprint.emptyDescription && blueprint.futurePhase);
    assert.ok(describeT1Action(blueprint.primaryActionId).label);
    assert.ok(Object.isFrozen(blueprint.sections));
  }
});

test('T1 opaque custom table identities and every parameter section can be constructed', async () => {
  const { createT1Route, T1_PARAMETER_SECTIONS } = await import('./t1-ui-contract');
  assert.deepEqual(createT1Route({ page: 'data' }), { page: 'data', tableId: null, tab: 'records', section: 'schema' });
  for (const item of T1_PARAMETER_SECTIONS) {
    const route = createT1Route({ page: 'data', tableId: '用户DIY的第八张表', tab: 'parameters', section: item.id });
    assert.equal(route.page, 'data');
    assert.equal(route.tableId, '用户DIY的第八张表');
    assert.equal(route.section, item.id);
    assert.ok(Object.isFrozen(route));
  }
});

test('T1 route construction rejects invalid shapes, extra fields and incompatible nested routes', async () => {
  const { createT1Route } = await import('./t1-ui-contract');
  const bad = [
    null,
    undefined,
    [],
    new Date(),
    'overview',
    {},
    { page: 'missing' },
    { page: 'overview', tableId: 'x' },
    { page: 'data', tab: 'sql-editor' },
    { page: 'data', section: 'sql-write' },
    { page: 'data', tab: 'records', section: 'api' },
    { page: 'data', tableId: '' },
    { page: 'data', tableId: ' x ' },
    { page: 'data', tableId: '\n' },
    { page: 'data', tableId: 3 },
    { page: 'data', tableId: 'x'.repeat(161) },
    { page: 'data', [Symbol('extra')]: 'x' },
  ];
  for (const route of bad) assert.throws(() => createT1Route(route));
});

test('T1 constructor clones routes and all returned state is deeply frozen', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const route = { page: 'data', tableId: 'original-table', tab: 'parameters', section: 'schema' };
  const controller = createT1SandboxController({ initialRoute: route });
  route.tableId = 'mutated-input';
  assert.equal(controller.getState().route.page, 'data');
  assert.equal((controller.getState().route as { tableId: string }).tableId, 'original-table');
  const first = controller.getState();
  assert.ok(Object.isFrozen(controller));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.route));
  assert.notEqual(first, controller.getState());
  assert.throws(() => {
    (first as { isOpen: boolean }).isOpen = false;
  });
  assert.equal(controller.getState().isOpen, true);
});

test('T1 clean page navigation is immediate and never creates a confirmation', async () => {
  const { createT1SandboxController, T1_PAGE_IDS } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  for (const page of T1_PAGE_IDS) {
    const state = controller.navigate({ page });
    assert.equal(state.route.page, page);
    assert.equal(state.pending, null);
    assert.equal(state.dirtyDraft, null);
    assert.equal(state.notice, null);
  }
});

test('T1 unchanged destination does not repeatedly confirm even with a dirty draft', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController({ initialRoute: { page: 'data' } });
  controller.markDraft('current-world', 'fixture draft');
  const before = controller.getState();
  assert.deepEqual(controller.navigate({ page: 'data', tableId: null, tab: 'records', section: 'schema' }), before);
  assert.equal(controller.getState().pending, null);
});

test('T1 dirty cross-page navigation supports stay without losing the draft', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController({ initialRoute: { page: 'data', tableId: 'npc' } });
  controller.markDraft('current-world', 'fixture draft');
  const pending = controller.navigate({ page: 'api' });
  assert.equal(pending.route.page, 'data');
  assert.deepEqual(pending.pending, { kind: 'navigate', target: { page: 'api' } });
  assert.match(pending.notice!, /不会自动保存/);
  const kept = controller.resolvePending('stay');
  assert.equal(kept.route.page, 'data');
  assert.equal(kept.pending, null);
  assert.equal(kept.dirtyDraft?.label, 'fixture draft');
});

test('T1 explicit discard is the only leave-resolution that clears a dirty draft', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  controller.markDraft('current-template', 'field schema draft');
  controller.navigate({ page: 'history' });
  const after = controller.resolvePending('discard');
  assert.equal(after.route.page, 'history');
  assert.equal(after.dirtyDraft, null);
  assert.equal(after.pending, null);
  assert.match(after.notice!, /没有写入任何存档/);
});

test('T1 switching a table, tab or parameter section protects the same page draft', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const targets = [
    { page: 'data', tableId: 'other' },
    { page: 'data', tableId: 'npc', tab: 'parameters' },
    { page: 'data', tableId: 'npc', tab: 'parameters', section: 'api' },
  ];
  for (const target of targets) {
    const controller = createT1SandboxController({ initialRoute: { page: 'data', tableId: 'npc' } });
    controller.markDraft('current-world', 'fixture draft');
    assert.equal(controller.navigate(target).pending?.kind, 'navigate');
    assert.equal(controller.resolvePending('stay').route.page, 'data');
    assert.ok(controller.getState().dirtyDraft);
  }
});

test('T1 close is reachable without a draft and closes UI only', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  const closed = controller.requestClose();
  assert.equal(closed.isOpen, false);
  assert.equal(closed.pending, null);
  assert.match(closed.notice!, /没有取消或执行任何后台任务/);
  assert.deepEqual(controller.requestClose(), closed);
});

test('T1 dirty close preserves draft on stay and closes only on explicit discard', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  controller.markDraft('runtime-config', 'settings draft');
  const pending = controller.requestClose();
  assert.equal(pending.isOpen, true);
  assert.deepEqual(pending.pending, { kind: 'close' });
  assert.match(pending.notice!, /关闭不取消后台任务/);
  assert.equal(controller.resolvePending('stay').isOpen, true);
  assert.ok(controller.getState().dirtyDraft);
  controller.requestClose();
  const closed = controller.resolvePending('discard');
  assert.equal(closed.isOpen, false);
  assert.equal(closed.dirtyDraft, null);
});

test('T1 pending navigation destination is cloned and cannot be externally retargeted', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  controller.markDraft('current-world', 'fixture');
  const destination = { page: 'api' };
  const pending = controller.navigate(destination);
  destination.page = 'backup';
  assert.ok(Object.isFrozen(pending.pending));
  assert.deepEqual(controller.resolvePending('discard').route, { page: 'api' });
});

test('T1 invalid destinations and absent pending confirmation never change state', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  const before = controller.getState();
  assert.throws(() => controller.navigate({ page: 'unknown' }));
  assert.throws(() => controller.resolvePending('discard'), /No pending/);
  assert.throws(() => controller.resolvePending('auto-save' as 'discard'), /Unsupported/);
  assert.deepEqual(controller.getState(), before);
});

test('T1 a pending leave cannot be silently replaced by another destination or draft', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  controller.markDraft('current-world', 'fixture');
  controller.navigate({ page: 'data' });
  const before = controller.getState();
  assert.throws(() => controller.navigate({ page: 'api' }), /Resolve pending/);
  assert.throws(() => controller.requestClose(), /Resolve pending/);
  assert.throws(() => controller.markDraft('runtime-config', 'new draft'), /Resolve pending/);
  assert.deepEqual(controller.getState(), before);
});

test('T1 draft scope and printable label are checked, and a different draft cannot silently overwrite', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  for (const label of ['', ' ', ' x', '\n']) assert.throws(() => controller.markDraft('current-world', label));
  assert.throws(() => controller.markDraft('production' as T1Scope, 'draft'), /Unsupported/);
  controller.markDraft('current-world', 'first');
  const before = controller.getState();
  assert.throws(() => controller.markDraft('global-template', 'second'), /explicitly discarded/);
  assert.throws(() => controller.markDraft('current-world', 'second'), /explicitly discarded/);
  assert.deepEqual(controller.getState(), before);
});

test('T1 closed workbench cannot navigate, edit or resolve nonexistent pending state', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  const controller = createT1SandboxController();
  controller.requestClose();
  const before = controller.getState();
  assert.throws(() => controller.navigate({ page: 'api' }), /closed/);
  assert.throws(() => controller.markDraft('current-world', 'x'), /closed/);
  assert.throws(() => controller.resolvePending('discard'), /closed/);
  assert.deepEqual(controller.getState(), before);
});

test('T1 controller is permanently sandbox-only and rejects injected production or adapters', async () => {
  const { createT1SandboxController } = await import('./t1-ui-contract');
  assert.equal(createT1SandboxController().mode, 'sandbox-only');
  for (const options of [{ mode: 'production' }, { execute: () => assert.fail('never execute') }, { services: {} }]) {
    assert.throws(() => createT1SandboxController(options as { initialRoute?: unknown }), /unsupported property/);
  }
});

test('T1 scope notices distinguish data, current template, global defaults, config, history and projection', async () => {
  const { T1_SCOPE_DESCRIPTIONS, evaluateT1Action } = await import('./t1-ui-contract');
  assert.equal(Object.keys(T1_SCOPE_DESCRIPTIONS).length, 7);
  const notices = [
    'save-data',
    'migrate-template',
    'save-global-template',
    'save-runtime-config',
    'view-history',
    'sync-projection',
  ].map(id => evaluateT1Action(id as T1ActionId, productionContext).scopeNotice);
  assert.equal(new Set(notices).size, 6);
  assert.match(notices[0], /本聊天/);
  assert.match(notices[2], /以后/);
  assert.match(notices[3], /不发送 AI/);
  assert.match(notices[4], /查看不写入/);
});

test('T1 all view and preview intents are read-only even with unknown host capabilities', async () => {
  const { evaluateT1Action, describeT1Action } = await import('./t1-ui-contract');
  const context = {
    ...productionContext,
    worldStatus: 'history-readonly' as const,
    freshness: 'stale' as const,
    hasAssistantAnchor: false,
    chatIdentityKnown: false,
    capabilities: {},
  };
  for (const id of ['view-data', 'view-history', 'preview-context', 'preview-projection'] as const) {
    const action = describeT1Action(id);
    assert.deepEqual(action.effects, {
      reads: true,
      worldWrite: false,
      templateWrite: false,
      configWrite: false,
      realApi: false,
      worldbookWrite: false,
      runtimeChange: false,
    });
    assert.equal(evaluateT1Action(id, context).status, 'available-intent');
    assert.equal(evaluateT1Action(id, context).authorized, false);
  }
});

test('T1 sandbox never pretends unimplemented side effects succeeded', async () => {
  const { T1_ACTIONS, evaluateT1Action } = await import('./t1-ui-contract');
  for (const action of T1_ACTIONS) {
    const effectful = Object.entries(action.effects).some(([key, flag]) => key !== 'reads' && flag);
    const policy = evaluateT1Action(action.id, { ...productionContext, mode: 'sandbox-only' });
    if (effectful) {
      assert.equal(policy.status, 'blocked');
      assert.ok(policy.reasons.some(reason => reason.code === 'future-service'));
    }
    assert.equal(policy.authorized, false);
    assert.ok(Object.isFrozen(policy.reasons));
  }
});

test('T1 unknown or unsupported production save, AI and projection capabilities fail closed', async () => {
  const { evaluateT1Action } = await import('./t1-ui-contract');
  for (const id of [
    'save-data',
    'recover-history',
    'run-evolution',
    'regenerate',
    'sync-projection',
    'retry-projection',
  ] as const) {
    const policy = evaluateT1Action(id, { ...productionContext, capabilities: {} });
    assert.equal(policy.status, 'blocked');
    assert.ok(policy.reasons.some(reason => reason.code.startsWith('capability:')));
  }
  const unsupported = evaluateT1Action('save-data', {
    ...productionContext,
    capabilities: { 'chat-write': 'unsupported', 'stable-anchor': 'unknown' },
  });
  assert.equal(unsupported.reasons.filter(reason => reason.code.startsWith('capability:')).length, 2);
});

test('T1 no valid chat or assistant anchor permits draft only, never formal data saving', async () => {
  const { evaluateT1Action } = await import('./t1-ui-contract');
  for (const missing of [{ hasAssistantAnchor: false }, { chatIdentityKnown: false }]) {
    for (const id of [
      'initialize-world',
      'save-data',
      'recover-history',
      'migrate-template',
      'import-world',
    ] as const) {
      const policy = evaluateT1Action(id, { ...productionContext, ...missing });
      assert.equal(policy.status, 'blocked');
      assert.ok(policy.reasons.some(reason => reason.code === 'no-world-anchor'));
    }
  }
});

test('T1 running permits config drafts and next-round API changes but blocks data/schema saves', async () => {
  const { evaluateT1Action, describeT1Action } = await import('./t1-ui-contract');
  for (const runStatus of ['macro', 'macro-staged', 'micro', 'saving'] as const) {
    const context = { ...productionContext, runStatus };
    for (const id of ['save-data', 'migrate-template', 'recover-history'] as const)
      assert.ok(evaluateT1Action(id, context).reasons.some(reason => reason.code === 'cancel-before-commit'));
    assert.equal(evaluateT1Action('save-runtime-config', context).status, 'available-intent');
    assert.equal(evaluateT1Action('cancel-run', context).status, 'available-intent');
  }
  assert.match(describeT1Action('save-runtime-config').consequence, /不撤销本轮冻结配置/);
});

test('T1 stale baseline blocks mutation and projection, not read-only inspection or ordinary API config', async () => {
  const { evaluateT1Action } = await import('./t1-ui-contract');
  const context = { ...productionContext, freshness: 'stale' as const };
  for (const id of ['save-data', 'run-evolution', 'regenerate', 'sync-projection'] as const)
    assert.ok(evaluateT1Action(id, context).reasons.some(reason => reason.code === 'stale-baseline'));
  assert.equal(evaluateT1Action('view-history', context).status, 'available-intent');
  assert.equal(evaluateT1Action('save-runtime-config', context).status, 'available-intent');
});

test('T1 unknown save confirmation blocks duplicate saves, restore, regeneration and projection but permits read-only reconciliation', async () => {
  const { evaluateT1Action, describeT1Action } = await import('./t1-ui-contract');
  const context = { ...productionContext, saveConfirmation: 'unknown' as const };
  for (const id of [
    'save-data',
    'recover-history',
    'run-evolution',
    'regenerate',
    'sync-projection',
    'retry-projection',
    'migrate-template',
  ] as const) {
    const policy = evaluateT1Action(id, context);
    assert.equal(policy.status, 'blocked');
    assert.ok(policy.reasons.some(reason => reason.code === 'save-confirmation-unknown'));
  }
  assert.equal(evaluateT1Action('inspect-save-status', context).status, 'available-intent');
  assert.equal(evaluateT1Action('view-history', context).status, 'available-intent');
  assert.equal(describeT1Action('inspect-save-status').effects.worldWrite, false);
  assert.equal(describeT1Action('inspect-save-status').effects.realApi, false);
  assert.equal(describeT1Action('inspect-save-status').effects.worldbookWrite, false);
});

test('T1 worldbook synchronization only describes an available intent for a confirmed saved world', async () => {
  const { evaluateT1Action } = await import('./t1-ui-contract');
  for (const id of ['sync-projection', 'retry-projection'] as const) {
    const policy = evaluateT1Action(id, { ...productionContext, saveConfirmation: 'not-applicable' });
    assert.equal(policy.status, 'blocked');
    assert.ok(policy.reasons.some(reason => reason.code === 'no-confirmed-world'));
    assert.equal(evaluateT1Action(id, productionContext).status, 'available-intent');
  }
  assert.equal(
    evaluateT1Action('initialize-world', {
      ...productionContext,
      worldStatus: 'uninitialized',
      saveConfirmation: 'not-applicable',
    }).status,
    'available-intent',
  );
});

test('T1 interrupted requests are explicitly unknown and cannot silently run a duplicate round', async () => {
  const { evaluateT1Action, T1_RUN_STATES } = await import('./t1-ui-contract');
  const context = { ...productionContext, runStatus: 'interrupted' as const };
  assert.ok(evaluateT1Action('regenerate', context).reasons.some(reason => reason.code === 'cancel-before-commit'));
  assert.equal(evaluateT1Action('view-history', context).status, 'available-intent');
  assert.match(T1_RUN_STATES.find(item => item.id === 'interrupted')!.label, /结果未知.*不自动重试/);
});

test('T1 historical data view blocks modifying data, advanced structure and projection', async () => {
  const { evaluateT1Action } = await import('./t1-ui-contract');
  for (const id of [
    'save-data',
    'save-prompt-draft',
    'migrate-template',
    'clear-plugin-data',
    'sync-projection',
    'run-evolution',
    'recover-history',
  ] as const) {
    const policy = evaluateT1Action(id, { ...productionContext, worldStatus: 'history-readonly' });
    assert.equal(policy.status, 'blocked');
    assert.ok(policy.reasons.some(reason => reason.code === 'history-readonly'));
  }
});

test('T1 prompt draft and display settings do not masquerade as API settings or activate rules', async () => {
  const { describeT1Action, T1_PAGE_BLUEPRINTS, evaluateT1Action } = await import('./t1-ui-contract');
  assert.equal(T1_PAGE_BLUEPRINTS.api.primaryActionId, 'save-runtime-config');
  assert.equal(T1_PAGE_BLUEPRINTS.prompts.primaryActionId, 'save-prompt-draft');
  assert.equal(T1_PAGE_BLUEPRINTS.appearance.primaryActionId, 'save-display-settings');
  const prompt = describeT1Action('save-prompt-draft');
  assert.match(prompt.consequence, /不启用新规则.*不发送 AI 请求/);
  assert.equal(prompt.effects.worldWrite, false);
  assert.equal(prompt.effects.realApi, false);
  assert.equal(evaluateT1Action(prompt.id, { ...productionContext, runStatus: 'micro' }).status, 'available-intent');
  assert.equal(
    evaluateT1Action(prompt.id, { ...productionContext, hasAssistantAnchor: false }).status,
    'available-intent',
  );
  assert.ok(
    evaluateT1Action(prompt.id, { ...productionContext, chatIdentityKnown: false }).reasons.some(
      reason => reason.code === 'unknown-template-owner',
    ),
  );
  const appearance = describeT1Action('save-display-settings');
  assert.equal(appearance.scope, 'display-settings');
  assert.equal(appearance.effects.worldWrite, false);
  assert.equal(appearance.effects.realApi, false);
  assert.match(evaluateT1Action(appearance.id, productionContext).scopeNotice, /本机.*不改世界/);
});

test('T1 corrupt worlds require an explicit recovery path and uninitialized worlds cannot run', async () => {
  const { evaluateT1Action } = await import('./t1-ui-contract');
  assert.ok(
    evaluateT1Action('save-data', { ...productionContext, worldStatus: 'corrupt' }).reasons.some(
      reason => reason.code === 'corrupt-world',
    ),
  );
  assert.equal(
    evaluateT1Action('recover-history', { ...productionContext, worldStatus: 'corrupt' }).status,
    'available-intent',
  );
  for (const id of ['run-evolution', 'regenerate', 'sync-projection'] as const)
    assert.ok(
      evaluateT1Action(id, { ...productionContext, worldStatus: 'uninitialized' }).reasons.some(
        reason => reason.code === 'uninitialized-world',
      ),
    );
  assert.equal(
    evaluateT1Action('initialize-world', { ...productionContext, worldStatus: 'uninitialized' }).status,
    'available-intent',
  );
});

test('T1 recover, regenerate, projection retry and cancellation have distinct cost and write semantics', async () => {
  const { describeT1Action, evaluateT1Action } = await import('./t1-ui-contract');
  assert.equal(describeT1Action('recover-history').effects.realApi, false);
  assert.equal(describeT1Action('recover-history').effects.worldWrite, true);
  assert.equal(describeT1Action('regenerate').effects.realApi, true);
  assert.equal(describeT1Action('retry-projection').effects.realApi, false);
  assert.equal(describeT1Action('retry-projection').effects.worldWrite, false);
  assert.equal(describeT1Action('retry-projection').effects.worldbookWrite, true);
  assert.match(describeT1Action('cancel-run').consequence, /不能保证.*费用/);
  assert.ok(evaluateT1Action('cancel-run', productionContext).reasons.some(reason => reason.code === 'no-active-run'));
});

test('T1 local simulation and real API testing do not have ambiguous networking descriptions', async () => {
  const { describeT1Action } = await import('./t1-ui-contract');
  assert.equal(describeT1Action('test-api-local').effects.realApi, false);
  assert.equal(describeT1Action('test-api-real').effects.realApi, true);
  assert.match(describeT1Action('test-api-local').consequence, /不验证网络/);
  assert.match(describeT1Action('test-api-real').consequence, /消耗额度/);
  assert.equal(describeT1Action('test-api-real').requiresConfirmation, true);
});

test('T1 clear action is explicitly restricted to this plugin and separates worldbook cleanup', async () => {
  const { describeT1Action } = await import('./t1-ui-contract');
  const action = describeT1Action('clear-plugin-data');
  assert.equal(action.effects.worldbookWrite, false);
  assert.match(action.consequence, /不删剧情、MVU 或数据库插件资料/);
  assert.match(action.consequence, /世界书条目清理是另行确认/);
});

test('T1 invalid policy context or action cannot create an available mutation intent', async () => {
  const { evaluateT1Action, describeT1Action } = await import('./t1-ui-contract');
  for (const change of [
    { mode: 'live' },
    { runStatus: 'done' },
    { freshness: undefined },
    { hasAssistantAnchor: 1 },
    { capabilities: { arbitrary: 'verified' } },
    { capabilities: { 'chat-write': true } },
  ]) {
    const result = evaluateT1Action('save-data', { ...productionContext, ...change } as T1UiPolicyContext);
    assert.equal(result.status, 'blocked');
    assert.equal(result.authorized, false);
    assert.ok(result.reasons.some(reason => reason.code === 'invalid-context'));
  }
  assert.throws(() => describeT1Action('arbitrary-write' as T1ActionId), /Unsupported action/);
});

test('T1 intermediate and projection states explicitly avoid pretending formal data is lost or saved', async () => {
  const { T1_RUN_STATES, T1_UI_STATES } = await import('./t1-ui-contract');
  assert.match(T1_RUN_STATES.find(item => item.id === 'macro-staged')!.label, /尚未正式保存/);
  assert.match(T1_RUN_STATES.find(item => item.id === 'failed')!.label, /不代表新增世界版本/);
  assert.match(T1_UI_STATES.find(item => item.id === 'projection-pending')!.label, /世界已保存/);
});
