/** GENERATION_STOPPED 后短时间内忽略自动触发，防止中止生成误触发 */
let lastGenerationStoppedAt = 0;
let chatGenerationAborted = false;
const GENERATION_ABORT_SUPPRESS_MS = 8000;

export function shouldSuppressAutoTriggerAfterAbort(): boolean {
  if (chatGenerationAborted) return true;
  return Date.now() - lastGenerationStoppedAt < GENERATION_ABORT_SUPPRESS_MS;
}

export function markChatGenerationStarted(): void {
  chatGenerationAborted = false;
}

export function markChatGenerationAborted(): void {
  chatGenerationAborted = true;
  lastGenerationStoppedAt = Date.now();
}
