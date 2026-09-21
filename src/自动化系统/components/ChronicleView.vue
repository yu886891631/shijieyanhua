<template>
  <div
    class="chronicle-container"
    :class="{ 'menu-open': expanded && themeMenuOpen }"
    :style="{ '--chronicle-font-scale': String(fontScale), fontSize: `calc(16px * ${fontScale})` }"
  >
    <div class="chronicle-header" @click="onHeaderClick">
      <div class="header-icon-group">
        <span class="header-icon-main">🎭</span>
      </div>
      <div class="header-title-area">
        <div class="header-title">角色动态观测</div>
      </div>
      <div class="header-controls">
        <span class="toggle-badge">{{ expanded ? '收起' : '展开' }}</span>
        <span class="header-caret" :style="{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }">
          ▼
        </span>
        <button
          type="button"
          class="font-btn"
          title="减小字号"
          :disabled="fontScale <= FONT_MIN"
          @click.stop="$emit('font-smaller')"
        >
          A−
        </button>
        <button
          type="button"
          class="font-btn"
          title="增大字号"
          :disabled="fontScale >= FONT_MAX"
          @click.stop="$emit('font-larger')"
        >
          A+
        </button>
        <div ref="themeWrapRef" class="theme-wrap">
          <div
            v-if="!expanded && themeMenuOpen"
            class="theme-dots"
            role="listbox"
            aria-label="选择主题"
          >
            <button
              v-for="opt in THEME_OPTIONS"
              :key="opt.id"
              type="button"
              class="theme-dot"
              role="option"
              :class="{ active: opt.id === themeId }"
              :title="opt.label"
              :aria-selected="opt.id === themeId"
              :style="{ background: opt.swatch }"
              @click.stop="selectTheme(opt.id)"
            />
          </div>
          <button
            type="button"
            class="theme-btn"
            title="选择主题"
            :aria-expanded="themeMenuOpen"
            aria-haspopup="listbox"
            @click.stop="toggleThemeMenu"
          >
            {{ currentTheme.icon }}
          </button>
          <div
            v-if="expanded && themeMenuOpen"
            class="theme-menu"
            role="listbox"
            aria-label="主题列表"
          >
            <button
              v-for="opt in THEME_OPTIONS"
              :key="opt.id"
              type="button"
              class="theme-menu-item"
              role="option"
              :aria-selected="opt.id === themeId"
              :class="{ active: opt.id === themeId }"
              @click.stop="selectTheme(opt.id)"
            >
              <span class="theme-swatch" :style="{ background: opt.swatch }" />
              <span class="theme-menu-label">{{ opt.label }}</span>
              <span v-if="opt.id === themeId" class="theme-check">✓</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="chronicle-body" :class="{ expanded }">
      <div class="chronicle-inner">
        <template v-if="hasContent">
          <CategoryPanel v-for="sec in data.sections" :key="sec.key" :section="sec" />
          <InteractionPanel :interactions="data.interactions" />
        </template>
        <div v-else class="empty-hint">📭 暂无角色动态数据</div>
      </div>
      <div class="footer-line">✧ 角色观测终端 ✧</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChronicleData } from '../types';
import { THEME_OPTIONS, themeOption, type ChronicleThemeId } from '../themes';
import CategoryPanel from './CategoryPanel.vue';
import InteractionPanel from './InteractionPanel.vue';

const FONT_MIN = 0.85;
const FONT_MAX = 1.25;

const props = defineProps<{
  data: ChronicleData;
  themeId: ChronicleThemeId;
  fontScale: number;
  defaultExpanded?: boolean;
}>();

const emit = defineEmits<{
  'set-theme': [id: ChronicleThemeId];
  'font-smaller': [];
  'font-larger': [];
}>();

const expanded = ref(props.defaultExpanded ?? false);
const themeMenuOpen = ref(false);
const themeWrapRef = ref<HTMLElement | null>(null);

const currentTheme = computed(() => themeOption(props.themeId));

const hasContent = computed(
  () =>
    props.data.sections.some(s => s.npcs.length > 0) || props.data.interactions.length > 0,
);

function toggleThemeMenu() {
  themeMenuOpen.value = !themeMenuOpen.value;
}

function selectTheme(id: ChronicleThemeId) {
  emit('set-theme', id);
  if (expanded.value) themeMenuOpen.value = false;
}

function closeThemeMenu() {
  themeMenuOpen.value = false;
}

function onHeaderClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('.theme-wrap, .font-btn')) return;
  if (themeMenuOpen.value) {
    closeThemeMenu();
    return;
  }
  expanded.value = !expanded.value;
}

function onDocPointerDown(e: PointerEvent) {
  if (!themeMenuOpen.value) return;
  const root = themeWrapRef.value;
  if (root && e.target instanceof Node && root.contains(e.target)) return;
  closeThemeMenu();
}

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && themeMenuOpen.value) closeThemeMenu();
}

watch(expanded, () => {
  closeThemeMenu();
});

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('keydown', onDocKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  document.removeEventListener('keydown', onDocKeydown);
});
</script>

<style lang="scss" scoped>
.chronicle-container {
  --chronicle-font-scale: 1;
  background: var(--bg-deep);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-glow);
  box-shadow: var(--glow-soft), 0 0 0 1px var(--border-inner) inset;
  font-family: var(--font-body);
  color: var(--text-primary);
  margin: 0;
  position: relative;
  overflow: hidden;
  max-width: 100%;
  transition: border-color var(--transition-smooth), box-shadow var(--transition-smooth);

  &.menu-open {
    overflow: visible;
  }

  &::before {
    content: '';
    position: absolute;
    inset: 4px;
    border: 1px solid var(--border-inner);
    border-radius: calc(var(--radius-xl) - 3px);
    pointer-events: none;
    z-index: 1;
  }
}

