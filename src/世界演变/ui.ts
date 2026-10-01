import { createApp, h, reactive, ref, toRaw } from 'vue';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import { runWorldEvolution, setWorldEvolutionStatusListener, type WorldEvolutionRunResult } from './engine';
import { loadSettings, saveSettings } from './store';
import { loadWorldEvolutionApiConfiguration } from './api-config';
import {
  getWorldEvolutionApiRouteCardSummary,
  getWorldEvolutionWorkflowAssistantBridge,
  type WorldEvolutionApiRouteSource,
} from './api-routing';
import {
  inspectWorldEvolutionWorldbook,
  rebuildWorldEvolutionWorldbook,
  resolveCurrentCharacterWorldbookName,
  syncWorldEvolutionWorldbook,
} from './worldbook';
import { WORLD_EVOLUTION_VERSION } from './types';
import { dbSnapshotToWorld } from '../世界演变数据库/adapter';
import {
  createDbCheckpoint,
  deleteDbRowManually,
  exportDbSnapshot,
  importDbSnapshot,
  loadDbSnapshot,
  rollbackDbToCheckpoint,
  updateDbWorldbookSyncState,
  updateDbRowManually,
  loadWorldbookProjectionLedger,
} from '../世界演变数据库/store';
import type { WorldEvolutionDbWorldbookProjection } from '../世界演变数据库/types';
import type { WorldEvolutionWorldbookInspection } from './worldbook';

let app: ReturnType<typeof createApp> | null = null;
let root: JQuery<HTMLDivElement> | null = null;
let styleDestroy: (() => void) | null = null;
let stopChatChangeListener: EventOnReturn | undefined;
let refreshApiStatusForPanel: (() => void) | undefined;

