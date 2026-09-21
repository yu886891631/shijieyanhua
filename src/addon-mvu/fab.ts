import { createApp, type App as VueApp } from 'vue';
import { createPinia } from 'pinia';
import { teleportStyle } from '@util/script';
import { ensureVueFeatureFlags } from '@util/vue-feature-flags';

import ConsoleApp from '../addon-console/App.vue';
import { AddonEvent } from './events';
import { hasChatMessages, resolveAddonDataForRead } from './store';
import { getWorldMap } from './schema';
import { getConsoleTheme } from './script-ui-settings';

const FAB_ID = 'addon-console-fab';
const SHELL_ID = 'addon-console-shell';
const STYLE_ID = 'addon-console-fab-style';
const HOST_ATTR = 'data-addon-console-host';
const FAB_POS_KEY = 'addon-console-fab-pos';
const DRAG_THRESHOLD = 6;

/** 2:1 世界剪影，供陆地 mask（风格对齐 DlSNlGHT/World 悬浮球） */
const WORLDMAP_MASK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" preserveAspectRatio="none">' +
      '<path fill="#000" d="' +
      'M18 32c2-10 14-16 24-12 7 3 9 12 6 19-2 5-7 8-6 13 1 6-5 11-12 10-8-1-14-8-15-16-1-5 1-10 3-14z' +
      'M36 58c3 2 4 10-1 15-4 4-11 3-14-1-3-5 0-12 5-14 3-1 7-1 10 0z' +
      'M62 30c6-8 18-8 24 0 5 6 5 16-1 22-5 5-14 5-19 0-6-6-8-15-4-22z' +
      'M68 54c5 1 9 8 6 14-3 6-12 7-16 2-4-5-2-13 4-15 2-1 4-1 6-1z' +
      'M98 26c10-8 26-6 32 5 5 9 2 20-7 25-8 5-20 3-26-4-7-8-6-18 1-26z' +
      'M118 56c6-1 12 3 13 9 1 6-4 12-10 12-7 0-12-5-12-11 0-5 4-9 9-10z' +
      'M148 34c5-3 12-1 14 5 2 5 0 11-5 13-5 2-11 0-13-5-2-5 0-10 4-13z' +
      'M158 58c4 0 7 3 7 7s-3 7-7 7-7-3-7-7 3-7 7-7z' +
      '"/>' +
      '</svg>',
  );

type HostApi = {
  open: () => void;
  close: () => void;
  toggle: () => void;
};

type AddonConsoleRefreshWindow = Window & { __addonConsoleRefresh?: () => void };

let vueApp: VueApp | null = null;
let styleDestroy: (() => void) | null = null;
let bodyOverflowBackup: string | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
let orbitSyncBound = false;

const onChatChangedForOrbit = () => {
  syncFabOrbitPlanets();
};
const onVariableUpdateEndedForOrbit = () => {
  syncFabOrbitPlanets();
};

function hostDoc(): Document {
  try {
    return window.parent?.document ?? document;
  } catch {
    return document;
  }
}

function hostWin(): Window {
  try {
    return window.parent ?? window;
  } catch {
    return window;
  }
}

function hostBody(): HTMLElement {
  return hostDoc().body;
}

function readConsoleUrl(): string {
  try {
    const vars = getVariables({ type: 'script' }) as { addon_console_url?: string };
    return String(vars?.addon_console_url ?? '').trim();
  } catch {
    return '';
  }
}

/** 本机/回环地址在真机浏览器无法加载（ADB 通常只转发酒馆端口），应回退进程内挂载 */
function isLoopbackConsoleUrl(url: string): boolean {
  try {
    const u = new URL(url, hostWin().location.href);
    const host = u.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '0.0.0.0';
  } catch {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
  }
}

function resolveConsoleMountMode(url: string): 'iframe' | 'inprocess' {
  if (!url) return 'inprocess';
  if (isLoopbackConsoleUrl(url)) return 'inprocess';
  return 'iframe';
}

let lastMountError = '';

function panelContentHealthy(body: HTMLElement): boolean {
  if (body.querySelector('.addon-console')) return true;
  const iframe = body.querySelector('iframe') as HTMLIFrameElement | null;
  if (!iframe?.src) return false;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return false; // cross-origin or not ready — treat as not yet healthy
    return !!doc.querySelector('.addon-console, #app');
  } catch {
    // cross-origin: assume ok if src is non-loopback
    return !isLoopbackConsoleUrl(iframe.src);
  }
}

