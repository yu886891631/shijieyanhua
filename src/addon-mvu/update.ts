import { getAddonArchive, writeAddonArchive } from './archive';
import { shouldShowAddonUpdateErrors } from './config';
import { reconcileSingularityAfterPatch } from './control';
import { AddonEvent } from './events';
import { canonicalizePatchOps, verifyCanonicalWrites } from './patch-canonicalize';
import {
  applyMvuLikePatch,
  extractAddonJsonPatchOpsWithIssues,
  MvuJsonPatchOp,
  PatchIssue,
} from './patch';
import {
  createPatchLogEntry,
  getLastPatchLog,
  mergePatchLogAfterManualApply,
  mergePatchLogEntries,
  setLastPatchLog,
  type AddonPatchFailedFragment,
  type AddonPatchLogEntry,
} from './patch-log';
import { syncReplicaLaunched } from './replica-sync';
import { AddonData, normalizeAddonData } from './schema';

export type AddonWrapper = {
  addon_data: AddonData;
};

export type AddonUpdateResult = {
  data: AddonData;
  changed: boolean;
  ops: MvuJsonPatchOp[];
  issues: PatchIssue[];
  failedFragments: AddonPatchFailedFragment[];
};

export type AddonUpdateOptions = {
  /** 是否触发 Addon.events 钩子, 默认 false (parseMessage 等纯解析场景) */
  emitEvents?: boolean;
  message_content?: string;
  /** patch 解析完成后、应用前可修改 ops */
  mutateOps?: (ops: MvuJsonPatchOp[]) => MvuJsonPatchOp[];
  /** 写回特异点存档 / 副本族同步的楼层；缺省则不做 reconcile 写回 */
  message_id?: number;
  /**
   * 为 true 且上一份日志同 messageId 时，按 path 合并进 lastPatchLog（工作流多阶段）。
   * 不会写入 manualFixedOps。
   */
  mergeIntoLastLog?: boolean;
};

export function wrapAddonData(addon_data: AddonData): AddonWrapper {
  return { addon_data };
}

function notifyIssues(issues: PatchIssue[]): void {
  const visible = issues.filter(issue => issue.kind !== 'heal');
  if (visible.length === 0 || !shouldShowAddonUpdateErrors()) {
    return;
  }
  const hasParse = visible.some(issue => issue.kind === 'parse');
  const body = hasParse
    ? '部分 patch 未能应用，请打开 addon 控制台 →「变更」查看并修改'
    : '变量应用存在问题，请打开 addon 控制台 →「变更」查看并修改';
  toastr.warning(body, '[addon-mvu] 变量更新存在问题');
}

async function publishPatchLog(entry: AddonPatchLogEntry, emitEvents: boolean): Promise<void> {
  setLastPatchLog(entry);
  if (emitEvents) {
    await eventEmit(AddonEvent.PATCH_LOG_UPDATED, entry);
  }
}

/** 工作流同楼合并：仅当 mergeIntoLastLog 且与上一份 messageId 一致时合并 */
function resolveMessagePatchLogEntry(
  partial: {
    messageId?: number;
    ops: MvuJsonPatchOp[];
    issues: PatchIssue[];
    failedFragments: AddonPatchFailedFragment[];
    changed: boolean;
  },
  mergeIntoLastLog: boolean | undefined,
): AddonPatchLogEntry {
  const prev = getLastPatchLog();
  if (
    mergeIntoLastLog &&
    prev &&
    prev.messageId !== undefined &&
    partial.messageId !== undefined &&
    prev.messageId === partial.messageId
  ) {
    return mergePatchLogEntries(prev, partial, { recordSuccessfulAsManual: false });
  }
  return createPatchLogEntry(partial);
}

async function reconcileAfterPatch(
  base: AddonData,
  data: AddonData,
  message_id: number | undefined,
): Promise<{ data: AddonData; warnings: string[] }> {
  if (message_id !== undefined && isAccessibleFloor(message_id)) {
    const archive = getAddonArchive(message_id);
    const reconciled = reconcileSingularityAfterPatch(base, data, archive);
    writeAddonArchive(message_id, reconciled.archive);
    const sync_warnings = await syncReplicaLaunched(reconciled.data);
    return { data: reconciled.data, warnings: [...reconciled.warnings, ...sync_warnings] };
  }
  const archive = { activeKey: null as string | null, snapshots: {} as Record<string, AddonData> };
  const reconciled = reconcileSingularityAfterPatch(base, data, archive);
  return { data: reconciled.data, warnings: reconciled.warnings };
}

/**
 * 对楼层 addon_data 直接应用 ops（不依赖消息 XML）。
 * 供控制台「应用此条」与内部复用。
 */
