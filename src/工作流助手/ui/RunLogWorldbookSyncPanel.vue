<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatCommaSeparatedList } from '../tasks/comma-separated';
import { useSettingsStore } from '../settings';
import { normalizeKeywordList } from '../worldbook/entry-keys';
import {
  applyRunLogWorldbookEdit,
  collectRunLogWorldbookRows,
  deleteRunLogWorldbookRow,
  type RunLogWorldbookRow,
} from '../worldbook/run-log-worldbook-sync';
import AcuHelpIconBtn from './AcuHelpIconBtn.vue';
import AcuHelpPanel from './AcuHelpPanel.vue';
import { acuToast } from './toast';

type RunLogWorldbookGroup = { targetTag: string; rows: RunLogWorldbookRow[] };

const store = useSettingsStore();
const { settings } = storeToRefs(store);

const rows = ref<RunLogWorldbookRow[]>([]);
const drafts = ref<Record<string, string>>({});
const extraKeyDrafts = ref<Record<string, string>>({});
const loading = ref(false);
const editMode = ref(false);
const busyRowKey = ref<string | null>(null);
const helpOpen = ref(false);

const messageId = computed(() => settings.value.lastRunStatus?.messageId ?? null);
const runAt = computed(() => settings.value.lastRunStatus?.at ?? null);
const rules = computed(() => settings.value.chatWorldbookWriteRules ?? []);

const totalRowCount = computed(() => rows.value.length);

const groupedRows = computed<RunLogWorldbookGroup[]>(() => {
  const map = new Map<string, RunLogWorldbookRow[]>();
  for (const row of rows.value) {
    const key = row.targetTag.trim() || '(未命名规则)';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([targetTag, groupRows]) => ({
      targetTag,
      rows: groupRows.sort((a, b) =>
        a.stableName.localeCompare(b.stableName, undefined, { numeric: true }),
      ),
    }));
});

const defaultGroupExpanded = computed(() => groupedRows.value.length === 1);

const summaryLabel = computed(() => {
  if (loading.value) return '条目列表 · 加载中…';
  if (totalRowCount.value) return `条目列表 · ${totalRowCount.value} 条`;
  return '条目列表 · 暂无条目';
});

function formatDefaultKeysHint(row: RunLogWorldbookRow): string {
  if (!row.defaultKeys.length) return '（无）';
  return row.defaultKeys.join('、');
}

function syncDraftsFromRows(nextRows: RunLogWorldbookRow[]): void {
  const nextContent: Record<string, string> = {};
  const nextExtra: Record<string, string> = {};
  for (const row of nextRows) {
    nextContent[row.rowKey] = row.content;
    nextExtra[row.rowKey] = formatCommaSeparatedList(row.extraKeys);
  }
  drafts.value = nextContent;
  extraKeyDrafts.value = nextExtra;
}

async function refreshRows(): Promise<void> {
  const floorId = messageId.value;
  if (floorId == null || !rules.value.length) {
    rows.value = [];
    drafts.value = {};
    extraKeyDrafts.value = {};
    return;
  }
  loading.value = true;
  try {
    const next = await collectRunLogWorldbookRows({ maxMessageId: floorId, rules: rules.value });
    rows.value = next;
    if (!editMode.value) syncDraftsFromRows(next);
  } catch (e) {
    console.error('[工作流助手] 加载世界书同步编辑列表失败:', e);
    acuToast('error', e instanceof Error ? e.message : String(e));
  } finally {
    loading.value = false;
  }
}

watch([messageId, runAt, rules], () => {
  editMode.value = false;
  void refreshRows();
}, { immediate: true, deep: true });

function isContentDirty(row: RunLogWorldbookRow): boolean {
  return String(drafts.value[row.rowKey] ?? '').trim() !== row.content.trim();
}

function isExtraKeysDirty(row: RunLogWorldbookRow): boolean {
  if (row.entryType !== 'keyword') return false;
  const draft = normalizeKeywordList(extraKeyDrafts.value[row.rowKey] ?? '');
  const saved = normalizeKeywordList(row.extraKeys);
  if (draft.length !== saved.length) return true;
  return draft.some((k, i) => k !== saved[i]);
}

function isRowDirty(row: RunLogWorldbookRow): boolean {
  return isContentDirty(row) || isExtraKeysDirty(row);
}