function ensureStyles(): void {
  const doc = hostDoc();
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute(HOST_ATTR, '1');
    doc.head.appendChild(style);
  }
  style.textContent = `
#${FAB_ID}{
  --ac-fab-size:28px;
  --ac-fab-ocean:#163039;
  --ac-fab-land:#5a9387;
  --ac-fab-orbit:rgba(120,170,180,.38);
  --ac-fab-orbit-pad:4px;
  position:fixed;
  z-index:9990;
  width:var(--ac-fab-size);
  height:var(--ac-fab-size);
  padding:0;
  margin:0;
  border:0;
  border-radius:50%;
  background:transparent;
  cursor:grab;
  display:block;
  user-select:none;
  -webkit-tap-highlight-color:transparent;
  touch-action:none;
  overflow:visible;
  filter:drop-shadow(0 3px 8px rgba(8,18,24,.5));
  transition:filter .2s ease, transform .15s ease;
}
#${FAB_ID}:hover{transform:scale(1.06)}
#${FAB_ID}.dragging{
  cursor:grabbing;
  transform:scale(1.1);
  transition:none;
}
#${FAB_ID} > span{
  position:absolute;
  inset:0;
  pointer-events:none;
}
#${FAB_ID} .ac-fab-orbit{
  inset:calc(var(--ac-fab-orbit-pad) * -1);
  border-radius:50%;
  border:1px dashed var(--ac-fab-orbit);
  z-index:0;
}
#${FAB_ID} .ac-fab-orbit--0{
  --ac-fab-orbit-pad:3px;
  --ac-fab-orbit:rgba(120,170,180,.42);
  border-style:dotted;
}
#${FAB_ID} .ac-fab-orbit--1{
  --ac-fab-orbit-pad:6px;
  --ac-fab-orbit:rgba(120,170,180,.34);
  border-style:dashed;
}
#${FAB_ID} .ac-fab-orbit--2{
  --ac-fab-orbit-pad:9px;
  --ac-fab-orbit:rgba(120,170,180,.26);
  border-style:dashed;
  border-width:1px;
  opacity:.95;
}
#${FAB_ID}[data-worlds]:not([data-worlds="0"]) .ac-fab-orbit--0{
  animation:ac-fab-orbit-spin 14s linear infinite;
}
#${FAB_ID}[data-worlds]:not([data-worlds="0"]) .ac-fab-orbit--1{
  animation:ac-fab-orbit-spin-rev 20s linear infinite;
}
#${FAB_ID}[data-worlds]:not([data-worlds="0"]) .ac-fab-orbit--2{
  animation:ac-fab-orbit-spin 26s linear infinite;
}
#${FAB_ID}:hover .ac-fab-orbit{
  border-color:rgba(88,184,169,.55);
}
#${FAB_ID}:hover[data-worlds]:not([data-worlds="0"]) .ac-fab-orbit--0{
  animation-duration:10s;
}
#${FAB_ID}:hover[data-worlds]:not([data-worlds="0"]) .ac-fab-orbit--1{
  animation-duration:14s;
}
#${FAB_ID}:hover[data-worlds]:not([data-worlds="0"]) .ac-fab-orbit--2{
  animation-duration:18s;
}
#${FAB_ID}:hover[data-worlds="0"] .ac-fab-orbit--0{
  animation:ac-fab-orbit-spin 12s linear infinite;
}
#${FAB_ID}:hover[data-worlds="0"] .ac-fab-orbit--1{
  animation:ac-fab-orbit-spin-rev 16s linear infinite;
}
#${FAB_ID}:hover[data-worlds="0"] .ac-fab-orbit--2{
  animation:ac-fab-orbit-spin 20s linear infinite;
}
#${FAB_ID} .ac-fab-moon{
  --ac-fab-moon-size:4.5px;
  position:absolute;
  left:50%;
  top:50%;
  width:var(--ac-fab-moon-size);
  height:var(--ac-fab-moon-size);
  margin:calc(var(--ac-fab-moon-size) / -2);
  border-radius:50%;
  z-index:2;
  box-sizing:border-box;
  transform:rotate(calc(var(--i, 0) * 360deg / var(--n, 1)))
    translateY(calc(var(--ac-fab-size) / -2 - var(--ac-fab-orbit-pad)));
}
/* 0 潮汐青：类主球海洋 */
#${FAB_ID} .ac-fab-moon--0{
  background:
    radial-gradient(circle at 32% 28%, rgba(255,255,255,.65), transparent 45%),
    radial-gradient(circle at 62% 68%, #2a6b62 0 28%, transparent 30%),
    radial-gradient(circle at 50% 50%, #5a9387, #163039);
  box-shadow:0 0 0 1px rgba(90,147,135,.45), 0 1px 2px rgba(8,18,24,.4);
}
/* 1 赤焰：火星质感 */
#${FAB_ID} .ac-fab-moon--1{
  background:
    radial-gradient(circle at 30% 26%, rgba(255,220,180,.5), transparent 42%),
    radial-gradient(circle at 70% 60%, #8a3a28 0 22%, transparent 24%),
    radial-gradient(circle at 50% 50%, #d4784a, #6b2418);
  box-shadow:0 0 0 1px rgba(212,120,74,.5), 0 0 4px rgba(180,60,30,.35);
}
/* 2 琥珀环：气态巨星 + 细环 */
#${FAB_ID} .ac-fab-moon--2{
  --ac-fab-moon-size:4px;
  background:
    radial-gradient(circle at 35% 30%, rgba(255,245,200,.55), transparent 40%),
    linear-gradient(115deg, #c9a227 0 28%, #e8c85a 28% 48%, #a67c1a 48% 72%, #d4b84a 72%);
  box-shadow:
    0 0 0 1px rgba(232,200,90,.15),
    0 0 0 2px rgba(200,165,90,.55),
    0 1px 2px rgba(8,18,24,.35);
}
/* 3 霜晶：冰蓝冰行星 */
#${FAB_ID} .ac-fab-moon--3{
  background:
    radial-gradient(circle at 28% 24%, rgba(255,255,255,.8), transparent 40%),
    radial-gradient(circle at 55% 55%, #9fd4e8, #3a6f8a);
  box-shadow:0 0 0 1px rgba(159,212,232,.55), inset 0 -1px 1px rgba(40,80,110,.35);
}
/* 4 紫雾：星云紫 */
#${FAB_ID} .ac-fab-moon--4{
  background:
    radial-gradient(circle at 30% 28%, rgba(230,210,255,.55), transparent 42%),
    radial-gradient(circle at 68% 62%, #6b3d9e 0 26%, transparent 28%),
    radial-gradient(circle at 50% 50%, #a878d4, #3d2460);
  box-shadow:0 0 0 1px rgba(168,120,212,.45), 0 0 5px rgba(120,70,180,.4);
}
/* 5 翠屿：森绿陆地感 */
#${FAB_ID} .ac-fab-moon--5{
  background:
    radial-gradient(circle at 32% 28%, rgba(220,255,220,.45), transparent 42%),
    radial-gradient(circle at 40% 55%, #2f6b3a 0 30%, transparent 32%),
    radial-gradient(circle at 70% 40%, #1a4a4a 0 18%, transparent 20%),
    radial-gradient(circle at 50% 50%, #4caf7a, #1a3d2e);
  box-shadow:0 0 0 1px rgba(76,175,122,.45), 0 1px 2px rgba(8,18,24,.4);
}
/* 6 蔷薇：暖粉岩 */
#${FAB_ID} .ac-fab-moon--6{
  background:
    radial-gradient(circle at 30% 26%, rgba(255,240,245,.6), transparent 42%),
    radial-gradient(circle at 60% 65%, #b04a6a 0 24%, transparent 26%),
    radial-gradient(circle at 50% 50%, #e89ab0, #8a3050);
  box-shadow:0 0 0 1px rgba(232,154,176,.5), 0 1px 2px rgba(8,18,24,.35);
}
/* 7 银晖：灰白月岩 + 陨坑 */
#${FAB_ID} .ac-fab-moon--7{
  background:
    radial-gradient(circle at 28% 24%, rgba(255,255,255,.7), transparent 38%),
    radial-gradient(circle at 62% 58%, #6a6e78 0 20%, transparent 22%),
    radial-gradient(circle at 42% 70%, #5a5e66 0 14%, transparent 16%),
    radial-gradient(circle at 50% 50%, #c8ccd4, #5e646e);
  box-shadow:0 0 0 1px rgba(200,204,212,.5), inset 0 0 2px rgba(255,255,255,.25);
}
#${FAB_ID}[data-many-moons="1"] .ac-fab-moon{
  --ac-fab-moon-size:3.5px;
}
#${FAB_ID} .ac-fab-globe{
  border-radius:50%;
  overflow:hidden;
  background:var(--ac-fab-ocean);
  border:1px solid rgba(229,240,237,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.1);
  z-index:1;
}
#${FAB_ID} .ac-fab-globe::before{
  content:'';
  position:absolute;
  inset:0;
  background:var(--ac-fab-land);
  -webkit-mask:url("${WORLDMAP_MASK}") 0 center / 200% 100% repeat-x;
  mask:url("${WORLDMAP_MASK}") 0 center / 200% 100% repeat-x;
  animation:ac-fab-map-scroll 28s linear infinite;
}
@keyframes ac-fab-map-scroll{
  from{-webkit-mask-position:0 center;mask-position:0 center}
  to{-webkit-mask-position:-200% center;mask-position:-200% center}
}
@keyframes ac-fab-orbit-spin{to{transform:rotate(360deg)}}
@keyframes ac-fab-orbit-spin-rev{to{transform:rotate(-360deg)}}
@media (max-width:640px){
  #${FAB_ID}{--ac-fab-size:26px}
}
@media (max-width:380px){
  #${FAB_ID}{--ac-fab-size:24px}
}
@media (prefers-reduced-motion:reduce){
  #${FAB_ID} .ac-fab-globe::before,
  #${FAB_ID} .ac-fab-orbit,
  #${FAB_ID}:hover .ac-fab-orbit{animation:none}
  #${FAB_ID}{transition:none}
}
@media (hover:none){
  #${FAB_ID}:hover{transform:none}
  #${FAB_ID} .ac-fab-orbit{
    animation:none;
    border-color:var(--ac-fab-orbit);
  }
}

#${SHELL_ID}{
  /* ST 的 html 带 transform/perspective 时，fixed 包含块是 html 而非视口；
     矮屏下 html 高度可为 0，inset/height:100% 会塌成 0，align-items:center 把面板顶出视口（只剩奶油色空白）。
     对齐工作流助手 acu-overlay：用 top/left + vw/vh(dvh)，不用 inset/%。 */
  position:fixed;
  top:0;
  left:0;
  z-index:9995;
  pointer-events:none;
  width:100vw;
  height:100vh;
  height:100dvh;
  max-width:100vw;
  max-height:100vh;
  max-height:100dvh;
  box-sizing:border-box;
  display:flex;align-items:center;justify-content:center;
  padding:0;
}
#${SHELL_ID}.open{pointer-events:auto}
#${SHELL_ID} .ac-mask{
  position:absolute;top:0;right:0;bottom:0;left:0;
  background:rgba(12,16,28,.52);
  opacity:0;transition:opacity .22s ease;
  backdrop-filter:blur(2px);
}
#${SHELL_ID}.open .ac-mask{opacity:1}
#${SHELL_ID} .ac-panel{
  position:relative;
  z-index:1;
  width:min(1080px,94vw);
  height:min(92vh,920px);
  height:min(92dvh,920px);
  max-height:92vh;
  max-height:92dvh;
  background:var(--cream-bg,#fdf9f2);
  border-radius:16px;
  box-shadow:0 16px 48px rgba(12,16,28,.28);
  border:1px solid rgba(200,164,92,.28);
  transform:translateY(12px) scale(.98);
  opacity:0;
  transition:transform .24s ease, opacity .24s ease;
  display:flex;flex-direction:column;
  overflow:hidden;
}
#${SHELL_ID}:has(.addon-console[data-theme='dark']) .ac-panel,
#${SHELL_ID}[data-theme-pref='dark'] .ac-panel{
  background:#0b142a;
  border-color:rgba(180,150,80,.3);
  box-shadow:0 16px 48px rgba(0,0,0,.45),0 0 24px rgba(120,100,50,.18);
}
#${SHELL_ID}.open .ac-panel{
  transform:translateY(0) scale(1);
  opacity:1;
}
#${SHELL_ID} .ac-panel-body{
  flex:1;min-height:0;overflow:hidden;
  display:flex;flex-direction:column;
}
#${SHELL_ID} .ac-panel-body iframe,
#${SHELL_ID} .ac-panel-body .ac-mount{
  width:100%;
  height:auto;
  border:0;
  display:flex;
  flex-direction:column;
  background:transparent;
  min-height:0;
  flex:1 1 auto;
  align-self:stretch;
}
/* Vue 样式若因外网 @import 阻塞未生效，宿主兜底保证顶栏可见（对齐工作流助手：关键 chrome 不依赖 teleport） */
#${SHELL_ID} .addon-console{
  flex:1 1 auto;
  align-self:stretch;
  width:100%;
  min-height:0;
  display:flex;
  flex-direction:column;
  overflow:hidden;
  color:var(--text,#2c2416);
  background:var(--cream-bg,#fdf9f2);
  font-family:'PingFang SC','Microsoft YaHei',sans-serif;
}
#${SHELL_ID} .addon-console .ac-header{
  flex-shrink:0;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px 10px;
  padding:10px 12px;
  background:#1a2740;
  color:#e8d5b0;
  border-bottom:2px solid #c8a45c;
  position:relative;
  z-index:3;
}
#${SHELL_ID} .addon-console .ac-header-main-title,
#${SHELL_ID} .addon-console .ac-header h1{
  margin:0;
  font-size:16px;
  font-weight:700;
  color:#e8d5b0;
}
#${SHELL_ID} .addon-console .ac-tab,
#${SHELL_ID} .addon-console .ac-btn{
  border:1px solid rgba(232,213,176,.35);
  background:rgba(255,255,255,.08);
  color:inherit;
  border-radius:999px;
  padding:6px 12px;
  min-height:36px;
  font-size:12px;
}
#${SHELL_ID} .addon-console .ac-tab.active{
  background:#c8a45c;
  color:#1a1208;
  font-weight:650;
}
#${SHELL_ID} .addon-console .ac-main,
#${SHELL_ID} .addon-console .ac-main-scroll,
#${SHELL_ID} .addon-console .ac-hint{
  color:var(--text,#2c2416);
}
@media (max-width:640px){
  #${SHELL_ID}{
    padding-top:env(safe-area-inset-top,0px);
    padding-right:env(safe-area-inset-right,0px);
    padding-bottom:env(safe-area-inset-bottom,0px);
    padding-left:env(safe-area-inset-left,0px);
    align-items:stretch;
    justify-content:stretch;
  }
  #${SHELL_ID} .ac-panel{
    /* shell 已是 100dvh；此处用 flex 填满内容盒，避免再套一层 100dvh 与 safe-area 叠加溢出 */
    width:100%;
    max-width:none;
    height:auto;
    max-height:none;
    flex:1 1 auto;
    align-self:stretch;
    min-height:0;
    border-radius:0;
    border:0;
    box-sizing:border-box;
  }
}
`;
}

