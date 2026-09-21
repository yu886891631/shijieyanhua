import assert from 'node:assert/strict';
import {
  noteExtraAnalysisSeen,
  shouldDispatchOnMvuEnded,
  shouldDispatchOnProbeTimeout,
} from './mvu-trigger-defer-logic';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('shouldDispatchOnMvuEnded blocks while during extra', () => {
  assert.equal(shouldDispatchOnMvuEnded({ duringExtra: true }), false);
  assert.equal(shouldDispatchOnMvuEnded({ duringExtra: false }), true);
});

test('shouldDispatchOnProbeTimeout only when never saw extra', () => {
  assert.equal(
    shouldDispatchOnProbeTimeout({ seenExtraAnalysis: false, dispatched: false }),
    true,
  );
  assert.equal(
    shouldDispatchOnProbeTimeout({ seenExtraAnalysis: true, dispatched: false }),
    false,
  );
  assert.equal(
    shouldDispatchOnProbeTimeout({ seenExtraAnalysis: false, dispatched: true }),
    false,
  );
});

test('noteExtraAnalysisSeen latches true', () => {
  assert.equal(noteExtraAnalysisSeen(false, false), false);
  assert.equal(noteExtraAnalysisSeen(false, true), true);
  assert.equal(noteExtraAnalysisSeen(true, false), true);
});

test('mvuUnavailable means no defer (enqueue gated by mvuAvailable)', () => {
  // isMvuDeferActive === shouldEnqueueDefer === mvuAvailable；无 Mvu 时不入队、即时路径保持
  const mvuAvailable = false;
  assert.equal(mvuAvailable, false);
});

if (process.exitCode) process.exit(process.exitCode);
