import iframe_srcdoc from './iframe_srcdoc.html';

const PERMANENT_STYLE_SELECTOR = 'head > style[data-acu-pp-permanent]';

export async function loadReadme(url: string): Promise<boolean> {
  const readme = await fetch(url);
  if (!readme.ok) {
    return false;
  }
  const readme_text = await readme.text();
  replaceScriptInfo(readme_text);
  return true;
}

export function teleportStyle(
  append_to: JQuery.Selector | JQuery.htmlString | JQuery.TypeOrArray<Element | DocumentFragment> | JQuery = 'head',
): { destroy: () => void } {
  const $div = $(`<div>`)
    .attr('script_id', getScriptId())
    .append(
      $(`head > style`, document)
        .not(PERMANENT_STYLE_SELECTOR)
        .clone(),
    )
    .appendTo(append_to);

  return {
    destroy: () => $div.remove(),
  };
}

export function createScriptIdIframe(): JQuery<HTMLIFrameElement> {
  return $(`<iframe>`).attr({
    script_id: getScriptId(),
    frameborder: 0,
    srcdoc: iframe_srcdoc,
  }) as JQuery<HTMLIFrameElement>;
}

export function createScriptIdDiv(): JQuery<HTMLDivElement> {
  return $('<div>').attr('script_id', getScriptId()) as JQuery<HTMLDivElement>;
}

function tryGetParentSillyTavern(): unknown {
  try {
    return _.get(window.parent, 'SillyTavern');
  } catch {
    return undefined;
  }
}

function tryGetCurrentChatId(): string | undefined {
  try {
    if (!tryGetParentSillyTavern()) {
      return undefined;
    }
    const id = SillyTavern.getCurrentChatId();
    return id ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 聊天切换时刷新脚本 iframe. 初始化时若 parent.SillyTavern 尚未就绪,
 * 不会抛错, 而是等首次 CHAT_CHANGED / 稍后回填当前 chatId.
 * @param options.beforeReload 在 location.reload 之前同步调用（可写父页标记等）
 */
export function reloadOnChatChange(options?: { beforeReload?: () => void }): EventOnReturn {
  let chat_id = tryGetCurrentChatId();

  if (chat_id === undefined) {
    void (async () => {
      const { waitUntil } = await import('async-wait-until');
      try {
        await waitUntil(() => !!tryGetParentSillyTavern(), { timeout: 30000 });
      } catch {
        // ignore timeout; CHAT_CHANGED may still set chat_id later
      }
      if (chat_id === undefined) {
        chat_id = tryGetCurrentChatId();
      }
    })();
  }

  return eventOn(tavern_events.CHAT_CHANGED, new_chat_id => {
    const next = String(new_chat_id ?? '').trim();
    // 酒馆切聊天时会先抛空 id，忽略以免误 reload 到未就绪状态
    if (!next) return;
    if (chat_id === undefined) {
      chat_id = next;
      return;
    }
    if (chat_id !== next) {
      chat_id = next;
      try {
        options?.beforeReload?.();
      } catch {
        /* ignore */
      }
      window.location.reload();
    }
  });
}
