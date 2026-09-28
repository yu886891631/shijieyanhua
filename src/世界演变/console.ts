import { createApp } from 'vue';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import Workspace from './console/Workspace.vue';

let root: JQuery<HTMLDivElement> | null = null;
let app: ReturnType<typeof createApp> | null = null;
let styleDestroy: (() => void) | null = null;

function mountConsole(): void {
  if (root?.length) return;

  root = createScriptIdDiv().appendTo('body');
  const mountPoint = $('<div class="we-console-root"></div>').appendTo(root);
  app = createApp(Workspace, {
    onClose: () => root?.hide(),
  });
  app.mount(mountPoint[0]);
  styleDestroy = teleportStyle().destroy;

  $(window).one('pagehide.world-evolution-console', () => {
    app?.unmount();
    app = null;
    styleDestroy?.();
    styleDestroy = null;
    root?.remove();
    root = null;
  });
}

export function openWorldEvolutionConsole(): void {
  mountConsole();
  root?.show();
}
