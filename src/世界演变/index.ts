import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import { ACU_PP_WORKFLOW_COMPLETED, type WorkflowCompletedPayload } from '../工作流助手/tasks/events';
import { loadSettings } from './store';
import { openWorldEvolutionPanel } from './ui';
import { runWorldEvolution } from './engine';

const SCRIPT_BUTTON = '打开世界演变面板';
const LOG_PREFIX = '[世界演变]';
const MENU_ITEM_ID = 'acu-world-evolution-menu-item';
const MENU_CLICK_NAMESPACE = 'click.acu-world-evolution';
const MENU_MAX_RETRIES = 30;
const MENU_RETRY_DELAY_MS = 500;
const MENU_CLOSE_DELAY_MS = 150;
const GENERATION_FALLBACK_DELAY_MS = 800;
const GENERATION_FALLBACK_MAX_POLLS = 8;

type MenuJQuery = typeof $;

function getHostDocument(): Document {
  try {
    return window.parent?.document ?? document;
  } catch {
    return document;
  }
}

function getHostJQuery(): MenuJQuery {
  try {
    const hostWindow = window.parent ?? window;
    return hostWindow.jQuery ?? hostWindow.$ ?? $;
  } catch {
    return $;
  }
}

async function closeHostExtensionsMenuIfOpen(host$: MenuJQuery, hostDocument: Document): Promise<void> {
  const menuButton = host$('#extensionsMenuButton', hostDocument);
  const extensionsMenu = host$('#extensionsMenu', hostDocument);
  if (menuButton.length && extensionsMenu.is(':visible')) {
    menuButton.trigger('click');
    await new Promise(resolve => setTimeout(resolve, MENU_CLOSE_DELAY_MS));
  }
}

function registerWorldEvolutionMenuEntry(onClick: () => void): { destroy: () => void } {
  const hostDocument = getHostDocument();
  const host$ = getHostJQuery();
  let destroyed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const handleClick = async (event: JQuery.ClickEvent) => {
    event.stopPropagation();
    await closeHostExtensionsMenuIfOpen(host$, hostDocument);
    onClick();
  };

  const attemptInsert = (retry: number): void => {
    if (destroyed) return;

    const extensionsMenu = host$('#extensionsMenu', hostDocument);
    if (!extensionsMenu.length) {
      if (retry < MENU_MAX_RETRIES) {
        retryTimer = setTimeout(() => attemptInsert(retry + 1), MENU_RETRY_DELAY_MS);
      } else {
        console.warn(`${LOG_PREFIX} 魔法棒菜单 #extensionsMenu 未找到，入口注册已放弃`);
      }
      return;
    }

    const existingItem = host$(`#${MENU_ITEM_ID}`, hostDocument);
    if (existingItem.length) {
      existingItem.off(MENU_CLICK_NAMESPACE).on(MENU_CLICK_NAMESPACE, handleClick);
      return;
    }

    const item = host$(
      `<div class="list-group-item flex-container flexGap5 interactable" id="${MENU_ITEM_ID}" ` +
        'title="打开世界演变" tabindex="0">' +
        '<i class="fa-fw fa-solid fa-globe extensionsMenuExtensionButton"></i>' +
        '<span>世界演变</span>' +
        '</div>',
    );
    item.on(MENU_CLICK_NAMESPACE, handleClick);
    extensionsMenu.append(item);
    console.info(`${LOG_PREFIX} 已注册魔法棒菜单入口`);
  };

  attemptInsert(0);

  return {
    destroy: () => {
      destroyed = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      host$(`#${MENU_ITEM_ID}`, hostDocument).off(MENU_CLICK_NAMESPACE).remove();
    },
  };
}

