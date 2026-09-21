<template>
  <div class="chronicle-root" :class="`theme-${themeId}`">
    <div v-if="loading" class="app-hint">读取角色动态变量…</div>
    <div v-else-if="empty" class="app-hint">
      本层暂无前台/后台角色名单、<code>post_process_tags.npc_act</code>
      或本楼运行快照中的 <code>&lt;交互&gt;</code> 预演
    </div>
    <ChronicleView
      v-else
      :data="chronicle!"
      :theme-id="themeId"
      :font-scale="fontScale"
      @set-theme="setTheme"
      @font-smaller="adjustFont(-FONT_STEP)"
      @font-larger="adjustFont(FONT_STEP)"
    />
  </div>
</template>

<script setup lang="ts">
import './theme.scss';
import ChronicleView from './components/ChronicleView.vue';
import { hasChronicleSource, loadChronicle } from './data';
import { isChronicleEmpty } from './parse';
import type { ChronicleData } from './types';
import { normalizeThemeId, type ChronicleThemeId } from './themes';

const THEME_KEY = 'chronicleTheme';
const FONT_KEY = 'chronicleFontScale';
const FONT_MIN = 0.85;
const FONT_MAX = 1.25;
const FONT_STEP = 0.05;

const loading = ref(true);
const empty = ref(false);
const chronicle = ref<ChronicleData | null>(null);
const themeId = ref<ChronicleThemeId>('dark');
const fontScale = ref(1);

function clampFont(n: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n * 100) / 100));
}

function persistFont(scale: number) {
  try {
    localStorage.setItem(FONT_KEY, String(scale));
  } catch {
    /* ignore */
  }
}

function adjustFont(delta: number) {
  fontScale.value = clampFont(fontScale.value + delta);
  persistFont(fontScale.value);
}

function setTheme(id: ChronicleThemeId) {
  const next = normalizeThemeId(id);
  themeId.value = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
}

function load() {
  try {
    if (!hasChronicleSource()) {
      empty.value = true;
      chronicle.value = null;
      loading.value = false;
      return;
    }
    const data = loadChronicle();
    empty.value = isChronicleEmpty(data);
    chronicle.value = data;
  } catch {
    empty.value = true;
    chronicle.value = null;
  }
  loading.value = false;
}

onMounted(() => {
  try {
    themeId.value = normalizeThemeId(localStorage.getItem(THEME_KEY));
  } catch {
    themeId.value = 'dark';
  }
  try {
    const raw = localStorage.getItem(FONT_KEY);
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n)) fontScale.value = clampFont(n);
    }
  } catch {
    fontScale.value = 1;
  }

  load();
  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    if (hasChronicleSource()) {
      load();
      window.clearInterval(timer);
      return;
    }
    if (tries >= 12) window.clearInterval(timer);
  }, 400);
});
</script>

<style lang="scss" scoped>
.app-hint {
  padding: 12px 14px;
  color: var(--text-muted, #888);
  font-size: 0.8rem;
  line-height: 1.5;

  code {
    font-size: 0.9em;
  }
}

@media (max-width: 640px) {
  .app-hint {
    padding: var(--space-4, 8px) var(--panel-pad-x, 8px);
    font-size: 0.75rem;
    color: var(--text-muted, #888);
    overflow-wrap: anywhere;
    word-break: break-word;

    code {
      display: inline;
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-all;
    }
  }
}
</style>