function hasDirtyDrafts(): boolean {
  return rows.value.some(row => isRowDirty(row));
}

function groupHasDirty(group: RunLogWorldbookGroup): boolean {
  return group.rows.some(row => isRowDirty(row));
}

function toggleEditMode(): void {
  if (editMode.value) {
    syncDraftsFromRows(rows.value);
    editMode.value = false;
  } else {
    editMode.value = true;
  }
}

async function saveRow(row: RunLogWorldbookRow): Promise<void> {
  const content = String(drafts.value[row.rowKey] ?? '').trim();
  if (!content) {
    acuToast('warning', '条目内容不能为空');
    return;
  }
  busyRowKey.value = row.rowKey;
  try {
    const extraKeys =
      row.entryType === 'keyword'
        ? normalizeKeywordList(extraKeyDrafts.value[row.rowKey] ?? '')
        : undefined;
    await applyRunLogWorldbookEdit(row, content, extraKeys);
    acuToast('success', `已同步「${row.stableName}」到世界书与标签变量`);
    await refreshRows();
  } catch (e) {
    acuToast('error', e instanceof Error ? e.message : String(e));
  } finally {
    busyRowKey.value = null;
  }
}

async function saveAllDirty(): Promise<void> {
  const dirty = rows.value.filter(row => isRowDirty(row));
  if (!dirty.length) {
    acuToast('info', '没有待保存的修改');
    return;
  }
  for (const row of dirty) {
    await saveRow(row);
  }
}

async function deleteRow(row: RunLogWorldbookRow): Promise<void> {
  if (!confirm(`确定删除世界书条目「${row.stableName}」？将同步移除标签变量与 applied 账本。`)) return;
  busyRowKey.value = row.rowKey;
  try {
    await deleteRunLogWorldbookRow(row);
    acuToast('success', `已删除「${row.stableName}」`);
    await refreshRows();
  } catch (e) {
    acuToast('error', e instanceof Error ? e.message : String(e));
  } finally {
    busyRowKey.value = null;
  }
}

function isRowBusy(row: RunLogWorldbookRow): boolean {
  return busyRowKey.value === row.rowKey;
}
</script>