const ORBIT_RING_COUNT = 3;

const FAB_MARKUP =
  '<span class="ac-fab-orbit ac-fab-orbit--0" aria-hidden="true"></span>' +
  '<span class="ac-fab-orbit ac-fab-orbit--1" aria-hidden="true"></span>' +
  '<span class="ac-fab-orbit ac-fab-orbit--2" aria-hidden="true"></span>' +
  '<span class="ac-fab-globe" aria-hidden="true"></span>';

function readSafeAreaInsets(): { top: number; right: number; bottom: number; left: number } {
  const doc = hostDoc();
  const probe = doc.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);' +
    'padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px)';
  doc.body.appendChild(probe);
  const cs = hostWin().getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(cs.paddingTop) || 0,
    right: Number.parseFloat(cs.paddingRight) || 0,
    bottom: Number.parseFloat(cs.paddingBottom) || 0,
    left: Number.parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

function getFabSize(fab?: HTMLElement | null): number {
  const el = fab ?? (hostDoc().getElementById(FAB_ID) as HTMLElement | null);
  if (el) {
    const w = el.getBoundingClientRect().width;
    if (w > 0) return w;
  }
  const vw = hostWin().visualViewport?.width ?? hostDoc().documentElement.clientWidth;
  if (vw <= 380) return 24;
  if (vw <= 640) return 26;
  return 28;
}

