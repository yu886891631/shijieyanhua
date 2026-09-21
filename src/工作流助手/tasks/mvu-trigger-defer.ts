import { isProcessing } from './runtime';
import { shouldSuppressAutoTriggerAfterAbort } from './trigger-guard';
import {
  noteExtraAnalysisSeen,
  shouldDispatchOnMvuEnded,
  shouldDispatchOnProbeTimeout,
} from './mvu-trigger-defer-logic';

type MessageHandler = (
  messageId: number,
  type: string,
  options?: { bypassSchedule?: boolean; force?: boolean },
) => Promise<void>;

type DeferDispatchVia = 'ended' | 'probe_timeout' | 'extra_timeout';

interface PendingItem {
  messageId: number;
  type: string;
  dispatched: boolean;
  seenExtraAnalysis: boolean;
  via?: DeferDispatchVia;
  probeTimer?: ReturnType<typeof setInterval>;
  probeDeadlineTimer?: ReturnType<typeof setTimeout>;
  extraTimeoutTimer?: ReturnType<typeof setTimeout>;
  endedRecheckTimer?: ReturnType<typeof setTimeout>;
}

/** 探测是否进入额外模型解析的窗口 */
export const EXTRA_ANALYSIS_PROBE_MS = 800;
const EXTRA_ANALYSIS_PROBE_TICK_MS = 50;
/** 已进入额外解析后，等待 VARIABLE_UPDATE_ENDED 的上限 */
export const EXTRA_ANALYSIS_WAIT_MS = 120_000;
const ENDED_RECHECK_MS = 50;

let mvuAvailable = false;
let offMvuEnded: EventOnReturn | null = null;
const pendingQueue: PendingItem[] = [];

function isMvuExtraAnalysisActiveSafe(): boolean {
  try {
    return typeof Mvu !== 'undefined' && Mvu.isDuringExtraAnalysis?.() === true;
  } catch {
    return false;
  }
}

function clearItemTimers(item: PendingItem): void {
  if (item.probeTimer != null) {
    clearInterval(item.probeTimer);
    item.probeTimer = undefined;
  }
  if (item.probeDeadlineTimer != null) {
    clearTimeout(item.probeDeadlineTimer);
    item.probeDeadlineTimer = undefined;
  }
  if (item.extraTimeoutTimer != null) {
    clearTimeout(item.extraTimeoutTimer);
    item.extraTimeoutTimer = undefined;
  }
  if (item.endedRecheckTimer != null) {
    clearTimeout(item.endedRecheckTimer);
    item.endedRecheckTimer = undefined;
  }
}

function pruneDispatchedHead(): void {
  while (pendingQueue.length > 0 && pendingQueue[0].dispatched) {
    clearItemTimers(pendingQueue[0]);
    pendingQueue.shift();
  }
}

function tryDispatchHead(handler: MessageHandler, via: DeferDispatchVia): void {
  pruneDispatchedHead();
  const head = pendingQueue[0];
  if (!head || head.dispatched) return;
  if (shouldSuppressAutoTriggerAfterAbort()) {
    clearItemTimers(head);
    pendingQueue.shift();
    return;
  }
  if (isProcessing(head.messageId)) return;
  clearItemTimers(head);
  head.dispatched = true;
  head.via = via;
  void handler(head.messageId, head.type);
  pruneDispatchedHead();
}

function shouldEnqueueDefer(): boolean {
  return mvuAvailable;
}

function armExtraWaitTimeout(item: PendingItem, handler: MessageHandler): void {
  if (item.extraTimeoutTimer != null || item.dispatched) return;
  item.extraTimeoutTimer = setTimeout(() => {
    item.extraTimeoutTimer = undefined;
    if (item.dispatched) return;
    console.warn(
      '[工作流助手] 等待 MVU 额外模型解析结束超时，将按当前状态触发工作流',
    );
    tryDispatchHead(handler, 'extra_timeout');
  }, EXTRA_ANALYSIS_WAIT_MS);
}

