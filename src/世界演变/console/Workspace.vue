<template>
  <div class="we-backdrop" @mousedown.self="close">
    <div
      class="we-workspace"
      :data-theme="theme"
      :data-scale="scale"
      :style="{ '--we-scale': String(scale / 100) }"
      role="dialog"
      aria-modal="true"
      aria-label="世界演变工作台"
    >
      <aside class="we-sidebar" aria-label="世界演变工作台导航">
        <div class="we-brand" aria-label="世界演变">
          <div class="we-brand-mark">世</div>
          <div class="we-brand-copy">
            <strong>世界演变</strong>
            <span>WORLD EVOLUTION</span>
          </div>
        </div>

        <div
          class="we-chat-chip"
          :class="{ idle: !chatKey }"
          :title="chatKey ? `当前聊天：${chatKey}` : '当前聊天未就绪'"
          role="status"
          aria-live="polite"
        >
          <span class="we-live-dot" aria-hidden="true" />
          <span class="we-chat-caption">当前聊天</span>
          <span class="we-chat-name">{{ chatKey || '未就绪' }}</span>
        </div>

        <nav class="we-navigation" aria-label="工作台页面">
          <div v-for="group in navigation" :key="group.label" class="we-nav-group">
            <div :id="`we-nav-group-${group.label}`" class="we-nav-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              class="we-nav-item"
              :class="{ active: page === item.id }"
              :aria-current="page === item.id ? 'page' : undefined"
              :aria-label="item.label"
              @click="selectPage(item.id)"
            >
              <span class="we-nav-icon" aria-hidden="true">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
              <span v-if="item.id === 'history' && failedRuns" class="we-nav-badge">{{ failedRuns }}</span>
            </button>
          </div>
        </nav>

        <div class="we-sidebar-foot">
          <div class="we-foot-status" role="status" aria-live="polite">
            <span
              class="we-status-dot"
              :class="{ failed: latestRun?.status === 'failed', idle: !latestRun }"
              :title="latestRun ? runStatusLabel(latestRun.status) : '尚无运行记录'"
            />
            <span>{{ latestRun ? runStatusLabel(latestRun.status) : '尚无运行记录' }}</span>
          </div>
          <button class="we-sidebar-settings" type="button" @click="selectPage('appearance')">
            <span aria-hidden="true">⚙</span>
            外观与显示
          </button>
          <div class="we-version" aria-label="版本信息">
            <span title="世界演变插件版本">演变 {{ evolutionVersion }}</span>
            <span title="数据库格式版本">数据库格式 {{ databaseVersion }}</span>
          </div>
        </div>
      </aside>

      <main class="we-main">
        <header class="we-topbar" aria-labelledby="we-page-title">
          <div class="we-topbar-title">
            <div class="we-breadcrumb">世界演变工作台 <span>/</span> {{ pageMeta.label }}</div>
            <h1 id="we-page-title">{{ pageMeta.title }}</h1>
          </div>
          <div class="we-topbar-actions">
            <span v-if="page !== 'appearance'" class="we-revision-chip" title="当前聊天数据库的 revision 版本">
              数据版本 <strong>r{{ snapshot?.meta.revision ?? 0 }}</strong>
            </span>
            <button class="we-close" type="button" aria-label="关闭工作台" title="关闭" @click="close">×</button>
          </div>
        </header>

        <div class="we-page-scroll">
          <section v-if="page === 'overview'" class="we-page we-overview">
            <div class="we-welcome">
              <div>
                <p class="we-eyebrow">WORLD STATE · DATABASE FIRST</p>
                <h2>世界在主角视线之外，继续向前。</h2>
                <p>
                  在这里管理后台世界资料、楼层演变、世界书投影与提示词草稿。数据库是事实源，角色卡世界书是可重建的投影。
                </p>
              </div>
              <button class="we-primary-action" type="button" @click="selectPage('data')">
                <span aria-hidden="true">▦</span>
                打开世界资料
              </button>
            </div>

            <section class="we-console-card we-console-readiness-card" aria-labelledby="we-readiness-title">
              <div class="we-section-heading we-console-readiness-heading">
                <div>
                  <span class="we-eyebrow">RUNTIME READINESS</span>
                  <h3 id="we-readiness-title">运行准备</h3>
                </div>
                <span class="we-readiness-note">只读状态 · {{ overviewStateLabel }}</span>
              </div>
              <div class="we-readiness-grid">
                <button
                  class="we-readiness-item"
                  :class="{ ready: apiReadiness.ready, warning: !apiReadiness.ready }"
                  type="button"
                  @click="selectPage('api')"
                >
                  <span class="we-readiness-icon" aria-hidden="true">⌘</span>
                  <span class="we-readiness-main">
                    <strong>API 路由</strong>
                    <small>{{ apiReadinessLabel }}</small>
                    <span>{{ apiReadinessDetail }}</span>
                  </span>
                  <span class="we-readiness-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  class="we-readiness-item"
                  :class="{ ready: evolutionOverview.enabled, warning: !evolutionOverview.enabled }"
                  type="button"
                  @click="selectPage('evolution')"
                >
                  <span class="we-readiness-icon" aria-hidden="true">↻</span>
                  <span class="we-readiness-main">
                    <strong>自动演变</strong>
                    <small>{{ evolutionReadinessLabel }}</small>
                    <span>{{ evolutionReadinessDetail }}</span>
                  </span>
                  <span class="we-readiness-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  class="we-readiness-item"
                  :class="{ ready: projectionStatus === 'synced', warning: projectionStatus !== 'synced' }"
                  type="button"
                  @click="selectPage('worldbook')"
                >
                  <span class="we-readiness-icon" aria-hidden="true">▤</span>
                  <span class="we-readiness-main">
                    <strong>世界书投影</strong>
                    <small>{{ projectionStatusLabel }}</small>
                    <span>{{ projectionReadinessDetail }}</span>
                  </span>
                  <span class="we-readiness-arrow" aria-hidden="true">→</span>
                </button>
              </div>
            </section>

            <div v-if="overviewState === 'error'" class="we-overview-alert" role="alert">
              <span>无法读取当前聊天数据库：{{ overviewError }}</span>
              <button class="we-empty-action" type="button" @click="refreshOverview">重新读取</button>
            </div>

            <div class="we-stat-grid">
              <button class="we-stat-card" type="button" aria-label="查看 NPC 记录" @click="selectPage('data')">
                <span class="we-stat-icon">♙</span>
                <span class="we-stat-label">NPC</span>
                <strong>{{ displayOverviewCount(snapshot?.rows.npc.length) }}</strong>
                <span class="we-stat-foot">查看人物记录 <span>→</span></span>
              </button>
              <button class="we-stat-card" type="button" aria-label="查看组织与地点记录" @click="selectPage('data')">
                <span class="we-stat-icon">⌘</span>
                <span class="we-stat-label">组织与地点</span>
                <strong>{{ displayOverviewCount(organizationAndLocationCount) }}</strong>
                <span class="we-stat-foot">查看世界结构 <span>→</span></span>
              </button>
              <button class="we-stat-card" type="button" aria-label="查看楼层运行记录" @click="selectPage('history')">
                <span class="we-stat-icon">◷</span>
                <span class="we-stat-label">楼层处理</span>
                <strong>{{ displayOverviewCount(snapshot?.floorRuns.length) }}</strong>
                <span class="we-stat-foot">查看楼层运行记录 <span>→</span></span>
              </button>
              <button
                class="we-stat-card"
                type="button"
                aria-label="查看世界书投影记录"
                @click="selectPage('worldbook')"
              >
                <span class="we-stat-icon">▤</span>
                <span class="we-stat-label">世界书投影</span>
                <strong>{{ displayOverviewCount(projectionCount) }}</strong>
                <span class="we-stat-foot">托管条目 · {{ projectionStatusLabel }} <span>→</span></span>
              </button>
            </div>

            <div class="we-overview-columns">
              <section class="we-console-card we-recent-card">
                <div class="we-section-heading">
                  <div>
                    <span class="we-eyebrow">RECENT ACTIVITY</span>
                    <h3>最近楼层</h3>
                  </div>
                  <button class="we-link-button" type="button" @click="selectPage('history')">全部记录 →</button>
                </div>
                <div v-if="recentRuns.length" class="we-run-list">
                  <div v-for="run in recentRuns" :key="run.key" class="we-run-row">
                    <span class="we-run-mark" :class="`status-${run.status}`" />
                    <div class="we-run-main">
                      <strong>第 {{ run.messageId }} 楼</strong>
                      <span>{{ run.candidateNames.length ? run.candidateNames.join('、') : '未识别候选对象' }}</span>
                    </div>
                    <span class="we-run-status">{{ runStatusLabel(run.status) }}</span>
                  </div>
                </div>
                <div v-else class="we-empty-state">
                  <span>◌</span>
                  <strong>这里还没有楼层记录</strong>
                  <small>完成一轮剧情和前置工作流后，楼层状态会显示在这里。</small>
                  <button class="we-empty-action" type="button" @click="selectPage('evolution')">查看演变设置</button>
                </div>
              </section>

              <section class="we-console-card we-shortcuts-card">
                <div class="we-section-heading">
                  <div>
                    <span class="we-eyebrow">QUICK ACCESS</span>
                    <h3>常用入口</h3>
                  </div>
                </div>
                <button class="we-shortcut" type="button" @click="selectPage('evolution')">
                  <span class="we-shortcut-icon green">↻</span>
                  <span><strong>演变运行</strong><small>自动触发、手动演算与数量限制</small></span>
                  <span class="we-shortcut-arrow">→</span>
                </button>
                <button class="we-shortcut" type="button" @click="selectPage('prompts')">
                  <span class="we-shortcut-icon purple">✎</span>
                  <span><strong>填表提示词</strong><small>编辑多消息提示词草稿</small></span>
                  <span class="we-shortcut-arrow">→</span>
                </button>
                <button class="we-shortcut" type="button" @click="selectPage('backup')">
                  <span class="we-shortcut-icon amber">⇅</span>
                  <span><strong>备份与迁移</strong><small>导入、导出或迁移旧版数据</small></span>
                  <span class="we-shortcut-arrow">→</span>
                </button>
              </section>
            </div>
          </section>

          <section v-show="isDatabasePage" ref="databaseHost" class="we-page we-database-page" />
          <section v-show="page === 'api'" class="we-page we-api-settings-page">
            <ApiSettingsPanel />
          </section>
          <section v-show="page === 'evolution'" class="we-page we-evolution-page">
            <div ref="evolutionHost" class="we-evolution-runtime" />
          </section>
          <section v-show="page === 'prompts'" class="we-page">
            <PromptWorkbench />
          </section>

          <section v-if="page === 'appearance'" class="we-page we-appearance-page">
            <div class="we-page-intro">
              <div>
                <p class="we-eyebrow">PERSONALIZE YOUR WORKSPACE</p>
                <h2>外观与显示</h2>
                <p>主题和界面缩放只影响这个控制台，不会改动世界数据或酒馆预设。</p>
              </div>
            </div>
            <section class="we-console-card we-appearance-card">
              <div class="we-appearance-heading">
                <div>
                  <h3>主题</h3>
                  <p>选一个更适合长时间查看表格的配色。</p>
                </div>
                <span class="we-appearance-current">{{ themeLabels[theme] }}</span>
              </div>
              <div class="we-theme-grid">
                <button
                  v-for="item in themeOptions"
                  :key="item.id"
                  type="button"
                  class="we-theme-option"
                  :class="[`theme-${item.id}`, { active: theme === item.id }]"
                  :aria-pressed="theme === item.id"
                  @click="theme = item.id"
                >
                  <span class="we-theme-preview"><i /><i /><i /></span>
                  <span class="we-theme-name">{{ item.label }}</span>
                  <span v-if="theme === item.id" class="we-theme-check">✓</span>
                </button>
              </div>
            </section>
            <section class="we-console-card we-appearance-card">
              <div class="we-appearance-heading">
                <div>
                  <h3>界面缩放</h3>
                  <p>按你的屏幕和阅读习惯调整工作台密度。</p>
                </div>
                <span class="we-appearance-current">{{ scale }}%</span>
              </div>
              <div class="we-scale-options">
                <button
                  v-for="value in scaleOptions"
                  :key="value"
                  type="button"
                  :class="{ active: scale === value }"
                  :aria-pressed="scale === value"
                  @click="scale = value"
                >
                  {{ value }}%
                </button>
              </div>
            </section>
            <div class="we-appearance-note">
              <strong>显示说明</strong>
              <span>设置保存在本机浏览器；更换聊天不会重置主题和缩放。</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getCurrentChatKey } from '../../工作流助手/api/chat-key';