function clampFabPosition(left: number, top: number, size?: number): { left: number; top: number } {
  const doc = hostDoc();
  const vv = hostWin().visualViewport;
  const vw = vv?.width ?? doc.documentElement.clientWidth;
  const vh = vv?.height ?? doc.documentElement.clientHeight;
  const fabSize = size ?? getFabSize();
  const pad = 8;
  const safe = readSafeAreaInsets();
  return {
    left: Math.min(Math.max(pad + safe.left, left), Math.max(pad + safe.left, vw - fabSize - pad - safe.right)),
    top: Math.min(Math.max(pad + safe.top, top), Math.max(pad + safe.top, vh - fabSize - pad - safe.bottom)),
  };
}

function applyFabPosition(fab: HTMLElement, left: number, top: number): void {
  const pos = clampFabPosition(left, top, getFabSize(fab));
  fab.style.left = `${pos.left}px`;
  fab.style.top = `${pos.top}px`;
  fab.style.right = 'auto';
  fab.style.bottom = 'auto';
}

function loadFabPosition(fab: HTMLElement): void {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { left?: number; top?: number };
      if (typeof parsed.left === 'number' && typeof parsed.top === 'number') {
        applyFabPosition(fab, parsed.left, parsed.top);
        return;
      }
    }
  } catch {
    /* ignore */
  }
  const doc = hostDoc();
  const vv = hostWin().visualViewport;
  const vw = vv?.width ?? doc.documentElement.clientWidth;
  const vh = vv?.height ?? doc.documentElement.clientHeight;
  const size = getFabSize(fab);
  applyFabPosition(fab, vw - size - 12, vh - size - 12);
}

