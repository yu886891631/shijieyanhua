export type ProgressHudPositionRatio = { x: number; y: number };

export type ViewportSize = { width: number; height: number };

export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type HudSize = { width: number; height: number };

const PAD = 8;

export function clampHudRect(
  left: number,
  top: number,
  size: HudSize,
  viewport: ViewportSize,
  safe: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 },
): { left: number; top: number } {
  const minLeft = PAD + safe.left;
  const minTop = PAD + safe.top;
  const maxLeft = Math.max(minLeft, viewport.width - size.width - PAD - safe.right);
  const maxTop = Math.max(minTop, viewport.height - size.height - PAD - safe.bottom);
  return {
    left: Math.min(Math.max(minLeft, left), maxLeft),
    top: Math.min(Math.max(minTop, top), maxTop),
  };
}

export function pxToRatio(
  left: number,
  top: number,
  viewport: ViewportSize,
): ProgressHudPositionRatio {
  const w = Math.max(1, viewport.width);
  const h = Math.max(1, viewport.height);
  return {
    x: Math.min(1, Math.max(0, left / w)),
    y: Math.min(1, Math.max(0, top / h)),
  };
}

export function ratioToPx(
  ratio: ProgressHudPositionRatio,
  viewport: ViewportSize,
): { left: number; top: number } {
  return {
    left: ratio.x * viewport.width,
    top: ratio.y * viewport.height,
  };
}

/** 从比例得到钳位后的像素位置；ratio 为 null 时表示使用默认 CSS 定位 */
export function resolvePlacedPx(
  ratio: ProgressHudPositionRatio | null | undefined,
  size: HudSize,
  viewport: ViewportSize,
  safe?: SafeAreaInsets,
): { left: number; top: number } | null {
  if (!ratio) return null;
  const raw = ratioToPx(ratio, viewport);
  return clampHudRect(raw.left, raw.top, size, viewport, safe);
}
