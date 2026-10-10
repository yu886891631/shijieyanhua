<script setup lang="ts">
import { computed, nextTick, ref, useId, useSlots, watch } from 'vue';
import { T1_PAGE_ITEMS, type T1PageId } from './t1-ui-contract';
import { T14_BUILD, T14_DEFAULT, T14_THEMES, styleT14Appearance, type T14Appearance } from './t14-appearance';
const props = withDefaults(
  defineProps<{
    page?: T1PageId;
    version?: string;
    mode?: 'local' | 'host' | 'compatibility';
    dirtyLabels?: readonly string[];
    activity?: string;
    initialAppearance?: T14Appearance;
  }>(),
  {
    page: 'overview',
    version: T14_BUILD,
    mode: 'local',
    dirtyLabels: () => [],
    activity: '没有活动运行',
    initialAppearance: () => ({ ...T14_DEFAULT }),
  },
);
const emit = defineEmits<{ 'update:page': [page: T1PageId]; close: []; appearance: [value: T14Appearance] }>();
const slots = useSlots(),
  id = useId(),
  current = ref<T1PageId>(props.page);
const appearance = ref<T14Appearance>({ ...(props.initialAppearance ?? T14_DEFAULT) }),
  pendingClose = ref(false),
  keptClosed = ref(false);
const heading = ref<HTMLElement>(),
  stay = ref<HTMLButtonElement>(),
  closeButton = ref<HTMLButtonElement>();
const item = computed(() => T1_PAGE_ITEMS.find(p => p.id === current.value)!);
const styles = computed(() => styleT14Appearance(appearance.value));
watch(
  () => props.page,
  v => {
    current.value = v;
  },
);
watch(appearance, v => emit('appearance', { ...v }), { deep: true });
async function navigate(page: T1PageId) {
  current.value = page;
  emit('update:page', page);
  await nextTick();
  heading.value?.focus();
}
async function requestClose() {
  if (props.dirtyLabels.length) {
    pendingClose.value = true;
    await nextTick();
    stay.value?.focus();
  } else finishClose();
}
function finishClose() {
  pendingClose.value = false;
  keptClosed.value = true;
  emit('close'); // No controller is closed, cancelled, saved or discarded by this presentation component.
}
async function stayHere() {
  pendingClose.value = false;
  await nextTick();
  closeButton.value?.focus();
}
</script>

