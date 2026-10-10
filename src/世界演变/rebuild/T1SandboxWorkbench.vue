<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue';
import {
  createT1Route,
  createT1SandboxController,
  describeT1Action,
  evaluateT1Action,
  T1_PAGE_BLUEPRINTS,
  T1_PAGE_ITEMS,
  T1_PARAMETER_SECTIONS,
} from './t1-ui-contract';

const props = defineProps<{
  initialRoute?: unknown;
  controller?: ReturnType<typeof createT1SandboxController>;
}>();

// This component is deliberately not imported by any production entry point.
const controller: ReturnType<typeof createT1SandboxController> =
  props.controller ?? createT1SandboxController({ initialRoute: props.initialRoute });
const state = shallowRef(controller.getState());
const pageHeading = ref<HTMLElement | null>(null);
const closedNote = ref<HTMLElement | null>(null);
const stayButton = ref<HTMLButtonElement | null>(null);
const discardButton = ref<HTMLButtonElement | null>(null);
let confirmationFocusIndex = 0;

const page = computed(() => T1_PAGE_BLUEPRINTS[state.value.route.page]);
const dataRoute = computed(() => (state.value.route.page === 'data' ? state.value.route : null));
const action = computed(() => describeT1Action(page.value.primaryActionId));
const actionPolicy = computed(() =>
  evaluateT1Action(page.value.primaryActionId, {
    mode: 'sandbox-only',
    worldStatus: 'uninitialized',
    runStatus: 'idle',
    freshness: 'current',
    hasAssistantAnchor: false,
    chatIdentityKnown: false,
    saveConfirmation: 'not-applicable',
    capabilities: {},
  }),
);
const navigationGroups = computed(() => [...new Set(T1_PAGE_ITEMS.map(item => item.group))]);

function refresh() {
  state.value = controller.getState();
  void nextTick(() => {
    if (state.value.pending) {
      confirmationFocusIndex = 0;
      stayButton.value?.focus();
    } else if (state.value.isOpen) {
      pageHeading.value?.focus();
    } else {
      closedNote.value?.focus();
    }
  });
}

function selectPage(pageId: string) {
  controller.navigate(createT1Route({ page: pageId }));
  refresh();
}

function selectDataTab(tab: 'records' | 'parameters') {
  if (state.value.route.page !== 'data') return;
  const section = tab === 'records' ? 'schema' : state.value.route.section;
  controller.navigate(createT1Route({ ...state.value.route, tab, section }));
  refresh();
}

function selectParameterSection(section: string) {
  if (state.value.route.page !== 'data') return;
  controller.navigate(createT1Route({ ...state.value.route, tab: 'parameters', section }));
  refresh();
}

function createExampleDraft() {
  controller.markDraft('current-world', '演示 NPC 姓名字段的未保存修改');
  refresh();
}

function requestClose() {
  controller.requestClose();
  refresh();
}

function resolvePending(choice: 'stay' | 'discard') {
  controller.resolvePending(choice);
  refresh();
}

function cycleConfirmationFocus(backwards: boolean) {
  confirmationFocusIndex = (confirmationFocusIndex + (backwards ? -1 : 1) + 2) % 2;
  [stayButton.value, discardButton.value][confirmationFocusIndex]?.focus();
}
</script>

