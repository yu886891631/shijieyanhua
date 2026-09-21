import { callWithResolvedApi } from './call';
import { resolveApiPresetFull } from './resolve';
import type { TaskApiRouteConcurrencyPool } from './route-concurrency-pool';
import {
  apiConfigRequiresChatCompletionPath,
  enrichApiConfigForStructuredTask,
  type ActiveStructuredOutputMode,
} from '../tasks/strict-variable-response';
import { RunCancelledError } from '../tasks/run-control';
import type { RunLogMessage, ScriptSettings } from '../tasks/schema';

function isAbortLikeError(e: unknown): boolean {
  if (e instanceof RunCancelledError) return true;
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  return false;
}

export interface TaskApiRouteCallResult {
  content: string;
  reasoningContent?: string;
  usedPresetName: string;
}

async function callSinglePresetRoute(
  messages: RunLogMessage[],
  settings: ScriptSettings,
  presetName: string,
  structuredMode: ActiveStructuredOutputMode | null,
  generationId: string,
  callApi: typeof callWithResolvedApi,
  options?: { disallowGenerateRawFallback?: boolean; signal?: AbortSignal },
): Promise<TaskApiRouteCallResult> {
  const { apiConfig } = resolveApiPresetFull(settings, presetName);
  const enriched = structuredMode ? enrichApiConfigForStructuredTask(apiConfig, structuredMode) : apiConfig;
  const apiResult = await callApi(
    messages,
    { apiConfig: enriched },
    generationId,
    {
      disallowGenerateRawFallback:
        options?.disallowGenerateRawFallback ??
        (structuredMode != null || apiConfigRequiresChatCompletionPath(enriched)),
      payloadOverrides: structuredMode ? { customPromptPostProcessing: 'strict' } : undefined,
      signal: options?.signal,
    },
  );
  return {
    content: apiResult.content,
    reasoningContent: apiResult.reasoningContent,
    usedPresetName: presetName,
  };
}

async function callWithPoolAndFailover(
  messages: RunLogMessage[],
  settings: ScriptSettings,
  presetChain: string[],
  structuredMode: ActiveStructuredOutputMode | null,
  generationIdBase: string,
  callApi: typeof callWithResolvedApi,
  pool: TaskApiRouteConcurrencyPool,
  options?: {
    signal?: AbortSignal;
    preferPrimaryOnly?: boolean;
    disallowGenerateRawFallback?: boolean;
  },
): Promise<TaskApiRouteCallResult> {
  const chain = options?.preferPrimaryOnly ? [presetChain[0]!] : presetChain;
  let lastError = '';

  const startRoute = await pool.acquire({
    signal: options?.signal,
    preferredRoute: options?.preferPrimaryOnly ? chain[0] : undefined,
  });

  const startIndex = chain.indexOf(startRoute);
  const tryOrder = startIndex >= 0 ? [...chain.slice(startIndex), ...chain.slice(0, startIndex)] : [...chain];

  for (let i = 0; i < tryOrder.length; i++) {
    const presetName = tryOrder[i]!;
    let acquiredRoute: string | null = null;
    let shouldRelease = false;

    try {
      if (i === 0) {
        acquiredRoute = startRoute;
      } else {
        acquiredRoute = await pool.acquire({
          signal: options?.signal,
          preferredRoute: presetName,
        });
        shouldRelease = true;
      }

      return await callSinglePresetRoute(
        messages,
        settings,
        presetName,
        structuredMode,
        `${generationIdBase}-route-${presetName}-${i}`,
        callApi,
        {
          disallowGenerateRawFallback: options?.disallowGenerateRawFallback,
          signal: options?.signal,
        },
      );
    } catch (e) {
      if (isAbortLikeError(e) || options?.signal?.aborted) {
        throw new RunCancelledError();
      }
      lastError = e instanceof Error ? e.message : String(e);
      if (i < tryOrder.length - 1) continue;
    } finally {
      if (shouldRelease && acquiredRoute) {
        pool.release(acquiredRoute);
      }
      if (i === 0 && acquiredRoute) {
        pool.release(acquiredRoute);
      }
    }
  }

  throw new Error(lastError || 'API 调用失败');
}

export async function callTaskApiWithRouteFallback(
  messages: RunLogMessage[],
  settings: ScriptSettings,
  presetChain: string[],
  structuredMode: ActiveStructuredOutputMode | null,
  generationIdBase: string,
  options?: {
    disallowGenerateRawFallback?: boolean;
    callApi?: typeof callWithResolvedApi;
    routePool?: TaskApiRouteConcurrencyPool | null;
    preferPrimaryOnly?: boolean;
    signal?: AbortSignal;
  },
): Promise<TaskApiRouteCallResult> {
  if (!presetChain.length) {
    throw new Error('无可用 API 预设');
  }

  const callApi = options?.callApi ?? callWithResolvedApi;
  const pool = options?.routePool;

  if (pool) {
    return callWithPoolAndFailover(
      messages,
      settings,
      presetChain,
      structuredMode,
      generationIdBase,
      callApi,
      pool,
      {
        signal: options?.signal,
        preferPrimaryOnly: options?.preferPrimaryOnly,
        disallowGenerateRawFallback: options?.disallowGenerateRawFallback,
      },
    );
  }

  const chain = options?.preferPrimaryOnly ? [presetChain[0]!] : presetChain;
  let lastError = '';
  for (let i = 0; i < chain.length; i++) {
    const presetName = chain[i]!;
    try {
      return await callSinglePresetRoute(
        messages,
        settings,
        presetName,
        structuredMode,
        `${generationIdBase}-route-${i}`,
        callApi,
        {
          disallowGenerateRawFallback: options?.disallowGenerateRawFallback,
          signal: options?.signal,
        },
      );
    } catch (e) {
      if (isAbortLikeError(e) || options?.signal?.aborted) {
        throw new RunCancelledError();
      }
      lastError = e instanceof Error ? e.message : String(e);
      if (i < chain.length - 1) continue;
    }
  }

  throw new Error(lastError || 'API 调用失败');
}
