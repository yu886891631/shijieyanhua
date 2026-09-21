import { getAddonArchive } from './archive';
import {
  applyCreateWorld,
  applyDeleteWorld,
  applyRenameWorld,
  applySetSingularityDescent,
  applySetWorldDescent,
  applySetWorldParallel,
} from './control';
import { AddonEvent } from './events';
import { syncFabOrbitPlanets } from './fab';
import {
  applyAddonUpdateFromMessage,
  ensureAddonData,
  getAddonData as getAddonDataFromStore,
  hasChatMessages,
  parseAddonMessage,
  processFloor as processFloorInternal,
  resolveAddonDataForRead,
  resolveMessageId,
  writeAddonData,
} from './store';
import { clearPatchLog, getLastPatchLog } from './patch-log';
import { refreshNarrativeGuidanceDetails } from './narrative-guidance';
import type { MvuJsonPatchOp } from './patch';
import { syncReplicaLaunched } from './replica-sync';
import { AddonData, DEFAULT_ADDON_DATA, normalizeAddonData } from './schema';
import { getConsoleTheme, setConsoleTheme, type AddonConsoleTheme } from './script-ui-settings';
import { toDisplayAddonData } from './display';
import { applyOpsToFloor, wrapAddonData, AddonWrapper } from './update';

type AddonMessageOption = Extract<VariableOption, { type: 'message' }>;

export type AddonUiState = {
  位面交汇: boolean;
  theme: AddonConsoleTheme;
};

function resolveAddonMessageId(option: AddonMessageOption): number {
  return resolveMessageId(option.message_id);
}

function requireFloorData(message_id: number): AddonData {
  return getAddonDataFromStore(message_id) ?? ensureAddonData(message_id);
}

function buildUiState(message_id: number | null): AddonUiState {
  const theme = getConsoleTheme();
  if (message_id == null || !hasChatMessages()) {
    return { 位面交汇: false, theme };
  }
  const data = resolveAddonDataForRead(message_id);
  return { 位面交汇: data.位面交汇 === true, theme };
}

