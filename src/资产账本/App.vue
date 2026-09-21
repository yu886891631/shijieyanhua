<template>
  <div class="ledger-root" :class="{ 'theme-dark': themeDark }">
    <div v-if="loading" class="app-hint">读取账本变量…</div>
    <div v-else-if="empty" class="app-hint">
      本层暂无 <code>post_process_tags.LedgerTime</code> /
      <code>post_process_tags.资产账本</code>
    </div>
    <LedgerView
      v-else
      :data="ledger!"
      :forced-open="forcedOpen"
      :theme-dark="themeDark"
      @expand-all="expandAll"
      @collapse-all="collapseAll"
      @toggle-theme="toggleTheme"
    />
  </div>
</template>

<script setup lang="ts">
import { toSimplified } from 'chinese-simple2traditional';
import 'chinese-simple2traditional/enhance';
import './theme.scss';
import LedgerView from './components/LedgerView.vue';
import { isLedgerEmpty, parseLedger } from './parse';
import type { LedgerData } from './types';

const THEME_KEY = 'ledgerTheme';
const LEDGER_BODY_KEY = '资产账本';

const loading = ref(true);
const empty = ref(false);
const ledger = ref<LedgerData | null>(null);
const forcedOpen = ref<boolean | null>(null);
const themeDark = ref(false);

async function expandAll() {
  forcedOpen.value = true;
  await nextTick();
  forcedOpen.value = null;
}

async function collapseAll() {
  forcedOpen.value = false;
  await nextTick();
  forcedOpen.value = null;
}

function toggleTheme() {
  themeDark.value = !themeDark.value;
  try {
    localStorage.setItem(THEME_KEY, themeDark.value ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
}

function normalizeTagKey(key: string): string {
  return toSimplified(key, true).replace(/帐本/g, '账本');
}

/** 读账本正文：优先简体键，兼容繁体/异体键名 */
function readLedgerBody(tags: Record<string, unknown>): string {
  const direct = tags[LEDGER_BODY_KEY] ?? tags['資產帳本'] ?? tags['资产帐本'];
  if (direct != null && String(direct).trim()) return String(direct).trim();
  for (const [key, value] of Object.entries(tags)) {
    if (normalizeTagKey(key) === LEDGER_BODY_KEY && value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function readTags(): { time: string; body: string } {
  try {
    const message_id = getCurrentMessageId();
    const vars = getVariables({ type: 'message', message_id }) ?? {};
    const tags = (vars.post_process_tags ?? {}) as Record<string, unknown>;
    return {
      time: String(tags.LedgerTime ?? '').trim(),
      body: readLedgerBody(tags),
    };
  } catch {
    return { time: '', body: '' };
  }
}

function load() {
  const { time, body } = readTags();
  if (!time && !body) {
    empty.value = true;
    ledger.value = null;
    loading.value = false;
    return;
  }
  const data = parseLedger(time, body);
  empty.value = isLedgerEmpty(data);
  ledger.value = data;
  loading.value = false;
}

onMounted(() => {
  try {
    themeDark.value = localStorage.getItem(THEME_KEY) === 'dark';
  } catch {
    themeDark.value = false;
  }

  load();
  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    const { time, body } = readTags();
    if (time || body) {
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
  padding: 0.85em 1em;
  color: var(--text-tertiary);
  background: var(--bg-card);
  border: 1px dashed var(--border-card);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;

  code {
    font-size: 0.9em;
    color: var(--accent-primary);
  }
}
</style>
