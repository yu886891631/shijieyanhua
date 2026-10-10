/** Pure migration planner. Old snapshots are immutable; no implicit default backfill or cascade. */
import { z } from 'zod';
import {
  cloneT2Json,
  compareT2Templates,
  type T2Cell,
  type T2Field,
  type T2Template,
  type T2TemplateChange,
} from './t2-template';
import { normalizeT2WorldData, validateT2Cell } from './t2-values';
import { canonicalT4Json, normalizeT4State, type T4State } from './t4-protocol';
import { copyT6, versionT6Template } from './t6-editor';
import { parseT3Sql } from './t3-sql';

export type T6Conversion = 'identity' | 'text-integer' | 'text-number' | 'scalar-text';
export interface T6Mapping {
  tableId: string;
  fieldId: string;
  fromFieldId: string | null;
  conversion: T6Conversion;
  fill?: T2Cell;
}
export interface T6MigrationOptions {
  mappings: T6Mapping[];
  allowRemoval: boolean;
}
export interface T6Issue {
  path: string;
  message: string;
}
export interface T6MigrationReport {
  valid: boolean;
  changes: T2TemplateChange[];
  issues: T6Issue[];
  removed: { path: string; records: number; values: number }[];
  mappings: { path: string; from: string; conversion: T6Conversion; filled: number }[];
  references: string[];
  changedRows: number;
  recovery: string;
}
export interface T6MigrationPlan {
  report: T6MigrationReport;
  state: T4State | null;
}
const id = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/)
  .refine(v => !['constructor', 'prototype'].includes(v));
const optionsSchema = z.strictObject({
  allowRemoval: z.boolean(),
  mappings: z
    .array(
      z.strictObject({
        tableId: id,
        fieldId: id,
        fromFieldId: id.nullable(),
        conversion: z.enum(['identity', 'text-integer', 'text-number', 'scalar-text']),
        fill: z.unknown().optional(),
      }),
    )
    .max(1024),
});
const same = (a: unknown, b: unknown) => canonicalT4Json(a) === canonicalT4Json(b);

function convert(value: T2Cell, conversion: T6Conversion): T2Cell {
  if (conversion === 'identity' || value === null) return copyT6(value);
  if (conversion === 'scalar-text') {
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('只允许标量转文字');
    return String(value);
  }
  if (
    typeof value !== 'string' ||
    !(conversion === 'text-integer' ? /^-?(?:0|[1-9]\d*)$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).test(value)
  )
    throw new Error('需要完整十进制文字，不接受空白、指数或截断');
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    Math.abs(n) > Number.MAX_SAFE_INTEGER ||
    Object.is(n, -0) ||
    (conversion === 'text-integer' && !Number.isSafeInteger(n))
  )
    throw new Error('超出无损数值范围');
  // Reject loss of significant decimal digits (including underflow); trailing zeros are formatting only.
  if (conversion === 'text-number') parseT3Sql(`INSERT INTO we_probe (f_probe) VALUES (${value});`);
  const significant = value.replace(/^-/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  if (conversion === 'text-number' && significant.length > 15) throw new Error('超过首版 15 位有效数字范围');
  return n;
}

