/** Separate fake global-default authority. It cannot mutate any existing world. */
import { normalizeT2Template, cloneT2Json, type T2Template } from './t2-template';
import { createT2EmptyWorld } from './t2-values';
import { fingerprintT4, type T4State } from './t4-protocol';

export interface T6DefaultReceipt {
  format: 't6-sandbox-default';
  revision: number;
  fingerprint: string;
  template: T2Template;
}
export interface T6DefaultStore {
  mode: 't6-sandbox-defaults';
  read(): Promise<T6DefaultReceipt>;
  save(expected: string, template: T2Template): Promise<T6DefaultReceipt>;
}
const copy = <T>(input: T): T => cloneT2Json(input) as unknown as T;
async function receipt(template: T2Template, revision: number): Promise<T6DefaultReceipt> {
  const body = { format: 't6-sandbox-default' as const, revision, template: normalizeT2Template(template) };
  for (const table of body.template.tables)
    for (const field of table.fields)
      if (
        (field.type === 'reference' && field.defaultValue !== undefined && field.defaultValue !== null) ||
        (field.type === 'reference-list' && Array.isArray(field.defaultValue) && field.defaultValue.length > 0)
      )
        throw new Error('新世界默认模板不能携带旧世界记录引用；设为 NULL/空列表或取消默认值。');
  return { ...body, fingerprint: await fingerprintT4(body) };
}
export async function createT6DefaultStore(template: T2Template, serialized?: string) {
  let current = await receipt(template, 0),
    fail = false;
  if (serialized !== undefined) {
    if (serialized.length > 4_000_000) throw new Error('默认模板存档过大');
    const raw = cloneT2Json(JSON.parse(serialized)) as unknown as T6DefaultReceipt;
    if (
      raw.format !== 't6-sandbox-default' ||
      !Number.isSafeInteger(raw.revision) ||
      raw.revision < 0 ||
      Object.keys(raw).length !== 4
    )
      throw new Error('默认模板存档无效');
    const checked = await receipt(raw.template, raw.revision);
    if (raw.fingerprint !== checked.fingerprint) throw new Error('默认模板指纹不匹配');
    current = checked;
  }
  return {
    mode: 't6-sandbox-defaults' as const,
    async read() {
      return copy(current);
    },
    async save(expected: string, input: T2Template) {
      const template = normalizeT2Template(input);
      if (expected !== current.fingerprint) throw new Error('默认模板已变化，请重新载入');
      if (template.id === current.template.id)
        template.templateVersion = Math.max(template.templateVersion, current.template.templateVersion) + 1;
      if (fail) {
        fail = false;
        throw new Error('模拟默认模板保存失败');
      }
      const next = await receipt(template, current.revision + 1);
      // Recheck after async hashing; competing saves cannot both win.
      if (expected !== current.fingerprint) throw new Error('默认模板保存冲突');
      current = next;
      return copy(current);
    },
    queueSaveFailure() {
      fail = true;
    },
    exportStorage() {
      return JSON.stringify(current);
    },
  };
}
/** Defaults are copied only at explicit NEW world initialization. Never apply them to existing data. */
export async function newT6World(store: T6DefaultStore, worldId: string, branchId: string): Promise<T4State> {
  const { template } = await store.read();
  return { template, data: createT2EmptyWorld(template, worldId, branchId) };
}