<template>
  <section
    class="we-t14"
    :style="styles"
    :data-theme="appearance.theme"
    :data-scale="appearance.scale"
    :data-density="appearance.density"
    :data-text="appearance.text"
    aria-label="世界演变统一工作台"
  >
    <header class="we14-header">
      <div>
        <p class="we14-eyebrow">WORLD EVOLUTION · {{ version }}</p>
        <h1>世界演变</h1>
        <p class="we14-muted">宏观条件 → 微观行动 → 统一保存 → 世界书投影</p>
      </div>
      <div class="we14-header-actions">
        <span class="we14-badge">{{
          mode === 'local'
            ? '本地隔离预览'
            : mode === 'compatibility'
              ? '单活动页面兼容 · 非原子保存'
              : '宿主模式 · 按已验证权限操作'
        }}</span
        ><button ref="closeButton" type="button" @click="requestClose">关闭工作台</button>
      </div>
    </header>
    <div v-if="keptClosed" class="we14-notice" role="status">
      已请求关闭；此组件不保存或丢弃草稿、不取消后台运行。外层若卸载或刷新，未保存草稿可能丢失。
    </div>
    <section
      v-if="pendingClose"
      class="we14-danger we14-close-confirm"
      role="region"
      :aria-labelledby="`${id}-close-title`"
      @keydown.esc.stop="stayHere"
    >
      <h2 :id="`${id}-close-title`">还有未保存的内容</h2>
      <ul>
        <li v-for="label in dirtyLabels" :key="label">{{ label }}</li>
      </ul>
      <p>切页会保留内存草稿；关闭后若外层卸载、脚本重载或刷新，草稿可能丢失。关闭不会自动保存或取消运行。</p>
      <div class="we14-actions">
        <button ref="stay" type="button" @click="stayHere">留在工作台</button
        ><button type="button" class="we14-danger" @click="finishClose">我知道尚未保存，仍请求关闭</button>
      </div>
    </section>
    <div class="we14-body">
      <nav class="we14-navigation" aria-label="工作台主页面">
        <section v-for="group in ['工作台', '演变配置', '设置']" :key="group">
          <h2>{{ group }}</h2>
          <button
            v-for="link in T1_PAGE_ITEMS.filter(p => p.group === group)"
            :key="link.id"
            type="button"
            :aria-current="current === link.id ? 'page' : undefined"
            @click="navigate(link.id)"
          >
            <span>{{ link.label }}</span
            ><small>{{ link.description }}</small>
          </button>
        </section>
      </nav>
      <main class="we14-content" :aria-labelledby="`${id}-page-title`" tabindex="0">
        <header class="we14-page-heading">
          <p class="we14-eyebrow">{{ item.group }}</p>
          <h2 :id="`${id}-page-title`" ref="heading" tabindex="-1">{{ item.label }}</h2>
          <p>{{ item.description }}</p>
        </header>
        <p v-if="dirtyLabels.length" class="we14-warning" role="status">
          尚未保存：{{ dirtyLabels.join('、') }}。切页不自动保存；刷新或卸载前请回到对应页面处理。
        </p>
        <!-- All slots stay mounted: navigation never throws away editors or owns a running task. -->
        <div
          v-for="link in T1_PAGE_ITEMS.filter(p => p.id !== 'appearance')"
          v-show="current === link.id"
          :key="link.id"
          class="we14-page"
          :data-page="link.id"
        >
          <slot :name="link.id"
            ><section class="we14-empty">
              <h3>{{ link.label }}尚未接入</h3>
              <p>本次外观工作台不会伪造保存或调用接口。统一宿主接线由 T15 完成。</p>
            </section></slot
          >
        </div>
        <section v-show="current === 'appearance'" class="we14-appearance">
          <section class="we14-card">
            <h3>主题与语义色</h3>
            <p>普通区域使用柔和底色；成功、等待和危险同时保留文字提示，不仅靠颜色判断。</p>
            <div class="we14-theme-grid">
              <button
                v-for="theme in T14_THEMES"
                :key="theme.id"
                type="button"
                :aria-pressed="appearance.theme === theme.id"
                @click="appearance.theme = theme.id"
              >
                {{ theme.name }}<small>{{ appearance.theme === theme.id ? '当前主题' : '切换预览' }}</small>
              </button>
            </div>
          </section>
          <section class="we14-card">
            <h3>阅读与表格密度</h3>
            <div class="we14-options">
              <label
                >界面字号<select v-model="appearance.scale">
                  <option :value="100">100%</option>
                  <option :value="110">110%</option>
                  <option :value="125">125%</option>
                </select></label
              ><label
                >留白与密度<select v-model="appearance.density">
                  <option value="comfortable">舒适</option>
                  <option value="compact">紧凑</option>
                </select></label
              ><label
                >长字段显示<select v-model="appearance.text">
                  <option value="bounded">限制单元格高度，可内部滚动</option>
                  <option value="wrap">完整换行展开</option>
                </select></label
              >
            </div>
            <p>这是界面字号，不是浏览器缩放。只影响显示，不改字段、权限、上下文或保存结果。</p>
            <button type="button" @click="appearance = { ...T14_DEFAULT }">恢复默认外观</button>
          </section>
          <section class="we14-card">
            <h3>状态示例</h3>
            <p class="we14-notice">普通：当前资料已载入，未执行任何操作。</p>
            <p class="we14-success">成功：只有服务确认保存后，业务页面才会显示已保存。</p>
            <p class="we14-warning">等待 / 警告：尚未确认；不要重复发送或误当成功。</p>
            <p class="we14-danger">危险：恢复、替换或清空需先预览范围并明确确认。</p>
            <p>键盘 Tab 可遍历按钮、字段和滚动区；Enter / Space 操作原生控件。宽表可聚焦后左右滚动。</p>
          </section>
          <p class="we14-muted">
            外观仅保留于当前挂载实例，不写聊天或全局设置；卸载/刷新后恢复默认。T15 再对接既有显示设置。
          </p>
        </section>
      </main>
    </div>
    <footer class="we14-footer">
      <span>{{ activity }}</span
      ><span
        >{{ dirtyLabels.length ? '有未保存内容' : '草稿状态由各页面提供' }} ·
        {{ slots[current] || current === 'appearance' ? '页面已接入' : '等待宿主接线' }}</span
      >
    </footer>
  </section>
