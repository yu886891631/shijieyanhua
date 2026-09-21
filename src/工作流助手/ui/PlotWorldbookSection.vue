<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { loadSettings } from '../settings';
import { resolveEffectiveSettings } from '../tasks/effective-settings';
import type { ChatWorldbookWriteRule, PlotWorldbookConfig } from '../tasks/schema';
import { shouldShowEntryInUi } from '../worldbook/blocked';
import {
  isStWorldbookEntryEnabled,
  sanitizePlotWorldbookEnabledUids,
  selectablePlotWorldbookEntryUids,
} from '../worldbook/plot-entry-select';

withDefaults(
  defineProps<{
    embedded?: boolean;
    title?: string;
  }>(),
  {
    embedded: false,
    title: '$1 默认世界书',
  },
);

const config = defineModel<PlotWorldbookConfig>('config', { required: true });

const bookFilter = ref('');
const entryFilter = ref('');
const loading = ref(false);
const writeRules = ref<ChatWorldbookWriteRule[]>([]);
const entryGroups = ref<
  {
    bookName: string;
    entries: { uid: number; label: string; checked: boolean; stDisabled: boolean }[];
  }[]
>([]);

function refreshWriteRules() {
  try {
    writeRules.value = resolveEffectiveSettings(loadSettings()).chatWorldbookWriteRules ?? [];
  } catch {
    writeRules.value = [];
  }
}

const cfg = computed(() => config.value);

const worldbookSource = computed({
  get: () => config.value.source,
  set: (value: 'character' | 'manual') => {
    config.value = { ...config.value, source: value };
  },
});

const characterBoundBooks = computed(() => {
  try {
    const charBooks = getCharWorldbookNames('current');
    return [charBooks.primary, ...charBooks.additional].filter((name): name is string => Boolean(name));
  } catch {
    return [] as string[];
  }
});

function loadBooks(): string[] {
  try {
    return getWorldbookNames();
  } catch (error) {
    console.error('[工作流助手] 获取世界书列表失败:', error);
    return [];
  }
}

const allBooks = ref<string[]>([]);

const filteredBooks = computed(() => {
  const q = bookFilter.value.trim().toLowerCase();
  return allBooks.value.filter(b => !q || b.toLowerCase().includes(q));
});

function toggleBook(name: string) {
  const list = [...config.value.manualSelection];
  const idx = list.indexOf(name);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(name);
  const next = { ...config.value, manualSelection: list };
  config.value = next;
  void refreshEntries({ manualSelection: list, source: 'manual' });
}

function enabledEntriesMapsEqual(
  a: Record<string, number[]>,
  b: Record<string, number[]>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = [...(a[key] ?? [])].sort((x, y) => x - y);
    const right = [...(b[key] ?? [])].sort((x, y) => x - y);
    if (left.length !== right.length || left.some((v, i) => v !== right[i])) return false;
  }
  return true;
}

async function refreshEntries(snapshot?: { manualSelection?: string[]; source?: PlotWorldbookConfig['source'] }) {
  loading.value = true;
  const activeSource = snapshot?.source ?? cfg.value.source;
  const activeManualSelection = snapshot?.manualSelection ?? [...cfg.value.manualSelection];
  const preservedSource = activeSource;
  const preservedManualSelection = [...activeManualSelection];
  try {
    let bookNames: string[] = [];
    if (activeSource === 'manual') {
      bookNames = [...activeManualSelection];
    } else {
      const charBooks = getCharWorldbookNames('current');
      if (charBooks.primary) bookNames.push(charBooks.primary);
      bookNames.push(...charBooks.additional);
    }
    bookNames = [...new Set(bookNames.filter(Boolean))];

    refreshWriteRules();
    const rules = writeRules.value;
    const groups: typeof entryGroups.value = [];
    const enabledEntries = { ...cfg.value.enabledEntries };
    const initialEnabledEntries = { ...cfg.value.enabledEntries };
    for (const bookName of bookNames) {
      let bookEntries: Awaited<ReturnType<typeof getWorldbook>>;
      try {
        bookEntries = await getWorldbook(bookName);
      } catch {
        console.warn('[工作流助手] 世界书不存在，已跳过条目加载:', bookName);
        continue;
      }
      const selectableUids = selectablePlotWorldbookEntryUids(bookEntries, rules);
      if (enabledEntries[bookName] === undefined) {
        enabledEntries[bookName] = selectableUids;
      } else {
        const prev = enabledEntries[bookName] ?? [];
        const sanitized = sanitizePlotWorldbookEnabledUids(bookEntries, prev, rules);
        const prevKey = [...prev].sort((a, b) => a - b).join(',');
        const sanitizedKey = [...sanitized].sort((a, b) => a - b).join(',');
        if (prevKey !== sanitizedKey) {
          enabledEntries[bookName] = sanitized;
        }
      }
      const enabled = enabledEntries[bookName] ?? [];
      const visible = bookEntries
        .filter(entry => shouldShowEntryInUi({ name: entry.name }, rules))
        .map(entry => ({
          uid: entry.uid,
          label: entry.name || `条目 ${entry.uid}`,
          checked: enabled.includes(entry.uid),
          stDisabled: !isStWorldbookEntryEnabled(entry),
        }));
      if (visible.length) groups.push({ bookName, entries: visible });
    }
    if (!enabledEntriesMapsEqual(initialEnabledEntries, enabledEntries)) {
      config.value = {
        ...config.value,
        source: preservedSource,
        manualSelection: preservedManualSelection,
        enabledEntries,
      };
    }
    entryGroups.value = groups;
  } finally {
    loading.value = false;
  }
}

