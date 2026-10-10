/** Structure workbench controller. Uses the SAME T4 world authority as the data editor. */
import {
  normalizeT2Template,
  resolveT2TableSettings,
  type T2Table,
  type T2Field,
  type T2Template,
} from './t2-template';
import { createT2EmptyWorld } from './t2-values';
import { createT3LocalPolicy } from './t3-engine';
import { freezeT3Request, normalizeT3Result } from './t3-result';
import { canonicalT4Json, type T4State } from './t4-protocol';
import { previewT4View, type T4CommitService, type T4Executor, type T4RunSpec } from './t4-service';
import { createT4PreviewModel, type T4PreviewModel } from './t4-preview';
import { copyT6, dropT6Field, moveT6, newT6Field, newT6Table } from './t6-editor';
import { exportT6Ddl, importT6Ddl } from './t6-ddl';
import { planT6Migration, type T6MigrationOptions, type T6MigrationReport } from './t6-migration';
import type { T6DefaultStore } from './t6-defaults';

const same = (a: unknown, b: unknown) => canonicalT4Json(a) === canonicalT4Json(b);
export interface T6View {
  notice: string;
  busy: boolean;
  dirty: boolean;
  error: string | null;
  message: string;
  template: T2Template | null;
  tableId: string;
  fieldId: string;
  revision: number;
  version: number;
  report: T6MigrationReport | null;
  preview: T4PreviewModel | null;
  consent: boolean;
  canSave: boolean;
  options: T6MigrationOptions;
  pending: boolean;
  defaultRevision: number | null;
  resolved: ReturnType<typeof resolveT2TableSettings> | null;
  sourceFields: T2Field[];
}

/** Fresh temporary SQLite loads/exports the ENTIRE candidate, including constraints and presence metadata. */
export async function validateT6Sqlite(state: T4State, execute: T4Executor): Promise<void> {
  const table = state.template.tables.find(t => t.visibility.user && t.fields.some(f => f.visibility.user));
  if (!table) throw new Error('至少保留一张用户可读表');
  const request = freezeT3Request({
    template: state.template,
    data: state.data,
    sql: `SELECT "__we_row_id" FROM "${table.sqlName}" LIMIT 0;`,
    parameters: [],
    batchId: 't6-validation',
    policy: createT3LocalPolicy(state.template, state.data, 'manual'),
    limits: { maxAffectedRows: 0, maxNewRows: 0, maxQueryRows: 0 },
  });
  const result = normalizeT3Result(await execute(request), request);
  if (!same(result.data, state.data) || result.changedRows.length !== 0 || result.allocations.length !== 0)
    throw new Error('临时 SQLite 改变了迁移快照');
}

