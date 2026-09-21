import { extractXmlTagInners } from '@util/xml-tag-blocks';

import { getAtPath, resolveParentForWrite, resolveParentStrict } from './patch-heal';
import { parseJsonPatchOpsWithIssues } from './patch-parse-lenient';
import type { AddonPatchFailedFragment } from './patch-log';

/** 与 MVU 变量输出格式兼容的 JSON Patch 操作 */
export type MvuJsonPatchOp =
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'delta'; path: string; value: number }
  | { op: 'insert'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; to: string };

export type PatchIssue = {
  kind: 'parse' | 'apply' | 'heal';
  message: string;
  op?: MvuJsonPatchOp;
};

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parseJsonPointer(path: string): string[] {
  if (!path.startsWith('/')) {
    throw new Error(`JSON Pointer 必须以 / 开头: ${path}`);
  }
  if (path === '/') {
    return [];
  }
  return path
    .slice(1)
    .split('/')
    .map(decodeJsonPointerSegment);
}

function isReadonlyPath(segments: string[]): boolean {
  return segments.some(segment => segment.startsWith('_'));
}

/** 拒绝世界级 `/世界/{世界}/平行演化`（补前缀后）；特异点.降临等其它路径不受影响 */
export function isForbiddenParallelEvolutionPath(segments: string[]): boolean {
  return segments.length === 3 && segments[0] === '世界' && segments[2] === '平行演化';
}

/** 拒绝 `/世界` 容器或 `/世界/{世界名}` 世界根键；世界键仅前端可创建/改名/删除 */
export function isForbiddenWorldRootPath(segments: string[]): boolean {
  if (segments.length === 1 && segments[0] === '世界') return true;
  return segments.length === 2 && segments[0] === '世界';
}

/** 拒绝写入位面交汇（仅前端） */
export function isForbiddenPlaneMergePath(segments: string[]): boolean {
  return segments[0] === '位面交汇';
}

function assertWritablePath(segments: string[]): void {
  if (isForbiddenPlaneMergePath(segments)) {
    throw new Error('位面交汇仅允许前端写入，已跳过 AI patch');
  }
  if (isForbiddenWorldRootPath(segments)) {
    throw new Error('世界键仅允许前端创建，已跳过 AI patch');
  }
  if (isForbiddenParallelEvolutionPath(segments)) {
    throw new Error('平行演化仅允许前端写入，已跳过 AI patch');
  }
}

function assignAtParent(
  parent: Record<string, unknown> | unknown[],
  key: string,
  value: unknown,
  mode: 'set' | 'insert',
): void {
  if (Array.isArray(parent)) {
    if (key === '-') {
      parent.push(value);
      return;
    }
    const index = Number(key);
    if (mode === 'insert') {
      parent.splice(index, 0, value);
      return;
    }
    parent[index] = value;
    return;
  }
  parent[key] = value;
}

function setAtPathForWrite(root: Record<string, unknown>, segments: string[], value: unknown): void {
  if (segments.length === 0) {
    throw new Error('不能 replace 根对象');
  }
  const { parent, key } = resolveParentForWrite(root, segments);
  assignAtParent(parent, key, value, 'set');
}

function setAtPathStrict(root: Record<string, unknown>, segments: string[], value: unknown): void {
  if (segments.length === 0) {
    throw new Error('不能 replace 根对象');
  }
  const { parent, key } = resolveParentStrict(root, segments);
  assignAtParent(parent, key, value, 'set');
}

function removeAtPath(root: Record<string, unknown>, segments: string[]): void {
  const { parent, key } = resolveParentStrict(root, segments);
  if (Array.isArray(parent)) {
    if (key === '-') {
      throw new Error('不能 remove 数组占位符 -');
    }
    parent.splice(Number(key), 1);
    return;
  }
  delete parent[key];
}

function coerceNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`delta 目标不是有效数字: ${JSON.stringify(value)}`);
  }
  return num;
}