import { mountWorldEvolutionPanel, refreshWorldEvolutionPanelApiStatus } from '../ui';
import { loadSettings } from '../store';
import { loadWorldEvolutionApiConfiguration } from '../api-config';
import { getWorldEvolutionApiRouteCardSummary, getWorldEvolutionWorkflowAssistantBridge } from '../api-routing';
import { WORLD_EVOLUTION_VERSION } from '../types';
import {
  mountWorldEvolutionDbPanel,
  type WorldEvolutionDbPanelController,
  type WorldEvolutionDbPanelPage,
} from '../../世界演变数据库/ui';
import { loadDbSnapshot } from '../../世界演变数据库/store';
import {
  WORLD_EVOLUTION_DB_TABLE_LABELS,
  WORLD_EVOLUTION_DB_VERSION,
  type WorldEvolutionDbFloorRun,
  type WorldEvolutionDbSnapshot,
} from '../../世界演变数据库/types';
import PromptWorkbench from './PromptWorkbench.vue';
import ApiSettingsPanel from './ApiSettingsPanel.vue';

const props = defineProps<{ onClose: () => void }>();
const evolutionVersion = WORLD_EVOLUTION_VERSION;
const databaseVersion = WORLD_EVOLUTION_DB_VERSION;

type WorkspacePage =
  | 'overview'
  | 'data'
  | 'history'
  | 'worldbook'
  | 'backup'
  | 'api'
  | 'evolution'
  | 'prompts'
  | 'appearance';
type ThemeId = 'light' | 'dark' | 'cream' | 'landmine';

const page = ref<WorkspacePage>('overview');
const theme = ref<ThemeId>('cream');
const scale = ref(100);
const chatKey = ref(getCurrentChatKey());
const snapshot = ref<WorldEvolutionDbSnapshot | null>(null);
const overviewState = ref<'loading' | 'ready' | 'error'>('loading');
const overviewError = ref('');
const apiReadiness = ref({
  checked: false,
  ready: false,
  source: null as 'builtin' | 'workflow-assistant' | null,
  routeName: null as string | null,
  model: null as string | null,
});
const evolutionOverview = ref({ enabled: false, autoRun: false });
const databaseHost = ref<HTMLElement | null>(null);
const evolutionHost = ref<HTMLElement | null>(null);
let navigateDatabase: WorldEvolutionDbPanelController | undefined;
let stopChatChanged: EventOnReturn | undefined;

