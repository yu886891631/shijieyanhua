import type { WorldEvolutionApiConfiguration, WorldEvolutionApiPreset } from './api-config';

export type WorldEvolutionApiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
};

export type WorldEvolutionApiErrorCode =
  | 'CONFIG'
  | 'NETWORK'
  | 'HTTP'
  | 'TIMEOUT'
  | 'PARSE'
  | 'ABORTED';

export type WorldEvolutionApiResult =
  | {
      ok: true;
      presetId: string;
      model: string;
      text: string;
      requestId?: string;
      attempts: number;
      durationMs: number;
    }
  | {
      ok: false;
      presetId?: string;
      code: WorldEvolutionApiErrorCode;
      message: string;
      retryable: boolean;
      status?: number;
      attempts: number;
      durationMs: number;
    };

export type WorldEvolutionApiFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type WorldEvolutionApiClientOptions = {
  fetchImpl?: WorldEvolutionApiFetch;
  signal?: AbortSignal;
  retryDelayMs?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  requestId?: string;
  now?: () => number;
};

export class WorldEvolutionApiClientError extends Error {
  readonly code: WorldEvolutionApiErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: WorldEvolutionApiErrorCode,
    message: string,
    retryable: boolean,
    status?: number,
  ) {
    super(message);
    this.name = 'WorldEvolutionApiClientError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

const DEFAULT_RETRY_DELAY_MS = 400;
const MAX_RETRY_DELAY_MS = 8_000;

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  if (typeof fetch !== 'function') {
    return Promise.reject(new WorldEvolutionApiClientError('NETWORK', '当前环境不支持 fetch', false));
  }
  return fetch(input, init);
}

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new WorldEvolutionApiClientError('ABORTED', '请求已取消', false));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new WorldEvolutionApiClientError('ABORTED', '请求已取消', false));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function normalizeError(error: unknown, signal?: AbortSignal): WorldEvolutionApiClientError {
  if (signal?.aborted || isAbortError(error)) {
    return new WorldEvolutionApiClientError('ABORTED', '请求已取消', false);
  }
  if (error instanceof WorldEvolutionApiClientError) return error;
  return new WorldEvolutionApiClientError(
    'NETWORK',
    error instanceof Error ? error.message : 'API 网络请求失败',
    true,
  );
}

function createTimeoutSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    },
  };
}

function assertPresetConfig(preset: WorldEvolutionApiPreset): void {
  if (!preset.endpoint.trim()) {
    throw new WorldEvolutionApiClientError('CONFIG', `API 预设“${preset.name}”未配置 Endpoint`, false);
  }
  if (!preset.model.trim()) {
    throw new WorldEvolutionApiClientError('CONFIG', `API 预设“${preset.name}”未配置模型`, false);
  }
  if (!preset.apiKey.trim()) {
    throw new WorldEvolutionApiClientError('CONFIG', `API 预设“${preset.name}”未配置 API Key`, false);
  }
}

function extractResponseText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.content === 'string') return record.content.trim();
  if (typeof record.text === 'string') return record.text.trim();
  if (typeof record.output_text === 'string') return record.output_text.trim();
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (!first || typeof first !== 'object') return '';
  const choice = first as Record<string, unknown>;
  if (typeof choice.text === 'string') return choice.text.trim();
  const message = choice.message;
  if (message && typeof message === 'object' && typeof (message as Record<string, unknown>).content === 'string') {
    return ((message as Record<string, unknown>).content as string).trim();
  }
  return '';
}

