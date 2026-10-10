/** Daily menu only at startup. Opening mounts the full console; no developer connection wizard. */
declare const __T15_HOST_APP_SOURCE__: string;
declare const __T15_HOST_BUILD_HASH__: string;
import { T15_DAILY_VERSION } from './t15-daily-runtime';
const rootId = 'world-evolution-host-import-entry',
  host = window.parent.document;
let owned = false,
  stopped = false;
let panel: HTMLDivElement | null = null,
  frame: HTMLIFrameElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const stops: (() => void)[] = [];
function open() {
  if (stopped || !owned) return;
  if (panel) {
    panel.style.display = 'flex';
    return;
  }
  panel = host.createElement('div');
  panel.id = rootId + '-panel';
  panel.style.cssText =
    'position:fixed;inset:12px;z-index:2147483000;display:flex;flex-direction:column;background:#edf4e9;border:1px solid #789a78;border-radius:14px;overflow:hidden;';
  frame = host.createElement('iframe');
  frame.title = `世界演变 ${T15_DAILY_VERSION}`;
  frame.style.cssText = 'flex:1;width:100%;min-height:0;border:0;';
  const current = frame;
  frame.addEventListener(
    'load',
    () => {
      if (stopped || frame !== current) return;
      const target = current.contentWindow,
        doc = current.contentDocument;
      if (!target || !doc) return;
      const bridge: Record<string, () => unknown> = {
        SillyTavern: () => SillyTavern,
        tavern_events: () => tavern_events,
        eventOn: () => eventOn,
        getScriptId: () => getScriptId,
        getScriptTrees: () => getScriptTrees,
        getVariables: () => getVariables,
        insertOrAssignVariables: () => insertOrAssignVariables,
        getCharWorldbookNames: () => getCharWorldbookNames,
        getWorldbook: () => getWorldbook,
        waitGlobalInitialized: () => waitGlobalInitialized,
        Mvu: () => (typeof Mvu === 'undefined' ? undefined : Mvu),
      };
      for (const [key, get] of Object.entries(bridge)) Object.defineProperty(target, key, { get, configurable: true });
      doc.addEventListener('we-host-close', () => {
        if (panel) panel.style.display = 'none';
      });
      const script = doc.createElement('script');
      script.textContent = __T15_HOST_APP_SOURCE__;
      doc.body.append(script);
    },
    { once: true },
  );
  frame.srcdoc = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="we-host-build" content="${__T15_HOST_BUILD_HASH__}"><title>${T15_DAILY_VERSION}</title><style>html{color-scheme:light}body{margin:0;background:#edf4e9}</style><div id="world-evolution-host-root"></div></html>`;
  panel.append(frame);
  host.body.append(panel);
}
function install(attempt = 0) {
  if (stopped) return;
  const menu = host.getElementById('extensionsMenu');
  if (!menu) {
    if (attempt < 20) timer = setTimeout(() => install(attempt + 1), 500);
    return;
  }
  const item = host.createElement('div');
  item.id = rootId + '-menu';
  item.className = 'list-group-item flex-container flexGap5';
  item.role = 'button';
  item.tabIndex = 0;
  item.textContent = `世界演变 · ${T15_DAILY_VERSION}`;
  item.onclick = open;
  item.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  menu.append(item);
}
function cleanup() {
  if (!owned || stopped) return;
  stopped = true;
  if (timer) clearTimeout(timer);
  for (const stop of stops.splice(0)) stop();
  (frame?.contentWindow as (Window & { __WE_HOST_DISPOSE__?: () => void }) | null)?.__WE_HOST_DISPOSE__?.();
  panel?.remove();
  panel = null;
  frame = null;
  host.getElementById(rootId + '-menu')?.remove();
  host.getElementById(rootId)?.remove();
}
function boot() {
  if (host.getElementById(rootId)) return;
  const marker = host.createElement('span');
  marker.id = rootId;
  marker.hidden = true;
  host.body.append(marker);
  owned = true;
  try {
    for (const name of ['打开世界演变面板', '打开世界演变真实接线候选'])
      stops.push(eventOn(getButtonEvent(name), open).stop);
    install();
    window.addEventListener('pagehide', cleanup, { once: true });
  } catch {
    cleanup();
  }
}
$(boot);
