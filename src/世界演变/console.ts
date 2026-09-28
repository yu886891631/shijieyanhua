import { createScriptIdDiv, teleportStyle } from '@util/script';
import { mountWorldEvolutionPanel } from './ui';
import { WORLD_EVOLUTION_VERSION } from './types';
import { mountWorldEvolutionDbPanel } from '../世界演变数据库/ui';
import { WORLD_EVOLUTION_DB_VERSION } from '../世界演变数据库/types';

let root: JQuery<HTMLDivElement> | null = null;
let style: JQuery<HTMLElement> | null = null;
let styleDestroy: (() => void) | null = null;

const css = `
.we-console{position:fixed;right:12px;bottom:12px;z-index:10100;display:flex;flex-direction:column;width:min(980px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:hidden;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;box-shadow:0 12px 36px #0009;font:13px/1.45 system-ui,sans-serif}
.we-console *{box-sizing:border-box}.we-console-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid #374151}.we-console-heading{font-weight:700}.we-console-version{display:block;color:#9ca3af;font-size:11px}.we-console-close,.we-console-tab{border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;border-radius:7px;padding:6px 10px;cursor:pointer}.we-console-close:hover,.we-console-tab:hover{background:#374151}.we-console-tabs{display:flex;gap:6px;padding:9px 12px 0;border-bottom:1px solid #374151}.we-console-tab{border-bottom-left-radius:0;border-bottom-right-radius:0}.we-console-tab.active{background:#0e7490;border-color:#22d3ee;color:#ecfeff}.we-console-content{min-height:0;overflow:auto;padding:12px}.we-console-pane[hidden]{display:none!important}
@media(max-width:600px){.we-console{right:6px;bottom:6px;width:calc(100vw - 12px);max-height:calc(100vh - 12px)}.we-console-content{padding:8px}}
`;

function mountConsole(): void {
  if (root?.length) return;

  root = createScriptIdDiv().appendTo('body');
  root.html(`
    <div class="we-console" role="dialog" aria-label="世界演变控制台">
      <header class="we-console-head">
        <div>
          <div class="we-console-heading">世界演变控制台</div>
          <span class="we-console-version">演变 ${WORLD_EVOLUTION_VERSION} · 数据库 ${WORLD_EVOLUTION_DB_VERSION}</span>
        </div>
        <button class="we-console-close" type="button" data-we-console-close>收起</button>
      </header>
      <nav class="we-console-tabs" role="tablist" aria-label="世界演变模块">
        <button class="we-console-tab active" type="button" role="tab" aria-selected="true" data-we-console-tab="evolution">自动演变</button>
        <button class="we-console-tab" type="button" role="tab" aria-selected="false" data-we-console-tab="database">数据库</button>
      </nav>
      <main class="we-console-content">
        <section class="we-console-pane" role="tabpanel" data-we-console-pane="evolution"></section>
        <section class="we-console-pane" role="tabpanel" data-we-console-pane="database" hidden></section>
      </main>
    </div>
  `);

  styleDestroy = teleportStyle().destroy;
  style = $('<style data-world-evolution-console-style>').text(css).appendTo('head');

  root.on('click.world-evolution-console', '[data-we-console-tab]', event => {
    const button = $(event.currentTarget);
    const selectedTab = button.attr('data-we-console-tab');
    if (selectedTab !== 'evolution' && selectedTab !== 'database') return;

    root?.find('[data-we-console-tab]').removeClass('active').attr('aria-selected', 'false');
    button.addClass('active').attr('aria-selected', 'true');
    root?.find('[data-we-console-pane]').prop('hidden', true);
    root?.find(`[data-we-console-pane="${selectedTab}"]`).prop('hidden', false);
  });
  root.on('click.world-evolution-console', '[data-we-console-close]', () => root?.hide());

  const evolutionTarget = root.find('[data-we-console-pane="evolution"]')[0];
  const databaseTarget = root.find('[data-we-console-pane="database"]')[0];
  if (evolutionTarget) mountWorldEvolutionPanel(evolutionTarget);
  if (databaseTarget) mountWorldEvolutionDbPanel(databaseTarget);

  $(window).one('pagehide.world-evolution-console', () => {
    root?.off('.world-evolution-console');
    root?.remove();
    root = null;
    style?.remove();
    style = null;
    styleDestroy?.();
    styleDestroy = null;
  });
}

export function openWorldEvolutionConsole(): void {
  mountConsole();
  root?.show();
}
