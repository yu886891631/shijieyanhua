import { openWorldEvolutionDbPanel } from './ui';
import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import { WorldEvolutionMutationScheduler } from './mutation-scheduler';
import { WORLD_EVOLUTION_DB_VERSION } from './types';

const SCRIPT_BUTTON = '打开世界演变数据库';
const MENU_ITEM_ID = 'acu-world-evolution-db-menu-item';
const MENU_CLICK_NAMESPACE = 'click.acu-world-evolution-db';
const MENU_MAX_RETRIES = 30;
const MENU_RETRY_DELAY_MS = 500;

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
    const hostWindow = (window.parent ?? window) as Window & {
      jQuery?: MenuJQuery;
      $?: MenuJQuery;
    };
    return hostWindow.jQuery ?? hostWindow.$ ?? $;
  } catch {
    return $;
  }
}

function registerMenuEntry(): void {
  const hostDocument = getHostDocument();
  const host$ = getHostJQuery();
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const insert = (retry: number) => {
    if (destroyed) return;
    const menu = host$('#extensionsMenu', hostDocument);
    if (!menu.length) {
      if (retry < MENU_MAX_RETRIES) timer = setTimeout(() => insert(retry + 1), MENU_RETRY_DELAY_MS);
      return;
    }
    const existing = host$(`#${MENU_ITEM_ID}`, hostDocument);
    if (existing.length) {
      existing.off(MENU_CLICK_NAMESPACE).on(MENU_CLICK_NAMESPACE, () => openWorldEvolutionDbPanel());
      return;
    }
    const item = host$(
      `<div class="list-group-item flex-container flexGap5 interactable" id="${MENU_ITEM_ID}" title="打开世界演变数据库" tabindex="0">` +
        '<i class="fa-fw fa-solid fa-table extensionsMenuExtensionButton"></i><span>世界演变数据库</span></div>',
    );
    item.on(MENU_CLICK_NAMESPACE, event => {
      event.stopPropagation();
      openWorldEvolutionDbPanel();
    });
    menu.append(item);
  };

  insert(0);
  $(window).on('pagehide.world-evolution-db-menu', () => {
    destroyed = true;
    if (timer) clearTimeout(timer);
    host$(`#${MENU_ITEM_ID}`, hostDocument).off(MENU_CLICK_NAMESPACE).remove();
  });
}

$(() => {
  appendInexistentScriptButtons([{ name: SCRIPT_BUTTON, visible: true }]);
  const stopButton = eventOn(getButtonEvent(SCRIPT_BUTTON), () => openWorldEvolutionDbPanel());
  const mutationScheduler = new WorldEvolutionMutationScheduler();
  const stopDeleted = eventOn(tavern_events.MESSAGE_DELETED, (messageId: number) => {
    mutationScheduler.schedule({
      chatKey: getCurrentChatKey(),
      messageId,
      kind: 'message_deleted',
    });
  });
  const stopSwiped = eventOn(tavern_events.MESSAGE_SWIPED, (messageId: number) => {
    mutationScheduler.schedule({
      chatKey: getCurrentChatKey(),
      messageId,
      kind: 'message_swiped',
    });
  });
  registerMenuEntry();
  $(window).one('pagehide.world-evolution-db-mutations', () => {
    mutationScheduler.stop();
    stopDeleted.stop();
    stopSwiped.stop();
    stopButton.stop();
  });
  console.info(`[世界演变数据库] 已加载：${SCRIPT_BUTTON} ${WORLD_EVOLUTION_DB_VERSION}`);
});
