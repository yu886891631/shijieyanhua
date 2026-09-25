import { createApp, h, reactive, ref } from 'vue';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import {
  runWorldEvolution,
  setWorldEvolutionStatusListener,
  type WorldEvolutionRunResult,
} from './engine';
import {
  deleteWorldEntityManually,
  exportWorld,
  importWorld,
  loadSettings,
  loadWorld,
  saveSettings,
  updateWorldEntityManually,
} from './store';
import { syncWorldEvolutionWorldbook } from './worldbook';

let app: ReturnType<typeof createApp> | null = null;
let root: JQuery<HTMLDivElement> | null = null;
let styleDestroy: (() => void) | null = null;
let stopChatChangeListener: EventOnReturn | undefined;

const css = `
.we-panel{position:fixed;right:16px;bottom:16px;z-index:10080;width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;box-shadow:0 12px 36px #0008;font:13px/1.45 system-ui,sans-serif}
.we-panel *{box-sizing:border-box}.we-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #374151}.we-title{font-weight:700}.we-close,.we-btn{border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;border-radius:7px;padding:6px 10px;cursor:pointer}.we-btn:hover,.we-close:hover{background:#374151}.we-body{padding:14px;display:grid;gap:10px}.we-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.we-label{color:#9ca3af;min-width:130px}.we-input{flex:1;min-width:150px;background:#0b1220;color:#f3f4f6;border:1px solid #4b5563;border-radius:6px;padding:6px 8px}.we-status{white-space:pre-wrap;background:#0b1220;border:1px solid #374151;border-radius:7px;padding:8px;max-height:180px;overflow:auto}.we-danger{color:#fca5a5}.we-ok{color:#86efac}.we-muted{color:#9ca3af;font-size:12px}.we-check{accent-color:#38bdf8}
.we-section{border:1px solid #374151;border-radius:8px;padding:10px;display:grid;gap:8px}.we-section-title{font-weight:600;color:#d1d5db}.we-list{display:grid;gap:6px}.we-card{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start;background:#0b1220;border:1px solid #263244;border-radius:7px;padding:8px}.we-card-title{font-weight:600}.we-card-meta{color:#9ca3af;font-size:12px}.we-card-state{white-space:pre-wrap;color:#cbd5e1;font-size:12px;max-height:90px;overflow:auto}.we-card-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.we-small{padding:4px 7px;font-size:12px}.we-select{background:#0b1220;color:#f3f4f6;border:1px solid #4b5563;border-radius:6px;padding:6px 8px}
`;

