/** The entry supplies only the required TavernHelper APIs; fixed local source, no remote imports. */
import { createApp } from 'vue';
import T15ImportWorkspace from './T15ImportWorkspace.vue';
import { createT3BrowserWorkerFactory, createT3WorkerRunner } from './t3-runtime';
declare const __T15_HOST_WORKER_SOURCE__: string;
const runner = createT3WorkerRunner(createT3BrowserWorkerFactory(__T15_HOST_WORKER_SOURCE__));
const app = createApp(T15ImportWorkspace, {
  execute: runner.run,
  onClose: () => document.dispatchEvent(new Event('we-host-close')),
});
app.mount('#world-evolution-host-root');
let disposed = false;
const dispose = () => {
  if (disposed) return;
  disposed = true;
  app.unmount();
  window.removeEventListener('pagehide', dispose);
};
Object.defineProperty(window, '__WE_HOST_DISPOSE__', { value: dispose, configurable: true });
window.addEventListener('pagehide', dispose, { once: true });