export async function applyOpsToFloor(
  ops: MvuJsonPatchOp[],
  base: AddonData,
  options: {
    message_id?: number;
    emitEvents?: boolean;
    /** 为 true 时合并进上一份变更日志，避免单条应用清空其它条目 */
    mergeIntoLastLog?: boolean;
    resolvedFragmentIndexes?: number[];
  } = {},
): Promise<AddonUpdateResult> {
  const emitEvents = options.emitEvents !== false;
  const old_wrapper = wrapAddonData(base);
  const issues: PatchIssue[] = [];
  const failedFragments: AddonPatchFailedFragment[] = [];

  if (emitEvents) {
    await eventEmit(AddonEvent.VARIABLE_UPDATE_STARTED, old_wrapper);
  }

  const { ops: canon_ops, issues: canon_issues } = canonicalizePatchOps(ops, base);
  issues.push(...canon_issues);

  if (emitEvents) {
    await eventEmit(AddonEvent.PATCH_PARSED, old_wrapper, canon_ops, '');
  }

  const { data: patched, issues: apply_issues } = applyMvuLikePatch(_.cloneDeep(base), canon_ops);
  issues.push(...apply_issues);

  let new_wrapper = wrapAddonData(normalizeAddonData(patched));
  issues.push(...verifyCanonicalWrites(canon_ops, new_wrapper.addon_data));

  if (emitEvents) {
    await eventEmit(AddonEvent.VARIABLE_UPDATE_ENDED, new_wrapper, old_wrapper);
    new_wrapper = wrapAddonData(normalizeAddonData(new_wrapper.addon_data));
  }

  const reconciled = await reconcileAfterPatch(base, new_wrapper.addon_data, options.message_id);
  new_wrapper = wrapAddonData(reconciled.data);
  for (const w of reconciled.warnings) {
    issues.push({ kind: 'apply', message: w });
  }

  const changed = !_.isEqual(new_wrapper.addon_data, base);
  const partial = {
    messageId: options.message_id,
    ops: canon_ops,
    issues,
    failedFragments,
    changed,
    resolvedFragmentIndexes: options.resolvedFragmentIndexes,
  };
  const entry = options.mergeIntoLastLog
    ? mergePatchLogAfterManualApply(getLastPatchLog(), partial)
    : createPatchLogEntry(partial);
  await publishPatchLog(entry, emitEvents);
  notifyIssues(issues);

  return {
    data: new_wrapper.addon_data,
    changed,
    ops: canon_ops,
    issues,
    failedFragments,
  };
}

/**
 * 从消息解析 `<AddonJSONPatch>` 并应用 patch.
 * 无有效变更时仍可能写入 patch log（解析/应用 issues）。
 * 无 patch 块且无 issue 时返回 undefined (对齐 MVU parseMessage 语义).
 */
export async function updateAddonFromMessage(
  message: string,
  base: AddonData,
  options: AddonUpdateOptions = {},
): Promise<AddonUpdateResult | undefined> {
  const emitEvents = !!options.emitEvents;
  const old_wrapper = wrapAddonData(base);

  if (emitEvents) {
    await eventEmit(AddonEvent.VARIABLE_UPDATE_STARTED, old_wrapper);
  }

  const {
    ops: extracted_ops,
    issues: parse_issues,
    failedFragments,
  } = extractAddonJsonPatchOpsWithIssues(message);

  if (extracted_ops.length === 0) {
    if (parse_issues.length > 0 || failedFragments.length > 0) {
      const entry = resolveMessagePatchLogEntry(
        {
          messageId: options.message_id,
          ops: [],
          issues: parse_issues,
          failedFragments,
          changed: false,
        },
        options.mergeIntoLastLog,
      );
      await publishPatchLog(entry, emitEvents);
      notifyIssues(parse_issues);
    }
    return undefined;
  }

  let ops = extracted_ops;
  if (options.mutateOps) {
    ops = options.mutateOps(ops);
  }

  const { ops: canon_ops, issues: canon_issues } = canonicalizePatchOps(ops, base);
  ops = canon_ops;

  if (emitEvents) {
    await eventEmit(AddonEvent.PATCH_PARSED, old_wrapper, ops, options.message_content ?? message);
  }

  const { data: patched, issues: apply_issues } = applyMvuLikePatch(_.cloneDeep(base), ops);
  let issues = [...parse_issues, ...canon_issues, ...apply_issues];

  let new_wrapper = wrapAddonData(normalizeAddonData(patched));
  issues.push(...verifyCanonicalWrites(ops, new_wrapper.addon_data));

  if (emitEvents) {
    await eventEmit(AddonEvent.VARIABLE_UPDATE_ENDED, new_wrapper, old_wrapper);
    new_wrapper = wrapAddonData(normalizeAddonData(new_wrapper.addon_data));
  }

  const reconciled = await reconcileAfterPatch(base, new_wrapper.addon_data, options.message_id);
  new_wrapper = wrapAddonData(reconciled.data);
  for (const w of reconciled.warnings) {
    issues.push({ kind: 'apply', message: w });
  }

  const changed = !_.isEqual(new_wrapper.addon_data, base);
  const entry = resolveMessagePatchLogEntry(
    {
      messageId: options.message_id,
      ops,
      issues,
      failedFragments,
      changed,
    },
    options.mergeIntoLastLog,
  );
  await publishPatchLog(entry, emitEvents);
  notifyIssues(issues);

  if (!changed) {
    return undefined;
  }

  return {
    data: new_wrapper.addon_data,
    changed: true,
    ops,
    issues,
    failedFragments,
  };
}

function isAccessibleFloor(message_id: number): boolean {
  return message_id >= 0 && getChatMessages(message_id).length > 0;
}
