/** Explicit embedding only. Does not replace an existing console, create a menu, or initialize a host. */
import { createApp } from 'vue';
import T15HostWorkspace from './T15HostWorkspace.vue';
import type { T15HostWorkspace as HostSession } from './t15-host-workspace';
export function mountT15HostWorkspace(options: { target: HTMLElement; session: HostSession; version: string }) {
  const { target, session, version } = options;
  if (target.childElementCount || target.dataset.worldEvolutionSession) throw new Error('目标面板已有内容，未覆盖');
  const root = target.ownerDocument.createElement('div');
  target.dataset.worldEvolutionSession = 't15-compatible';
  target.append(root);
  // The embedding script chooses an isolated panel/iframe and owns its CSS, same as the existing console.
  const app = createApp(T15HostWorkspace, {
    session,
    version,
    onClose: () => {
      target.hidden = true;
    },
  });
  let disposed = false;
  try {
    app.mount(root);
  } catch (error) {
    root.remove();
    delete target.dataset.worldEvolutionSession;
    session.close();
    throw error;
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    app.unmount();
    root.remove();
    delete target.dataset.worldEvolutionSession;
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return {
    show() {
      if (disposed) throw new Error('工作台已卸载');
      target.hidden = false;
    },
    dispose,
  };
}