const css = `
.we-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 10080;
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: var(--we-bg, #111827);
  color: var(--we-text, #e5e7eb);
  border: 1px solid var(--we-border, #374151);
  border-radius: 12px;
  box-shadow: 0 12px 36px rgb(0 0 0 / 24%);
  font: 13px/1.45 system-ui, sans-serif;
}
.we-panel-embedded {
  position: relative;
  inset: auto;
  z-index: auto;
  width: 100%;
  min-width: 0;
  max-height: none;
  overflow: visible;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  font: inherit;
  container: we-panel / inline-size;
}
.we-panel-embedded .we-head { display: none; }
.we-panel-embedded .we-body { padding: 0; }
.we-panel * { box-sizing: border-box; }
.we-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--we-border, #374151);
}
.we-title { font-weight: 700; }
.we-close,
.we-btn {
  border: 1px solid var(--we-border, #4b5563);
  background: var(--we-surface-soft, #1f2937);
  color: var(--we-text, #e5e7eb);
  border-radius: 7px;
  padding: 6px 10px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.we-btn:hover:not(:disabled),
.we-close:hover {
  background: var(--we-info-bg, #374151);
  border-color: var(--we-info-border, #64748b);
  color: var(--we-info-text, #e5e7eb);
}
.we-btn:focus-visible,
.we-close:focus-visible,
.we-input:focus-visible,
.we-select:focus-visible {
  outline: none;
  box-shadow: var(--we-focus-ring, 0 0 0 3px rgb(138 172 129 / 30%));
}
.we-body { padding: 14px; display: grid; gap: 14px; min-width: 0; }
.we-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
.we-label { color: var(--we-muted, #9aa9b2); min-width: 130px; }
.we-input,
.we-select {
  border: 1px solid var(--we-border, #4b5563);
  background: var(--we-surface, #0b1220);
  color: var(--we-text, #f3f4f6);
  border-radius: 6px;
  padding: 6px 8px;
}
.we-input { flex: 1; min-width: 150px; }
.we-select { min-width: 0; }
.we-input::placeholder { color: var(--we-muted, #9aa9b2); opacity: 1; }
.we-status {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--we-surface-soft, #0b1220);
  color: var(--we-text, #e5e7eb);
  border: 1px solid var(--we-border, #374151);
  border-radius: 7px;
  padding: 8px;
  max-height: 180px;
  overflow: auto;
}
.we-danger { color: var(--we-danger-text, #fca5a5); }
.we-ok { color: var(--we-success-text, #86efac); }
.we-muted { color: var(--we-muted, #9aa9b2); font-size: 12px; }
.we-check { accent-color: var(--we-accent, #8aac81); }
.we-section {
  border: 1px solid var(--we-border, #334252);
  border-radius: 8px;
  padding: 12px;
  display: grid;
  gap: 9px;
  min-width: 0;
  background: var(--we-surface, #1b2635);
}
.we-section-title { font-weight: 600; color: var(--we-text, #e8edf0); }
.we-list { display: grid; gap: 6px; min-width: 0; }
.we-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  min-width: 0;
  background: var(--we-surface-soft, #202d3d);
  border: 1px solid var(--we-border, #334252);
  border-radius: 7px;
  padding: 8px;
}
.we-card-title { font-weight: 600; color: var(--we-text, #e8edf0); }
.we-card-meta { color: var(--we-muted, #9aa9b2); font-size: 12px; }
.we-card-state {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--we-text, #cbd5e1);
  font-size: 12px;
  max-height: 90px;
  overflow: auto;
}
.we-card-actions { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
.we-small { padding: 4px 7px; font-size: 12px; }
.we-btn-danger {
  border-color: var(--we-danger-action-border, #bd6875) !important;
  background: var(--we-danger-action-bg, #a33f53) !important;
  color: var(--we-danger-action-text, #fff5f5) !important;
}
.we-btn-danger:hover:not(:disabled) {
  border-color: var(--we-danger-action-hover-bg, #862f42) !important;
  background: var(--we-danger-action-hover-bg, #862f42) !important;
  color: var(--we-danger-action-text, #fff5f5) !important;
}
.we-btn-primary {
  border-color: var(--we-action-border, #8aac81);
  background: var(--we-action-bg, #73986a);
  color: var(--we-action-text, #142018);
}
.we-btn-primary:hover:not(:disabled) {
  border-color: var(--we-action-hover-bg, #8aac81);
  background: var(--we-action-hover-bg, #8aac81);
  color: var(--we-action-text, #142018);
}
.we-btn:disabled { cursor: not-allowed; opacity: 0.58; }
.we-api-status { gap: 12px; }
.we-api-status-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.we-api-status-heading .we-section-title { font-size: 15px; }
.we-api-status-badge {
  flex: none;
  padding: 4px 9px;
  border: 1px solid var(--we-border, #64748b);
  border-radius: 999px;
  color: var(--we-muted, #9aa9b2);
  font-size: 11px;
}
.we-api-status-badge.ready {
  border-color: var(--we-success-border, #3d6549);
  background: var(--we-success-bg, #20372a);
  color: var(--we-success-text, #a3d6a7);
}
.we-api-status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.we-api-status-item {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--we-border, #334252);
  border-radius: 8px;
  background: var(--we-surface-soft, #202d3d);
  color: var(--we-text, #e5e7eb);
}
.we-api-status-label { color: var(--we-muted, #9aa9b2); font-size: 11px; }
.we-api-status-value { overflow: hidden; color: inherit; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.we-api-status-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.we-run-settings { gap: 10px; }
.we-run-settings .we-section-title { font-size: 15px; }
.we-evolution-intro { margin-top: -5px; line-height: 1.5; }
.we-readiness-card {
  display: grid;
  gap: 7px;
  padding: 10px 11px;
  border: 1px solid var(--we-border, #64748b);
  border-radius: 8px;
  background: var(--we-info-bg, #263b37);
  color: var(--we-info-text, #b6dcc8);
}
.we-readiness-card.ready {
  border-color: var(--we-success-border, #3d6549);
  background: var(--we-success-bg, #20372a);
  color: var(--we-success-text, #a3d6a7);
}
.we-readiness-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.we-readiness-title { font-size: 15px; font-weight: 700; }
.we-readiness-details { line-height: 1.5; }
.we-readiness-next { font-size: 12px; }
.we-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.we-setting-group {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--we-border, #334252);
  border-radius: 8px;
  background: var(--we-surface-soft, #202d3d);
}
.we-setting-group-title { font-size: 13px; font-weight: 650; color: var(--we-text, #e8edf0); }
.we-setting-group-help { margin-top: -4px; line-height: 1.45; }
.we-setting-row { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(100px, 1fr); gap: 8px; align-items: center; min-width: 0; }
.we-setting-row .we-label { min-width: 0; }
.we-setting-row .we-input { width: 100%; min-width: 0; }
.we-setting-number { display: flex; align-items: center; gap: 6px; min-width: 0; }
.we-setting-number .we-input { flex: 1; }
.we-setting-unit { flex: none; color: var(--we-muted, #9aa9b2); font-size: 11px; }
.we-setting-toggle { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.we-setting-toggle .we-check { width: 16px; height: 16px; }
.we-setting-help { grid-column: 1 / -1; line-height: 1.4; }
.we-setting-candidates { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 2px; }
.we-setting-candidate {
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid var(--we-info-border, #466c60);
  border-radius: 999px;
  background: var(--we-info-bg, #263b37);
  color: var(--we-info-text, #b6dcc8);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.we-setting-group > .we-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(90px, 1fr); gap: 6px; align-items: center; }
.we-setting-group > .we-row .we-label { min-width: 0; }
.we-setting-group > .we-row .we-input { width: 100%; min-width: 0; }
.we-setting-group > .we-row .we-check { justify-self: start; }
.we-setting-group > .we-row > small,
.we-setting-group > .we-row > .we-setting-candidates { grid-column: 1 / -1; }
.we-setting-group-help { font-size: 11px; }
.we-setting-group > .we-row .we-input[readonly] { overflow: hidden; text-overflow: ellipsis; }
.we-settings-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
.we-settings-actions .we-muted,
.we-run-control-status .we-muted { margin-right: auto; }
.we-run-controls { gap: 8px; }
.we-run-control-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.we-run-warning {
  padding: 8px 10px;
  border: 1px solid var(--we-warning-border, #76613b);
  border-radius: 7px;
  background: var(--we-warning-bg, #3b311e);
  color: var(--we-warning-text, #f0cb82);
  line-height: 1.45;
}
.we-panel-embedded .we-section .we-run-warning.we-muted { color: var(--we-warning-text, #73520c) !important; }
.we-run-control-status { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.we-run-result { display: grid; gap: 9px; }
.we-run-result-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.we-run-result-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid var(--we-border, #334252);
  border-radius: 999px;
  background: var(--we-info-bg, #263b37);
  color: var(--we-info-text, #b6dcc8);
  font-size: 11px;
  white-space: nowrap;
}
.we-run-result-badge.success {
  border-color: var(--we-success-border, #3d6549);
  background: var(--we-success-bg, #20372a);
  color: var(--we-success-text, #a3d6a7);
}
.we-run-result-badge.failed {
  border-color: var(--we-danger-border, #7c4854);
  background: var(--we-danger-bg, #3e252d);
  color: var(--we-danger-text, #f2aab1);
}
.we-run-result-badge.skipped { border-color: var(--we-border, #334252); color: var(--we-muted, #9aa9b2); }
.we-run-result-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.we-run-result-item {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--we-border, #334252);
  border-radius: 7px;
  background: var(--we-surface-soft, #202d3d);
}
.we-run-result-item strong { overflow-wrap: anywhere; }
.we-run-result-details { line-height: 1.5; overflow-wrap: anywhere; }
.we-run-diagnostic { padding-top: 8px; border-top: 1px solid var(--we-border, #334252); }
.we-run-diagnostic summary { cursor: pointer; color: var(--we-accent-strong, #73986a); }
.we-run-diagnostic .we-status { margin-top: 7px; }
.we-run-no-result { padding: 12px; border: 1px dashed var(--we-border, #64748b); border-radius: 8px; line-height: 1.5; }
.we-settings-save-state { font-size: 12px; }
.we-settings-save-state.dirty { color: var(--we-warning-text, #f0cb82); }
.we-settings-save-state.saved { color: var(--we-success-text, #a3d6a7); }
@media (max-width: 760px) {
  .we-api-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .we-api-status-actions .we-btn { flex: 1 1 auto; }
  .we-run-settings .we-row { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
  .we-run-settings .we-label { min-width: 0; }
  .we-run-settings .we-input { width: 100%; min-width: 0; }
  .we-api-status-heading { display: grid; }
  .we-api-status-badge { justify-self: start; }
  .we-settings-grid { grid-template-columns: minmax(0, 1fr); }
  .we-run-result-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .we-readiness-heading,
  .we-run-result-heading { align-items: flex-start; flex-direction: column; }
}
@container we-panel (max-width: 760px) {
  .we-api-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .we-api-status-actions .we-btn { flex: 1 1 auto; }
  .we-run-settings .we-row { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
  .we-run-settings .we-label { min-width: 0; }
  .we-run-settings .we-input { width: 100%; min-width: 0; }
  .we-api-status-heading { display: grid; }
  .we-api-status-badge { justify-self: start; }
  .we-settings-grid { grid-template-columns: minmax(0, 1fr); }
  .we-run-result-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .we-readiness-heading,
  .we-run-result-heading { align-items: flex-start; flex-direction: column; }
}
@container we-panel (max-width: 480px) {
  .we-api-status-grid,
  .we-run-result-grid { grid-template-columns: minmax(0, 1fr); }
  .we-setting-group > .we-row { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .we-setting-group > .we-row > small,
  .we-setting-group > .we-row > .we-setting-candidates { grid-column: auto; }
  .we-card { grid-template-columns: minmax(0, 1fr); }
  .we-card-actions { justify-content: flex-start; }
  .we-card-actions .we-btn { flex: 1 1 auto; }
}
`;