function toggleEntry(bookName: string, uid: number, checked: boolean) {
  const list = [...(cfg.value.enabledEntries[bookName] ?? [])];
  if (checked) {
    if (!list.includes(uid)) list.push(uid);
  } else {
    const i = list.indexOf(uid);
    if (i >= 0) list.splice(i, 1);
  }
  config.value = {
    ...config.value,
    enabledEntries: { ...config.value.enabledEntries, [bookName]: list },
  };
}

function selectAllEntries(select: boolean) {
  const next = { ...cfg.value.enabledEntries };
  for (const g of entryGroups.value) {
    next[g.bookName] = select
      ? g.entries.filter(e => !e.stDisabled).map(e => e.uid)
      : [];
    for (const e of g.entries) e.checked = select && !e.stDisabled;
  }
  config.value = { ...config.value, enabledEntries: next };
}

const filteredGroups = computed(() => {
  const q = entryFilter.value.trim().toLowerCase();
  if (!q) return entryGroups.value;
  return entryGroups.value
    .map(g => ({
      ...g,
      entries: g.entries.filter(
        e => e.label.toLowerCase().includes(q) || g.bookName.toLowerCase().includes(q),
      ),
    }))
    .filter(g => g.entries.length > 0);
});

watch(
  () => cfg.value.source,
  source => {
    if (source === 'manual') void refreshBookList();
    void refreshEntries();
  },
);

async function refreshBookList() {
  allBooks.value = loadBooks();
}

onMounted(async () => {
  refreshWriteRules();
  if (cfg.value.source === 'manual') await refreshBookList();
  await refreshEntries();
});
</script>

<template>
  <div :class="embedded ? 'acu-subsection acu-plot-worldbook-embedded' : 'acu-section'">
    <template v-if="!embedded">
      <h4>{{ title }}</h4>
      <p class="acu-notes">任务未自定义 $1 世界书时，含 $1 占位符的任务使用此配置。不影响数据库插件填表/读取世界书的选择。</p>
    </template>
    <div class="acu-row acu-row--inline">
      <label><input v-model="worldbookSource" type="radio" value="character" /> 角色卡绑定</label>
      <label><input v-model="worldbookSource" type="radio" value="manual" /> 手动选择</label>
    </div>
    <p v-if="cfg.source === 'character'" class="acu-notes">
      当前角色绑定世界书：{{ characterBoundBooks.length ? characterBoundBooks.join('、') : '（无）' }}
    </p>
    <div v-if="cfg.source === 'manual'" class="acu-row">
      <input v-model="bookFilter" class="acu-input" placeholder="筛选世界书..." style="flex: 1" />
      <button class="acu-btn" type="button" @click="refreshBookList">刷新</button>
    </div>
    <div v-if="cfg.source === 'manual'" class="qrf_worldbook_list">
      <div v-if="filteredBooks.length === 0" class="qrf_worldbook_list_item acu-notes">暂无世界书，请点击「刷新」</div>
      <div
        v-for="book in filteredBooks"
        :key="book"
        class="qrf_worldbook_list_item"
        :class="{ selected: cfg.manualSelection.includes(book) }"
        @click="toggleBook(book)"
      >
        {{ book }}
      </div>
    </div>
    <div class="acu-row acu-row--btn-grid" style="margin-top: 12px">
      <strong>启用的世界书条目</strong>
      <button class="acu-btn" type="button" @click="selectAllEntries(true)">全选</button>
      <button class="acu-btn" type="button" @click="selectAllEntries(false)">全不选</button>
    </div>
    <p class="acu-notes acu-notes--sm" style="margin: 0 0 8px">
      划线表示该条目在酒馆世界书设置中未启用；仍可勾选以供本助手 $1 使用，不会改写酒馆设置。全选默认只勾选酒馆已启用的条目。
    </p>
    <input v-model="entryFilter" class="acu-input" placeholder="筛选条目/世界书..." style="width: 100%; margin-bottom: 8px" />
    <div v-if="loading" class="acu-notes">加载中...</div>
    <div v-else class="qrf_worldbook_entry_list">
      <div v-for="group in filteredGroups" :key="group.bookName">
        <div class="wb-group-title">{{ group.bookName }}</div>
        <label
          v-for="entry in group.entries"
          :key="entry.uid"
          class="acu-row acu-row--inline qrf_worldbook_entry_row"
          :class="{ 'qrf_worldbook_entry_row--st-disabled': entry.stDisabled }"
        >
          <input
            type="checkbox"
            class="qrf_worldbook_entry_cb qrf_worldbook_entry_cb--active"
            :checked="(cfg.enabledEntries[group.bookName] ?? []).includes(entry.uid)"
            @change="toggleEntry(group.bookName, entry.uid, ($event.target as HTMLInputElement).checked)"
          />
          <span
            class="qrf_worldbook_entry_label"
            :class="{ 'qrf_worldbook_entry_label--st-disabled': entry.stDisabled }"
          >{{ entry.label }}</span>
        </label>
      </div>
    </div>
  </div>
</template>
