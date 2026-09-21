<template>
  <div class="addon-console" :data-theme="theme">
    <header class="ac-header">
      <div class="ac-header-icon-wrap" aria-hidden="true">
        <span class="ac-header-icon-main">🌍</span>
        <span class="ac-header-icon-accent">✦</span>
      </div>
      <div class="ac-header-brand">
        <h1 class="ac-header-main-title">世界时局与经济简报</h1>
        <p class="ac-header-sub">
          <span class="ac-header-sub-en">Imperial Astronomical Archives · </span>星穹档案馆
        </p>
      </div>
      <div v-if="headerDate" class="ac-header-datetime">⏳ {{ headerDate }}</div>
      <div class="ac-tabs">
        <button type="button" class="ac-tab" :class="{ active: tab === 'brief' }" @click="tab = 'brief'">
          简报
        </button>
        <button type="button" class="ac-tab" :class="{ active: tab === 'control' }" @click="tab = 'control'">
          控制
        </button>
        <button type="button" class="ac-tab" :class="{ active: tab === 'changelog' }" @click="onOpenChangelog">
          变更
          <span v-if="patchErrorCount" class="ac-tab-badge">{{ patchErrorCount }}</span>
        </button>
      </div>
      <div class="ac-header-actions">
        <button
          type="button"
          class="ac-btn ac-theme-btn"
          :title="theme === 'dark' ? '切换浅色' : '切换深色'"
          @click="toggleTheme"
        >
          {{ theme === 'dark' ? '☀️' : '🌙' }}
        </button>
        <button type="button" class="ac-btn ghost" @click="closeHost">关闭</button>
      </div>
    </header>

    <div v-if="!loading && !error && worldNames.length" class="ac-world-bar">
      <button
        v-for="name in worldNames"
        :key="name"
        type="button"
        class="ac-chip"
        :class="{ active: name === selectedWorld }"
        @click="selectedWorld = name"
      >
        {{ name }}
        <template v-if="worlds[name]?.降临"> ·降临</template>
        <template v-else-if="worlds[name]?.平行演化"> ·平行</template>
      </button>
    </div>

    <nav
      v-if="!loading && !error && tab === 'brief' && selectedWorld"
      class="ac-brief-page-tabs"
      aria-label="简报子页"
    >
      <button
        v-for="item in briefPages"
        :key="item.id"
        type="button"
        class="ac-brief-page-tab"
        :class="{ active: briefPage === item.id }"
        @click="briefPage = item.id"
      >
        <span class="ac-brief-page-tab-icon" aria-hidden="true">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div v-if="loading" class="ac-hint">⏳ 连接 Addon API…</div>
    <div v-else-if="error" class="ac-hint ac-warn">{{ error }}</div>
    <div v-else class="ac-main">
      <div v-if="warnings.length" class="ac-warn" style="margin: 10px 14px 0">
        <div v-for="(w, i) in warnings" :key="i">{{ w }}</div>
      </div>

      <div v-show="tab === 'brief'" class="ac-main-scroll">
        <StatusBoard
          :world="selectedWorldData"
          :world-name="selectedWorld || ''"
          :brief-page="briefPage"
          :social-circles="socialCircles"
        />
      </div>

      <div v-show="tab === 'control'" class="ac-main-scroll">
        <div class="ac-control-grid">
          <div style="display: flex; flex-direction: column; gap: 12px">
            <PlaneMergeToggle :value="planeMerge" @update:value="onPlaneMerge" />
            <WorldControls
              :worlds="worlds"
              :selected="selectedWorld"
              @select="selectedWorld = $event"
              @set-descent="onWorldDescent"
              @set-parallel="onWorldParallel"
              @create="onCreateWorld"
              @rename="onRenameWorld"
              @delete="onDeleteWorld"
            />
          </div>
          <SingularityPanel :items="singularities" @toggle="onSingularity" />
        </div>
      </div>

      <div v-show="tab === 'changelog'" class="ac-main-scroll">
        <ChangeLogPanel
          :log="patchLog"
          :busy="changelogBusy"
          :action-error="changelogError"
          @clear="onClearPatchLog"
          @reprocess="onReprocessFloor"
          @apply-op="onApplyManualOp"
          @apply-error="changelogError = $event"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import './styles/tokens.scss';
