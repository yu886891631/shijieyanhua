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

const css = `
.wedb-panel{position:fixed;right:16px;bottom:16px;z-index:10090;width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#101827;color:#e5e7eb;border:1px solid #334155;border-radius:14px;box-shadow:0 16px 44px #0009;font:13px/1.45 system-ui,sans-serif}
.wedb-panel *{box-sizing:border-box}.wedb-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #334155}.wedb-title{font-weight:700}.wedb-close,.wedb-btn{border:1px solid #475569;background:#1e293b;color:#e5e7eb;border-radius:7px;padding:6px 10px;cursor:pointer}.wedb-btn:hover,.wedb-close:hover{background:#334155}.wedb-btn:disabled{opacity:.5;cursor:not-allowed}.wedb-body{padding:14px;display:grid;gap:12px}.wedb-banner{border:1px solid #36506c;background:#12243a;color:#bfdbfe;border-radius:8px;padding:9px 10px}.wedb-muted{color:#94a3b8;font-size:12px}.wedb-danger{color:#fca5a5}.wedb-ok{color:#86efac}.wedb-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.wedb-input,.wedb-select,.wedb-textarea{background:#0b1220;color:#f8fafc;border:1px solid #475569;border-radius:7px;padding:7px 9px}.wedb-input{min-width:180px;flex:1}.wedb-select{min-width:135px}.wedb-textarea{width:100%;min-height:96px;resize:vertical;font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}.wedb-tabs{display:flex;gap:6px;overflow:auto;padding-bottom:2px}.wedb-tab{white-space:nowrap;border:1px solid #334155;background:#172033;color:#cbd5e1;border-radius:999px;padding:6px 10px;cursor:pointer}.wedb-tab.active{background:#0e7490;border-color:#22d3ee;color:#ecfeff}.wedb-section{border:1px solid #334155;border-radius:9px;padding:10px;display:grid;gap:9px}.wedb-section-title{font-weight:650;color:#f1f5f9}.wedb-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.wedb-stat{background:#0b1220;border:1px solid #263448;border-radius:8px;padding:8px}.wedb-stat strong{display:block;font-size:18px;color:#67e8f9}.wedb-table-wrap{overflow:auto;border:1px solid #263448;border-radius:8px}.wedb-table{width:100%;border-collapse:collapse;min-width:700px}.wedb-table th,.wedb-table td{padding:8px;border-bottom:1px solid #263448;text-align:left;vertical-align:top}.wedb-table th{color:#94a3b8;font-weight:500;background:#111c2d;position:sticky;top:0}.wedb-cell-json{white-space:pre-wrap;max-width:420px;max-height:90px;overflow:auto;color:#cbd5e1;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}.wedb-actions{display:flex;gap:5px;flex-wrap:wrap}.wedb-small{padding:4px 7px;font-size:12px}.wedb-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.wedb-form-grid .full{grid-column:1/-1}@media(max-width:700px){.wedb-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.wedb-form-grid{grid-template-columns:1fr}.wedb-form-grid .full{grid-column:auto}}
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

export function mountWorldEvolutionDbPanel(): void {
  if (root?.length) return;
  const state = reactive({
    chatKey: getCurrentChatKey(),
    selectedTable: 'npc' as WorldEvolutionDbTable,
    query: '',
    visible: true,
    snapshot: null as Awaited<ReturnType<typeof loadDbSnapshot>> | null,
    status: '正在读取数据库…',
    error: '',
    formName: '',
    formJson: '{\n  "state": {}\n}',
    formVisibility: 'ai_context' as WorldEvolutionDbVisibility,
    currentWorldbookName: resolveCurrentCharacterWorldbookName() ?? '',
    projections: [] as WorldEvolutionDbWorldbookProjection[],
    projectionInspection: null as WorldEvolutionWorldbookInspection | null,
    projectionBusy: false,
    migrationPreview: null as WorldEvolutionMigrationPreview | null,
    migrationBusy: false,
  });

  const refresh = async () => {
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
      state.error = '';
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = '数据库读取失败';
    }
  };
  void refresh();

  const projectionCounts = () => {
    const inspection = state.projectionInspection;
    return {
      total: inspection?.projectionCount ?? state.projections.length,
      synced: state.projections.filter(item => item.status === 'synced').length,
      pending: state.projections.filter(item => item.status === 'pending').length,
      failed: state.projections.filter(item => item.status === 'failed').length,
      missing: inspection?.missingCount ?? 0,
      drift: inspection?.driftCount ?? 0,
      orphaned: inspection?.orphanCount ?? state.projections.filter(item => item.status === 'orphaned').length,
      legacy: inspection?.legacyCount ?? 0,
    };
  };

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

  const rebuildProjection = async () => {
    if (
      !state.currentWorldbookName ||
      !window.confirm(`完整重建当前角色卡主世界书“${state.currentWorldbookName}”中的世界演变条目？`)
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

  const addRow = async () => {
    try {
      const name = state.formName.trim();
      if (!name) throw new Error('请填写名称或标题');
      const data = JSON.parse(state.formJson) as unknown;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('字段 JSON 必须是对象');
      const id = `${state.selectedTable}:${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}`;
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
      const data = promptJson(`编辑「${rowDisplayName(row)}」的字段 JSON`, row.data);
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
    const blob = new Blob([await exportDbSnapshot(state.chatKey)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `world-evolution-db-${state.chatKey}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importDatabase = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await importDbSnapshot(state.chatKey, await file.text());
        state.status = '数据库备份已导入';
        await refresh();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
    };
    input.click();
  };

  const migrateLegacyDatabase = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const preview = await previewLegacyDbMigration(state.chatKey, parsed);
        state.migrationPreview = preview;
        const errors = preview.conflicts.filter(item => item.severity === 'error');
        const warnings = preview.conflicts.filter(item => item.severity === 'warning');
        if (!preview.canMigrate) {
          state.error = `迁移预检失败：${errors.map(item => item.message).join('；')}`;
          return;
        }
        const summary =
          `检测到 ${preview.sourceVersion} 备份：${preview.counts.entities} 个实体、` +
          `${preview.counts.events} 个事件、${preview.counts.plans} 个计划、` +
          `${preview.counts.floorRuns} 条楼层记录。` +
          (warnings.length ? `另有 ${warnings.length} 条警告。` : '') +
          '\n\n确认后将写入当前聊天的独立数据库，并保留原始备份；不会覆盖已有数据。';
        if (!window.confirm(summary)) {
          state.status = '已取消旧版迁移';
          return;
        }
        state.migrationBusy = true;
        state.error = '';
        const migrated = await migrateLegacyDbSnapshot(state.chatKey, parsed);
        const worldbookName = resolveCurrentCharacterWorldbookName();
        if (worldbookName) {
          await rebuildWorldEvolutionWorldbook(worldbookName, dbSnapshotToWorld(migrated));
        }
        state.status = `A0.0.5 迁移完成：revision ${migrated.meta.revision}`;
        state.migrationPreview = preview;
        await refresh();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.migrationBusy = false;
      }
    };
    input.click();
  };

  const clearDatabase = async () => {
    if (!window.confirm(`确定清空当前聊天「${state.chatKey}」的世界演变数据库？此操作不可自动恢复。`)) return;
    await clearDbChat(state.chatKey);
    state.status = '当前聊天数据库已清空';
    await refresh();
  };

  const createCheckpoint = async () => {
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
    }
  };

  const rebuildFloor = async () => {
    const raw = window.prompt('输入要删除/重建的消息楼层 ID', String(state.snapshot?.meta.lastMessageId ?? ''));
    if (raw == null) return;
    const messageId = Number.parseInt(raw, 10);
    if (!Number.isFinite(messageId)) {
      state.error = '楼层 ID 必须是整数';
      return;
    }
    try {
      await rebuildDbAfterDeletingFloor(state.chatKey, messageId);
      state.status = `已对楼层 ${messageId} 执行确定性重建（未调用 AI）`;
      await refresh();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  };

  const Panel = {
    setup() {
      return () =>
        h('div', { class: 'wedb-panel' }, [
          h('div', { class: 'wedb-head' }, [
            h('div', { class: 'wedb-title' }, `世界演变数据库 · ${WORLD_EVOLUTION_DB_VERSION}`),
            h(
              'button',
              { class: 'wedb-close', onClick: () => (state.visible = !state.visible) },
              state.visible ? '收起' : '展开',
            ),
          ]),
          state.visible
            ? h('div', { class: 'wedb-body' }, [
                h(
                  'div',
                  { class: 'wedb-banner' },
                  '表格是事实源，世界书只是投影。真实世界演变结果会通过 revision 事务提交；删除或滑动楼层后自动执行确定性回放，不会为历史楼层重新调用 AI。',
                ),
                h('div', { class: 'wedb-muted' }, `当前聊天：${state.chatKey}`),
                h(
                  'div',
                  { class: 'wedb-summary' },
                  [
                    ['revision', state.snapshot?.meta.revision ?? 0],
                    ['NPC', state.snapshot?.rows.npc.length ?? 0],
                    ['事件', state.snapshot?.rows.event.length ?? 0],
                    ['楼层记录', state.snapshot?.floorRuns.length ?? 0],
                    ['检查点', state.snapshot?.checkpoints.length ?? 0],
                  ].map(([label, value]) =>
                    h('div', { class: 'wedb-stat' }, [
                      h('strong', undefined, String(value)),
                      h('span', { class: 'wedb-muted' }, label),
                    ]),
                  ),
                ),
                h('div', { class: 'wedb-toolbar' }, [
                  h('button', { class: 'wedb-btn', onClick: () => void refresh() }, '刷新'),
                  h('button', { class: 'wedb-btn', onClick: () => void createCheckpoint() }, '创建检查点'),
                  h('button', { class: 'wedb-btn', onClick: () => void rebuildFloor() }, '手动重建楼层'),
                  h('button', { class: 'wedb-btn', onClick: () => void exportDatabase() }, '导出数据库'),
                  h('button', { class: 'wedb-btn', onClick: importDatabase }, '导入数据库'),
                  h(
                    'button',
                    {
                      class: 'wedb-btn',
                      disabled: state.migrationBusy,
                      onClick: migrateLegacyDatabase,
                    },
                    state.migrationBusy ? '迁移中…' : '迁移 A0.0.5 旧版备份',
                  ),
                  h('button', { class: 'wedb-btn', onClick: () => void clearDatabase() }, '清空当前聊天'),
                  h('span', { class: state.error ? 'wedb-danger' : 'wedb-ok' }, state.error || state.status),
                ]),
                state.migrationPreview
                  ? h('div', { class: 'wedb-section' }, [
                      h('div', { class: 'wedb-section-title' }, '旧版迁移预检报告'),
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
                          `计划 ${state.migrationPreview.counts.plans} · revision ${state.migrationPreview.sourceRevision}`,
                      ),
                      state.migrationPreview.conflicts.length
                        ? h(
                            'ul',
                            { class: 'wedb-muted' },
                            state.migrationPreview.conflicts.map(conflict =>
                              h(
                                'li',
                                { class: conflict.severity === 'error' ? 'wedb-danger' : 'wedb-muted' },
                                `[${conflict.severity}] ${conflict.path}：${conflict.message}`,
                              ),
                            ),
                          )
                        : h('div', { class: 'wedb-ok' }, '未发现迁移冲突'),
                    ])
                  : null,
                h('div', { class: 'wedb-section' }, [
                  h('div', { class: 'wedb-section-title' }, '角色卡主世界书投影管理'),
                  h(
                    'div',
                    { class: state.currentWorldbookName ? 'wedb-muted' : 'wedb-danger' },
                    state.currentWorldbookName
                      ? `目标：${state.currentWorldbookName}（当前角色卡 primary）`
                      : '当前角色卡未绑定主世界书，投影暂不可用',
                  ),
                  (() => {
                    const counts = projectionCounts();
                    return h(
                      'div',
                      { class: 'wedb-muted' },
                      `账本 ${counts.total} 条 · 已同步 ${counts.synced} · 待处理 ${counts.pending} · 失败 ${counts.failed} · ` +
                        `缺失 ${counts.missing} · 漂移 ${counts.drift} · 孤儿 ${counts.orphaned} · 旧条目 ${counts.legacy}`,
                    );
                  })(),
                  h('div', { class: 'wedb-toolbar' }, [
                    h(
                      'button',
                      {
                        class: 'wedb-btn',
                        disabled: state.projectionBusy || !state.currentWorldbookName,
                        onClick: () => void syncProjection('reconcile', '世界书投影同步'),
                      },
                      state.projectionBusy ? '处理中…' : '立即同步',
                    ),
                    h(
                      'button',
                      {
                        class: 'wedb-btn',
                        disabled: state.projectionBusy || !state.currentWorldbookName,
                        onClick: () => void syncProjection('reconcile', '孤儿清理与漂移修复'),
                      },
                      '清理孤儿/修复漂移',
                    ),
                    h(
                      'button',
                      {
                        class: 'wedb-btn',
                        disabled: state.projectionBusy || !state.currentWorldbookName,
                        onClick: () => void rebuildProjection(),
                      },
                      '完整重建',
                    ),
                  ]),
                  h('div', { class: 'wedb-table-wrap' }, [
                    h('table', { class: 'wedb-table' }, [
                      h('thead', undefined, [
                        h(
                          'tr',
                          undefined,
                          ['表', '行 ID', '状态', 'UID', 'revision', '指纹'].map(label => h('th', undefined, label)),
                        ),
                      ]),
                      h(
                        'tbody',
                        undefined,
                        state.projections.length
                          ? state.projections.map(projection =>
                              h('tr', { key: projection.key }, [
                                h('td', undefined, projection.table),
                                h('td', undefined, projection.rowId),
                                h('td', undefined, projection.status),
                                h('td', undefined, String(projection.uid ?? '未绑定')),
                                h('td', undefined, String(projection.sourceRevision)),
                                h('td', { class: 'wedb-cell-json' }, projection.contentFingerprint),
                              ]),
                            )
                          : [
                              h('tr', undefined, [
                                h(
                                  'td',
                                  { colspan: 6, class: 'wedb-muted' },
                                  state.currentWorldbookName
                                    ? '当前没有投影账本记录'
                                    : '绑定角色卡主世界书后显示投影账本',
                                ),
                              ]),
                            ],
                      ),
                    ]),
                  ]),
                ]),
                h(
                  'div',
                  { class: 'wedb-tabs' },
                  WORLD_EVOLUTION_DB_TABLES.map(table =>
                    h(
                      'button',
                      {
                        class: ['wedb-tab', state.selectedTable === table ? 'active' : ''],
                        onClick: () => {
                          state.selectedTable = table;
                          state.query = '';
                        },
                      },
                      WORLD_EVOLUTION_DB_TABLE_LABELS[table],
                    ),
                  ),
                ),
                h('div', { class: 'wedb-section' }, [
                  h(
                    'div',
                    { class: 'wedb-section-title' },
                    `新增${WORLD_EVOLUTION_DB_TABLE_LABELS[state.selectedTable]}记录`,
                  ),
                  h('div', { class: 'wedb-form-grid' }, [
                    h('input', {
                      class: 'wedb-input',
                      value: state.formName,
                      placeholder:
                        state.selectedTable === 'event' || state.selectedTable === 'plan'
                          ? '事件标题 / 计划标题'
                          : '名称',
                      onInput: (event: Event) => (state.formName = (event.target as HTMLInputElement).value),
                    }),
                    h(
                      'select',
                      {
                        class: 'wedb-select',
                        value: state.formVisibility,
                        onChange: (event: Event) =>
                          (state.formVisibility = (event.target as HTMLSelectElement)
                            .value as WorldEvolutionDbVisibility),
                      },
                      visibilityOptions.map(([value, label]) => h('option', { value }, label)),
                    ),
                    h('textarea', {
                      class: 'wedb-textarea full',
                      value: state.formJson,
                      onInput: (event: Event) => (state.formJson = (event.target as HTMLTextAreaElement).value),
                    }),
                  ]),
                  h('button', { class: 'wedb-btn', onClick: () => void addRow() }, '写入表格'),
                  h(
                    'div',
                    { class: 'wedb-muted' },
                    '名称/标题和字段 JSON 都是本地数据库记录；后续 AI 操作协议会复用同一套表格。',
                  ),
                ]),
                h('div', { class: 'wedb-section' }, [
                  h('div', { class: 'wedb-toolbar' }, [
                    h(
                      'div',
                      { class: 'wedb-section-title' },
                      `${WORLD_EVOLUTION_DB_TABLE_LABELS[state.selectedTable]}表`,
                    ),
                    h('input', {
                      class: 'wedb-input',
                      value: state.query,
                      placeholder: '搜索名称、ID或字段',
                      onInput: (event: Event) => (state.query = (event.target as HTMLInputElement).value),
                    }),
                  ]),
                  h('div', { class: 'wedb-table-wrap' }, [
                    h('table', { class: 'wedb-table' }, [
                      h('thead', undefined, [
                        h(
                          'tr',
                          undefined,
                          ['ID', '名称/标题', '可见性', 'revision', '字段', '操作'].map(label =>
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
                                h('td', undefined, row.visibility),
                                h('td', undefined, String(row.revision)),
                                h('td', { class: 'wedb-cell-json' }, prettyJson(row.data)),
                                h('td', { class: 'wedb-actions' }, [
                                  h(
                                    'button',
                                    { class: 'wedb-btn wedb-small', onClick: () => void editRow(row) },
                                    '编辑',
                                  ),
                                  h(
                                    'button',
                                    { class: 'wedb-btn wedb-small', onClick: () => void deleteRow(row) },
                                    '删除',
                                  ),
                                ]),
                              ]),
                            )
                          : [
                              h('tr', undefined, [
                                h('td', { colspan: 6, class: 'wedb-muted' }, '当前表暂无记录；可以在上方直接新增。'),
                              ]),
                            ],
                      ),
                    ]),
                  ]),
                ]),
                h('div', { class: 'wedb-section' }, [
                  h('div', { class: 'wedb-section-title' }, 'Revision 事务与楼层回放'),
                  h('div', { class: 'wedb-table-wrap' }, [
                    h('table', { class: 'wedb-table' }, [
                      h('thead', undefined, [
                        h(
                          'tr',
                          undefined,
                          ['revision', '楼层', '来源', '状态', 'operations'].map(label => h('th', undefined, label)),
                        ),
                      ]),
                      h(
                        'tbody',
                        undefined,
                        (state.snapshot?.revisions ?? [])
                          .slice()
                          .reverse()
                          .map(revision =>
                            h('tr', { key: revision.key }, [
                              h('td', undefined, String(revision.revision)),
                              h('td', undefined, String(revision.messageId)),
                              h('td', undefined, revision.source),
                              h(
                                'td',
                                { class: revision.status === 'stale' ? 'wedb-danger' : 'wedb-ok' },
                                revision.status,
                              ),
                              h('td', undefined, String(revision.operations.length)),
                            ]),
                          ),
                      ),
                    ]),
                  ]),
                  h(
                    'div',
                    { class: 'wedb-muted' },
                    'stale revision 仅保留历史审计；删除/滑动楼层的当前状态由已保存 operations 确定性回放得到。',
                  ),
                ]),
              ])
            : null,
        ]);
    },
  };

  root = createScriptIdDiv().appendTo('body');
  root.append('<div id="world-evolution-db-mount"></div>');
  styleDestroy = teleportStyle().destroy;
  const style = $('<style data-world-evolution-db-style>').text(css).appendTo('head');
  app = createApp(Panel);
  app.mount(root.find('#world-evolution-db-mount')[0]);
  stopChatChangeListener = eventOn(tavern_events.CHAT_CHANGED, () => {
    state.chatKey = getCurrentChatKey();
    void refresh();
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
  });
}

export function openWorldEvolutionDbPanel(): void {
  mountWorldEvolutionDbPanel();
}
