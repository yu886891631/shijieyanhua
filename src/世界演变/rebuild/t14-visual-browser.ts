/** Explicit harness only; served by t14-visual-server.mts, never scanned as index.ts. */
import { createApp } from 'vue';
import T14VisualHarness from './T14VisualHarness.vue';
const response = await fetch('/fixture.json', { credentials: 'omit' });
if (!response.ok) throw new Error('本地视觉夹具载入失败');
const views: unknown = await response.json();
createApp(T14VisualHarness, { initialViews: views }).mount('#visual-root');