<template>
  <section v-if="state.isOpen" class="we-t1" aria-label="世界演变 T1 内存沙盒" @keydown.esc.stop.prevent="requestClose">
    <aside class="we-t1-sidebar" aria-label="工作台导航" :inert="state.pending ? true : undefined">
      <div class="we-t1-brand">
        <span class="we-t1-brand-mark" aria-hidden="true">世</span>
        <div>
          <strong>世界演变</strong>
          <p>T1 页面与交互样例</p>
        </div>
      </div>
      <p class="we-t1-sidebar-note">当前范围：独立示例世界<br />未连接当前聊天或旧数据库</p>
      <nav aria-label="工作台页面">
        <div v-for="group in navigationGroups" :key="group" class="we-t1-nav-group">
          <p class="we-t1-nav-label">{{ group }}</p>
          <button
            v-for="item in T1_PAGE_ITEMS.filter(candidate => candidate.group === group)"
            :key="item.id"
            type="button"
            class="we-t1-nav-item"
            :aria-current="state.route.page === item.id ? 'page' : undefined"
            @click="selectPage(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
      </nav>
      <p class="we-t1-sidebar-note">仅演示导航、范围和确认流程<br />不是可导入的正式功能</p>
    </aside>

    <main class="we-t1-main" :inert="state.pending ? true : undefined">
      <header class="we-t1-header">
        <div>
          <p class="we-t1-eyebrow">世界演变工作台 / T1 沙盒</p>
          <h1 ref="pageHeading" class="we-t1-heading" tabindex="-1">{{ page.title }}</h1>
        </div>
        <button type="button" class="we-t1-button" aria-label="关闭工作台样例" @click="requestClose">关闭</button>
      </header>

      <div class="we-t1-content">
        <section class="we-t1-sandbox-banner" aria-label="沙盒安全边界">
          <strong>仅内存沙盒 · 非正式功能</strong>
          <p>未写当前聊天，不调用 API 或世界书；刷新、卸载或关闭并丢弃后，示例草稿不会保留。</p>
        </section>

        <div class="we-t1-status-line" role="status" aria-live="polite">
          <span class="we-t1-badge">尚未初始化</span>
          <span class="we-t1-badge">未连接聊天存档</span>
          <span v-if="state.dirtyDraft" class="we-t1-badge we-t1-badge-draft">有示例草稿 · 尚未保存</span>
          <span v-else class="we-t1-badge">没有未保存修改</span>
        </div>

        <section v-if="dataRoute" class="we-t1-card" aria-label="世界资料子页">
          <div class="we-t1-segmented" aria-label="世界资料视图">
            <button
              type="button"
              class="we-t1-button"
              :aria-pressed="dataRoute?.tab === 'records'"
              @click="selectDataTab('records')"
            >
              数据
            </button>
            <button
              type="button"
              class="we-t1-button"
              :aria-pressed="dataRoute?.tab === 'parameters'"
              @click="selectDataTab('parameters')"
            >
              结构与参数
            </button>
          </div>
          <p>宏观世界先提供条件，微观对象再根据最新宏观条件行动。此页目前只展示结构，不创建真实表或记录。</p>
          <div class="we-t1-table-groups" aria-label="世界资料分组">
            <div>
              <h2>宏观世界</h2>
              <p>社会、环境、地点及自定义宏观表</p>
            </div>
            <div>
              <h2>微观世界</h2>
              <p>NPC、组织、计划、事件及自定义微观表</p>
            </div>
          </div>
          <nav v-if="dataRoute?.tab === 'parameters'" class="we-t1-parameter-nav" aria-label="表级参数分区">
            <button
              v-for="section in T1_PARAMETER_SECTIONS"
              :key="section.id"
              type="button"
              class="we-t1-button"
              :aria-current="dataRoute?.section === section.id ? 'page' : undefined"
              @click="selectParameterSection(section.id)"
            >
              {{ section.label }}
            </button>
          </nav>
          <p v-if="dataRoute?.tab === 'parameters'" class="we-t1-muted">
            表级参数尚未接入模板服务；切换分区不修改数据。
          </p>
        </section>

        <section class="we-t1-card" aria-labelledby="we-t1-page-regions-title">
          <h2 id="we-t1-page-regions-title">页面区域与用途</h2>
          <ol class="we-t1-regions">
            <li v-for="region in page.sections" :key="region">{{ region }}</li>
          </ol>
          <p class="we-t1-muted">完整能力在 {{ page.futurePhase }} 接入；T1 只确认页面结构与操作边界。</p>
        </section>

        <section class="we-t1-empty" aria-labelledby="we-t1-empty-title">
          <h2 id="we-t1-empty-title">{{ page.emptyTitle }}</h2>
          <p>{{ page.emptyDescription }}</p>
        </section>

        <section class="we-t1-card" aria-labelledby="we-t1-action-title">
          <h2 id="we-t1-action-title">操作范围与限制</h2>
          <p class="we-t1-scope">{{ actionPolicy.scopeNotice }}</p>
          <p>{{ actionPolicy.consequence }}</p>
          <button type="button" class="we-t1-button" disabled aria-describedby="we-t1-blocked-reasons">
            {{ action.label }}（{{ action.phase }} 后接入）
          </button>
          <div id="we-t1-blocked-reasons" class="we-t1-blocked" role="note">
            <strong>当前不能执行的原因</strong>
            <ul>
              <li v-for="reason in actionPolicy.reasons" :key="reason.code">{{ reason.message }}</li>
            </ul>
          </div>
        </section>

        <section class="we-t1-card" aria-labelledby="we-t1-draft-title">
          <h2 id="we-t1-draft-title">试一下未保存离开提示</h2>
          <p>这个按钮只制造本组件的示例草稿，不新增 NPC，也不保存任何世界数据。</p>
          <button type="button" class="we-t1-button" :disabled="Boolean(state.dirtyDraft)" @click="createExampleDraft">
            制造示例草稿
          </button>
          <p v-if="state.dirtyDraft" class="we-t1-draft-description">{{ state.dirtyDraft.label }}</p>
          <p class="we-t1-muted">有草稿时，切页、切子页或关闭会先询问；选择“留下继续查看”不会丢失草稿。</p>
        </section>
      </div>
    </main>

    <div v-if="state.pending" class="we-t1-confirm-backdrop">
      <section
        class="we-t1-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="we-t1-confirm-title"
        aria-describedby="we-t1-confirm-description"
        @keydown.tab.prevent="cycleConfirmationFocus($event.shiftKey)"
        @keydown.esc.stop.prevent="resolvePending('stay')"
      >
        <h2 id="we-t1-confirm-title">还有未保存的示例草稿</h2>
        <p id="we-t1-confirm-description">
          {{ state.dirtyDraft?.label }}。丢弃只清除此内存样例；不会删除当前聊天或正式数据库。
        </p>
        <div class="we-t1-confirm-actions">
          <button
            ref="stayButton"
            type="button"
            class="we-t1-button"
            @focus="confirmationFocusIndex = 0"
            @click="resolvePending('stay')"
          >
            留下继续查看
          </button>
          <button
            ref="discardButton"
            type="button"
            class="we-t1-button we-t1-button-danger"
            @focus="confirmationFocusIndex = 1"
            @click="resolvePending('discard')"
          >
            丢弃示例草稿并{{ state.pending.kind === 'close' ? '关闭' : '离开' }}
          </button>
        </div>
      </section>
    </div>
  </section>
  <section v-else ref="closedNote" class="we-t1-closed" tabindex="-1" role="status" aria-live="polite">
    工作台样例已关闭。未写当前聊天，未调用 API 或世界书。
  </section>
