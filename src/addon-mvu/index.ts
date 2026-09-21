import { waitUntil } from 'async-wait-until';
import { reloadOnChatChange } from '@util/script';
import { ensureVueFeatureFlags } from '@util/vue-feature-flags';

import { injectAddonConsoleFab, markAddonConsoleSoftUnload, teardownAddonConsoleHostOnUnload } from './fab';
import { Addon } from './global-api';
import { backfillChatAddonData, processFloor } from './store';

export { randomMinorTitle, refreshNarrativeGuidanceDetails } from './narrative-guidance';
export { ADDON_HIDDEN_FROM_PROMPT_KEYS, stripAddonHiddenFieldsForDisplay, toDisplayAddonData } from './display';
export { ADDON_KEY, AddonSchema, DEFAULT_ADDON_DATA, getWorldMap, normalizeAddonData } from './schema';
export { coerceAddonData, LOOSE_NUMERIC_STRING_KEYS, STRICT_BOOLEAN_KEYS } from './coerce';
export type { AddonData, WorldEntry } from './schema';
export { AddonEvent } from './events';
export {
  applyMvuLikePatch,
  extractAddonJsonPatchOps,
  extractAddonJsonPatchOpsWithIssues,
  parseJsonPatchOps,
  parseJsonPatchOpsWithIssues,
} from './patch';
export type { MvuJsonPatchOp, PatchIssue } from './patch';
export { updateAddonFromMessage, wrapAddonData, applyOpsToFloor } from './update';
export type { AddonUpdateResult, AddonUpdateOptions, AddonWrapper } from './update';
export {
  getLastPatchLog,
  clearPatchLog,
  setLastPatchLog,
  createPatchLogEntry,
  mergePatchLogEntries,
  mergePatchLogAfterManualApply,
} from './patch-log';
export type { AddonPatchLogEntry, AddonPatchFailedFragment, MergePatchLogNext, MergePatchLogOptions } from './patch-log';
export { Addon } from './global-api';
export type { AddonUiState } from './global-api';
export {
  applyAddonUpdateFromMessage,
  backfillChatAddonData,
  ensureAddonData,
  getAddonData,
  inheritAddon,
  parseAddonMessage,
  processFloor,
  reprocessAllAddonFloors,
  hasChatMessages,
  isAccessibleMessageFloor,
  resolveAddonDataForRead,
  resolveMessageId,
  writeAddonData,
} from './store';
export { getAddonArchive, writeAddonArchive, normalizeAddonArchive, ADDON_ARCHIVE_KEY } from './archive';
export { getConsoleTheme, setConsoleTheme, ADDON_CONSOLE_THEME_KEY } from './script-ui-settings';
export type { AddonConsoleTheme } from './script-ui-settings';
export {
  activateSingularity,
  deactivateSingularity,
  reconcileSingularityAfterPatch,
  setWorldDescent,
  setWorldParallel,
  createWorld,
  renameWorld,
  deleteWorld,
} from './control';
export { injectAddonConsoleFab, openAddonConsole, closeAddonConsole, toggleAddonConsole, syncFabOrbitPlanets } from './fab';

const LEGACY_REPROCESS_ADDON_BUTTON_NAME = '重新处理addon变量';

function parentHasSillyTavern(): boolean {
  try {
    return !!_.get(window.parent, 'SillyTavern');
  } catch {
    return false;
  }
}

function exposeAddonOnParent(): void {
  try {
    (window.parent as Window & { Addon?: typeof Addon }).Addon = Addon;
  } catch {
    /* cross-origin */
  }
}

function initAddonMvu(): void {
  ensureVueFeatureFlags();
  backfillChatAddonData();

  eventMakeLast(tavern_events.MESSAGE_SENT, (message_id: number) => {
    errorCatched(() => processFloor(message_id))();
  });

  eventMakeLast(tavern_events.MESSAGE_RECEIVED, (message_id: number) => {
    errorCatched(() => processFloor(message_id))();
  });

  eventOn(tavern_events.CHAT_CHANGED, () => {
    errorCatched(backfillChatAddonData)();
  });

  // 详情与重跑已迁至控制台「变更」；清理老用户脚本栏上的同名按钮
  updateScriptButtonsWith(buttons =>
    buttons.filter(b => b.name !== LEGACY_REPROCESS_ADDON_BUTTON_NAME),
  );

  reloadOnChatChange({ beforeReload: markAddonConsoleSoftUnload });
  initializeGlobal('Addon', Addon);
  exposeAddonOnParent();
  errorCatched(injectAddonConsoleFab)();

  $(window).on('pagehide', () => {
    errorCatched(teardownAddonConsoleHostOnUnload)();
  });

  console.info('[addon-mvu] 已加载: addon_data / archive、控制台悬浮球与 Addon API 已启用');
}

$(async () => {
  try {
    await waitUntil(() => parentHasSillyTavern(), { timeout: 60000 });
  } catch {
    // parent.SillyTavern 超时未就绪时仍尝试初始化; reloadOnChatChange 会做防御处理
  }
  errorCatched(initAddonMvu)();
});
