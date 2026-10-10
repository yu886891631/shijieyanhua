/** Editable T5 workbench. Dependencies are injected sandbox services, not TavernHelper globals. */
import { cloneT2Json, type T2Cell, type T2Field, type T2Row, type T2Table, type T2Reference } from './t2-template';
import { findT2DeleteImpacts, prepareT2NewRow } from './t2-values';
import { createT3LocalPolicy } from './t3-engine';
import { canonicalT4Json, type T4Archive, type T4State } from './t4-protocol';
import { previewT4View, recoverT4Snapshot, type T4CommitService, type T4RunSpec, type T4View } from './t4-service';
import { createT4PreviewModel, type T4PreviewModel } from './t4-preview';
import { applyT5Controls, type T5Control } from './t5-controls';
import { compileT5Action, inputT5Cell, parseT5Input, type T5Action, type T5Input } from './t5-form';
import {
  previewT5Import,
  readT5Sheets,
  selectT5Import,
  type T5ImportPlan,
  type T5ImportPreview,
  type T5ImportSheet,
} from './t5-import';

const copy = <T>(input: T): T => cloneT2Json(input) as unknown as T;
const key = (tableId: string, rowId: string) => `${tableId}/${rowId}`;
export interface T5FieldView {
  field: T2Field;
  input: T5Input;
  current: string;
  writable: boolean;
  locked: boolean;
  error: string | null;
  choices: { key: string; label: string; reference: T2Reference }[];
}
export interface T5Editor {
  tableId: string;
  tableName: string;
  rowId: string | null;
  title: string;
  fields: T5FieldView[];
  rowLocked: boolean;
  archived: boolean;
}
export interface T5View {
  notice: string;
  busy: boolean;
  error: string | null;
  message: string;
  revision: number;
  history: string | null;
  tables: { id: string; name: string; groupId: 'macro' | 'micro'; count: number }[];
  table: { id: string; name: string; description: string };
  fields: { id: string; name: string; shown: boolean }[];
  rows: { id: string; title: string; locked: boolean; archived: boolean; cells: { fieldId: string; text: string }[] }[];
  query: string;
  filter: 'active' | 'archived' | 'all' | 'locked';
  page: number;
  pages: number;
  total: number;
  editor: T5Editor | null;
  staged: { index: number; label: string }[];
  preview: T4PreviewModel | null;
  consent: boolean;
  canSave: boolean;
  canAdd: boolean;
  importSheets: { id: string; name: string; headers: string[] }[];
  importPreview: T5ImportPreview | null;
}
const messages: Record<string, string> = {
  BUSY: '正在校验或保存，请稍候。',
  PENDING: '保存结果待核对，请先点“核对保存结果”。',
  CONFLICT: '资料已被另一项提交修改。草稿保留，但不能覆盖新版本；请取消草稿、重新载入后比较。',
  SAVE_FAILED: '保存失败，草稿仍保留。先核对，再确认重试。',
  ANCHOR: '没有有效模拟楼层锚点，只能保留草稿，不能保存。',
  EXECUTION: '整批资料未通过 SQL、权限或引用校验；没有保存。请检查暂存修改。',
  ARCHIVE: '模拟存档未通过校验，未采用损坏数据。',
};