const themeOptions: Array<{ id: ThemeId; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'cream', label: '奶油风' },
  { id: 'landmine', label: '地雷色' },
];
const themeLabels: Record<ThemeId, string> = {
  light: '浅色',
  dark: '深色',
  cream: '奶油风',
  landmine: '地雷色',
};
const scaleOptions = [100, 110, 125];

const navigation: Array<{
  label: string;
  items: Array<{ id: WorkspacePage; label: string; icon: string }>;
}> = [
  {
    label: '工作台',
    items: [
      { id: 'overview', label: '总览', icon: '⌂' },
      { id: 'data', label: '世界资料', icon: '▦' },
      { id: 'history', label: '楼层记录', icon: '◷' },
      { id: 'worldbook', label: '世界书投影', icon: '▤' },
    ],
  },
  {
    label: '演变配置',
    items: [
      { id: 'api', label: 'API 配置', icon: '⌘' },
      { id: 'evolution', label: '自动演变', icon: '↻' },
      { id: 'prompts', label: '填表提示词', icon: '✎' },
      { id: 'backup', label: '备份与迁移', icon: '⇅' },
    ],
  },
];

const pageTitles: Record<WorkspacePage, { label: string; title: string }> = {
  overview: { label: '总览', title: '世界总览' },
  data: { label: '工作台 / 世界资料', title: '世界资料库' },
  history: { label: '工作台 / 楼层记录', title: '楼层与版本记录' },
  worldbook: { label: '工作台 / 世界书投影', title: '世界书投影' },
  backup: { label: '配置 / 备份与迁移', title: '备份与迁移' },
  api: { label: '配置 / API 配置', title: 'API 配置' },
  evolution: { label: '配置 / 自动演变', title: '演变运行控制' },
  prompts: { label: '配置 / 填表提示词', title: '提示词工作台' },
  appearance: { label: '设置 / 外观', title: '外观与显示' },
};

const pageMeta = computed(() => pageTitles[page.value]);
const isDatabasePage = computed(
  () => page.value === 'data' || page.value === 'history' || page.value === 'worldbook' || page.value === 'backup',
);
const organizationAndLocationCount = computed(
  () => (snapshot.value?.rows.organization.length ?? 0) + (snapshot.value?.rows.location.length ?? 0),
);
const projectionCount = computed(() => snapshot.value?.projections.length ?? 0);
const projectionStatusLabel = computed(() => {
  const status = snapshot.value?.meta.worldbookSync.status;
  if (status === 'synced') return '同步正常';
  if (status === 'pending') return '等待同步';
  if (status === 'failed') return '同步失败';
  return '尚未同步';
});
const projectionStatus = computed(() => snapshot.value?.meta.worldbookSync.status ?? 'never');
const overviewStateLabel = computed(() => {
  if (overviewState.value === 'loading') return '正在读取';
  if (overviewState.value === 'error') return '读取失败';
  return '已更新';
});
const apiReadinessLabel = computed(() => {
  if (!apiReadiness.value.checked) return '正在检查';
  return apiReadiness.value.ready ? '已就绪' : apiReadiness.value.source ? '配置待检查' : '未配置';
});
const apiReadinessDetail = computed(() => {
  if (!apiReadiness.value.checked) return '正在读取本地路由状态';
  if (!apiReadiness.value.ready) return '前往 API 配置检查端点、模型和凭据';
  const source = apiReadiness.value.source === 'builtin' ? '内置 API' : '工作流助手桥接';
  return `${source}${apiReadiness.value.model ? ` · ${apiReadiness.value.model}` : ''}`;
});
const evolutionReadinessLabel = computed(() => {
  if (!evolutionOverview.value.enabled) return '插件已关闭';
  return evolutionOverview.value.autoRun ? '自动触发已开启' : '仅手动运行';
});
const evolutionReadinessDetail = computed(() => {
  if (!evolutionOverview.value.enabled) return '不会监听、运行或修改世界书';
  return evolutionOverview.value.autoRun ? '完成前置工作流后自动排队' : '可在演变运行页手动开始';
});
const projectionReadinessDetail = computed(() => {
  if (overviewState.value === 'loading') return '正在读取当前聊天状态';
  if (overviewState.value === 'error') return '数据库读取失败，请先重新读取';
  if (projectionStatus.value === 'synced') return '当前聊天的托管条目已同步';
  if (projectionStatus.value === 'pending') return '有投影任务等待处理';
  if (projectionStatus.value === 'failed') return '投影失败，请打开世界书投影页检查';
  return '尚未执行世界书同步';
});
const recentRuns = computed(() =>
  [...(snapshot.value?.floorRuns ?? [])]
    .sort((left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt))
    .slice(0, 5),
);
const latestRun = computed(() => recentRuns.value[0] ?? null);
const failedRuns = computed(() => (snapshot.value?.floorRuns ?? []).filter(run => run.status === 'failed').length);

function runStatusLabel(status: WorldEvolutionDbFloorRun['status']): string {
  const labels: Record<WorldEvolutionDbFloorRun['status'], string> = {
    queued: '排队中',
    running: '演变中',
    done: '已完成',
    skipped: '已跳过',
    failed: '失败',
    cancelled: '已取消',
    stale: '已过期',
  };
  return labels[status] ?? status;
}

function dbPageFor(pageId: WorkspacePage): WorldEvolutionDbPanelPage | undefined {
  const mapping: Partial<Record<WorkspacePage, WorldEvolutionDbPanelPage>> = {
    data: 'tables',
    history: 'history',
    worldbook: 'worldbook',
    backup: 'backup',
  };
  return mapping[pageId];
}

function selectPage(next: WorkspacePage) {
  page.value = next;
  if (next === 'evolution') refreshWorldEvolutionPanelApiStatus();
  if (next === 'overview') void refreshOverview();
  const databasePage = dbPageFor(next);
  if (databasePage) navigateDatabase?.(databasePage);
}

function displayOverviewCount(value: number | undefined): string {
  if (overviewState.value === 'loading') return '…';
  if (overviewState.value === 'error') return '—';
  return String(value ?? 0);
}

async function refreshOverview() {
  chatKey.value = getCurrentChatKey();
  overviewState.value = 'loading';
  overviewError.value = '';
  snapshot.value = null;
  const settings = loadSettings();
  evolutionOverview.value = { enabled: settings.enabled, autoRun: settings.autoRun };
  try {
    const config = loadWorldEvolutionApiConfiguration({
      apiPresetName: settings.apiPresetName,
      apiFallbackPresetNames: settings.apiFallbackPresetNames,
    });
    const routeSummary = getWorldEvolutionApiRouteCardSummary(config, getWorldEvolutionWorkflowAssistantBridge());
    apiReadiness.value = {
      checked: true,
      ready: routeSummary.ready,
      source: routeSummary.source,
      routeName: routeSummary.routeName,
      model: routeSummary.model,
    };
  } catch (error) {
    apiReadiness.value = {
      checked: true,
      ready: false,
      source: null,
      routeName: null,
      model: null,
    };
    console.warn('[世界演变] 总览读取 API 路由失败:', error);
  }
  try {
    snapshot.value = await loadDbSnapshot(chatKey.value);
    overviewState.value = 'ready';
  } catch (error) {
    overviewState.value = 'error';
    overviewError.value = error instanceof Error ? error.message : String(error);
    console.warn('[世界演变] 总览读取数据库失败:', error);
  }
}

