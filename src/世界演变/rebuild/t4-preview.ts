/** T4 只读提交预览：不拥有提交权限，不读取或保存任何宿主/模拟存档。 */
import { z } from 'zod';
import {
  cloneT2Json,
  normalizeT2Template,
  T2_ID_PATTERN,
  type T2Cell,
  type T2Field,
  type T2Reference,
  type T2Row,
  type T2Table,
} from './t2-template';
import { normalizeT2WorldData } from './t2-values';
import { normalizeT4Scope, type T4Anchor, type T4Scope, type T4State } from './t4-protocol';

export type T4PreviewStatus =
  | 'draft'
  | 'private'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'pending'
  | 'conflict'
  | 'cancelled';
export type T4PreviewKind = 'manual' | 'model' | 'migration' | 'restore';
export interface T4PreviewInput {
  status: T4PreviewStatus;
  base: T4State;
  draft: T4State | null;
  scope: T4Scope;
  anchor: T4Anchor | null;
  kind: T4PreviewKind;
  commitId?: string;
  seq?: number;
  isGenesis?: boolean;
  errorCode?: string;
}
export interface T4PreviewChange {
  tableId: string;
  tableName: string;
  groupName: string;
  rowId: string;
  operation: '新增' | '修改' | '删除';
  fields: { fieldId: string; name: string; before: string; after: string }[];
}
export interface T4PreviewModel {
  valid: boolean;
  status: T4PreviewStatus | 'invalid';
  badge: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  explanation: string;
  kindLabel: string;
  scope: { chatId: string; worldId: string; branchId: string } | null;
  anchor: { messageId: string; swipeId: string } | null;
  confirmationAllowed: boolean;
  confirmationReason: string;
  draftNotice: string;
  commit: { id: string; seq: number | null } | null;
  error: string | null;
  changes: T4PreviewChange[];
  summary: { inserted: number; updated: number; deleted: number; truncated: boolean };
}

const ID = z
  .string()
  .regex(T2_ID_PATTERN)
  .refine(value => !['constructor', 'prototype'].includes(value));