<template>
  <details class="acu-run-log-wb-sync">
    <summary class="acu-run-log-wb-sync__summary acu-run-log-wb-sync__summary--root">
      <span>{{ summaryLabel }}</span>
      <span v-if="hasDirtyDrafts()" class="acu-run-log-wb-sync__dirty-dot" title="有未保存修改" />
    </summary>

    <div class="acu-run-log-wb-sync__panel">
      <div class="acu-run-log-wb-sync__head">
        <div class="acu-run-log-wb-sync__head-left">
          <span class="acu-run-log-label">有效条目</span>
          <span class="acu-notes">{{ totalRowCount }} 条</span>
          <span v-if="hasDirtyDrafts()" class="acu-notes acu-log-warn">· 有未保存修改</span>
        </div>
        <div class="acu-run-log-wb-sync__toolbar">
          <AcuHelpIconBtn
            v-model:open="helpOpen"
            panel-id="run-log-wb-sync-help"
            label="世界书同步编辑说明"
          />
          <button
            type="button"
            class="acu-btn acu-btn--sm acu-icon-btn"
            :class="{ 'acu-run-log-tags__edit--active': editMode }"
            :disabled="!rows.length || loading"
            :title="editMode ? '退出编辑' : '进入编辑'"
            @click="toggleEditMode"
          >
            <i class="fa-fw fa-solid fa-pencil" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="acu-btn acu-btn--sm"
            :class="{ 'acu-run-log-tags__save--dirty': hasDirtyDrafts() }"
            :disabled="!editMode || loading || !hasDirtyDrafts()"
            @click="saveAllDirty"
          >
            保存全部
          </button>
        </div>
      </div>

      <AcuHelpPanel
        v-model:open="helpOpen"
        id="run-log-wb-sync-help"
        label="世界书同步编辑说明"
      >
        <p class="acu-notes acu-notes--sm" style="margin: 0">
          列出截至当前运行楼仍有效的全部世界书写入条目（含未出现在「消息楼层标签变量注入」模板中的规则）。保存以世界书正文为准，并同步 owner 楼
          <code>post_process_tags</code> 对应 tag。绿灯条目可设置「额外关键词」，叠在默认关键词之上；额外词保存在 owner 楼 applied 账本中，同聊天再次写入会保留，换聊天不继承。
        </p>
      </AcuHelpPanel>

      <p class="acu-notes acu-notes--sm acu-run-log-wb-sync__hint">
        保存以世界书正文为准，并同步 owner 楼标签变量。绿灯条目的额外关键词随账本持久化。
      </p>

      <div v-if="messageId == null" class="acu-run-log-wb-sync__empty">
        <p class="acu-notes acu-notes--sm">暂无运行楼层，无法加载世界书条目。</p>
      </div>
      <div v-else-if="!rules.length" class="acu-run-log-wb-sync__empty">
        <p class="acu-notes acu-notes--sm">请先在「世界书与上下文」配置世界书写入规则。</p>
      </div>
      <div v-else-if="loading" class="acu-run-log-wb-sync__empty">
        <p class="acu-notes acu-notes--sm">加载中…</p>
      </div>
      <div v-else-if="!rows.length" class="acu-run-log-wb-sync__empty">
        <p class="acu-notes acu-notes--sm">截至楼层 #{{ messageId }} 暂无已注入的世界书条目。</p>
      </div>

      <div v-else class="acu-run-log-wb-sync__groups">
        <details
          v-for="group in groupedRows"
          :key="group.targetTag"
          class="acu-run-log-wb-sync__group"
          :open="defaultGroupExpanded"
        >
          <summary class="acu-run-log-wb-sync__summary acu-run-log-wb-sync__summary--group">
            <strong>规则 {{ group.targetTag }}</strong>
            <span class="acu-notes acu-run-log-wb-sync__meta">· {{ group.rows.length }} 条</span>
            <span v-if="groupHasDirty(group)" class="acu-run-log-wb-sync__dirty-dot" title="本组有未保存修改" />
          </summary>
          <div class="acu-run-log-wb-sync__group-body">
            <div v-for="row in group.rows" :key="row.rowKey" class="acu-run-log-wb-sync__entry">
              <div class="acu-run-log-wb-sync__entry-head">
                <strong class="acu-run-log-wb-sync__entry-title">{{ row.tagKey }}</strong>
                <div class="acu-run-log-wb-sync__entry-meta">
                  <span>世界书：{{ row.bookName }}</span>
                  <span class="acu-run-log-wb-sync__entry-meta-sep" aria-hidden="true">·</span>
                  <span>条目：{{ row.stableName }}</span>
                  <span class="acu-run-log-wb-sync__entry-meta-sep" aria-hidden="true">·</span>
                  <span>owner #{{ row.ownerMessageId }}</span>
                </div>
              </div>
              <textarea
                v-model="drafts[row.rowKey]"
                class="acu-textarea acu-run-log-wb-sync__input"
                :class="{ 'acu-run-log-tags__input--locked': !editMode }"
                :readonly="!editMode"
                rows="5"
              />
              <div v-if="row.entryType === 'keyword'" class="acu-run-log-wb-sync__keys">
                <div class="acu-notes acu-notes--sm acu-run-log-wb-sync__keys-default">
                  默认关键词：{{ formatDefaultKeysHint(row) }}
                </div>
                <label class="acu-run-log-wb-sync__keys-label">
                  <span class="acu-notes acu-notes--sm">额外关键词</span>
                  <input
                    v-model="extraKeyDrafts[row.rowKey]"
                    type="text"
                    class="acu-input acu-run-log-wb-sync__keys-input"
                    :class="{ 'acu-run-log-tags__input--locked': !editMode }"
                    :readonly="!editMode"
                    placeholder="逗号分隔，叠在默认关键词之上"
                  />
                </label>
              </div>
              <div class="acu-run-log-wb-sync__actions">
                <button
                  type="button"
                  class="acu-btn acu-btn--sm"
                  :class="{ 'acu-run-log-tags__save--dirty': isRowDirty(row) }"
                  :disabled="!editMode || isRowBusy(row) || !isRowDirty(row)"
                  @click="saveRow(row)"
                >
                  保存
                </button>
                <button
                  type="button"
                  class="acu-btn acu-btn--sm danger"
                  :disabled="!editMode || isRowBusy(row)"
                  @click="deleteRow(row)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  </details>
</template>