function readPreferences() {
  try {
    const raw = localStorage.getItem('acu-world-evolution-workspace-v1');
    if (!raw) return;
    const value = JSON.parse(raw) as { theme?: unknown; scale?: unknown };
    if (value.theme === 'light' || value.theme === 'dark' || value.theme === 'cream' || value.theme === 'landmine') {
      theme.value = value.theme;
    }
    if (value.scale === 100 || value.scale === 110 || value.scale === 125) scale.value = value.scale;
  } catch {
    /* 首次运行或旧设置损坏时使用默认主题 */
  }
}

watch([theme, scale], ([nextTheme, nextScale]) => {
  try {
    localStorage.setItem('acu-world-evolution-workspace-v1', JSON.stringify({ theme: nextTheme, scale: nextScale }));
  } catch (error) {
    console.warn('[世界演变] 保存外观设置失败:', error);
  }
});

function close() {
  props.onClose();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}

onMounted(() => {
  readPreferences();
  if (databaseHost.value) {
    navigateDatabase = mountWorldEvolutionDbPanel(databaseHost.value, {
      initialPage: 'tables',
      hideNavigation: true,
    });
  }
  if (evolutionHost.value) {
    mountWorldEvolutionPanel(evolutionHost.value, { onNavigateToApi: () => selectPage('api') });
  }
  void refreshOverview();
  stopChatChanged = eventOn(tavern_events.CHAT_CHANGED, () => {
    void refreshOverview();
  });
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  stopChatChanged?.stop();
  stopChatChanged = undefined;
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped lang="scss">
.we-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10100;
  display: grid;
  place-items: center;
  padding: 3.5vh 3.5vw;
  background: rgba(13, 19, 28, 0.58);
  backdrop-filter: blur(5px);
}

.we-workspace {
  --we-scale: 1;
  --we-space-1: 4px;
  --we-space-2: 8px;
  --we-space-3: 12px;
  --we-space-4: 16px;
  --we-space-5: 20px;
  --we-space-6: 24px;
  --we-radius-sm: 8px;
  --we-radius-md: 12px;
  --we-radius-lg: 16px;
  --we-control-height: 36px;
  --we-bg: #f7f5f0;
  --we-surface: #ffffff;
  --we-surface-soft: #f4f1e9;
  --we-text: #26312d;
  --we-muted: #65716c;
  --we-text-subtle: #7c8782;
  --we-border: #e4e4dc;
  --we-accent: #739b68;
  --we-accent-strong: #557c4e;
  --we-accent-contrast: #fff;
  --we-tint: #edf3e9;
  --we-input: #fbfaf7;
  --we-danger: #bc5e65;
  --we-danger-strong: #9d424a;
  --we-warning: #9a6c24;
  --we-success: #4e8654;
  --we-info-text: #496b3e;
  --we-info-bg: #e8f1e4;
  --we-info-border: #cfddc6;
  --we-success-text: #426a3a;
  --we-success-bg: #e3f0e1;
  --we-success-border: #bfd5b9;
  --we-warning-text: #73520c;
  --we-warning-bg: #fff1d6;
  --we-warning-border: #ead3a1;
  --we-danger-text: #9d424a;
  --we-danger-bg: #f8e4e8;
  --we-danger-border: #e6bbc4;
  --we-danger-action-bg: #a8475b;
  --we-danger-action-border: #963c50;
  --we-danger-action-text: #fff7f7;
  --we-danger-action-hover-bg: #8e3347;
  --we-action-bg: #496d43;
  --we-action-border: #42633d;
  --we-action-hover-bg: #3d5e38;
  --we-action-text: #ffffff;
  --we-stat-accent: #557c4e;
  --we-focus-ring: 0 0 0 3px color-mix(in srgb, var(--we-accent) 30%, transparent);
  --we-shadow: 0 4px 16px rgba(31, 42, 35, 0.06);
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  width: min(calc(94vw / var(--we-scale)), calc(1480px / var(--we-scale)));
  height: min(calc(92vh / var(--we-scale)), calc(940px / var(--we-scale)));
  overflow: hidden;
  transform: scale(var(--we-scale));
  transform-origin: center;
  border: 1px solid var(--we-border);
  border-radius: 18px;
  background: var(--we-bg);
  color: var(--we-text);
  box-shadow: 0 26px 80px rgba(7, 12, 18, 0.32);
  font-family: Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  line-height: 1.5;
}

.we-workspace,
.we-workspace * {
  box-sizing: border-box;
}

.we-workspace button,
.we-workspace input,
.we-workspace select,
.we-workspace textarea {
  font: inherit;
}

.we-workspace :where(button, input, select, textarea):focus-visible {
  outline: 0;
  box-shadow: var(--we-focus-ring);
}

.we-workspace :where(button, input, select, textarea):disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.we-workspace[data-theme='light'] {
  --we-bg: #f5f7f6;
  --we-surface: #fff;
  --we-surface-soft: #f2f5f4;
  --we-text: #243137;
  --we-muted: #5f6d72;
  --we-text-subtle: #7a878b;
  --we-border: #dfe6e5;
  --we-accent: #4d8b8b;
  --we-accent-strong: #306f72;
  --we-accent-contrast: #fff;
  --we-tint: #e6f2f0;
  --we-input: #fbfdfc;
  --we-danger: #be5360;
  --we-danger-strong: #9d3b49;
  --we-warning: #94671c;
  --we-success: #3f7b4d;
  --we-info-text: #2b6a59;
  --we-info-bg: #e4f1ec;
  --we-info-border: #c5ded4;
  --we-success-text: #336b3d;
  --we-success-bg: #e8f3e8;
  --we-success-border: #c9dec9;
  --we-warning-text: #73520f;
  --we-warning-bg: #fff2d9;
  --we-warning-border: #ebd4a4;
  --we-danger-text: #9d3b49;
  --we-danger-bg: #f9e7ea;
  --we-danger-border: #e9bec5;
  --we-danger-action-bg: #a33e4d;
  --we-danger-action-border: #893341;
  --we-danger-action-text: #ffffff;
  --we-danger-action-hover-bg: #873141;
  --we-action-bg: #306f72;
  --we-action-border: #285f62;
  --we-action-hover-bg: #285e61;
  --we-action-text: #ffffff;
  --we-stat-accent: #306f72;
  --we-focus-ring: 0 0 0 3px color-mix(in srgb, var(--we-accent) 28%, transparent);
  --we-shadow: 0 4px 16px rgba(31, 52, 55, 0.07);
}

.we-workspace[data-theme='dark'] {
  --we-bg: #111925;
  --we-surface: #1b2635;
  --we-surface-soft: #202d3d;
  --we-text: #e8edf0;
  --we-muted: #9aa9b2;
  --we-text-subtle: #82939d;
  --we-border: #334252;
  --we-accent: #8aac81;
  --we-accent-strong: #73986a;
  --we-accent-contrast: #142018;
  --we-tint: #2c3c36;
  --we-input: #141e2b;
  --we-danger: #ee9095;
  --we-danger-strong: #ffb3b7;
  --we-warning: #e7bd72;
  --we-success: #9fd49c;
  --we-info-text: #b6dcc8;
  --we-info-bg: #263b37;
  --we-info-border: #466c60;
  --we-success-text: #a3d6a7;
  --we-success-bg: #20372a;
  --we-success-border: #3d6549;
  --we-warning-text: #f0cb82;
  --we-warning-bg: #3b311e;
  --we-warning-border: #76613b;
  --we-danger-text: #f2aab1;
  --we-danger-bg: #3e252d;
  --we-danger-border: #7c4854;
  --we-danger-action-bg: #a33f53;
  --we-danger-action-border: #bd6875;
  --we-danger-action-text: #fff5f5;
  --we-danger-action-hover-bg: #862f42;
  --we-action-bg: #73986a;
  --we-action-border: #8aac81;
  --we-action-hover-bg: #8aac81;
  --we-action-text: #142018;
  --we-stat-accent: #8aac81;
  --we-focus-ring: 0 0 0 3px color-mix(in srgb, var(--we-accent) 38%, transparent);
  --we-shadow: 0 4px 18px rgba(0, 0, 0, 0.16);
}

.we-workspace[data-theme='cream'] {
  --we-bg: #f4f0e7;
  --we-surface: #fffdf8;
  --we-surface-soft: #f2eadc;
  --we-text: #44392a;
  --we-muted: #756957;
  --we-text-subtle: #918472;
  --we-border: #e7dbc7;
  --we-accent: #86a96c;
  --we-accent-strong: #688a53;
  --we-accent-contrast: #fff;
  --we-tint: #edf3e7;
  --we-input: #fbf7ed;
  --we-danger: #c65f72;
  --we-danger-strong: #a8475b;
  --we-warning: #8d641d;
  --we-success: #527e46;
  --we-info-text: #496b3e;
  --we-info-bg: #e8f1e4;
  --we-info-border: #cfddc6;
  --we-success-text: #426a3a;
  --we-success-bg: #e3f0e1;
  --we-success-border: #bfd5b9;
  --we-warning-text: #73520c;
  --we-warning-bg: #fff1d6;
  --we-warning-border: #ead3a1;
  --we-danger-text: #9d424a;
  --we-danger-bg: #f8e4e8;
  --we-danger-border: #e6bbc4;
  --we-danger-action-bg: #a8475b;
  --we-danger-action-border: #963c50;
  --we-danger-action-text: #fff7f7;
  --we-danger-action-hover-bg: #8e3347;
  --we-action-bg: #526f3f;
  --we-action-border: #456037;
  --we-action-hover-bg: #415a33;
  --we-action-text: #ffffff;
  --we-stat-accent: #557c4e;
  --we-focus-ring: 0 0 0 3px color-mix(in srgb, var(--we-accent) 30%, transparent);
  --we-shadow: 0 4px 16px rgba(69, 51, 27, 0.06);
}

.we-workspace[data-theme='landmine'] {
  --we-bg: #faeff4;
  --we-surface: #fffafd;
  --we-surface-soft: #f7e4ed;
  --we-text: #452b3b;
  --we-muted: #885f77;
  --we-text-subtle: #a47e96;
  --we-border: #efd4e2;
  --we-accent: #d473a2;
  --we-accent-strong: #a9507d;
  --we-accent-contrast: #fff;
  --we-tint: #f9e2ee;
  --we-input: #fff7fb;
  --we-danger: #b54064;
  --we-danger-strong: #96314f;
  --we-warning: #96622a;
  --we-success: #4f815d;
  --we-info-text: #4b6942;
  --we-info-bg: #e9f1e3;
  --we-info-border: #c9d8bf;
  --we-success-text: #3e6949;
  --we-success-bg: #e5f1e5;
  --we-success-border: #bfd8c3;
  --we-warning-text: #73511e;
  --we-warning-bg: #fbefdd;
  --we-warning-border: #e5d0ad;
  --we-danger-text: #96314f;
  --we-danger-bg: #f9e5ed;
  --we-danger-border: #e7bad0;
  --we-danger-action-bg: #96314f;
  --we-danger-action-border: #7e2942;
  --we-danger-action-text: #ffffff;
  --we-danger-action-hover-bg: #7e2942;
  --we-action-bg: #91446d;
  --we-action-border: #7d3b5e;
  --we-action-hover-bg: #773858;
  --we-action-text: #ffffff;
  --we-stat-accent: #a9507d;
  --we-focus-ring: 0 0 0 3px color-mix(in srgb, var(--we-accent) 30%, transparent);
  --we-shadow: 0 4px 16px rgba(89, 38, 69, 0.08);
}

.we-sidebar {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow-y: auto;
  padding: var(--we-space-5) 14px 14px;
  border-right: 1px solid var(--we-border);
  background: var(--we-surface);
}

.we-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 5px var(--we-space-5);
}

