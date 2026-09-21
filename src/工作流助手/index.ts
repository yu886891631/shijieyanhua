import './ui/acu-theme.css';
import { reloadOnChatChange } from '@util/script';
import { mountAcuPostProcessAPI, acuPostProcessTaskApi } from './bridge/post-process-api';
import { readChatTaskScope } from './tasks/chat-task-scope';
import { emitChatScopeChanged, ACU_PP_TASKS_CHANGED } from './tasks/events';
import { registerTrigger } from './tasks/trigger';
import { registerUserChatTagExtractTrigger } from './tasks/chat-tag-extract';
import { registerUserInputEndInjectTrigger } from './tasks/user-input-end-inject';
import { registerTagVariableInheritance } from './tasks/tag-variables';
import { registerWorldbookWriteReconcile } from './worldbook/write-reconcile';
import { registerReplicaReconcile } from './tasks/replica-reconcile';
import { registerRunStatusRetarget } from './tasks/run-status';
import { openSettingsWindow, closeSettingsWindow } from './ui/mount-ui';
import {
  registerExtensionsMenuEntry,
  markExtensionsMenuSoftUnload,
  consumeExtensionsMenuSoftUnload,
} from './ui/extensions-menu';
import { initApiSecretsStorage } from './settings/api-secrets-storage';
import { loadSettings, useSettingsStore } from './settings';
import { updateGlobalTheme } from './ui/theme';
import { ensureAcuToastStyles } from './ui/toast-styles';
import { acuToast } from './ui/toast';
import { ensureVueFeatureFlags } from './ui/ensure-vue-feature-flags';
import { registerPlaceholderMacros } from './tasks/placeholder-macros';
import { sanitizeGlobalTasksAfterChatChange } from './tasks/persist-runtime-tasks';
import { RERUN_BUTTON_LABEL, SCRIPT_DISPLAY_NAME, SCRIPT_LOG_PREFIX } from './ui/brand';

export const RERUN_BUTTON_NAME = RERUN_BUTTON_LABEL;

ensureVueFeatureFlags();
initApiSecretsStorage();
updateGlobalTheme(loadSettings().uiThemeId);
ensureAcuToastStyles();

let scriptReady = false;

function handleOpenSettings(): void {
  if (!scriptReady) {
    acuToast('warning', `「${SCRIPT_DISPLAY_NAME}」脚本仍在加载，请稍候几秒后再点击`);
    return;
  }
  try {
    openSettingsWindow();
  } catch (error) {
    console.error(`${SCRIPT_LOG_PREFIX} 打开设置失败:`, error);
    acuToast('error', `打开设置失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

$(() => {
  const menuEntry = registerExtensionsMenuEntry(handleOpenSettings);
  scriptReady = true;

  appendInexistentScriptButtons([{ name: RERUN_BUTTON_NAME, visible: true }]);
  eventOn(getButtonEvent(RERUN_BUTTON_NAME), () => {
    if (!scriptReady) {
      acuToast('warning', `「${SCRIPT_DISPLAY_NAME}」脚本仍在加载，请稍候几秒后再点击`);
      return;
    }
    void acuPostProcessTaskApi.rerunCurrentFloor();
  });

  const offTrigger = registerTrigger();
  const offChatTagExtract = registerUserChatTagExtractTrigger();
  // 必须在聊天摘取之后注册：同为 eventMakeLast(MESSAGE_SENT)，后注册者最后执行
  const offUserInputEndInject = registerUserInputEndInjectTrigger();
  const offTagInherit = registerTagVariableInheritance();
  const offChat = reloadOnChatChange({ beforeReload: markExtensionsMenuSoftUnload });
  const offWorldbookReconcile = registerWorldbookWriteReconcile();
  const offReplicaReconcile = registerReplicaReconcile();
  const offRunStatusRetarget = registerRunStatusRetarget();
  const offPlaceholderMacros = registerPlaceholderMacros();

  mountAcuPostProcessAPI();

  const offTasksReload = eventOn(ACU_PP_TASKS_CHANGED, (payload?: { source?: string }) => {
    if (payload?.source === 'api') {
      useSettingsStore().reload();
    }
  });

  const offChatScopeNotify = eventOn(tavern_events.CHAT_CHANGED, () => {
    sanitizeGlobalTasksAfterChatChange();
    const scope = readChatTaskScope();
    void emitChatScopeChanged(scope ? 'chat_override' : 'inherit_global', scope?.originPresetName);
  });

  $(window).on('pagehide', () => {
    const soft = consumeExtensionsMenuSoftUnload();
    // 聊天切换 reload：保留父页魔杖入口 DOM，重载后仅重绑点击，避免闪烁
    if (!soft) {
      menuEntry.destroy();
    }
    offTrigger.stop();
    offChatTagExtract.stop();
    offUserInputEndInject.stop();
    offTagInherit.stop();
    offChat.stop();
    offWorldbookReconcile.stop();
    offReplicaReconcile.stop();
    offRunStatusRetarget.stop();
    offPlaceholderMacros.stop();
    offTasksReload.stop();
    offChatScopeNotify.stop();
    closeSettingsWindow();
  });
});