/** Returns only public diagnostics. Internal candidate data is not a UI model. */
export function planT6Migration(
  baseInput: T4State,
  templateInput: unknown,
  optionsInput: T6MigrationOptions,
): T6MigrationPlan {
  const base = normalizeT4State(baseInput);
  const report: T6MigrationReport = {
    valid: false,
    changes: [],
    issues: [],
    removed: [],
    mappings: [],
    references: [],
    changedRows: 0,
    recovery: '旧模板与旧资料保留在同一模拟账本中；恢复旧检查点不会重跑 AI。当前只有本地沙盒，不是聊天备份。',
  };
  const issue = (path: string, message: string) => {
    if (report.issues.length < 200) report.issues.push({ path, message });
  };
  let next: T2Template, options: T6MigrationOptions;
  try {
    next = versionT6Template(base.template, templateInput);
    options = optionsSchema.parse(cloneT2Json(optionsInput)) as T6MigrationOptions;
  } catch {
    issue('template', '模板或迁移方案无效：检查标识符、类型、引用、默认值和结构参数。');
    return { report, state: null };
  }
  const definitionsPublic = (template: T2Template) =>
    template.tables.every(t => t.visibility.user && t.fields.every(f => f.visibility.user));
  const allPublic = definitionsPublic(base.template) && definitionsPublic(next);
  const structural = compareT2Templates(base.template, next).changes;
  report.changes = allPublic
    ? structural
    : [{ kind: 'migration-required', path: 'template', reason: '含非公开定义，差异不展开。' }];
  if (same({ ...base.template, templateVersion: next.templateVersion }, next))
    issue('template', '没有结构或参数变化，不提交空迁移。');
  if (!next.tables.some(t => t.visibility.user && t.fields.some(f => f.visibility.user && !f.hiddenUi)))
    issue('template', '至少保留一张用户可查看、含可显示字段的表。');
  const map = new Map<string, T6Mapping>();
  for (const mapping of options.mappings) {
    const k = `${mapping.tableId}/${mapping.fieldId}`;
    const target = next.tables.find(t => t.id === mapping.tableId),
      old = base.template.tables.find(t => t.id === mapping.tableId);
    if (
      map.has(k) ||
      !target?.visibility.user ||
      !target.fields.some(f => f.id === mapping.fieldId && f.visibility.user) ||
      (mapping.fromFieldId !== null && !old?.fields.some(f => f.id === mapping.fromFieldId && f.visibility.user))
    ) {
      issue('mapping', '映射重复、未知或非公开；未采用。');
      continue;
    }
    if (
      mapping.fromFieldId === null &&
      old?.fields.some(f => f.id === mapping.fieldId) &&
      base.data.tables[mapping.tableId].some(r => Object.hasOwn(r.values, mapping.fieldId))
    ) {
      issue('mapping', '已有字段不能忽略已有值来套用缺失补充；保留原字段作为来源，或先在资料页明确修改。');
      continue;
    }
    map.set(k, mapping);
    report.mappings.push({ path: k, from: mapping.fromFieldId ?? '无旧值', conversion: mapping.conversion, filled: 0 });
  }
  const draft: T4State = {
    template: next,
    data: { ...copyT6(base.data), templateVersion: next.templateVersion, tables: {} },
  };
  const protectedIssue = () =>
    issue('protected', '变更涉及未公开、锁定或禁止人工修改的内容。先在原结构单独处理，不能同批解锁绕过。');
  for (const oldTable of base.template.tables) {
    const table = next.tables.find(t => t.id === oldTable.id);
    if (!oldTable.visibility.user && (!table || !same(table, oldTable))) protectedIssue();
    for (const oldField of oldTable.fields)
      if (
        !oldField.visibility.user &&
        (!table || !same(table.fields.find(f => f.id === oldField.id) ?? null, oldField))
      )
        protectedIssue();
    if (!table) {
      const rows = base.data.tables[oldTable.id];
      if (
        oldTable.visibility.user &&
        oldTable.fields.every(f => f.visibility.user) &&
        rows.every(r => r.meta.visibility.user)
      )
        report.removed.push({
          path: oldTable.id,
          records: rows.length,
          values: rows.reduce((n, r) => n + Object.keys(r.values).length, 0),
        });
      if (!options.allowRemoval) issue('removal', '删除表/字段需单独确认移除内容，旧版本仍保留。');
      if (
        oldTable.locked ||
        !oldTable.permissions.manual.delete ||
        rows.some(r => !r.meta.visibility.user || r.meta.locked || r.meta.lockedFieldIds.length)
      )
        protectedIssue();
      continue;
    }
    for (const oldField of oldTable.fields.filter(f => !table.fields.some(n => n.id === f.id))) {
      const rows = base.data.tables[oldTable.id];
      if (oldTable.visibility.user && oldField.visibility.user && rows.every(r => r.meta.visibility.user))
        report.removed.push({
          path: `${table.id}/${oldField.id}`,
          records: 0,
          values: rows.filter(r => Object.hasOwn(r.values, oldField.id)).length,
        });
      if (!options.allowRemoval) issue('removal', '删除表/字段需单独确认移除内容，旧版本仍保留。');
    }
  }
  for (const table of next.tables) {
    const oldTable = base.template.tables.find(t => t.id === table.id);
    draft.data.tables[table.id] = [];
    for (const original of base.data.tables[table.id] ?? []) {
      const row = copyT6(original);
      row.values = {};
      for (const field of table.fields) {
        const k = `${table.id}/${field.id}`,
          mapping = map.get(k);
        const sourceId = mapping ? mapping.fromFieldId : field.id;
        const oldField = oldTable?.fields.find(f => f.id === sourceId);
        const hasSource = sourceId !== null && Object.hasOwn(original.values, sourceId);
        const diagnosticPath =
          table.visibility.user && field.visibility.user && original.meta.visibility.user
            ? `${k}/${original.meta.id}`
            : 'protected';
        try {
          let value: T2Cell | undefined;
          if (hasSource) value = convert(original.values[sourceId!], mapping?.conversion ?? 'identity');
          else if (mapping && Object.hasOwn(mapping, 'fill')) {
            value = copyT6(mapping.fill!);
            report.mappings.find(m => m.path === k)!.filled += diagnosticPath === 'protected' ? 0 : 1;
          }
          if (value === undefined) {
            if (field.required) throw new Error('缺必填值');
          } else row.values[field.id] = validateT2Cell(field, value, next);
          if (hasSource && oldField?.type === 'world-time' && field.type === 'world-time' && value !== null) {
            const oldCalendar = base.template.calendars.find(c => c.id === oldField.constraints.calendarId),
              calendar = next.calendars.find(c => c.id === field.constraints.calendarId);
            if (
              !oldCalendar ||
              !calendar ||
              oldCalendar.id !== calendar.id ||
              oldCalendar.epoch !== calendar.epoch ||
              oldCalendar.minutesPerDay !== calendar.minutesPerDay
            )
              throw new Error('历法语义改变');
          }
        } catch {
          issue(
            diagnosticPath,
            diagnosticPath === 'protected'
              ? '非公开内容未通过预检；未显示值或身份。'
              : '旧值、转换或补充值不符合新类型/必填/枚举/引用/历法要求；不自动截断或清空。',
          );
        }
      }
      // Check ORIGINAL authority; changing permissions in the new template cannot authorize this migration's writes.
      for (const oldField of oldTable?.fields ?? []) {
        const newField = table.fields.find(f => f.id === oldField.id);
        const changed =
          Object.hasOwn(original.values, oldField.id) !== Object.hasOwn(row.values, oldField.id) ||
          (Object.hasOwn(original.values, oldField.id) &&
            !same(original.values[oldField.id], row.values[oldField.id] ?? null)) ||
          (original.meta.lockedFieldIds.includes(oldField.id) && !newField) ||
          (Object.hasOwn(original.values, oldField.id) && newField && oldField.type !== newField.type);
        if (
          changed &&
          (!oldTable!.visibility.user ||
            !original.meta.visibility.user ||
            oldTable!.locked ||
            !oldTable!.permissions.manual.update ||
            original.meta.locked ||
            original.meta.lockedFieldIds.includes(oldField.id) ||
            !oldField.visibility.user ||
            oldField.readonly ||
            !oldField.permissions.manualWrite)
        )
          protectedIssue();
      }
      for (const field of table.fields.filter(f => !oldTable?.fields.some(o => o.id === f.id)))
        if (
          Object.hasOwn(row.values, field.id) &&
          (oldTable?.locked ||
            !oldTable?.permissions.manual.update ||
            original.meta.locked ||
            !original.meta.visibility.user ||
            !field.visibility.user ||
            field.readonly ||
            !field.permissions.manualWrite)
        )
          protectedIssue();
      if (!same(original.values, row.values) && original.meta.visibility.user && table.visibility.user)
        report.changedRows += 1;
      draft.data.tables[table.id].push(row);
    }
    for (const f of table.fields) {
      const old = oldTable?.fields.find(o => o.id === f.id);
      if (f.constraints.reference && (!old || !same(old.constraints.reference ?? null, f.constraints.reference)))
        if (table.visibility.user && f.visibility.user)
          report.references.push(`${table.id}/${f.id} → ${f.constraints.reference.tableIds.join(', ')}`);
    }
  }
  try {
    draft.data = normalizeT2WorldData(next, draft.data);
  } catch {
    issue('graph', '整图引用、字段锁或必填校验失败。被移除表仍有引用时，必须先处理引用，不自动级联删除。');
  }
  report.valid = report.issues.length === 0;
  return { report, state: report.valid ? normalizeT4State(draft) : null };
}
