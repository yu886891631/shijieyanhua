/** TavernHelper entry: installs exactly one isolated menu/button. No production engine or storage imports. */
declare const __T15_APP_SOURCE__: string;
declare const __T15_CANDIDATE_VERSION__: string;
declare const __T15_APP_HASH__: string;
const rootId = 'world-evolution-t15-isolated-entry';
let panel: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;
let stopButton: (() => void) | null = null;
const host = window.parent.document;
function open() {
  if (stopped) return;
  if (panel) {
    panel.style.display = 'flex';
    return;
  }
  panel = host.createElement('div');
  panel.id = `${rootId}-panel`;
  panel.style.cssText =
    'position:fixed;inset:12px;z-index:2147483000;display:flex;flex-direction:column;background:#e8eee5;border:1px solid #6f8b73;border-radius:14px;overflow:hidden;';
  const close = host.createElement('button');
  close.textContent = '收起 T15 隔离工作区（保留本次内存）';
  close.style.cssText = 'flex:none;padding:8px;color:#294734;background:#f1f8ef;border:0;cursor:pointer;';
  close.addEventListener('click', () => {
    if (panel) panel.style.display = 'none';
  });
  const frame = host.createElement('iframe');
  frame.title = '世界演变 T15 隔离功能候选版';
  frame.style.cssText = 'width:100%;flex:1;min-height:0;border:0;';
  // srcdoc executes only the compiled local candidate; no remote imports, no origin storage.
  frame.srcdoc =
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta name="t15-build" content="${__T15_APP_HASH__}"><title>${__T15_CANDIDATE_VERSION__}</title>` +
    '<style>body{margin:0}html{color-scheme:light}</style><div id="world-evolution-t15-root"></div><script>' +
    __T15_APP_SOURCE__.replaceAll('</script', '<\\/script') +
    '</script></html>';
  frame.addEventListener('load', () =>
    frame.contentDocument?.addEventListener('t15-close-request', () => {
      if (panel) panel.style.display = 'none';
    }),
  );
  panel.append(close, frame);
  host.body.append(panel);
}
function install(attempt = 0) {
  if (stopped) return;
  const menu = host.getElementById('extensionsMenu');
  if (!menu) {
    if (attempt < 20) timer = setTimeout(() => install(attempt + 1), 500);
    return;
  }
  if (host.getElementById(`${rootId}-menu`)) return;
  const item = host.createElement('div');
  item.id = `${rootId}-menu`;
  item.className = 'list-group-item flex-container flexGap5';
  item.role = 'button';
  item.tabIndex = 0;
  item.textContent = `世界演变 · ${__T15_CANDIDATE_VERSION__} · 隔离测试`;
  item.addEventListener('click', open);
  item.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  menu.append(item);
}
function cleanup() {
  stopped = true;
  if (timer) clearTimeout(timer);
  stopButton?.();
  panel?.remove();
  panel = null;
  host.getElementById(`${rootId}-menu`)?.remove();
  host.getElementById(rootId)?.remove();
}
$(() => {
  // A duplicate must not own/delete another instance's menu or session.
  if (host.getElementById(rootId)) return;
  const marker = host.createElement('span');
  marker.id = rootId;
  marker.hidden = true;
  host.body.append(marker);
  stopButton = eventOn(getButtonEvent('打开 T15 隔离测试工作区'), open).stop;
  install();
  window.addEventListener('pagehide', cleanup, { once: true });
});
