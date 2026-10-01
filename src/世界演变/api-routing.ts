import type { WorldEvolutionApiConfiguration, WorldEvolutionApiPreset } from './api-config';
import {
  callWorldEvolutionApi,
  type WorldEvolutionApiClientOptions,
  type WorldEvolutionApiErrorCode,
  type WorldEvolutionApiMessage,
  type WorldEvolutionApiResult,
} from './api-client';

/**
 * 工作流助手对外暴露的最小桥接面。
 *
 * 这里故意不读取或复制 API 凭据；桥接内部仍由工作流助手负责解析预设和
 * 保存密钥。世界演变只拿到本轮文本结果和使用的预设名称。
 */
export type WorldEvolutionWorkflowAssistantBridge = {
  /** 安全状态摘要；不包含 endpoint 或 API Key。 */
  available?: boolean;
  activePresetName?: string;
  defaultConfig?: { model: string; endpointConfigured: boolean; keyConfigured: boolean };
  presets?: Array<{ name: string; model: string; endpointConfigured: boolean; keyConfigured: boolean }>;
  callApi: (
    messages: WorldEvolutionApiMessage[],
    options?: {
      presetName?: string;
      fallbackNames?: string[];
      generationId?: string;
      signal?: AbortSignal;
    },
  ) => Promise<{
    content?: string;
    reasoningContent?: string;
    usedPresetName?: string;
  }>;
};

export type WorldEvolutionApiRouteSource = 'builtin' | 'workflow-assistant';

export type WorldEvolutionApiRouteState = 'builtin-only' | 'workflow-only' | 'both' | 'none';

export type WorldEvolutionApiRouteDescriptor = {
  source: WorldEvolutionApiRouteSource;
  presetId?: string;
  presetName?: string;
};

export type WorldEvolutionApiRouteSummary = {
  state: WorldEvolutionApiRouteState;
  preferredSource: WorldEvolutionApiRouteSource | null;
  order: WorldEvolutionApiRouteSource[];
  builtinPresetIds: string[];
  workflowAssistantPresetNames: string[];
  effectiveRoutes: WorldEvolutionApiRouteDescriptor[];
};

export type WorldEvolutionApiRouteReadiness = {
  ready: boolean;
  usableRoutes: string[];
};

export type WorldEvolutionApiRouteAttempt = {
  source: WorldEvolutionApiRouteSource;
  presetId?: string;
  presetName?: string;
  ok: boolean;
  code?: WorldEvolutionApiRouteErrorCode;
  retryable?: boolean;
};

export type WorldEvolutionApiRouteErrorCode = WorldEvolutionApiErrorCode | 'BRIDGE';

export type WorldEvolutionApiRouteResult =
  | {
      ok: true;
      source: WorldEvolutionApiRouteSource;
      presetId?: string;
      presetName?: string;
      model?: string;
      text: string;
      requestId?: string;
      attempts: number;
      durationMs: number;
      routeAttempts: WorldEvolutionApiRouteAttempt[];
    }
  | {
      ok: false;
      source?: WorldEvolutionApiRouteSource;
      presetId?: string;
      presetName?: string;
      code: WorldEvolutionApiRouteErrorCode;
      message: string;
      retryable: boolean;
      status?: number;
      attempts: number;
      durationMs: number;
      routeAttempts: WorldEvolutionApiRouteAttempt[];
    };

export type WorldEvolutionApiRoutingOptions = WorldEvolutionApiClientOptions & {
  bridge?: WorldEvolutionWorkflowAssistantBridge | null;
  generationId?: string;
};

type WorldEvolutionApiRoutingInput = {
  bridge?: WorldEvolutionWorkflowAssistantBridge | null;
};

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(normalizeName).filter(Boolean))];
}

function getBuiltinPresetIds(config: WorldEvolutionApiConfiguration): string[] {
  const presetById = new Map(config.presets.map(preset => [preset.id, preset]));
  return uniqueStrings([config.routing.primaryPresetId ?? '', ...config.routing.fallbackPresetIds]).filter(id => {
    const preset = presetById.get(id);
    return Boolean(preset?.enabled);
  });
}

function getWorkflowPresetNames(config: WorldEvolutionApiConfiguration): string[] {
  return uniqueStrings([
    config.routing.workflowAssistantPresetName,
    ...config.routing.workflowAssistantFallbackPresetNames,
  ]);
}

