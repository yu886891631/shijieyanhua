import {
  canMigrateFloorTagKeysForReplica,
  floorTagFromExistsForReplica,
  migrateFloorTagKeysForReplica,
  remapLastManualKeepAttrValue,
} from './replica-family-cleanup';
import {
  findReplicaFamilyRootByRef,
  findReplicaFamilyRootsByAttrSpec,
  getReplicaFamilyEnumSpecKey,
  getReplicaTasks,
  renameReplicaFamilyMemberAttr,
} from './replica-family';
import { takePendingReplicaRenames } from './replica-enum-pending';
import type { PendingReplicaRename } from './replica-enum-parse';
import {
  canMigrateWorldbookForReplicaAttrRename,
  computeReplicaAttrRenameTargets,
  migrateWorldbookForReplicaAttrRename,
  type MigrateWorldbookForReplicaResult,
} from './migrate-applied-for-replica';
import {
  normalizeReplicaStateSnapshot,
  POST_PROCESS_REPLICA_STATE_KEY,
  remapReplicaRootAttrValueInSnapshot,
} from './replica-state';
import type { ChatWorldbookWriteRule, PostProcessTask, ScriptSettings } from './schema';
import { parseExtractTagSpec } from './tag-extract';
import { replicaAttrIdentityEquals } from './replica-attr-identity';

export type ApplyPendingReplicaRenamesOptions = {
  messageId: number;
  tasks: PostProcessTask[];
  rules: ChatWorldbookWriteRule[];
  settings?: ScriptSettings;
  /** 测试注入：不走全局 pending */
  renames?: PendingReplicaRename[];
  /** 测试注入：跳过世界书 I/O */
  skipWorldbook?: boolean;
  /** 测试注入：跳过楼层快照写回 */
  skipReplicaStateWrite?: boolean;
  /** 测试注入：替换世界书迁移 */
  worldbookMigrator?: (
    spec: string,
    from: string,
    to: string,
    rules: ChatWorldbookWriteRule[],
  ) => Promise<MigrateWorldbookForReplicaResult>;
};

function resolveRootsForRename(
  rename: PendingReplicaRename,
  allTasks: PostProcessTask[],
): PostProcessTask[] {
  const parsed = parseExtractTagSpec(rename.specKey);
  if (!parsed?.attrName) return [];
  if (rename.taskRef?.trim()) {
    const root = findReplicaFamilyRootByRef(rename.taskRef, allTasks);
    if (!root) return [];
    if (getReplicaFamilyEnumSpecKey(root).toLowerCase() !== rename.specKey.toLowerCase()) {
      return [];
    }
    return [root];
  }
  return findReplicaFamilyRootsByAttrSpec(parsed, allTasks);
}

function hasReplicaToConflict(roots: PostProcessTask[], to: string, tasks: PostProcessTask[]): boolean {
  for (const root of roots) {
    const members = getReplicaTasks(root.id, tasks);
    if (members.some(m => replicaAttrIdentityEquals(m.replicaFamilyAttrValue ?? '', to))) {
      return true;
    }
  }
  return false;
}

function hasAnyReplicaFrom(roots: PostProcessTask[], from: string, tasks: PostProcessTask[]): boolean {
  for (const root of roots) {
    const members = getReplicaTasks(root.id, tasks);
    if (members.some(m => replicaAttrIdentityEquals(m.replicaFamilyAttrValue ?? '', from))) {
      return true;
    }
  }
  return false;
}

/** preflight（不含 from 存在性；from 缺失由 apply 软跳过） */
async function preflightRenameEntryHard(
  rename: PendingReplicaRename,
  roots: PostProcessTask[],
  tasks: PostProcessTask[],
  messageId: number,
  rules: ChatWorldbookWriteRule[],
  skipWorldbook: boolean,
): Promise<string | null> {
  if (hasReplicaToConflict(roots, rename.to, tasks)) {
    return `目标属性值「${rename.to}」已存在`;
  }
  if (!canMigrateFloorTagKeysForReplica(rename.specKey, rename.from, rename.to, messageId)) {
    return `楼层 post_process_tags 目标键「${rename.to}」已存在`;
  }
  if (!skipWorldbook && rules.length) {
    const ok = await canMigrateWorldbookForReplicaAttrRename(
      rename.specKey,
      rename.from,
      rename.to,
      rules,
    );
    if (!ok) {
      return `世界书目标 stableName（${rename.to}）已存在`;
    }
  }
  return null;
}

async function patchReplicaStateAttrOnMessage(
  messageId: number,
  rootId: string,
  from: string,
  to: string,
): Promise<void> {
  if (messageId < 0) return;
  let msg;
  try {
    msg = getChatMessages(messageId)[0];
  } catch {
    return;
  }
  if (!msg || msg.role !== 'assistant') return;
  const data = { ...(msg.data ?? {}) } as Record<string, unknown>;
  const snap = normalizeReplicaStateSnapshot(data[POST_PROCESS_REPLICA_STATE_KEY]);
  if (!snap?.[rootId]) return;
  const nextSnap = remapReplicaRootAttrValueInSnapshot(snap, rootId, from, to);
  if (nextSnap === snap) return;
  data[POST_PROCESS_REPLICA_STATE_KEY] = nextSnap;
  try {
    await setChatMessages([{ message_id: messageId, data }], { refresh: 'none' });
  } catch (e) {
    console.warn('[工作流助手] 改名后写回副本快照失败:', e);
  }
}