import './styles/shell.scss';
import './styles/worldpaper.scss';
import { latestOpts, waitAddon, type AddonConsoleApi, type AddonPatchLogEntry } from './bridge';
import ChangeLogPanel from './components/ChangeLogPanel.vue';
import PlaneMergeToggle from './components/PlaneMergeToggle.vue';
import SingularityPanel from './components/SingularityPanel.vue';
import StatusBoard from './components/StatusBoard.vue';
import WorldControls from './components/WorldControls.vue';

/** 首屏前同步读取已保存主题，避免默认 light 再被 reload 改成 dark 造成闪烁 */
function readInitialTheme(): 'light' | 'dark' {
  try {
    const fromParent = _.get(window.parent, 'Addon') as { getUiState?: () => { theme?: string } } | undefined;
    const local = _.get(window, 'Addon') as { getUiState?: () => { theme?: string } } | undefined;
    const t = fromParent?.getUiState?.()?.theme ?? local?.getUiState?.()?.theme;
    return t === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const loading = ref(true);
const error = ref('');
const warnings = ref<string[]>([]);
const theme = ref<'light' | 'dark'>(readInitialTheme());
const planeMerge = ref(false);
const worlds = ref<Record<string, any>>({});
const socialCircles = ref<Record<string, any>>({});
const selectedWorld = ref<string | null>(null);
const tab = ref<'brief' | 'control' | 'changelog'>('brief');
const briefPage = ref<'era' | 'plot' | 'social' | 'econ'>('era');
const patchLog = ref<AddonPatchLogEntry | null>(null);
const changelogBusy = ref(false);
const changelogError = ref('');

const briefPages = [
  { id: 'era' as const, label: '时代快讯', icon: '🕰️' },
  { id: 'plot' as const, label: '世界剧情态势', icon: '⚔️' },
  { id: 'social' as const, label: '角色社交圈', icon: '🕸️' },
  { id: 'econ' as const, label: '世界经济简报', icon: '💰' },
];

type AddonConsoleWindow = Window & { __addonConsoleRefresh?: () => void };

let api: AddonConsoleApi | null = null;
const eventStops: Array<{ stop: () => void }> = [];
let refreshHook: (() => void) | null = null;

const worldNames = computed(() => Object.keys(worlds.value));

const patchErrorCount = computed(
  () => (patchLog.value?.issues ?? []).filter(i => i.kind === 'parse' || i.kind === 'apply').length,
);

const selectedWorldData = computed(() => {
  if (!selectedWorld.value) return null;
  return worlds.value[selectedWorld.value] ?? null;
});

const headerDate = computed(() => String(selectedWorldData.value?.刊报日期 ?? '').trim());

const singularities = computed(() => {
  const map = selectedWorldData.value?.时代快讯?.岁月史书?.特异点;
  if (!map || typeof map !== 'object') return [] as Array<{ name: string; 降临: boolean }>;
  return Object.entries(map).map(([name, item]) => ({
    name,
    降临: !!(item as any)?.降临,
  }));
});

function closeHost() {
  try {
    const host = _.get(window.parent, '__addonConsoleHost') as { close?: () => void } | undefined;
    host?.close?.();
  } catch {
    /* ignore */
  }
}

function applyResult(result: { data: Record<string, any>; warnings?: string[] }, preferWorld?: string) {
  worlds.value = result.data?.世界 ?? {};
  socialCircles.value = result.data?.社交圈 ?? {};
  warnings.value = result.warnings ?? [];
  const names = Object.keys(worlds.value);
  if (preferWorld && names.includes(preferWorld)) {
    selectedWorld.value = preferWorld;
  } else if (!selectedWorld.value || !names.includes(selectedWorld.value)) {
    selectedWorld.value = names[0] ?? null;
  }
}

async function reload() {
  if (!api) return;
  try {
    const { addon_data } = api.getAddonData(latestOpts());
    worlds.value = addon_data?.世界 ?? {};
    socialCircles.value = addon_data?.社交圈 ?? {};
    const ui = api.getUiState(latestOpts());
    theme.value = ui.theme === 'dark' ? 'dark' : 'light';
    planeMerge.value = ui.位面交汇 === true;
    const names = Object.keys(worlds.value);
    if (!selectedWorld.value || !names.includes(selectedWorld.value)) {
      selectedWorld.value = names[0] ?? null;
    }
    refreshPatchLog();
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function refreshPatchLog() {
  if (!api?.getLastPatchLog) {
    patchLog.value = null;
    return;
  }
  try {
    patchLog.value = api.getLastPatchLog() ?? null;
  } catch {
    patchLog.value = null;
  }
}

function onOpenChangelog() {
  tab.value = 'changelog';
  refreshPatchLog();
}

function onClearPatchLog() {
  api?.clearPatchLog?.();
  patchLog.value = null;
  changelogError.value = '';
}

async function onReprocessFloor() {
  if (!api?.processFloor) {
    changelogError.value = 'Addon.processFloor 不可用';
    return;
  }
  changelogBusy.value = true;
  changelogError.value = '';
  try {
    await api.processFloor('latest');
    await reload();
  } catch (e) {
    changelogError.value = e instanceof Error ? e.message : String(e);
  } finally {
    changelogBusy.value = false;
  }
}

async function onApplyManualOp(op: unknown, meta?: { fragmentIndex?: number }) {
  if (!api?.applyManualPatchOps) {
    changelogError.value = 'Addon.applyManualPatchOps 不可用';
    return;
  }
  changelogBusy.value = true;
  changelogError.value = '';
  try {
    await api.applyManualPatchOps([op], {
      ...latestOpts(),
      fragmentIndexes: meta?.fragmentIndex != null ? [meta.fragmentIndex] : undefined,
    });
    await reload();
  } catch (e) {
    changelogError.value = e instanceof Error ? e.message : String(e);
    refreshPatchLog();
  } finally {
    changelogBusy.value = false;
  }
}

async function toggleTheme() {
  if (!api) return;
  const next = theme.value === 'dark' ? 'light' : 'dark';
  api.setTheme(next, latestOpts());
  theme.value = next;
}

async function onPlaneMerge(value: boolean) {
  if (!api) return;
  api.setPlaneMerge(value, latestOpts());
  planeMerge.value = value;
}

async function onWorldDescent(world: string, value: boolean) {
  if (!api) return;
  applyResult(await api.setWorldDescent(world, value, latestOpts()), world);
}

async function onWorldParallel(world: string, value: boolean) {
  if (!api) return;
  applyResult(await api.setWorldParallel(world, value, latestOpts()), world);
}

async function onCreateWorld(name: string) {
  if (!api) return;
  applyResult(await api.createWorld(name, latestOpts()), name);
}

async function onRenameWorld(oldName: string, newName: string) {
  if (!api) return;
  applyResult(await api.renameWorld(oldName, newName, latestOpts()), newName);
}

async function onDeleteWorld(name: string) {
  if (!api) return;
  applyResult(await api.deleteWorld(name, latestOpts()));
}

async function onSingularity(name: string, value: boolean) {
  if (!api || !selectedWorld.value) return;
  applyResult(await api.setSingularityDescent(selectedWorld.value, name, value, latestOpts()), selectedWorld.value);
}

/** VARIABLE_UPDATE_ENDED 早于 writeAddonData，延后到同步链结束后再读 */
function scheduleReload() {
  queueMicrotask(() => {
    void reload();
  });
}

function bindAutoReload() {
  if (!api?.events?.VARIABLE_UPDATE_ENDED) return;
  eventStops.push(
    eventOn(api.events.VARIABLE_UPDATE_ENDED, () => {
      scheduleReload();
    }),
  );
  if (api.events.PATCH_LOG_UPDATED) {
    eventStops.push(
      eventOn(api.events.PATCH_LOG_UPDATED, () => {
        refreshPatchLog();
      }),
    );
  }
  eventStops.push(
    eventOn(tavern_events.CHAT_CHANGED, () => {
      void reload();
    }),
  );
}

onMounted(async () => {
  try {
    api = await waitAddon();
    bindAutoReload();
    refreshHook = () => {
      void reload();
    };
    (window as AddonConsoleWindow).__addonConsoleRefresh = refreshHook;
    await reload();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  for (const h of eventStops) {
    try {
      h.stop();
    } catch {
      /* ignore */
    }
  }
  eventStops.length = 0;
  const w = window as AddonConsoleWindow;
  if (refreshHook && w.__addonConsoleRefresh === refreshHook) {
    delete w.__addonConsoleRefresh;
  }
  refreshHook = null;
});
</script>