.we-brand-mark {
  display: grid;
  width: 39px;
  height: 39px;
  place-items: center;
  border-radius: 12px;
  background: linear-gradient(145deg, var(--we-accent), var(--we-accent-strong));
  color: var(--we-accent-contrast);
  font-family: Georgia, serif;
  font-size: 22px;
  font-weight: 800;
  box-shadow: var(--we-shadow);
}

.we-brand-copy {
  display: grid;
  min-width: 0;
  line-height: 1.25;
}

.we-brand-copy strong {
  overflow: hidden;
  font-size: 15px;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.we-brand-copy span {
  margin-top: 4px;
  color: var(--we-muted);
  font-size: 9px;
  letter-spacing: 0.11em;
}

.we-chat-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin-bottom: var(--we-space-5);
  padding: 8px 9px;
  border: 1px solid var(--we-border);
  border-radius: var(--we-radius-sm);
  background: var(--we-bg);
  color: var(--we-muted);
  font-size: 11px;
}

.we-chat-chip.idle {
  background: var(--we-surface-soft);
}

.we-chat-chip > span:last-child {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.we-chat-caption {
  flex: none;
  color: var(--we-text);
  font-size: 10px;
  font-weight: 700;
}

.we-chat-name {
  color: var(--we-muted);
}

.we-live-dot,
.we-status-dot,
.we-run-mark {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--we-accent);
}

.we-live-dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-accent) 16%, transparent);
}

.we-navigation {
  display: grid;
  gap: var(--we-space-5);
  align-content: start;
}

.we-nav-group {
  display: grid;
  gap: var(--we-space-1);
}

.we-nav-label {
  padding: 0 9px 6px;
  color: var(--we-muted);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.1em;
}

.we-nav-item,
.we-sidebar-settings {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: var(--we-control-height);
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--we-muted);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.we-nav-item:focus-visible,
.we-sidebar-settings:focus-visible {
  box-shadow: var(--we-focus-ring);
}

.we-nav-item {
  padding: 6px 10px;
}

.we-nav-item:hover,
.we-sidebar-settings:hover {
  background: var(--we-bg);
  color: var(--we-text);
}

.we-nav-item.active {
  background: var(--we-tint);
  color: var(--we-accent-strong);
  font-weight: 700;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--we-accent-strong) 24%, transparent);
}

.we-nav-item > span:nth-child(2) {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.we-nav-icon {
  display: grid;
  width: 19px;
  place-items: center;
  font-size: 16px;
}

.we-nav-badge {
  min-width: 19px;
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--we-danger);
  color: #fff;
  font-size: 10px;
  text-align: center;
}