function saveFabPosition(left: number, top: number): void {
  try {
    localStorage.setItem(FAB_POS_KEY, JSON.stringify({ left, top }));
  } catch {
    /* ignore */
  }
}

function bindFabDrag(fab: HTMLElement): void {
  type HostWithAbort = Window & { __acFabDragAbort?: AbortController };
  const win = hostWin() as HostWithAbort;
  win.__acFabDragAbort?.abort();
  const ac = new AbortController();
  win.__acFabDragAbort = ac;
  const { signal } = ac;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  let pointerId: number | null = null;

  const onMove = (e: PointerEvent) => {
    if (!dragging || pointerId !== e.pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      moved = true;
      fab.classList.add('dragging');
    }
    applyFabPosition(fab, origLeft + dx, origTop + dy);
  };

  const onUp = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    dragging = false;
    pointerId = null;
    fab.classList.remove('dragging');
    fab.releasePointerCapture?.(e.pointerId);
    hostDoc().removeEventListener('pointermove', onMove);
    hostDoc().removeEventListener('pointerup', onUp);
    hostDoc().removeEventListener('pointercancel', onUp);
    const left = parseFloat(fab.style.left || '0');
    const top = parseFloat(fab.style.top || '0');
    saveFabPosition(left, top);
    if (!moved) {
      toggleAddonConsole();
    }
  };

  fab.addEventListener(
    'pointerdown',
    e => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      const rect = fab.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      fab.setPointerCapture?.(e.pointerId);
      hostDoc().addEventListener('pointermove', onMove, { signal });
      hostDoc().addEventListener('pointerup', onUp, { signal });
      hostDoc().addEventListener('pointercancel', onUp, { signal });
      e.preventDefault();
    },
    { signal },
  );
}

function unmountConsole(): void {
  if (vueApp) {
    vueApp.unmount();
    vueApp = null;
  }
  styleDestroy?.();
  styleDestroy = null;
}