type RenamedRootRecord = { rootId: string; from: string; to: string };

function rollbackRenamedRoots(
  records: RenamedRootRecord[],
  tasks: PostProcessTask[],
  messageId: number,
  skipReplicaStateWrite: boolean,
): PostProcessTask[] {
  let next = tasks;
  for (const { rootId, from, to } of records) {
    const root = next.find(t => t.id === rootId);
    if (!root) continue;
    const result = renameReplicaFamilyMemberAttr(root, to, from, next);
    if (result.renamed) {
      next = result.tasks;
      if (!skipReplicaStateWrite) {
        void patchReplicaStateAttrOnMessage(messageId, rootId, to, from);
      }
    }
  }
  return next;
}

/**
 * 消费 pending ReplicaEnum renames：改成员 identity、迁移楼层 tags / 世界书 / 快照。
 * 须在 prepareStageTasksWithReplicaSync / merge 之前调用（轮末 flush 亦同）。
 */
export async function applyPendingReplicaRenames(
  options: ApplyPendingReplicaRenamesOptions,
): Promise<PostProcessTask[]> {
  const renames =
    options.renames ?? takePendingReplicaRenames(options.messageId);
  if (!renames.length) return options.tasks;

  let tasks = [...options.tasks];
  const migratedSpecs = new Set<string>();
  const skipWorldbook = !!options.skipWorldbook;

  for (const rename of renames) {
    const roots = resolveRootsForRename(rename, tasks);
    if (!roots.length) {
      console.warn(
        `[工作流助手] ReplicaEnum 改名忽略：无匹配副本族 spec=${rename.specKey}` +
          (rename.taskRef ? ` task=${rename.taskRef}` : ''),
      );
      continue;
    }

    if (!hasAnyReplicaFrom(roots, rename.from, tasks)) {
      continue;
    }

    const preflightReason = await preflightRenameEntryHard(
      rename,
      roots,
      tasks,
      options.messageId,
      options.rules,
      skipWorldbook,
    );
    if (preflightReason) {
      console.warn(
        `[工作流助手] ReplicaEnum 改名整包跳过（${rename.from}→${rename.to}）: ${preflightReason}`,
      );
      continue;
    }

    const floorFromExisted = floorTagFromExistsForReplica(
      rename.specKey,
      rename.from,
      options.messageId,
    );
    const worldbookTargets =
      !skipWorldbook && options.rules.length
        ? computeReplicaAttrRenameTargets(
            rename.specKey,
            rename.from,
            rename.to,
            options.rules,
          )
        : [];

    const renamedRoots: RenamedRootRecord[] = [];
    for (const root of roots) {
      const liveRoot = tasks.find(t => t.id === root.id) ?? root;
      const result = renameReplicaFamilyMemberAttr(liveRoot, rename.from, rename.to, tasks);
      if (!result.renamed) {
        if (result.skipReason) {
          console.warn(
            `[工作流助手] ReplicaEnum 改名跳过「${liveRoot.name}」: ${result.skipReason} (${rename.from}→${rename.to})`,
          );
        }
        continue;
      }
      tasks = result.tasks;
      renamedRoots.push({ rootId: liveRoot.id, from: rename.from, to: rename.to });

      if (!options.skipReplicaStateWrite) {
        await patchReplicaStateAttrOnMessage(options.messageId, liveRoot.id, rename.from, rename.to);
      }
    }

    if (!renamedRoots.length) continue;

    let migrationFailed = false;
    const migrateKey = `${rename.specKey}\0${rename.from}\0${rename.to}`;
    if (!migratedSpecs.has(migrateKey)) {
      migratedSpecs.add(migrateKey);

      if (floorFromExisted) {
        const floorOk = migrateFloorTagKeysForReplica(
          rename.specKey,
          rename.from,
          rename.to,
          options.messageId,
        );
        if (!floorOk) {
          migrationFailed = true;
          console.warn(
            `[工作流助手] ReplicaEnum 改名回滚（${rename.from}→${rename.to}）: 楼层 tags 迁移失败`,
          );
        }
      }

      if (!migrationFailed && !skipWorldbook && worldbookTargets.length) {
        const migrateWb =
          options.worldbookMigrator ?? migrateWorldbookForReplicaAttrRename;
        const wbResult = await migrateWb(
          rename.specKey,
          rename.from,
          rename.to,
          options.rules,
        );
        if (wbResult.failedTargets.length > 0) {
          migrationFailed = true;
          console.warn(
            `[工作流助手] ReplicaEnum 改名回滚（${rename.from}→${rename.to}）: 世界书迁移失败`,
          );
        } else if (
          wbResult.expectedEntryMigrations > 0 &&
          wbResult.migrated < wbResult.expectedEntryMigrations
        ) {
          migrationFailed = true;
          console.warn(
            `[工作流助手] ReplicaEnum 改名回滚（${rename.from}→${rename.to}）: 世界书条目未完整迁移`,
          );
        }
      }
    }

    if (migrationFailed) {
      tasks = rollbackRenamedRoots(
        renamedRoots,
        tasks,
        options.messageId,
        !!options.skipReplicaStateWrite,
      );
      continue;
    }

    if (options.settings) {
      remapLastManualKeepAttrValue(options.settings, rename.specKey, rename.from, rename.to);
    }
  }

  return tasks;
}