export function createT5Workbench(options: {
  service: T4CommitService;
  runSpec: () => T4RunSpec;
  nextId: () => string;
  readArchive: () => Promise<T4Archive>;
  /** Shared structure editor can prevent simultaneous data/structure drafts. */
  canEdit?: () => boolean;
}) {
  const { service } = options;
  let receipt: T4View = service.view();
  let state: T4State = receipt.formal;
  let history: string | null = null;
  let tableId = state.template.tables.find(t => t.visibility.user)?.id ?? '';
  let query = '',
    filter: T5View['filter'] = 'active',
    page = 1;
  const pageSize = 20;
  const columns = new Map<string, Set<string>>();
  let knownColumns = new Map<string, Set<string>>();
  let editor: T5Editor | null = null;
  let actions: T5Action[] = [],
    controls: T5Control[] = [];
  let busy = false,
    consent = false,
    prepared = false,
    error: string | null = null,
    message = '';
  let preview: T4PreviewModel | null = null;
  let sheets: T5ImportSheet[] = [],
    importPreview: T5ImportPreview | null = null;
  let referenceIndex = new Map<string, { label: string; reference: T2Reference; archived: boolean }>();
  let publicRows = new Map<string, { row: T2Row; title: string; search: string; texts: Map<string, string> }[]>();
  const listeners = new Set<() => void>();
  const fieldsFor = (table: T2Table) => table.fields.filter(f => f.visibility.user && !f.hiddenUi);
  const tableFor = (id: string) => {
    const table = state.template.tables.find(t => t.id === id && t.visibility.user);
    if (!table) throw new Error('无法访问这张表');
    return table;
  };
  const rowFor = (table: string, id: string) => {
    const row = state.data.tables[table]?.find(r => r.meta.id === id && r.meta.visibility.user);
    if (!row) throw new Error('无法访问这条记录');
    return row;
  };
  const publicText = (field: T2Field, value?: T2Cell): string => {
    if (value === undefined) return '未填写';
    if (value === null) return '明确空值';
    if (field.type === 'reference' || field.type === 'reference-list') {
      const refs = field.type === 'reference' ? [value as T2Reference] : (value as T2Reference[]);
      return refs.map(ref => referenceIndex.get(key(ref.tableId, ref.rowId))?.label ?? '未公开引用').join('、') || '无';
    }
    if (field.type === 'world-time') return (value as { display: string }).display;
    if (typeof value === 'boolean') return value ? '是' : '否';
    return Array.isArray(value) ? value.join('、') : String(value);
  };
  // Cache only after receiving a validated snapshot. No whole-graph validation on search/keystrokes.
  const index = () => {
    if (!state.template.tables.some(t => t.id === tableId && t.visibility.user))
      tableId = state.template.tables.find(t => t.visibility.user)?.id ?? '';
    for (const [id, shown] of columns) {
      const table = state.template.tables.find(t => t.id === id);
      if (!table) columns.delete(id);
      else
        columns.set(
          id,
          new Set([
            ...[...shown].filter(fieldId => fieldsFor(table).some(f => f.id === fieldId)),
            ...fieldsFor(table)
              .filter(f => !knownColumns.get(id)?.has(f.id))
              .map(f => f.id),
          ]),
        );
    }
    knownColumns = new Map(state.template.tables.map(t => [t.id, new Set(fieldsFor(t).map(f => f.id))]));
    referenceIndex = new Map();
    publicRows = new Map();
    for (const table of state.template.tables.filter(t => t.visibility.user)) {
      const titleField =
        fieldsFor(table).find(f => f.id === table.export.titleFieldId) ?? fieldsFor(table).find(f => f.type === 'text');
      for (const row of state.data.tables[table.id].filter(r => r.meta.visibility.user)) {
        const value = titleField ? row.values[titleField.id] : null;
        const title = typeof value === 'string' && value ? value : '未命名记录';
        referenceIndex.set(key(table.id, row.meta.id), {
          label: `${table.name} · ${title} [${row.meta.id}]`,
          reference: { tableId: table.id, rowId: row.meta.id },
          archived: row.meta.archived,
        });
      }
    }
    for (const table of state.template.tables.filter(t => t.visibility.user)) {
      const rows = state.data.tables[table.id]
        .filter(r => r.meta.visibility.user)
        .map(row => {
          const title = referenceIndex
            .get(key(table.id, row.meta.id))!
            .label.split(' · ')
            .slice(1)
            .join(' · ')
            .replace(/ \[[^\]]+\]$/, '');
          const texts = new Map(fieldsFor(table).map(f => [f.id, publicText(f, row.values[f.id])]));
          return { row, title, texts, search: [title, ...texts.values()].join('\n').toLocaleLowerCase() };
        });
      publicRows.set(table.id, rows);
    }
  };
  index();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const guard = () => {
    if (options.canEdit && !options.canEdit()) throw new Error('请先保存或取消结构草稿，再填写资料。');
    if (busy) throw new Error(messages.BUSY);
    if (receipt.status === 'pending') throw new Error(messages.PENDING);
    if (history !== null) throw new Error('历史资料只读，请返回当前世界后编辑。');
  };
  const unsent = () => !!editor?.fields.some(f => f.input.mode !== 'keep');
  const invalidate = () => {
    if (prepared) service.cancelDraft();
    prepared = false;
    consent = false;
    preview = null;
    error = null;
  };
  const requireFreshEditor = () => {
    guard();
    if (unsent()) throw new Error('请先暂存或取消当前正在填写的记录。');
  };
  const editable = (table: T2Table, row: T2Row | null, field: T2Field) =>
    !table.locked &&
    !row?.meta.locked &&
    !field.readonly &&
    field.permissions.manualWrite &&
    !row?.meta.lockedFieldIds.includes(field.id) &&
    table.permissions.manual[row ? 'update' : 'insert'];
  const makeEditor = (table: T2Table, row: T2Row | null): T5Editor => ({
    tableId: table.id,
    tableName: table.name,
    rowId: row?.meta.id ?? null,
    title: row ? referenceIndex.get(key(table.id, row.meta.id))!.label : `新增 ${table.name}`,
    rowLocked: row?.meta.locked ?? false,
    archived: row?.meta.archived ?? false,
    fields: fieldsFor(table).map(field => {
      let input = inputT5Cell(field, row ? row.values[field.id] : field.defaultValue);
      // Hidden reference identities must never be placed in user-editable data.
      const concealedReference = input.references.some(ref => !referenceIndex.has(key(ref.tableId, ref.rowId)));
      if (concealedReference) input = inputT5Cell(field);
      const choices = [...referenceIndex.entries()]
        .filter(([, item]) => !item.archived && field.constraints.reference?.tableIds.includes(item.reference.tableId))
        .map(([k, item]) => ({ key: k, label: item.label, reference: item.reference }));
      return {
        field: copy(field),
        input,
        choices,
        current: publicText(field, row ? row.values[field.id] : field.defaultValue),
        writable: editable(table, row, field) && !concealedReference,
        locked: row?.meta.lockedFieldIds.includes(field.id) ?? false,
        error: null,
      };
    }),
  });
  const captureFailure = (caught: unknown) => {
    receipt = service.view();
    const code = caught && typeof caught === 'object' && 'code' in caught ? String(caught.code) : '';
    error = messages[code] ?? '操作未完成，原资料和填写草稿没有被覆盖。';
    if (prepared) preview = createT4PreviewModel(previewT4View(receipt));
    consent = false;
  };
  const view = (): T5View => {
    const table = tableFor(tableId);
    const shown = columns.get(table.id);
    const fields = fieldsFor(table).map(f => ({ id: f.id, name: f.name, shown: shown ? shown.has(f.id) : true }));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = (publicRows.get(table.id) ?? []).filter(
      item =>
        (!normalizedQuery || item.search.includes(normalizedQuery)) &&
        (filter === 'all' || filter === 'locked'
          ? filter !== 'locked' || item.row.meta.locked
          : filter === 'archived'
            ? item.row.meta.archived
            : !item.row.meta.archived),
    );
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    page = Math.min(page, pages);
    return copy({
      notice: '独立模拟存档，未写当前聊天 · 不调用真实 API，不写世界书',
      busy,
      error,
      message,
      revision: state.data.revision,
      history,
      tables: state.template.tables
        .filter(t => t.visibility.user)
        .map(t => ({ id: t.id, name: t.name, groupId: t.groupId, count: publicRows.get(t.id)?.length ?? 0 })),
      table: { id: table.id, name: table.name, description: table.description },
      fields,
      rows: matches.slice((page - 1) * pageSize, page * pageSize).map(item => ({
        id: item.row.meta.id,
        title: item.title,
        locked: item.row.meta.locked,
        archived: item.row.meta.archived,
        cells: fields.filter(f => f.shown).map(f => ({ fieldId: f.id, text: item.texts.get(f.id)! })),
      })),
      query,
      filter,
      page,
      pages,
      total: matches.length,
      editor,
      staged: [
        ...actions.map((a, i) => ({
          index: i,
          label: `${tableFor(a.tableId).name} · ${a.kind === 'insert' ? '新增' : a.kind === 'delete' ? '删除' : '修改'} ${a.kind === 'insert' ? String(a.values.name ?? '') : a.rowId}`,
        })),
        ...controls.map((c, i) => ({
          index: actions.length + i,
          label: `${tableFor(c.tableId).name} · ${{ 'row-lock': '行锁', 'field-lock': '字段锁', archive: '归档' }[c.kind]} · ${c.after ? '开启' : '关闭'} · ${referenceIndex.get(key(c.tableId, c.rowId))?.label ?? '记录'}`,
        })),
      ],
      preview,
      consent,
      canSave:
        prepared && consent && receipt.status === 'private' && !!receipt.draft?.commit && !busy && history === null,
      canAdd:
        !table.locked && table.permissions.manual.insert && !busy && history === null && receipt.status !== 'pending',
      importSheets: sheets.map(s => ({ id: s.id, name: s.name, headers: s.headers })),
      importPreview,
    });
  };
  return {
    view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectTable(id: string) {
      tableFor(id);
      tableId = id;
      page = 1;
      query = '';
      notify();
    },
    search(value: string) {
      query = value.slice(0, 1000);
      page = 1;
      notify();
    },
    filter(value: T5View['filter']) {
      if (!['active', 'archived', 'all', 'locked'].includes(value)) throw new Error('筛选无效');
      filter = value;
      page = 1;
      notify();
    },
    page(value: number) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('页码无效');
      page = value;
      notify();
    },
    column(id: string, shown: boolean) {
      const table = tableFor(tableId);
      if (!fieldsFor(table).some(f => f.id === id)) throw new Error('字段无效');
      const set = columns.get(tableId) ?? new Set(fieldsFor(table).map(f => f.id));
      if (shown) set.add(id);
      else set.delete(id);
      columns.set(tableId, set);
      notify();
    },
    beginNew() {
      requireFreshEditor();
      const table = tableFor(tableId);
      if (!view().canAdd) throw new Error('当前表不能新增');
      editor = makeEditor(table, null);
      notify();
    },
    beginEdit(rowId: string) {
      if (history !== null && !busy) {
        const table = tableFor(tableId);
        editor = makeEditor(table, rowFor(tableId, rowId));
        for (const field of editor.fields) field.writable = false;
        notify();
        return;
      }
      requireFreshEditor();
      const table = tableFor(tableId);
      editor = makeEditor(table, rowFor(tableId, rowId));
      notify();
    },
    setInput(fieldId: string, input: T5Input) {
      guard();
      const field = editor?.fields.find(f => f.field.id === fieldId);
      if (!field?.writable) throw new Error('字段锁定或没有修改权限');
      invalidate();
      field.input = copy(input);
      field.error = null;
      notify();
    },
    cancelEditor() {
      if (busy) throw new Error(messages.BUSY);
      editor = null;
      notify();
    },
    stageEditor() {
      guard();
      if (!editor) throw new Error('没有正在填写的记录');
      if (controls.length) throw new Error('锁定或归档须单独保存，不能与字段修改混合。');
      const table = tableFor(editor.tableId),
        values: Record<string, T2Cell> = {};
      let valid = true;
      for (const field of editor.fields) {
        field.error = null;
        try {
          const value = parseT5Input(field.field, field.input, state);
          if (value !== undefined) {
            if (field.field.id === table.export.titleFieldId && typeof value === 'string' && !value.trim())
              throw new Error('TITLE');
            if (!field.writable) throw new Error('LOCK');
            values[field.field.id] = value;
          }
        } catch {
          field.error = `${field.field.name}：请检查类型、范围、空值或引用。`;
          valid = false;
        }
      }
      if (editor.rowId === null) {
        for (const field of editor.fields.filter(
          f => f.field.required && !Object.hasOwn(values, f.field.id) && !Object.hasOwn(f.field, 'defaultValue'),
        )) {
          field.error = `${field.field.name}：必填，请选择“填写”后输入。`;
          valid = false;
        }
        if (valid)
          try {
            prepareT2NewRow(state.template, table.id, 'draft-row', values, { revision: state.data.revision });
          } catch {
            valid = false;
          }
      }
      if (!valid) {
        error = '有字段未通过校验，未加入暂存修改。';
        notify();
        return false;
      }
      if (!Object.keys(values).length) {
        error = '还没有填写新的值；“保持原值”不会产生修改。';
        notify();
        return false;
      }
      invalidate();
      const rowId = editor.rowId;
      const prior =
        rowId === null
          ? undefined
          : actions.find(a => a.kind !== 'insert' && a.tableId === table.id && a.rowId === rowId);
      if (prior?.kind === 'delete') throw new Error('该记录已暂存删除，请先移除删除操作。');
      if (prior?.kind === 'update') prior.values = { ...prior.values, ...values };
      else
        actions.push(
          rowId === null
            ? { kind: 'insert', tableId: table.id, values }
            : { kind: 'update', tableId: table.id, rowId, values },
        );
      editor = null;
      message = '已加入暂存修改，尚未保存。';
      notify();
      return true;
    },
    stageDelete(rowId: string, confirmed: boolean) {
      guard();
      if (unsent()) throw new Error('请先暂存或取消正在填写的记录，删除不会替你丢弃草稿。');
      if (!confirmed) throw new Error('删除需要明确确认');
      if (controls.length) throw new Error('控制操作须先单独保存');
      const table = tableFor(tableId),
        row = rowFor(tableId, rowId);
      if (table.locked || row.meta.locked || row.meta.lockedFieldIds.length || !table.permissions.manual.delete)
        throw new Error('记录锁定或禁止删除');
      if (findT2DeleteImpacts(state.template, state.data, { tableId, rowId }).length)
        throw new Error('此记录仍被引用。请先明确修改引用，系统不会级联删除或泄露隐藏引用详情。');
      if (actions.some(a => a.kind !== 'insert' && a.tableId === tableId && a.rowId === rowId))
        throw new Error('这条记录已有暂存操作');
      invalidate();
      actions.push({ kind: 'delete', tableId, rowId });
      editor = null;
      notify();
    },
    stageControl(
      rowId: string,
      kind: T5Control['kind'],
      fieldId: string | null,
      after: boolean,
      targetTableId = tableId,
    ) {
      guard();
      if (actions.length || unsent()) throw new Error('锁定/归档须单独提交；请先处理字段草稿。');
      const row = rowFor(targetTableId, rowId);
      const before =
        kind === 'field-lock'
          ? row.meta.lockedFieldIds.includes(fieldId ?? '')
          : kind === 'row-lock'
            ? row.meta.locked
            : row.meta.archived;
      const control: T5Control = { tableId: targetTableId, rowId, kind, fieldId, before, after };
      try {
        applyT5Controls(state, [control]);
      } catch {
        throw new Error('控制操作被拒绝：请检查表权限、行锁和字段锁；解锁必须先单独保存。');
      }
      if (
        controls.some(c => c.tableId === targetTableId && c.rowId === rowId && c.kind === kind && c.fieldId === fieldId)
      )
        throw new Error('此控制已暂存');
      invalidate();
      controls.push(control);
      editor = null;
      notify();
    },
    unstage(i: number) {
      guard();
      if (!Number.isSafeInteger(i) || i < 0 || i >= actions.length + controls.length) throw new Error('暂存项目不存在');
      invalidate();
      if (i < actions.length) actions.splice(i, 1);
      else controls.splice(i - actions.length, 1);
      notify();
    },
    async prepare() {
      guard();
      if (canonicalT4Json(service.view().head) !== canonicalT4Json(receipt.head)) throw new Error(messages.CONFLICT);
      if (unsent()) throw new Error('请先将正在填写的记录加入暂存修改。');
      if (!actions.length && !controls.length) throw new Error('没有暂存修改');
      if (actions.length > 32 || actions.filter(a => a.kind === 'insert').length > 10)
        throw new Error('每次最多 32 项修改、10 条新增，请分批保存。');
      busy = true;
      consent = false;
      error = null;
      notify();
      try {
        const spec = options.runSpec();
        if (controls.length) await service.prepareControls({ ...spec, controls: copy(controls) });
        else {
          const policy = createT3LocalPolicy(state.template, state.data);
          const regular = actions.filter(a => a.kind !== 'insert' || !a.importBatchId);
          const batches = actions
            .filter((a): a is Extract<T5Action, { kind: 'insert' }> => a.kind === 'insert' && !!a.importBatchId)
            .map(a => ({ ...compileT5Action(state, a), batchId: a.importBatchId!, policy }));
          if (regular.length) {
            const parts = regular.map(a => compileT5Action(state, a));
            batches.unshift({
              sql: parts.map(p => p.sql).join('\n'),
              parameters: parts.flatMap(p => p.parameters),
              batchId: `ed-${options.nextId()}`,
              policy,
            });
          }
          await service.prepareSql({ ...spec, kind: 'manual', batches });
        }
        receipt = service.view();
        prepared = true;
        preview = createT4PreviewModel(previewT4View(receipt));
        message = '请检查前后差异，再勾选确认保存。';
      } catch (caught) {
        prepared = false;
        preview = null;
        captureFailure(caught);
      } finally {
        busy = false;
        notify();
      }
    },
    consent(value: boolean) {
      if (busy) return;
      consent = value && prepared && receipt.status === 'private';
      notify();
    },
    async save() {
      guard();
      if (!view().canSave) throw new Error('请先校验、检查差异并勾选确认');
      if (service.view().draft?.commit?.fingerprint !== receipt.draft?.commit?.fingerprint)
        throw new Error(messages.CONFLICT);
      busy = true;
      notify();
      try {
        receipt = await service.save();
        state = receipt.formal;
        index();
        if (receipt.status === 'saved') {
          actions = [];
          controls = [];
          editor = null;
          prepared = false;
          message = '模拟存档已保存并读回确认；仍未写当前酒馆聊天。';
          importPreview = null;
        }
        preview = createT4PreviewModel(previewT4View(receipt));
        error = null;
        consent = false;
      } catch (caught) {
        captureFailure(caught);
      } finally {
        busy = false;
        notify();
      }
    },
    async reconcile() {
      if (options.canEdit && !options.canEdit()) throw new Error('请先核对或结束结构草稿，不能从资料页接管迁移。');
      if (busy) throw new Error(messages.BUSY);
      if (!prepared && (actions.length || controls.length || unsent()))
        throw new Error('尚无待核对的提交；填写草稿仍保留，请先校验预览或明确取消。');
      busy = true;
      notify();
      try {
        receipt = await service.reconcile();
        if (receipt.status === 'saved') {
          state = receipt.formal;
          history = null;
          index();
          actions = [];
          controls = [];
          editor = null;
          prepared = false;
          message = '已核对保存结果并载入确认版本。';
        }
        preview = createT4PreviewModel(previewT4View(receipt));
        error = null;
        consent = false;
      } catch (caught) {
        captureFailure(caught);
      } finally {
        busy = false;
        notify();
      }
    },
    async reload(discard: boolean) {
      if (options.canEdit && !options.canEdit()) throw new Error('请先保存或取消结构草稿，再重新载入资料。');
      if (busy || receipt.status === 'pending') throw new Error(messages[busy ? 'BUSY' : 'PENDING']);
      if ((actions.length || controls.length || unsent()) && !discard)
        throw new Error('请明确确认放弃未保存草稿后再载入。');
      busy = true;
      notify();
      try {
        service.cancelDraft();
        receipt = await service.reconcile();
        state = receipt.formal;
        history = null;
        index();
        actions = [];
        controls = [];
        editor = null;
        prepared = false;
        preview = null;
        consent = false;
        error = null;
        importPreview = null;
      } catch (caught) {
        captureFailure(caught);
      } finally {
        busy = false;
        notify();
      }
    },
    async history(commitId: string | null) {
      guard();
      if (actions.length || controls.length || unsent()) throw new Error('请先保存或取消草稿，再查看历史。');
      busy = true;
      notify();
      try {
        state = await recoverT4Snapshot(await options.readArchive(), commitId);
        history = commitId ?? 'genesis';
        index();
        editor = null;
        preview = null;
        message = '历史快照只读；查看不会恢复或覆盖当前世界。';
      } catch {
        error = '历史快照未通过校验。';
      } finally {
        busy = false;
        notify();
      }
    },
    /** Adopt an already confirmed external T9 commit. Never erase a user draft or touch storage. */
    refreshSaved() {
      if (busy || actions.length || controls.length || unsent() || history !== null) return false;
      const live = service.view();
      if (live.status !== 'saved') return false;
      receipt = live;
      state = receipt.formal;
      editor = null;
      prepared = false;
      preview = null;
      consent = false;
      error = null;
      importPreview = null;
      index();
      notify();
      return true;
    },
    loadImport(input: unknown) {
      guard();
      sheets = readT5Sheets(input);
      importPreview = null;
      notify();
    },
    async previewImport(plan: T5ImportPlan) {
      guard();
      const sheet = sheets.find(s => s.id === plan.sheetId);
      if (!sheet) throw new Error('来源表不存在');
      busy = true;
      notify();
      try {
        importPreview = await previewT5Import(state, sheet, plan);
        error = null;
      } catch {
        error = '导入映射无效，请检查来源、表和字段；未读取或修改前置插件。';
      } finally {
        busy = false;
        notify();
      }
    },
    stageImport(indices: number[]) {
      guard();
      if (!importPreview || controls.length) throw new Error('先完成映射预览，且不要混合控制操作');
      const selected = selectT5Import(importPreview, indices);
      for (const a of selected)
        if (actions.some(b => a.kind === 'insert' && b.kind === 'insert' && a.importBatchId === b.importBatchId))
          throw new Error('来源行已在暂存中');
      invalidate();
      actions.push(...copy(selected));
      notify();
    },
    dirty() {
      return actions.length > 0 || controls.length > 0 || unsent();
    },
    draftFingerprint() {
      return canonicalT4Json({ actions, controls, editor });
    },
  };
}
export type T5Workbench = ReturnType<typeof createT5Workbench>;