const stateSchema = z.strictObject({ template: z.unknown(), data: z.unknown() });
const scopeSchema = z.strictObject({
  mode: z.enum(['t4-sandbox', 't10-host']),
  chatId: ID.refine(value => value.startsWith('sandbox-') || value.startsWith('chat-')),
  worldId: ID,
  branchId: ID,
});
const anchorSchema = z.strictObject({
  chatId: ID.refine(value => value.startsWith('sandbox-') || value.startsWith('chat-')),
  messageId: ID,
  swipeId: ID,
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
const inputSchema = z.strictObject({
  status: z.enum(['draft', 'private', 'saving', 'saved', 'failed', 'pending', 'conflict', 'cancelled']),
  base: stateSchema,
  draft: stateSchema.nullable(),
  scope: scopeSchema,
  anchor: anchorSchema.nullable(),
  kind: z.enum(['manual', 'model', 'migration', 'restore']),
  commitId: ID.optional(),
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  isGenesis: z.boolean().optional(),
  errorCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
    .optional(),
});
const statuses: Record<T4PreviewStatus, { badge: string; tone: T4PreviewModel['tone']; explanation: string }> = {
  draft: { badge: '未提交草稿', tone: 'neutral', explanation: '资料还在草稿里；没有改变已保存的模拟世界。' },
  private: { badge: '私有结果已校验', tone: 'neutral', explanation: 'SQL结果仍在私有暂存区；校验通过不等于已经保存。' },
  saving: {
    badge: '正在保存模拟存档',
    tone: 'warning',
    explanation: '保存与读回确认尚未结束；正式视图仍保持已确认的版本。',
  },
  saved: {
    badge: '模拟存档已确认',
    tone: 'success',
    explanation: '模拟提交已完成确认。这里只表示沙盒保存成功，不表示已存入酒馆聊天。',
  },
  failed: { badge: '保存未成功', tone: 'danger', explanation: '本次没有推进已确认的正式视图；保留草稿供检查。' },
  pending: {
    badge: '保存结果待核对',
    tone: 'warning',
    explanation: '保存确认缺失，可能已经写入模拟存档。先核对提交身份，不要盲目重跑SQL。',
  },
  conflict: {
    badge: '基准版本已变化',
    tone: 'danger',
    explanation: '已有更新的模拟提交。本草稿已过期，不会覆盖新版本；先重新读取和比较。',
  },
  cancelled: { badge: '已取消', tone: 'neutral', explanation: '本次流程已停止；未确认的结果不作为正式世界状态。' },
};
const kindLabels: Record<T4PreviewKind, string> = {
  manual: '手动修改',
  model: '模型结果',
  migration: '模板迁移',
  restore: '恢复提交',
};
const errors: Record<string, string> = {
  INPUT: '提交输入未通过校验',
  DATA: '资料或引用未通过校验',
  VALIDATION: '提交校验未通过',
  PROTOCOL: '存档格式未通过校验',
  CONFLICT: '保存基准已经过期',
  SAVE_FAILED: '模拟存档保存失败',
  WRITE_FAILED: '模拟存档写入失败',
  READ_FAILED: '模拟存档读回失败',
  ACK_LOST: '保存确认丢失，需要核对提交',
  PENDING: '提交是否保存尚待核对',
  ABORTED: '提交流程已取消',
  MISSING_ANCHOR: '没有有效助手消息锚点',
  ANCHOR: '助手消息锚点未通过校验',
  STALE_ANCHOR: '助手消息锚点已经变化',
  IDEMPOTENCY: '同一提交身份收到不同内容',
  CORRUPT: '模拟存档损坏或指纹不一致',
  ARCHIVE: '模拟存档未通过完整性校验',
  EXECUTION: 'SQL批次执行或校验未通过，未接受新结果',
  BUSY: '上一项操作仍在进行，当前没有开始新的提交',
  CLOSED: '本次运行已关闭，需重新读取模拟存档',
};

function normalizeState(value: { template: unknown; data: unknown }): T4State {
  const template = normalizeT2Template(value.template);
  return { template, data: normalizeT2WorldData(template, value.data) };
}
function visibleFields(table: T2Table): T2Field[] {
  return table.fields.filter(field => field.visibility.user && !field.hiddenUi);
}
function visibleTable(state: T4State, tableId: string): T2Table | undefined {
  return state.template.tables.find(
    table => table.id === tableId && table.visibility.user && visibleFields(table).length > 0,
  );
}
function visibleRow(state: T4State, tableId: string, rowId: string): T2Row | undefined {
  if (!visibleTable(state, tableId)) return undefined;
  return state.data.tables[tableId]?.find(row => row.meta.id === rowId && row.meta.visibility.user);
}
function cellText(
  field: T2Field,
  value: T2Cell | undefined,
  publicReference: (reference: T2Reference) => boolean,
): string {
  if (value === undefined) return '未填写';
  if (value === null) return 'NULL（明确空值）';
  if (value === true) return '是';
  if (value === false) return '否';
  if (value === '') return '空字符串';
  if (field.type === 'reference') return publicReference(value as T2Reference) ? JSON.stringify(value) : '未公开';
  if (field.type === 'reference-list') return JSON.stringify((value as T2Reference[]).filter(publicReference));
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function shorten(text: string): string {
  return text.length > 512 ? `${text.slice(0, 512)}…（展示已截短）` : text;
}

/** 仅比较能够公开展示的业务字段；秘密变化不能借行数、引用数或定位泄漏。 */
export function createT4PreviewModel(input: unknown = null): T4PreviewModel {
  const invalid: T4PreviewModel = {
    valid: false,
    status: 'invalid',
    badge: '预览不可用',
    tone: 'danger',
    explanation: '提交预览未通过校验；没有采用损坏资料，也没有执行或保存任何内容。',
    kindLabel: '',
    scope: null,
    anchor: null,
    confirmationAllowed: false,
    confirmationReason: '先提供完整、有效的隔离预览。',
    draftNotice: '预览页不负责保存草稿；关闭或刷新后，未提交草稿不保证保留。',
    commit: null,
    error: null,
    changes: [],
    summary: { inserted: 0, updated: 0, deleted: 0, truncated: false },
  };
  try {
    const supplied = inputSchema.parse(cloneT2Json(input));
    normalizeT4Scope(supplied.scope);
    const base = normalizeState(supplied.base);
    const draft = supplied.draft === null ? null : normalizeState(supplied.draft);
    for (const state of [base, ...(draft ? [draft] : [])]) {
      if (state.data.worldId !== supplied.scope.worldId || state.data.branchId !== supplied.scope.branchId)
        throw new Error('Preview scope mismatch.');
    }
    if (supplied.anchor && supplied.anchor.chatId !== supplied.scope.chatId)
      throw new Error('Preview anchor mismatch.');
    if (
      supplied.isGenesis &&
      (supplied.status !== 'saved' || supplied.seq !== 0 || supplied.commitId !== undefined || draft !== null)
    )
      throw new Error('Invalid genesis preview.');
    if (
      supplied.status === 'saved' &&
      !supplied.isGenesis &&
      (!supplied.commitId || supplied.seq === undefined || supplied.seq < 1)
    )
      throw new Error('Missing saved identity.');
    if (['private', 'saving', 'pending'].includes(supplied.status) && !draft) throw new Error('Missing private draft.');
    if (['saving', 'saved', 'pending'].includes(supplied.status) && !supplied.anchor && !supplied.isGenesis)
      throw new Error('Missing formal anchor.');
    const canConfirm = !!draft && !!supplied.anchor && ['draft', 'private'].includes(supplied.status);
    const model: T4PreviewModel = {
      ...invalid,
      valid: true,
      status: supplied.status,
      ...statuses[supplied.status],
      kindLabel: kindLabels[supplied.kind],
      scope: { chatId: supplied.scope.chatId, worldId: supplied.scope.worldId, branchId: supplied.scope.branchId },
      anchor: supplied.anchor ? { messageId: supplied.anchor.messageId, swipeId: supplied.anchor.swipeId } : null,
      confirmationAllowed: canConfirm,
      confirmationReason: !draft
        ? '没有待提交草稿。'
        : !supplied.anchor
          ? '没有有效助手消息锚点，只能保留草稿；不能假称已存聊天。'
          : canConfirm
            ? '仅确认下面这个独立模拟世界的修改范围；确认本身不会保存。'
            : '当前状态不允许再次确认提交；先等待完成或核对保存结果。',
      draftNotice:
        draft && ['failed', 'conflict', 'cancelled', 'pending'].includes(supplied.status)
          ? '当前草稿仍可查看；未提交草稿只在本次运行内保留，关闭或刷新不保证恢复。'
          : invalid.draftNotice,
      commit: supplied.commitId ? { id: supplied.commitId, seq: supplied.seq ?? null } : null,
      error: supplied.errorCode ? (errors[supplied.errorCode] ?? '提交未完成；私密错误原文不在此展示') : null,
      changes: [],
      summary: { inserted: 0, updated: 0, deleted: 0, truncated: false },
    };
    if (supplied.isGenesis) {
      model.badge = '模拟起始资料已载入，尚无提交';
      model.explanation = '已载入经过校验的模拟起始快照，还没有新的提交；这不表示已保存酒馆聊天。';
    }
    if (supplied.scope.mode === 't10-host') {
      model.explanation = model.explanation
        .replaceAll('模拟存档', '宿主网关存档')
        .replaceAll('模拟提交', '网关提交')
        .replaceAll('模拟世界', '当前世界');
      if (supplied.status === 'saved') {
        model.badge = supplied.isGenesis ? '起始快照已载入，尚无提交' : '网关存档已确认';
        model.explanation = '已从宿主网关确认 JSON；模拟宿主不等于实际酒馆真机验收。请核对存档来源。';
      }
      model.confirmationReason = canConfirm
        ? '确认当前世界的修改范围；实际保存仍须通过可信宿主网关。'
        : model.confirmationReason;
    }
    if (!draft) return model;
    const publicReference = (reference: T2Reference) => {
      const states = [base, draft].filter(state =>
        state.data.tables[reference.tableId]?.some(row => row.meta.id === reference.rowId),
      );
      return states.length > 0 && states.every(state => !!visibleRow(state, reference.tableId, reference.rowId));
    };
    const tableIds = new Set([
      ...base.template.tables.map(table => table.id),
      ...draft.template.tables.map(table => table.id),
    ]);
    for (const tableId of tableIds) {
      const beforeTable = visibleTable(base, tableId);
      const afterTable = visibleTable(draft, tableId);
      const beforeRows = base.data.tables[tableId] ?? [];
      const afterRows = draft.data.tables[tableId] ?? [];
      const beforeMap = new Map(beforeRows.map(row => [row.meta.id, row]));
      const afterMap = new Map(afterRows.map(row => [row.meta.id, row]));
      for (const rowId of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
        const before = beforeMap.get(rowId);
        const after = afterMap.get(rowId);
        const operation = !before ? '新增' : !after ? '删除' : '修改';
        // A visibility transition is not described as insert/delete, and never exposes a hidden endpoint.
        if (before && (!beforeTable || !before.meta.visibility.user)) continue;
        if (after && (!afterTable || !after.meta.visibility.user)) continue;
        const table = afterTable ?? beforeTable;
        if (!table) continue;
        const fields =
          operation === '新增'
            ? visibleFields(afterTable!)
            : operation === '删除'
              ? visibleFields(beforeTable!)
              : visibleFields(afterTable!).filter(field =>
                  visibleFields(beforeTable!).some(old => old.id === field.id),
                );
        const changes: T4PreviewChange['fields'] = [];
        for (const field of fields) {
          const oldField = beforeTable?.fields.find(old => old.id === field.id) ?? field;
          const beforeText = before ? cellText(oldField, before.values[field.id], publicReference) : '无此记录';
          const afterText = after ? cellText(field, after.values[field.id], publicReference) : '已删除';
          if (beforeText === afterText) continue;
          changes.push({ fieldId: field.id, name: field.name, before: shorten(beforeText), after: shorten(afterText) });
        }
        if (before && after) {
          for (const [key, name] of [
            ['locked', '行锁'],
            ['archived', '归档'],
          ] as const)
            if (before.meta[key] !== after.meta[key])
              changes.push({
                fieldId: `meta-${key}`,
                name,
                before: before.meta[key] ? '是' : '否',
                after: after.meta[key] ? '是' : '否',
              });
          for (const field of fields) {
            const was = before.meta.lockedFieldIds.includes(field.id),
              now = after.meta.lockedFieldIds.includes(field.id);
            if (was !== now)
              changes.push({
                fieldId: `lock-${field.id}`,
                name: `${field.name}字段锁`,
                before: was ? '锁定' : '未锁定',
                after: now ? '锁定' : '未锁定',
              });
          }
        }
        if (!changes.length) continue;
        if (operation === '新增') model.summary.inserted += 1;
        else if (operation === '删除') model.summary.deleted += 1;
        else model.summary.updated += 1;
        if (model.changes.length < 100)
          model.changes.push({
            tableId,
            tableName: table.name,
            groupName: table.groupId === 'macro' ? '宏观世界' : '微观世界',
            rowId,
            operation,
            fields: changes,
          });
        else model.summary.truncated = true;
      }
    }
    return model;
  } catch {
    return invalid;
  }
}
