import { createApp, h, reactive, toRaw } from 'vue';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import {
  clearDbChat,
  createDbCheckpoint,
  deleteDbRow,
  exportDbSnapshot,
  importDbSnapshot,
  migrateLegacyDbSnapshot,
  loadDbSnapshot,
  loadWorldbookProjectionLedger,
  rebuildDbAfterDeletingFloor,
  updateDbWorldbookSyncState,
  upsertDbRow,
  previewLegacyDbMigration,
} from './store';
import { dbSnapshotToWorld } from './adapter';
import {
  inspectWorldEvolutionWorldbook,
  rebuildWorldEvolutionWorldbook,
  resolveCurrentCharacterWorldbookName,
  syncWorldEvolutionWorldbook,
} from '../世界演变/worldbook';
import {
  WORLD_EVOLUTION_DB_TABLE_LABELS,
  WORLD_EVOLUTION_DB_TABLES,
  WORLD_EVOLUTION_DB_VERSION,
  type WorldEvolutionDbWorldbookProjection,
  type WorldEvolutionDbRow,
  type WorldEvolutionDbTable,
  type WorldEvolutionDbVisibility,
} from './types';
import type { WorldEvolutionMigrationPreview } from './migration';
import type { WorldEvolutionWorldbookInspection } from '../世界演变/worldbook';

let app: ReturnType<typeof createApp> | null = null;
let root: JQuery<HTMLDivElement> | null = null;
let styleDestroy: (() => void) | null = null;
let stopChatChangeListener: EventOnReturn | undefined;

export type WorldEvolutionDbPanelPage = 'tables' | 'history' | 'worldbook' | 'backup';
export type WorldEvolutionDbPanelController = (page: WorldEvolutionDbPanelPage) => void;

let navigateWorldEvolutionDbPanel: WorldEvolutionDbPanelController | undefined;

const css = `
.wedb-panel {
  --wedb-panel-bg: var(--we-surface, #101827);
  --wedb-surface: var(--we-surface, #0b1220);
  --wedb-surface-soft: var(--we-surface-soft, #111c2d);
  --wedb-input: var(--we-input, #0b1220);
  --wedb-text: var(--we-text, #e5e7eb);
  --wedb-muted: var(--we-muted, #94a3b8);
  --wedb-border: var(--we-border, #334155);
  --wedb-border-strong: var(--we-border, #475569);
  --wedb-hover: var(--we-tint, #334155);
  --wedb-accent: var(--we-accent, #22d3ee);
  --wedb-accent-strong: var(--we-accent-strong, #0e7490);
  --wedb-accent-contrast: var(--we-accent-contrast, #ecfeff);
  --wedb-action-bg: var(--we-action-bg, #31715e);
  --wedb-action-border: var(--we-action-border, #285f50);
  --wedb-action-hover-bg: var(--we-action-hover-bg, #245a4b);
  --wedb-action-text: var(--we-action-text, #ffffff);
  --wedb-info-text: var(--we-info-text, #bfdbfe);
  --wedb-info-bg: var(--we-info-bg, #12243a);
  --wedb-info-border: var(--we-info-border, #36506c);
  --wedb-success-text: var(--we-success-text, #86efac);
  --wedb-success-bg: var(--we-success-bg, #10271f);
  --wedb-success-border: var(--we-success-border, #286348);
  --wedb-warning-text: var(--we-warning-text, #fde68a);
  --wedb-warning-bg: var(--we-warning-bg, #2b2411);
  --wedb-warning-border: var(--we-warning-border, #755d25);
  --wedb-danger-text: var(--we-danger-text, #fca5a5);
  --wedb-danger-bg: var(--we-danger-bg, #2e171d);
  --wedb-danger-border: var(--we-danger-border, #75434c);
  --wedb-danger-action-bg: var(--we-danger-action-bg, #482a33);
  --wedb-danger-action-border: var(--we-danger-action-border, #71434c);
  --wedb-danger-action-text: var(--we-danger-action-text, #ffdbe0);
  --wedb-danger-action-hover-bg: var(--we-danger-action-hover-bg, #382028);
  --wedb-stat-accent: var(--we-stat-accent, #67e8f9);
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 10090;
  width: min(980px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: var(--wedb-panel-bg);
  color: var(--wedb-text);
  border: 1px solid var(--wedb-border);
  border-radius: 14px;
  box-shadow: var(--we-shadow, 0 16px 44px #0009);
  font: 13px/1.45 system-ui, sans-serif;
}
.wedb-panel-embedded {
  position: relative;
  inset: auto;
  z-index: auto;
  width: 100%;
  max-height: none;
  overflow: visible;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  font: inherit;
}
.wedb-panel-embedded .wedb-head { display: none; }
.wedb-panel-embedded .wedb-body { padding: 0; }
.wedb-panel * { box-sizing: border-box; }
.wedb-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--wedb-border); }
.wedb-title { font-weight: 700; }
.wedb-close,
.wedb-btn { border: 1px solid var(--wedb-border-strong); background: var(--wedb-surface-soft); color: var(--wedb-text); border-radius: 7px; padding: 6px 10px; cursor: pointer; }
.wedb-btn:hover,
.wedb-close:hover { background: var(--wedb-hover); }
.wedb-btn:disabled { opacity: .5; cursor: not-allowed; }
.wedb-body { padding: 14px; display: grid; gap: 12px; }
.wedb-banner { border: 1px solid var(--wedb-info-border); background: var(--wedb-info-bg); color: var(--wedb-info-text); border-radius: 8px; padding: 9px 10px; }
.wedb-muted { color: var(--wedb-muted); font-size: 12px; }
.wedb-danger { color: var(--wedb-danger-text); }
.wedb-ok { color: var(--wedb-success-text); }
.wedb-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.wedb-input,
.wedb-select,
.wedb-textarea { background: var(--wedb-input); color: var(--wedb-text); border: 1px solid var(--wedb-border-strong); border-radius: 7px; padding: 7px 9px; }
.wedb-input { min-width: 180px; flex: 1; }
.wedb-select { min-width: 135px; }
.wedb-textarea { width: 100%; min-height: 96px; resize: vertical; font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
.wedb-tabs { display: flex; gap: 6px; overflow: auto; padding-bottom: 2px; }
.wedb-tab { white-space: nowrap; border: 1px solid var(--wedb-border); background: var(--wedb-surface-soft); color: var(--wedb-text); border-radius: 999px; padding: 6px 10px; cursor: pointer; }
.wedb-tab.active { background: var(--we-tint, #0e7490); border-color: var(--wedb-accent); color: var(--wedb-text); }
.wedb-section { border: 1px solid var(--wedb-border); background: var(--wedb-surface); color: var(--wedb-text); border-radius: 9px; padding: 10px; display: grid; gap: 9px; }
.wedb-section-title { font-weight: 650; color: var(--wedb-text); }
.wedb-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.wedb-stat { background: var(--wedb-surface); color: var(--wedb-text); border: 1px solid var(--wedb-border); border-radius: 8px; padding: 8px; }
.wedb-stat strong { display: block; font-size: 18px; color: var(--wedb-stat-accent); }
.wedb-table-wrap { overflow: auto; border: 1px solid var(--wedb-border); border-radius: 8px; }
.wedb-table { width: 100%; border-collapse: collapse; min-width: 700px; color: var(--wedb-text); }
.wedb-table th,
.wedb-table td { padding: 8px; border-bottom: 1px solid var(--wedb-border); text-align: left; vertical-align: top; }
.wedb-table th { color: var(--wedb-muted); font-weight: 500; background: var(--wedb-surface-soft); position: sticky; top: 0; }
.wedb-cell-json { white-space: pre-wrap; max-width: 420px; max-height: 90px; overflow: auto; color: var(--wedb-text); font: 11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
.wedb-actions { display: flex; gap: 5px; flex-wrap: wrap; }
.wedb-small { padding: 4px 7px; font-size: 12px; }
.wedb-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.wedb-form-grid .full { grid-column: 1 / -1; }
.wedb-field { display: grid; gap: 4px; min-width: 0; }
.wedb-field-label { color: var(--wedb-text); font-size: 12px; }
.wedb-field-help { color: var(--wedb-muted); font-size: 11px; line-height: 1.4; }
.wedb-json-help { display: grid; gap: 3px; padding: 8px 9px; border: 1px solid var(--wedb-border); border-radius: 7px; background: var(--wedb-surface-soft); color: var(--wedb-muted); font-size: 11px; line-height: 1.4; }
.wedb-json-help code,
.wedb-projection-detail-list code { color: var(--wedb-text); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.wedb-status-strip { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 7px 9px; border: 1px solid var(--wedb-border); border-radius: 7px; background: var(--wedb-surface-soft); }
.wedb-status-strip .wedb-danger,
.wedb-status-strip .wedb-ok { font-size: 12px; }
.wedb-visibility { display: inline-flex; padding: 2px 6px; border: 1px solid var(--wedb-border); border-radius: 999px; background: var(--wedb-surface-soft); color: var(--wedb-text); font-size: 11px; white-space: nowrap; }
.wedb-empty-cell strong { display: block; color: var(--wedb-text); }
.wedb-empty-cell small { display: block; margin-top: 3px; color: var(--wedb-muted); }
.wedb-summary.wedb-data-summary { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.wedb-page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 2px 2px 4px; }
.wedb-page-heading .wedb-section-title { font-size: 19px; letter-spacing: .01em; }
.wedb-page-heading .wedb-muted { margin-top: 3px; }
.wedb-chat-key { max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wedb-page-toolbar { justify-content: flex-end; }
.wedb-page-toolbar > .wedb-ok,
.wedb-page-toolbar > .wedb-danger { margin-right: auto; }
.wedb-section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
.wedb-section-heading > .wedb-muted { text-align: right; }
.wedb-table-section { min-height: 180px; }
.wedb-object-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(116px, 1fr)); gap: 8px; padding: 2px; }
.wedb-object-tabs .wedb-tab { display: flex; align-items: center; gap: 8px; justify-content: flex-start; min-height: 46px; border-radius: 10px; padding: 8px 10px; }
.wedb-object-tabs .wedb-tab.active { background: var(--wedb-info-bg); border-color: var(--wedb-info-border); color: var(--wedb-info-text); font-weight: 650; }
.wedb-table-icon { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 8px; background: var(--we-info-bg, #26384c); color: var(--we-info-text, #8dd8cb); font-size: 15px; }
.wedb-table-count { margin-left: auto; color: var(--wedb-muted); font-size: 10px; }
.wedb-btn-primary { border-color: var(--wedb-action-border); background: var(--wedb-action-bg); color: var(--wedb-action-text); font-weight: 700; }
.wedb-btn-primary:hover:not(:disabled) { border-color: var(--wedb-action-hover-bg); background: var(--wedb-action-hover-bg); }
.wedb-danger-btn { border-color: var(--wedb-danger-action-border); background: var(--wedb-danger-action-bg); color: var(--wedb-danger-action-text); }
.wedb-danger-btn:hover:not(:disabled) { border-color: var(--wedb-danger-action-hover-bg); background: var(--wedb-danger-action-hover-bg); }
.wedb-empty-cell { height: 86px; text-align: center !important; vertical-align: middle !important; }
.wedb-error-cell { max-width: 260px; color: var(--wedb-danger-text); }
.wedb-projection-summary { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.wedb-migration-report { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--wedb-border); border-radius: 8px; background: var(--wedb-surface); }
.wedb-danger-zone { border-color: var(--wedb-danger-border); background: var(--wedb-danger-bg); }
.wedb-danger-zone .wedb-section-title { color: var(--wedb-danger-text); }
.wedb-history-summary { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.wedb-history-summary-note { margin-top: -5px; }
.wedb-history-banner { display: grid; gap: 3px; }
.wedb-status-badge { display: inline-flex; align-items: center; padding: 2px 7px; border: 1px solid var(--wedb-border-strong); border-radius: 999px; font-size: 11px; white-space: nowrap; }
.wedb-status-done,
.wedb-revision-valid,
.wedb-projection-synced { color: var(--wedb-success-text); border-color: var(--wedb-success-border); background: var(--wedb-success-bg); }
.wedb-status-queued,
.wedb-status-running,
.wedb-projection-pending { color: var(--wedb-warning-text); border-color: var(--wedb-warning-border); background: var(--wedb-warning-bg); }
.wedb-status-skipped { color: var(--wedb-muted); border-color: var(--wedb-border); background: var(--wedb-surface-soft); }
.wedb-status-failed,
.wedb-status-cancelled,
.wedb-projection-failed { color: var(--wedb-danger-text); border-color: var(--wedb-danger-border); background: var(--wedb-danger-bg); }
.wedb-status-stale,
.wedb-revision-stale,
.wedb-projection-orphaned { color: var(--wedb-warning-text); border-color: var(--wedb-warning-border); background: var(--wedb-warning-bg); }
.wedb-revision-reverted { color: var(--wedb-info-text); border-color: var(--wedb-info-border); background: var(--wedb-info-bg); }
.wedb-cell-subtle { display: block; margin-top: 3px; color: var(--wedb-muted); font-size: 11px; line-height: 1.35; }
.wedb-operation-details { min-width: 170px; }
.wedb-operation-details summary,
.wedb-projection-details summary { color: var(--wedb-accent-strong); cursor: pointer; }
.wedb-operation-list { display: grid; gap: 5px; max-height: 190px; overflow: auto; margin: 6px 0 0; padding: 0 0 0 16px; }
.wedb-operation-list li { padding-left: 2px; overflow-wrap: anywhere; color: var(--wedb-text); }
.wedb-operation-kind { display: inline-block; min-width: 34px; margin-right: 5px; color: var(--wedb-muted); }
.wedb-summary.wedb-projection-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.wedb-worldbook-target { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.wedb-projection-details { min-width: 140px; }
.wedb-projection-detail-list { display: grid; gap: 4px; max-width: 360px; margin: 6px 0 0; padding: 0; list-style: none; }
.wedb-projection-detail-list li { overflow-wrap: anywhere; color: var(--wedb-text); font-size: 11px; }
.wedb-projection-detail-list code { white-space: pre-wrap; overflow-wrap: anywhere; }
.wedb-projection-notice { border-color: var(--wedb-info-border); background: var(--wedb-info-bg); line-height: 1.5; }
.wedb-projection-actions { align-items: flex-start; }
.wedb-projection-actions .wedb-muted { flex-basis: 100%; }
.wedb-projection-empty { min-height: 100px; }
.wedb-add-section .wedb-textarea { min-height: 110px; }
@media (max-width: 900px) {
  .wedb-summary.wedb-history-summary,
  .wedb-summary.wedb-projection-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .wedb-summary,
  .wedb-summary.wedb-history-summary,
  .wedb-summary.wedb-data-summary,
  .wedb-summary.wedb-projection-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wedb-form-grid { grid-template-columns: 1fr; }
  .wedb-form-grid .full { grid-column: auto; }
  .wedb-history-banner { gap: 5px; }
  .wedb-section-heading { align-items: flex-start; flex-direction: column; }
  .wedb-section-heading > .wedb-muted { text-align: left; }
}
`;