</template>

<style scoped>
.we-t14 {
  color-scheme: light;
  font:
    var(--we14-font-size)/1.65 system-ui,
    'Microsoft YaHei',
    sans-serif;
  color: var(--we14-text);
  background: var(--we14-surface);
  border: 1px solid var(--we14-border);
  border-radius: 20px;
  width: 100%;
  max-width: 1280px;
  margin-inline: auto;
  min-width: 0;
  overflow-wrap: anywhere;
  container: we14 / inline-size;
}
.we-t14[data-theme='dark'] {
  color-scheme: dark;
}
.we-t14 :deep(*),
.we-t14 :deep(*::before),
.we-t14 :deep(*::after) {
  box-sizing: border-box;
}
.we14-header,
.we14-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: var(--we14-space) 24px;
  background: var(--we14-card);
}
.we14-header {
  border-radius: 20px 20px 0 0;
  border-bottom: 1px solid var(--we14-border);
}
.we14-header > div {
  min-width: 0;
}
.we14-header h1 {
  font-size: 1.65em;
  margin: 0;
}
.we14-header-actions,
.we14-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.we14-eyebrow {
  letter-spacing: 0.08em;
  font-size: 0.8em;
  font-weight: 700;
  color: var(--we14-muted);
  margin: 0;
}
.we14-muted {
  color: var(--we14-muted);
}
.we14-body {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  min-width: 0;
}
.we14-navigation {
  padding: var(--we14-space);
  background: var(--we14-soft);
  border-right: 1px solid var(--we14-border);
  max-block-size: var(--we14-content-height, 620px);
  overflow: auto;
}
.we14-navigation h2 {
  font-size: 0.85em;
  color: var(--we14-muted);
  margin: 14px 0 8px;
}
.we14-navigation button {
  display: block;
  width: 100%;
  text-align: left;
  margin: 6px 0;
}
.we14-navigation small {
  display: block;
  font-size: 0.8em;
  font-weight: 400;
  margin-top: 4px;
}
.we14-content {
  min-width: 0;
  padding: clamp(12px, 2.5%, 24px);
  max-block-size: var(--we14-content-height, 620px);
  overflow: auto;
  overscroll-behavior: contain;
  scroll-padding: 18px;
}
.we14-page,
.we14-appearance {
  min-width: 0;
}
.we14-page-heading {
  margin-bottom: 18px;
  border-bottom: 1px solid var(--we14-border);
  padding-bottom: 12px;
}
.we14-page-heading h2 {
  font-size: 1.4em;
  margin: 4px 0;
}
.we14-page-heading p {
  margin: 4px 0;
}
.we14-footer {
  border-top: 1px solid var(--we14-border);
  border-radius: 0 0 20px 20px;
  color: var(--we14-muted);
  font-size: 0.88em;
}
.we14-card,
.we14-empty {
  border: 1px solid var(--we14-border);
  padding: var(--we14-space);
  border-radius: 12px;
  background: var(--we14-card);
  margin: 12px 0;
  min-width: 0;
}
.we14-empty {
  border-style: dashed;
}
.we14-theme-grid,
.we14-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.we14-theme-grid button {
  text-align: left;
}
.we14-theme-grid small {
  display: block;
  font-weight: 400;
}
.we14-options label {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.we-t14 :deep(button),
.we-t14 :deep(input),
.we-t14 :deep(select),
.we-t14 :deep(textarea) {
  font: inherit;
  max-width: 100%;
  min-width: 0;
}
.we-t14 button,
.we14-options select {
  color: var(--we14-text);
  background: var(--we14-control);
  border: 1px solid var(--we14-border);
  border-radius: 9px;
  padding: 8px 12px;
  min-height: 40px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.we-t14 :deep(button) {
  min-height: 40px;
}
.we-t14 :deep(button) {
  cursor: pointer;
}
.we-t14 :deep(button:hover:not(:disabled)) {
  box-shadow: inset 0 0 0 1px var(--we14-accent);
}
.we14-navigation button[aria-current='page'],
.we14-theme-grid button[aria-pressed='true'] {
  background: var(--we14-accent);
  color: var(--we14-on-accent);
  border-color: var(--we14-accent);
  font-weight: 600;
}
.we-t14 :deep(:disabled) {
  cursor: not-allowed;
  opacity: 0.68;
}
.we-t14 :deep(:focus-visible) {
  outline: 3px solid var(--we14-focus);
  outline-offset: 3px;
}
.we-t14 :deep([tabindex='-1']:focus) {
  outline-offset: 4px;
}
.we14-badge {
  padding: 4px 9px;
  border: 1px solid var(--we14-border);
  border-radius: 8px;
  background: var(--we14-soft);
}
.we14-notice,
.we14-success,
.we14-warning,
.we14-danger,
.we-t14 button.we14-danger {
  padding: 12px;
  border: 1px solid var(--we14-border);
  border-radius: 10px;
}
.we14-notice {
  background: var(--we14-soft);
}
.we14-success {
  color: var(--we14-success-text);
  background: var(--we14-success-bg);
}
.we14-warning {
  color: var(--we14-warning-text);
  background: var(--we14-warning-bg);
  border-color: var(--we14-warning-border);
}
.we14-danger,
.we-t14 button.we14-danger {
  color: var(--we14-danger-text);
  background: var(--we14-danger-bg);
  border-color: var(--we14-danger-border);
}
.we14-close-confirm {
  margin: 12px;
}
.we-t14 :deep(table) {
  font-size: 0.92em;
}
.we-t14 :deep(small) {
  font-size: 0.87em;
}
.we-t14 :deep(th),
.we-t14 :deep(td) {
  padding: var(--we14-cell-space);
}
.we-t14 :deep(pre) {
  font-size: 0.92em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.we-t14 :deep(.we-t5),
.we-t14 :deep(.we-t6-workbench),
.we-t14 :deep(.we-t7-prompts),
.we-t14 :deep(.we-t11),
.we-t14 :deep(.t12-workbench),
.we-t14 :deep(.we-t13) {
  font: inherit;
  padding: 0;
  border: 0;
  border-radius: 0;
}
.we-t14[data-text='wrap'] :deep(.we-t5 td span) {
  max-height: none;
  overflow: visible;
}
/* Existing API presentation is injected, never imported here (its setup reads stored credentials). */
.we-t14 :deep(.we-api-page),
.we-t14 :deep(.we-api-page .we-card),
.we-t14 :deep(.we-api-page input),
.we-t14 :deep(.we-api-page select) {
  color: var(--we14-text);
  background: var(--we14-card);
  border-color: var(--we14-border);
}
.we-t14 :deep(.we-api-page input),
.we-t14 :deep(.we-api-page select) {
  background: var(--we14-control);
}
.we-t14 :deep(.we-api-page .we-btn-danger) {
  color: var(--we14-danger-text);
  background: var(--we14-danger-bg);
  border-color: var(--we14-danger-border);
}
@container we14 (max-width: 950px) {
  .we14-body {
    grid-template-columns: 170px minmax(0, 1fr);
  }
  .we14-navigation small {
    display: none;
  }
  .we-t14 :deep(.we-t5__layout),
  .we-t14 :deep(.we-t6-workbench .layout),
  .we-t14 :deep(.we-t7-columns),
  .we-t14 :deep(.columns),
  .we-t14 :deep(.t12-workbench .cards) {
    grid-template-columns: minmax(0, 1fr);
  }
  .we-t14 :deep(.we-t5__nav) {
    position: static;
  }
}
@container we14 (max-width: 720px) {
  .we14-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .we14-navigation {
    max-block-size: 200px;
    border-right: 0;
    border-bottom: 1px solid var(--we14-border);
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .we14-navigation section {
    flex: 1 1 160px;
    min-width: 0;
  }
  .we14-header,
  .we14-footer {
    padding: 12px;
  }
  .we14-theme-grid,
  .we14-options {
    grid-template-columns: minmax(0, 1fr);
  }
  .we-t14 :deep(.we-t5__form-grid),
  .we-t14 :deep(.we-t5 dd),
  .we-t14 :deep(.stats) {
    grid-template-columns: minmax(0, 1fr);
  }
  .we-t14 :deep(.we-t5__field--wide) {
    grid-column: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .we-t14 :deep(*) {
    scroll-behavior: auto;
  }
}
@media (forced-colors: active) {
  .we-t14 :deep(:focus-visible) {
    outline-color: Highlight;
  }
  .we-t14 :deep(button[aria-current='page']) {
    border: 3px solid Highlight;
  }
}
</style>