export type WorldEvolutionPanelOptions = {
  onNavigateToApi?: () => void;
};

function mountPanel(target?: HTMLElement, options: WorldEvolutionPanelOptions = {}): void {
  if (root?.length) return;
  const embedded = target !== undefined;
  const state = reactive({
    settings: loadSettings(),
    status: 'idle',
    statusMessage: '等待触发',
    running: false,
    lastResult: null as WorldEvolutionRunResult | null,
    lastResultChatKey: getCurrentChatKey(),
    settingsDirty: false,
    settingsSaveMessage: '设置已加载',
    world: null as ReturnType<typeof dbSnapshotToWorld> | null,
    objectFilter: '',
    objectType: 'all' as 'all' | 'npc' | 'organization' | 'location' | 'environment' | 'social',
    chatKey: getCurrentChatKey(),
    currentWorldbookName: resolveCurrentCharacterWorldbookName() ?? '',
    projections: [] as WorldEvolutionDbWorldbookProjection[],
    projectionInspection: null as WorldEvolutionWorldbookInspection | null,
    projectionFilter: '',
    projectionBusy: false,
    apiRouteStatus: {
      ready: false,
      source: null as WorldEvolutionApiRouteSource | null,
      model: null as string | null,
      fallbackCount: 0,
      keyConfigured: null as boolean | null,
      message: '正在检查 API 路由…',
    },
  });

  const refreshWorld = async (): Promise<void> => {
    try {
      state.currentWorldbookName = resolveCurrentCharacterWorldbookName() ?? '';
      const snapshot = await loadDbSnapshot(state.chatKey);
      state.world = dbSnapshotToWorld(snapshot);
      if (state.currentWorldbookName) {
        const [projections, inspection] = await Promise.all([
          loadWorldbookProjectionLedger(state.chatKey, state.currentWorldbookName),
          inspectWorldEvolutionWorldbook(state.currentWorldbookName, toRaw(state.world)),
        ]);
        state.projections = projections;
        state.projectionInspection = inspection;
      } else {
        state.projections = [];
        state.projectionInspection = null;
      }
    } catch (error) {
      state.statusMessage = `读取世界演变记录失败：${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const syncAfterManualChange = async (): Promise<void> => {
    const settings = toRaw(state.settings);
    const worldbookName = resolveCurrentCharacterWorldbookName();
    state.currentWorldbookName = worldbookName ?? '';
    if (!settings.worldbookAutoSync || !worldbookName || !state.world) return;
    await updateDbWorldbookSyncState(state.chatKey, {
      status: 'pending',
      worldbookName,
      lastAttemptAt: Date.now(),
    });
    try {
      await syncWorldEvolutionWorldbook(worldbookName, toRaw(state.world));
      await updateDbWorldbookSyncState(state.chatKey, {
        status: 'synced',
        worldbookName,
        lastAttemptAt: Date.now(),
        lastSuccessAt: Date.now(),
      });
    } catch (error) {
      await updateDbWorldbookSyncState(state.chatKey, {
        status: 'failed',
        worldbookName,
        lastAttemptAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await refreshWorld();
  };

  void refreshWorld();

  setWorldEvolutionStatusListener(update => {
    state.status = update.status;
    state.statusMessage = update.message;
    state.running = ['waiting', 'collecting', 'generating', 'committing', 'syncing'].includes(update.status);
    void refreshWorld();
  });

  const Panel = {
    setup() {
      const visible = ref(embedded);
      const error = ref('');
      const refreshApiStatus = () => {
        try {
          const config = loadWorldEvolutionApiConfiguration({
            apiPresetName: state.settings.apiPresetName,
            apiFallbackPresetNames: state.settings.apiFallbackPresetNames,
          });
          const bridge = getWorldEvolutionWorkflowAssistantBridge();
          const routeSummary = getWorldEvolutionApiRouteCardSummary(config, bridge);
          state.apiRouteStatus = {
            ready: routeSummary.ready,
            source: routeSummary.source,
            model: routeSummary.model,
            fallbackCount: routeSummary.fallbackCount,
            keyConfigured: routeSummary.keyConfigured,
            message: routeSummary.ready
              ? '本地路由配置检查通过；这不是连通性测试，首次真实运行仍可能失败。'
              : routeSummary.source
                ? '检测到路由配置，但主路由尚不可用；请检查端点、模型和凭据。'
                : '未检测到可用 API 路由，请先完成配置。',
          };
        } catch (apiError) {
          console.warn('[世界演变] 检查 API 路由失败:', apiError);
          state.apiRouteStatus = {
            ready: false,
            source: null,
            model: null,
            fallbackCount: 0,
            keyConfigured: null,
            message: '读取 API 路由状态失败。请前往「演变配置 → API 配置」检查设置。',
          };
        }
      };
      refreshApiStatusForPanel = refreshApiStatus;
      refreshApiStatus();
      const apiReady = () => state.apiRouteStatus.ready;
      const markSettingsDirty = () => {
        state.settingsDirty = true;
        state.settingsSaveMessage = '有未保存的设置更改';
      };
      const persistSettings = () => {
        saveSettings(toRaw(state.settings));
        state.settingsDirty = false;
        state.settingsSaveMessage = '设置已保存';
        refreshApiStatus();
      };
      const readinessLabel = () => {
        if (!apiReady()) return 'API 路由需检查';
        if (!state.settings.enabled) return '插件已关闭';
        return state.settings.autoRun ? '自动触发已开启' : '仅手动运行';
      };
      const readinessDescription = () => {
        if (!apiReady()) return '本地路由配置未通过检查；请先到 API 配置页补全主路由。';
        if (!state.settings.enabled) return '插件关闭时不会监听或执行世界演变。启用设置后请保存。';
        if (state.settings.autoRun) {
          return '保存后，将在工作流成功完成并通过楼层稳定检查时自动排队；这不会立即发起请求。';
        }
        return '自动触发关闭；保存后仍可在下方手动运行。';
      };
      const nextReadinessAction = () => {
        if (state.settingsDirty) return '当前开关和参数尚未保存；自动触发仍使用上次保存的设置。';
        if (!apiReady()) return '下一步：前往 API 配置检查主路由。';
        if (!state.settings.enabled) return '下一步：启用插件并保存设置。';
        if (state.settings.autoRun) return '运行提示：自动运行由工作流完成事件触发，并等待楼层稳定。';
        return '下一步：可手动运行一轮，或开启自动触发并保存。';
      };
      const runDisabledReason = () => {
        if (state.running) return '已有一轮演变正在处理。';
        if (!state.settings.enabled) return '请先启用插件并保存设置。';
        if (!apiReady()) return '请先在 API 配置页完成路由配置检查。';
        return '';
      };
      const retryDisabledReason = () => {
        if (state.running) return '已有一轮演变正在处理。';
        if (!state.settings.enabled) return '请先启用插件并保存设置。';
        if (!apiReady()) return '请先在 API 配置页完成路由配置检查。';
        const messageId = failedMessageId();
        if (messageId == null || messageId < 0) return '当前聊天没有可重试的失败楼层。';
        return '';
      };
      const latestRunView = () => {
        if (state.lastResult && state.lastResultChatKey === state.chatKey) return state.lastResult;
        const record = state.world?.runRecords
          .slice()
          .sort(
            (left, right) =>
              (right.finishedAt ?? right.startedAt ?? right.enqueuedAt) -
              (left.finishedAt ?? left.startedAt ?? left.enqueuedAt),
          )[0];
        return record
          ? {
              status: record.status,
              messageId: record.messageId,
              reason: record.status === 'skipped' ? record.error : undefined,
              candidateNames: record.candidateNames,
              changedEntityIds: record.changedEntityIds,
              eventIds: record.eventIds,
              error: record.error,
            }
          : null;
      };
      const runStatusLabel = (result: NonNullable<ReturnType<typeof latestRunView>>) => {
        if (result.status === 'done') {
          if (result.error?.startsWith('世界书同步失败：')) return '数据库已提交，世界书同步失败';
          return result.changedEntityIds.length || result.eventIds.length ? '成功，有变更' : '成功，无变更';
        }
        return {
          idle: '尚未开始',
          waiting: '排队中',
          collecting: '整理上下文中',
          generating: '生成中',
          committing: '提交数据中',
          syncing: '同步世界书中',
          queued: '排队中',
          running: '演变处理中',
          skipped: '已跳过',
          failed: '运行失败',
          cancelled: '已取消',
        }[result.status];
      };
      const runResultTone = (result: NonNullable<ReturnType<typeof latestRunView>>) => {
        if (result.status === 'done') {
          return result.error?.startsWith('世界书同步失败：') ? 'failed' : 'success';
        }
        return result.status === 'failed' ? 'failed' : result.status === 'skipped' ? 'skipped' : '';
      };
      const runResultDescription = (result: NonNullable<ReturnType<typeof latestRunView>>) => {
        if (result.status === 'done' && result.error?.startsWith('世界书同步失败：')) {
          return '演变数据已经提交到数据库；只有世界书投影同步失败。可在「世界书投影」页检查并重试同步。';
        }
        if (result.status === 'done') {
          return result.changedEntityIds.length || result.eventIds.length
            ? '本轮演变已完成，变更已提交。'
            : '本轮已完成，但没有产生需要提交的变更。';
        }
        if (result.status === 'skipped') return result.reason || result.error || '本轮未执行演变。';
        if (result.status === 'failed') return result.error || result.reason || '本轮运行失败；可检查下方诊断信息。';
        return `当前记录状态：${runStatusLabel(result)}。`;
      };
      const resultText = () => {
        const result = latestRunView();
        if (!result) return '暂无运行记录';
        const rawResponse = 'rawResponse' in result ? result.rawResponse : undefined;
        return JSON.stringify(
          {
            status: result.status,
            messageId: result.messageId,
            candidates: result.candidateNames,
            changedEntityIds: result.changedEntityIds,
            eventIds: result.eventIds,
            reason: result.reason,
            error: result.error,
            rawResponse: rawResponse?.slice(0, 6000),
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
        persistSettings();
        state.statusMessage = '设置已保存';
      };
      const run = async () => {
        if (
          !window.confirm(
            '将保存当前设置并调用已配置的真实 API 处理当前楼层。请求可能产生费用；失败重试也可能增加请求次数。确定继续吗？',
          )
        )
          return;
        const runChatKey = state.chatKey;
        error.value = '';
        persistSettings();
        state.lastResult = null;
        state.lastResultChatKey = runChatKey;
        const result = await runWorldEvolution(undefined, { source: 'manual' });
        if (runChatKey === state.chatKey && runChatKey === getCurrentChatKey()) {
          state.lastResult = result;
          state.lastResultChatKey = runChatKey;
          if (result.error) error.value = result.error;
        }
        await refreshWorld();
      };
      const retryFailed = async () => {
        const messageId = failedMessageId();
        if (messageId == null || messageId < 0) return;
        if (
          !window.confirm(
            `将保存当前设置并再次调用真实 API 重试第 ${messageId} 楼。请求可能产生费用；失败重试也可能增加请求次数。确定继续吗？`,
          )
        )
          return;
        const runChatKey = state.chatKey;
        error.value = '';
        persistSettings();
        state.lastResult = null;
        state.lastResultChatKey = runChatKey;
        const result = await runWorldEvolution(messageId, { source: 'manual' });
        if (runChatKey === state.chatKey && runChatKey === getCurrentChatKey()) {
          state.lastResult = result;
          state.lastResultChatKey = runChatKey;
          if (result.error) error.value = result.error;
        }
        await refreshWorld();
      };
      const runActionButtons = () => [
        h(
          'button',
          {
            class: 'we-btn we-btn-primary',
            disabled: Boolean(runDisabledReason()),
            title: runDisabledReason(),
            onClick: run,
          },
          state.running ? '运行中…' : '手动运行一轮',
        ),
        h(
          'button',
          {
            class: 'we-btn',
            disabled: Boolean(retryDisabledReason()),
            title: retryDisabledReason(),
            onClick: retryFailed,
          },
          '重试最近失败楼层',
        ),
      ];
      const runActionStatus = () => {
        const runReason = runDisabledReason();
        if (runReason) return runReason;
        const retryReason = retryDisabledReason();
        return retryReason || '可手动运行；自动触发仍需等待工作流完成并通过楼层稳定检查。';
      };
      const renderRunResult = () => {
        const result = latestRunView();
        if (!result) {
          return h(
            'div',
            { class: 'we-run-no-result we-muted' },
            state.world ? '当前聊天还没有运行记录。' : '正在读取当前聊天的运行记录…',
          );
        }
        const rawResponse = 'rawResponse' in result ? result.rawResponse : undefined;
        const attempt = 'attempt' in result ? result.attempt : undefined;
        const source = 'source' in result ? result.source : undefined;
        const diagnosticText = resultText();
        return h('div', { class: 'we-run-result' }, [
          h('div', { class: 'we-run-result-heading' }, [
            h('strong', { class: 'we-section-title' }, '最近运行结果'),
            h('span', { class: ['we-run-result-badge', runResultTone(result)] }, runStatusLabel(result)),
          ]),
          h('div', { class: 'we-run-result-grid' }, [
            h('div', { class: 'we-run-result-item' }, [
              h('span', { class: 'we-muted' }, '处理楼层'),
              h('strong', undefined, result.messageId >= 0 ? `第 ${result.messageId} 楼` : '未指定'),
            ]),
            h('div', { class: 'we-run-result-item' }, [
              h('span', { class: 'we-muted' }, '候选角色'),
              h('strong', undefined, result.candidateNames.length ? result.candidateNames.join('、') : '无'),
            ]),
            h('div', { class: 'we-run-result-item' }, [
              h('span', { class: 'we-muted' }, '写入内容'),
              h('strong', undefined, `${result.changedEntityIds.length} 个对象 · ${result.eventIds.length} 条事件`),
            ]),
          ]),
          h('div', { class: 'we-run-result-details' }, runResultDescription(result)),
          result.error || result.reason
            ? h('div', { class: result.status === 'done' ? 'we-muted' : 'we-danger' }, result.error || result.reason)
            : null,
          source || attempt !== undefined
            ? h(
                'div',
                { class: 'we-muted' },
                [
                  source
                    ? `来源：${source === 'auto' ? '自动触发' : source === 'retry' ? '失败重试' : '手动运行'}`
                    : '',
                  attempt !== undefined ? `第 ${attempt} 次尝试` : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
              )
            : null,
          h('details', { class: 'we-run-diagnostic' }, [
            h('summary', undefined, '展开原始诊断信息'),
            h('pre', { class: 'we-status' }, diagnosticText),
            rawResponse ? h('div', { class: 'we-muted' }, 'AI 原始响应已包含在上方诊断 JSON 中。') : null,
          ]),
        ]);
      };
      const routeSourceLabel = () =>
        state.apiRouteStatus.source === 'builtin'
          ? '内置 API'
          : state.apiRouteStatus.source === 'workflow-assistant'
            ? '工作流助手桥接'
            : '未配置';
      const routeKeyStatus = () =>
        state.apiRouteStatus.keyConfigured == null
          ? '状态不可用'
          : state.apiRouteStatus.keyConfigured
            ? '已配置'
            : '未配置';
      const routeMetric = (label: string, value: string) =>
        h('div', { class: 'we-api-status-item' }, [
          h('span', { class: 'we-api-status-label' }, label),
          h('strong', { class: 'we-api-status-value', title: value }, value),
        ]);
      const projectionCounts = () => {
        const inspection = state.projectionInspection;
        return {
          total: inspection?.projectionCount ?? state.projections.length,
          synced: state.projections.filter(item => item.status === 'synced').length,
          pending: state.projections.filter(item => item.status === 'pending').length,
          failed: state.projections.filter(item => item.status === 'failed').length,
          orphaned: inspection?.orphanCount ?? state.projections.filter(item => item.status === 'orphaned').length,
          missing: inspection?.missingCount ?? 0,
          drift: inspection?.driftCount ?? 0,
        };
      };
      const filteredProjections = () => {
        const query = state.projectionFilter.trim().toLowerCase();
        return state.projections
          .filter(
            projection =>
              !query ||
              `${projection.table} ${projection.rowId} ${projection.projectionKey} ${projection.status}`
                .toLowerCase()
                .includes(query),
          )
          .sort((left, right) => right.updatedAt - left.updatedAt);
      };
      const syncProjection = async (mode: 'reconcile' | 'rebuild', label: string): Promise<void> => {
        if (state.projectionBusy) return;
        const worldbookName = resolveCurrentCharacterWorldbookName();
        state.currentWorldbookName = worldbookName ?? '';
        if (!worldbookName) {
          error.value = '当前角色卡未绑定主世界书，无法执行世界书投影操作';
          return;
        }
        const world = state.world ? toRaw(state.world) : dbSnapshotToWorld(await loadDbSnapshot(state.chatKey));
        state.projectionBusy = true;
        error.value = '';
        const now = Date.now();
        try {
          await updateDbWorldbookSyncState(state.chatKey, {
            status: 'pending',
            worldbookName,
            lastAttemptAt: now,
          });
          if (mode === 'rebuild') {
            await rebuildWorldEvolutionWorldbook(worldbookName, world);
          } else {
            await syncWorldEvolutionWorldbook(worldbookName, world);
          }
          await updateDbWorldbookSyncState(state.chatKey, {
            status: 'synced',
            worldbookName,
            lastAttemptAt: now,
            lastSuccessAt: Date.now(),
          });
          state.statusMessage = `${label}完成`;
        } catch (syncError) {
          const message = syncError instanceof Error ? syncError.message : String(syncError);
          error.value = message;
          await updateDbWorldbookSyncState(state.chatKey, {
            status: 'failed',
            worldbookName,
            lastAttemptAt: now,
            error: message,
          }).catch(recordError => console.warn('[世界演变] 记录投影失败状态失败:', recordError));
        } finally {
          state.projectionBusy = false;
          await refreshWorld();
        }
      };
      const retryWorldbook = async () => {
        await syncProjection('reconcile', '世界书同步重试');
      };
      const rebuildProjection = async () => {
        if (
          !state.currentWorldbookName ||
          !window.confirm(`完整重建当前角色卡主世界书“${state.currentWorldbookName}”中的世界演变条目？`)
        )
          return;
        await syncProjection('rebuild', '世界书完整重建');
      };
      const cleanProjectionOrphans = async () => {
        await syncProjection('reconcile', '世界书孤儿清理');
      };
      const createCheckpoint = async () => {
        try {
          const snapshot = await loadDbSnapshot(state.chatKey);
          await createDbCheckpoint(state.chatKey, {
            messageId: snapshot.meta.lastMessageId ?? -1,
            messageFingerprint: snapshot.meta.lastMessageFingerprint,
            reason: 'manual',
          });
          await refreshWorld();
          state.statusMessage = '已创建世界演变 checkpoint';
        } catch (checkpointError) {
          error.value = checkpointError instanceof Error ? checkpointError.message : String(checkpointError);
        }
      };
      const rollbackLatestCheckpoint = async () => {
        const checkpoint = state.world?.checkpoints.at(-1);
        if (!checkpoint || !window.confirm(`回滚到 checkpoint ${checkpoint.id}？这会恢复对象、事件和待办计划。`))
          return;
        try {
          state.world = dbSnapshotToWorld(await rollbackDbToCheckpoint(state.chatKey, checkpoint.id));
          await syncAfterManualChange();
          state.statusMessage = `已回滚到 checkpoint：${checkpoint.id}`;
        } catch (rollbackError) {
          error.value = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        }
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
          const entity = state.world?.entities[entityId];
          if (!entity) throw new Error(`对象不存在：${entityId}`);
          state.world = dbSnapshotToWorld(
            await updateDbRowManually(state.chatKey, entity.type === 'social' ? 'society' : entity.type, entityId, {
              data: patch as Record<string, unknown>,
            }),
          );
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
          const entityType = state.world?.entities[entityId]?.type;
          if (!entityType) throw new Error(`对象不存在：${entityId}`);
          state.world = dbSnapshotToWorld(
            await deleteDbRowManually(state.chatKey, entityType === 'social' ? 'society' : entityType, entityId),
          );
          await syncAfterManualChange();
          state.statusMessage = `已删除对象：${entity.name}`;
        } catch (deleteError) {
          error.value = deleteError instanceof Error ? deleteError.message : String(deleteError);
        }
      };
      const backup = async () => {
        const text = await exportDbSnapshot(state.chatKey);
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
            await importDbSnapshot(state.chatKey, await file.text());
            await refreshWorld();
            state.statusMessage = '备份已导入';
          } catch (restoreError) {
            error.value = restoreError instanceof Error ? restoreError.message : String(restoreError);
          }
        };
        input.click();
      };
      return () =>
        h('div', { class: ['we-panel', embedded ? 'we-panel-embedded' : ''] }, [
          embedded
            ? null
            : h('div', { class: 'we-head' }, [
                h('div', { class: 'we-title' }, `世界演变 · 独立插件 ${WORLD_EVOLUTION_VERSION}`),
                h(
                  'button',
                  { class: 'we-close', onClick: () => (visible.value = !visible.value) },
                  visible.value ? '收起' : '展开',
                ),
              ]),
          visible.value
            ? h('div', { class: 'we-body' }, [
                h('div', { class: ['we-section', 'we-api-status', 'we-before-run'] }, [
                  h('div', { class: 'we-api-status-heading' }, [
                    h('div', undefined, [
                      h('div', { class: 'we-section-title' }, '运行前检查'),
                      h(
                        'div',
                        { class: 'we-muted we-evolution-intro' },
                        '此处只读取本地路由配置，不发起测试请求；路由配置可用不代表网络连通或凭据已验证。',
                      ),
                    ]),
                    h(
                      'span',
                      { class: ['we-api-status-badge', apiReady() ? 'ready' : ''] },
                      apiReady() ? '配置检查通过' : '需要检查配置',
                    ),
                  ]),
                  h('div', { class: 'we-api-status-grid' }, [
                    routeMetric('当前来源', routeSourceLabel()),
                    routeMetric('主模型', state.apiRouteStatus.model || '未配置'),
                    routeMetric('备用路由', `${state.apiRouteStatus.fallbackCount} 个`),
                    routeMetric('API Key', routeKeyStatus()),
                  ]),
                  h('div', { class: apiReady() ? 'we-ok' : 'we-danger' }, state.apiRouteStatus.message),
                  h('div', { class: ['we-readiness-card', state.settings.enabled && apiReady() ? 'ready' : ''] }, [
                    h('div', { class: 'we-readiness-heading' }, [
                      h('strong', { class: 'we-readiness-title' }, `运行状态：${readinessLabel()}`),
                      h(
                        'span',
                        { class: state.settings.enabled && apiReady() ? 'we-ok' : 'we-muted' },
                        state.settings.autoRun && state.settings.enabled && apiReady()
                          ? '等待工作流触发'
                          : '不会自动发起请求',
                      ),
                    ]),
                    h('div', { class: 'we-muted we-readiness-details' }, readinessDescription()),
                    h(
                      'div',
                      { class: ['we-readiness-next', state.settingsDirty ? 'we-danger' : 'we-muted'] },
                      nextReadinessAction(),
                    ),
                  ]),
                  h('div', { class: 'we-api-status-actions' }, [
                    ...(embedded && options.onNavigateToApi
                      ? [h('button', { class: 'we-btn', onClick: options.onNavigateToApi }, '前往 API 配置')]
                      : []),
                    h('button', { class: 'we-btn', onClick: refreshApiStatus }, '刷新状态'),
                  ]),
                ]),
                h('div', { class: 'we-section we-run-settings' }, [
                  h('div', { class: 'we-section-title' }, '运行设置'),
                  h(
                    'div',
                    { class: 'we-muted we-evolution-intro' },
                    '修改后点底部“保存设置”才会用于自动触发；手动运行会先保存当前值再调用 API。',
                  ),
                  h('div', { class: 'we-settings-grid' }, [
                    h('div', { class: 'we-setting-group' }, [
                      h('div', { class: 'we-setting-group-title' }, '运行开关'),
                      h(
                        'div',
                        { class: 'we-muted we-setting-group-help' },
                        '自动触发要求插件启用，并在工作流成功完成后等待楼层稳定。',
                      ),
                      h('div', { class: 'we-row' }, [
                        h('label', { class: 'we-label' }, '插件启用'),
                        h('input', {
                          class: 'we-check',
                          type: 'checkbox',
                          checked: state.settings.enabled,
                          disabled: !apiReady() && !state.settings.enabled,
                          onChange: (event: Event) => {
                            state.settings.enabled = (event.target as HTMLInputElement).checked;
                            markSettingsDirty();
                          },
                        }),
                        h('span', { class: 'we-muted' }, '关闭时不监听、不运行、不修改世界书'),
                      ]),
                      h('div', { class: 'we-row' }, [
                        h('label', { class: 'we-label' }, '自动触发'),
                        h('input', {
                          class: 'we-check',
                          type: 'checkbox',
                          checked: state.settings.autoRun,
                          disabled: !apiReady() && !state.settings.autoRun,
                          onChange: (event: Event) => {
                            state.settings.autoRun = (event.target as HTMLInputElement).checked;
                            markSettingsDirty();
                          },
                        }),
                        h('span', { class: 'we-muted' }, '自动触发需同时启用插件'),
                      ]),
                    ]),
                    h('div', { class: 'we-setting-group' }, [
                      h('div', { class: 'we-setting-group-title' }, '本轮处理规模'),
                      h(
                        'div',
                        { class: 'we-muted we-setting-group-help' },
                        '上限范围 0–50；设为 0 可关闭该类对象的本轮处理。',
                      ),
                      h('div', { class: 'we-row' }, [
                        h('label', { class: 'we-label' }, '每轮最多 NPC'),
                        h('input', {
                          class: 'we-input',
                          type: 'number',
                          min: 0,
                          max: 50,
                          value: state.settings.maxNpcPerRun,
                          onInput: (event: Event) => {
                            state.settings.maxNpcPerRun = Number((event.target as HTMLInputElement).value);
                            markSettingsDirty();
                          },
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
                          onInput: (event: Event) => {
                            state.settings.maxOtherEntitiesPerRun = Number((event.target as HTMLInputElement).value);
                            markSettingsDirty();
                          },
                        }),
                      ]),
                      h('div', { class: 'we-row' }, [
                        h('label', { class: 'we-label' }, '手动候选 NPC'),
                        h('input', {
                          class: 'we-input',
                          value: state.settings.manualCandidates.join('、'),
                          placeholder: '角色甲、角色乙',
                          onInput: (event: Event) => {
                            state.settings.manualCandidates = (event.target as HTMLInputElement).value
                              .split(/[、,，]/)
                              .map(value => value.trim())
                              .filter(Boolean);
                            markSettingsDirty();
                          },
                        }),
                        state.settings.manualCandidates.length
                          ? h(
                              'div',
                              { class: 'we-setting-candidates' },
                              state.settings.manualCandidates.map((name, index) =>
                                h('span', { class: 'we-setting-candidate', key: `${name}-${index}` }, name),
                              ),
                            )
                          : h('small', { class: 'we-muted' }, '未指定手动候选 NPC。'),
                        h(
                          'small',
                          { class: 'we-muted' },
                          '填写角色全名，多个名称用顿号或逗号分隔；名称会被用于候选筛选，不保证每轮都入选。',
                        ),
                      ]),
                    ]),
                    h('div', { class: 'we-setting-group' }, [
                      h('div', { class: 'we-setting-group-title' }, '楼层稳定与失败重试'),
                      h(
                        'div',
                        { class: 'we-muted we-setting-group-help' },
                        '稳定轮询用于等待楼层内容停止变化；每次自动失败重试都会再次请求 API，可能产生额外费用。',
                      ),
                      h('div', { class: 'we-row' }, [
                        h('label', { class: 'we-label' }, '失败重试次数'),
                        h('input', {
                          class: 'we-input',
                          type: 'number',
                          min: 0,
                          max: 10,
                          value: state.settings.maxRetries,
                          onInput: (event: Event) => {
                            state.settings.maxRetries = Number((event.target as HTMLInputElement).value);
                            markSettingsDirty();
                          },
                        }),
                        h('label', { class: 'we-label' }, '重试间隔'),
                        h('input', {
                          class: 'we-input',
                          type: 'number',
                          min: 0,
                          max: 60000,
                          value: state.settings.retryDelayMs,
                          onInput: (event: Event) => {
                            state.settings.retryDelayMs = Number((event.target as HTMLInputElement).value);
                            markSettingsDirty();
                          },
                          title: '单位：毫秒',
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
                          onInput: (event: Event) => {
                            state.settings.stablePollMs = Number((event.target as HTMLInputElement).value);
                            markSettingsDirty();
                          },
                        }),
                        h('label', { class: 'we-label' }, '连续稳定次数'),
                        h('input', {
                          class: 'we-input',
                          type: 'number',
                          min: 1,
                          max: 10,
                          value: state.settings.stableSamples,
                          onInput: (event: Event) => {
                            state.settings.stableSamples = Number((event.target as HTMLInputElement).value);
                            markSettingsDirty();
                          },
                        }),
                      ]),
                    ]),
                    h('div', { class: 'we-setting-group' }, [
                      h('div', { class: 'we-setting-group-title' }, '世界书同步'),
                      h(
                        'div',
                        { class: 'we-muted we-setting-group-help' },
                        '只将已提交的演变数据投影到当前角色卡 primary；同步失败不会撤销数据库提交。',
                      ),
                      h('div', { class: 'we-row' }, [
                        h('label', { class: 'we-label' }, '当前角色卡主世界书'),
                        h('input', {
                          class: 'we-input',
                          value: state.currentWorldbookName || '当前角色卡未绑定主世界书',
                          readOnly: true,
                          title: '目标由当前角色卡 primary 自动解析，不使用手动填写的书名',
                        }),
                      ]),
                      h('div', { class: 'we-row' }, [
                        h('label', { class: 'we-label' }, '自动同步世界书'),
                        h('input', {
                          class: 'we-check',
                          type: 'checkbox',
                          checked: state.settings.worldbookAutoSync,
                          onChange: (event: Event) => {
                            state.settings.worldbookAutoSync = (event.target as HTMLInputElement).checked;
                            markSettingsDirty();
                          },
                        }),
                      ]),
                      !state.currentWorldbookName
                        ? h(
                            'small',
                            { class: 'we-danger' },
                            '当前角色卡未绑定 primary 世界书；即使开启自动同步也无法写入投影。',
                          )
                        : null,
                    ]),
                  ]),
                ]),
                h('div', { class: 'we-settings-actions' }, [
                  h('button', { class: 'we-btn', onClick: save }, '保存设置'),
                  h(
                    'span',
                    { class: ['we-settings-save-state', state.settingsDirty ? 'dirty' : 'saved'] },
                    state.settingsSaveMessage,
                  ),
                  ...(embedded
                    ? []
                    : [
                        h('button', { class: 'we-btn', onClick: createCheckpoint }, '创建 checkpoint'),
                        h(
                          'button',
                          {
                            class: 'we-btn',
                            disabled: !state.world?.checkpoints.length,
                            onClick: rollbackLatestCheckpoint,
                          },
                          '回滚最近 checkpoint',
                        ),
                        h('button', { class: 'we-btn', onClick: backup }, '导出'),
                        h('button', { class: 'we-btn', onClick: restore }, '导入'),
                      ]),
                ]),
                h('div', { class: 'we-section we-run-controls' }, [
                  h('div', { class: 'we-section-title' }, '运行控制'),
                  h(
                    'div',
                    { class: 'we-muted we-run-warning' },
                    '手动运行和失败重试会调用真实 API，可能产生费用；自动失败重试同样会额外调用 API。手动操作前会再次确认。',
                  ),
                  h('div', { class: 'we-run-control-buttons' }, runActionButtons()),
                  h('div', { class: 'we-run-control-status' }, [
                    h('span', { class: 'we-muted' }, `当前聊天：${state.chatKey}`),
                    h(
                      'span',
                      { class: state.running ? 'we-ok' : 'we-muted' },
                      state.running ? '世界演变任务处理中' : runActionStatus(),
                    ),
                  ]),
                ]),
                error.value ? h('div', { class: 'we-danger' }, error.value) : null,
                embedded
                  ? null
                  : h('div', { class: 'we-section' }, [
                      h('div', { class: 'we-section-title' }, '对象库'),
                      h('div', { class: 'we-row' }, [
                        h('input', {
                          class: 'we-input',
                          value: state.objectFilter,
                          placeholder: '搜索名称或状态',
                          onInput: (event: Event) => (state.objectFilter = (event.target as HTMLInputElement).value),
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
                                    { class: 'we-btn we-btn-danger we-small', onClick: () => void deleteEntity(entity.id) },
                                    '删除',
                                  ),
                                ]),
                              ]),
                            )
                          : [h('div', { class: 'we-muted' }, '暂无符合条件的对象')],
                      ),
                    ]),
                embedded
                  ? null
                  : h('div', { class: 'we-section' }, [
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
                embedded
                  ? null
                  : h('div', { class: 'we-section' }, [
                      h('div', { class: 'we-section-title' }, '世界书投影管理'),
                      h(
                        'div',
                        { class: state.currentWorldbookName ? 'we-muted' : 'we-danger' },
                        state.currentWorldbookName
                          ? `目标：${state.currentWorldbookName} · 角色卡 primary`
                          : '当前角色卡未绑定主世界书',
                      ),
                      (() => {
                        const counts = projectionCounts();
                        return h(
                          'div',
                          { class: 'we-muted' },
                          `数据库 revision：${state.world?.revision ?? 0} · 账本 ${counts.total} 条 · ` +
                            `已同步 ${counts.synced} · 待处理 ${counts.pending} · 失败 ${counts.failed} · ` +
                            `缺失 ${counts.missing} · 漂移 ${counts.drift} · 孤儿 ${counts.orphaned} · 旧条目 ${state.projectionInspection?.legacyCount ?? 0}`,
                        );
                      })(),
                      h('div', { class: 'we-row' }, [
                        h(
                          'button',
                          {
                            class: 'we-btn',
                            disabled: state.projectionBusy || !state.currentWorldbookName,
                            onClick: () => void syncProjection('reconcile', '世界书投影同步'),
                          },
                          state.projectionBusy ? '处理中…' : '立即同步',
                        ),
                        h(
                          'button',
                          {
                            class: 'we-btn',
                            disabled: state.projectionBusy || !state.currentWorldbookName,
                            onClick: () => void cleanProjectionOrphans(),
                          },
                          '清理孤儿/修复漂移',
                        ),
                        h(
                          'button',
                          {
                            class: 'we-btn',
                            disabled: state.projectionBusy || !state.currentWorldbookName,
                            onClick: () => void rebuildProjection(),
                          },
                          '完整重建',
                        ),
                        h(
                          'button',
                          {
                            class: 'we-btn',
                            disabled: state.projectionBusy || !state.currentWorldbookName,
                            onClick: () => void refreshWorld(),
                          },
                          '刷新账本',
                        ),
                      ]),
                      h('div', { class: 'we-row' }, [
                        h('input', {
                          class: 'we-input',
                          value: state.projectionFilter,
                          placeholder: '筛选表名、行 ID、投影键或状态',
                          onInput: (event: Event) =>
                            (state.projectionFilter = (event.target as HTMLInputElement).value),
                        }),
                      ]),
                      h(
                        'div',
                        { class: 'we-list' },
                        filteredProjections().length
                          ? filteredProjections().map(projection =>
                              h('div', { class: 'we-card', key: projection.key }, [
                                h('div', undefined, [
                                  h('div', { class: 'we-card-title' }, `${projection.table} · ${projection.rowId}`),
                                  h(
                                    'div',
                                    { class: 'we-card-meta' },
                                    `${projection.status} · UID ${projection.uid ?? '未绑定'} · revision ${projection.sourceRevision}`,
                                  ),
                                  h(
                                    'div',
                                    { class: 'we-card-state' },
                                    `projectionKey: ${projection.projectionKey}\n指纹: ${projection.contentFingerprint}`,
                                  ),
                                ]),
                              ]),
                            )
                          : [
                              h(
                                'div',
                                { class: 'we-muted' },
                                state.currentWorldbookName
                                  ? '当前没有投影账本记录'
                                  : '绑定角色卡主世界书后显示投影账本',
                              ),
                            ],
                      ),
                    ]),
                embedded
                  ? null
                  : h('div', { class: 'we-section' }, [
                      h('div', { class: 'we-section-title' }, 'Checkpoint 与世界书同步'),
                      h('div', { class: 'we-row' }, [
                        h(
                          'button',
                          {
                            class: 'we-btn',
                            disabled: !state.currentWorldbookName,
                            onClick: retryWorldbook,
                          },
                          '重试世界书同步',
                        ),
                      ]),
                      h(
                        'div',
                        { class: 'we-muted' },
                        `checkpoint：${state.world?.checkpoints.length ?? 0} 个；世界书：${
                          state.world?.worldbookSync.status ?? 'never'
                        }${state.world?.worldbookSync.error ? ` · ${state.world.worldbookSync.error}` : ''}`,
                      ),
                      h(
                        'pre',
                        { class: 'we-status' },
                        JSON.stringify(
                          (state.world?.checkpoints ?? []).slice(-5).map(checkpoint => ({
                            id: checkpoint.id,
                            revision: checkpoint.revision,
                            messageId: checkpoint.messageId,
                            reason: checkpoint.reason,
                            createdAt: checkpoint.createdAt,
                          })),
                          null,
                          2,
                        ),
                      ),
                    ]),
                embedded ? null : h('div', { class: 'we-muted' }, '最近楼层运行记录'),
                embedded
                  ? null
                  : h(
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
                h('div', { class: 'we-section we-run-result-section' }, [renderRunResult()]),
              ])
            : null,
        ]);
    },
  };

  root = createScriptIdDiv().appendTo(target ?? 'body');
  root.append('<div id="world-evolution-mount"></div>');
  styleDestroy = teleportStyle().destroy;
  const style = $('<style data-world-evolution-style>').text(css).appendTo('head');
  app = createApp(Panel);
  app.mount(root.find('#world-evolution-mount')[0]);
  stopChatChangeListener = eventOn(tavern_events.CHAT_CHANGED, () => {
    const discardedUnsavedSettings = state.settingsDirty;
    state.chatKey = getCurrentChatKey();
    state.settings = loadSettings();
    state.settingsDirty = false;
    state.settingsSaveMessage = discardedUnsavedSettings ? '聊天已切换；上一聊天的未保存设置未应用' : '设置已加载';
    state.lastResult = null;
    state.lastResultChatKey = state.chatKey;
    if (!state.running) {
      state.status = 'idle';
      state.statusMessage = '等待触发';
    }
    refreshApiStatusForPanel?.();
    state.currentWorldbookName = resolveCurrentCharacterWorldbookName() ?? '';
    void refreshWorld();
  });
  $(window).on('pagehide.world-evolution', () => {
    stopChatChangeListener?.stop();
    stopChatChangeListener = undefined;
    refreshApiStatusForPanel = undefined;
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

export function mountWorldEvolutionPanel(target: HTMLElement, options: WorldEvolutionPanelOptions = {}): void {
  mountPanel(target, options);
}

export function refreshWorldEvolutionPanelApiStatus(): void {
  refreshApiStatusForPanel?.();
}
