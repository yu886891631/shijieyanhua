/** A single service owns both preview and simulated messages; Vue never assembles prompts. */
import type { WorldEvolutionApiConfiguration } from '../api-config';
import { cloneT2Json, type T2Inherited } from './t2-template';
import { fingerprintT4, normalizeT4State, type T4State } from './t4-protocol';
import { normalizeT7Input, type T7Input } from './t7-input';
import { createT7Run, type T7Run } from './t7-run';
import { createT7PromptStore, type T7PromptStore } from './t7-prompts';

export async function createT7Workbench(options: {
  readState: () => T4State;
  input: T7Input;
  api: WorldEvolutionApiConfiguration;
  canFreeze?: () => boolean;
  initialPrompts?: { enabled: unknown; draft: unknown; revision: number };
}) {
  const prompts: T7PromptStore = await createT7PromptStore(
    () => options.readState().template,
    options.initialPrompts?.enabled,
    options.initialPrompts
      ? { draft: options.initialPrompts.draft, revision: options.initialPrompts.revision }
      : undefined,
  );
  let input = normalizeT7Input(options.input),
    api = cloneT2Json(options.api) as unknown as WorldEvolutionApiConfiguration;
  let run: T7Run | null = null,
    busy = false,
    error: string | null = null,
    sequence = 0;
  let result: Awaited<ReturnType<T7Run['simulate']>> | null = null;
  let stateFingerprint: string | null = null;
  let inputInvalidated = false;
  function inputIdentity(value: T7Input) {
    return JSON.stringify({
      anchor: value.anchor,
      worldId: value.worldId,
      branchId: value.branchId,
      story: value.story,
      segments: value.segments,
      proofs: value.proofs,
      eligibleRound: value.eligibleRound,
      now: value.now,
    });
  }
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(fn => fn());
  function idle() {
    if (busy) throw new Error('请等当前本地操作结束');
  }
  function noKey(value: unknown, config = api) {
    const keys = config.presets.map(p => p.apiKey).filter(Boolean);
    function includes(v: unknown): boolean {
      if (typeof v === 'string') return keys.some(k => v.includes(k));
      if (Array.isArray(v)) return v.some(includes);
      return !!v && typeof v === 'object' && Object.values(v).some(includes);
    }
    if (includes(value)) throw new Error('配置含凭据，不可放入提示词或预览');
  }
  async function action(fn: () => Promise<void>) {
    idle();
    busy = true;
    error = null;
    notify();
    try {
      await fn();
    } catch {
      error = '操作被阻断：请核对世界/模板身份、前置证据、预算或未保存草稿。';
    } finally {
      busy = false;
      notify();
    }
  }
  const workbench = {
    exportPrompts: () => prompts.exportSaved(),
    view: () => {
      const tableIds = options
        .readState()
        .template.tables.filter(t => t.visibility.user && t.visibility.evolutionAi)
        .map(t => t.id);
      const tables = options
        .readState()
        .template.tables.filter(t => tableIds.includes(t.id))
        .map(t => ({ id: t.id, name: t.name, groupId: t.groupId }));
      const promptView = prompts.view();
      for (const p of [promptView.enabled, promptView.draft])
        p.tables = Object.fromEntries(Object.entries(p.tables).filter(([id]) => tableIds.includes(id)));
      const value = {
        mode: 't7-local-simulation' as const,
        busy,
        error,
        prompts: promptView,
        tableIds,
        tables,
        run: run?.view() ?? null,
        result,
        inputInvalidated,
      };
      noKey(value);
      return cloneT2Json(value) as unknown as typeof value;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    editPrompt(scope: string, choice: T2Inherited<string>) {
      idle();
      noKey(choice);
      const draft = prompts.view().draft;
      if (scope === 'global') {
        if (choice.state !== 'value') throw new Error('全局规则必须为文本');
        draft.global = choice.value;
      } else if (scope === 'phase:macro' || scope === 'phase:micro')
        draft.phases[scope === 'phase:macro' ? 'macro' : 'micro'] = choice;
      else {
        if (!scope.startsWith('table:')) throw new Error('请选择明确的规则层级');
        const id = scope.slice(6);
        if (
          !options.readState().template.tables.some(t => t.id === id && t.visibility.user && t.visibility.evolutionAi)
        )
          throw new Error('此表不可编辑规则');
        if (choice.state === 'inherit') delete draft.tables[id];
        else draft.tables[id] = choice;
      }
      prompts.edit(draft);
      notify();
    },
    saveDraft() {
      idle();
      prompts.saveDraft();
      notify();
    },
    discardDraft() {
      idle();
      prompts.discard();
      notify();
    },
    async enable() {
      await action(async () => {
        await prompts.enable(prompts.view().enabledFingerprint);
      });
    },
    setInput(next: T7Input) {
      idle();
      const safe = normalizeT7Input(next);
      if (run && inputIdentity(safe) !== inputIdentity(input)) inputInvalidated = true;
      input = safe;
      notify();
    },
    setApi(next: WorldEvolutionApiConfiguration) {
      idle();
      const safe = cloneT2Json(next) as unknown as WorldEvolutionApiConfiguration;
      noKey(prompts.view(), safe);
      api = safe;
      notify();
    },
    async freeze() {
      await action(async () => {
        if (options.canFreeze && !options.canFreeze()) throw new Error('资料或结构草稿尚未收口');
        const state = normalizeT4State(options.readState());
        const frozenFingerprint = await fingerprintT4(state);
        const next = await createT7Run({
          runId: `t7-run-${++sequence}`,
          state,
          input,
          prompts: prompts.view().enabled,
          api,
        });
        await next.plan('macro');
        if (frozenFingerprint !== (await fingerprintT4(normalizeT4State(options.readState()))))
          throw new Error('冻结期间正式资料发生变化');
        run = next;
        stateFingerprint = frozenFingerprint;
        result = null;
        inputInvalidated = false;
      });
    },
    async planMicro() {
      await action(async () => {
        if (!run || inputInvalidated) throw new Error('请先冻结当前有效输入');
        await run.plan('micro');
      });
    },
    async simulate(id: string) {
      await action(async () => {
        if (
          !run ||
          inputInvalidated ||
          stateFingerprint !== (await fingerprintT4(normalizeT4State(options.readState())))
        )
          throw new Error('本轮资料已过期，请重新冻结');
        const response = await run.simulate(id);
        if (stateFingerprint !== (await fingerprintT4(normalizeT4State(options.readState())))) {
          result = null;
          throw new Error('响应时资料已过期');
        }
        result = response;
      });
    },
    discardRun() {
      idle();
      run = null;
      stateFingerprint = null;
      result = null;
      inputInvalidated = false;
      notify();
    },
    /** No UI button fabricates this; a future stage service supplies validated private macro state. */
    async provideMacro(handoff: Parameters<T7Run['provideMacro']>[0]) {
      await action(async () => {
        if (
          !run ||
          inputInvalidated ||
          stateFingerprint !== (await fingerprintT4(normalizeT4State(options.readState())))
        )
          throw new Error('本轮输入或资料已过期');
        await run.provideMacro(handoff);
        await run.plan('micro');
      });
    },
  };
  return workbench;
}
export type T7Workbench = Awaited<ReturnType<typeof createT7Workbench>>;
export type T7WorkbenchView = ReturnType<T7Workbench['view']>;