function bridgeAvailable(bridge: WorldEvolutionWorkflowAssistantBridge | null | undefined): boolean {
  if (typeof bridge?.callApi !== 'function' || bridge.available === false) return false;
  if (bridge.available !== true && !bridge.defaultConfig && !bridge.presets) return true;
  const hasDefault = Boolean(bridge.defaultConfig?.endpointConfigured && bridge.defaultConfig.model.trim());
  const hasPreset = Boolean(bridge.presets?.some(preset => preset.endpointConfigured && Boolean(preset.model.trim())));
  return bridge.available === true && (hasDefault || hasPreset);
}

function routeState(hasBuiltin: boolean, hasWorkflowAssistant: boolean): WorldEvolutionApiRouteState {
  if (hasBuiltin && hasWorkflowAssistant) return 'both';
  if (hasBuiltin) return 'builtin-only';
  if (hasWorkflowAssistant) return 'workflow-only';
  return 'none';
}

/**
 * 解析 S5 的有效来源和顺序。此函数是纯函数，不会读取宿主环境，也不会调用 API。
 */
export function resolveWorldEvolutionApiRouting(
  config: WorldEvolutionApiConfiguration,
  input: WorldEvolutionApiRoutingInput = {},
): WorldEvolutionApiRouteSummary {
  const builtinPresetIds = getBuiltinPresetIds(config);
  const workflowAssistantPresetNames = getWorkflowPresetNames(config);
  const hasBuiltin = builtinPresetIds.length > 0;
  const hasWorkflowAssistant = config.routing.allowWorkflowAssistantBridge && bridgeAvailable(input.bridge);
  const state = routeState(hasBuiltin, hasWorkflowAssistant);

  const order: WorldEvolutionApiRouteSource[] = [];
  const preferBuiltin = config.routing.preferBuiltin;
  const appendSource = (source: WorldEvolutionApiRouteSource, enabled: boolean): void => {
    if (enabled && !order.includes(source)) order.push(source);
  };
  if (preferBuiltin) {
    appendSource('builtin', hasBuiltin);
    appendSource('workflow-assistant', hasWorkflowAssistant);
  } else {
    appendSource('workflow-assistant', hasWorkflowAssistant);
    appendSource('builtin', hasBuiltin);
  }

  const effectiveRoutes: WorldEvolutionApiRouteDescriptor[] = [];
  for (const source of order) {
    if (source === 'builtin') {
      effectiveRoutes.push(...builtinPresetIds.map(presetId => ({ source: 'builtin' as const, presetId })));
      continue;
    }
    const names = workflowAssistantPresetNames.length ? workflowAssistantPresetNames : [undefined];
    effectiveRoutes.push(
      ...names.map(presetName => ({
        source: 'workflow-assistant' as const,
        ...(presetName ? { presetName } : {}),
      })),
    );
  }

  return {
    state,
    preferredSource: order[0] ?? null,
    order,
    builtinPresetIds,
    workflowAssistantPresetNames,
    effectiveRoutes,
  };
}

/**
 * 返回旧运行面板可展示的安全路由状态，不发起请求。
 * 内置来源只检查引擎实际首先尝试的启用预设；配置错误不会触发内置备用项，
 * 但被禁用的预设会被跳过。工作流助手桥接同样只检查实际传给助手的主预设，
 * 因为助手会在校验主预设失败时直接报错，不会尝试备用项。
 */
export function getWorldEvolutionApiRouteReadiness(
  config: WorldEvolutionApiConfiguration,
  bridge: WorldEvolutionWorkflowAssistantBridge | null | undefined,
): WorldEvolutionApiRouteReadiness {
  const summary = resolveWorldEvolutionApiRouting(config, { bridge });
  const presetById = new Map(config.presets.map(preset => [preset.id, preset]));
  const usableRoutes: string[] = [];

  for (const source of summary.order) {
    if (source === 'builtin') {
      const firstEnabledPreset = presetById.get(summary.builtinPresetIds[0] ?? '');
      if (
        firstEnabledPreset?.enabled &&
        firstEnabledPreset.endpoint.trim() &&
        firstEnabledPreset.model.trim() &&
        firstEnabledPreset.apiKey.trim()
      ) {
        usableRoutes.push(`内置 API：${firstEnabledPreset.name}`);
      }
      continue;
    }

    if (!bridge || !bridgeAvailable(bridge)) continue;
    const primaryPresetName = normalizeName(config.routing.workflowAssistantPresetName) || normalizeName(bridge.activePresetName);
    if (primaryPresetName) {
      const preset = bridge.presets?.find(item => item.name === primaryPresetName);
      if (preset?.endpointConfigured && normalizeName(preset.model)) {
        usableRoutes.push(`工作流助手：${primaryPresetName}`);
      }
      continue;
    }

    if (bridge.defaultConfig?.endpointConfigured && normalizeName(bridge.defaultConfig.model)) {
      usableRoutes.push('工作流助手：默认配置');
    }
  }

  return { ready: usableRoutes.length > 0, usableRoutes };
}

