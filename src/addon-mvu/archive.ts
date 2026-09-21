import type { AddonData } from './schema';

export const ADDON_ARCHIVE_KEY = 'addon_archive';

export type AddonArchive = {
  activeKey: string | null;
  snapshots: Record<string, AddonData>;
};

export const DEFAULT_ADDON_ARCHIVE: AddonArchive = {
  activeKey: null,
  snapshots: {},
};

function isAccessibleFloor(message_id: number): boolean {
  return message_id >= 0 && getChatMessages(message_id).length > 0;
}

export function makeSingularityKey(world: string, name: string): string {
  return `${world}/${name}`;
}

export function parseSingularityKey(key: string): { world: string; name: string } | null {
  const idx = key.indexOf('/');
  if (idx <= 0 || idx >= key.length - 1) return null;
  return { world: key.slice(0, idx), name: key.slice(idx + 1) };
}

export function normalizeAddonArchive(raw?: unknown): AddonArchive {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return _.cloneDeep(DEFAULT_ADDON_ARCHIVE);
  }
  const obj = raw as Record<string, unknown>;
  const activeKey = typeof obj.activeKey === 'string' ? obj.activeKey : null;
  const snapshots: Record<string, AddonData> = {};
  if (obj.snapshots && typeof obj.snapshots === 'object' && !Array.isArray(obj.snapshots)) {
    for (const [k, v] of Object.entries(obj.snapshots as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        snapshots[k] = _.cloneDeep(v) as AddonData;
      }
    }
  }
  return { activeKey, snapshots };
}

export function getAddonArchive(message_id: number): AddonArchive {
  if (!isAccessibleFloor(message_id)) {
    return _.cloneDeep(DEFAULT_ADDON_ARCHIVE);
  }
  const raw = _.get(getVariables({ type: 'message', message_id }), ADDON_ARCHIVE_KEY);
  return normalizeAddonArchive(raw);
}

export function writeAddonArchive(message_id: number, archive: AddonArchive): void {
  if (!isAccessibleFloor(message_id)) {
    return;
  }
  const normalized = normalizeAddonArchive(archive);
  updateVariablesWith(
    variables => {
      _.set(variables, ADDON_ARCHIVE_KEY, normalized);
      return variables;
    },
    { type: 'message', message_id },
  );
}

export function inheritAddonArchive(message_id: number): AddonArchive {
  const previous = message_id > 0 ? getAddonArchive(message_id - 1) : undefined;
  const inherited = normalizeAddonArchive(previous);
  writeAddonArchive(message_id, inherited);
  return inherited;
}

/** 楼层已有 archive 则直接返回，否则从上一楼继承 */
export function ensureAddonArchive(message_id: number): AddonArchive {
  if (!isAccessibleFloor(message_id)) {
    return _.cloneDeep(DEFAULT_ADDON_ARCHIVE);
  }
  const raw = _.get(getVariables({ type: 'message', message_id }), ADDON_ARCHIVE_KEY);
  if (raw !== undefined && raw !== null) {
    return normalizeAddonArchive(raw);
  }
  return inheritAddonArchive(message_id);
}

/** 世界改名时同步 archive 的 activeKey 与 snapshot keys */
export function remapArchiveWorldKeys(archive: AddonArchive, oldWorld: string, newWorld: string): AddonArchive {
  const next: AddonArchive = {
    activeKey: archive.activeKey,
    snapshots: {},
  };
  if (archive.activeKey?.startsWith(`${oldWorld}/`)) {
    next.activeKey = `${newWorld}/${archive.activeKey.slice(oldWorld.length + 1)}`;
  }
  for (const [key, snap] of Object.entries(archive.snapshots)) {
    const remappedSnap = _.cloneDeep(snap);
    const worlds = remappedSnap.世界;
    if (worlds && oldWorld in worlds) {
      worlds[newWorld] = worlds[oldWorld]!;
      delete worlds[oldWorld];
    }
    if (key.startsWith(`${oldWorld}/`)) {
      next.snapshots[`${newWorld}/${key.slice(oldWorld.length + 1)}`] = remappedSnap;
    } else {
      next.snapshots[key] = remappedSnap;
    }
  }
  return next;
}

/** 删除世界时清理 archive 的 activeKey 与 snapshot keys */
export function removeArchiveWorldKeys(archive: AddonArchive, world: string): AddonArchive {
  const next: AddonArchive = {
    activeKey: archive.activeKey?.startsWith(`${world}/`) ? null : archive.activeKey,
    snapshots: {},
  };
  for (const [key, snap] of Object.entries(archive.snapshots)) {
    if (key.startsWith(`${world}/`)) continue;
    const remappedSnap = _.cloneDeep(snap);
    if (remappedSnap.世界 && world in remappedSnap.世界) {
      delete remappedSnap.世界[world];
    }
    next.snapshots[key] = remappedSnap;
  }
  return next;
}
