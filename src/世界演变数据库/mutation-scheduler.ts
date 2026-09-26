import { rebuildDbAfterDeletingFloor } from './store';

export type WorldEvolutionMutationKind = 'message_deleted' | 'message_swiped';

export type WorldEvolutionMutationEvent = {
  chatKey: string;
  messageId: number;
  kind: WorldEvolutionMutationKind;
};

export type WorldEvolutionMutationSchedulerOptions = {
  debounceMs?: number;
  rebuild?: (chatKey: string, messageId: number) => Promise<unknown>;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

type PendingChat = {
  generation: number;
  messageIds: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * 将删除/滑动事件合并为确定性数据库重建。
 *
 * 设计要点：
 * - 同一聊天在 debounce 窗口内合并多个楼层；
 * - 同一聊天的 rebuild 串行执行；
 * - 新事件到达后增加 generation，旧批次完成后会继续处理新批次；
 * - rebuild 只回放已保存 operations，不调用 AI。
 */
export class WorldEvolutionMutationScheduler {
  private readonly pending = new Map<string, PendingChat>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly debounceMs: number;
  private readonly rebuild: (chatKey: string, messageId: number) => Promise<unknown>;
  private readonly setTimer: NonNullable<WorldEvolutionMutationSchedulerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<WorldEvolutionMutationSchedulerOptions['clearTimer']>;
  private stopped = false;

  public constructor(options: WorldEvolutionMutationSchedulerOptions = {}) {
    this.debounceMs = Math.max(0, Math.floor(options.debounceMs ?? 350));
    this.rebuild = options.rebuild ?? rebuildDbAfterDeletingFloor;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer));
  }

  public schedule(event: WorldEvolutionMutationEvent): void {
    if (this.stopped || !event.chatKey || !Number.isFinite(event.messageId)) return;
    const pending = this.pending.get(event.chatKey) ?? {
      generation: 0,
      messageIds: new Set<number>(),
      timer: null,
    };
    pending.generation += 1;
    pending.messageIds.add(event.messageId);
    if (pending.timer !== null) this.clearTimer(pending.timer);
    pending.timer = this.setTimer(() => {
      pending.timer = null;
      void this.flush(event.chatKey, pending.generation);
    }, this.debounceMs);
    this.pending.set(event.chatKey, pending);
  }

  public stop(): void {
    this.stopped = true;
    for (const pending of this.pending.values()) {
      if (pending.timer !== null) this.clearTimer(pending.timer);
      pending.timer = null;
    }
    this.pending.clear();
  }

  private async flush(chatKey: string, generation: number): Promise<void> {
    if (this.stopped) return;
    const pending = this.pending.get(chatKey);
    if (!pending || pending.generation !== generation || pending.messageIds.size === 0) return;
    const messageIds = [...pending.messageIds].sort((left, right) => left - right);
    pending.messageIds.clear();
    const previous = this.tails.get(chatKey) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        for (const messageId of messageIds) {
          if (this.stopped) return;
          await this.rebuild(chatKey, messageId);
        }
      });
    this.tails.set(chatKey, task);
    try {
      await task;
    } catch (error) {
      console.warn('[世界演变数据库] 楼层确定性重建失败:', error);
    } finally {
      if (this.tails.get(chatKey) === task) this.tails.delete(chatKey);
      const current = this.pending.get(chatKey);
      if (current && current.messageIds.size > 0 && current.timer === null) {
        current.timer = this.setTimer(() => {
          current.timer = null;
          void this.flush(chatKey, current.generation);
        }, this.debounceMs);
      }
      if (current && current.messageIds.size === 0 && current.timer === null) this.pending.delete(chatKey);
    }
  }
}
