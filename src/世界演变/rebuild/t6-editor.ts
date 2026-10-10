/** T6 edits the canonical T2 template only. No alternate SQLite schema or host writes. */
import {
  cloneT2Json,
  normalizeT2Template,
  type T2Field,
  type T2FieldType,
  type T2Table,
  type T2Template,
} from './t2-template';

export const T6_TYPES: T2FieldType[] = [
  'text',
  'integer',
  'number',
  'decimal',
  'boolean',
  'enum',
  'string-list',
  'reference',
  'reference-list',
  'world-time',
];
const controls: Record<T2FieldType, T2Field['control']> = {
  text: 'multiline',
  integer: 'integer',
  number: 'number',
  decimal: 'decimal',
  boolean: 'toggle',
  enum: 'select',
  'string-list': 'string-list',
  reference: 'reference',
  'reference-list': 'reference-list',
  'world-time': 'world-time',
};
export const copyT6 = <T>(input: T): T => cloneT2Json(input) as unknown as T;

export function newT6Field(id: string, name = id, type: T2FieldType = 'text', template?: T2Template): T2Field {
  const constraints: T2Field['constraints'] =
    type === 'enum'
      ? { enumValues: ['待定'] }
      : type === 'decimal'
        ? { precision: 12, scale: 2 }
        : type === 'world-time'
          ? { calendarId: template?.calendars[0].id ?? 'demo-calendar' }
          : type === 'reference' || type === 'reference-list'
            ? { reference: { tableIds: [template?.tables[0].id ?? 'npc'], onDelete: 'restrict' } }
            : {};
  return {
    id,
    sqlName: `f_${id.replaceAll('-', '_')}`,
    name,
    description: '',
    type,
    nullable: true,
    required: false,
    readonly: false,
    hiddenUi: false,
    permissions: { manualWrite: true, aiWrite: true },
    visibility: { user: true, evolutionAi: true, mainAi: true },
    constraints,
    control: controls[type],
  };
}

/** Type switches reset type-specific options explicitly in the editable draft, never business data. */
export function typeT6Field(field: T2Field, type: T2FieldType, template: T2Template): T2Field {
  const fresh = newT6Field(field.id, field.name, type, template);
  const next = { ...copyT6(field), type, control: fresh.control, constraints: fresh.constraints };
  delete next.defaultValue;
  if (type !== 'world-time') delete next.semantic;
  return next;
}

export function newT6Table(id: string, name: string, groupId: 'macro' | 'micro'): T2Table {
  return {
    id,
    sqlName: `we_${id.replaceAll('-', '_')}`,
    name,
    description: '',
    groupId,
    purpose: 'custom',
    fields: [{ ...newT6Field('name', '名称'), required: true, nullable: false, control: 'single-line' }],
    visibility: { user: true, evolutionAi: true, mainAi: true },
    locked: false,
    permissions: {
      manual: { insert: true, update: true, archive: true, delete: true },
      ai: { insert: true, update: true, archive: true, delete: false },
    },
    rules: { initialize: '', insert: '', update: '', archive: '', delete: '' },
    runtime: {
      enabled: true,
      frequency: { state: 'inherit' },
      budget: { state: 'inherit' },
      api: { state: 'inherit' },
    },
    context: { settings: { state: 'inherit' }, fieldIds: ['name'], relatedTableIds: [] },
    export: {
      enabled: false,
      mode: 'per-row',
      fieldIds: ['name'],
      titleFieldId: 'name',
      keyFieldIds: [],
      prefix: 'WorldEvolution-',
      maxChars: 8000,
      includeArchived: false,
    },
  };
}

/** Removing a field also removes its own presentation selections; inbound references are NOT silently removed. */
export function dropT6Field(table: T2Table, fieldId: string): T2Table {
  const next = copyT6(table);
  if (!next.fields.some(f => f.id === fieldId) || next.fields.length === 1) throw new Error('至少保留一个字段。');
  next.fields = next.fields.filter(f => f.id !== fieldId);
  next.context.fieldIds = next.context.fieldIds.filter(id => id !== fieldId);
  next.export.fieldIds = next.export.fieldIds.filter(id => id !== fieldId);
  next.export.keyFieldIds = next.export.keyFieldIds.filter(id => id !== fieldId);
  if (next.export.titleFieldId === fieldId) next.export.titleFieldId = null;
  return next;
}

export function moveT6<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const result = [...items],
    target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return result;
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function versionT6Template(base: T2Template, input: unknown): T2Template {
  const draft = normalizeT2Template(input);
  if (draft.id !== base.id || draft.schemaVersion !== base.schemaVersion || draft.dataVersion !== base.dataVersion)
    throw new Error('不能在结构编辑中替换世界模板身份或协议。');
  draft.templateVersion = base.templateVersion + 1;
  return normalizeT2Template(draft);
}