function markSeenExtraAndWait(item: PendingItem, handler: MessageHandler): void {
  const next = noteExtraAnalysisSeen(item.seenExtraAnalysis, true);
  if (!item.seenExtraAnalysis && next) {
    item.seenExtraAnalysis = true;
    if (item.probeTimer != null) {
      clearInterval(item.probeTimer);
      item.probeTimer = undefined;
    }
    if (item.probeDeadlineTimer != null) {
      clearTimeout(item.probeDeadlineTimer);
      item.probeDeadlineTimer = undefined;
    }
    armExtraWaitTimeout(item, handler);
  }
}

function startProbe(item: PendingItem, handler: MessageHandler): void {
  const tick = () => {
    if (item.dispatched) return;
    if (isMvuExtraAnalysisActiveSafe()) {
      markSeenExtraAndWait(item, handler);
    }
  };
  tick();
  item.probeTimer = setInterval(tick, EXTRA_ANALYSIS_PROBE_TICK_MS);
  item.probeDeadlineTimer = setTimeout(() => {
    item.probeDeadlineTimer = undefined;
    if (item.probeTimer != null) {
      clearInterval(item.probeTimer);
      item.probeTimer = undefined;
    }
    if (
      !shouldDispatchOnProbeTimeout({
        seenExtraAnalysis: item.seenExtraAnalysis,
        dispatched: item.dispatched,
      })
    ) {
      return;
    }
    tryDispatchHead(handler, 'probe_timeout');
  }, EXTRA_ANALYSIS_PROBE_MS);
}

function enqueuePending(messageId: number, type: string, handler: MessageHandler): void {
  const item: PendingItem = {
    messageId,
    type,
    dispatched: false,
    seenExtraAnalysis: false,
  };
  pendingQueue.push(item);
  startProbe(item, handler);
}

function onMvuVariableUpdateEnded(handler: MessageHandler): void {
  const during = isMvuExtraAnalysisActiveSafe();
  if (!shouldDispatchOnMvuEnded({ duringExtra: during })) return;

  const head = pendingQueue[0];
  if (!head || head.dispatched) return;

  // 短延迟再确认一次，避免 ENDED 与 unset during 的竞态
  if (head.endedRecheckTimer != null) clearTimeout(head.endedRecheckTimer);
  head.endedRecheckTimer = setTimeout(() => {
    head.endedRecheckTimer = undefined;
    if (!shouldDispatchOnMvuEnded({ duringExtra: isMvuExtraAnalysisActiveSafe() })) return;
    tryDispatchHead(handler, 'ended');
  }, ENDED_RECHECK_MS);
}

async function waitForMvuReady(): Promise<boolean> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (typeof Mvu !== 'undefined') return true;
    try {
      await Promise.race([
        waitGlobalInitialized('Mvu'),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('MVU wait retry')), 2_000);
        }),
      ]);
      if (typeof Mvu !== 'undefined') return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return typeof Mvu !== 'undefined';
}

async function initMvuEndedListener(handler: MessageHandler): Promise<void> {
  const ready = await waitForMvuReady();
  if (!ready) {
    mvuAvailable = false;
    console.warn(
      '[工作流助手] MVU 变量框架未就绪，无法延后至变量更新后执行，将按 MESSAGE_RECEIVED 立即触发',
    );
    return;
  }
  mvuAvailable = true;
  offMvuEnded = eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => {
    onMvuVariableUpdateEnded(handler);
  });
}

/**
 * 注册 MVU 延后触发：有 Mvu 时入队，探测额外解析，再由 VARIABLE_UPDATE_ENDED / 探测超时派发。
 * 与 registerTrigger 中的即时路径配合使用。
 */
export function registerMvuDeferredTrigger(handler: MessageHandler): EventOnReturn {
  void initMvuEndedListener(handler);

  const offEnqueue = eventOn(tavern_events.MESSAGE_RECEIVED, (messageId, type) => {
    if (!shouldEnqueueDefer()) return;
    enqueuePending(messageId, type, handler);
  });

  return {
    stop: () => {
      offEnqueue.stop();
      offMvuEnded?.stop();
      offMvuEnded = null;
      for (const item of pendingQueue) clearItemTimers(item);
      pendingQueue.length = 0;
      mvuAvailable = false;
    },
  };
}

/** 当前是否应由延后模块接管 MESSAGE_RECEIVED（即时路径应跳过） */
export function isMvuDeferActive(): boolean {
  return shouldEnqueueDefer();
}