.we-sidebar-foot {
  display: grid;
  gap: var(--we-space-3);
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--we-border);
}

.we-foot-status {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 4px;
  color: var(--we-muted);
  font-size: 11px;
}

.we-status-dot.failed {
  background: var(--we-danger);
}

.we-status-dot.idle {
  background: var(--we-muted);
  box-shadow: none;
}

.we-sidebar-settings {
  min-height: 34px;
  padding: 5px 8px;
  font-size: 12px;
}

.we-version {
  display: grid;
  gap: 2px;
  padding: 0 8px;
  color: var(--we-muted);
  font-size: 10px;
}

.we-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.we-topbar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--we-space-4);
  min-height: 74px;
  padding: var(--we-space-3) var(--we-space-6);
  border-bottom: 1px solid var(--we-border);
  background: var(--we-surface);
}

.we-topbar-title {
  overflow: hidden;
  min-width: 0;
}

.we-topbar-title h1 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.we-breadcrumb {
  overflow: hidden;
  color: var(--we-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.we-breadcrumb span {
  padding: 0 5px;
  color: var(--we-border);
}

.we-topbar-title h1 {
  margin: 2px 0 0;
  font-size: 18px;
  font-weight: 750;
  letter-spacing: 0.02em;
}

.we-topbar-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--we-space-3);
}

.we-revision-chip {
  padding: 5px 9px;
  border: 1px solid var(--we-border);
  border-radius: 999px;
  background: var(--we-bg);
  color: var(--we-muted);
  font-size: 10px;
  line-height: 1.2;
}

.we-revision-chip strong {
  padding-left: 3px;
  color: var(--we-text);
}

.we-close {
  display: grid;
  width: 31px;
  height: 31px;
  place-items: center;
  border: 1px solid var(--we-border);
  border-radius: var(--we-radius-sm);
  background: var(--we-surface);
  color: var(--we-muted);
  cursor: pointer;
  font: inherit;
  font-size: 23px;
  line-height: 1;
}

.we-close:hover {
  border-color: var(--we-danger);
  color: var(--we-danger);
}

.we-page-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
  overflow: auto;
  overflow-x: hidden;
  padding: var(--we-space-5) var(--we-space-6) 26px;
  background: var(--we-bg);
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-color: var(--we-border) transparent;
  scrollbar-width: thin;
}

.we-page {
  width: 100%;
  max-width: 1280px;
  min-width: 0;
  min-height: 100%;
  margin: 0 auto;
}

.we-welcome {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 24px;
  border: 1px solid color-mix(in srgb, var(--we-accent) 24%, var(--we-border));
  border-radius: 16px;
  background:
    radial-gradient(ellipse at 90% 5%, color-mix(in srgb, var(--we-accent) 13%, transparent), transparent 52%),
    var(--we-surface);
  box-shadow: var(--we-shadow);
}

.we-eyebrow {
  margin: 0 0 7px;
  color: var(--we-accent-strong);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.we-welcome h2 {
  margin: 0;
  font-family: Georgia, 'Noto Serif SC', 'Songti SC', serif;
  font-size: clamp(20px, 2.2vw, 29px);
  letter-spacing: 0.02em;
}

.we-welcome p:not(.we-eyebrow) {
  max-width: 670px;
  margin: 10px 0 0;
  color: var(--we-muted);
  font-size: 12px;
}

.we-primary-action {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-height: 41px;
  padding: 8px 13px;
  border-radius: 10px;
  border: 1px solid var(--we-action-border);
  background: var(--we-action-bg);
  color: var(--we-action-text);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.we-primary-action:hover {
  border-color: var(--we-action-hover-bg);
  background: var(--we-action-hover-bg);
}

.we-console-card {
  display: block;
  min-width: 0;
  border: 1px solid var(--we-border);
  border-radius: 14px;
  background: var(--we-surface);
  box-shadow: var(--we-shadow);
}

.we-console-readiness-card {
  margin-top: var(--we-space-4);
  padding: 15px;
}

.we-readiness-note {
  color: var(--we-muted);
  font-size: 11px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.we-readiness-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.we-readiness-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--we-border);
  border-radius: var(--we-radius-sm);
  background: var(--we-input);
  color: var(--we-text);
  cursor: pointer;
  text-align: left;
}

.we-readiness-item:hover {
  border-color: var(--we-accent);
  background: var(--we-tint);
}

.we-readiness-item.warning .we-readiness-icon {
  background: var(--we-warning-bg);
  color: var(--we-warning-text);
}

.we-readiness-item.ready .we-readiness-icon {
  background: var(--we-success-bg);
  color: var(--we-success-text);
}

.we-readiness-icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  background: var(--we-tint);
  color: var(--we-accent-strong);
  font-size: 15px;
}

.we-readiness-main {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.we-readiness-main strong {
  font-size: 11px;
}

.we-readiness-main small,
.we-readiness-main > span {
  color: var(--we-muted);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.we-readiness-main small {
  color: var(--we-text);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.we-readiness-arrow {
  color: var(--we-muted);
  font-size: 13px;
}

.we-overview-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: var(--we-space-4);
  padding: 10px 12px;
  border: 1px solid var(--we-danger-border);
  border-radius: var(--we-radius-sm);
  background: var(--we-danger-bg);
  color: var(--we-danger-text);
  font-size: 11px;
}

.we-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 15px;
}

.we-stat-card {
  display: grid;
  min-width: 0;
  min-height: 142px;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto 1fr auto;
  gap: 3px 8px;
  padding: 14px;
  border: 1px solid var(--we-border);
  border-radius: 13px;
  background: var(--we-surface);
  color: var(--we-text);
  cursor: pointer;
  text-align: left;
  box-shadow: var(--we-shadow);
}

.we-stat-card:hover {
  border-color: var(--we-accent);
  transform: translateY(-1px);
}

.we-stat-icon {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 10px;
  background: var(--we-tint);
  color: var(--we-accent-strong);
  font-size: 17px;
}

.we-stat-label {
  grid-column: 1;
  grid-row: 1;
  color: var(--we-muted);
  font-size: 11px;
}

.we-stat-card > strong {
  grid-column: 1 / -1;
  grid-row: 2 / span 2;
  align-self: center;
  font-size: 27px;
  line-height: 1;
}

.we-stat-foot {
  grid-column: 1 / -1;
  grid-row: 4;
  display: flex;
  justify-content: space-between;
  color: var(--we-muted);
  font-size: 10px;
}

.we-stat-foot span {
  color: var(--we-accent-strong);
}

.we-overview-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  gap: 14px;
  margin-top: 15px;
}

.we-recent-card,
.we-shortcuts-card,
.we-appearance-card {
  padding: 15px;
}

.we-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 11px;
}

.we-section-heading .we-eyebrow {
  margin-bottom: 2px;
  font-size: 9px;
}

.we-section-heading h3,
.we-appearance-heading h3 {
  margin: 0;
  font-size: 15px;
}

.we-link-button {
  padding: 5px 0 5px 8px;
  border: 0;
  background: transparent;
  color: var(--we-accent-strong);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}

.we-run-list {
  display: grid;
}

.we-run-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 47px;
  border-top: 1px solid var(--we-border);
}

.we-run-mark {
  width: 7px;
  height: 7px;
}

.we-run-mark.status-failed {
  background: var(--we-danger);
}

