import { loadSettings, saveProgressHudPosition } from '../settings';
import { getHostDocument, getHostWindow } from './permanent-style';
import { ensureAcuToastStyles } from './toast-styles';
import {
  clampHudRect,
  pxToRatio,
  resolvePlacedPx,
  type ProgressHudPositionRatio,
  type SafeAreaInsets,
} from './task-progress-hud-position';
import {
  COMPLETION_HOLD_MS,
  LEAVE_ANIMATION_MS,
  applyProgressSnapshot,
  collectCompletingTaskIds,
  createProgressDisplayState,
  displayItemClassName,
  displayStatusSymbol,
  markDisplayItemLeaving,
  orderedDisplayItems,
  removeDisplayItem,
  resetProgressDisplayState,
  type ProgressDisplayItem,
  type ProgressDisplayState,
  type TaskProgressItem,
  type TaskProgressSnapshot,
  type TaskProgressStatus,
} from './task-progress-display';

export type { TaskProgressItem, TaskProgressSnapshot, TaskProgressStatus };

export type TaskProgressUpdate = string | TaskProgressSnapshot;

const HUD_ROOT_ID = 'acu-pp-progress-hud';
const DRAG_THRESHOLD = 5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 12;

let $hudRoot: JQuery | null = null;
let stopHandler: (() => void) | null = null;
let runAborting = false;
let displayState: ProgressDisplayState = createProgressDisplayState();
let lastSnapshot: TaskProgressSnapshot | null = null;
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

let dragBound = false;
let resizeBound = false;
let dragging = false;
let dragMoved = false;
let dragFromList = false;
let dragPointerId: number | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragOrigLeft = 0;
let dragOrigTop = 0;
let lastTapAt = 0;
let lastTapX = 0;
let lastTapY = 0;
let cachedSafeArea: SafeAreaInsets | null = null;

export function isTaskProgressStopping(): boolean {
  return runAborting;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countFinished(tasks: TaskProgressItem[]): number {
  return tasks.filter(t => t.status === 'done' || t.status === 'skipped').length;
}

function clearRemovalTimers(): void {
  for (const timer of removalTimers.values()) {
    clearTimeout(timer);
  }
  removalTimers.clear();
}

function clearRemovalTimer(taskId: string): void {
  const holdKey = `${taskId}:hold`;
  const leaveKey = `${taskId}:leave`;
  for (const key of [taskId, holdKey, leaveKey]) {
    const timer = removalTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      removalTimers.delete(key);
    }
  }
}

function scheduleItemRemoval(taskId: string): void {
  clearRemovalTimer(taskId);
  const holdTimer = setTimeout(() => {
    removalTimers.delete(`${taskId}:hold`);
    displayState = markDisplayItemLeaving(displayState, taskId);
    if (lastSnapshot) {
      setHudHtml(renderSnapshotHtml(lastSnapshot));
    }
    const leaveTimer = setTimeout(() => {
      removalTimers.delete(`${taskId}:leave`);
      displayState = removeDisplayItem(displayState, taskId);
      if (lastSnapshot) {
        setHudHtml(renderSnapshotHtml(lastSnapshot));
      }
    }, LEAVE_ANIMATION_MS);
    removalTimers.set(`${taskId}:leave`, leaveTimer);
  }, COMPLETION_HOLD_MS);
  removalTimers.set(`${taskId}:hold`, holdTimer);
}

function syncDisplayState(snapshot: TaskProgressSnapshot): void {
  const prev = displayState;
  displayState = applyProgressSnapshot(prev, snapshot);
  for (const taskId of collectCompletingTaskIds(prev, displayState)) {
    scheduleItemRemoval(taskId);
  }
}