const visibilityOptions: Array<[WorldEvolutionDbVisibility, string]> = [
  ['backstage', '后台'],
  ['ai_context', '提供给 AI'],
  ['protagonist_known', '主角已知'],
  ['revealed', '已公开'],
];

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function promptJson(title: string, initial: Record<string, unknown>): Record<string, unknown> | null {
  const raw = window.prompt(title, prettyJson(initial));
  if (raw == null) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('字段 JSON 必须是对象');
  }
  return parsed as Record<string, unknown>;
}

function rowDisplayName(row: WorldEvolutionDbRow): string {
  return row.name ?? row.title ?? row.id;
}

type BackupRecordCounts = {
  npc: number;
  organization: number;
  location: number;
  society: number;
  environment: number;
  event: number;
  plan: number;
  floorRuns: number;
  revisions: number;
  operations: number;
  checkpoints: number;
  projections: number;
};

type DatabaseBackupPreview = {
  fileName: string;
  fileSize: number;
  formatLabel: string;
  targetChatKey: string;
  sourceChatKey: string;
  revision: number;
  counts: BackupRecordCounts;
};

function backupRecordCounts(value: Record<string, unknown>): BackupRecordCounts {
  const rows =
    value.rows && typeof value.rows === 'object' && !Array.isArray(value.rows)
      ? (value.rows as Record<string, unknown>)
      : {};
  const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);
  const revisions = Array.isArray(value.revisions) ? value.revisions : [];
  return {
    npc: count(rows.npc),
    organization: count(rows.organization),
    location: count(rows.location),
    society: count(rows.society),
    environment: count(rows.environment),
    event: count(rows.event),
    plan: count(rows.plan),
    floorRuns: count(value.floorRuns),
    revisions: revisions.length,
    operations: revisions.reduce((total, revision) => {
      if (!revision || typeof revision !== 'object' || Array.isArray(revision)) return total;
      return total + count((revision as Record<string, unknown>).operations);
    }, 0),
    checkpoints: count(value.checkpoints),
    projections: count(value.projections),
  };
}

function backupRecordSummary(counts: BackupRecordCounts): string {
  return `人物 ${counts.npc} · 组织 ${counts.organization} · 地点 ${counts.location} · 社会 ${counts.society} · 环境 ${counts.environment} · 事件 ${counts.event} · 计划 ${counts.plan} · 楼层运行 ${counts.floorRuns} · 版本操作 ${counts.revisions}/${counts.operations} · 检查点 ${counts.checkpoints} · 投影账本 ${counts.projections}`;
}

function tableIcon(table: WorldEvolutionDbTable): string {
  return {
    npc: '♙',
    organization: '⌘',
    location: '⌖',
    society: '◎',
    environment: '☼',
    event: '◷',
    plan: '◇',
  }[table];
}

function visibilityLabel(visibility: WorldEvolutionDbVisibility): string {
  return {
    backstage: '后台',
    ai_context: '提供给 AI',
    protagonist_known: '主角已知',
    revealed: '已公开',
  }[visibility];
}

function floorRunStatusLabel(status: WorldEvolutionDbFloorRun['status']): string {
  return {
    queued: '排队中',
    running: '运行中',
    done: '已完成',
    skipped: '已跳过',
    failed: '失败',
    cancelled: '已取消',
    stale: '已过期',
  }[status];
}

function floorRunSourceLabel(source: WorldEvolutionDbFloorRun['source']): string {
  return {
    auto: '自动',
    manual: '手动',
    retry: '重试',
    rebuild: '重建',
  }[source];
}

function revisionStatusLabel(status: 'valid' | 'stale' | 'reverted'): string {
  return { valid: '有效', stale: '已过期', reverted: '已回退' }[status];
}

function checkpointReasonLabel(reason: 'auto' | 'manual' | 'rebuild' | 'migration'): string {
  return { auto: '自动', manual: '手动', rebuild: '重建', migration: '迁移' }[reason];
}

function projectionTableLabel(table: WorldEvolutionDbWorldbookProjection['table']): string {
  return table === 'index' ? '世界索引' : WORLD_EVOLUTION_DB_TABLE_LABELS[table];
}

function projectionStatusLabel(status: WorldEvolutionDbWorldbookProjection['status']): string {
  return { synced: '账本已同步', pending: '待同步', failed: '同步失败', orphaned: '账本孤儿' }[status];
}

function floorRunRevisionLabel(run: WorldEvolutionDbFloorRun): string {
  if (run.resultRevision == null) return `基线 r${run.baseRevision}`;
  return `结果 r${run.resultRevision}${run.status === 'stale' ? '（已过期）' : ''}`;
}