function applyOp(root: Record<string, unknown>, op: MvuJsonPatchOp): void {
  switch (op.op) {
    case 'replace': {
      const segments = parseJsonPointer(op.path);
      if (isReadonlyPath(segments)) {
        return;
      }
      assertWritablePath(segments);
      setAtPathForWrite(root, segments, op.value);
      return;
    }
    case 'delta': {
      const segments = parseJsonPointer(op.path);
      if (isReadonlyPath(segments)) {
        return;
      }
      assertWritablePath(segments);
      const current = getAtPath(root, segments);
      if (current === undefined) {
        throw new Error(`路径不存在: ${op.path}`);
      }
      setAtPathStrict(root, segments, coerceNumber(current) + coerceNumber(op.value));
      return;
    }
    case 'insert': {
      const segments = parseJsonPointer(op.path);
      if (isReadonlyPath(segments)) {
        return;
      }
      assertWritablePath(segments);
      const { parent, key } = resolveParentForWrite(root, segments);
      assignAtParent(parent, key, op.value, 'insert');
      return;
    }
    case 'remove': {
      const segments = parseJsonPointer(op.path);
      if (isReadonlyPath(segments)) {
        return;
      }
      assertWritablePath(segments);
      removeAtPath(root, segments);
      return;
    }
    case 'move': {
      const fromSegments = parseJsonPointer(op.from);
      const toSegments = parseJsonPointer(op.to);
      if (isReadonlyPath(fromSegments) || isReadonlyPath(toSegments)) {
        return;
      }
      assertWritablePath(fromSegments);
      assertWritablePath(toSegments);
      const value = getAtPath(root, fromSegments);
      if (value === undefined) {
        throw new Error(`路径不存在: ${op.from}`);
      }
      removeAtPath(root, fromSegments);
      setAtPathForWrite(root, toSegments, value);
      return;
    }
    default:
      throw new Error(`未知 patch 操作: ${JSON.stringify(op)}`);
  }
}

export function parseJsonPatchOps(raw: string): MvuJsonPatchOp[] {
  const { ops, issues } = parseJsonPatchOpsWithIssues(raw);
  const fatal = issues.find(issue => issue.kind === 'parse' && ops.length === 0);
  if (fatal) {
    throw new Error(fatal.message);
  }
  return ops;
}

/** 从消息中提取所有 <AddonJSONPatch> 块并解析为 op 列表（含逐条容错；跳过孤儿开标签） */
export function extractAddonJsonPatchOpsWithIssues(message: string): {
  ops: MvuJsonPatchOp[];
  issues: PatchIssue[];
  failedFragments: AddonPatchFailedFragment[];
} {
  const ops: MvuJsonPatchOp[] = [];
  const issues: PatchIssue[] = [];
  const failedFragments: AddonPatchFailedFragment[] = [];
  for (const inner of extractXmlTagInners(message, 'AddonJSONPatch')) {
    const patchText = inner.trim();
    if (!patchText) {
      continue;
    }
    const parsed = parseJsonPatchOpsWithIssues(patchText);
    ops.push(...parsed.ops);
    issues.push(...parsed.issues);
    failedFragments.push(...parsed.failedFragments);
    if (parsed.issues.some(issue => issue.kind === 'parse')) {
      console.warn('[addon-mvu] AddonJSONPatch 存在无法修复的 op，已跳过坏条:', parsed.issues);
    }
  }
  return { ops, issues, failedFragments };
}

export { parseJsonPatchOpsWithIssues } from './patch-parse-lenient';
export type { ParseJsonPatchResult } from './patch-parse-lenient';

/** @deprecated 请使用 extractAddonJsonPatchOpsWithIssues */
export function extractAddonJsonPatchOps(message: string): MvuJsonPatchOp[] {
  return extractAddonJsonPatchOpsWithIssues(message).ops;
}

/** 对 addon_data 根对象应用 MVU 兼容 JSON Patch, 不依赖 MVU 框架 */
export function applyMvuLikePatch<T extends Record<string, unknown>>(
  data: T,
  ops: MvuJsonPatchOp[],
): { data: T; issues: PatchIssue[] } {
  const result = _.cloneDeep(data);
  const issues: PatchIssue[] = [];
  for (const op of ops) {
    try {
      applyOp(result, op);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ kind: 'apply', message, op });
      console.warn('[addon-mvu] patch 操作失败, 已跳过:', op, error);
    }
  }
  return { data: result, issues };
}

export { ensurePathForWrite, pathExists } from './patch-heal';
