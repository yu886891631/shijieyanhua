import { SCRIPT_DISPLAY_NAME, SCRIPT_LOG_PREFIX } from './brand';

const CLICK_NS = 'click.acu-pp-menu';
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 500;
const MENU_CLOSE_DELAY_MS = 150;

/** 聊天切换即将 reload 时置位：pagehide 软清理，保留魔杖入口 DOM，避免闪烁 */
let softUnloadPending = false;

export function markExtensionsMenuSoftUnload(): void {
  softUnloadPending = true;
}

export function consumeExtensionsMenuSoftUnload(): boolean {
  if (softUnloadPending) {
    softUnloadPending = false;
    return true;
  }
  return false;
}

function getMenuIds(): { containerId: string; itemId: string } {
  const prefix = getScriptId();
  return {
    containerId: `${prefix}-pp-menu-container`,
    itemId: `${prefix}-pp-menu-item`,
  };
}

async function closeExtensionsMenuIfOpen(): Promise<void> {
  const exMenuBtn = $('#extensionsMenuButton');
  const extensionsMenu = $('#extensionsMenu');
  if (exMenuBtn.length && extensionsMenu.is(':visible')) {
    exMenuBtn.trigger('click');
    await new Promise(resolve => setTimeout(resolve, MENU_CLOSE_DELAY_MS));
  }
}

export type ExtensionsMenuEntryOptions = {
  displayName?: string;
  title?: string;
  iconClass?: string;
};

export function registerExtensionsMenuEntry(
  onClick: () => void,
  options: ExtensionsMenuEntryOptions = {},
): { destroy: () => void } {
  const { containerId, itemId } = getMenuIds();
  const displayName = options.displayName ?? SCRIPT_DISPLAY_NAME;
  const title = options.title ?? `打开 ${displayName}`;
  const iconClass = options.iconClass ?? 'fa-sliders';
  let destroyed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const handleClick = async (event: JQuery.ClickEvent) => {
    event.stopPropagation();
    await closeExtensionsMenuIfOpen();
    onClick();
  };

  const bindItem = ($item: JQuery) => {
    $item.off(CLICK_NS).on(CLICK_NS, handleClick);
  };

  const attemptInsert = (retry: number) => {
    if (destroyed) {
      return;
    }

    const extensionsMenu = $('#extensionsMenu');
    if (!extensionsMenu.length) {
      if (retry < MAX_RETRIES) {
        retryTimer = setTimeout(() => attemptInsert(retry + 1), RETRY_DELAY_MS);
      } else {
        console.warn(`${SCRIPT_LOG_PREFIX} 魔法棒菜单 #extensionsMenu 未找到，入口注册已放弃`);
      }
      return;
    }

    const existingContainer = $(`#${containerId}`, extensionsMenu);
    if (existingContainer.length > 0) {
      bindItem(existingContainer.find(`#${itemId}`));
      return;
    }

    const $container = $(
      `<div class="extension_container interactable" id="${containerId}" tabindex="0"></div>`,
    );
    const $item = $(
      `<div class="list-group-item flex-container flexGap5 interactable" id="${itemId}" title="${title}">` +
        `<div class="fa-fw fa-solid ${iconClass} extensionsMenuExtensionButton"></div>` +
        `<span>${displayName}</span>` +
        `</div>`,
    );

    bindItem($item);
    $container.append($item);
    extensionsMenu.append($container);
  };

  attemptInsert(0);

  return {
    destroy: () => {
      destroyed = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const { containerId: cid, itemId: iid } = getMenuIds();
      $(`#${cid}`).find(`#${iid}`).off(CLICK_NS);
      $(`#${cid}`).remove();
    },
  };
}
