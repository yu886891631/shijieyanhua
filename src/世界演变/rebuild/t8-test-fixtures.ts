/** Test-only local fixtures. Never imported by a browser entry. */
import initSqlJs from 'sql.js';
import { createEmptyWorldEvolutionApiConfiguration } from '../api-config';
import { createMinimalT2Fixture } from './t2-defaults';
import { cloneT2Json } from './t2-template';
import { executeT3Request } from './t3-engine';
import type { T4State } from './t4-protocol';
import type { T4Executor } from './t4-service';
import type { T7Input } from './t7-input';
import { createT7Prompts } from './t7-prompts';
import { createT8Control, type T8Options } from './t8-control';
import { createT8Queue } from './t8-queue';

export const cloneT8Test = <T>(value: T): T => cloneT2Json(value) as unknown as T;
const sqlite = initSqlJs();
export const executeT8Test: T4Executor = async (request, options) => {
  if (options?.signal?.aborted) throw options.signal.reason;
  return executeT3Request(await sqlite, request);
};
export function setupT8Test(state: T4State = createMinimalT2Fixture(), extras: Partial<T8Options> = {}) {
  state.template.defaults.api = { state: 'value', value: { presetId: 'fake' } };
  const api = createEmptyWorldEvolutionApiConfiguration(0);
  api.presets = [
    {
      id: 'fake',
      name: '模拟 API',
      provider: 'openai-compatible',
      endpoint: 'https://invalid.example/chat/completions',
      model: 'model-fake',
      apiKey: 'private-t8-key-no-leak',
      enabled: true,
      timeoutMs: 1000,
      maxRetries: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const input: T7Input = {
    anchor: { chatId: 'sandbox-t8', messageId: 'a8', swipeId: 's0', inputFingerprint: 'a'.repeat(64) },
    worldId: state.data.worldId,
    branchId: state.data.branchId,
    eligibleRound: 1,
    story: [{ messageId: 'a8', role: 'assistant', text: '暴雨加剧，道路受阻。' }],
    segments: [],
    proofs: [],
    selected: [],
    progress: {},
    now: { calendarId: 'demo-calendar', ordinalMinute: 15000 },
  };
  const prompts = createT7Prompts(state.template),
    queue = extras.queue ?? createT8Queue();
  const options: T8Options = {
    ownerId: 'mock-entry',
    queue,
    readState: () => state,
    readInput: () => input,
    readPrompts: () => prompts,
    readApi: () => api,
    execute: executeT8Test,
    pollMs: 5,
    ...extras,
  };
  const control = createT8Control(options);
  return { state, input, api, prompts, queue, options, control };
}
export function responseT8Test(sql: string, parameters: unknown[] = []) {
  return { status: 200, text: JSON.stringify({ sql, parameters }) };
}
export function deferredT8Test<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