.chronicle-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: var(--bg-header);
  border-bottom: 1px solid var(--border-header);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  cursor: pointer;
  user-select: none;
  position: relative;
  z-index: 3;
  gap: 6px;
  min-height: var(--touch-min);
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transition-smooth);

  &:hover {
    background: var(--bg-header-hover);
  }
}

.header-icon-group {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.header-icon-main {
  font-size: 1em;
  line-height: 1;
}

.header-title-area {
  flex: 1;
  min-width: 0;
}

.header-title {
  font-family: var(--font-display);
  font-size: 0.88em;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: var(--text-header);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.toggle-badge {
  font-size: 0.55em;
  font-family: var(--font-mono);
  background: var(--bg-chip);
  color: var(--text-header-muted);
  padding: 2px 6px;
  border-radius: 8px;
  letter-spacing: 0.4px;
  border: 1px solid var(--border-subtle);
  white-space: nowrap;
}

.header-caret {
  font-size: 0.7em;
  color: var(--accent-lavender);
  transition: transform 0.35s ease;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-control);
  border: 1px solid var(--border-subtle);
}

.theme-wrap {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-dots {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}

.theme-dot {
  width: 13px;
  height: 13px;
  padding: 0;
  margin: 0;
  border-radius: 3px;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  flex-shrink: 0;
  box-sizing: border-box;
  transition: outline-color 0.15s, border-color 0.15s, transform 0.15s;

  &:hover {
    transform: scale(1.12);
    border-color: var(--accent-lavender);
  }

  &.active {
    outline: 2px solid var(--accent-lavender);
    outline-offset: 1px;
    border-color: var(--accent-lavender);
  }
}

.theme-btn,
.font-btn {
  background: var(--bg-control);
  border: 1px solid var(--border-subtle);
  color: var(--accent-lavender);
  font-size: 0.8em;
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, border-color 0.2s;
  padding: 0;

  &:hover:not(:disabled) {
    background: var(--bg-step);
    border-color: var(--accent-lavender);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

.font-btn {
  border-radius: 8px;
  width: auto;
  min-width: 28px;
  padding: 0 6px;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.72em;
  letter-spacing: -0.02em;
}

.theme-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 148px;
  padding: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-md);
  box-shadow: var(--glow-soft), 0 8px 20px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.theme-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 7px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.72em;
  line-height: 1.2;
  cursor: pointer;
  text-align: left;

  &:hover,
  &.active {
    background: var(--bg-step);
  }
}

.theme-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.theme-menu-label {
  flex: 1;
  min-width: 0;
}

.theme-check {
  color: var(--accent-lavender);
  font-size: 0.9em;
  flex-shrink: 0;
}

.chronicle-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.5s cubic-bezier(0.33, 1, 0.68, 1);
  position: relative;
  z-index: 2;

  &.expanded {
    max-height: 20000px;
  }
}

.chronicle-inner {
  padding: var(--space-3) var(--space-4) var(--space-4);
}

.empty-hint {
  color: var(--text-muted);
  padding: var(--space-4);
  text-align: center;
  font-size: 0.78em;
}

.footer-line {
  text-align: center;
  font-size: 0.5em;
  color: var(--text-muted);
  border-top: 1px solid var(--border-subtle);
  margin-top: 2px;
  padding: 6px 0 8px;
  font-family: var(--font-mono);
  letter-spacing: 1.2px;
}

@media (max-width: 640px) {
  .chronicle-container {
    overflow-x: hidden;
  }

  .chronicle-container::before {
    inset: 3px;
  }

  .chronicle-inner {
    padding: var(--space-2) var(--space-3) var(--space-3);
  }

  .chronicle-header {
    padding: 6px 8px;
    gap: 5px;
    flex-wrap: wrap;
    row-gap: 6px;
    min-height: var(--touch-min);
    align-items: center;
  }

  .header-title-area {
    flex: 1 1 auto;
    min-width: 0;
  }

  .header-controls {
    flex-wrap: nowrap;
    row-gap: 0;
    margin-left: auto;
    justify-content: flex-end;
    gap: 4px;
  }

  .header-title {
    font-size: 0.82em;
  }

  .toggle-badge {
    display: none;
  }

  .header-caret,
  .theme-btn {
    width: var(--touch-min);
    height: var(--touch-min);
    font-size: 0.85em;
  }

  .theme-wrap:has(.theme-dots) {
    flex-basis: 100%;
    order: 20;
    justify-content: flex-end;
  }

  .theme-dots {
    gap: 6px;
  }

  .theme-dot {
    width: 16px;
    height: 16px;
    padding: 6px;
    box-sizing: content-box;
    background-clip: content-box;
  }

  .theme-menu {
    min-width: min(200px, 70vw);
  }

  .theme-menu-item {
    min-height: 40px;
    font-size: 0.78em;
    padding: 8px 10px;
  }

  .font-btn {
    min-height: var(--touch-min);
    min-width: var(--touch-min);
    font-size: 0.75em;
  }

  .header-icon-main {
    font-size: 0.95em;
  }

  .footer-line {
    padding: 5px 0 7px;
  }
}

@media (max-width: 380px) {
  .header-title {
    font-size: 0.78em;
    letter-spacing: 0.2px;
  }
}
</style>
