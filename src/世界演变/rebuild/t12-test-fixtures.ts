/** T12 tests only: no real globals, model requests, host or worldbook. */
import type { T4State, T4Archive } from './t4-protocol';
import { setupT11Test } from './t11-test-fixtures';
import { createT12Controller, type T12Options } from './t12-controller';
import { createT12SimulatedBook } from './t12-simulated-book';
import type { T12Capabilities, T12BookEntry } from './t12-gateway';
export const otherT12Entries: T12BookEntry[] = [
  { uid: 40, name: '用户设定', content: '保留原文', enabled: true, extra: { user: { x: 1 } } },
  { uid: 41, name: 'TavernDB-ACU-CustomExport-人物表-2', content: '数据库内容', enabled: true },
  { uid: 42, name: '[mvu_update]变量更新规则', content: 'MVU 原规则', enabled: true },
  {
    uid: 43,
    name: 'WorldEvolution-旧版归属不明',
    content: '旧版保留',
    enabled: false,
    extra: { managedBy: 'acu-world-evolution', chatKey: 'old' },
  },
];
export async function setupT12Test(
  state?: T4State,
  extra: Partial<T12Options> = {},
  capabilities?: Partial<T12Capabilities>,
) {
  const f = await setupT11Test(state);
  const binding = {
    chatId: f.scope.chatId,
    worldId: f.scope.worldId,
    branchId: f.scope.branchId,
    characterId: '测试角色卡',
    primaryBook: '测试角色卡主世界书',
  };
  const book = createT12SimulatedBook(
    binding,
    { [binding.primaryBook]: { entries: otherT12Entries, active: null, blocked: false } },
    capabilities,
  );
  book.registerSource(f.scope, () => {
    const fixture = JSON.parse(f.store.exportStorage());
    const raw = fixture.chats.find((c: { chatId: string }) => c.chatId === f.scope.chatId).archives[
      `${f.scope.worldId}/${f.scope.branchId}`
    ];
    return JSON.parse(raw) as T4Archive;
  });
  const options: T12Options = { scope: f.scope, service: f.service, store: f.store, driver: book.driver, ...extra };
  const projection = createT12Controller(options);
  return {
    ...f,
    binding,
    book,
    projection,
    projectionOptions: options,
    close() {
      projection.close();
      f.controller.close();
    },
  };
}