function syncTeleportedStyles(): void {
  styleDestroy?.();
  const { destroy } = teleportStyle();
  styleDestroy = destroy;
  // 剥离 teleported style 中的阻塞型 @import（Google Fonts 等），避免整表样式不生效
  try {
    hostDoc()
      .querySelectorAll('div[script_id] style')
      .forEach(el => {
        const text = el.textContent || '';
        if (/@import/i.test(text)) {
          el.textContent = text.replace(/@import\s+url\([^)]+\)\s*;?/gi, '/* stripped @import */');
        }
      });
  } catch {
    /* ignore */
  }
}

function mountConsoleInProcess(container: HTMLElement): void {
  unmountConsole();
  container.innerHTML = '';
  lastMountError = '';
  ensureVueFeatureFlags();
  try {
    ensureVueFeatureFlags(hostWin() as unknown as typeof globalThis);
  } catch {
    /* ignore */
  }
  const mount = hostDoc().createElement('div');
  mount.className = 'ac-mount';
  container.appendChild(mount);
  try {
    vueApp = createApp(ConsoleApp);
    vueApp.use(createPinia());
    vueApp.config.errorHandler = (err, _instance, info) => {
      lastMountError = `render:${err instanceof Error ? err.message : String(err)}`;
      console.error('[addon-console] render error:', err, info);
    };
    vueApp.mount(mount);
    // 多次补传：移动端样式注入可能晚于首帧
    syncTeleportedStyles();
    requestAnimationFrame(() => syncTeleportedStyles());
    setTimeout(() => syncTeleportedStyles(), 120);
    setTimeout(() => syncTeleportedStyles(), 500);
  } catch (e) {
    lastMountError = `mount:${e instanceof Error ? e.message : String(e)}`;
    console.error('[addon-console] mount failed:', e);
    vueApp = null;
    mount.innerHTML =
      `<div class="ac-hint ac-warn" style="padding:16px;color:#b83828">控制台挂载失败: ${lastMountError}</div>`;
  }
}

function mountConsoleIframe(container: HTMLElement, url: string): void {
  unmountConsole();
  container.innerHTML = '';
  lastMountError = '';
  const iframe = hostDoc().createElement('iframe');
  iframe.src = url;
  iframe.title = 'addon-console';
  iframe.allow = 'clipboard-read; clipboard-write';
  iframe.addEventListener('error', () => {
    lastMountError = `iframe-error:${url}`;
    mountConsoleInProcess(container);
  });
  // 回环/空白 iframe：超时后回退进程内挂载
  const guard = hostWin().setTimeout(() => {
    if (!panelContentHealthy(container) && container.contains(iframe)) {
      lastMountError = `iframe-timeout-fallback:${url}`;
      mountConsoleInProcess(container);
    }
  }, 1200);
  iframe.addEventListener('load', () => {
    hostWin().clearTimeout(guard);
    if (isLoopbackConsoleUrl(url) || !panelContentHealthy(container)) {
      lastMountError = `iframe-empty-fallback:${url}`;
      mountConsoleInProcess(container);
    }
  });
  container.appendChild(iframe);
}

function loadConsoleContent(): void {
  const shell = ensureShell();
  const body = shell.querySelector('.ac-panel-body') as HTMLElement | null;
  if (!body) return;

  const consoleUrl = readConsoleUrl();
  const mode = resolveConsoleMountMode(consoleUrl);

  // 已有健康内容且进程内 Vue 仍在，跳过
  if (panelContentHealthy(body) && (mode === 'iframe' || vueApp)) {
    return;
  }

  // 清空空壳 .ac-mount / 坏 iframe，允许重挂
  if (body.querySelector('.ac-mount, iframe')) {
    unmountConsole();
    body.innerHTML = '';
  }

  if (mode === 'iframe') {
    mountConsoleIframe(body, consoleUrl);
  } else {
    mountConsoleInProcess(body);
  }
}

function setBodyScrollLocked(locked: boolean): void {
  const body = hostBody();
  if (locked) {
    if (bodyOverflowBackup === null) bodyOverflowBackup = body.style.overflow;
    body.style.overflow = 'hidden';
  } else if (bodyOverflowBackup !== null) {
    body.style.overflow = bodyOverflowBackup;
    bodyOverflowBackup = null;
  }
}

function setOpen(open: boolean): void {
  const shell = hostDoc().getElementById(SHELL_ID);
  if (!shell) return;
  shell.classList.toggle('open', open);
  setBodyScrollLocked(open);
  if (open) {
    if (!escHandler) {
      escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeAddonConsole();
      };
      hostDoc().addEventListener('keydown', escHandler);
    }
  } else if (escHandler) {
    hostDoc().removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}

