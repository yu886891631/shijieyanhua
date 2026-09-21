import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clampHudRect,
  pxToRatio,
  ratioToPx,
  resolvePlacedPx,
} from './task-progress-hud-position';

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 80 };
const safe = { top: 10, right: 5, bottom: 20, left: 8 };

test('clampHudRect keeps box inside padded safe area', () => {
  const out = clampHudRect(-100, -50, size, viewport, safe);
  assert.deepEqual(out, { left: 8 + 8, top: 8 + 10 });
});

test('clampHudRect clamps to bottom-right bound', () => {
  const out = clampHudRect(9999, 9999, size, viewport, safe);
  assert.equal(out.left, 1000 - 200 - 8 - 5);
  assert.equal(out.top, 800 - 80 - 8 - 20);
});

test('pxToRatio and ratioToPx round-trip within viewport', () => {
  const ratio = pxToRatio(250, 160, viewport);
  assert.deepEqual(ratio, { x: 0.25, y: 0.2 });
  assert.deepEqual(ratioToPx(ratio, viewport), { left: 250, top: 160 });
});

test('pxToRatio clamps to 0..1', () => {
  assert.deepEqual(pxToRatio(-10, 900, viewport), { x: 0, y: 1 });
});

test('resolvePlacedPx returns null for default (null ratio)', () => {
  assert.equal(resolvePlacedPx(null, size, viewport, safe), null);
  assert.equal(resolvePlacedPx(undefined, size, viewport, safe), null);
});

test('resolvePlacedPx converts ratio then clamps', () => {
  const placed = resolvePlacedPx({ x: 0.95, y: 0.95 }, size, viewport, safe);
  assert.ok(placed);
  assert.equal(placed.left, 1000 - 200 - 8 - 5);
  assert.equal(placed.top, 800 - 80 - 8 - 20);
});

console.log('task-progress-hud-position.test.ts: all passed');
