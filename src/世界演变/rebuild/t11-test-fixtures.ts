/** Test-only fixtures. Not an entry, not a real TavernHelper driver. */
import type { T4State } from './t4-protocol';
import { createT3LocalPolicy } from './t3-engine';
import { createT11Controller, type T11Options } from './t11-controller';
import type { T9Options } from './t9-round';
import { setupT9Test } from './t9-test-fixtures';
import { setupT8Test, executeT8Test } from './t8-test-fixtures';
import { createT10Gateway } from './t10-host-gateway';
import { normalizeT10Document } from './t10-host-protocol';
import { createT10SimulatedHost } from './t10-simulated-host';
import { openT10Session } from './t10-session';
const hash = 'a'.repeat(64);
export async function setupT11Test(state?: T4State, runtime: Partial<T9Options> = {}, extra: Partial<T11Options> = {}) {
  const f = await setupT9Test(state, runtime);
  let next = 0;
  const spec = () => ({
    runId: `t11-manual-${++next}`,
    commitId: `t11-commit-${next}`,
    anchor: f.input.anchor,
    context: {
      inputFingerprint: f.input.anchor.inputFingerprint,
      promptFingerprint: hash,
      modelFingerprint: hash,
      parametersFingerprint: hash,
    },
  });
  const options: T11Options = {
    service: f.service,
    round: f.round,
    store: f.store,
    runtime: f.options,
    nextRunId: () => `t11-run-${++next}`,
    restoreSpec: async () => spec(),
    ...extra,
  };
  const controller = createT11Controller(options);
  const manual = async (goals = '人工修改') => {
    const s = f.service.view().formal;
    return f.service.prepareSql({
      ...spec(),
      kind: 'manual',
      batches: [
        {
          batchId: `batch-${next}`,
          sql: 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?',
          parameters: [goals, 'traveler'],
          policy: createT3LocalPolicy(s.template, s.data),
        },
      ],
    });
  };
  return { ...f, controller, t11Options: options, spec, manual };
}
export async function setupT11HostTest(runtime: Partial<T9Options> = {}) {
  const f = setupT8Test(undefined, runtime);
  const document = normalizeT10Document({
    binding: { hostChatId: 't11-test.jsonl', characterId: 'test-card' },
    variables: { mvu: { hp: 10 }, TavernDB: { rows: ['keep'] } },
    messages: [
      {
        message_id: 0,
        name: '叙述者',
        role: 'assistant',
        is_hidden: false,
        swipe_id: 0,
        swipes: ['暴雨加剧，道路受阻。'],
        swipes_data: [{ other: 'keep' }],
        swipes_info: [{}],
      },
    ],
  });
  const host = createT10SimulatedHost(document),
    gateway = createT10Gateway(host.driver);
  const scope = {
    mode: 't10-host' as const,
    chatId: 'chat-t11',
    worldId: f.state.data.worldId,
    branchId: f.state.data.branchId,
  };
  let count = 0;
  await gateway.initialize(scope, f.state, kind => `t11-${kind}-${++count}`);
  f.input.anchor = await gateway.capture(scope, 0, hash);
  f.input.story = [{ messageId: f.input.anchor.messageId, role: 'assistant', text: document.messages[0].swipes[0] }];
  const session = await openT10Session({ driver: host.driver, scope, execute: executeT8Test, runtime: f.options });
  const controller = createT11Controller({
    service: session.service,
    round: session.round,
    store: session.gateway,
    runtime: { ...f.options, canRun: session.canRun },
    canContinue: session.canContinue,
    readRecovery: session.refresh,
    nextRunId: () => `t11-host-run-${++count}`,
    restoreSpec: async () => ({
      runId: `t11-host-restore-${++count}`,
      commitId: `t11-host-c-${count}`,
      anchor: await session.gateway.capture(scope, 0, hash),
      context: { inputFingerprint: hash, promptFingerprint: hash, modelFingerprint: hash, parametersFingerprint: hash },
    }),
  });
  return { ...f, host, session, controller, scope };
}