function ensureShell(): HTMLElement {
  const doc = hostDoc();
  let shell = doc.getElementById(SHELL_ID);
  if (shell) return shell;

  shell = doc.createElement('div');
  shell.id = SHELL_ID;
  shell.setAttribute(HOST_ATTR, '1');
  shell.innerHTML = `
    <div class="ac-mask" data-ac-close="1"></div>
    <aside class="ac-panel" role="dialog" aria-modal="true" aria-label="世界时局与经济简报">
      <div class="ac-panel-body"></div>
    </aside>
  `;
  shell.addEventListener('click', e => {
    const t = e.target as HTMLElement | null;
    if (t?.getAttribute('data-ac-close') === '1') closeAddonConsole();
  });
  hostBody().appendChild(shell);
  return shell;
}

function exposeHostApi(): void {
  try {
    const api: HostApi = {
      open: openAddonConsole,
      close: closeAddonConsole,
      toggle: toggleAddonConsole,
    };
    (hostWin() as Window & { __addonConsoleHost?: HostApi }).__addonConsoleHost = api;
  } catch {
    /* ignore */
  }
}

/** 打开面板时读一次最新 addon_data（关闭后 Vue 仍挂载，需主动刷） */
function requestConsoleRefresh(): void {
  // Vue 挂在脚本 window（常为 iframe），勿只查 hostWin/父页
  try {
    (window as AddonConsoleRefreshWindow).__addonConsoleRefresh?.();
  } catch {
    /* ignore */
  }
  try {
    (hostWin() as AddonConsoleRefreshWindow).__addonConsoleRefresh?.();
  } catch {
    /* ignore */
  }
  try {
    const iframe = hostDoc().querySelector(`#${SHELL_ID} .ac-panel-body iframe`) as HTMLIFrameElement | null;
    const cw = iframe?.contentWindow as AddonConsoleRefreshWindow | null | undefined;
    cw?.__addonConsoleRefresh?.();
  } catch {
    /* ignore */
  }
}

function isOpen(): boolean {
  return hostDoc().getElementById(SHELL_ID)?.classList.contains('open') === true;
}

function applyShellThemePref(): void {
  try {
    const shell = hostDoc().getElementById(SHELL_ID);
    if (!shell) return;
    shell.setAttribute('data-theme-pref', getConsoleTheme());
  } catch {
    /* ignore */
  }
}

export function openAddonConsole(): void {
  ensureStyles();
  ensureShell();
  applyShellThemePref();
  loadConsoleContent();
  // 关闭时会卸掉 teleported 样式；再次打开需补回（内容可能已挂载）
  if (vueApp && !styleDestroy) {
    syncTeleportedStyles();
  }
  setOpen(true);
  exposeHostApi();
  requestConsoleRefresh();
}

export function closeAddonConsole(): void {
  setOpen(false);
  // 保留 teleported 样式（均挂在 .addon-console 下），避免再次打开时先以无样式/浅色绘制再注入
  // 真正卸载仍走 unmountConsole()
}

export function toggleAddonConsole(): void {
  if (isOpen()) closeAddonConsole();
  else openAddonConsole();
}

function countWorlds(): number {
  try {
    if (!hasChatMessages()) return 0;
    const message_id = getLastMessageId();
    const data = resolveAddonDataForRead(message_id);
    return Object.keys(getWorldMap(data)).length;
  } catch {
    return 0;
  }
}

/** 八种小星球样式，按世界序号循环 */
const MOON_STYLE_COUNT = 8;

function moonStyleClass(index: number): string {
  return `ac-fab-moon ac-fab-moon--${index % MOON_STYLE_COUNT}`;
}

function ensureOrbitRings(fab: HTMLElement): HTMLElement[] {
  const doc = hostDoc();
  let orbits = [...fab.querySelectorAll(':scope > .ac-fab-orbit')] as HTMLElement[];
  if (orbits.length === ORBIT_RING_COUNT && orbits.every((el, i) => el.classList.contains(`ac-fab-orbit--${i}`))) {
    return orbits;
  }
  orbits.forEach(el => el.remove());
  const globe = fab.querySelector(':scope > .ac-fab-globe');
  const created: HTMLElement[] = [];
  for (let r = 0; r < ORBIT_RING_COUNT; r++) {
    const span = doc.createElement('span');
    span.className = `ac-fab-orbit ac-fab-orbit--${r}`;
    span.setAttribute('aria-hidden', 'true');
    if (globe) fab.insertBefore(span, globe);
    else fab.appendChild(span);
    created.push(span);
  }
  return created;
}