export function createT6Workbench(options: {
  service: T4CommitService;
  execute: T4Executor;
  runSpec: () => T4RunSpec;
  defaults: T6DefaultStore;
  dataIdle: () => boolean;
  afterSaved: () => Promise<void>;
}) {
  const { service } = options;
  let base = service.view().formal,
    draft = copyT6(base.template);
  let tableId = draft.tables.find(t => t.visibility.user)?.id ?? '',
    fieldId = '';
  let migration: T6MigrationOptions = { mappings: [], allowRemoval: false };
  let report: T6MigrationReport | null = null,
    preview: T4PreviewModel | null = null;
  let consent = false,
    busy = false,
    error: string | null = null,
    message = '',
    preparedId: string | null = null;
  let defaultRevision: number | null = null;
  let ownedDraft: string | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const publicDefinitions = () =>
    base.template.tables.every(t => t.visibility.user && t.fields.every(f => f.visibility.user));
  const dirty = () => !same(draft, base.template) || migration.mappings.length > 0 || preparedId !== null;
  const guard = () => {
    if (busy || ['pending', 'saving'].includes(service.view().status))
      throw new Error('正在保存或等待确认，先核对结果');
    if (!options.dataIdle()) throw new Error('请先保存或取消资料草稿，并返回当前世界');
    if (
      service.view().draft &&
      service.view().status !== 'saved' &&
      canonicalT4Json(service.view().draft) !== ownedDraft
    )
      throw new Error('其他运行或提交正在占用世界');
    if (!dirty() && service.view().status === 'saved' && !same(service.view().formal, base)) reset();
    if (!publicDefinitions()) throw new Error('含非公开结构定义；此工作台不展开或修改它们');
  };
  const invalidate = () => {
    if (preparedId) service.cancelDraft();
    preparedId = null;
    ownedDraft = null;
    consent = false;
    report = null;
    preview = null;
    error = null;
    message = '';
  };
  const reset = () => {
    base = service.view().formal;
    draft = copyT6(base.template);
    migration = { mappings: [], allowRemoval: false };
    preparedId = null;
    ownedDraft = null;
    consent = false;
    if (!draft.tables.some(t => t.id === tableId)) tableId = draft.tables.find(t => t.visibility.user)?.id ?? '';
    if (!draft.tables.find(t => t.id === tableId)?.fields.some(f => f.id === fieldId)) fieldId = '';
  };
  const capture = (caught: unknown) => {
    const code = caught && typeof caught === 'object' && 'code' in caught ? String(caught.code) : '';
    error =
      code === 'PENDING'
        ? '保存结果待核对；不要重复提交。'
        : code === 'CONFLICT'
          ? '世界已变化，不能覆盖；草稿保留，请取消后重新载入。'
          : code === 'SAVE_FAILED'
            ? '保存失败，原存档不变，草稿保留。'
            : code === 'ANCHOR'
              ? '没有有效模拟楼层锚点，仅能预览草稿。'
              : '操作未完成：请检查结构、映射、权限或并行草稿。原存档未被直接覆盖。';
    consent = false;
    if (preparedId) preview = createT4PreviewModel(previewT4View(service.view()));
  };
  const edit = (fn: (template: T2Template) => void) => {
    guard();
    const next = copyT6(draft);
    fn(next);
    invalidate();
    draft = next;
    notify();
  };
  const view = (): T6View => {
    let resolved: T6View['resolved'] = null;
    if (publicDefinitions())
      try {
        resolved = resolveT2TableSettings(draft, tableId);
      } catch {
        /* draft may be temporarily invalid */
      }
    const receipt = service.view();
    return copyT6({
      notice: '独立本地沙盒：未写实际聊天、API、世界书。结构草稿关闭或刷新会丢失；保存前先预览。',
      busy,
      dirty: dirty(),
      error,
      message,
      template: publicDefinitions() ? draft : null,
      tableId,
      fieldId,
      revision: receipt.formal.data.revision,
      version: receipt.formal.template.templateVersion,
      report,
      preview,
      consent,
      options: migration,
      pending: receipt.status === 'pending',
      defaultRevision,
      resolved,
      sourceFields: publicDefinitions() ? (base.template.tables.find(t => t.id === tableId)?.fields ?? []) : [],
      canSave:
        !busy &&
        consent &&
        !!preparedId &&
        !!receipt.draft?.commit &&
        receipt.draft.commit.commitId === preparedId &&
        same(receipt.head, receipt.draft.base) &&
        ['private', 'failed'].includes(receipt.status) &&
        report?.valid === true,
    });
  };
  return {
    isBusy: () => busy,
    /** Adopt confirmed external commits without discarding a structure draft or touching storage. */
    refreshSaved() {
      if (busy || dirty() || service.view().status !== 'saved') return false;
      reset();
      notify();
      return true;
    },
    view,
    dirty,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectTable(id: string) {
      if (!draft.tables.some(t => t.id === id && t.visibility.user)) throw new Error('未知表');
      tableId = id;
      fieldId = '';
      notify();
    },
    selectField(id: string) {
      if (!draft.tables.find(t => t.id === tableId)?.fields.some(f => f.id === id && f.visibility.user))
        throw new Error('未知字段');
      fieldId = id;
      notify();
    },
    edit,
    table(patch: Partial<T2Table>) {
      edit(t => {
        const i = t.tables.findIndex(table => table.id === tableId);
        if (Object.hasOwn(patch, 'id') || Object.hasOwn(patch, 'sqlName')) throw new Error('身份不可修改');
        t.tables[i] = { ...t.tables[i], ...copyT6(patch) };
      });
    },
    field(patch: Partial<T2Field>) {
      edit(t => {
        const table = t.tables.find(t => t.id === tableId)!;
        const i = table.fields.findIndex(f => f.id === fieldId);
        if (i < 0 || Object.hasOwn(patch, 'id') || Object.hasOwn(patch, 'sqlName')) throw new Error('身份不可修改');
        const changedType = patch.type && patch.type !== table.fields[i].type;
        table.fields[i] = { ...table.fields[i], ...copyT6(patch) };
        if (changedType && !Object.hasOwn(patch, 'defaultValue')) delete table.fields[i].defaultValue;
      });
    },
    addTable(id: string, name: string, group: 'macro' | 'micro') {
      edit(t => {
        if (t.tables.some(table => table.id === id)) throw new Error('表ID重复');
        t.tables.push(newT6Table(id, name, group));
      });
      tableId = id;
      notify();
    },
    addField(id: string, name: string) {
      edit(t => {
        const table = t.tables.find(t => t.id === tableId)!;
        if (table.fields.some(f => f.id === id)) throw new Error('字段ID重复');
        table.fields.push(newT6Field(id, name, 'text', t));
      });
      fieldId = id;
      notify();
    },
    moveTable(delta: -1 | 1) {
      edit(t => {
        t.tables = moveT6(
          t.tables,
          t.tables.findIndex(table => table.id === tableId),
          delta,
        );
      });
    },
    moveField(delta: -1 | 1) {
      edit(t => {
        const table = t.tables.find(t => t.id === tableId)!;
        table.fields = moveT6(
          table.fields,
          table.fields.findIndex(f => f.id === fieldId),
          delta,
        );
      });
    },
    dropTable() {
      edit(t => {
        if (t.tables.length < 2) throw new Error('至少保留一张表');
        t.tables = t.tables.filter(t => t.id !== tableId);
      });
      tableId = draft.tables[0].id;
      fieldId = '';
      notify();
    },
    dropField() {
      edit(t => {
        const i = t.tables.findIndex(t => t.id === tableId);
        t.tables[i] = dropT6Field(t.tables[i], fieldId);
      });
      fieldId = '';
      notify();
    },
    mappings(input: T6MigrationOptions) {
      guard();
      const next = copyT6(input);
      invalidate();
      migration = next;
      notify();
    },
    importDdl(text: string, group: 'macro' | 'micro') {
      guard();
      const next = importT6Ddl(draft, text, group);
      invalidate();
      draft = next;
      notify();
    },
    exportDdl() {
      guard();
      return exportT6Ddl(draft);
    },
    replaceTemplate(input: unknown) {
      guard();
      const next = normalizeT2Template(input);
      if (next.id !== base.template.id) throw new Error('模板身份不可替换');
      invalidate();
      draft = next;
      tableId = draft.tables[0].id;
      fieldId = '';
      notify();
    },
    consent(value: boolean) {
      consent = value;
      notify();
    },
    async prepare() {
      try {
        guard();
        invalidate();
        busy = true;
        notify();
        const head = service.view().head;
        if (!same(service.view().formal, base)) throw Object.assign(new Error(), { code: 'CONFLICT' });
        const plan = planT6Migration(base, draft, migration);
        report = plan.report;
        notify();
        if (!plan.state) {
          error = '迁移预检未通过；请按报告处理，不会保存半份结构。';
          return;
        }
        await validateT6Sqlite(plan.state, options.execute);
        if (
          !same(service.view().head, head) ||
          !options.dataIdle() ||
          (service.view().draft && service.view().status !== 'saved')
        )
          throw Object.assign(new Error(), { code: 'CONFLICT' });
        const spec = options.runSpec(),
          prepared = await service.prepareMigration({ ...spec, state: plan.state });
        preparedId = spec.commitId;
        ownedDraft = canonicalT4Json(prepared);
        preview = createT4PreviewModel(previewT4View(service.view()));
        message = prepared.commit
          ? '整图与临时 SQLite 校验通过；模板、资料和版本将一次保存。'
          : '校验通过，但没有模拟楼层锚点，仅为草稿。';
      } catch (caught) {
        capture(caught);
      } finally {
        busy = false;
        notify();
      }
    },
    async save() {
      try {
        guard();
        if (!view().canSave) throw new Error('先校验并确认');
        busy = true;
        notify();
        await service.save();
        reset();
        await options.afterSaved();
        preview = createT4PreviewModel(previewT4View(service.view()));
        message = '当前模拟世界已保存；其他世界与新世界默认模板未被更改。';
        error = null;
      } catch (caught) {
        capture(caught);
      } finally {
        busy = false;
        notify();
      }
    },
    async reconcile() {
      try {
        if (busy || !preparedId || !['pending', 'failed'].includes(service.view().status))
          throw new Error('没有待核对的本次迁移');
        busy = true;
        notify();
        const id = preparedId,
          receipt = await service.reconcile();
        if (receipt.lastCommit?.commitId === id) {
          reset();
          await options.afterSaved();
          message = '已核对本次完整迁移，不重复提交。';
        }
        preview = createT4PreviewModel(previewT4View(service.view()));
        error = null;
      } catch (caught) {
        capture(caught);
      } finally {
        busy = false;
        notify();
      }
    },
    async discard() {
      if (busy || service.view().status === 'pending' || !options.dataIdle())
        throw new Error('先核对保存或结束其他草稿');
      if (
        service.view().draft &&
        service.view().status !== 'saved' &&
        canonicalT4Json(service.view().draft) !== ownedDraft
      )
        throw new Error('不能取消其他提交');
      invalidate();
      reset();
      report = null;
      preview = null;
      await options.afterSaved();
      reset();
      message = '已取消结构草稿并载入当前已保存世界。';
      notify();
    },
    async saveDefault(confirmed: boolean) {
      try {
        guard();
        if (!confirmed || preparedId) throw new Error('明确确认默认范围，且先结束当前迁移预览');
        busy = true;
        notify();
        const template = normalizeT2Template(draft);
        const current = await options.defaults.read();
        if (defaultRevision === null || current.revision !== defaultRevision)
          throw new Error('默认模板尚未载入或已变化');
        await validateT6Sqlite(
          { template, data: createT2EmptyWorld(template, 't6-default', 't6-default') },
          options.execute,
        );
        const saved = await options.defaults.save(current.fingerprint, template);
        defaultRevision = saved.revision;
        message = '仅保存为新世界默认模板；当前世界仍是原版本，现有世界不会被覆盖。';
        error = null;
      } catch (caught) {
        capture(caught);
      } finally {
        busy = false;
        notify();
      }
    },
    async readDefault() {
      if (busy) throw new Error('正在执行，请稍候');
      const receipt = await options.defaults.read();
      defaultRevision = receipt.revision;
      message = '已读取独立默认模板版本，未套用到当前世界。';
      error = null;
      notify();
      // Only expose the revision, not potentially nonpublic definitions of another scope.
      return defaultRevision;
    },
  };
}
export type T6Workbench = ReturnType<typeof createT6Workbench>;