export const Addon = {
  events: AddonEvent,

  getAddonData(options: AddonMessageOption): AddonWrapper {
    if (!hasChatMessages()) {
      return wrapAddonData(DEFAULT_ADDON_DATA);
    }
    const message_id = resolveAddonMessageId(options);
    const addon_data = resolveAddonDataForRead(message_id);
    return wrapAddonData(addon_data);
  },

  /** 供提示词/世界书使用的 addon 快照（已 strip 隐藏字段，不再二次 parse） */
  getDisplayAddonData(options: AddonMessageOption): AddonWrapper {
    if (!hasChatMessages()) {
      return wrapAddonData(DEFAULT_ADDON_DATA);
    }
    const message_id = resolveAddonMessageId(options);
    const addon_data = resolveAddonDataForRead(message_id);
    return wrapAddonData(toDisplayAddonData(addon_data) as AddonData);
  },

  replaceAddonData(data: AddonWrapper, options: AddonMessageOption): void {
    if (!hasChatMessages()) {
      return;
    }
    const message_id = resolveAddonMessageId(options);
    writeAddonData(message_id, normalizeAddonData(data.addon_data));
  },

  parseMessage(message: string, old_data: AddonWrapper): Promise<AddonWrapper | undefined> {
    return parseAddonMessage(message, old_data.addon_data).then(updated =>
      updated === undefined ? undefined : wrapAddonData(updated),
    );
  },

  processFloor(message_id?: number | 'latest'): Promise<void> {
    const resolved = message_id === undefined ? getLastMessageId() : resolveMessageId(message_id);
    return processFloorInternal(resolved);
  },

  applyAddonUpdateFromMessage,
  ensureAddonData,

  getLastPatchLog,
  clearPatchLog,

  async applyManualPatchOps(
    ops: MvuJsonPatchOp[],
    options: AddonMessageOption & { fragmentIndexes?: number[] } = {
      type: 'message',
      message_id: 'latest',
    },
  ) {
    if (!hasChatMessages()) {
      throw new Error('当前无聊天楼层，无法应用 patch');
    }
    if (!Array.isArray(ops) || ops.length === 0) {
      throw new Error('ops 必须是非空数组');
    }
    const message_id = resolveAddonMessageId(options);
    const base = requireFloorData(message_id);
    const result = await applyOpsToFloor(ops, base, {
      message_id,
      emitEvents: true,
      mergeIntoLastLog: true,
      resolvedFragmentIndexes: options.fragmentIndexes,
    });
    const refreshed = refreshNarrativeGuidanceDetails(result.data);
    if (!_.isEqual(refreshed, base)) {
      writeAddonData(message_id, refreshed);
    }
    return {
      data: refreshed,
      changed: result.changed || !_.isEqual(refreshed, base),
      ops: result.ops,
      issues: result.issues,
      failedFragments: result.failedFragments,
    };
  },

  getArchive(options: AddonMessageOption = { type: 'message', message_id: 'latest' }) {
    if (!hasChatMessages()) {
      return { activeKey: null, snapshots: {} };
    }
    return getAddonArchive(resolveAddonMessageId(options));
  },

  getUiState(options: AddonMessageOption = { type: 'message', message_id: 'latest' }): AddonUiState {
    if (!hasChatMessages()) {
      return buildUiState(null);
    }
    return buildUiState(resolveAddonMessageId(options));
  },

  setUiState(patch: Partial<AddonUiState>, options: AddonMessageOption = { type: 'message', message_id: 'latest' }): AddonUiState {
    if (patch.theme === 'dark' || patch.theme === 'light') {
      setConsoleTheme(patch.theme);
    }
    if (!hasChatMessages()) {
      return { 位面交汇: patch.位面交汇 === true, theme: getConsoleTheme() };
    }
    const message_id = resolveAddonMessageId(options);
    if (typeof patch.位面交汇 === 'boolean') {
      const data = _.cloneDeep(requireFloorData(message_id));
      data.位面交汇 = patch.位面交汇;
      writeAddonData(message_id, normalizeAddonData(data));
    }
    return buildUiState(message_id);
  },

  setTheme(theme: AddonConsoleTheme, _options?: AddonMessageOption): AddonUiState {
    setConsoleTheme(theme);
    if (!hasChatMessages()) {
      return { 位面交汇: false, theme: getConsoleTheme() };
    }
    return buildUiState(getLastMessageId());
  },

  setPlaneMerge(value: boolean, options?: AddonMessageOption): AddonUiState {
    return Addon.setUiState({ 位面交汇: value }, options ?? { type: 'message', message_id: 'latest' });
  },

  async setSingularityDescent(
    world: string,
    name: string,
    value: boolean,
    options: AddonMessageOption = { type: 'message', message_id: 'latest' },
  ) {
    const message_id = resolveAddonMessageId(options);
    return applySetSingularityDescent(message_id, world, name, value, requireFloorData, writeAddonData);
  },

  async setWorldDescent(
    world: string,
    value: boolean,
    options: AddonMessageOption = { type: 'message', message_id: 'latest' },
  ) {
    const message_id = resolveAddonMessageId(options);
    return applySetWorldDescent(message_id, world, value, requireFloorData, writeAddonData);
  },

  async setWorldParallel(
    world: string,
    value: boolean,
    options: AddonMessageOption = { type: 'message', message_id: 'latest' },
  ) {
    const message_id = resolveAddonMessageId(options);
    return applySetWorldParallel(message_id, world, value, requireFloorData, writeAddonData);
  },

  async createWorld(name: string, options: AddonMessageOption = { type: 'message', message_id: 'latest' }) {
    const message_id = resolveAddonMessageId(options);
    const result = await applyCreateWorld(message_id, name, requireFloorData, writeAddonData);
    syncFabOrbitPlanets();
    return result;
  },

  async renameWorld(
    oldName: string,
    newName: string,
    options: AddonMessageOption = { type: 'message', message_id: 'latest' },
  ) {
    const message_id = resolveAddonMessageId(options);
    const result = await applyRenameWorld(message_id, oldName, newName, requireFloorData, writeAddonData);
    syncFabOrbitPlanets();
    return result;
  },

  async deleteWorld(name: string, options: AddonMessageOption = { type: 'message', message_id: 'latest' }) {
    const message_id = resolveAddonMessageId(options);
    const result = await applyDeleteWorld(message_id, name, requireFloorData, writeAddonData);
    syncFabOrbitPlanets();
    return result;
  },

  async syncReplicaLaunched(options: AddonMessageOption = { type: 'message', message_id: 'latest' }) {
    if (!hasChatMessages()) return [] as string[];
    const message_id = resolveAddonMessageId(options);
    return syncReplicaLaunched(requireFloorData(message_id));
  },
} as const;

export type { AddonData, AddonWrapper };
