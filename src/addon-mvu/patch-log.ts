import type { MvuJsonPatchOp, PatchIssue } from './patch';

export type AddonPatchFailedFragment = {
  /** 1-based 展示序号 */
  index: number;
  /** 残缺/非法 JSON 原文，供控制台编辑 */
  snippet: string;
  message: string;
};

export type AddonPatchLogEntry = {
  messageId?: number;
  timestamp: number;
  ops: MvuJsonPatchOp[];
  issues: PatchIssue[];
  failedFragments: AddonPatchFailedFragment[];
  /** 控制台手动「应用此条」成功的 op，单独分区展示 */
  manualFixedOps: MvuJsonPatchOp[];
  changed: boolean;
};

export type MergePatchLogNext = {
  ops: MvuJsonPatchOp[];
  issues: PatchIssue[];
  failedFragments?: AddonPatchFailedFragment[];
  changed: boolean;
  messageId?: number;
  resolvedFragmentIndexes?: number[];
};

export type MergePatchLogOptions = {
  /** 为 true 时将本次成功 op 记入 manualFixedOps（控制台手动修复） */
  recordSuccessfulAsManual?: boolean;
};

let lastPatchLog: AddonPatchLogEntry | null = null;

export function getLastPatchLog(): AddonPatchLogEntry | null {
  return lastPatchLog;
}

export function setLastPatchLog(entry: AddonPatchLogEntry): void {
  lastPatchLog = entry;
}

export function clearPatchLog(): void {
  lastPatchLog = null;
}

export function createPatchLogEntry(
  partial: Omit<AddonPatchLogEntry, 'timestamp' | 'manualFixedOps'> & {
    timestamp?: number;
    manualFixedOps?: MvuJsonPatchOp[];
  },
): AddonPatchLogEntry {
  return {
    messageId: partial.messageId,
    timestamp: partial.timestamp ?? Date.now(),
    ops: partial.ops,
    issues: partial.issues,
    failedFragments: partial.failedFragments,
    manualFixedOps: partial.manualFixedOps ?? [],
    changed: partial.changed,
  };
}

export function opTargetPath(op: MvuJsonPatchOp): string | undefined {
  if (op.op === 'move') return op.to;
  if ('path' in op) return op.path;
  return undefined;
}

function fragmentPath(snippet: string): string | undefined {
  const m = String(snippet || '').match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!m?.[1]) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

function issueOpPath(issue: PatchIssue): string | undefined {
  if (!issue.op) return undefined;
  return opTargetPath(issue.op);
}

function successfulManualOps(ops: MvuJsonPatchOp[], issues: PatchIssue[]): MvuJsonPatchOp[] {
  const failedPaths = new Set(
    issues
      .filter(i => i.kind === 'apply')
      .map(issueOpPath)
      .filter((p): p is string => typeof p === 'string' && p.length > 0),
  );
  return ops.filter(op => {
    const p = opTargetPath(op);
    return !(p && failedPaths.has(p));
  });
}

/**
 * 按 path 合并变更日志：同 path 用新条目替换旧 op / apply issue；
 * 保留未冲突的旧条目，并追加本次 failedFragments。
 */
export function mergePatchLogEntries(
  prev: AddonPatchLogEntry | null,
  next: MergePatchLogNext,
  options: MergePatchLogOptions = {},
): AddonPatchLogEntry {
  const recordManual = !!options.recordSuccessfulAsManual;
  const fixedThisRound = recordManual ? successfulManualOps(next.ops, next.issues) : [];

  if (!prev) {
    return createPatchLogEntry({
      messageId: next.messageId,
      ops: next.ops,
      issues: next.issues,
      failedFragments: next.failedFragments ?? [],
      manualFixedOps: fixedThisRound,
      changed: next.changed,
    });
  }

  const pathSet = new Set(
    next.ops.map(opTargetPath).filter((p): p is string => typeof p === 'string' && p.length > 0),
  );
  const resolvedIdx = new Set(next.resolvedFragmentIndexes ?? []);

  const keptFragments = prev.failedFragments.filter(frag => {
    if (resolvedIdx.has(frag.index)) return false;
    const p = fragmentPath(frag.snippet);
    if (p && pathSet.has(p)) return false;
    return true;
  });
  const removedFragMessages = new Set(
    prev.failedFragments.filter(f => !keptFragments.includes(f)).map(f => f.message),
  );

  const keptPrevOps = prev.ops.filter(op => {
    const p = opTargetPath(op);
    return !(p && pathSet.has(p));
  });

  const keptPrevManual = (prev.manualFixedOps ?? []).filter(op => {
    const p = opTargetPath(op);
    return !(p && pathSet.has(p));
  });

  const keptPrevIssues = prev.issues.filter(issue => {
    if (issue.kind === 'parse' && removedFragMessages.has(issue.message)) return false;
    if (issue.kind === 'apply') {
      const p = issueOpPath(issue);
      if (p && pathSet.has(p)) return false;
    }
    return true;
  });

  return createPatchLogEntry({
    messageId: prev.messageId ?? next.messageId,
    ops: [...keptPrevOps, ...next.ops],
    issues: [...keptPrevIssues, ...next.issues],
    failedFragments: [...keptFragments, ...(next.failedFragments ?? [])].map((f, i) => ({
      ...f,
      index: i + 1,
    })),
    manualFixedOps: recordManual ? [...keptPrevManual, ...fixedThisRound] : keptPrevManual,
    changed: prev.changed || next.changed,
  });
}

/**
 * 手动应用单条/少量 op 后，合并进上一份变更日志，避免整表被替换成仅本次 ops。
 * 成功应用的 op 写入 manualFixedOps，供「手动修复」分区展示。
 */
export function mergePatchLogAfterManualApply(
  prev: AddonPatchLogEntry | null,
  next: MergePatchLogNext,
): AddonPatchLogEntry {
  return mergePatchLogEntries(prev, next, { recordSuccessfulAsManual: true });
}