async function requestPreset(
  preset: WorldEvolutionApiPreset,
  messages: WorldEvolutionApiMessage[],
  options: Required<Pick<WorldEvolutionApiClientOptions, 'fetchImpl' | 'sleep' | 'now'>> &
    Omit<WorldEvolutionApiClientOptions, 'fetchImpl' | 'sleep' | 'now'>,
): Promise<{ text: string; requestId?: string }> {
  assertPresetConfig(preset);
  if (options.signal?.aborted) {
    throw new WorldEvolutionApiClientError('ABORTED', '请求已取消', false);
  }

  const timeout = createTimeoutSignal(preset.timeoutMs, options.signal);
  try {
    let response: Response;
    try {
      response = await options.fetchImpl(preset.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${preset.apiKey}`,
        },
        body: JSON.stringify({
          model: preset.model,
          messages,
        }),
        signal: timeout.signal,
      });
    } catch (error) {
      if (timeout.didTimeout()) {
        throw new WorldEvolutionApiClientError('TIMEOUT', `API 请求超过 ${preset.timeoutMs}ms`, true);
      }
      throw normalizeError(error, options.signal);
    }

    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 409 || response.status === 425;
      const serverFailure = response.status === 429 || response.status >= 500;
      throw new WorldEvolutionApiClientError(
        'HTTP',
        `API 返回 HTTP ${response.status}`,
        retryable || serverFailure,
        response.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text()) as unknown;
    } catch {
      throw new WorldEvolutionApiClientError('PARSE', 'API 响应不是合法 JSON', false);
    }
    const text = extractResponseText(parsed);
    if (!text) {
      throw new WorldEvolutionApiClientError('PARSE', 'API 响应中没有可用文本', false);
    }
    const requestId =
      parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).id === 'string'
        ? ((parsed as Record<string, unknown>).id as string)
        : undefined;
    return { text, requestId };
  } finally {
    timeout.dispose();
  }
}

function toFailure(
  presetId: string | undefined,
  error: WorldEvolutionApiClientError,
  attempts: number,
  startedAt: number,
  now: () => number,
): WorldEvolutionApiResult {
  return {
    ok: false,
    presetId,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    status: error.status,
    attempts,
    durationMs: Math.max(0, now() - startedAt),
  };
}

export async function callWorldEvolutionApiPreset(
  preset: WorldEvolutionApiPreset,
  messages: WorldEvolutionApiMessage[],
  options: WorldEvolutionApiClientOptions = {},
): Promise<WorldEvolutionApiResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const retryDelayMs = Math.max(0, Math.min(MAX_RETRY_DELAY_MS, Math.floor(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)));
  const maxRetries = Math.max(0, Math.min(8, Math.floor(preset.maxRetries)));
  let attempts = 0;

  for (let retry = 0; retry <= maxRetries; retry += 1) {
    attempts += 1;
    try {
      const result = await requestPreset(preset, messages, { ...options, fetchImpl, sleep, now });
      return {
        ok: true,
        presetId: preset.id,
        model: preset.model,
        text: result.text,
        requestId: result.requestId,
        attempts,
        durationMs: Math.max(0, now() - startedAt),
      };
    } catch (rawError) {
      const error = normalizeError(rawError, options.signal);
      if (!error.retryable || retry >= maxRetries) {
        return toFailure(preset.id, error, attempts, startedAt, now);
      }
      await sleep(retryDelayMs * 2 ** retry, options.signal);
    }
  }

  return toFailure(
    preset.id,
    new WorldEvolutionApiClientError('NETWORK', 'API 请求失败', true),
    attempts,
    startedAt,
    now,
  );
}

export async function callWorldEvolutionApi(
  config: WorldEvolutionApiConfiguration,
  messages: WorldEvolutionApiMessage[],
  options: WorldEvolutionApiClientOptions = {},
): Promise<WorldEvolutionApiResult> {
  const startedAt = (options.now ?? Date.now)();
  const presetById = new Map(config.presets.map(preset => [preset.id, preset]));
  const routeIds = [
    config.routing.primaryPresetId,
    ...config.routing.fallbackPresetIds,
  ].filter((id): id is string => Boolean(id));
  if (routeIds.length === 0) {
    return {
      ok: false,
      code: 'CONFIG',
      message: '没有配置内置 API 路由',
      retryable: false,
      attempts: 0,
      durationMs: Math.max(0, (options.now ?? Date.now)() - startedAt),
    };
  }

  let lastFailure: WorldEvolutionApiResult | undefined;
  for (const presetId of routeIds) {
    const preset = presetById.get(presetId);
    if (!preset) continue;
    if (!preset.enabled) continue;
    const result = await callWorldEvolutionApiPreset(preset, messages, options);
    if (result.ok) return result;
    lastFailure = result;
    if (!result.retryable) return result;
  }

  return (
    lastFailure ?? {
      ok: false,
      code: 'CONFIG',
      message: '没有启用的内置 API 预设',
      retryable: false,
      attempts: 0,
      durationMs: Math.max(0, (options.now ?? Date.now)() - startedAt),
    }
  );
}
