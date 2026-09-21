const PERMANENT_STYLE_ATTR = 'data-acu-pp-permanent';

/** 酒馆助手脚本运行在 iframe，toastr / #toast-container 在父页面；$() 已代理到父文档 */
export function getHostDocument(): Document {
  const hostHead = typeof $ !== 'undefined' ? ($('head')[0] as HTMLHeadElement | undefined) : undefined;
  return hostHead?.ownerDocument ?? document;
}

export function getHostWindow(): Window {
  return getHostDocument().defaultView ?? window;
}

/** 将样式作为 head 直接子节点注入，并标记为永久样式（teleportStyle 不会克隆） */
export function setPermanentStyle(id: string, css: string): void {
  const doc = getHostDocument();
  let style = doc.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = id;
    style.setAttribute(PERMANENT_STYLE_ATTR, '1');
    doc.head.appendChild(style);
  }
  style.textContent = css;
}

export function isPermanentStyleElement(el: Element): boolean {
  return el.getAttribute(PERMANENT_STYLE_ATTR) === '1';
}