function renderTaskListItem(item: ProgressDisplayItem): string {
  const sym = displayStatusSymbol(item);
  const name = escapeHtml(item.taskName);
  const detail = item.detail
    ? `<span class="acu-pp-progress-hud__detail">(${escapeHtml(item.detail)})</span>`
    : '';
  const className = displayItemClassName(item);
  return `<li class="${className}"><span class="acu-pp-progress-hud__sym">${sym}</span><span class="acu-pp-progress-hud__name">${name}</span>${detail}</li>`;
}

function renderStopButton(): string {
  return '<button type="button" class="acu-pp-progress-hud__stop">停止</button>';
}

function renderHeadActions(innerHtml: string): string {
  return `<div class="acu-pp-progress-hud__actions">${innerHtml}</div>`;
}

function renderMessageHtml(message: string): string {
  const title = escapeHtml(message);
  return `<div class="acu-pp-progress-hud" role="status" aria-live="polite">
    <div class="acu-pp-progress-hud__head">
      <span class="acu-pp-progress-hud__title" title="${title}">${title}</span>
      ${renderHeadActions(renderStopButton())}
    </div>
  </div>`;
}

function renderSnapshotHtml(snapshot: TaskProgressSnapshot): string {
  const tasks = snapshot.tasks;
  const total = tasks.length;
  const finished = countFinished(tasks);
  const headline = escapeHtml(snapshot.headline);
  const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
  const displayItems = orderedDisplayItems(displayState, snapshot);

  let bodyHtml = '';
  if (total > 0) {
    bodyHtml += `<div class="acu-pp-progress-hud__bar" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
  }
  if (displayItems.length) {
    bodyHtml += `<ul class="acu-pp-progress-hud__list">${displayItems.map(renderTaskListItem).join('')}</ul>`;
  }

  const countHtml =
    total > 0 ? `<span class="acu-pp-progress-hud__count">${finished}/${total}</span>` : '';

  return `<div class="acu-pp-progress-hud acu-pp-progress-hud--snapshot" role="status" aria-live="polite">
    <div class="acu-pp-progress-hud__head">
      <span class="acu-pp-progress-hud__title" title="${headline}">${headline}</span>
      ${renderHeadActions(`${countHtml}${renderStopButton()}`)}
    </div>
    ${bodyHtml}
  </div>`;
}

function readViewportSize(): { width: number; height: number } {
  const win = getHostWindow();
  const doc = getHostDocument();
  const vv = win.visualViewport;
  return {
    width: vv?.width ?? doc.documentElement.clientWidth,
    height: vv?.height ?? doc.documentElement.clientHeight,
  };
}

function probeSafeAreaInsets(): SafeAreaInsets {
  const doc = getHostDocument();
  const probe = doc.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);' +
    'padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px)';
  doc.body.appendChild(probe);
  const cs = getHostWindow().getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(cs.paddingTop) || 0,
    right: Number.parseFloat(cs.paddingRight) || 0,
    bottom: Number.parseFloat(cs.paddingBottom) || 0,
    left: Number.parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

function refreshSafeAreaCache(): SafeAreaInsets {
  cachedSafeArea = probeSafeAreaInsets();
  return cachedSafeArea;
}

function getSafeAreaInsets(): SafeAreaInsets {
  return cachedSafeArea ?? refreshSafeAreaCache();
}

function getRootEl(): HTMLElement | null {
  const $root = getHudRoot();
  return ($root[0] as HTMLElement | undefined) ?? null;
}

function clearPlacedStyles(root: HTMLElement): void {
  root.classList.remove('acu-pp-progress-hud-root--placed');
  root.style.left = '';
  root.style.top = '';
  root.style.right = '';
}

function applyPlacedPx(root: HTMLElement, left: number, top: number): void {
  root.classList.add('acu-pp-progress-hud-root--placed');
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  root.style.right = 'auto';
}

function persistHudPosition(ratio: ProgressHudPositionRatio | null): void {
  try {
    saveProgressHudPosition(ratio);
  } catch (error) {
    console.warn('[工作流助手] 保存进度 HUD 位置失败:', error);
  }
}

function unbindDocumentDragListeners(): void {
  const doc = getHostDocument();
  doc.removeEventListener('pointermove', onDragMove);
  doc.removeEventListener('pointerup', onDragEnd);
  doc.removeEventListener('pointercancel', onDragEnd);
}

function cancelDragSession(): void {
  const root = getRootEl();
  dragging = false;
  dragMoved = false;
  dragFromList = false;
  dragPointerId = null;
  if (root) root.classList.remove('acu-pp-progress-hud-root--dragging');
  unbindDocumentDragListeners();
}

export function applySavedHudPosition(): void {
  if (dragging || dragMoved) return;
  const root = getRootEl();
  if (!root) return;
  let ratio: ProgressHudPositionRatio | null = null;
  try {
    ratio = loadSettings().progressHudPosition ?? null;
  } catch {
    ratio = null;
  }
  if (!ratio) {
    clearPlacedStyles(root);
    return;
  }
  const rect = root.getBoundingClientRect();
  const size = {
    width: rect.width || root.offsetWidth || 160,
    height: rect.height || root.offsetHeight || 40,
  };
  const placed = resolvePlacedPx(ratio, size, readViewportSize(), getSafeAreaInsets());
  if (!placed) {
    clearPlacedStyles(root);
    return;
  }
  applyPlacedPx(root, placed.left, placed.top);
}

function resetHudPosition(): void {
  const root = getRootEl();
  if (root) clearPlacedStyles(root);
  persistHudPosition(null);
  lastTapAt = 0;
}

function onDragMove(e: PointerEvent): void {
  if (!dragging || dragPointerId !== e.pointerId) return;
  const root = getRootEl();
  if (!root) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (!dragMoved) {
    if (absDx <= DRAG_THRESHOLD && absDy <= DRAG_THRESHOLD) return;

    // 列表区：纵向优先交给滚动，取消本次拖动会话
    if (dragFromList && absDy >= absDx) {
      cancelDragSession();
      return;
    }

    dragMoved = true;
    root.classList.add('acu-pp-progress-hud-root--dragging');
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  e.preventDefault();
  const rect = root.getBoundingClientRect();
  const size = { width: rect.width, height: rect.height };
  const clamped = clampHudRect(
    dragOrigLeft + dx,
    dragOrigTop + dy,
    size,
    readViewportSize(),
    getSafeAreaInsets(),
  );
  applyPlacedPx(root, clamped.left, clamped.top);
}

function onDragEnd(e: PointerEvent): void {
  if (dragPointerId !== e.pointerId) return;
  const root = getRootEl();
  const wasMoved = dragMoved;
  dragging = false;
  dragPointerId = null;
  dragFromList = false;
  if (root) {
    root.classList.remove('acu-pp-progress-hud-root--dragging');
    try {
      root.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  unbindDocumentDragListeners();

  if (wasMoved && root) {
    const rect = root.getBoundingClientRect();
    const ratio = pxToRatio(rect.left, rect.top, readViewportSize());
    persistHudPosition(ratio);
    lastTapAt = 0;
    dragMoved = false;
    return;
  }

  dragMoved = false;

  // 移动端双击合成：未拖动的两次轻点复位
  const now = Date.now();
  if (
    lastTapAt > 0 &&
    now - lastTapAt <= DOUBLE_TAP_MS &&
    Math.abs(e.clientX - lastTapX) <= DOUBLE_TAP_SLOP &&
    Math.abs(e.clientY - lastTapY) <= DOUBLE_TAP_SLOP
  ) {
    resetHudPosition();
    return;
  }
  lastTapAt = now;
  lastTapX = e.clientX;
  lastTapY = e.clientY;
}

function onHudPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  const target = e.target as Element | null;
  if (target?.closest?.('.acu-pp-progress-hud__stop')) return;
  const root = getRootEl();
  if (!root) return;
  dragging = true;
  dragMoved = false;
  dragFromList = !!target?.closest?.('.acu-pp-progress-hud__list');
  dragPointerId = e.pointerId;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const rect = root.getBoundingClientRect();
  dragOrigLeft = rect.left;
  dragOrigTop = rect.top;
  refreshSafeAreaCache();
  const doc = getHostDocument();
  doc.addEventListener('pointermove', onDragMove, { passive: false });
  doc.addEventListener('pointerup', onDragEnd);
  doc.addEventListener('pointercancel', onDragEnd);
}

function onHudDblClick(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (target?.closest?.('.acu-pp-progress-hud__stop')) return;
  e.preventDefault();
  resetHudPosition();
}

function bindHudDrag(): void {
  const root = getRootEl();
  if (!root || dragBound) return;
  dragBound = true;
  root.addEventListener('pointerdown', onHudPointerDown);
  root.addEventListener('dblclick', onHudDblClick);
}

function bindHudResize(): void {
  if (resizeBound) return;
  resizeBound = true;
  const onResize = () => {
    refreshSafeAreaCache();
    applySavedHudPosition();
  };
  const win = getHostWindow();
  win.addEventListener('resize', onResize);
  win.visualViewport?.addEventListener('resize', onResize);
  win.visualViewport?.addEventListener('scroll', onResize);
}

function getHudRoot(): JQuery {
  if ($hudRoot?.length) return $hudRoot;
  let $root = $(`#${HUD_ROOT_ID}`);
  if (!$root.length) {
    $root = $(`<div id="${HUD_ROOT_ID}" class="acu-pp-progress-hud-root"></div>`).appendTo('body');
  }
  $hudRoot = $root;
  bindHudDrag();
  bindHudResize();
  return $root;
}

function bindStopButton(): void {
  const $root = getHudRoot();
  $root
    .find('.acu-pp-progress-hud__stop')
    .off('click.acu_pp_stop pointerdown.acu_pp_stop')
    .on('pointerdown.acu_pp_stop', (e: JQuery.TriggeredEvent) => {
      e.stopPropagation();
    })
    .on('click.acu_pp_stop', (e: JQuery.ClickEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (runAborting) return;
      runAborting = true;
      const $btn = $(e.currentTarget);
      $btn.prop('disabled', true).text('停止中…');
      stopHandler?.();
      setTimeout(() => hideTaskProgressToast(), 300);
    });
}

function setHudHtml(html: string): void {
  const $root = getHudRoot();
  $root.html(html).attr('aria-hidden', 'false');
  bindStopButton();
  applySavedHudPosition();
}

export function showTaskProgressToast(message: string, onStop: () => void): void {
  hideTaskProgressToast();
  runAborting = false;
  ensureAcuToastStyles();
  stopHandler = onStop;
  displayState = resetProgressDisplayState();
  lastSnapshot = null;
  setHudHtml(renderMessageHtml(message));
}

export function updateTaskProgressToast(update: TaskProgressUpdate): void {
  if (runAborting || !getHudRoot().find('.acu-pp-progress-hud').length) return;
  if (typeof update === 'string') {
    lastSnapshot = null;
    setHudHtml(renderMessageHtml(update));
    return;
  }
  lastSnapshot = update;
  syncDisplayState(update);
  setHudHtml(renderSnapshotHtml(update));
}

export function hideTaskProgressToast(): void {
  clearRemovalTimers();
  displayState = resetProgressDisplayState();
  lastSnapshot = null;
  unbindDocumentDragListeners();
  dragging = false;
  dragPointerId = null;
  dragMoved = false;
  dragFromList = false;
  if ($hudRoot?.length) {
    $hudRoot.empty().attr('aria-hidden', 'true');
    $hudRoot[0]?.classList.remove('acu-pp-progress-hud-root--dragging');
  } else {
    $(`#${HUD_ROOT_ID}`).empty().attr('aria-hidden', 'true');
  }
  stopHandler = null;
}
