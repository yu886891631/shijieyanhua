import { createApp, h, reactive, ref } from 'vue';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import {
  runWorldEvolution,
  setWorldEvolutionStatusListener,
  type WorldEvolutionRunResult,
} from './engine';
import { loadSettings, saveSettings, exportWorld, importWorld } from './store';

let app: ReturnType<typeof createApp> | null = null;
let root: JQuery<HTMLDivElement> | null = null;
let styleDestroy: (() => void) | null = null;
let stopChatChangeListener: EventOnReturn | undefined;

const css = `
.we-panel{position:fixed;right:16px;bottom:16px;z-index:10080;width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;box-shadow:0 12px 36px #0008;font:13px/1.45 system-ui,sans-serif}
.we-panel *{box-sizing:border-box}.we-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #374151}.we-title{font-weight:700}.we-close,.we-btn{border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;border-radius:7px;padding:6px 10px;cursor:pointer}.we-btn:hover,.we-close:hover{background:#374151}.we-body{padding:14px;display:grid;gap:10px}.we-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.we-label{color:#9ca3af;min-width:130px}.we-input{flex:1;min-width:150px;background:#0b1220;color:#f3f4f6;border:1px solid #4b5563;border-radius:6px;padding:6px 8px}.we-status{white-space:pre-wrap;background:#0b1220;border:1px solid #374151;border-radius:7px;padding:8px;max-height:180px;overflow:auto}.we-danger{color:#fca5a5}.we-ok{color:#86efac}.we-muted{color:#9ca3af;font-size:12px}.we-check{accent-color:#38bdf8}
`;

function mountPanel(): void {
  if (root?.length) return;
  const state = reactive({
    settings: loadSettings(),
    status: 'idle',
    statusMessage: '等待触发',
    running: false,
    lastResult: null as WorldEvolutionRunResult | null,
    chatKey: getCurrentChatKey(),
  });

  setWorldEvolutionStatusListener(update => {
    state.status = update.status;
    state.statusMessage = update.message;
    state.lastResult = update.result ?? state.lastResult;
    state.running = ['collecting', 'generating', 'committing', 'syncing'].includes(update.status);
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
      const save = () => {
        saveSettings(state.settings);
        state.statusMessage = '设置已保存';
      };
      const run = async () => {
        error.value = '';
        saveSettings(state.settings);
        const result = await runWorldEvolution(undefined, { source: 'manual' });
        state.lastResult = result;
        if (result.error) error.value = result.error;
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
                    h('button', { class: 'we-btn', onClick: backup }, '导出'),
                    h('button', { class: 'we-btn', onClick: restore }, '导入'),
                  ]),
                  h('div', { class: 'we-muted' }, `聊天：${state.chatKey}`),
                  h('div', { class: 'we-muted' }, `状态：${state.status} · ${state.statusMessage}`),
                  error.value ? h('div', { class: 'we-danger' }, error.value) : null,
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