function defaultBridge(): WorldEvolutionWorkflowAssistantBridge | null {
  try {
    const hostWindow = (typeof window === 'undefined' ? undefined : (window.parent ?? window)) as
      | (Window & { AcuPostProcessAPI?: { callApi?: WorldEvolutionWorkflowAssistantBridge['callApi'] } })
      | undefined;
    const api = hostWindow?.AcuPostProcessAPI as
      | {
          callApi?: WorldEvolutionWorkflowAssistantBridge['callApi'];
          listApiPresetDetails?: () => {
            available?: boolean;
            activePresetName?: string;
            defaultConfig?: { model?: string; endpointConfigured?: boolean; keyConfigured?: boolean };
            presets?: Array<{
              name?: string;
              model?: string;
              endpointConfigured?: boolean;
              keyConfigured?: boolean;
            }>;
          };
        }
      | undefined;
    const callApi = api?.callApi;
    if (typeof callApi !== 'function') return null;
    const info = api.listApiPresetDetails?.();
    const defaultConfig = {
      model: info?.defaultConfig?.model ?? '',
      endpointConfigured: info?.defaultConfig?.endpointConfigured === true,
      keyConfigured: info?.defaultConfig?.keyConfigured === true,
    };
    const presets = (info?.presets ?? [])
      .filter((preset): preset is typeof preset & { name: string } => typeof preset.name === 'string')
      .map(preset => ({
        name: preset.name,
        model: preset.model ?? '',
        endpointConfigured: preset.endpointConfigured === true,
        keyConfigured: preset.keyConfigured === true,
      }));
    const hasConfiguredRoute =
      (info?.available === true &&
        (Boolean(defaultConfig.endpointConfigured && defaultConfig.model.trim()) ||
          presets.some(preset => preset.endpointConfigured && Boolean(preset.model.trim())))) ||
      // 兼容早期桥接只暴露 callApi 的宿主。
      info === undefined;
    return {
      callApi: callApi.bind(api),
      available: hasConfiguredRoute,
      activePresetName: info?.activePresetName ?? '',
      defaultConfig,
      presets,
    };
  } catch {
    return null;
  }
}

export function getWorldEvolutionWorkflowAssistantBridge(): WorldEvolutionWorkflowAssistantBridge | null {
  return defaultBridge();
}

function errorCode(value: unknown): WorldEvolutionApiRouteErrorCode | undefined {
  return value === 'CONFIG' ||
    value === 'NETWORK' ||
    value === 'HTTP' ||
    value === 'TIMEOUT' ||
    value === 'PARSE' ||
    value === 'ABORTED' ||
    value === 'BRIDGE'
    ? value
    : undefined;
}

function normalizeBridgeFailure(
  error: unknown,
  startedAt: number,
  now: () => number,
): {
  code: WorldEvolutionApiRouteErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
  attempts: number;
  durationMs: number;
} {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const code = errorCode(record?.code) ?? 'BRIDGE';
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '工作流助手 API 调用失败';
  return {
    code,
    message,
    retryable: typeof record?.retryable === 'boolean' ? record.retryable : false,
    status: typeof record?.status === 'number' ? record.status : undefined,
    attempts: 1,
    durationMs: Math.max(0, now() - startedAt),
  };
}

function failedFromBuiltin(
  result: Extract<WorldEvolutionApiResult, { ok: false }>,
  routeAttempts: WorldEvolutionApiRouteAttempt[],
): WorldEvolutionApiRouteResult {
  return {
    ...result,
    source: 'builtin',
    routeAttempts,
  };
}

function getNow(options: WorldEvolutionApiRoutingOptions): () => number {
  return options.now ?? Date.now;
}

