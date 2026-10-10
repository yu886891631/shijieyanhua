/** Self-contained candidate document; never reads the embedding host. */
import { createApp } from 'vue';
import T15CandidateWorkspace from './T15CandidateWorkspace.vue';
import { createT3BrowserWorkerFactory, createT3WorkerRunner } from './t3-runtime';
declare const __T15_WORKER_SOURCE__: string;
const runner = createT3WorkerRunner(createT3BrowserWorkerFactory(__T15_WORKER_SOURCE__));
const app = createApp(T15CandidateWorkspace, {
  execute: runner.run,
  onClose: () => {
    document.dispatchEvent(new Event('t15-close-request')); // Embedding entry hides, not destroys, the live session.
  },
});
app.mount('#world-evolution-t15-root');
window.addEventListener('pagehide', () => app.unmount(), { once: true });