function floorSourceLabel(source: 'auto' | 'manual' | 'retry' | 'rebuild' | 'migration'): string {
  return { auto: '自动', manual: '手动', retry: '重试', rebuild: '重建', migration: '迁移' }[source];
}

export function mountWorldEvolutionDbPanel(
  target?: HTMLElement,
  options: { initialPage?: WorldEvolutionDbPanelPage; hideNavigation?: boolean } = {},
): WorldEvolutionDbPanelController | undefined {
  if (root?.length) {
    if (options.initialPage) navigateWorldEvolutionDbPanel?.(options.initialPage);
    return navigateWorldEvolutionDbPanel;
  }
  const embedded = target !== undefined;
  const state = reactive({
    chatKey: getCurrentChatKey(),
    page: options.initialPage ?? ('tables' as WorldEvolutionDbPanelPage),
    hideNavigation: options.hideNavigation === true,
    selectedTable: 'npc' as WorldEvolutionDbTable,
    query: '',
    visible: true,
    snapshot: null as Awaited<ReturnType<typeof loadDbSnapshot>> | null,
    loading: true,
    status: '正在读取数据库…',
    error: '',
    formName: '',
    formJson: '{\n  "state": {}\n}',
    formVisibility: 'ai_context' as WorldEvolutionDbVisibility,
    currentWorldbookName: resolveCurrentCharacterWorldbookName() ?? '',
    projections: [] as WorldEvolutionDbWorldbookProjection[],
    projectionInspection: null as WorldEvolutionWorldbookInspection | null,
    projectionBusy: false,
    historyBusy: false,
    migrationPreview: null as WorldEvolutionMigrationPreview | null,
    migrationFileName: '',
    migrationWorldbookName: '',
    migrationBusy: false,
    importPreview: null as DatabaseBackupPreview | null,
    importBusy: false,
  });
  let pendingImportText = '';
  let pendingMigrationInput: unknown;
  const navigate = (page: WorldEvolutionDbPanelPage) => {
    state.page = page;
  };
  navigateWorldEvolutionDbPanel = navigate;

  const refresh = async () => {
    state.loading = true;
    state.error = '';
    state.status = '正在读取数据库…';
    try {
      state.currentWorldbookName = resolveCurrentCharacterWorldbookName() ?? '';
      state.snapshot = await loadDbSnapshot(state.chatKey);
      if (state.currentWorldbookName) {
        const world = dbSnapshotToWorld(toRaw(state.snapshot));
        const [projections, inspection] = await Promise.all([
          loadWorldbookProjectionLedger(state.chatKey, state.currentWorldbookName),
          inspectWorldEvolutionWorldbook(state.currentWorldbookName, world),
        ]);
        state.projections = projections;
        state.projectionInspection = inspection;
      } else {
        state.projections = [];
        state.projectionInspection = null;
      }
      state.status = `已读取 ${state.chatKey} 的数据库`;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = '数据库读取失败';
    } finally {
      state.loading = false;
    }
  };
  void refresh();

  const projectionCounts = () => {
    const inspection = state.projectionInspection;
    return {
      total: inspection?.projectionCount ?? state.projections.length,
      managed: inspection?.managedCount ?? 0,
      synced: state.projections.filter(item => item.status === 'synced').length,
      pending: state.projections.filter(item => item.status === 'pending').length,
      failed: state.projections.filter(item => item.status === 'failed').length,
      missing: inspection?.missingCount ?? 0,
      drift: inspection?.driftCount ?? 0,
      orphaned: inspection?.orphanCount ?? state.projections.filter(item => item.status === 'orphaned').length,
      legacy: inspection?.legacyCount ?? 0,
    };
  };

  const projectionCountLabel = (value: number) =>
    state.loading || state.projectionBusy
      ? '…'
      : !state.currentWorldbookName || !state.projectionInspection || state.error
        ? '—'
        : String(value);

  const syncProjection = async (mode: 'reconcile' | 'rebuild', label: string) => {
    if (state.projectionBusy) return;
    const worldbookName = resolveCurrentCharacterWorldbookName();
    state.currentWorldbookName = worldbookName ?? '';
    if (!worldbookName) {
      state.error = '当前角色卡未绑定主世界书，无法执行世界书投影操作';
      return;
    }
    if (!state.snapshot) {
      await refresh();
      if (!state.snapshot) return;
    }
    const world = dbSnapshotToWorld(toRaw(state.snapshot));
    const now = Date.now();
    state.projectionBusy = true;
    state.error = '';
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
      state.status = `${label}完成`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.error = message;
      await updateDbWorldbookSyncState(state.chatKey, {
        status: 'failed',
        worldbookName,
        lastAttemptAt: now,
        error: message,
      }).catch(recordError => console.warn('[世界演变数据库] 记录投影失败状态失败:', recordError));
    } finally {
      state.projectionBusy = false;
      await refresh();
    }
  };

  const reconcileProjection = async () => {
    const worldbookName = state.currentWorldbookName;
    if (!worldbookName || state.projectionBusy) return;
    if (
      !window.confirm(
        `将按世界演变的托管标记协调“${worldbookName}”中的投影：创建缺失条目、更新漂移内容，并清理重复或孤儿托管条目。\n` +
          '未带世界演变托管标记的普通用户条目、shujuku 条目和其它插件条目不会处理。注意：旧版托管条目可能没有聊天归属标记，无法确认是否属于当前聊天，也会被纳入匹配与清理。若有旧版数据，请先备份并核对。\n继续吗？',
      )
    )
      return;
    await syncProjection('reconcile', '同步并修复差异');
  };

  const rebuildProjection = async () => {
    const worldbookName = state.currentWorldbookName;
    if (!worldbookName || state.projectionBusy) return;
    if (
      !window.confirm(
        `完整重建“${worldbookName}”中的世界演变投影？\n` +
          '这会先删除插件识别为托管的条目，再按当前聊天数据库重新生成。新版本中能按 chatKey 保留其它聊天条目；旧版托管标记可能没有 chatKey，因此无法确认归属，旧版条目也会被纳入清理。\n' +
          '未带世界演变托管标记的普通用户、shujuku 和其它插件条目不会处理。建议确认已有备份后继续。',
      )
    )
      return;
    await syncProjection('rebuild', '世界书完整重建');
  };

  const currentRows = () => {
    const rows = state.snapshot?.rows[state.selectedTable] ?? [];
    const query = state.query.trim().toLowerCase();
    return rows
      .filter(row => !query || `${rowDisplayName(row)} ${row.id} ${prettyJson(row.data)}`.toLowerCase().includes(query))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  };

  const displayDataCount = (value: number): string =>
    state.loading ? '…' : state.error && !state.snapshot ? '—' : String(value);

  const addRow = async () => {
    try {
      const name = state.formName.trim();
      if (!name) throw new Error('请填写名称或标题');
      const existing = (state.snapshot?.rows[state.selectedTable] ?? []).find(row => rowDisplayName(row) === name);
      if (existing) throw new Error(`当前分类已存在「${name}」，请改名或编辑现有记录`);
      const data = JSON.parse(state.formJson) as unknown;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('字段 JSON 必须是对象');
      const id = `${state.selectedTable}:${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}`;
      const existingId = (state.snapshot?.rows[state.selectedTable] ?? []).find(row => row.id === id);
      if (existingId) throw new Error(`生成的记录 ID「${id}」已存在，请换一个名称`);
      await upsertDbRow(state.chatKey, state.selectedTable, {
        id,
        name: state.selectedTable === 'event' || state.selectedTable === 'plan' ? undefined : name,
        title: state.selectedTable === 'event' || state.selectedTable === 'plan' ? name : undefined,
        visibility: state.formVisibility,
        data: data as Record<string, unknown>,
      });
      state.formName = '';
      state.status = `已写入 ${WORLD_EVOLUTION_DB_TABLE_LABELS[state.selectedTable]}：${name}`;
      await refresh();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  };

  const editRow = async (row: WorldEvolutionDbRow) => {
    try {
      const data = promptJson(`编辑「${rowDisplayName(row)}」的字段 JSON（保存时与现有字段合并）`, row.data);
      if (!data) return;
      await upsertDbRow(state.chatKey, row.table, { id: row.id, data });
      state.status = `已更新：${rowDisplayName(row)}`;
      await refresh();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  };

  const deleteRow = async (row: WorldEvolutionDbRow) => {
    if (!window.confirm(`确定删除 ${WORLD_EVOLUTION_DB_TABLE_LABELS[row.table]}「${rowDisplayName(row)}」？`)) return;
    try {
      await deleteDbRow(state.chatKey, row.table, row.id);
      state.status = `已删除：${rowDisplayName(row)}`;
      await refresh();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  };

  const exportDatabase = async () => {
    state.error = '';
    try {
      const text = await exportDbSnapshot(state.chatKey);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `world-evolution-db-${state.chatKey}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      state.status = `已导出当前聊天备份：${state.chatKey}`;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  };

  const importDatabase = () => {
    const targetChatKey = state.chatKey;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        state.error = '';
        state.importPreview = null;
        pendingImportText = '';
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('文件内容不是 JSON 对象，无法识别为数据库备份');
        }
        const snapshot = parsed as Record<string, unknown>;
        if (!snapshot.rows || typeof snapshot.rows !== 'object' || Array.isArray(snapshot.rows)) {
          throw new Error('文件中没有数据库 rows 表；若这是旧版备份，请改用“旧版数据迁移”');
        }
        const meta =
          snapshot.meta && typeof snapshot.meta === 'object' && !Array.isArray(snapshot.meta)
            ? (snapshot.meta as Record<string, unknown>)
            : {};
        const explicitFormat = snapshot.formatVersion ?? snapshot.schemaVersion ?? snapshot.version;
        state.importPreview = {
          fileName: file.name,
          fileSize: file.size,
          formatLabel: explicitFormat == null ? '数据库快照结构（文件未声明格式版本）' : String(explicitFormat),
          targetChatKey,
          sourceChatKey: typeof meta.chatKey === 'string' ? meta.chatKey : '文件未记录',
          revision: typeof meta.revision === 'number' && Number.isFinite(meta.revision) ? meta.revision : 0,
          counts: backupRecordCounts(snapshot),
        };
        pendingImportText = text;
        state.status = '已读取备份摘要；尚未修改当前数据库';
      } catch (error) {
        state.importPreview = null;
        pendingImportText = '';
        state.error = error instanceof Error ? error.message : String(error);
      }
    };
    input.click();
  };

  const confirmImportDatabase = async () => {
    if (!state.importPreview || !pendingImportText || state.importBusy) return;
    const preview = state.importPreview;
    if (preview.targetChatKey !== state.chatKey || preview.targetChatKey !== getCurrentChatKey()) {
      state.error = '预览后聊天已切换。为避免导入到错误聊天，请重新选择备份文件。';
      pendingImportText = '';
      state.importPreview = null;
      return;
    }
    const current = await loadDbSnapshot(preview.targetChatKey);
    const currentCounts = backupRecordCounts(current as unknown as Record<string, unknown>);
    const summary =
      `目标聊天：${preview.targetChatKey}\n当前数据：revision ${current.meta.revision}；${backupRecordSummary(currentCounts)}\n\n` +
      `备份文件：${preview.fileName}\n文件来源聊天：${preview.sourceChatKey}\n备份 revision：${preview.revision}\n` +
      `备份内容：${backupRecordSummary(preview.counts)}\n\n` +
      '确认后会先进行完整格式与一致性校验，再用备份整库替换当前聊天数据（不是合并或追加）。' +
      '\n本次导入不会改动角色卡世界书；完成后数据库与世界书投影可能暂时不一致。继续吗？';
    if (!window.confirm(summary)) {
      state.status = '已取消导入；当前数据库未修改';
      return;
    }
    if (preview.targetChatKey !== state.chatKey || preview.targetChatKey !== getCurrentChatKey()) {
      state.error = '确认期间聊天已切换，已中止导入；请重新选择备份文件。';
      pendingImportText = '';
      state.importPreview = null;
      return;
    }
    state.importBusy = true;
    state.error = '';
    try {
      await importDbSnapshot(preview.targetChatKey, pendingImportText);
      pendingImportText = '';
      state.importPreview = null;
      await refresh();
      state.status = '数据库备份已导入并替换当前聊天数据；角色卡世界书未更改';
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.importBusy = false;
    }
  };

  const migrateLegacyDatabase = () => {
    const targetChatKey = state.chatKey;
    const targetWorldbookName = resolveCurrentCharacterWorldbookName() ?? '';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        state.error = '';
        state.migrationPreview = null;
        state.migrationFileName = file.name;
        state.migrationWorldbookName = targetWorldbookName;
        pendingMigrationInput = undefined;
        const parsed = JSON.parse(await file.text()) as unknown;
        const preview = await previewLegacyDbMigration(targetChatKey, parsed);
        state.migrationPreview = preview;
        if (preview.canMigrate) {
          pendingMigrationInput = parsed;
          state.status = `预检完成：${preview.sourceVersion}；尚未迁移任何数据`;
        } else {
          state.status = `预检未通过：${preview.sourceVersion}，请查看冲突明细`;
        }
      } catch (error) {
        state.migrationPreview = null;
        pendingMigrationInput = undefined;
        state.error = error instanceof Error ? error.message : String(error);
      }
    };
    input.click();
  };

  const confirmLegacyMigration = async () => {
    const preview = state.migrationPreview;
    if (!preview?.canMigrate || pendingMigrationInput === undefined || state.migrationBusy) return;
    if (preview.chatKey !== state.chatKey || preview.chatKey !== getCurrentChatKey()) {
      state.error = '预检后聊天已切换。为避免迁移到错误聊天，请重新选择备份并预检。';
      pendingMigrationInput = undefined;
      state.migrationPreview = null;
      return;
    }
    const warningCount = preview.conflicts.filter(item => item.severity === 'warning').length;
    const summary =
      `来源文件：${state.migrationFileName}\n来源格式：${preview.sourceVersion} → ${WORLD_EVOLUTION_DB_VERSION}\n` +
      `目标聊天：${preview.chatKey}（预检时为空）\n记录：${preview.counts.entities} 个实体、${preview.counts.events} 个事件、` +
      `${preview.counts.plans} 个计划、${preview.counts.floorRuns} 条楼层运行、${preview.counts.revisions} 条版本记录、` +
      `${preview.counts.checkpoints} 个检查点。` +
      (warningCount ? `\n预检含 ${warningCount} 条警告，请先阅读页面中的完整报告。` : '') +
      '\n\n迁移会写入当前聊天数据库并保留原始旧版备份；' +
      (state.migrationWorldbookName
        ? `还会重建角色卡主世界书「${state.migrationWorldbookName}」中的世界演变投影。`
        : '预检时未检测到角色卡主世界书，因此不会执行世界书投影重建。') +
      '\n重建可能清理旧版托管标记但没有聊天归属的条目；其他聊天拥有的新格式托管条目会保留。世界书重建失败不会撤销已经完成的数据库迁移。\n确认开始迁移吗？';
    if (!window.confirm(summary)) {
      state.status = '已取消旧版迁移；当前数据库未修改';
      return;
    }
    if (preview.chatKey !== state.chatKey || preview.chatKey !== getCurrentChatKey()) {
      state.error = '确认期间聊天已切换，已中止迁移；请重新选择备份并预检。';
      pendingMigrationInput = undefined;
      state.migrationPreview = null;
      return;
    }
    state.migrationBusy = true;
    state.error = '';
    try {
      const migrated = await migrateLegacyDbSnapshot(preview.chatKey, pendingMigrationInput);
      pendingMigrationInput = undefined;
      const worldbookName = state.migrationWorldbookName || undefined;
      if (worldbookName) {
        try {
          await rebuildWorldEvolutionWorldbook(worldbookName, dbSnapshotToWorld(migrated));
        } catch (error) {
          await refresh();
          state.status = `数据库迁移已完成（revision ${migrated.meta.revision}），但世界书投影重建失败；请到“世界书投影”页重试`;
          state.error = error instanceof Error ? error.message : String(error);
          return;
        }
      }
      await refresh();
      state.status = worldbookName
        ? `旧版备份迁移完成（来源 ${preview.sourceVersion}，revision ${migrated.meta.revision}），世界书投影已重建`
        : `旧版备份迁移完成（来源 ${preview.sourceVersion}，revision ${migrated.meta.revision}）；当前角色卡未绑定主世界书`;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.migrationBusy = false;
    }
  };

  const clearDatabase = async () => {
    try {
      const targetChatKey = state.chatKey;
      const current = await loadDbSnapshot(targetChatKey);
      const counts = backupRecordCounts(current as unknown as Record<string, unknown>);
      const summary =
        `目标聊天：${targetChatKey}\n当前 revision：${current.meta.revision}\n将清除：${backupRecordSummary(counts)}，` +
        '以及当前聊天的同步元信息和内部迁移备份。\n\n此操作只清除本地数据库，不会删除角色卡世界书中的 WorldEvolution-* 实际条目；清空后这些条目可能成为孤儿，需要到“世界书投影”页检查处理。' +
        '\n建议先导出备份。此操作不能自动撤销。\n\n确定清空吗？';
      if (!window.confirm(summary)) {
        state.status = '已取消清空；当前数据库未修改';
        return;
      }
      if (targetChatKey !== state.chatKey || targetChatKey !== getCurrentChatKey()) {
        state.error = '确认期间聊天已切换，已中止清空操作。';
        return;
      }
      await clearDbChat(targetChatKey);
      await refresh();
      state.status = `已清空当前聊天「${targetChatKey}」的本地数据库；角色卡世界书条目未更改`;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  };

  const createCheckpoint = async () => {
    if (state.historyBusy || state.loading || !state.snapshot) return;
    state.historyBusy = true;
    state.error = '';
    try {
      const messageId = state.snapshot?.meta.lastMessageId ?? 0;
      await createDbCheckpoint(state.chatKey, {
        messageId,
        messageFingerprint: state.snapshot?.meta.lastMessageFingerprint,
        reason: 'manual',
      });
      state.status = `已创建 revision ${state.snapshot?.meta.revision ?? 0} 的检查点`;
      await refresh();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.historyBusy = false;
    }
  };

  const rebuildFloor = async () => {
    if (state.historyBusy || state.loading || !state.snapshot) return;
    const raw = window.prompt(
      '输入要从历史演变中跳过的消息楼层 ID（只回放已保存 operations，不调用 AI）',
      String(state.snapshot.meta.lastMessageId ?? ''),
    );
    if (raw == null) return;
    const normalized = raw.trim();
    state.error = '';
    if (!/^\d+$/.test(normalized)) {
      state.error = '楼层 ID 必须是非负整数';
      return;
    }
    const messageId = Number(normalized);
    if (!Number.isSafeInteger(messageId)) {
      state.error = '楼层 ID 超出可处理范围';
      return;
    }
    const affectedRevisions = state.snapshot.revisions.filter(revision => revision.messageId === messageId);
    if (affectedRevisions.length === 0) {
      state.error = `楼层 ${messageId} 没有版本操作，未执行重建；请核对楼层 ID。`;
      return;
    }
    const firstAffectedRevision = Math.min(...affectedRevisions.map(revision => revision.revision));
    const invalidatedRevisionCount = state.snapshot.revisions.filter(
      revision => revision.revision >= firstAffectedRevision,
    ).length;
    if (
      !window.confirm(
        `确定从历史演变中跳过楼层 ${messageId} 并重算当前数据库吗？\n` +
          `将使用检查点和其余有效操作重放；从 revision ${firstAffectedRevision} 起的 ${invalidatedRevisionCount} 条版本会标记为“已过期”，以保留审计记录。\n` +
          '不会删除聊天消息、调用 AI、自动同步世界书或创建新检查点。',
      )
    )
      return;
    state.historyBusy = true;
    try {
      await rebuildDbAfterDeletingFloor(state.chatKey, messageId);
      state.status = `已重算数据库并跳过楼层 ${messageId}；未调用 AI，世界书投影未自动更新`;
      await refresh();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.historyBusy = false;
    }
  };

  const Panel = {
    setup() {
      const titleByPage: Record<WorldEvolutionDbPanelPage, [string, string]> = {
        tables: ['世界资料表', '按对象分类查看和编辑本聊天的世界状态数据。'],
        history: ['楼层与版本记录', '检查每轮运行、revision 操作和可用检查点；楼层重建只回放已保存操作，不调用 AI。'],
        worldbook: ['世界书投影', '检查当前角色卡 primary 世界书中的投影状态，并按需同步或重建。'],
        backup: ['备份与迁移', '导入、导出或迁移当前聊天的数据；危险操作会再次确认。'],
      };

      const renderPageHeading = () =>
        h('div', { class: 'wedb-page-heading' }, [
          h('div', [
            h('div', { class: 'wedb-section-title' }, titleByPage[state.page][0]),
            h('div', { class: 'wedb-muted' }, titleByPage[state.page][1]),
          ]),
          h('div', { class: 'wedb-muted wedb-chat-key' }, state.chatKey),
        ]);

      const renderNavigation = () =>
        h(
          'div',
          { class: 'wedb-tabs', role: 'tablist', 'aria-label': '数据库页面' },
          (
            [
              ['tables', '世界资料'],
              ['history', '楼层记录'],
              ['worldbook', '世界书投影'],
              ['backup', '备份与迁移'],
            ] as Array<[WorldEvolutionDbPanelPage, string]>
          ).map(([page, label]) =>
            h(
              'button',
              {
                class: ['wedb-tab', state.page === page ? 'active' : ''],
                role: 'tab',
                'aria-selected': String(state.page === page),
                onClick: () => navigate(page),
              },
              label,
            ),
          ),
        );

      const renderSummary = (mode: 'data' | 'history' = 'data') => {
        const values =
          mode === 'history'
            ? [
                ['楼层运行', displayDataCount(state.snapshot?.floorRuns.length ?? 0)],
                [
                  '排队 / 失败',
                  displayDataCount(
                    state.snapshot?.floorRuns.filter(run => ['queued', 'running', 'failed'].includes(run.status))
                      .length ?? 0,
                  ),
                ],
                [
                  '涉及对象',
                  displayDataCount(new Set(state.snapshot?.floorRuns.flatMap(run => run.changedEntityIds) ?? []).size),
                ],
                ['当前版本', displayDataCount(state.snapshot?.meta.revision ?? 0)],
                ['检查点', displayDataCount(state.snapshot?.checkpoints.length ?? 0)],
              ]
            : [
                ['数据版本', displayDataCount(state.snapshot?.meta.revision ?? 0)],
                [
                  '世界对象',
                  displayDataCount(
                    WORLD_EVOLUTION_DB_TABLES.slice(0, 5).reduce(
                      (sum, table) => sum + (state.snapshot?.rows[table].length ?? 0),
                      0,
                    ),
                  ),
                ],
                [
                  '事件 / 计划',
                  displayDataCount((state.snapshot?.rows.event.length ?? 0) + (state.snapshot?.rows.plan.length ?? 0)),
                ],
                ['楼层记录', displayDataCount(state.snapshot?.floorRuns.length ?? 0)],
                ['检查点', displayDataCount(state.snapshot?.checkpoints.length ?? 0)],
              ];
        return h(
          'div',
          { class: ['wedb-summary', mode === 'data' ? 'wedb-data-summary' : 'wedb-history-summary'] },
          values.map(([label, value]) =>
            h('div', { class: 'wedb-stat' }, [
              h('strong', undefined, String(value)),
              h('span', { class: 'wedb-muted' }, label),
            ]),
          ),
        );
      };

      const renderTableEditor = () => [
        h(
          'div',
          { class: 'wedb-tabs wedb-object-tabs', role: 'tablist', 'aria-label': '世界对象分类' },
          WORLD_EVOLUTION_DB_TABLES.map(table =>
            h(
              'button',
              {
                class: ['wedb-tab', state.selectedTable === table ? 'active' : ''],
                role: 'tab',
                'aria-selected': String(state.selectedTable === table),
                onClick: () => {
                  state.selectedTable = table;
                  state.query = '';
                },
              },
              [
                h('span', { class: 'wedb-table-icon' }, tableIcon(table)),
                WORLD_EVOLUTION_DB_TABLE_LABELS[table],
                h('small', { class: 'wedb-table-count' }, displayDataCount(state.snapshot?.rows[table].length ?? 0)),
              ],
            ),
          ),
        ),
        h('div', { class: 'wedb-section wedb-add-section' }, [
          h('div', { class: 'wedb-section-heading' }, [
            h(
              'div',
              { class: 'wedb-section-title' },
              `新增${WORLD_EVOLUTION_DB_TABLE_LABELS[state.selectedTable]}记录`,
            ),
            h('span', { class: 'wedb-muted' }, '新增会直接写入当前聊天数据库；字段 JSON 会与记录一起保存。'),
          ]),
          h('div', { class: 'wedb-form-grid' }, [
            h('label', { class: 'wedb-field' }, [
              h(
                'span',
                { class: 'wedb-field-label' },
                state.selectedTable === 'event' || state.selectedTable === 'plan' ? '标题' : '名称',
              ),
              h('input', {
                class: 'wedb-input',
                value: state.formName,
                placeholder:
                  state.selectedTable === 'event' || state.selectedTable === 'plan'
                    ? state.selectedTable === 'event'
                      ? '例如：港口冲突开始'
                      : '例如：寻找失踪者'
                    : `例如：${WORLD_EVOLUTION_DB_TABLE_LABELS[state.selectedTable]}`,
                onInput: (event: Event) => (state.formName = (event.target as HTMLInputElement).value),
              }),
              h('small', { class: 'wedb-field-help' }, '同一分类中的名称必须唯一。'),
            ]),
            h('label', { class: 'wedb-field' }, [
              h('span', { class: 'wedb-field-label' }, '提供范围'),
              h(
                'select',
                {
                  class: 'wedb-select',
                  value: state.formVisibility,
                  onChange: (event: Event) =>
                    (state.formVisibility = (event.target as HTMLSelectElement).value as WorldEvolutionDbVisibility),
                },
                visibilityOptions.map(([value, label]) => h('option', { value }, label)),
              ),
              h('small', { class: 'wedb-field-help' }, '控制这条记录是否可被主角、AI 或后台逻辑看到。'),
            ]),
            h('div', { class: 'wedb-json-help full' }, [
              h('strong', undefined, '字段 JSON'),
              h('span', undefined, '这里只填写业务字段，不要填写 id、key、chatKey、table 或 revision。'),
              h('span', undefined, [
                h('code', undefined, '{ "state": {} }'),
                '　事件可使用 summary/details，计划可使用 title/trigger。',
              ]),
            ]),
            h('textarea', {
              class: 'wedb-textarea full',
              value: state.formJson,
              onInput: (event: Event) => (state.formJson = (event.target as HTMLTextAreaElement).value),
            }),
          ]),
          h(
            'button',
            { class: 'wedb-btn wedb-btn-primary', disabled: state.loading, onClick: () => void addRow() },
            `写入${WORLD_EVOLUTION_DB_TABLE_LABELS[state.selectedTable]}`,
          ),
        ]),
        h('div', { class: 'wedb-section wedb-table-section' }, [
          h('div', { class: 'wedb-toolbar' }, [
            h('div', { class: 'wedb-section-title' }, `${WORLD_EVOLUTION_DB_TABLE_LABELS[state.selectedTable]}表`),
            h('input', {
              class: 'wedb-input',
              value: state.query,
              placeholder: '搜索名称、ID或字段；支持 JSON 内容',
              onInput: (event: Event) => (state.query = (event.target as HTMLInputElement).value),
            }),
            state.query
              ? h('button', { class: 'wedb-btn wedb-small', onClick: () => (state.query = '') }, '清除搜索')
              : null,
          ]),
          h('div', { class: 'wedb-status-strip' }, [
            h('span', { class: state.error ? 'wedb-danger' : 'wedb-ok' }, state.error || state.status),
            h(
              'span',
              { class: 'wedb-muted' },
              state.loading
                ? '正在读取…'
                : `显示 ${currentRows().length} / ${state.snapshot?.rows[state.selectedTable].length ?? 0} 条`,
            ),
          ]),
          h('div', { class: 'wedb-table-wrap' }, [
            h('table', { class: 'wedb-table' }, [
              h('thead', undefined, [
                h(
                  'tr',
                  undefined,
                  ['记录 ID', '名称 / 标题', '提供范围', '数据版本', '字段（合并更新）', '操作'].map(label =>
                    h('th', undefined, label),
                  ),
                ),
              ]),
              h(
                'tbody',
                undefined,
                currentRows().length
                  ? currentRows().map(row =>
                      h('tr', { key: row.id }, [
                        h('td', undefined, row.id),
                        h('td', undefined, rowDisplayName(row)),
                        h('td', undefined, visibilityLabel(row.visibility)),
                        h('td', undefined, String(row.revision)),
                        h('td', { class: 'wedb-cell-json' }, prettyJson(row.data)),
                        h('td', { class: 'wedb-actions' }, [
                          h('button', { class: 'wedb-btn wedb-small', onClick: () => void editRow(row) }, '编辑'),
                          h(
                            'button',
                            { class: 'wedb-btn wedb-small wedb-danger-btn', onClick: () => void deleteRow(row) },
                            '删除',
                          ),
                        ]),
                      ]),
                    )
                  : [
                      h('tr', undefined, [
                        h('td', { colspan: 6, class: 'wedb-muted wedb-empty-cell' }, [
                          h(
                            'strong',
                            undefined,
                            state.loading ? '正在读取当前分类…' : state.query ? '没有匹配记录' : '当前分类暂无记录',
                          ),
                          h(
                            'small',
                            undefined,
                            state.loading
                              ? '数据库读取完成后会显示记录。'
                              : state.query
                                ? '可以清除搜索，或换一个名称、ID、字段关键词。'
                                : '可以在上方新增第一条记录。',
                          ),
                        ]),
                      ]),
                    ],
              ),
            ]),
          ]),
        ]),
      ];

      const renderTablesPage = () => [
        renderSummary('data'),
        h('div', { class: 'wedb-toolbar wedb-page-toolbar' }, [
          h('span', { class: state.error ? 'wedb-danger' : 'wedb-ok' }, state.error || state.status),
          h(
            'button',
            { class: 'wedb-btn', disabled: state.loading, onClick: () => void refresh() },
            state.loading ? '读取中…' : '刷新数据',
          ),
        ]),
        ...renderTableEditor(),
      ];

      const renderWorldbookPage = () => {
        const counts = projectionCounts();
        const syncState = state.snapshot?.meta.worldbookSync;
        const syncTargetsCurrentBook = Boolean(
          state.currentWorldbookName &&
          (!syncState?.worldbookName || syncState.worldbookName === state.currentWorldbookName),
        );
        const syncStateLabel =
          syncState?.worldbookName && !syncTargetsCurrentBook
            ? '上次同步目标为其他世界书'
            : {
                never: '尚未同步',
                pending: '同步待确认',
                synced: '最近一次同步操作成功',
                failed: '最近一次同步失败',
              }[syncState?.status ?? 'never'];
        const syncTime =
          syncState?.status === 'synced' && syncState.lastSuccessAt
            ? `成功时间：${new Date(syncState.lastSuccessAt).toLocaleString()}`
            : syncState?.lastAttemptAt
              ? `最近尝试：${new Date(syncState.lastAttemptAt).toLocaleString()}`
              : '尚无操作时间记录';
        const summaryMetrics: Array<[string, number]> = [
          ['应有投影', counts.total],
          ['已找到托管条目', counts.managed],
          ['账本：已同步', counts.synced],
          ['账本：待处理', counts.pending],
          ['账本：失败', counts.failed],
          ['实检：缺失', counts.missing],
          ['实检：内容漂移', counts.drift],
          ['实检：孤儿 / 重复', counts.orphaned],
          ['实检：旧版托管', counts.legacy],
        ];
        return [
          h('div', { class: 'wedb-banner wedb-worldbook-target' }, [
            h('strong', undefined, state.currentWorldbookName ? '目标角色卡世界书' : '尚未绑定主世界书'),
            h(
              'div',
              { class: 'wedb-worldbook-target-name' },
              state.currentWorldbookName
                ? ` ${state.currentWorldbookName} · primary`
                : '　当前角色卡未绑定 primary 世界书，投影暂不可用。',
            ),
          ]),
          h(
            'div',
            { class: 'wedb-muted' },
            '投影范围不是整张数据库：包含世界索引、可见对象、最近 50 条非后台事件，以及待处理的非后台计划；后台资料不会写入世界书。',
          ),
          h(
            'div',
            { class: 'wedb-summary wedb-projection-summary' },
            summaryMetrics.map(([label, value]) =>
              h('div', { class: 'wedb-stat' }, [
                h('strong', undefined, projectionCountLabel(value)),
                h('span', { class: 'wedb-muted' }, label),
              ]),
            ),
          ),
          h('div', { class: 'wedb-status-strip wedb-projection-notice' }, [
            h('span', undefined, [
              h('strong', undefined, `同步记录：${syncStateLabel}`),
              h(
                'small',
                { class: 'wedb-cell-subtle' },
                `${syncTime}；只表示上次同步操作结果，当前差异以“实检”计数为准。`,
              ),
              syncTargetsCurrentBook && syncState?.status === 'failed' && syncState.error
                ? h('small', { class: 'wedb-danger wedb-cell-subtle' }, syncState.error)
                : null,
            ]),
            h('span', { class: state.error ? 'wedb-danger' : 'wedb-ok' }, state.error || state.status),
          ]),
          h('div', { class: 'wedb-section' }, [
            h('div', { class: 'wedb-section-heading' }, [
              h('div', { class: 'wedb-section-title' }, '同步与维护'),
              h(
                'span',
                { class: 'wedb-muted' },
                '同步会补缺失、更新漂移并清理孤儿；完整重建会先清理可识别的托管条目，再按当前数据库重新生成。',
              ),
            ]),
            h('div', { class: 'wedb-toolbar wedb-projection-actions' }, [
              h(
                'button',
                {
                  class: 'wedb-btn',
                  disabled: state.projectionBusy || state.loading || !state.currentWorldbookName,
                  onClick: () => void refresh(),
                },
                state.loading ? '检查中…' : '重新检查（只读）',
              ),
              h(
                'button',
                {
                  class: 'wedb-btn wedb-btn-primary',
                  disabled: state.projectionBusy || state.loading || !state.currentWorldbookName,
                  onClick: () => void reconcileProjection(),
                },
                state.projectionBusy ? '处理中…' : '同步并修复差异',
              ),
              h(
                'button',
                {
                  class: 'wedb-btn wedb-danger-btn',
                  disabled: state.projectionBusy || state.loading || !state.currentWorldbookName,
                  onClick: () => void rebuildProjection(),
                },
                '完整重建',
              ),
              h(
                'small',
                { class: 'wedb-muted' },
                '操作依据世界演变插件的托管元数据，而非仅凭条目名前缀；旧版托管条目缺少 chatKey 时无法按聊天隔离，可能被纳入同步或清理。',
              ),
            ]),
          ]),
          h('div', { class: 'wedb-section' }, [
            h('div', { class: 'wedb-section-heading' }, [
              h('div', { class: 'wedb-section-title' }, '投影同步账本'),
              h(
                'span',
                { class: 'wedb-muted' },
                '此表展示 IndexedDB 中的预期投影记录；缺失、漂移、孤儿和旧版条目是上方对 primary 世界书的实时检查计数，不会伪装成逐行账本状态。',
              ),
            ]),
            h('div', { class: 'wedb-table-wrap' }, [
              h('table', { class: 'wedb-table' }, [
                h('thead', undefined, [
                  h(
                    'tr',
                    undefined,
                    ['投影类型', '对象', '账本状态', '来源版本', '技术详情'].map(label => h('th', undefined, label)),
                  ),
                ]),
                h(
                  'tbody',
                  undefined,
                  state.loading || state.projectionBusy
                    ? [
                        h('tr', undefined, [
                          h(
                            'td',
                            { colspan: 5, class: 'wedb-muted wedb-empty-cell wedb-projection-empty' },
                            '正在检查当前聊天数据库与 primary 世界书…',
                          ),
                        ]),
                      ]
                    : state.projections.length
                      ? state.projections.map(projection => {
                          const row =
                            projection.table === 'index'
                              ? undefined
                              : state.snapshot?.rows[projection.table].find(item => item.id === projection.rowId);
                          return h('tr', { key: projection.key }, [
                            h('td', undefined, projectionTableLabel(projection.table)),
                            h(
                              'td',
                              undefined,
                              row
                                ? rowDisplayName(row)
                                : projection.table === 'index'
                                  ? '世界索引'
                                  : '数据库记录未找到',
                            ),
                            h('td', undefined, [
                              h(
                                'span',
                                { class: ['wedb-status-badge', `wedb-projection-${projection.status}`] },
                                projectionStatusLabel(projection.status),
                              ),
                            ]),
                            h('td', undefined, `r${projection.sourceRevision}`),
                            h('td', undefined, [
                              h('details', { class: 'wedb-projection-details' }, [
                                h('summary', undefined, '查看 UID / 键 / 指纹'),
                                h('ul', { class: 'wedb-projection-detail-list' }, [
                                  h('li', undefined, `记录 ID：${projection.rowId}`),
                                  h('li', undefined, `UID：${projection.uid ?? '未绑定'}`),
                                  h('li', undefined, `稳定键：${projection.projectionKey}`),
                                  h('li', undefined, [
                                    '内容指纹：',
                                    h('code', undefined, projection.contentFingerprint),
                                  ]),
                                  projection.error
                                    ? h('li', { class: 'wedb-danger' }, `错误：${projection.error}`)
                                    : null,
                                ]),
                              ]),
                            ]),
                          ]);
                        })
                      : [
                          h('tr', undefined, [
                            h(
                              'td',
                              { colspan: 5, class: 'wedb-muted wedb-empty-cell wedb-projection-empty' },
                              state.loading
                                ? '正在读取数据库与 primary 世界书…'
                                : !state.currentWorldbookName
                                  ? '请先为当前角色卡绑定 primary 世界书，之后才能检查投影。'
                                  : state.error
                                    ? '检查未完成；请先处理上方错误，再重新检查。'
                                    : counts.total === 0
                                      ? '当前没有符合投影条件的世界资料。后台资料不会投影；仅部分事件和待办计划会进入世界书。'
                                      : '尚无同步账本记录；数据库存在应投影内容，可先使用“同步并修复差异”。',
                            ),
                          ]),
                        ],
                ),
              ]),
            ]),
          ]),
        ];
      };

      const renderHistoryPage = () => [
        renderSummary('history'),
        h('div', { class: 'wedb-banner wedb-history-banner' }, [
          h('strong', undefined, '确定性历史记录'),
          h(
            'span',
            undefined,
            '　楼层重建会从历史演变中跳过指定楼层，并用检查点及其余有效操作重算当前数据库；受影响版本会标记为过期并保留审计记录。不会删除聊天消息、调用 AI、自动同步世界书或创建检查点。',
          ),
        ]),
        h(
          'div',
          { class: 'wedb-muted wedb-history-summary-note' },
          '“涉及对象”是楼层运行记录中出现过的不同对象 ID 数，可能包含已过期记录；它不是当前世界资料总数。',
        ),
        h('div', { class: 'wedb-toolbar wedb-page-toolbar' }, [
          h('span', { class: state.error ? 'wedb-danger' : 'wedb-ok' }, state.error || state.status),
          h(
            'button',
            {
              class: 'wedb-btn',
              disabled: state.historyBusy || state.loading || !state.snapshot,
              onClick: () => void createCheckpoint(),
            },
            state.historyBusy ? '处理中…' : '创建检查点',
          ),
          h(
            'button',
            {
              class: 'wedb-btn wedb-rebuild-btn',
              disabled: state.historyBusy || state.loading || !state.snapshot,
              onClick: () => void rebuildFloor(),
            },
            '按楼层重放已保存操作',
          ),
          h(
            'button',
            { class: 'wedb-btn', disabled: state.historyBusy || state.loading, onClick: () => void refresh() },
            state.loading ? '读取中…' : '刷新记录',
          ),
        ]),
        h('div', { class: 'wedb-section' }, [
          h('div', { class: 'wedb-section-heading' }, [
            h('div', { class: 'wedb-section-title' }, '楼层运行'),
            h('span', { class: 'wedb-muted' }, '每条记录对应一次楼层处理；同一楼层的不同尝试会分别保留。'),
          ]),
          h('div', { class: 'wedb-table-wrap' }, [
            h('table', { class: 'wedb-table' }, [
              h('thead', undefined, [
                h(
                  'tr',
                  undefined,
                  ['楼层', '状态', '来源', '数据版本', '候选与变更', '错误'].map(label => h('th', undefined, label)),
                ),
              ]),
              h(
                'tbody',
                undefined,
                (state.snapshot?.floorRuns ?? []).length
                  ? (state.snapshot?.floorRuns ?? [])
                      .slice()
                      .sort((left, right) => right.messageId - left.messageId)
                      .map(run =>
                        h('tr', { key: run.key }, [
                          h('td', undefined, String(run.messageId)),
                          h('td', undefined, [
                            h(
                              'span',
                              { class: ['wedb-status-badge', `wedb-status-${run.status}`] },
                              floorRunStatusLabel(run.status),
                            ),
                          ]),
                          h('td', undefined, floorRunSourceLabel(run.source)),
                          h('td', undefined, [
                            h('span', undefined, floorRunRevisionLabel(run)),
                            run.attempt && run.attempt > 1
                              ? h('small', { class: 'wedb-cell-subtle' }, `第 ${run.attempt} 次尝试`)
                              : null,
                          ]),
                          h('td', undefined, [
                            h('div', undefined, run.candidateNames.join('、') || '无候选对象'),
                            h(
                              'small',
                              { class: 'wedb-cell-subtle' },
                              `${run.operationCount} 个操作 · ${run.changedEntityIds.length} 个对象 · ${run.eventIds.length} 个事件`,
                            ),
                          ]),
                          h('td', { class: 'wedb-cell-json wedb-error-cell' }, run.error || '—'),
                        ]),
                      )
                  : [
                      h('tr', undefined, [
                        h('td', { colspan: 6, class: 'wedb-muted wedb-empty-cell' }, [
                          h('strong', undefined, state.loading ? '正在读取楼层记录…' : '还没有楼层运行记录'),
                          h(
                            'small',
                            undefined,
                            state.loading
                              ? '数据库读取完成后会显示处理状态。'
                              : '完成自动演变或手动运行后，楼层记录会出现在这里。',
                          ),
                        ]),
                      ]),
                    ],
              ),
            ]),
          ]),
        ]),
        h('div', { class: 'wedb-section' }, [
          h('div', { class: 'wedb-section-heading' }, [
            h('div', { class: 'wedb-section-title' }, '版本操作'),
            h('span', { class: 'wedb-muted' }, '过期记录仍保留审计信息；当前数据库由有效操作确定性回放。'),
          ]),
          h('div', { class: 'wedb-table-wrap' }, [
            h('table', { class: 'wedb-table' }, [
              h('thead', undefined, [
                h(
                  'tr',
                  undefined,
                  ['数据版本', '楼层', '来源', '状态', '操作数', '变更详情'].map(label => h('th', undefined, label)),
                ),
              ]),
              h(
                'tbody',
                undefined,
                (state.snapshot?.revisions ?? []).length
                  ? (state.snapshot?.revisions ?? [])
                      .slice()
                      .reverse()
                      .map(revision =>
                        h('tr', { key: revision.key }, [
                          h('td', undefined, String(revision.revision)),
                          h('td', undefined, String(revision.messageId)),
                          h('td', undefined, floorSourceLabel(revision.source)),
                          h('td', undefined, [
                            h(
                              'span',
                              { class: ['wedb-status-badge', `wedb-revision-${revision.status}`] },
                              revisionStatusLabel(revision.status),
                            ),
                          ]),
                          h('td', undefined, String(revision.operations.length)),
                          h(
                            'td',
                            undefined,
                            revision.operations.length
                              ? h('details', { class: 'wedb-operation-details' }, [
                                  h('summary', undefined, `查看 ${revision.operations.length} 项变更`),
                                  h(
                                    'ul',
                                    { class: 'wedb-operation-list' },
                                    revision.operations.map((operation, index) =>
                                      h('li', { key: `${operation.table}:${operation.id}:${index}` }, [
                                        h(
                                          'span',
                                          { class: 'wedb-operation-kind' },
                                          operation.op === 'delete' ? '删除' : '写入',
                                        ),
                                        `${WORLD_EVOLUTION_DB_TABLE_LABELS[operation.table]} · ${operation.id}`,
                                        operation.op === 'upsert'
                                          ? h('small', { class: 'wedb-cell-subtle' }, rowDisplayName(operation.row))
                                          : null,
                                      ]),
                                    ),
                                  ),
                                ])
                              : h('span', { class: 'wedb-muted' }, '无变更'),
                          ),
                        ]),
                      )
                  : [
                      h('tr', undefined, [
                        h('td', { colspan: 6, class: 'wedb-muted wedb-empty-cell' }, [
                          h('strong', undefined, state.loading ? '正在读取版本操作…' : '还没有 Revision 操作'),
                          h(
                            'small',
                            undefined,
                            state.loading
                              ? '数据库读取完成后会显示有效和过期记录。'
                              : '完成演变、手动更新或楼层重建后会生成版本操作。',
                          ),
                        ]),
                      ]),
                    ],
              ),
            ]),
          ]),
        ]),
        h('div', { class: 'wedb-section' }, [
          h('div', { class: 'wedb-section-heading' }, [
            h('div', { class: 'wedb-section-title' }, '恢复检查点'),
            h('span', { class: 'wedb-muted' }, '检查点用于加快恢复与长历史重建；此处创建的是当前数据库状态的检查点。'),
          ]),
          h('div', { class: 'wedb-table-wrap' }, [
            h('table', { class: 'wedb-table' }, [
              h('thead', undefined, [
                h(
                  'tr',
                  undefined,
                  ['ID', 'revision', '楼层', '原因', '创建时间'].map(label => h('th', undefined, label)),
                ),
              ]),
              h(
                'tbody',
                undefined,
                (state.snapshot?.checkpoints ?? []).length
                  ? (state.snapshot?.checkpoints ?? [])
                      .slice()
                      .reverse()
                      .map(checkpoint =>
                        h('tr', { key: checkpoint.key }, [
                          h('td', undefined, checkpoint.id),
                          h('td', undefined, String(checkpoint.revision)),
                          h('td', undefined, String(checkpoint.messageId)),
                          h('td', undefined, checkpointReasonLabel(checkpoint.reason)),
                          h('td', undefined, new Date(checkpoint.createdAt).toLocaleString()),
                        ]),
                      )
                  : [
                      h('tr', undefined, [
                        h('td', { colspan: 5, class: 'wedb-muted wedb-empty-cell' }, [
                          h('strong', undefined, state.loading ? '正在读取检查点…' : '还没有恢复检查点'),
                          h(
                            'small',
                            undefined,
                            state.loading
                              ? '数据库读取完成后会显示检查点。'
                              : '可以使用页面上方的“创建检查点”保存当前状态快照。',
                          ),
                        ]),
                      ]),
                    ],
              ),
            ]),
          ]),
        ]),
      ];

      const renderBackupPage = () => [
        h('div', { class: 'wedb-banner' }, [
          h('strong', undefined, '先看清影响范围，再执行写入'),
          h('span', undefined, '所有操作都限定当前聊天；导入会替换数据库，旧版迁移和清空各有不同的世界书影响。'),
        ]),
        state.error || (state.status && !state.status.startsWith('已读取 '))
          ? h('div', { class: `wedb-status-strip ${state.error ? 'wedb-danger' : 'wedb-ok'}`, role: 'status' }, [
              h('span', undefined, state.error || state.status),
            ])
          : null,
        h('div', { class: 'wedb-section' }, [
          h('div', { class: 'wedb-section-heading' }, [
            h('div', { class: 'wedb-section-title' }, '完整备份'),
            h(
              'span',
              { class: 'wedb-muted' },
              `当前聊天：${state.chatKey} · 数据 revision ${state.snapshot?.meta.revision ?? '…'}`,
            ),
          ]),
          state.snapshot
            ? h(
                'div',
                { class: 'wedb-muted' },
                `当前库内容：${backupRecordSummary(backupRecordCounts(state.snapshot as unknown as Record<string, unknown>))}`,
              )
            : null,
          h(
            'div',
            { class: 'wedb-muted' },
            '导出包含七类资料表、楼层运行、revision 与正/逆操作、检查点、世界书投影账本及同步状态；不包含角色卡世界书正文、API 配置/密钥或填表提示词草稿。',
          ),
          h('div', { class: 'wedb-toolbar' }, [
            h(
              'button',
              {
                class: 'wedb-btn wedb-btn-primary',
                disabled: state.loading || !state.snapshot,
                onClick: () => void exportDatabase(),
              },
              '导出数据库 JSON',
            ),
            h('button', { class: 'wedb-btn', disabled: state.importBusy, onClick: importDatabase }, '选择数据库备份'),
          ]),
          state.importPreview
            ? h('div', { class: 'wedb-migration-report' }, [
                h('div', { class: 'wedb-section-title' }, '导入预览（尚未写入）'),
                h(
                  'div',
                  undefined,
                  `文件：${state.importPreview.fileName} · ${(state.importPreview.fileSize / 1024).toFixed(1)} KB`,
                ),
                h(
                  'div',
                  { class: 'wedb-muted' },
                  `文件格式标记：${state.importPreview.formatLabel} · 文件来源聊天：${state.importPreview.sourceChatKey} · revision ${state.importPreview.revision}`,
                ),
                state.importPreview.sourceChatKey !== '文件未记录' &&
                state.importPreview.sourceChatKey !== state.importPreview.targetChatKey
                  ? h(
                      'div',
                      { class: 'wedb-danger' },
                      `注意：此备份来自其他聊天，将作为副本写入目标聊天「${state.importPreview.targetChatKey}」，不会恢复到来源聊天。`,
                    )
                  : null,
                h('div', { class: 'wedb-muted' }, `备份记录：${backupRecordSummary(state.importPreview.counts)}`),
                h(
                  'div',
                  { class: 'wedb-banner' },
                  '摘要阶段已检查 JSON 语法和数据库快照结构。点击确认后还会由导入器执行完整格式与一致性校验；校验通过才会替换当前聊天数据。',
                ),
                h(
                  'div',
                  { class: 'wedb-muted' },
                  '导入是整库替换，不是合并或追加。普通导入不会改角色卡世界书；导入后如需与数据库一致，请另到“世界书投影”页检查/同步。',
                ),
                h('div', { class: 'wedb-toolbar' }, [
                  h(
                    'button',
                    {
                      class: 'wedb-btn wedb-btn-primary',
                      disabled: state.importBusy,
                      onClick: () => void confirmImportDatabase(),
                    },
                    state.importBusy ? '正在校验并导入…' : '确认替换当前聊天数据库',
                  ),
                  h(
                    'button',
                    {
                      class: 'wedb-btn',
                      disabled: state.importBusy,
                      onClick: () => {
                        pendingImportText = '';
                        state.importPreview = null;
                        state.status = '已取消备份导入';
                      },
                    },
                    '取消',
                  ),
                ]),
              ])
            : null,
        ]),
        h('div', { class: 'wedb-section' }, [
          h('div', { class: 'wedb-section-heading' }, [
            h('div', { class: 'wedb-section-title' }, '旧版数据迁移'),
            h('span', { class: 'wedb-muted' }, '选择旧版 JSON 后先生成完整预检报告；来源格式由报告识别。'),
          ]),
          h(
            'button',
            {
              class: 'wedb-btn',
              disabled: state.migrationBusy,
              onClick: migrateLegacyDatabase,
            },
            state.migrationBusy ? '正在迁移…' : '选择旧版备份并预检',
          ),
          state.migrationPreview
            ? h('div', { class: 'wedb-migration-report' }, [
                h('div', { class: 'wedb-section-title' }, `预检报告：${state.migrationFileName}`),
                h(
                  'div',
                  { class: state.migrationPreview.canMigrate ? 'wedb-ok' : 'wedb-danger' },
                  state.migrationPreview.canMigrate
                    ? `可迁移：${state.migrationPreview.sourceVersion} → ${WORLD_EVOLUTION_DB_VERSION}`
                    : '不可迁移：请先处理以下冲突',
                ),
                h(
                  'div',
                  { class: 'wedb-muted' },
                  `实体 ${state.migrationPreview.counts.entities} · 事件 ${state.migrationPreview.counts.events} · ` +
                    `计划 ${state.migrationPreview.counts.plans} · 楼层运行 ${state.migrationPreview.counts.floorRuns} · ` +
                    `版本记录 ${state.migrationPreview.counts.revisions} · 检查点 ${state.migrationPreview.counts.checkpoints} · ` +
                    `来源 revision ${state.migrationPreview.sourceRevision}`,
                ),
                state.migrationPreview.conflicts.length
                  ? h(
                      'ul',
                      undefined,
                      state.migrationPreview.conflicts.map(conflict =>
                        h(
                          'li',
                          { class: conflict.severity === 'error' ? 'wedb-danger' : 'wedb-muted' },
                          `[${conflict.severity}] ${conflict.path}：${conflict.message}`,
                        ),
                      ),
                    )
                  : h('div', { class: 'wedb-ok' }, '未发现迁移冲突'),
                state.migrationPreview.canMigrate
                  ? h('div', undefined, [
                      h(
                        'div',
                        { class: 'wedb-banner' },
                        '确认后会写入当前聊天数据库并保留原始旧版备份。若角色卡绑定主世界书，会随后重建世界演变投影；旧版托管标记但缺少聊天归属的条目可能被清理。投影重建失败不会撤销已经完成的数据库迁移。',
                      ),
                      h('div', { class: 'wedb-toolbar' }, [
                        h(
                          'button',
                          {
                            class: 'wedb-btn wedb-btn-primary',
                            disabled: state.migrationBusy || pendingMigrationInput === undefined,
                            onClick: () => void confirmLegacyMigration(),
                          },
                          state.migrationBusy ? '正在迁移…' : '确认迁移此备份',
                        ),
                        h(
                          'button',
                          {
                            class: 'wedb-btn',
                            disabled: state.migrationBusy,
                            onClick: () => {
                              pendingMigrationInput = undefined;
                              state.migrationPreview = null;
                              state.status = '已取消旧版迁移';
                            },
                          },
                          '取消',
                        ),
                      ]),
                    ])
                  : h('div', { class: 'wedb-danger' }, '预检未通过，不提供写入操作。'),
              ])
            : null,
        ]),
        h('div', { class: 'wedb-section wedb-danger-zone' }, [
          h('div', { class: 'wedb-section-heading' }, [
            h('div', { class: 'wedb-section-title' }, '危险操作'),
            h('span', { class: 'wedb-muted' }, '只清当前聊天的本地数据库；不会删除角色卡世界书正文。'),
          ]),
          h(
            'div',
            { class: 'wedb-muted' },
            '清空后可能留下 WorldEvolution-* 孤儿条目，可到“世界书投影”页检查；建议先下载一份备份以便恢复。',
          ),
          h(
            'button',
            {
              class: 'wedb-btn wedb-danger-btn',
              disabled: state.loading || !state.snapshot || state.importBusy || state.migrationBusy,
              onClick: () => void clearDatabase(),
            },
            '清空当前聊天数据库…',
          ),
        ]),
      ];

      return () => {
        const pageContent =
          state.page === 'tables'
            ? renderTablesPage()
            : state.page === 'worldbook'
              ? renderWorldbookPage()
              : state.page === 'history'
                ? renderHistoryPage()
                : renderBackupPage();
        return h('div', { class: ['wedb-panel', embedded ? 'wedb-panel-embedded' : ''] }, [
          embedded
            ? null
            : h('div', { class: 'wedb-head' }, [
                h('div', { class: 'wedb-title' }, `世界演变数据库 · ${WORLD_EVOLUTION_DB_VERSION}`),
                h(
                  'button',
                  { class: 'wedb-close', onClick: () => (state.visible = !state.visible) },
                  state.visible ? '收起' : '展开',
                ),
              ]),
          state.visible
            ? h('div', { class: 'wedb-body' }, [
                h('div', { class: 'wedb-banner' }, [
                  h('strong', undefined, '数据库是事实源'),
                  h(
                    'span',
                    undefined,
                    '　世界书只是按需重建的投影；楼层删除后使用已保存 operations 回放，不会为历史内容重新调用 AI。',
                  ),
                ]),
                renderPageHeading(),
                state.hideNavigation ? null : renderNavigation(),
                ...pageContent,
              ])
            : null,
        ]);
      };
    },
  };

  root = createScriptIdDiv().appendTo(target ?? 'body');
  root.append('<div id="world-evolution-db-mount"></div>');
  styleDestroy = teleportStyle().destroy;
  const style = $('<style data-world-evolution-db-style>').text(css).appendTo('head');
  app = createApp(Panel);
  app.mount(root.find('#world-evolution-db-mount')[0]);
  stopChatChangeListener = eventOn(tavern_events.CHAT_CHANGED, () => {
    state.chatKey = getCurrentChatKey();
    pendingImportText = '';
    pendingMigrationInput = undefined;
    state.importPreview = null;
    state.migrationPreview = null;
    state.status = '聊天已切换；待确认的导入和迁移已取消';
    void refresh().then(() => {
      state.status = '聊天已切换；待确认的导入和迁移已取消';
    });
  });
  $(window).on('pagehide.world-evolution-db', () => {
    stopChatChangeListener?.stop();
    stopChatChangeListener = undefined;
    app?.unmount();
    app = null;
    style.remove();
    styleDestroy?.();
    styleDestroy = null;
    root?.remove();
    root = null;
    navigateWorldEvolutionDbPanel = undefined;
  });

  return navigate;
}

export function openWorldEvolutionDbPanel(): void {
  mountWorldEvolutionDbPanel();
}