function mountPanel(): void {
  if (root?.length) return;
  const state = reactive({
    settings: loadSettings(),
    status: 'idle',
    statusMessage: '等待触发',
    running: false,
    lastResult: null as WorldEvolutionRunResult | null,
    world: null as Awaited<ReturnType<typeof loadWorld>> | null,
    objectFilter: '',
    objectType: 'all' as 'all' | 'npc' | 'organization' | 'location' | 'environment' | 'social',
    chatKey: getCurrentChatKey(),
  });

  const refreshWorld = async (): Promise<void> => {
    try {
      state.world = await loadWorld(state.chatKey);
    } catch (error) {
      state.statusMessage = `读取世界演变记录失败：${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const syncAfterManualChange = async (): Promise<void> => {
    const settings = state.settings;
    if (!settings.worldbookAutoSync || !settings.worldbookName.trim() || !state.world) return;
    await syncWorldEvolutionWorldbook(settings.worldbookName.trim(), state.world);
  };

  void refreshWorld();

  setWorldEvolutionStatusListener(update => {
    state.status = update.status;
    state.statusMessage = update.message;
    state.lastResult = update.result ?? state.lastResult;
    state.running = ['waiting', 'collecting', 'generating', 'committing', 'syncing'].includes(update.status);
    void refreshWorld();
  });

  const Panel = {
    setup() {
      const visible = ref(false);
      const error = ref('');
      const resultText = () => {
      const result = state.lastResult;
        if (!result) return '暂无运行记录';
        return JSON.stringify(
          {
            status: result.status,
            messageId: result.messageId,
            candidates: result.candidateNames,
            changedEntityIds: result.changedEntityIds,
            eventIds: result.eventIds,
            reason: result.reason,
            error: result.error,
            rawResponse: result.rawResponse?.slice(0, 6000),
          },
          null,
          2,
        );
      };
      const filteredEntities = () => {
        const query = state.objectFilter.trim().toLowerCase();
        return Object.values(state.world?.entities ?? {})
          .filter(entity => state.objectType === 'all' || entity.type === state.objectType)
          .filter(entity => !query || `${entity.name}${JSON.stringify(entity.state)}`.toLowerCase().includes(query))
          .sort((left, right) => right.updatedAt - left.updatedAt);
      };
      const failedMessageId = () =>
        state.world?.runRecords
          .slice()
          .reverse()
          .find(record => record.status === 'failed')?.messageId;
      const save = () => {
        saveSettings(state.settings);
        state.statusMessage = '设置已保存';
      };
      const run = async () => {
        error.value = '';
        saveSettings(state.settings);
        const result = await runWorldEvolution(undefined, { source: 'manual' });
        state.lastResult = result;
        await refreshWorld();
        if (result.error) error.value = result.error;
      };
      const retryFailed = async () => {
        const messageId = failedMessageId();
        if (messageId == null || messageId < 0) return;
        error.value = '';
        saveSettings(state.settings);
        const result = await runWorldEvolution(messageId, { source: 'manual' });
        state.lastResult = result;
        await refreshWorld();
        if (result.error) error.value = result.error;
      };
      const editEntity = async (entityId: string) => {
        const entity = state.world?.entities[entityId];
        if (!entity) return;
        const raw = window.prompt(
          `编辑 ${entity.name} 的状态 JSON（会与现有状态合并）`,
          JSON.stringify(entity.state, null, 2),
        );
        if (raw == null) return;
        try {
          const patch = JSON.parse(raw) as unknown;
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new Error('状态必须是 JSON 对象');
          }
          state.world = await updateWorldEntityManually(state.chatKey, entityId, {
            state: patch as Record<string, unknown>,
          });
          await syncAfterManualChange();
          state.statusMessage = `已手动更新对象：${entity.name}`;
        } catch (editError) {
          error.value = editError instanceof Error ? editError.message : String(editError);
        }
      };
      const deleteEntity = async (entityId: string) => {
        const entity = state.world?.entities[entityId];
        if (!entity || !window.confirm(`确定删除世界演变对象“${entity.name}”？历史事件不会删除。`)) return;
        try {
          state.world = await deleteWorldEntityManually(state.chatKey, entityId);
          await syncAfterManualChange();
          state.statusMessage = `已删除对象：${entity.name}`;
        } catch (deleteError) {
          error.value = deleteError instanceof Error ? deleteError.message : String(deleteError);
        }
      };
      const backup = async () => {
        const text = await exportWorld(state.chatKey);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `world-evolution-${state.chatKey}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
      };
      const restore = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            await importWorld(state.chatKey, await file.text());
            state.statusMessage = '备份已导入';
          } catch (restoreError) {
            error.value = restoreError instanceof Error ? restoreError.message : String(restoreError);
          }
        };
        input.click();
      };
      return () =>
        h(
          'div',
          { class: 'we-panel' },
          [
            h('div', { class: 'we-head' }, [
              h('div', { class: 'we-title' }, '世界演变 · 独立插件'),
              h('button', { class: 'we-close', onClick: () => (visible.value = !visible.value) }, visible.value ? '收起' : '展开'),
            ]),
            visible.value
              ? h('div', { class: 'we-body' }, [
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '插件启用'),
                    h('input', {
                      class: 'we-check',
                      type: 'checkbox',
                      checked: state.settings.enabled,
                      onChange: (event: Event) => (state.settings.enabled = (event.target as HTMLInputElement).checked),
                    }),
                    h('span', { class: 'we-muted' }, '关闭时不监听、不运行、不修改世界书'),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '自动触发'),
                    h('input', {
                      class: 'we-check',
                      type: 'checkbox',
                      checked: state.settings.autoRun,
                      onChange: (event: Event) => (state.settings.autoRun = (event.target as HTMLInputElement).checked),
                    }),
                    h('span', { class: 'we-muted' }, '需同时启用插件'),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '每轮最多 NPC'),
                    h('input', {
                      class: 'we-input',
                      type: 'number',
                      min: 0,
                      max: 50,
                      value: state.settings.maxNpcPerRun,
                      onInput: (event: Event) => (state.settings.maxNpcPerRun = Number((event.target as HTMLInputElement).value)),
                    }),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '每轮最多其他对象'),
                    h('input', {
                      class: 'we-input',
                      type: 'number',
                      min: 0,
                      max: 50,
                      value: state.settings.maxOtherEntitiesPerRun,
                      onInput: (event: Event) =>
                        (state.settings.maxOtherEntitiesPerRun = Number((event.target as HTMLInputElement).value)),
                    }),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '失败重试次数'),
                    h('input', {
                      class: 'we-input',
                      type: 'number',
                      min: 0,
                      max: 10,
                      value: state.settings.maxRetries,
                      onInput: (event: Event) =>
                        (state.settings.maxRetries = Number((event.target as HTMLInputElement).value)),
                    }),
                    h('label', { class: 'we-label' }, '重试间隔 ms'),
                    h('input', {
                      class: 'we-input',
                      type: 'number',
                      min: 0,
                      max: 60000,
                      value: state.settings.retryDelayMs,
                      onInput: (event: Event) =>
                        (state.settings.retryDelayMs = Number((event.target as HTMLInputElement).value)),
                    }),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '楼层稳定轮询 ms'),
                    h('input', {
                      class: 'we-input',
                      type: 'number',
                      min: 0,
                      max: 60000,
                      value: state.settings.stablePollMs,
                      onInput: (event: Event) =>
                        (state.settings.stablePollMs = Number((event.target as HTMLInputElement).value)),
                    }),
                    h('label', { class: 'we-label' }, '连续稳定次数'),
                    h('input', {
                      class: 'we-input',
                      type: 'number',
                      min: 1,
                      max: 10,
                      value: state.settings.stableSamples,
                      onInput: (event: Event) =>
                        (state.settings.stableSamples = Number((event.target as HTMLInputElement).value)),
                    }),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '世界书名称'),
                    h('input', {
                      class: 'we-input',
                      value: state.settings.worldbookName,
                      placeholder: '可留空，暂不同步世界书',
                      onInput: (event: Event) => (state.settings.worldbookName = (event.target as HTMLInputElement).value),
                    }),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '手动候选 NPC'),
                    h('input', {
                      class: 'we-input',
                      value: state.settings.manualCandidates.join('、'),
                      placeholder: '角色甲、角色乙',
                      onInput: (event: Event) =>
                        (state.settings.manualCandidates = (event.target as HTMLInputElement).value
                          .split(/[、,，]/)
                          .map(value => value.trim())
                          .filter(Boolean)),
                    }),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('label', { class: 'we-label' }, '自动同步世界书'),
                    h('input', {
                      class: 'we-check',
                      type: 'checkbox',
                      checked: state.settings.worldbookAutoSync,
                      onChange: (event: Event) =>
                        (state.settings.worldbookAutoSync = (event.target as HTMLInputElement).checked),
                    }),
                  ]),
                  h('div', { class: 'we-row' }, [
                    h('button', { class: 'we-btn', onClick: save }, '保存设置'),
                    h(
                      'button',
                      {
                        class: 'we-btn',
                        disabled: state.running || !state.settings.enabled,
                        onClick: run,
                      },
                      state.running ? '运行中…' : '手动运行一轮',
                    ),
                    h(
                      'button',
                      {
                        class: 'we-btn',
                        disabled: state.running || failedMessageId() == null || !state.settings.enabled,
                        onClick: retryFailed,
                      },
                      '重试最近失败楼层',
                    ),
                    h('button', { class: 'we-btn', onClick: backup }, '导出'),
                    h('button', { class: 'we-btn', onClick: restore }, '导入'),
                  ]),
                  h('div', { class: 'we-muted' }, `聊天：${state.chatKey}`),
                  h('div', { class: 'we-muted' }, `状态：${state.status} · ${state.statusMessage}`),
                  error.value ? h('div', { class: 'we-danger' }, error.value) : null,
                  h('div', { class: 'we-section' }, [
                    h('div', { class: 'we-section-title' }, '对象库'),
                    h('div', { class: 'we-row' }, [
                      h('input', {
                        class: 'we-input',
                        value: state.objectFilter,
                        placeholder: '搜索名称或状态',
                        onInput: (event: Event) =>
                          (state.objectFilter = (event.target as HTMLInputElement).value),
                      }),
                      h(
                        'select',
                        {
                          class: 'we-select',
                          value: state.objectType,
                          onChange: (event: Event) =>
                            (state.objectType = (event.target as HTMLSelectElement).value as typeof state.objectType),
                        },
                        [
                          ['all', '全部类型'],
                          ['npc', 'NPC'],
                          ['organization', '组织'],
                          ['location', '地点'],
                          ['environment', '环境'],
                          ['social', '社会'],
                        ].map(([value, label]) => h('option', { value }, label)),
                      ),
                    ]),
                    h(
                      'div',
                      { class: 'we-list' },
                      filteredEntities().length
                        ? filteredEntities().map(entity =>
                            h('div', { class: 'we-card', key: entity.id }, [
                              h('div', undefined, [
                                h('div', { class: 'we-card-title' }, entity.name),
                                h(
                                  'div',
                                  { class: 'we-card-meta' },
                                  `${entity.type} · ${entity.visibility} · 楼层 ${entity.sourceMessageId ?? '未知'}`,
                                ),
                                h('div', { class: 'we-card-state' }, JSON.stringify(entity.state, null, 2)),
                              ]),
                              h('div', { class: 'we-card-actions' }, [
                                h(
                                  'button',
                                  { class: 'we-btn we-small', onClick: () => void editEntity(entity.id) },
                                  '编辑',
                                ),
                                h(
                                  'button',
                                  { class: 'we-btn we-small', onClick: () => void deleteEntity(entity.id) },
                                  '删除',
                                ),
                              ]),
                            ]),
                          )
                        : [h('div', { class: 'we-muted' }, '暂无符合条件的对象')],
                    ),
                  ]),
                  h('div', { class: 'we-section' }, [
                    h('div', { class: 'we-section-title' }, '事件与待办计划'),
                    h(
                      'pre',
                      { class: 'we-status' },
                      state.world
                        ? JSON.stringify(
                            {
                              events: state.world.events.slice(-10),
                              scheduledEvents: state.world.scheduledEvents
                                .filter(event => event.status === 'pending')
                                .slice(-10),
                            },
                            null,
                            2,
                          )
                        : '读取中…',
                    ),
                  ]),
                  h('div', { class: 'we-muted' }, '最近楼层运行记录'),
                  h(
                    'pre',
                    { class: 'we-status' },
                    state.world
                      ? JSON.stringify(
                          state.world.runRecords.slice(-10).map(record => ({
                            messageId: record.messageId,
                            status: record.status,
                            attempt: record.attempt,
                            candidates: record.candidateNames,
                            changed: record.changedEntityIds,
                            events: record.eventIds,
                            error: record.error,
                          })),
                          null,
                          2,
                        )
                      : '读取中…',
                  ),
                  h('pre', { class: 'we-status' }, resultText()),
                ])
              : null,
          ],
        );
    },
  };

  root = createScriptIdDiv().appendTo('body');
  root.append('<div id="world-evolution-mount"></div>');
  styleDestroy = teleportStyle().destroy;
  const style = $('<style data-world-evolution-style>').text(css).appendTo('head');
  app = createApp(Panel);
  app.mount(root.find('#world-evolution-mount')[0]);
  stopChatChangeListener = eventOn(tavern_events.CHAT_CHANGED, () => {
    state.chatKey = getCurrentChatKey();
    state.settings = loadSettings();
    void refreshWorld();
  });
  $(window).on('pagehide.world-evolution', () => {
    stopChatChangeListener?.stop();
    stopChatChangeListener = undefined;
    setWorldEvolutionStatusListener(undefined);
    app?.unmount();
    app = null;
    style.remove();
    styleDestroy?.();
    styleDestroy = null;
    root?.remove();
    root = null;
  });
}

export function openWorldEvolutionPanel(): void {
  mountPanel();
}