.we-run-mark.status-running,
.we-run-mark.status-queued {
  background: var(--we-warning-text);
}

.we-run-main {
  display: grid;
  min-width: 0;
  flex: 1;
}

.we-run-main strong {
  font-size: 11px;
}

.we-run-main span {
  overflow: hidden;
  color: var(--we-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.we-run-status {
  color: var(--we-muted);
  font-size: 10px;
}

.we-empty-state {
  display: grid;
  min-height: 142px;
  place-content: center;
  justify-items: center;
  gap: 5px;
  border-top: 1px solid var(--we-border);
  color: var(--we-muted);
  text-align: center;
}

.we-empty-state > span {
  color: var(--we-accent);
  font-size: 23px;
}

.we-empty-state strong {
  color: var(--we-text);
  font-size: 12px;
}

.we-empty-state small {
  max-width: 280px;
  font-size: 10px;
}

.we-empty-action {
  padding: 4px 8px;
  border: 1px solid var(--we-border);
  border-radius: 7px;
  background: var(--we-surface-soft);
  color: var(--we-accent-strong);
  cursor: pointer;
  font: inherit;
  font-size: 10px;
}

.we-empty-action:hover {
  border-color: var(--we-accent);
  background: var(--we-tint);
}

.we-shortcut {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 55px;
  padding: 7px 0;
  border: 0;
  border-top: 1px solid var(--we-border);
  background: transparent;
  color: var(--we-text);
  cursor: pointer;
  text-align: left;
}

.we-shortcut > span:nth-child(2) {
  display: grid;
  flex: 1;
}

.we-shortcut strong {
  font-size: 11px;
}

.we-shortcut small {
  color: var(--we-muted);
  font-size: 10px;
}

.we-shortcut-icon {
  display: grid;
  width: 31px;
  height: 31px;
  flex: none;
  place-items: center;
  border-radius: 9px;
  font-size: 16px;
}

.we-shortcut-icon.green {
  background: var(--we-success-bg);
  color: var(--we-success-text);
}

.we-shortcut-icon.purple {
  background: var(--we-info-bg);
  color: var(--we-info-text);
}

.we-shortcut-icon.amber {
  background: var(--we-warning-bg);
  color: var(--we-warning-text);
}

.we-shortcut-arrow {
  color: var(--we-muted);
}

.we-page-intro {
  margin-bottom: 14px;
}

.we-page-intro h2 {
  margin: 0;
  font-size: 22px;
}

.we-page-intro p:not(.we-eyebrow) {
  margin: 5px 0 0;
  color: var(--we-muted);
  font-size: 12px;
}

.we-appearance-page {
  display: grid;
  align-content: start;
  gap: 13px;
  max-width: 940px;
}

.we-appearance-page .we-page-intro {
  margin: 2px 0 3px;
}

.we-appearance-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.we-appearance-heading p {
  margin: 4px 0 0;
  color: var(--we-muted);
  font-size: 11px;
}

.we-appearance-current {
  color: var(--we-accent-strong);
  font-size: 11px;
  font-weight: 700;
}

.we-theme-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.we-theme-option {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--we-border);
  border-radius: 11px;
  background: var(--we-surface);
  color: var(--we-text);
  cursor: pointer;
  text-align: left;
}

.we-theme-option.active {
  border-color: var(--we-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--we-accent) 17%, transparent);
}

.we-theme-preview {
  display: flex;
  gap: 4px;
  height: 47px;
  align-items: flex-end;
  padding: 6px;
  border: 1px solid rgba(80, 80, 80, 0.12);
  border-radius: 7px;
  background: #f6f7f5;
}

.we-theme-preview i {
  display: block;
  height: 27px;
  flex: 1;
  border-radius: 3px;
  background: #fff;
  border: 1px solid rgba(30, 50, 45, 0.1);
}

.theme-dark .we-theme-preview {
  background: #192331;
}
.theme-dark .we-theme-preview i {
  background: #293747;
  border-color: #455566;
}
.theme-cream .we-theme-preview {
  background: #f4f0e7;
}
.theme-cream .we-theme-preview i {
  background: #fffdf8;
  border-color: #e7dbc7;
}
.theme-landmine .we-theme-preview {
  background: #faeff4;
}
.theme-landmine .we-theme-preview i {
  background: #fffafd;
  border-color: #efd4e2;
}

.we-theme-name {
  min-width: 0;
  font-size: 11px;
  overflow-wrap: anywhere;
}

.we-theme-check {
  position: absolute;
  top: 14px;
  right: 14px;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  background: var(--we-accent);
  color: #fff;
  font-size: 11px;
}

.we-scale-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  padding: 4px;
  border-radius: 10px;
  background: var(--we-surface-soft);
}

.we-scale-options button {
  min-height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--we-muted);
  cursor: pointer;
  font: inherit;
}

.we-scale-options button.active {
  border-color: var(--we-action-border);
  background: var(--we-action-bg);
  color: var(--we-action-text);
  font-weight: 700;
  box-shadow: var(--we-shadow);
}

.we-appearance-note {
  display: grid;
  gap: 3px;
  padding: 11px 14px;
  border-radius: 10px;
  background: var(--we-tint);
  color: var(--we-muted);
  font-size: 11px;
}

.we-appearance-note strong {
  color: var(--we-text);
}

.we-database-page,
.we-evolution-page {
  width: 100%;
}

.we-api-settings-page {
  max-width: 1180px;
}

.we-evolution-page {
  display: grid;
  align-content: start;
  gap: 17px;
  max-width: 1120px;
}

.we-evolution-runtime {
  width: 100%;
  min-width: 0;
  overflow: visible;
  container-type: inline-size;
}

:global(.we-console-page-host) {
  min-width: 0;
}