</template>

<style scoped>
.we-t1,
.we-t1-closed {
  --we-t1-ink: #273c32;
  --we-t1-muted: #596b60;
  --we-t1-line: #ccdacf;
  --we-t1-surface: #fffdf6;
  --we-t1-green: #e9f3e8;
  --we-t1-focus: #427052;
  --we-t1-danger: #fbe7ed;
  --we-t1-danger-ink: #8c314e;
  box-sizing: border-box;
  color: var(--we-t1-ink);
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.we-t1 {
  display: grid;
  grid-template-columns: minmax(9rem, 12rem) minmax(0, 1fr);
  width: 100%;
  max-width: 72rem;
  margin-inline: auto;
  border: 1px solid var(--we-t1-line);
  border-radius: 1rem;
  background: #f8f7ed;
}
.we-t1 * {
  box-sizing: border-box;
}
.we-t1 h1,
.we-t1 h2,
.we-t1 p {
  margin: 0;
}
.we-t1 h1 {
  font-size: 1.5rem;
  line-height: 1.3;
}
.we-t1 h2 {
  font-size: 1.05rem;
}
.we-t1 p + p,
.we-t1 h2 + p {
  margin-top: 0.5rem;
}
.we-t1-sidebar {
  min-width: 0;
  padding: 1rem;
  border-right: 1px solid var(--we-t1-line);
}
.we-t1-brand {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}
.we-t1-brand p,
.we-t1-sidebar-note,
.we-t1-eyebrow,
.we-t1-muted {
  color: var(--we-t1-muted);
  font-size: 0.875rem;
}
.we-t1-brand-mark {
  padding: 0.35rem 0.6rem;
  border-radius: 0.7rem;
  background: var(--we-t1-green);
  font-weight: 700;
}
.we-t1-sidebar-note {
  margin-block: 1rem !important;
}
.we-t1-nav-group + .we-t1-nav-group {
  margin-top: 1rem;
}
.we-t1-nav-label {
  color: var(--we-t1-muted);
  font-size: 0.8rem;
  margin-bottom: 0.35rem !important;
}
.we-t1-nav-item,
.we-t1-button {
  max-width: 100%;
  padding: 0.55rem 0.75rem;
  color: var(--we-t1-ink);
  border: 1px solid var(--we-t1-line);
  border-radius: 0.6rem;
  background: var(--we-t1-surface);
  font: inherit;
  line-height: 1.4;
  text-align: left;
  white-space: normal;
  cursor: pointer;
}
.we-t1-nav-item {
  display: block;
  width: 100%;
  margin-top: 0.35rem;
}
.we-t1 [aria-current='page'],
.we-t1 [aria-pressed='true'] {
  background: var(--we-t1-green);
  border-color: var(--we-t1-focus);
  font-weight: 700;
}
.we-t1 button:hover:not(:disabled) {
  border-color: var(--we-t1-focus);
}
.we-t1 button:disabled {
  color: var(--we-t1-muted);
  border-style: dashed;
  cursor: not-allowed;
}
.we-t1 :focus-visible,
.we-t1-heading:focus,
.we-t1-closed:focus {
  outline: 2px solid var(--we-t1-focus);
  outline-offset: 3px;
}
.we-t1-main {
  min-width: 0;
}
.we-t1-header {
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1rem;
  border-bottom: 1px solid var(--we-t1-line);
}
.we-t1-header > div {
  min-width: 0;
}
.we-t1-header > button {
  flex: 0 0 auto;
}
.we-t1-content {
  display: grid;
  gap: 1rem;
  min-width: 0;
  padding: 1rem;
}
.we-t1-sandbox-banner,
.we-t1-card,
.we-t1-empty {
  min-width: 0;
  padding: 1rem;
  border: 1px solid var(--we-t1-line);
  border-radius: 0.8rem;
  background: var(--we-t1-surface);
}
.we-t1-sandbox-banner {
  background: var(--we-t1-green);
}
.we-t1-status-line,
.we-t1-segmented,
.we-t1-parameter-nav,
.we-t1-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.we-t1-badge {
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--we-t1-line);
  border-radius: 1rem;
  background: var(--we-t1-green);
  font-size: 0.8rem;
}
.we-t1-badge-draft {
  background: #fff1d4;
  color: #71511c;
}
.we-t1-table-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-block: 1rem;
}
.we-t1-table-groups > div {
  min-width: 0;
  padding: 0.75rem;
  border: 1px solid var(--we-t1-line);
  border-radius: 0.6rem;
}
.we-t1-regions {
  margin: 0.6rem 0;
  padding-left: 1.4rem;
}
.we-t1-regions li + li {
  margin-top: 0.3rem;
}
.we-t1-empty {
  text-align: center;
  border-style: dashed;
}
.we-t1-scope {
  margin-top: 0.5rem !important;
  font-weight: 700;
}
.we-t1-card > .we-t1-button {
  margin-top: 0.7rem;
}
.we-t1-blocked {
  margin-top: 0.8rem;
  padding: 0.75rem;
  border: 1px solid var(--we-t1-line);
  border-radius: 0.6rem;
  background: #f0f2eb;
}
.we-t1-blocked ul {
  margin: 0.4rem 0 0;
  padding-left: 1.2rem;
}
.we-t1-draft-description {
  margin-top: 0.75rem !important;
}
.we-t1-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: #273c3266;
}
.we-t1-confirm {
  width: min(100%, 32rem);
  padding: 1.25rem;
  border: 1px solid var(--we-t1-line);
  border-radius: 1rem;
  background: var(--we-t1-surface);
}
.we-t1-confirm-actions {
  margin-top: 1rem;
}
.we-t1-button-danger {
  color: var(--we-t1-danger-ink);
  background: var(--we-t1-danger);
  border-color: #dca5b6;
}
.we-t1-closed {
  padding: 1rem;
  border: 1px solid var(--we-t1-line);
  border-radius: 0.8rem;
  background: var(--we-t1-green);
}
@media (max-width: 42rem) {
  .we-t1 {
    grid-template-columns: minmax(0, 1fr);
  }
  .we-t1-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--we-t1-line);
  }
  .we-t1-nav-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  .we-t1-nav-label {
    width: 100%;
  }
  .we-t1-nav-item {
    width: auto;
    margin: 0;
  }
  .we-t1-table-groups {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
