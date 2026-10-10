/** Test-only host and API. Never imported from a browser/native entry. */
import { copyT10, type T10Document } from './t10-host-protocol';
import { createT15CompatibilityHost, type T15CompatibilityPort } from './t15-chat-compatibility';
import { createT10CompatibilityGateway } from './t10-host-gateway';
import { createT15Prerequisites, captureT15Input } from './t15-prerequisites';
import { setupT8Test } from './t8-test-fixtures';
import { createT15WorldbookCompatibility } from './t15-worldbook-compatibility';
import type { T4Scope } from './t4-protocol';
export async function wiringFixture() {
  const model = setupT8Test(),
    scope: T4Scope = { mode: 't10-host', chatId: 'chat-wiring', worldId: 'demo-world', branchId: 'demo-main' },
    binding = { hostChatId: 'fixture', characterId: 'fixture.png' };
  const metadata = { integrity: 'fixture', variables: { keep: true } },
    chat: Record<string, unknown>[] = [
      { name: '玩家', is_user: true, mes: '继续', extra: {} },
      {
        name: '角色',
        is_user: false,
        mes: '暴雨加剧，道路受阻。',
        extra: {},
        variables: [{ stat_data: { weather: '雨' } }],
        TavernDB_ACU_IsolatedData: { slot: { result: '本轮结果' } },
      },
    ];
  let server: unknown[] = copyT10([
    { chat_metadata: metadata, user_name: 'unused', character_name: 'unused' },
    ...chat,
  ]);
  let saves = 0,
    epoch = 0;
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const events = Object.fromEntries(
    [
      'CHAT_CHANGED',
      'MESSAGE_DELETED',
      'MESSAGE_EDITED',
      'MESSAGE_UPDATED',
      'MESSAGE_SWIPED',
      'MESSAGE_SWIPE_DELETED',
      'MESSAGE_SENT',
      'MESSAGE_RECEIVED',
      'GENERATION_STARTED',
      'GENERATION_STOPPED',
      'CHARACTER_EDITED',
      'CHARACTER_DELETED',
      'WORLDINFO_UPDATED',
      'WORLDINFO_SETTINGS_UPDATED',
    ].map(v => [v, v]),
  );
  const port: T15CompatibilityPort = {
    origin: 'http://127.0.0.1:8000',
    version: 'fixture',
    leaseTarget: {},
    metadata: () => metadata,
    characterName: () => '角色',
    events,
    context: () => ({
      characterId: 0,
      characters: [{ avatar: binding.characterId, chat: binding.hostChatId }],
      chat,
      getCurrentChatId: () => binding.hostChatId,
      getRequestHeaders: () => ({ 'X-CSRF-TOKEN': 'test' }),
    }),
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return {
        stop: () => {
          handlers.get(event)!.delete(fn);
        },
      };
    },
    onPageHide: () => () => {},
    getPrimary: () => ({ primary: '主书', additional: [] }),
    getWorldbook: async () => [],
    async fetchImpl(url, init) {
      if (url.endsWith('/api/characters/chats')) return new Response(JSON.stringify([{ file_name: 'fixture.jsonl' }]));
      if (url.endsWith('/api/chats/get')) return new Response(JSON.stringify(server));
      if (!url.endsWith('/api/chats/save')) throw new Error('外部请求禁止');
      server = copyT10(JSON.parse(String(init.body)).chat);
      saves++;
      return new Response('{}');
    },
  };
  const host = createT15CompatibilityHost(port),
    gateway = createT10CompatibilityGateway(host.driver);
  await gateway.initialize(scope, model.state, kind => `${kind}-${crypto.randomUUID().slice(0, 8)}`);
  const read = () => host.driver.readDurable(binding),
    sourcePort = { read, epoch: () => epoch };
  const input = await captureT15Input(sourcePort, scope, 1);
  const selections = [
    {
      id: 'mvu' as const,
      required: true,
      selections: [{ path: ['stat_data'], label: 'MVU 天气', tableIds: ['environment'] }],
    },
    {
      id: 'database' as const,
      required: true,
      selections: [{ path: ['TavernDB_ACU_IsolatedData', 'slot'], label: '数据库本轮资料', tableIds: ['npc'] }],
    },
  ];
  const gate = createT15Prerequisites({ port: sourcePort, scope, input, sources: selections });
  let rawBook: Record<string, unknown> = {
    customHeader: { keep: true },
    entries: {
      '9': {
        uid: 9,
        comment: 'TavernDB-用户资料',
        content: '保留',
        key: ['保留'],
        keysecondary: [],
        disable: false,
        custom: { keep: 'ALL' },
      },
    },
  };
  let bookSaves = 0,
    bookEpoch = 0;
  const bookBinding = {
    chatId: scope.chatId,
    worldId: scope.worldId,
    branchId: scope.branchId,
    characterId: binding.characterId,
    primaryBook: '主书',
  };
  const book = createT15WorldbookCompatibility({
    current: () => bookBinding,
    epoch: () => bookEpoch,
    writable: () => true,
    subscribe: () => () => {},
    readRaw: async () => copyT10(rawBook),
    saveRaw: async (_name, raw) => {
      rawBook = copyT10(raw);
      bookSaves++;
    },
  });
  return {
    model,
    scope,
    binding,
    metadata,
    chat,
    host,
    gateway,
    gate,
    input,
    read,
    selections,
    book,
    bookBinding,
    port,
    handlers,
    saves: () => saves,
    bookSaves: () => bookSaves,
    rawBook: () => copyT10(rawBook),
    mutateBook: (fn: (value: Record<string, unknown>) => void) => fn(rawBook),
    bookEpoch: () => {
      bookEpoch++;
    },
    mutate: (fn: (doc: unknown[]) => void) => fn(server),
    setEpoch: () => {
      epoch++;
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const fn of handlers.get(event) ?? []) fn(...args);
    },
    async complete() {
      const doc: T10Document = await read(),
        last = doc.messages.at(-1)!;
      gate.complete('mvu', gate.begin('mvu', input.anchor), [last.swipes_data[last.swipe_id].stat_data]);
      gate.complete('database', gate.begin('database', input.anchor), [
        (last.TavernDB_ACU_IsolatedData as Record<string, unknown>).slot,
      ]);
      return gate.refresh();
    },
    close() {
      gate.close();
      book.close();
      host.close();
    },
  };
}
