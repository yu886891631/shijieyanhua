/** MVU 延后派发决策（纯函数，便于单测） */

export function shouldDispatchOnMvuEnded(input: { duringExtra: boolean }): boolean {
  return !input.duringExtra;
}

export function shouldDispatchOnProbeTimeout(input: {
  seenExtraAnalysis: boolean;
  dispatched: boolean;
}): boolean {
  return !input.dispatched && !input.seenExtraAnalysis;
}

export function noteExtraAnalysisSeen(seen: boolean, duringNow: boolean): boolean {
  return seen || duringNow;
}
