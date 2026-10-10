/** Tests only: no production entry, actual host or network. */
import { setupT11Test } from './t11-test-fixtures';
import { executeT8Test } from './t8-test-fixtures';
import { createT13Controller, type T13Options } from './t13-controller';
import { createMinimalT2Fixture } from './t2-defaults';
import type { T4State } from './t4-protocol';
export function legacyT13Fixture() {
  const chatKey = 'test-legacy.jsonl';
  const row = (table: string, id: string, data: Record<string, unknown> = {}, visibility = 'revealed') => ({
    key: `${chatKey}\0${table}\0${id}`,
    id,
    chatKey,
    table,
    name: `名称-${id}`,
    visibility,
    revision: 3,
    data,
    createdAt: 1,
    updatedAt: 2,
  });
  return {
    meta: {
      key: chatKey,
      chatKey,
      revision: 3,
      worldbookSync: { status: 'synced', worldbookName: '旧角色卡世界书' },
      updatedAt: 2,
    },
    rows: {
      npc: [
        row('npc', 'old-npc', {
          locationId: 'old-place',
          organizationIds: ['old-org'],
          health: 0,
          awake: false,
          empty: '',
          unknown: { nested: [1, '二'] },
        }),
      ],
      organization: [row('organization', 'old-org', { memberIds: ['old-npc'] })],
      location: [row('location', 'old-place')],
      society: [],
      environment: [],
      event: [
        {
          ...row('event', 'old-event', { actorIds: ['old-npc'], locationId: 'old-place', summary: '行动已完成' }),
          title: '事件标题',
        },
      ],
      plan: [{ ...row('plan', 'old-plan', { actorIds: ['old-npc'], trigger: '下次雨停' }), status: 'done' }],
    },
    floorRuns: [{ id: 'old-run', status: 'done', messageId: 1 }],
    revisions: [{ revision: 3, operations: [{ op: 'custom-old-op' }] }],
    checkpoints: [{ revision: 2, legacyUnknown: '保留原检查点' }],
    projections: [{ uid: 42, bookName: '旧角色卡世界书', status: 'synced' }],
    unknownRoot: { original: '未知顶层字段也保留' },
  };
}
export async function setupT13Test(state?: T4State, extra: Partial<T13Options> = {}) {
  const f = await setupT11Test(state),
    options: T13Options = {
      scope: f.scope,
      service: f.service,
      store: f.store,
      execute: executeT8Test,
      runSpec: async () => f.spec(),
      canBackupPrivate: () => true,
      readSecrets: () => [f.api.presets[0].apiKey],
      ...extra,
    };
  const transfer = createT13Controller(options);
  const backup = async () => {
    const file = await transfer.backup('world', true);
    transfer.acknowledgeBackup(true);
    return file!;
  };
  const close = () => {
    transfer.close();
    f.controller.close();
    f.service.close();
  };
  return { ...f, transfer, transferOptions: options, backup, close };
}
export function emptyT13Fixture() {
  const s = createMinimalT2Fixture();
  s.data.tables = Object.fromEntries(s.template.tables.map(t => [t.id, []]));
  return s;
}
