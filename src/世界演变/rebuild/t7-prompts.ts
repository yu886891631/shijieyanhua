/** T7 local configuration only. Table lifecycle rules remain canonical in the T2 template. */
import { z } from 'zod';
import { cloneT2Json, type T2Inherited, type T2Template } from './t2-template';
import { fingerprintT4 } from './t4-protocol';

const choice = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('inherit') }),
  z.strictObject({ state: z.literal('disabled') }),
  z.strictObject({ state: z.literal('value'), value: z.string().max(12000) }),
]);
const schema = z.strictObject({
  format: z.literal('we-t7-prompts'),
  templateId: z.string().min(1).max(64),
  revision: z.number().int().min(1),
  global: z.string().max(12000),
  phases: z.strictObject({ macro: choice, micro: choice }),
  tables: z.record(z.string(), choice),
});
export interface T7Prompts {
  format: 'we-t7-prompts';
  templateId: string;
  revision: number;
  global: string;
  phases: { macro: T2Inherited<string>; micro: T2Inherited<string> };
  tables: Record<string, T2Inherited<string>>;
}
export function createT7Prompts(template: T2Template): T7Prompts {
  return {
    format: 'we-t7-prompts',
    templateId: template.id,
    revision: 1,
    global: '依据本轮已确认剧情和前置结果更新世界；自然语言规则不能覆盖类型、权限、锁定和预算。',
    phases: {
      macro: { state: 'value', value: '先以旧宏观世界为基础更新宏观条件；不要提前写微观行动结果。' },
      micro: { state: 'value', value: '基于本轮最新宏观条件和旧微观状态行动；不把意图当成已发生事实。' },
    },
    tables: {},
  };
}
export function normalizeT7Prompts(input: unknown, template: T2Template): T7Prompts {
  const value = schema.parse(cloneT2Json(input)) as T7Prompts;
  if (value.templateId !== template.id || Object.keys(value.tables).some(id => !template.tables.some(t => t.id === id)))
    throw new Error('提示词模板身份或表关联无效');
  return value;
}
export function resolveT7Prompt(prompts: T7Prompts, tableId: string, stage: 'macro' | 'micro') {
  const table = prompts.tables[tableId] ?? { state: 'inherit' as const };
  const phase = prompts.phases[stage];
  const picked =
    table.state !== 'inherit'
      ? table
      : phase.state !== 'inherit'
        ? phase
        : { state: 'value' as const, value: prompts.global };
  return {
    source: table.state !== 'inherit' ? 'table' : phase.state !== 'inherit' ? 'phase' : 'global',
    global: prompts.global,
    guidance: picked.state === 'value' ? picked.value : '',
    disabled: picked.state === 'disabled',
  };
}
export async function createT7PromptStore(
  template: T2Template | (() => T2Template),
  input?: unknown,
  saved?: { draft: unknown; revision: number },
) {
  const current = () => (typeof template === 'function' ? template() : template);
  const templateId = current().id;
  function normalize(value: unknown) {
    const t = current();
    if (t.id !== templateId) throw new Error('提示词不能跨世界模板复用');
    return normalizeT7Prompts(value, t);
  }
  let enabled = normalize(input ?? createT7Prompts(current()));
  if (saved && (!Number.isSafeInteger(saved.revision) || saved.revision < 0)) throw new Error('草稿版本无效');
  let draft = normalize(saved?.draft ?? enabled);
  let savedDraft = cloneT2Json(draft) as unknown as T7Prompts;
  let draftRevision = saved?.revision ?? 0;
  let enabledFingerprint = await fingerprintT4(enabled);
  return {
    exportSaved: () => ({
      enabled: cloneT2Json(enabled) as unknown as T7Prompts,
      draft: cloneT2Json(savedDraft) as unknown as T7Prompts,
      revision: draftRevision,
    }),
    view: () => ({
      enabled: cloneT2Json(enabled) as unknown as T7Prompts,
      draft: cloneT2Json(draft) as unknown as T7Prompts,
      draftRevision,
      dirty: JSON.stringify(draft) !== JSON.stringify(savedDraft),
      enabledFingerprint,
    }),
    edit(input: unknown) {
      draft = normalize(input);
    },
    saveDraft() {
      savedDraft = cloneT2Json(draft) as unknown as T7Prompts;
      draftRevision += 1;
    },
    discard() {
      draft = cloneT2Json(savedDraft) as unknown as T7Prompts;
    },
    async enable(expectedFingerprint: string) {
      if (expectedFingerprint !== enabledFingerprint) throw new Error('启用版本已变化，请重新核对');
      const next = normalize(savedDraft);
      next.revision = enabled.revision + 1;
      const digest = await fingerprintT4(next);
      if (expectedFingerprint !== enabledFingerprint) throw new Error('启用版本已变化，请重新核对');
      enabled = next;
      enabledFingerprint = digest;
    },
  };
}
export type T7PromptStore = Awaited<ReturnType<typeof createT7PromptStore>>;
