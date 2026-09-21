import {
  normalizeApiPresetFallbackNames,
  resolveTaskApiPreset,
  resolveTaskApiPresetChain,
} from './resolve';
import type { PostProcessTask, ScriptSettings } from '../tasks/schema';

export const DEFAULT_ROUTE_MAX_CONCURRENCY = 5;

export function normalizeRouteMaxConcurrency(value: unknown): number {
  if (value == null || !Number.isFinite(Number(value))) return DEFAULT_ROUTE_MAX_CONCURRENCY;
  return Math.max(0, Math.floor(Number(value)));
}

export function alignFallbackMaxConcurrencies(
  fallbacks: string[],
  limits: number[] | undefined,
  fill = DEFAULT_ROUTE_MAX_CONCURRENCY,
): number[] {
  const next = (limits ?? []).map(normalizeRouteMaxConcurrency);
  while (next.length < fallbacks.length) next.push(fill);
  return next.slice(0, fallbacks.length);
}

/** 将任务配置转为 preset 链上各路由此路由名索引的并发上限（0 = 不限制） */
export function buildRouteConcurrencyLimits(
  settings: ScriptSettings,
  taskId: string,
  task: Pick<
    PostProcessTask,
    | 'apiPresetName'
    | 'apiPresetFallbackNames'
    | 'apiPrimaryMaxConcurrency'
    | 'apiFallbackMaxConcurrencies'
  >,
): ReadonlyMap<string, number> {
  const chain = resolveTaskApiPresetChain(settings, taskId, task);
  const limits = new Map<string, number>();
  if (!chain.length) return limits;

  limits.set(chain[0]!, normalizeRouteMaxConcurrency(task.apiPrimaryMaxConcurrency));

  const primary = resolveTaskApiPreset(settings, taskId, task.apiPresetName);
  const fallbacks = normalizeApiPresetFallbackNames(task.apiPresetFallbackNames, primary);
  const fbLimits = alignFallbackMaxConcurrencies(fallbacks, task.apiFallbackMaxConcurrencies);

  for (let i = 0; i < fallbacks.length; i++) {
    const name = fallbacks[i]!;
    if (!chain.includes(name)) continue;
    limits.set(name, normalizeRouteMaxConcurrency(fbLimits[i]));
  }

  return limits;
}

export function hasAnyRouteConcurrencyCap(limits: ReadonlyMap<string, number>): boolean {
  for (const cap of limits.values()) {
    if (cap > 0) return true;
  }
  return false;
}