function registerWorldEvolution(): void {
  const menuEntry = registerWorldEvolutionMenuEntry(() => openWorldEvolutionPanel());
  const generationFallbackTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const generationFallbackPolls = new Map<number, number>();

  const cancelGenerationFallback = (messageId: number): void => {
    const timer = generationFallbackTimers.get(messageId);
    if (timer) clearTimeout(timer);
    generationFallbackTimers.delete(messageId);
    generationFallbackPolls.delete(messageId);
  };

  const hasWorkflowDoneMarker = (messageId: number): boolean => {
    const message = getChatMessages(messageId)[0] as Record<string, unknown> | undefined;
    return (message?.data as Record<string, unknown> | undefined)?._post_process_done === true;
  };

  const getWorkflowCompletionState = (messageId: number): boolean | null => {
    try {
      const hostWindow = (window.parent ?? window) as Window & {
        AcuPostProcessAPI?: {
          getRunStatusForFloor?: (floorId: number) => {
            taskResults?: Array<{ success?: boolean; skipped?: boolean }>;
          } | null;
        };
      };
      const api = hostWindow.AcuPostProcessAPI;
      if (!api?.getRunStatusForFloor) return null;
      const status = api.getRunStatusForFloor(messageId);
      if (!status?.taskResults) return null;
      return status.taskResults.some(task => task.success === true && task.skipped !== true);
    } catch {
      return null;
    }
  };

  const scheduleGenerationFallback = (messageId: number): void => {
    cancelGenerationFallback(messageId);
    const poll = () => {
      const settings = loadSettings();
      if (!settings.enabled || !settings.autoRun || getCurrentChatKey() === '') {
        cancelGenerationFallback(messageId);
        return;
      }
      const currentPoll = (generationFallbackPolls.get(messageId) ?? 0) + 1;
      generationFallbackPolls.set(messageId, currentPoll);
      const workflowState = getWorkflowCompletionState(messageId);
      // 工作流存在时以其楼层运行快照为准，避免“工作流失败但注入标记残留”误触发。
      if (workflowState === true) {
        cancelGenerationFallback(messageId);
        void runWorldEvolution(messageId, { source: 'auto' });
        return;
      }
      if (workflowState === false) {
        cancelGenerationFallback(messageId);
        return;
      }
      // 没有工作流助手时，才使用注入标记或短延迟兜底。
      if (!workflowState && hasWorkflowDoneMarker(messageId)) {
        cancelGenerationFallback(messageId);
        void runWorldEvolution(messageId, { source: 'auto' });
        return;
      }
      if (currentPoll >= GENERATION_FALLBACK_MAX_POLLS) {
        cancelGenerationFallback(messageId);
        if (!workflowState) void runWorldEvolution(messageId, { source: 'auto' });
        return;
      }
      const timer = setTimeout(poll, GENERATION_FALLBACK_DELAY_MS);
      generationFallbackTimers.set(messageId, timer);
    };
    const timer = setTimeout(poll, GENERATION_FALLBACK_DELAY_MS);
    generationFallbackTimers.set(messageId, timer);
  };

  appendInexistentScriptButtons([{ name: SCRIPT_BUTTON, visible: true }]);
  eventOn(getButtonEvent(SCRIPT_BUTTON), () => openWorldEvolutionPanel());

  const stopWorkflowCompleted = eventOn(ACU_PP_WORKFLOW_COMPLETED, (payload: WorkflowCompletedPayload) => {
    cancelGenerationFallback(payload.messageId);
    const settings = loadSettings();
    if (!settings.enabled || !settings.autoRun || payload.cancelled || !payload.hasSuccess) return;
    if (payload.chatKey !== getCurrentChatKey()) return;
    void runWorldEvolution(payload.messageId, { source: 'auto' });
  });

  const stopGenerationEnded = eventMakeLast(tavern_events.GENERATION_ENDED, (messageId: number) => {
    scheduleGenerationFallback(messageId);
  });

  const stopChatChanged = eventOn(tavern_events.CHAT_CHANGED, () => {
    for (const timer of generationFallbackTimers.values()) clearTimeout(timer);
    generationFallbackTimers.clear();
    generationFallbackPolls.clear();
    console.info(`${LOG_PREFIX} 已切换聊天，等待下一轮工作流完成信号`);
  });

  $(window).on('pagehide.world-evolution-menu', () => {
    menuEntry.destroy();
    stopWorkflowCompleted.stop();
    stopGenerationEnded.stop();
    stopChatChanged.stop();
    for (const timer of generationFallbackTimers.values()) clearTimeout(timer);
    generationFallbackTimers.clear();
    generationFallbackPolls.clear();
  });

  console.info(`${LOG_PREFIX} 已加载：独立世界演变插件；默认关闭`);
}

$(() => {
  registerWorldEvolution();
  // 面板不强制打开；只在脚本按钮中提供入口。
});