:global(.we-workspace .wedb-panel-embedded),
:global(.we-workspace .we-panel-embedded) {
  width: 100% !important;
  max-height: none !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

:global(.we-workspace[data-theme='light'] .we-section),
:global(.we-workspace[data-theme='cream'] .we-section),
:global(.we-workspace[data-theme='landmine'] .we-section),
:global(.we-workspace[data-theme='light'] .we-console-card),
:global(.we-workspace[data-theme='cream'] .we-console-card),
:global(.we-workspace[data-theme='landmine'] .we-console-card) {
  border-color: var(--we-border) !important;
  background: var(--we-surface) !important;
  color: var(--we-text) !important;
}

:global(.we-workspace[data-theme='light'] .we-section-title),
:global(.we-workspace[data-theme='cream'] .we-section-title),
:global(.we-workspace[data-theme='landmine'] .we-section-title),
:global(.we-workspace[data-theme='light'] .we-card-title),
:global(.we-workspace[data-theme='cream'] .we-card-title),
:global(.we-workspace[data-theme='landmine'] .we-card-title),
:global(.we-workspace[data-theme='light'] .we-card-state),
:global(.we-workspace[data-theme='cream'] .we-card-state),
:global(.we-workspace[data-theme='landmine'] .we-card-state) {
  color: var(--we-text) !important;
}

:global(.we-workspace[data-theme='light'] .we-card-meta),
:global(.we-workspace[data-theme='cream'] .we-card-meta),
:global(.we-workspace[data-theme='landmine'] .we-card-meta),
:global(.we-workspace[data-theme='light'] .we-muted),
:global(.we-workspace[data-theme='cream'] .we-muted),
:global(.we-workspace[data-theme='landmine'] .we-muted),
:global(.we-workspace[data-theme='light'] .we-label),
:global(.we-workspace[data-theme='cream'] .we-label),
:global(.we-workspace[data-theme='landmine'] .we-label) {
  color: var(--we-muted) !important;
}

:global(.we-workspace[data-theme='light'] .we-status),
:global(.we-workspace[data-theme='cream'] .we-status),
:global(.we-workspace[data-theme='landmine'] .we-status),
:global(.we-workspace[data-theme='light'] .we-input),
:global(.we-workspace[data-theme='cream'] .we-input),
:global(.we-workspace[data-theme='landmine'] .we-input),
:global(.we-workspace[data-theme='light'] .we-select),
:global(.we-workspace[data-theme='cream'] .we-select),
:global(.we-workspace[data-theme='landmine'] .we-select) {
  border-color: var(--we-border) !important;
  background: var(--we-input) !important;
  color: var(--we-text) !important;
}

:global(.we-workspace[data-theme='light'] .we-btn),
:global(.we-workspace[data-theme='cream'] .we-btn),
:global(.we-workspace[data-theme='landmine'] .we-btn) {
  border-color: var(--we-border) !important;
  background: var(--we-surface-soft) !important;
  color: var(--we-text) !important;
}

:global(.we-workspace[data-theme='light'] .we-btn:hover:not(.we-btn-danger)),
:global(.we-workspace[data-theme='cream'] .we-btn:hover:not(.we-btn-danger)),
:global(.we-workspace[data-theme='landmine'] .we-btn:hover:not(.we-btn-danger)) {
  background: var(--we-tint) !important;
}

:global(.we-workspace[data-theme='light'] .we-danger),
:global(.we-workspace[data-theme='cream'] .we-danger),
:global(.we-workspace[data-theme='landmine'] .we-danger) {
  color: var(--we-danger-text) !important;
}

:global(.we-workspace[data-theme='light'] .we-ok),
:global(.we-workspace[data-theme='cream'] .we-ok),
:global(.we-workspace[data-theme='landmine'] .we-ok) {
  color: var(--we-success-text) !important;
}

:global(.we-workspace[data-theme='light'] .we-check),
:global(.we-workspace[data-theme='cream'] .we-check),
:global(.we-workspace[data-theme='landmine'] .we-check) {
  accent-color: var(--we-accent);
}

:global(.we-workspace .we-btn-primary) {
  border-color: var(--we-action-border) !important;
  background: var(--we-action-bg) !important;
  color: var(--we-action-text) !important;
}

:global(.we-workspace .we-btn-primary:hover:not(:disabled)) {
  border-color: var(--we-action-hover-bg) !important;
  background: var(--we-action-hover-bg) !important;
}

:global(.we-workspace[data-theme='light'] .we-api-status-item),
:global(.we-workspace[data-theme='dark'] .we-api-status-item),
:global(.we-workspace[data-theme='cream'] .we-api-status-item),
:global(.we-workspace[data-theme='landmine'] .we-api-status-item) {
  border-color: var(--we-border) !important;
  background: var(--we-surface-soft) !important;
}

:global(.we-workspace[data-theme='light'] .we-api-status-label),
:global(.we-workspace[data-theme='dark'] .we-api-status-label),
:global(.we-workspace[data-theme='cream'] .we-api-status-label),
:global(.we-workspace[data-theme='landmine'] .we-api-status-label) {
  color: var(--we-muted) !important;
}

@media (max-width: 900px) {
  .we-workspace {
    grid-template-columns: 190px minmax(0, 1fr);
  }

  .we-topbar {
    padding-right: 18px;
    padding-left: 18px;
  }

  .we-topbar-actions {
    gap: var(--we-space-2);
  }

  .we-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .we-page-scroll {
    padding-right: 18px;
    padding-left: 18px;
  }

  .we-readiness-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .we-backdrop {
    padding: 0;
  }

  .we-workspace {
    width: 100vw;
    height: 100vh;
    transform: none;
    transform-origin: initial;
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    border: 0;
    border-radius: 0;
  }

  .we-sidebar {
    display: block;
    padding: 9px 10px 0;
    border-right: 0;
    border-bottom: 1px solid var(--we-border);
  }

  .we-brand {
    padding: 0 2px 8px;
  }

  .we-brand-mark {
    width: 31px;
    height: 31px;
    border-radius: 9px;
    font-size: 17px;
  }

  .we-brand-copy strong {
    font-size: 12px;
  }

  .we-brand-copy span,
  .we-chat-chip,
  .we-sidebar-foot,
  .we-nav-label {
    display: none;
  }

  .we-navigation {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 8px;
  }

  .we-nav-group {
    display: flex;
    flex: none;
    gap: 4px;
  }

  .we-nav-item {
    min-height: 34px;
    gap: 6px;
    padding: 5px 9px;
    white-space: nowrap;
    font-size: 11px;
  }

  .we-nav-icon {
    width: auto;
    font-size: 13px;
  }

  .we-topbar {
    min-height: 64px;
    padding: 8px 12px;
  }

  .we-topbar-title h1 {
    overflow: visible;
    font-size: 15px;
    line-height: 1.25;
    text-overflow: clip;
    white-space: normal;
  }

  .we-topbar-actions {
    align-self: center;
    gap: 6px;
  }

  .we-revision-chip {
    padding: 4px 7px;
    font-size: 9px;
    white-space: nowrap;
  }

  .we-close {
    width: 29px;
    height: 29px;
  }

  .we-page-scroll {
    padding: 12px;
  }

  .we-api-settings-page,
  .we-evolution-page {
    max-width: none;
  }

  .we-welcome {
    display: grid;
    padding: 16px;
  }

  .we-readiness-grid {
    grid-template-columns: 1fr;
  }

  .we-overview-alert {
    align-items: stretch;
    flex-direction: column;
  }

  .we-primary-action {
    width: fit-content;
  }

  .we-stat-grid {
    gap: 8px;
  }

  .we-stat-card {
    min-height: 120px;
    padding: 11px;
  }

  .we-overview-columns {
    grid-template-columns: 1fr;
  }

  .we-theme-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (max-width: 820px) {
  .we-welcome {
    display: grid;
    align-items: start;
    padding: 20px;
  }

  .we-primary-action {
    justify-self: start;
  }

  .we-console-readiness-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .we-console-readiness-heading > div {
    width: 100%;
    min-width: 0;
  }

  .we-readiness-note {
    max-width: 100%;
  }

  .we-readiness-grid,
  .we-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .we-overview-columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .we-theme-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (max-width: 560px) {
  .we-welcome {
    padding: 16px;
  }

  .we-welcome > div > .we-eyebrow,
  .we-console-readiness-heading > div > .we-eyebrow {
    display: none;
  }

  .we-readiness-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .we-readiness-note {
    max-width: 100%;
  }

  .we-section-heading,
  .we-appearance-heading {
    align-items: flex-start;
    flex-direction: column;
  }
}

/* At 125% the workspace intentionally reserves more CSS pixels for the same
 * visual area. Keep the theme cards readable instead of letting short labels
 * collapse into one-character columns in narrow embedded panels. */
.we-workspace[data-scale='125'] .we-theme-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.we-workspace[data-scale='125'] .we-appearance-page {
  max-width: 760px;
}

.we-workspace[data-scale='125'] .we-page-scroll {
  padding-bottom: 48px;
}
</style>