/** 按 addon_data 世界数刷新轨道小星球（轮询分配到三层轨道） */
export function syncFabOrbitPlanets(): void {
  const fab = hostDoc().getElementById(FAB_ID) as HTMLElement | null;
  if (!fab) return;
  const orbits = ensureOrbitRings(fab);

  const n = countWorlds();
  fab.setAttribute('data-worlds', String(n));
  if (n > 8) fab.setAttribute('data-many-moons', '1');
  else fab.removeAttribute('data-many-moons');

  const byRing: number[][] = Array.from({ length: ORBIT_RING_COUNT }, () => []);
  for (let i = 0; i < n; i++) {
    byRing[i % ORBIT_RING_COUNT]!.push(i);
  }

  orbits.forEach((orbit, ring) => {
    const worldIndexes = byRing[ring] ?? [];
    orbit.style.setProperty('--n', String(Math.max(worldIndexes.length, 1)));

    const existing = [...orbit.querySelectorAll(':scope > .ac-fab-moon')] as HTMLElement[];
    if (existing.length === worldIndexes.length) {
      existing.forEach((moon, slot) => {
        const worldIndex = worldIndexes[slot]!;
        moon.className = moonStyleClass(worldIndex);
        moon.style.setProperty('--i', String(slot));
      });
      return;
    }

    existing.forEach(el => el.remove());
    worldIndexes.forEach((worldIndex, slot) => {
      const moon = hostDoc().createElement('span');
      moon.className = moonStyleClass(worldIndex);
      moon.setAttribute('aria-hidden', 'true');
      moon.style.setProperty('--i', String(slot));
      orbit.appendChild(moon);
    });
  });
}

function bindOrbitSyncListeners(): void {
  if (orbitSyncBound) return;
  orbitSyncBound = true;
  eventOn(tavern_events.CHAT_CHANGED, onChatChangedForOrbit);
  eventOn(AddonEvent.VARIABLE_UPDATE_ENDED, onVariableUpdateEndedForOrbit);
}

function unbindOrbitSyncListeners(): void {
  if (!orbitSyncBound) return;
  orbitSyncBound = false;
  try {
    eventRemoveListener(tavern_events.CHAT_CHANGED, onChatChangedForOrbit);
  } catch {
    /* ignore */
  }
  try {
    eventRemoveListener(AddonEvent.VARIABLE_UPDATE_ENDED, onVariableUpdateEndedForOrbit);
  } catch {
    /* ignore */
  }
}

const SOFT_UNLOAD_KEY = '__addonConsoleSoftUnload';

type HostWithSoftUnload = Window & { [SOFT_UNLOAD_KEY]?: number };

/** 聊天切换即将 reload 时调用：pagehide 走软清理，避免悬浮球闪烁 */
export function markAddonConsoleSoftUnload(): void {
  try {
    (hostWin() as HostWithSoftUnload)[SOFT_UNLOAD_KEY] = Date.now();
  } catch {
    /* ignore */
  }
}

function consumeAddonConsoleSoftUnload(): boolean {
  try {
    const win = hostWin() as HostWithSoftUnload;
    if (win[SOFT_UNLOAD_KEY]) {
      delete win[SOFT_UNLOAD_KEY];
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function injectAddonConsoleFab(): void {
  ensureStyles();
  exposeHostApi();
  bindOrbitSyncListeners();
  const doc = hostDoc();
  const existing = doc.getElementById(FAB_ID) as HTMLButtonElement | null;
  if (existing) {
    // 脚本 iframe 热重载时保留父页悬浮球 DOM，仅重绑事件，避免闪没
    bindFabDrag(existing);
    syncFabOrbitPlanets();
    return;
  }

  const fab = doc.createElement('button');
  fab.id = FAB_ID;
  fab.type = 'button';
  fab.setAttribute(HOST_ATTR, '1');
  fab.setAttribute('aria-label', '打开世界简报');
  fab.title = '世界简报（可拖动）';
  fab.innerHTML = FAB_MARKUP;
  loadFabPosition(fab);
  bindFabDrag(fab);
  hostBody().appendChild(fab);
  syncFabOrbitPlanets();

  hostWin().addEventListener('resize', () => {
    const left = parseFloat(fab.style.left || '0');
    const top = parseFloat(fab.style.top || '0');
    applyFabPosition(fab, left, top);
  });
}

/**
 * 脚本 iframe 卸载时的软清理：卸下面板，但保留父页悬浮球与样式，
 * 避免 CHAT_CHANGED 重载脚本时悬浮球闪没再出现。
 */
export function softTeardownAddonConsoleHost(): void {
  unmountConsole();
  setOpen(false);
  hostDoc().getElementById(SHELL_ID)?.remove();
  hostDoc().getElementById('addon-console-drawer')?.remove();
}

export function destroyAddonConsoleHost(): void {
  unbindOrbitSyncListeners();
  softTeardownAddonConsoleHost();
  const doc = hostDoc();
  doc.getElementById(FAB_ID)?.remove();
  doc.getElementById(STYLE_ID)?.remove();
  try {
    delete (hostWin() as Window & { __addonConsoleHost?: HostApi }).__addonConsoleHost;
  } catch {
    /* ignore */
  }
  try {
    delete (hostWin() as Window & { __acFabDragAbort?: AbortController }).__acFabDragAbort;
  } catch {
    /* ignore */
  }
}

/**
 * pagehide 入口：聊天切换软清理（保悬浮球），关闭脚本硬清理（移除悬浮球）。
 */
export function teardownAddonConsoleHostOnUnload(): void {
  if (consumeAddonConsoleSoftUnload()) softTeardownAddonConsoleHost();
  else destroyAddonConsoleHost();
}