function generationId(options: WorldEvolutionApiRoutingOptions): string {
  return options.generationId ?? `world-evolution-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 按配置顺序执行内置 API / 工作流助手桥接。
 *
 * 内置客户端自身负责“主 API → 内置备用 API”以及重试；这里仅在内置来源不可用
 * 且错误仍可重试时，才允许继续到另一个来源。认证、请求格式、解析和取消错误
 * 都会立即返回，不会被工作流助手桥接吞掉。
 */
export async function callWorldEvolutionApiWithRouting(
  config: WorldEvolutionApiConfiguration,
  messages: WorldEvolutionApiMessage[],
  options: WorldEvolutionApiRoutingOptions = {},
): Promise<WorldEvolutionApiRouteResult> {
  const now = getNow(options);
  const startedAt = now();
  const bridge = options.bridge === undefined ? getWorldEvolutionWorkflowAssistantBridge() : options.bridge;
  const summary = resolveWorldEvolutionApiRouting(config, { bridge });
  const routeAttempts: WorldEvolutionApiRouteAttempt[] = [];

  if (!summary.order.length) {
    return {
      ok: false,
      code: 'CONFIG',
      message: '没有配置可用的内置 API，也没有可用的工作流助手桥接',
      retryable: false,
      attempts: 0,
      durationMs: Math.max(0, now() - startedAt),
      routeAttempts,
    };
  }

  let lastFailure: WorldEvolutionApiRouteResult | undefined;
  for (const source of summary.order) {
    if (source === 'builtin') {
      const result = await callWorldEvolutionApi(config, messages, options);
      if (result.ok) {
        routeAttempts.push({ source, presetId: result.presetId, ok: true });
        return {
          ...result,
          source,
          routeAttempts,
        };
      }
      routeAttempts.push({
        source,
        presetId: result.presetId,
        ok: false,
        code: result.code,
        retryable: result.retryable,
      });
      const failure = failedFromBuiltin(result, routeAttempts);
      lastFailure = failure;
      // CONFIG 表示该来源当前不可用（例如漏填端点/模型），可以按设置继续找另一来源；
      // 认证、解析、格式和取消错误仍然立即终止，避免“盲目切换”。
      if (!result.retryable && result.code !== 'CONFIG') return failure;
      continue;
    }

    if (!bridge || !bridgeAvailable(bridge)) continue;
    const bridgeStartedAt = now();
    const workflowPresetName = config.routing.workflowAssistantPresetName.trim() || undefined;
    try {
      const result = await bridge.callApi(messages, {
        presetName: workflowPresetName,
        fallbackNames: config.routing.workflowAssistantFallbackPresetNames,
        generationId: generationId(options),
        signal: options.signal,
      });
      const text = typeof result.content === 'string' ? result.content.trim() : '';
      if (!text) {
        const failure = {
          ok: false as const,
          source,
          presetName: result.usedPresetName ?? workflowPresetName,
          code: 'BRIDGE' as const,
          message: '工作流助手 API 没有返回可用文本',
          retryable: false,
          attempts: 1,
          durationMs: Math.max(0, now() - bridgeStartedAt),
          routeAttempts,
        };
        routeAttempts.push({
          source,
          presetName: failure.presetName,
          ok: false,
          code: failure.code,
          retryable: failure.retryable,
        });
        return failure;
      }
      routeAttempts.push({
        source,
        presetName: result.usedPresetName ?? workflowPresetName,
        ok: true,
      });
      return {
        ok: true,
        source,
        presetName: result.usedPresetName ?? workflowPresetName,
        text,
        attempts: 1,
        durationMs: Math.max(0, now() - startedAt),
        routeAttempts,
      };
    } catch (error) {
      const normalized = normalizeBridgeFailure(error, bridgeStartedAt, now);
      routeAttempts.push({
        source,
        presetName: workflowPresetName,
        ok: false,
        code: normalized.code,
        retryable: normalized.retryable,
      });
      const failure: WorldEvolutionApiRouteResult = {
        ok: false,
        source,
        presetName: workflowPresetName,
        ...normalized,
        durationMs: Math.max(0, now() - startedAt),
        routeAttempts,
      };
      lastFailure = failure;
      if (!normalized.retryable && normalized.code !== 'CONFIG') return failure;
    }
  }

  return (
    lastFailure ?? {
      ok: false,
      code: 'CONFIG',
      message: '没有可用的 API 路由',
      retryable: false,
      attempts: 0,
      durationMs: Math.max(0, now() - startedAt),
      routeAttempts,
    }
  );
}

/** 将内置预设转换为仅用于路由展示的安全摘要，不返回 API Key。 */
export function summarizeWorldEvolutionBuiltinPreset(
  preset: WorldEvolutionApiPreset,
): WorldEvolutionApiRouteDescriptor {
  return { source: 'builtin', presetId: preset.id };
}
