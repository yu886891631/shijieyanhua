<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  DEFAULT_ROUTE_MAX_CONCURRENCY,
  alignFallbackMaxConcurrencies,
  normalizeRouteMaxConcurrency,
} from '../api/route-concurrency-limits';
import { loadSettings, useSettingsStore } from '../settings';
import { buildShareablePresetExport } from '../settings-security';
import { isTagKeyManagedByWorldbookWriteRules } from '../tasks/chat-body-tag-replace';
import { commaSeparatedListsEqual, formatCommaSeparatedList, parseCommaSeparatedList } from '../tasks/comma-separated';
import { applyPresetFieldsToSettings, resolveEffectiveSettings } from '../tasks/effective-settings';
import { buildChatSnapshotFromSettings } from '../tasks/chat-task-scope';
import { ACU_PP_CHAT_SCOPE_CHANGED, ACU_PP_TASKS_CHANGED, type ChatScopeChangedPayload, type TasksChangedPayload } from '../tasks/events';
import { findLatestAccessibleFloorId, isAccessibleMessageFloor, normalizeMessageFloorId } from '../tasks/message-floor';
import { GAME_TIME_FORMAT_HELP } from '../tasks/parse-game-time';
import { REGISTERED_MACRO_LEGEND } from '../tasks/placeholder-macros';
import { buildPromptPreviewRows } from '../tasks/prompt-auto-segments';
import {
  appendPromptGroup,
  movePromptGroupAt,
  remapManualExpandedKeys,
  remapManualExpandedKeysAfterRemove,
  removePromptGroupAt,
  reorderPromptGroupsAt,
} from '../tasks/prompt-group-ops';
import { pruneWorldbookForRemovedReplicas } from '../tasks/prune-applied-for-replica';
import { isEnumRegistryMarker } from '../tasks/replica-enum-parse';
import {
  disableReplicaFamilyOnTasks,
  enableReplicaFamilyOnTask,
  getReplicaFamilyEnumSpecKey,
  hasReplicaFamilyTasks,
  mirrorAllReplicaFamilies,
  scanDynamicAttrPlaceholders,
  syncReplicaFamily,
} from '../tasks/replica-family';
import {
  applyReplicaFamilyCleanup,
  ensureReplicaFamilyCleanupDefaults,
  listAllAttrValuesForEnumSpec,
  type RemovedReplicaCleanupInfo,
} from '../tasks/replica-family-cleanup';
import { probeTaskGameTime } from '../tasks/schedule';
import {
  CHAT_SNAPSHOT_PRESET_NAME,
  type ChatWorldbookWriteRule,
  type PlotWorldbookConfig,
  type PostProcessTask,
  type ReplicaFamilyScheduleMode,
  type RunLogTaskResult,
  type TaskContextConfig,
  type TaskWorkflowPresetEntry,
} from '../tasks/schema';
import { STRUCTURED_OUTPUT_MODE_HELP } from '../tasks/strict-variable-response';
import {
  syncStructuredOutputPromptGroup,
  updateStructuredOutputRulesCacheFromPromptGroups,
} from '../tasks/structured-output-prompt-rules';
import { EXTRACT_INJECT_TAGS_HELP } from '../tasks/tag-extract';
import {
  getPostProcessWritableTagNames,
  pickTagsForPostProcessWrite,
  writeFloorTagValues,
} from '../tasks/tag-variables';
import { cloneTaskForInsert, newTaskId } from '../tasks/task-clone';
import { ensureTaskSchedule, mergeTaskSchedule } from '../tasks/task-schedule-merge';
import {
  applyReplicaFamilyCleanupInStore,
  applyTaskWorkflowPreset as applyTaskWorkflowPresetInStore,
  clearChatScope,
  createTask as createTaskInStore,
  deleteTask as deleteTaskInStore,
  deleteTaskWorkflowPreset as deleteTaskWorkflowPresetInStore,
  duplicateTask as duplicateTaskInStore,
  ensureReplicaFamilyMember as ensureReplicaFamilyMemberInStore,
  forkEffectiveIntoChatSnapshot,
  getChatPresetDropdownValue,
  getChatScopeState,
  listTasks,
  moveTask as moveTaskInStore,
  repairChatScopeIfNeeded,
  replaceTasks,
  saveChatSnapshotAsGlobalPreset,
  saveNamedGlobalPresetFromDisplay,
  saveTaskWorkflowPreset as saveTaskWorkflowPresetInStore,
  setChatScopeActiveView,
  setTaskEnabled as setTaskEnabledInStore,
  updatePresetFields,
  updateReplicaFamilyScheduleMode as updateReplicaFamilyScheduleModeInStore,
  updateReplicaMemberSchedule as updateReplicaMemberScheduleInStore,
  updateTask as updateTaskInStore,
} from '../tasks/task-store';
import { mergeTaskWorkflowPresetsOnTask } from '../tasks/task-workflow-preset';
import { PLACEHOLDER_LEGEND, filterXmlExtractedTagsForDisplay } from '../tasks/utils';
import { DEFAULT_WORLDBOOK_WRITE_PLACEMENT, normalizeWorldbookWritePlacement } from '../worldbook/entry-order';
import { migrateWorldbookWriteRuleTarget, resolveWriteTargetBookName } from '../worldbook/write-book-migrate';
import { purgeAllManagedWorldbookEntries } from '../worldbook/write-reconcile';
import AcuConfirmDialog from './AcuConfirmDialog.vue';
import AcuHelpIconBtn from './AcuHelpIconBtn.vue';
import AcuHelpPanel from './AcuHelpPanel.vue';
import AcuToggle from './AcuToggle.vue';
import ApiConfigPanel from './ApiConfigPanel.vue';
import { RERUN_BUTTON_LABEL, SCRIPT_DISPLAY_NAME, SCRIPT_LOG_PREFIX, WORKFLOW_TASK_LABEL } from './brand';
import { acuConfirm, acuPrompt } from './composables/useAcuConfirm';
import { useTaskClipboard } from './composables/useTaskClipboard';
import Context7Section from './Context7Section.vue';
import PlotWorldbookSection from './PlotWorldbookSection.vue';
import PromptSegmentCard from './PromptSegmentCard.vue';
import ReplicaFamilyCleanupPanel from './ReplicaFamilyCleanupPanel.vue';
import ReplicaFamilySchedulerPanel from './ReplicaFamilySchedulerPanel.vue';
import RunLogWorldbookSyncPanel from './RunLogWorldbookSyncPanel.vue';
import TaskContextPanel from './TaskContextPanel.vue';
import TaskPlotWorldbookPanel from './TaskPlotWorldbookPanel.vue';
import TaskPromptAutoSegmentsPanel from './TaskPromptAutoSegmentsPanel.vue';
import TaskWorkflowPresetPanel from './TaskWorkflowPresetPanel.vue';
import { BUILTIN_UI_THEMES, applyThemeTokens, updateGlobalTheme } from './theme';
import { acuToast } from './toast';
import { ensureAcuToastStyles } from './toast-styles';

const closeWindow = inject<() => void>('closeSettings', () => {});

const store = useSettingsStore();
const { settings } = storeToRefs(store);
const { clipboard, hasClipboard, copyTask: copyTaskToClipboard } = useTaskClipboard();

const selectedTaskId = ref(settings.value.tasks[0]?.id ?? '');
const viewTasks = ref<PostProcessTask[]>([]);
const chatScopeInfo = ref(getChatScopeState());
/** 本聊天是否存在快照（与下拉当前是 snapshot 还是 global 视图无关） */
const hasChatSnapshot = ref(!!getChatScopeState());
const presetDropdownValue = ref(getChatPresetDropdownValue());
const windowFullscreen = ref(false);

/** 兼容旧分支名：有快照时任务展示走 viewTasks */
const chatScopeActive = hasChatSnapshot;

const displayTasks = computed(() => (hasChatSnapshot.value ? viewTasks.value : settings.value.tasks));

function toggleWindowFullscreen(): void {
  windowFullscreen.value = !windowFullscreen.value;
}

function onFullscreenKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !windowFullscreen.value) return;
  event.preventDefault();
  windowFullscreen.value = false;
}

/** 覆盖快照期间抑制 CHAT_SCOPE_CHANGED 触发的全量 refresh */
let suppressChatScopeRefresh = false;

const isBrowsingGlobalPreset = computed(
  () => !!hasChatSnapshot.value && chatScopeInfo.value?.activeView === 'global',
);

const showReplicaFamilyCleanupPanel = computed(() => hasReplicaFamilyTasks(displayTasks.value));

/** 任务 tab 列表：隐藏副本族副本（仅显示原本与普通任务） */
const taskTabTasks = computed(() => displayTasks.value.filter(t => !t.replicaFamilyRootId));

/** 世界书页任务列表：原本 + 普通任务 + 全部副本成员 */
const plotWorldbookPanelTasks = computed(() => {
  const members = displayTasks.value
    .filter(t => t.replicaFamilyRootId)
    .sort((a, b) =>
      (a.replicaFamilyAttrValue ?? '').localeCompare(b.replicaFamilyAttrValue ?? '', undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
  return [...taskTabTasks.value, ...members];
});

const selectedReplicaViewId = ref<string | null>(null);

const selectedTask = computed(() => taskTabTasks.value.find(t => t.id === selectedTaskId.value));

const replicaFamilyMembers = computed(() => {
  const root = selectedTask.value;
  if (!root?.syncAsReplicaFamily) return [];
  return displayTasks.value.filter(t => t.replicaFamilyRootId === root.id);
});

const editorTask = computed(() => {
  const root = selectedTask.value;
  if (!root?.syncAsReplicaFamily || !selectedReplicaViewId.value) return root;
  return displayTasks.value.find(t => t.id === selectedReplicaViewId.value) ?? root;
});

const isViewingReplicaMember = computed(
  () => !!selectedReplicaViewId.value && selectedReplicaViewId.value !== selectedTask.value?.id,
);

const promptPreviewTask = computed(() =>
  isViewingReplicaMember.value && editorTask.value ? editorTask.value : selectedTask.value,
);

const promptPreviewRows = computed(() => {
  const task = promptPreviewTask.value;
  if (!task) return [];
  return buildPromptPreviewRows(task);
});

const manualPromptGroupCount = computed(() => promptPreviewTask.value?.promptGroups?.length ?? 0);

const expandedPromptRowKeys = ref<Set<string>>(new Set());
const promptZoneRef = ref<HTMLElement | null>(null);
const promptDrag = ref<{ fromIndex: number; toIndex: number } | null>(null);
const promptDragSortEnabled = ref(false);
let promptDragCleanup: (() => void) | null = null;

function promptRowKey(row: (typeof promptPreviewRows.value)[number]): string {
  return row.kind === 'manual' ? `m-${row.manualIndex}` : `a-${row.segmentId}`;
}

function isPromptRowExpanded(key: string): boolean {
  return expandedPromptRowKeys.value.has(key);
}

function togglePromptRow(key: string) {
  const next = new Set(expandedPromptRowKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedPromptRowKeys.value = next;
}

function promptDropMarker(manualIndex: number): 'before' | 'after' | null {
  const drag = promptDrag.value;
  if (!drag || drag.fromIndex === drag.toIndex) return null;
  if (drag.toIndex < drag.fromIndex && manualIndex === drag.toIndex) return 'before';
  if (drag.toIndex > drag.fromIndex && manualIndex === drag.toIndex) return 'after';
  return null;
}

function calcPromptDropIndex(clientY: number, fromIndex: number): number {
  const zone = promptZoneRef.value;
  if (!zone) return fromIndex;
  const cards = zone.querySelectorAll<HTMLElement>('[data-manual-index]');
  const mids: { index: number; mid: number }[] = [];
  cards.forEach(card => {
    const idx = Number(card.dataset.manualIndex);
    if (!Number.isInteger(idx)) return;
    const rect = card.getBoundingClientRect();
    mids.push({ index: idx, mid: rect.top + rect.height / 2 });
  });
  mids.sort((a, b) => a.index - b.index);
  if (mids.length === 0) return fromIndex;
  let desired = mids.length - 1;
  for (let i = 0; i < mids.length; i++) {
    if (clientY < mids[i]!.mid) {
      desired = i;
      break;
    }
  }
  return desired;
}

function onPromptDragStart(payload: { pointerId: number; clientY: number; fromIndex: number }) {
  if (!promptDragSortEnabled.value || isViewingReplicaMember.value) return;
  promptDragCleanup?.();
  promptDrag.value = { fromIndex: payload.fromIndex, toIndex: payload.fromIndex };

  // 助手脚本在 iframe，设置 UI 挂在父文档；必须在 ownerDocument 上听 pointer 事件
  const eventDoc = promptZoneRef.value?.ownerDocument ?? document;
  const eventTarget: Document | Window = eventDoc.defaultView ?? eventDoc;

  const onMove = (e: Event) => {
    const pe = e as PointerEvent;
    if (pe.pointerId !== payload.pointerId) return;
    const toIndex = calcPromptDropIndex(pe.clientY, payload.fromIndex);
    const cur = promptDrag.value;
    if (!cur) return;
    if (cur.toIndex !== toIndex) {
      promptDrag.value = { fromIndex: cur.fromIndex, toIndex };
    }
  };
  const onUp = (e: Event) => {
    const pe = e as PointerEvent;
    if (pe.pointerId !== payload.pointerId) return;
    promptDragCleanup?.();
    promptDragCleanup = null;
    const drag = promptDrag.value;
    promptDrag.value = null;
    if (!drag || drag.fromIndex === drag.toIndex) return;
    void reorderPromptGroup(drag.fromIndex, drag.toIndex);
  };
  promptDragCleanup = () => {
    eventTarget.removeEventListener('pointermove', onMove);
    eventTarget.removeEventListener('pointerup', onUp);
    eventTarget.removeEventListener('pointercancel', onUp);
  };
  eventTarget.addEventListener('pointermove', onMove);
  eventTarget.addEventListener('pointerup', onUp);
  eventTarget.addEventListener('pointercancel', onUp);
  const initialTo = calcPromptDropIndex(payload.clientY, payload.fromIndex);
  if (initialTo !== payload.fromIndex) {
    promptDrag.value = { fromIndex: payload.fromIndex, toIndex: initialTo };
  }
}

watch(selectedTaskId, () => {
  expandedPromptRowKeys.value = new Set();
  promptDragCleanup?.();
  promptDragCleanup = null;
  promptDrag.value = null;
});

function collectUsedApiPresetNames(task: PostProcessTask | null | undefined): Set<string> {
  const used = new Set<string>();
  if (!task) return used;
  const primary = String(task.apiPresetName || '').trim();
  if (primary) used.add(primary);
  for (const name of task.apiPresetFallbackNames ?? []) {
    const normalized = String(name || '').trim();
    if (normalized) used.add(normalized);
  }
  return used;
}

const availableFallbackPresetsForAdd = computed(() => {
  const used = collectUsedApiPresetNames(selectedTask.value);
  return settings.value.apiPresets.filter(p => !used.has(p.name));
});

const availableFallbackPresetsForReplicaAdd = computed(() => {
  const used = collectUsedApiPresetNames(editorTask.value);
  return settings.value.apiPresets.filter(p => !used.has(p.name));
});

function ensureTaskApiConfig(task: PostProcessTask) {
  if (!task.apiPresetFallbackNames) task.apiPresetFallbackNames = [];
  task.apiPrimaryMaxConcurrency = normalizeRouteMaxConcurrency(task.apiPrimaryMaxConcurrency);
  if (!task.apiFallbackMaxConcurrencies) task.apiFallbackMaxConcurrencies = [];
  task.apiFallbackMaxConcurrencies = alignFallbackMaxConcurrencies(
    task.apiPresetFallbackNames,
    task.apiFallbackMaxConcurrencies,
    task.apiPrimaryMaxConcurrency ?? DEFAULT_ROUTE_MAX_CONCURRENCY,
  );
}

function seedReplicaApiFromRoot(replica: PostProcessTask, root: PostProcessTask) {
  replica.apiPresetName = root.apiPresetName ?? '';
  replica.apiPresetFallbackNames = _.cloneDeep(root.apiPresetFallbackNames ?? []);
  replica.apiPrimaryMaxConcurrency = root.apiPrimaryMaxConcurrency ?? DEFAULT_ROUTE_MAX_CONCURRENCY;
  replica.apiFallbackMaxConcurrencies = _.cloneDeep(root.apiFallbackMaxConcurrencies ?? []);
  ensureTaskApiConfig(replica);
}

const replicaApiPresetMode = computed({
  get: (): 'inheritRoot' | 'custom' => (editorTask.value?.apiPresetMode === 'custom' ? 'custom' : 'inheritRoot'),
  set: (mode: 'inheritRoot' | 'custom') => {
    const replica = editorTask.value;
    const root = selectedTask.value;
    if (!replica?.replicaFamilyRootId || !root) return;
    if (mode === 'custom') {
      if (replica.apiPresetMode !== 'custom') {
        seedReplicaApiFromRoot(replica, root);
      }
      replica.apiPresetMode = 'custom';
    } else {
      // 立即从原本写回路由，避免 debounce mirror 前的竞态
      seedReplicaApiFromRoot(replica, root);
      replica.apiPresetMode = 'inheritRoot';
    }
  },
});

function addTaskApiFallback() {
  const task = selectedTask.value;
  if (!task) return;
  ensureTaskApiConfig(task);
  const next = availableFallbackPresetsForAdd.value[0];
  if (!next) {
    acuToast('warning', '没有可添加的备用预设');
    return;
  }
  task.apiPresetFallbackNames.push(next.name);
  if (!task.apiFallbackMaxConcurrencies) task.apiFallbackMaxConcurrencies = [];
  task.apiFallbackMaxConcurrencies.push(task.apiPrimaryMaxConcurrency ?? DEFAULT_ROUTE_MAX_CONCURRENCY);
}

function removeTaskApiFallback(index: number) {
  const task = selectedTask.value;
  if (!task?.apiPresetFallbackNames) return;
  task.apiPresetFallbackNames.splice(index, 1);
  task.apiFallbackMaxConcurrencies?.splice(index, 1);
}

function addReplicaApiFallback() {
  const task = editorTask.value;
  if (!task?.replicaFamilyRootId) return;
  task.apiPresetMode = 'custom';
  ensureTaskApiConfig(task);
  const next = availableFallbackPresetsForReplicaAdd.value[0];
  if (!next) {
    acuToast('warning', '没有可添加的备用预设');
    return;
  }
  task.apiPresetFallbackNames.push(next.name);
  if (!task.apiFallbackMaxConcurrencies) task.apiFallbackMaxConcurrencies = [];
  task.apiFallbackMaxConcurrencies.push(task.apiPrimaryMaxConcurrency ?? DEFAULT_ROUTE_MAX_CONCURRENCY);
}

function removeReplicaApiFallback(index: number) {
  const task = editorTask.value;
  if (!task?.replicaFamilyRootId || !task.apiPresetFallbackNames) return;
  task.apiPresetMode = 'custom';
  task.apiPresetFallbackNames.splice(index, 1);
  task.apiFallbackMaxConcurrencies?.splice(index, 1);
}

watch(
  selectedTask,
  task => {
    if (task) ensureTaskApiConfig(task);
  },
  { immediate: true },
);

watch(
  editorTask,
  task => {
    if (task?.replicaFamilyRootId) ensureTaskApiConfig(task);
  },
  { immediate: true },
);

watch(selectedTaskId, () => {
  selectedReplicaViewId.value = null;
});

const defaultContextConfigRef = ref<TaskContextConfig>({
  contextTurnCount: settings.value.contextTurnCount,
  contextExtractRules: _.cloneDeep(settings.value.contextExtractRules),
  contextExcludeRules: _.cloneDeep(settings.value.contextExcludeRules),
});

function buildPresetFieldsPatch() {
  return {
    contextTurnCount: settings.value.contextTurnCount,
    contextExtractRules: _.cloneDeep(settings.value.contextExtractRules),
    contextExcludeRules: _.cloneDeep(settings.value.contextExcludeRules),
    plotWorldbookConfig: _.cloneDeep(settings.value.plotWorldbookConfig),
    taskPlotWorldbookOverridesEnabled: settings.value.taskPlotWorldbookOverridesEnabled,
    taskContextOverridesEnabled: settings.value.taskContextOverridesEnabled,
    memoryRecallRecentCount: settings.value.memoryRecallRecentCount ?? 10,
    finalInjectTemplate: settings.value.finalInjectTemplate ?? '',
    userInputEndInjectTemplate: settings.value.userInputEndInjectTemplate ?? '',
    tagVariableInjectTemplate: settings.value.tagVariableInjectTemplate ?? '',
    chatExtractTags: _.cloneDeep(settings.value.chatExtractTags ?? { user: [], assistant: [] }),
    chatBodyTagReplaceRules: _.cloneDeep(settings.value.chatBodyTagReplaceRules ?? []),
    chatWorldbookWriteRules: _.cloneDeep(settings.value.chatWorldbookWriteRules ?? []),
  };
}

type FlushPendingWritesOptions = {
  skipPresetFlush?: boolean;
  skipTasksFlush?: boolean;
};

type RefreshTaskViewOptions = FlushPendingWritesOptions & {
  skipTaskReload?: boolean;
  skipPresetSync?: boolean;
};

/** 下拉在查看全局预设时，UI 写回走绑定全局预设（store 分流），不写快照 */
let refreshingTaskView = false;
let persistViewTasksTimer: ReturnType<typeof setTimeout> | null = null;
let persistPresetFieldsTimer: ReturnType<typeof setTimeout> | null = null;

async function flushPendingWrites(options?: FlushPendingWritesOptions): Promise<void> {
  if (persistViewTasksTimer) {
    clearTimeout(persistViewTasksTimer);
    persistViewTasksTimer = null;
    if (chatScopeActive.value && !options?.skipTasksFlush) {
      await replaceTasks(viewTasks.value, 'ui');
    }
  }
  if (persistPresetFieldsTimer) {
    clearTimeout(persistPresetFieldsTimer);
    persistPresetFieldsTimer = null;
    if (chatScopeActive.value && !options?.skipPresetFlush) {
      await updatePresetFields(buildPresetFieldsPatch(), 'ui');
    }
  }
}

/** 有快照时：先落盘最新 viewTasks，再执行 store 写，最后 skipTasksFlush 重载，避免旧 flush 回盖。 */
async function runChatScopeStoreMutation(op: () => Promise<unknown>): Promise<void> {
  await flushPendingWrites();
  await op();
  await refreshTaskView({ skipTasksFlush: true });
}

async function refreshTaskView(options?: RefreshTaskViewOptions): Promise<void> {
  refreshingTaskView = true;
  let didReloadTasks = false;
  let didSyncPresets = false;
  try {
    await flushPendingWrites(options);
    await repairChatScopeIfNeeded();
    const scope = getChatScopeState();
    chatScopeInfo.value = scope;
    hasChatSnapshot.value = !!scope;
    presetDropdownValue.value = getChatPresetDropdownValue();
    if (scope && !options?.skipTaskReload) {
      viewTasks.value = listTasks();
      if (!viewTasks.value.some(t => t.id === selectedTaskId.value)) {
        selectedTaskId.value = viewTasks.value[0]?.id ?? '';
      }
      didReloadTasks = true;
    } else if (!scope) {
      viewTasks.value = [];
      didReloadTasks = true;
    }
    if (!options?.skipPresetSync) {
      suppressGlobalSettingsPersist = true;
      try {
        syncPresetFieldsFromEffective();
      } finally {
        suppressGlobalSettingsPersist = false;
      }
      didSyncPresets = true;
    }
  } finally {
    // 仅清「本次重载/同步」可能误调度的 debounce；skip 两边时保留用户合法 pending
    await nextTick();
    if (didReloadTasks && persistViewTasksTimer) {
      clearTimeout(persistViewTasksTimer);
      persistViewTasksTimer = null;
    }
    if (didSyncPresets && persistPresetFieldsTimer) {
      clearTimeout(persistPresetFieldsTimer);
      persistPresetFieldsTimer = null;
    }
    refreshingTaskView = false;
  }
}

function syncPresetFieldsFromEffective() {
  syncingPresetView = true;
  try {
    const effective = resolveEffectiveSettings(loadSettings());
    // 有聊天快照时下拉切换只改展示：把 effective 的全部预设字段同步到 UI（含注入模板与规则）
    applyPresetFieldsToSettings(settings.value, buildChatSnapshotFromSettings(effective));
    defaultContextConfigRef.value = {
      contextTurnCount: effective.contextTurnCount,
      contextExtractRules: _.cloneDeep(effective.contextExtractRules),
      contextExcludeRules: _.cloneDeep(effective.contextExcludeRules),
    };
  } finally {
    syncingPresetView = false;
  }
}

let syncingPresetView = false;

let persistPlotWorldbookChain: Promise<void> = Promise.resolve();

async function persistPlotWorldbookConfigNow(): Promise<void> {
  if (syncingPresetView) return;
  const patch = { plotWorldbookConfig: _.cloneDeep(settings.value.plotWorldbookConfig) };
  if (chatScopeActive.value) {
    // 快照视图 → 写快照；全局视图 → 写绑定全局预设（store 分流）
    await updatePresetFields(patch, 'ui');
    return;
  }
  store.saveActivePreset();
}

function onPlotWorldbookConfigUpdate(v: PlotWorldbookConfig): void {
  if (syncingPresetView) return;
  settings.value.plotWorldbookConfig = v;
  persistPlotWorldbookChain = persistPlotWorldbookChain
    .then(() => persistPlotWorldbookConfigNow())
    .catch(() => undefined);
}

async function persistPresetFieldsNow(): Promise<void> {
  if (syncingPresetView || !hasChatSnapshot.value) return;
  const draft = buildPresetFieldsPatch();
  if (persistPresetFieldsTimer) {
    clearTimeout(persistPresetFieldsTimer);
    persistPresetFieldsTimer = null;
  }
  await updatePresetFields(draft, 'ui');
}

function schedulePersistPresetFields() {
  if (syncingPresetView || refreshingTaskView || !chatScopeActive.value) return;
  if (persistPresetFieldsTimer) clearTimeout(persistPresetFieldsTimer);
  persistPresetFieldsTimer = setTimeout(() => {
    persistPresetFieldsTimer = null;
    void persistPresetFieldsNow();
  }, 300);
}

watch(
  defaultContextConfigRef,
  v => {
    settings.value.contextTurnCount = v.contextTurnCount;
    settings.value.contextExtractRules = v.contextExtractRules;
    settings.value.contextExcludeRules = v.contextExcludeRules;
    schedulePersistPresetFields();
  },
  { deep: true },
);

/** 有聊天快照时：注入模板等 debounce 写回（快照视图→快照；全局视图→绑定全局预设） */
watch(
  () => ({
    finalInjectTemplate: settings.value.finalInjectTemplate,
    userInputEndInjectTemplate: settings.value.userInputEndInjectTemplate,
    tagVariableInjectTemplate: settings.value.tagVariableInjectTemplate,
    chatExtractTags: settings.value.chatExtractTags,
    chatBodyTagReplaceRules: settings.value.chatBodyTagReplaceRules,
    chatWorldbookWriteRules: settings.value.chatWorldbookWriteRules,
  }),
  () => schedulePersistPresetFields(),
  { deep: true },
);

const taskPlotWorldbookOverridesModel = computed({
  get: () => settings.value.taskPlotWorldbookOverridesEnabled,
  set(v: boolean) {
    settings.value.taskPlotWorldbookOverridesEnabled = v;
    if (chatScopeActive.value) {
      void persistPresetFieldsNow();
      return;
    }
    schedulePersistPresetFields();
  },
});

const taskContextOverridesModel = computed({
  get: () => settings.value.taskContextOverridesEnabled,
  set(v: boolean) {
    settings.value.taskContextOverridesEnabled = v;
    if (chatScopeActive.value) {
      void persistPresetFieldsNow();
      return;
    }
    schedulePersistPresetFields();
  },
});

const memoryRecallRecentCountModel = computed({
  get: () => settings.value.memoryRecallRecentCount ?? 10,
  set(v: number) {
    const n = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 10;
    settings.value.memoryRecallRecentCount = n;
    if (chatScopeActive.value) {
      void persistPresetFieldsNow();
      return;
    }
    schedulePersistPresetFields();
  },
});

void refreshTaskView();

let syncingReplicas = false;

function ensureReplicasMirroredInPlace(tasks: PostProcessTask[]): void {
  if (syncingReplicas) return;
  syncingReplicas = true;
  try {
    // 深拷贝后再镜像，避免对 Vue reactive Proxy 调用 structuredClone / Zod 副作用
    const mirrored = mirrorAllReplicaFamilies(_.cloneDeep(tasks));
    if (_.isEqual(mirrored, tasks)) return;
    tasks.splice(0, tasks.length, ...mirrored);
  } finally {
    syncingReplicas = false;
  }
}

function schedulePersistViewTasks() {
  if (!hasChatSnapshot.value || refreshingTaskView || syncingPresetView) return;
  if (persistViewTasksTimer) clearTimeout(persistViewTasksTimer);
  persistViewTasksTimer = setTimeout(() => {
    persistViewTasksTimer = null;
    void (async () => {
      const draftTasks = _.cloneDeep(viewTasks.value);
      ensureReplicasMirroredInPlace(draftTasks);
      await replaceTasks(draftTasks, 'ui');
    })();
  }, 300);
}

watch(viewTasks, schedulePersistViewTasks, { deep: true });

let persistGlobalSettingsTimer: ReturnType<typeof setTimeout> | null = null;
let suppressGlobalSettingsPersist = false;

function persistGlobalSettingsNow(): void {
  if (persistGlobalSettingsTimer) {
    clearTimeout(persistGlobalSettingsTimer);
    persistGlobalSettingsTimer = null;
  }
  if (hasChatSnapshot.value) {
    // 有快照：只经 persist 合并脚本级字段，避免展示态 tasks 写回全局
    store.persist();
    return;
  }
  ensureReplicasMirroredInPlace(settings.value.tasks);
  store.persist();
}

function schedulePersistGlobalSettings() {
  if (suppressGlobalSettingsPersist) return;
  if (persistGlobalSettingsTimer) clearTimeout(persistGlobalSettingsTimer);
  persistGlobalSettingsTimer = setTimeout(() => {
    persistGlobalSettingsTimer = null;
    persistGlobalSettingsNow();
  }, 300);
}

watch(
  () => ({
    enabled: settings.value.enabled,
    tasks: settings.value.tasks,
    messageVarRetention: settings.value.messageVarRetention,
    activePresetName: settings.value.activePresetName,
    replicaFamilyCleanup: settings.value.replicaFamilyCleanup,
  }),
  schedulePersistGlobalSettings,
  { deep: true },
);

const importFileInput = ref<HTMLInputElement | null>(null);
const currentPage = ref(1);
const messageVarRetentionHelpOpen = ref(false);
const replicaCleanupHelpOpen = ref(false);
const gameTimeFormatHelpOpen = ref(false);
const gameTimeParseTestHint = ref('');
const gameTimeParseTestHintClass = ref('');
const chatExtractTagsHelpOpen = ref(false);
const extractInjectTagsHelpOpen = ref(false);
const structuredOutputHelpOpen = ref(false);
const tagVariableInjectHelpOpen = ref(false);
const finalInjectHelpOpen = ref(false);
const userInputEndInjectHelpOpen = ref(false);
const chatBodyTagReplaceHelpOpen = ref(false);
const chatWorldbookWriteHelpOpen = ref(false);
const apiRouteConcurrencyHelpOpen = ref(false);
const apiConfigExpanded = ref(false);
const executionStrategyExpanded = ref(false);
const chatBodyTagReplaceExpanded = ref(false);
const chatWorldbookWriteExpanded = ref(false);
const promptSectionExpanded = ref(false);

const PAGE_TABS = [
  { id: 1, label: 'API', shortLabel: 'API' },
  { id: 2, label: '世界书与上下文', shortLabel: '上下文' },
  { id: 3, label: '任务', shortLabel: '任务' },
  { id: 4, label: '日志', shortLabel: '日志' },
] as const;

const UI_THEMES = BUILTIN_UI_THEMES;

function applyUiTheme(themeId: string) {
  updateGlobalTheme(themeId);
  ensureAcuToastStyles(themeId);
  const root = document.querySelector('.acu-pp-root') as HTMLElement | null;
  if (root) {
    applyThemeTokens(root, themeId);
  }
}

function selectUiTheme(themeId: string) {
  settings.value.uiThemeId = themeId;
  applyUiTheme(themeId);
}

function goToPage(page: number) {
  currentPage.value = Math.min(4, Math.max(1, page));
  if (currentPage.value === 2 || currentPage.value === 3) {
    void refreshTaskView();
  }
  if (currentPage.value === 3) {
    refreshWorldbookNamesList();
  }
}

const assistantChatExtractTags = computed(() =>
  (settings.value.chatExtractTags?.assistant ?? []).map(t => t.trim()).filter(Boolean),
);

const availableChatBodyReplaceTags = computed(() => {
  const used = new Set((settings.value.chatBodyTagReplaceRules ?? []).map(r => r.targetTag.trim()));
  return assistantChatExtractTags.value.filter(t => !used.has(t));
});

function ensureChatBodyTagReplaceRules(): void {
  if (!settings.value.chatBodyTagReplaceRules) {
    settings.value.chatBodyTagReplaceRules = [];
  }
}

function isChatBodyReplaceTagUsedByOther(tag: string, ruleId: string): boolean {
  const normalized = tag.trim();
  return (settings.value.chatBodyTagReplaceRules ?? []).some(r => r.id !== ruleId && r.targetTag.trim() === normalized);
}

function isChatBodyReplaceTagStale(targetTag: string): boolean {
  const t = targetTag.trim();
  if (!t) return false;
  return !assistantChatExtractTags.value.includes(t);
}

function addChatBodyTagReplaceRule(): void {
  ensureChatBodyTagReplaceRules();
  const nextTag = availableChatBodyReplaceTags.value[0];
  if (!nextTag) return;
  settings.value.chatBodyTagReplaceRules.push({
    id: `replace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    targetTag: nextTag,
    template: '',
  });
}

function removeChatBodyTagReplaceRule(id: string): void {
  ensureChatBodyTagReplaceRules();
  settings.value.chatBodyTagReplaceRules = settings.value.chatBodyTagReplaceRules.filter(r => r.id !== id);
}

async function confirmRemoveChatBodyTagReplaceRule(id: string): Promise<void> {
  ensureChatBodyTagReplaceRules();
  const rule = settings.value.chatBodyTagReplaceRules.find(r => r.id === id);
  if (!rule) return;
  const label = rule.targetTag?.trim() || '未命名标签';
  if (!(await acuConfirm({ message: `删除聊天正文标签替换规则「${label}」？` }))) return;
  removeChatBodyTagReplaceRule(id);
}

function truncateRulePreview(text: string, maxLen = 48): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '（空模板）';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

function worldbookWriteRuleBookLabel(rule: { bookSource?: string; manualBookName?: string }): string {
  if (rule.bookSource === 'manual') return rule.manualBookName?.trim() || '未指定世界书';
  return '角色主世界书';
}

function worldbookWriteRuleEntryTypeLabel(entryType?: string): string {
  return entryType === 'keyword' ? '绿灯 keyword' : '蓝灯 constant';
}

const allWorldbookNames = ref<string[]>([]);

function refreshWorldbookNamesList(): void {
  try {
    allWorldbookNames.value = getWorldbookNames();
  } catch {
    allWorldbookNames.value = [];
  }
}

const worldbookWriteTargetTagOptions = computed(() => {
  const tags = new Set<string>(assistantChatExtractTags.value);
  for (const task of settings.value.tasks ?? []) {
    for (const tag of task.extractInjectTags ?? []) {
      const trimmed = tag.trim();
      if (trimmed) tags.add(trimmed);
    }
  }
  return [...tags];
});

function ensureChatWorldbookWriteRules(): void {
  if (!settings.value.chatWorldbookWriteRules) {
    settings.value.chatWorldbookWriteRules = [];
  }
}

function addChatWorldbookWriteRule(): void {
  ensureChatWorldbookWriteRules();
  const nextTag = worldbookWriteTargetTagOptions.value[0] ?? '';
  const hasAttr = nextTag.includes('@');
  settings.value.chatWorldbookWriteRules.push({
    id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    targetTag: nextTag,
    template: nextTag ? `{{${nextTag}}}` : '',
    entryName: '',
    bookSource: 'character',
    manualBookName: '',
    entryType: hasAttr ? 'keyword' : 'constant',
    keywords: '',
    splitByAttr: hasAttr,
    wrapTagName: '',
    placement: { ...DEFAULT_WORLDBOOK_WRITE_PLACEMENT },
    preventRecursion: true,
  });
}

function worldbookWriteWrapTagPlaceholder(rule: { targetTag?: string }): string {
  const tag = (rule.targetTag ?? '').trim();
  if (!tag) return '默认：目标标签名';
  const atIdx = tag.indexOf('@');
  const tagName = atIdx > 0 ? tag.slice(0, atIdx) : tag;
  return `留空则 ${tagName}`;
}

async function removeChatWorldbookWriteRule(id: string): Promise<void> {
  ensureChatWorldbookWriteRules();
  const rule = settings.value.chatWorldbookWriteRules.find(r => r.id === id);
  if (!rule) return;
  const label = rule.targetTag?.trim() || '未命名标签';
  if (!(await acuConfirm({ message: `删除世界书写入规则「${label}」？` }))) return;
  settings.value.chatWorldbookWriteRules = settings.value.chatWorldbookWriteRules.filter(r => r.id !== id);
  ruleBookTargetSnapshot.value.delete(id);
  ruleBookMigratingIds.value.delete(id);
}

const purgingManagedWorldbookEntries = ref(false);

async function handlePurgeAllManagedWorldbookEntries(): Promise<void> {
  if (purgingManagedWorldbookEntries.value) return;
  if (
    !(await acuConfirm({
      message:
        '将扫描本机全部世界书，删除所有以 WorkflowHelper- 开头的托管条目（数量可能大于当前规则数：含其它书中的历史残留、已删规则留下的孤儿）。不会清空本聊天的写入账本/快照；若仍在本聊天并触发重算，仍会按账本重放。建议在切换聊天前使用。确定继续？',
    }))
  ) {
    return;
  }
  purgingManagedWorldbookEntries.value = true;
  try {
    const result = await purgeAllManagedWorldbookEntries();
    if (result.deleted <= 0) {
      acuToast('success', '没有可清理的托管条目');
    } else {
      const parts = [`已清理 ${result.deleted} 个托管世界书条目`];
      parts.push(`涉及 ${result.affectedBooks.length} 本世界书`);
      if (result.orphanOnly > 0) {
        parts.push(`其中 ${result.orphanOnly} 个为当前规则外残留`);
      }
      acuToast('success', parts.join('；'));
    }
  } catch (e) {
    acuToast('error', `清理失败: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    purgingManagedWorldbookEntries.value = false;
  }
}

const ruleBookTargetSnapshot = ref(new Map<string, string | null>());
const ruleBookMigratingIds = ref(new Set<string>());

function rememberRuleBookTargetSnapshot(rule: ChatWorldbookWriteRule): void {
  const resolved = resolveWriteTargetBookName(rule);
  if (resolved) ruleBookTargetSnapshot.value.set(rule.id, resolved);
}

function onManualBookNameFocus(rule: ChatWorldbookWriteRule): void {
  refreshWorldbookNamesList();
  rememberRuleBookTargetSnapshot(rule);
}

function onRuleBookSourceChanged(rule: ChatWorldbookWriteRule): void {
  if (rule.bookSource === 'manual') {
    refreshWorldbookNamesList();
  }
  void onRuleBookTargetChanged(rule);
}

function syncAllRuleBookTargetSnapshots(): void {
  const next = new Map<string, string | null>();
  for (const rule of settings.value.chatWorldbookWriteRules ?? []) {
    const resolved = resolveWriteTargetBookName(rule);
    if (resolved) next.set(rule.id, resolved);
  }
  ruleBookTargetSnapshot.value = next;
}

function isRuleBookTargetMigrating(ruleId: string): boolean {
  return ruleBookMigratingIds.value.has(ruleId);
}

async function onRuleBookTargetChanged(rule: ChatWorldbookWriteRule): Promise<void> {
  const oldBook = ruleBookTargetSnapshot.value.get(rule.id) ?? null;
  const newBook = resolveWriteTargetBookName(rule);
  if (!oldBook || !newBook || oldBook === newBook) {
    if (newBook) ruleBookTargetSnapshot.value.set(rule.id, newBook);
    return;
  }
  if (ruleBookMigratingIds.value.has(rule.id)) return;

  ruleBookMigratingIds.value.add(rule.id);
  try {
    acuToast('info', `正在将条目从「${oldBook}」迁移到「${newBook}」…`);
    const { moved, deletedFromOld } = await migrateWorldbookWriteRuleTarget({
      rule,
      fromBook: oldBook,
      toBook: newBook,
    });
    ruleBookTargetSnapshot.value.set(rule.id, newBook);
    if (moved > 0 || deletedFromOld > 0) {
      acuToast('success', `已迁移 ${moved} 个条目到「${newBook}」（自旧书清理 ${deletedFromOld} 个）`);
    } else {
      acuToast('success', `目标世界书已切换为「${newBook}」`);
    }
  } catch (e) {
    acuToast('warning', e instanceof Error ? e.message : String(e));
  } finally {
    ruleBookMigratingIds.value.delete(rule.id);
  }
}

function isWorldbookWriteAtDepth(rule: { placement?: { position?: string } }): boolean {
  const pos = rule.placement?.position ?? 'at_depth_as_system';
  return pos === 'at_depth_as_system' || pos === 'at_depth';
}

function ensureWorldbookWritePlacement(rule: {
  placement?: { position?: string; depth?: number; order?: number };
}): void {
  rule.placement = normalizeWorldbookWritePlacement(rule.placement);
}

function syncWorldbookWritePlacement(rule: {
  placement?: { position?: string; depth?: number; order?: number };
}): void {
  rule.placement = normalizeWorldbookWritePlacement(rule.placement);
}

watch(
  () => ({
    id: selectedTask.value?.id,
    mode: selectedTask.value?.structuredOutputMode,
  }),
  (curr, prev) => {
    const task = selectedTask.value;
    // 仅同一任务上用户主动改模式时 sync；切任务导致的 mode 变化不重排提示词段
    if (!task || curr?.mode == null || prev?.mode === undefined) return;
    if (curr.id !== prev.id) return;
    if (curr.mode === prev.mode) return;
    syncStructuredOutputPromptGroup(task, curr.mode);
  },
);

watch(
  () => selectedTask.value?.promptGroups,
  () => {
    const task = selectedTask.value;
    if (!task) return;
    updateStructuredOutputRulesCacheFromPromptGroups(task);
  },
  { deep: true },
);

const selectedTaskEnabledModel = computed({
  get: () => selectedTask.value?.enabled ?? true,
  set(v: boolean) {
    const task = selectedTask.value;
    if (!task) return;
    if (chatScopeActive.value) {
      void runChatScopeStoreMutation(() => setTaskEnabledInStore(task.id, v, 'ui')).catch(e =>
        acuToast('warning', e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    try {
      let tasks = [...settings.value.tasks];
      if (v) {
        if (scanDynamicAttrPlaceholders(task).length) {
          const enabledRoot = enableReplicaFamilyOnTask({ ...task, enabled: true });
          tasks = tasks.map(t => (t.id === task.id ? enabledRoot : t));
          tasks = syncReplicaFamily(enabledRoot, [], tasks);
        } else {
          tasks = tasks.map(t => (t.id === task.id ? { ...t, enabled: true } : t));
        }
      } else {
        tasks = disableReplicaFamilyOnTasks(task, tasks);
      }
      settings.value.tasks = tasks;
      selectedReplicaViewId.value = null;
      if (hasReplicaFamilyTasks(settings.value.tasks)) {
        ensureReplicaFamilyCleanupDefaults(settings.value);
      }
    } catch (e) {
      acuToast('warning', e instanceof Error ? e.message : String(e));
    }
  },
});

const selectedRoundInterval = computed({
  get: () => selectedTask.value?.schedule?.roundInterval ?? 0,
  set: (v: number) => {
    const task = selectedTask.value;
    if (!task) return;
    ensureTaskSchedule(task);
    task.schedule!.roundInterval = v;
  },
});

const scheduleMode = computed({
  get: (): 'round' | 'time' => {
    const schedule = selectedTask.value?.schedule;
    if (!schedule) return 'round';
    if (schedule.mode) return schedule.mode;
    return schedule.timeInterval?.enabled ? 'time' : 'round';
  },
  set: (v: 'round' | 'time') => {
    const task = selectedTask.value;
    if (!task) return;
    task.schedule = mergeTaskSchedule(task.schedule, { mode: v });
  },
});

const apiConfigSummary = computed(() => {
  const task = selectedTask.value;
  if (!task) return '';
  const primary = task.apiPresetName?.trim() || '全局默认';
  const fallbackCount = task.apiPresetFallbackNames?.length ?? 0;
  return fallbackCount > 0 ? `主要: ${primary} · ${fallbackCount} 个备用` : `主要: ${primary}`;
});

function formatApiRoutingSummary(task: PostProcessTask | null | undefined): string {
  if (!task) return '';
  const primary = task.apiPresetName?.trim() || '全局默认';
  const fallbackCount = task.apiPresetFallbackNames?.length ?? 0;
  return fallbackCount > 0 ? `主要: ${primary} · ${fallbackCount} 个备用` : `主要: ${primary}`;
}

const rootApiConfigSummary = computed(() => formatApiRoutingSummary(selectedTask.value));

const replicaApiConfigSummary = computed(() => {
  const replica = editorTask.value;
  if (!replica?.replicaFamilyRootId) return '';
  if (replica.apiPresetMode === 'custom') {
    return `自定义 · ${formatApiRoutingSummary(replica)}`;
  }
  return `沿用原本 · ${rootApiConfigSummary.value}`;
});

const executionStrategySummary = computed(() => (scheduleMode.value === 'time' ? '按游戏时间间隔' : '按回合间隔'));

const chatBodyTagReplaceSummary = computed(() => {
  const count = settings.value.chatBodyTagReplaceRules?.length ?? 0;
  if (count === 0) {
    return assistantChatExtractTags.value.length ? '暂无规则' : '未配置 AI 输出摘取';
  }
  return `${count} 条规则`;
});

const chatWorldbookWriteSummary = computed(() => {
  const count = settings.value.chatWorldbookWriteRules?.length ?? 0;
  if (count === 0) {
    return worldbookWriteTargetTagOptions.value.length ? '暂无规则' : '未配置可用标签';
  }
  return `${count} 条规则`;
});

const promptSectionSummary = computed(() => {
  const task = promptPreviewTask.value;
  if (!task) return '';
  const tagCount = (task.extractInjectTags ?? []).map(t => t.trim()).filter(Boolean).length;
  const manual = manualPromptGroupCount.value;
  const auto = promptPreviewRows.value.filter(row => row.kind === 'auto').length;
  const parts: string[] = [];
  if (tagCount > 0) parts.push(`${tagCount} 个摘取标签`);
  parts.push(`${manual} 个手动段`);
  if (auto > 0) parts.push(`${auto} 个自动段预览`);
  return parts.join(' · ');
});

const timeIntervalValue = computed({
  get: () => selectedTask.value?.schedule?.timeInterval?.value ?? 1,
  set: (v: number) => {
    const task = selectedTask.value;
    if (!task) return;
    ensureTaskSchedule(task);
    task.schedule!.timeInterval!.value = v;
  },
});

const timeIntervalUnit = computed({
  get: () => selectedTask.value?.schedule?.timeInterval?.unit ?? 'hour',
  set: (v: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year') => {
    const task = selectedTask.value;
    if (!task) return;
    ensureTaskSchedule(task);
    task.schedule!.timeInterval!.unit = v;
  },
});

const timeSourceType = computed({
  get: () => selectedTask.value?.schedule?.timeInterval?.timeSource?.type ?? 'message_tag',
  set: (v: 'message_tag' | 'variable') => {
    const task = selectedTask.value;
    if (!task) return;
    ensureTaskSchedule(task);
    const ti = task.schedule!.timeInterval!;
    if (v === 'message_tag') {
      ti.timeSource = { type: 'message_tag', tagNames: ['time'], scope: 'current_ai' };
    } else {
      ti.timeSource = { type: 'variable', variableType: 'message', path: '' };
    }
  },
});

const chatExtractUserTagsDraft = ref('');
const chatExtractAssistantTagsDraft = ref('');
const extractInjectTagsDraft = ref('');
const timeTagNamesDraft = ref('');

function syncCommaListDraftIfNeeded(draft: { value: string }, model: string[]): void {
  const parsed = parseCommaSeparatedList(draft.value);
  if (!commaSeparatedListsEqual(parsed, model)) {
    draft.value = formatCommaSeparatedList(model);
  }
}

watch(
  () => settings.value.chatExtractTags?.user ?? [],
  tags => syncCommaListDraftIfNeeded(chatExtractUserTagsDraft, tags),
  { deep: true, immediate: true },
);

watch(
  () => settings.value.chatExtractTags?.assistant ?? [],
  tags => syncCommaListDraftIfNeeded(chatExtractAssistantTagsDraft, tags),
  { deep: true, immediate: true },
);

watch(
  () => selectedTask.value?.extractInjectTags ?? [],
  tags => syncCommaListDraftIfNeeded(extractInjectTagsDraft, tags),
  { deep: true, immediate: true },
);

watch(
  () => {
    const src = selectedTask.value?.schedule?.timeInterval?.timeSource;
    return src?.type === 'message_tag' ? src.tagNames : ['time'];
  },
  tags => syncCommaListDraftIfNeeded(timeTagNamesDraft, tags),
  { deep: true, immediate: true },
);

function onChatExtractUserTagsInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  chatExtractUserTagsDraft.value = raw;
  settings.value.chatExtractTags = {
    user: parseCommaSeparatedList(raw),
    assistant: settings.value.chatExtractTags?.assistant ?? [],
  };
}

function onChatExtractUserTagsBlur(): void {
  chatExtractUserTagsDraft.value = formatCommaSeparatedList(settings.value.chatExtractTags?.user ?? []);
}

function onChatExtractAssistantTagsInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  chatExtractAssistantTagsDraft.value = raw;
  settings.value.chatExtractTags = {
    user: settings.value.chatExtractTags?.user ?? [],
    assistant: parseCommaSeparatedList(raw),
  };
}

function onChatExtractAssistantTagsBlur(): void {
  chatExtractAssistantTagsDraft.value = formatCommaSeparatedList(settings.value.chatExtractTags?.assistant ?? []);
}

function onExtractInjectTagsInput(e: Event): void {
  const task = selectedTask.value;
  if (!task) return;
  const raw = (e.target as HTMLInputElement).value;
  extractInjectTagsDraft.value = raw;
  task.extractInjectTags = parseCommaSeparatedList(raw);
}

function onExtractInjectTagsBlur(): void {
  extractInjectTagsDraft.value = formatCommaSeparatedList(selectedTask.value?.extractInjectTags ?? []);
}

function onTimeTagNamesInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  timeTagNamesDraft.value = raw;
  const task = selectedTask.value;
  if (!task?.schedule?.timeInterval?.timeSource || task.schedule.timeInterval.timeSource.type !== 'message_tag') {
    return;
  }
  task.schedule.timeInterval.timeSource.tagNames = parseCommaSeparatedList(raw);
}

function onTimeTagNamesBlur(): void {
  const src = selectedTask.value?.schedule?.timeInterval?.timeSource;
  timeTagNamesDraft.value = formatCommaSeparatedList(src?.type === 'message_tag' ? src.tagNames : []);
}

const timeTagScope = computed({
  get: () => {
    const src = selectedTask.value?.schedule?.timeInterval?.timeSource;
    return src?.type === 'message_tag' ? src.scope : 'current_ai';
  },
  set: (v: 'current_ai' | 'current_pair') => {
    const task = selectedTask.value;
    if (!task?.schedule?.timeInterval?.timeSource || task.schedule.timeInterval.timeSource.type !== 'message_tag')
      return;
    task.schedule.timeInterval.timeSource.scope = v;
  },
});

const timeVariableType = computed({
  get: () => {
    const src = selectedTask.value?.schedule?.timeInterval?.timeSource;
    return src?.type === 'variable' ? src.variableType : 'message';
  },
  set: (v: 'chat' | 'global' | 'message' | 'script' | 'character') => {
    const task = selectedTask.value;
    if (!task?.schedule?.timeInterval?.timeSource || task.schedule.timeInterval.timeSource.type !== 'variable') return;
    task.schedule.timeInterval.timeSource.variableType = v;
  },
});

const timeVariablePath = computed({
  get: () => {
    const src = selectedTask.value?.schedule?.timeInterval?.timeSource;
    return src?.type === 'variable' ? src.path : '';
  },
  set: (v: string) => {
    const task = selectedTask.value;
    if (!task?.schedule?.timeInterval?.timeSource || task.schedule.timeInterval.timeSource.type !== 'variable') return;
    task.schedule.timeInterval.timeSource.path = v;
  },
});

function testGameTimeParse() {
  const task = selectedTask.value;
  if (!task) {
    acuToast('warning', '请先选择任务');
    return;
  }
  ensureTaskSchedule(task);
  const result = probeTaskGameTime(task);
  gameTimeParseTestHint.value = result.message;
  if (result.ok) {
    gameTimeParseTestHintClass.value = 'acu-game-time-probe__hint--ok';
    acuToast('success', result.message, { timeOut: 4000 });
  } else if (result.stage === 'source') {
    gameTimeParseTestHintClass.value = 'acu-game-time-probe__hint--warn';
    acuToast('warning', result.message, { timeOut: 4500 });
  } else {
    gameTimeParseTestHintClass.value = 'acu-game-time-probe__hint--err';
    acuToast('error', result.message, { timeOut: 5000 });
  }
}

function insertClonedTask(cloned: PostProcessTask, afterTaskId?: string): void {
  if (chatScopeActive.value) {
    void runChatScopeStoreMutation(async () => {
      const arr = [...viewTasks.value];
      if (afterTaskId) {
        const index = arr.findIndex(t => t.id === afterTaskId);
        if (index >= 0) {
          arr.splice(index + 1, 0, cloned);
        } else {
          arr.push(cloned);
        }
      } else {
        arr.push(cloned);
      }
      await replaceTasks(arr, 'ui');
    })
      .then(() => {
        selectedTaskId.value = cloned.id;
      })
      .catch(e => acuToast('warning', e instanceof Error ? e.message : String(e)));
    return;
  }
  const arr = settings.value.tasks;
  if (afterTaskId) {
    const index = arr.findIndex(t => t.id === afterTaskId);
    if (index >= 0) {
      arr.splice(index + 1, 0, cloned);
      selectedTaskId.value = cloned.id;
      return;
    }
  }
  arr.push(cloned);
  selectedTaskId.value = cloned.id;
}

function duplicateSelectedTask(): void {
  const task = selectedTask.value;
  if (!task) return;
  if (chatScopeActive.value) {
    void (async () => {
      try {
        let clonedName = '';
        let clonedId = '';
        await runChatScopeStoreMutation(async () => {
          const t = await duplicateTaskInStore(task.id, { afterTaskId: task.id }, 'ui');
          clonedId = t.id;
          clonedName = t.name;
        });
        selectedTaskId.value = clonedId;
        acuToast('success', `已复制为新副本「${clonedName}」`);
      } catch (e) {
        acuToast('warning', e instanceof Error ? e.message : String(e));
      }
    })();
    return;
  }
  const cloned = cloneTaskForInsert(task, displayTasks.value);
  insertClonedTask(cloned, task.id);
  acuToast('success', `已复制为新副本「${cloned.name}」`);
}

function copySelectedTask(): void {
  const task = selectedTask.value;
  if (!task) return;
  copyTaskToClipboard(task, settings.value.activePresetName);
  acuToast('success', `已跨预设复制「${task.name.trim() || '未命名任务'}」`);
}

function onReplicaScheduleModeChange(mode: ReplicaFamilyScheduleMode): void {
  const root = selectedTask.value;
  if (!root) return;
  if (chatScopeActive.value) {
    void runChatScopeStoreMutation(() => updateReplicaFamilyScheduleModeInStore(root.id, mode, 'ui')).catch(e =>
      acuToast('warning', e instanceof Error ? e.message : String(e)),
    );
    return;
  }
  const idx = settings.value.tasks.findIndex(t => t.id === root.id);
  if (idx >= 0) settings.value.tasks[idx]!.replicaFamilyScheduleMode = mode;
}

function onReplicaMemberScheduleChange(memberId: string, patch: { launched?: boolean }): void {
  if (chatScopeActive.value) {
    void runChatScopeStoreMutation(() => updateReplicaMemberScheduleInStore(memberId, patch, 'ui')).catch(e =>
      acuToast('warning', e instanceof Error ? e.message : String(e)),
    );
    return;
  }
  const idx = settings.value.tasks.findIndex(t => t.id === memberId);
  if (idx < 0) return;
  const member = settings.value.tasks[idx]!;
  if (patch.launched !== undefined) member.replicaFamilyLaunched = patch.launched;
}

async function onCreateReplicaMember(): Promise<void> {
  const root = selectedTask.value;
  if (!root?.syncAsReplicaFamily || root.replicaFamilyRootId) return;

  const baseName = (root.replicaFamilyBaseName ?? root.name).trim() || '副本族';
  const spec = root.replicaFamilyEnumSpec?.trim() || root.replicaFamilySpec?.trim() || '标签@属性';
  const name = await acuPrompt({
    title: '新建任务副本',
    message: `请输入属性值（将作为「${baseName}」副本后缀，对应 ${spec}）：`,
    confirmText: '创建',
    danger: false,
    prompt: { placeholder: '例如 阿斯塔利亚' },
  });
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    acuToast('warning', '副本属性值不能为空');
    return;
  }

  const exists = replicaFamilyMembers.value.some(m => (m.replicaFamilyAttrValue ?? '').trim() === trimmed);
  if (exists) {
    acuToast('warning', `副本「${trimmed}」已存在`);
    return;
  }

  try {
    if (chatScopeActive.value) {
      await runChatScopeStoreMutation(() =>
        ensureReplicaFamilyMemberInStore(root.id, trimmed, { launched: true }, 'ui'),
      );
    } else {
      await ensureReplicaFamilyMemberInStore(root.id, trimmed, { launched: true }, 'ui');
      settings.value.tasks = listTasks();
    }
    acuToast('success', `已创建副本「${trimmed}」`);
  } catch (e) {
    console.error(`${SCRIPT_LOG_PREFIX} 新建副本失败:`, e);
    acuToast('warning', e instanceof Error ? e.message : String(e));
  }
}

function resolveReplicaCleanupMessageFloorId(): number {
  const fromRun = settings.value.lastRunStatus?.messageId;
  if (fromRun != null) {
    const normalized = normalizeMessageFloorId(fromRun);
    if (normalized != null) return normalized;
  }
  const latest = findLatestAccessibleFloorId();
  return latest ?? 0;
}

async function deleteSelectedReplicaMember(): Promise<void> {
  const root = selectedTask.value;
  if (!root?.syncAsReplicaFamily) return;
  const target = editorTask.value;
  if (!target?.replicaFamilyRootId || target.id === root.id) return;

  const attrValue = (target.replicaFamilyAttrValue ?? '').trim();
  const attrLabel = attrValue || target.name.trim() || '该副本';
  const rootLabel = (root.replicaFamilyBaseName ?? root.name).trim() || '副本族';
  const enumSpec = getReplicaFamilyEnumSpecKey(root).trim();
  const floorId = resolveReplicaCleanupMessageFloorId();
  const floorHint =
    floorId > 0 && isAccessibleMessageFloor(floorId)
      ? `并清除楼层 #${floorId} 中对应的 post_process_tags 变量 key`
      : '（当前无法定位可写楼层，将仅删除副本任务）';

  if (
    !(await acuConfirm({
      message: enumSpec
        ? `删除规格「${enumSpec}」下的属性值「${attrLabel}」：所有声明该 spec 的副本族中对应成员都会移除，${floorHint}？`
        : `删除「${rootLabel}」的副本「${attrLabel}」，${floorHint}？`,
    }))
  ) {
    return;
  }

  if (!enumSpec || !attrValue) {
    acuToast('warning', '无法解析副本规格或属性值');
    return;
  }

  const keepAttrs = listAllAttrValuesForEnumSpec(
    { ...settings.value, tasks: displayTasks.value },
    enumSpec,
  ).filter(a => a !== attrValue);
  const keepBySpec = { [enumSpec]: keepAttrs };

  try {
    if (chatScopeActive.value) {
      await runChatScopeStoreMutation(() => applyReplicaFamilyCleanupInStore(keepBySpec, floorId, 'ui'));
    } else {
      const removedOut: RemovedReplicaCleanupInfo[] = [];
      const next = applyReplicaFamilyCleanup(settings.value, keepBySpec, floorId, {
        persistManualKeepBySpec: keepBySpec,
        removedOut,
      });
      settings.value.tasks = next.tasks;
      settings.value.replicaFamilyCleanup = next.replicaFamilyCleanup!;
      store.persist();
      await pruneWorldbookForRemovedReplicas(removedOut, settings.value.chatWorldbookWriteRules ?? []);
    }
    selectedReplicaViewId.value = null;
    acuToast('success', `已删除副本「${attrLabel}」`);
  } catch (e) {
    console.error(`${SCRIPT_LOG_PREFIX} 删除副本族副本失败:`, e);
    acuToast('error', `删除失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function syncWorkflowPresetsToViews(updated: PostProcessTask): void {
  const presets = _.cloneDeep(updated.taskWorkflowPresets ?? []);
  if (chatScopeActive.value) {
    const idx = viewTasks.value.findIndex(t => t.id === updated.id);
    if (idx >= 0) {
      viewTasks.value[idx] = { ...viewTasks.value[idx]!, taskWorkflowPresets: presets };
    }
    return;
  }
  const idx = settings.value.tasks.findIndex(t => t.id === updated.id);
  if (idx >= 0) {
    settings.value.tasks[idx] = { ...settings.value.tasks[idx]!, taskWorkflowPresets: presets };
  }
}

async function afterTaskWorkflowPresetMutation(updated: PostProcessTask): Promise<void> {
  syncWorkflowPresetsToViews(updated);
  if (chatScopeActive.value) {
    ensureReplicasMirroredInPlace(viewTasks.value);
    await refreshTaskView({ skipTasksFlush: true, skipPresetSync: true });
  } else {
    const idx = settings.value.tasks.findIndex(t => t.id === updated.id);
    if (idx >= 0) settings.value.tasks[idx] = updated;
    ensureReplicasMirroredInPlace(settings.value.tasks);
    store.saveActivePreset();
  }
}

async function runTaskWorkflowPresetStoreMutation(
  op: () => Promise<PostProcessTask>,
): Promise<PostProcessTask> {
  if (chatScopeActive.value) {
    await flushPendingWrites();
  } else {
    store.persist();
  }
  const updated = await op();
  await afterTaskWorkflowPresetMutation(updated);
  return updated;
}

function onTaskWorkflowPresetSave(name: string): void {
  const task = selectedTask.value;
  if (!task) return;
  void runTaskWorkflowPresetStoreMutation(() => saveTaskWorkflowPresetInStore(task.id, name, 'ui'))
    .then(() => acuToast('success', `已保存工作流预设「${name}」`))
    .catch(e => acuToast('warning', e instanceof Error ? e.message : String(e)));
}

function onTaskWorkflowPresetApply(name: string): void {
  const task = selectedTask.value;
  if (!task) return;
  void runTaskWorkflowPresetStoreMutation(() => applyTaskWorkflowPresetInStore(task.id, name, 'ui'))
    .then(() => acuToast('success', `已应用工作流预设「${name}」`))
    .catch(e => acuToast('warning', e instanceof Error ? e.message : String(e)));
}

function onTaskWorkflowPresetDelete(name: string): void {
  const task = selectedTask.value;
  if (!task) return;
  void runTaskWorkflowPresetStoreMutation(() => deleteTaskWorkflowPresetInStore(task.id, name, 'ui'))
    .then(() => acuToast('success', `已删除工作流预设「${name}」`))
    .catch(e => acuToast('warning', e instanceof Error ? e.message : String(e)));
}

function onTaskWorkflowPresetImport(entries: TaskWorkflowPresetEntry[]): void {
  const task = selectedTask.value;
  if (!task || entries.length === 0) return;
  const next = mergeTaskWorkflowPresetsOnTask(task, entries);
  void runTaskWorkflowPresetStoreMutation(() =>
    updateTaskInStore(task.id, { taskWorkflowPresets: next.taskWorkflowPresets }, 'ui'),
  )
    .then(() => acuToast('success', `已导入 ${entries.length} 个工作流预设`))
    .catch(e => acuToast('warning', e instanceof Error ? e.message : String(e)));
}

function pasteTask(): void {
  const source = clipboard.value;
  if (!source) {
    acuToast('warning', '剪贴板为空，请先复制任务');
    return;
  }
  const cloned = cloneTaskForInsert(source, displayTasks.value);
  insertClonedTask(cloned, selectedTaskId.value || undefined);
  acuToast('success', `已粘贴为「${cloned.name}」`);
}

async function addTask() {
  if (chatScopeActive.value) {
    try {
      let newId = '';
      await runChatScopeStoreMutation(async () => {
        const task = await createTaskInStore(undefined, 'ui');
        newId = task.id;
      });
      selectedTaskId.value = newId;
    } catch (e) {
      acuToast('warning', e instanceof Error ? e.message : String(e));
    }
    return;
  }
  const task: PostProcessTask = {
    id: newTaskId(),
    name: '新任务',
    enabled: true,
    stage: 1,
    extractInjectTags: ['result'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    apiPresetFallbackNames: [],
    apiPrimaryMaxConcurrency: 5,
    apiFallbackMaxConcurrencies: [],
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    promptGroups: [{ name: '', role: 'user', content: '当前 AI 回复：$7', enabled: true }],
    promptAutoSlots: [],
    promptAutoSegments: [],
  };
  settings.value.tasks.push(task);
  selectedTaskId.value = task.id;
}

function moveTask(index: number, delta: -1 | 1) {
  const task = taskTabTasks.value[index];
  if (!task) return;
  if (chatScopeActive.value) {
    void runChatScopeStoreMutation(() => moveTaskInStore(task.id, delta, 'ui')).catch(e =>
      acuToast('warning', e instanceof Error ? e.message : String(e)),
    );
    return;
  }
  const arr = settings.value.tasks;
  const fullIndex = arr.findIndex(t => t.id === task.id);
  if (fullIndex < 0) return;
  const target = fullIndex + delta;
  if (target < 0 || target >= arr.length) return;
  const [item] = arr.splice(fullIndex, 1);
  arr.splice(target, 0, item);
}

async function removeTask(id: string) {
  const task = displayTasks.value.find(t => t.id === id);
  if (!task) return;
  const label = task.name?.trim() || '未命名任务';
  if (!(await acuConfirm({ message: `删除任务「${label}」？` }))) return;
  if (chatScopeActive.value) {
    try {
      await runChatScopeStoreMutation(() => deleteTaskInStore(id, 'ui'));
    } catch (e) {
      acuToast('warning', e instanceof Error ? e.message : String(e));
      return;
    }
  } else {
    settings.value.tasks = settings.value.tasks.filter(t => t.id !== id);
  }
  if (selectedTaskId.value === id) {
    selectedTaskId.value = displayTasks.value[0]?.id ?? '';
  }
}

async function removePromptGroup(index: number): Promise<void> {
  const task = promptPreviewTask.value ?? selectedTask.value;
  if (!task || isViewingReplicaMember.value) return;
  const pg = task.promptGroups[index];
  const label = pg?.name?.trim() ? `「${pg.name.trim()}」` : `第 ${index + 1} 段`;
  if (!(await acuConfirm({ message: `删除提示词段 ${label}？` }))) return;
  try {
    // 与 add/move 一致：先改本地再落盘，避免 store→refresh 被待落盘旧 viewTasks 覆盖
    task.promptGroups = removePromptGroupAt(task.promptGroups ?? [], index);
    expandedPromptRowKeys.value = remapManualExpandedKeysAfterRemove(expandedPromptRowKeys.value, index);
    await persistPromptGroupsNow();
  } catch (e) {
    acuToast('warning', e instanceof Error ? e.message : '无法删除提示词段');
  }
}

function applyPromptGroupsReorder(fromIndex: number, toIndex: number): void {
  const task = promptPreviewTask.value ?? selectedTask.value;
  if (!task || fromIndex === toIndex) return;
  task.promptGroups = reorderPromptGroupsAt(task.promptGroups ?? [], fromIndex, toIndex);
  expandedPromptRowKeys.value = remapManualExpandedKeys(expandedPromptRowKeys.value, fromIndex, toIndex);
}

/** 有快照：mirror 后立刻 replaceTasks，并写回 viewTasks；无快照：立刻 persist 全局。 */
async function persistPromptGroupsIfChatScope(): Promise<void> {
  if (!chatScopeActive.value) return;
  if (persistViewTasksTimer) {
    clearTimeout(persistViewTasksTimer);
    persistViewTasksTimer = null;
  }
  const draftTasks = _.cloneDeep(viewTasks.value);
  ensureReplicasMirroredInPlace(draftTasks);
  const changed = !_.isEqual(draftTasks, viewTasks.value);
  refreshingTaskView = true;
  try {
    if (changed) {
      viewTasks.value = draftTasks;
    }
    await replaceTasks(draftTasks, 'ui');
  } finally {
    await nextTick();
    if (persistViewTasksTimer) {
      clearTimeout(persistViewTasksTimer);
      persistViewTasksTimer = null;
    }
    refreshingTaskView = false;
  }
}

async function persistPromptGroupsNow(): Promise<void> {
  if (chatScopeActive.value) {
    await persistPromptGroupsIfChatScope();
    return;
  }
  persistGlobalSettingsNow();
}

async function movePromptGroup(index: number, delta: -1 | 1): Promise<void> {
  const task = promptPreviewTask.value ?? selectedTask.value;
  if (!task) return;
  try {
    const next = movePromptGroupAt(task.promptGroups ?? [], index, delta);
    const toIndex = index + delta;
    task.promptGroups = next;
    expandedPromptRowKeys.value = remapManualExpandedKeys(expandedPromptRowKeys.value, index, toIndex);
    await persistPromptGroupsNow();
  } catch {
    // 边界不可移动时静默忽略
  }
}

async function reorderPromptGroup(fromIndex: number, toIndex: number): Promise<void> {
  const task = promptPreviewTask.value ?? selectedTask.value;
  if (!task) return;
  try {
    applyPromptGroupsReorder(fromIndex, toIndex);
    await persistPromptGroupsNow();
  } catch {
    // 越界等异常静默忽略
  }
}

async function addPromptGroup(): Promise<void> {
  const task = promptPreviewTask.value ?? selectedTask.value;
  if (!task || isViewingReplicaMember.value) return;
  try {
    // 与 move/reorder 一致：先改本地再落盘，避免 store→refresh 被待落盘旧 viewTasks 覆盖
    const next = appendPromptGroup(task.promptGroups ?? []);
    task.promptGroups = next;
    expandedPromptRowKeys.value = new Set([`m-${next.length - 1}`]);
    await persistPromptGroupsNow();
  } catch (e) {
    acuToast('warning', e instanceof Error ? e.message : '无法添加提示词段');
  }
}

async function applyBuiltinPreset(name: string) {
  if (hasChatSnapshot.value) {
    // 切换前先落盘 snapshot 视图下的 debounce，避免后续 refresh 在 global 视图误写回快照
    await flushPendingWrites();
    if (name === CHAT_SNAPSHOT_PRESET_NAME) {
      await setChatScopeActiveView({ view: 'snapshot' });
    } else {
      const ok = await setChatScopeActiveView({ view: 'global', presetName: name });
      if (!ok) {
        acuToast('warning', `无法切换到预设「${name}」`);
        presetDropdownValue.value = getChatPresetDropdownValue();
        return;
      }
    }
    await refreshTaskView();
    selectedTaskId.value = displayTasks.value[0]?.id ?? '';
    return;
  }
  store.applyPreset(name);
  selectedTaskId.value = settings.value.tasks[0]?.id ?? '';
  presetDropdownValue.value = getChatPresetDropdownValue();
}

async function handleClearChatScope() {
  if (
    !(await acuConfirm({
      message: '清除当前聊天的临时快照？将恢复使用全局活动预设的任务。',
    }))
  ) {
    return;
  }
  await clearChatScope('ui');
  store.reload();
  void refreshTaskView();
  selectedTaskId.value = settings.value.tasks[0]?.id ?? '';
  acuToast('success', '已清除聊天快照');
}

let offTasksChanged: EventOnReturn | null = null;
let offChatScopeChanged: EventOnReturn | null = null;

onMounted(() => {
  document.addEventListener('keydown', onFullscreenKeydown);
  refreshWorldbookNamesList();
  syncAllRuleBookTargetSnapshots();
  void refreshTaskView();
  offTasksChanged = eventOn(ACU_PP_TASKS_CHANGED, (payload?: TasksChangedPayload) => {
    if (payload?.source === 'ui') {
      // 浏览全局写回只更新了脚本变量里的 presets；同步 pinia 列表，避免导出/保存读到旧槽
      settings.value.presets = _.cloneDeep(loadSettings().presets);
      void refreshTaskView({ skipTaskReload: true, skipTasksFlush: true, skipPresetSync: true });
      return;
    }
    if (persistPresetFieldsTimer) {
      clearTimeout(persistPresetFieldsTimer);
      persistPresetFieldsTimer = null;
    }
    if (persistViewTasksTimer) {
      clearTimeout(persistViewTasksTimer);
      persistViewTasksTimer = null;
    }
    store.reload();
    void refreshTaskView({ skipTasksFlush: true, skipPresetFlush: true });
  });
  offChatScopeChanged = eventOn(ACU_PP_CHAT_SCOPE_CHANGED, (payload?: ChatScopeChangedPayload) => {
    if (payload?.createdSnapshot) {
      acuToast('info', '本聊天已自动创建任务快照，编辑/运行将优先作用于本聊快照', { timeOut: 4500 });
    }
    if (suppressChatScopeRefresh) return;
    void refreshTaskView();
  });
});

onUnmounted(() => {
  document.removeEventListener('keydown', onFullscreenKeydown);
  offTasksChanged?.stop();
  offChatScopeChanged?.stop();
  promptDragCleanup?.();
  promptDragCleanup = null;
  promptDrag.value = null;
  // 有快照：关窗前按当前视图 flush（快照→快照；全局→绑定全局预设）
  if (hasChatSnapshot.value) {
    void flushPendingWrites();
  } else {
    if (persistViewTasksTimer) clearTimeout(persistViewTasksTimer);
    if (persistPresetFieldsTimer) clearTimeout(persistPresetFieldsTimer);
  }
  persistViewTasksTimer = null;
  persistPresetFieldsTimer = null;
  if (persistGlobalSettingsTimer) {
    clearTimeout(persistGlobalSettingsTimer);
    persistGlobalSettingsTimer = null;
  }
  if (!chatScopeActive.value) store.persist();
});

async function handleRerun() {
  const { rerunCurrentFloor } = await import('../tasks/trigger');
  await rerunCurrentFloor();
  store.reload();
}

function saveTaskPreset() {
  if (hasChatSnapshot.value) {
    const bound = chatScopeInfo.value?.boundGlobalPresetName?.trim() ?? '';
    if (isBrowsingGlobalPreset.value && bound) {
      void (async () => {
        await flushPendingWrites();
        // 展示态 tasks 在 viewTasks；与注入等字段合并后再写入绑定全局槽
        const display = _.cloneDeep(settings.value);
        display.tasks = _.cloneDeep(viewTasks.value);
        if (saveNamedGlobalPresetFromDisplay(display, bound)) {
          acuToast('success', `全局预设「${bound}」已保存`);
        } else {
          acuToast('warning', '保存失败：绑定的全局预设不存在');
        }
      })();
      return;
    }
    acuToast('warning', '当前为聊天快照视图：修改已自动写入快照；拷贝请用「另存为」，或先切到全局预设再保存');
    return;
  }
  if (!settings.value.activePresetName.trim()) {
    acuToast('warning', '请先选择当前预设');
    return;
  }
  if (store.saveActivePreset()) {
    acuToast('success', `预设「${settings.value.activePresetName}」已保存`);
  }
}

async function handleOverwriteChatSnapshot(): Promise<void> {
  if (!isBrowsingGlobalPreset.value) {
    acuToast('warning', '请先在下拉中选择要用来覆盖的全局预设');
    return;
  }
  const bound = chatScopeInfo.value?.boundGlobalPresetName?.trim() || '当前全局预设';
  if (
    !(await acuConfirm({
      message: `将用全局预设「${bound}」的当前内容覆盖本聊天快照，并切换到「当前聊天快照」。是否继续？`,
    }))
  ) {
    return;
  }
  suppressChatScopeRefresh = true;
  try {
    await flushPendingWrites();
    await forkEffectiveIntoChatSnapshot('ui');
    await refreshTaskView({ skipTasksFlush: true, skipPresetFlush: true });
  } finally {
    suppressChatScopeRefresh = false;
  }
  acuToast('success', '已用当前全局预设覆盖聊天快照');
}

async function confirmEditRecommendedModel(): Promise<void> {
  const task = selectedTask.value;
  if (!task) return;
  const value = await acuPrompt({
    title: '编辑推荐模型',
    message: '请输入推荐模型名称（仅用于展示，不影响实际 API 调用）：',
    confirmText: '确定',
    danger: false,
    prompt: {
      placeholder: '例如 deepseek-chat',
      defaultValue: task.recommendedModel ?? '',
    },
  });
  if (value === null) return;
  task.recommendedModel = value.trim();
}

async function confirmRenameSelectedTask(): Promise<void> {
  const task = selectedTask.value;
  if (!task) return;
  const newName = await acuPrompt({
    title: '重命名任务',
    message: '请输入新的任务名称：',
    confirmText: '确定',
    danger: false,
    prompt: {
      placeholder: '任务名称',
      defaultValue: task.name,
    },
  });
  if (!newName) return;
  if (newName === (task.name?.trim() || '')) return;
  const otherNames = new Set(displayTasks.value.filter(t => t.id !== task.id).map(t => t.name.trim()));
  if (otherNames.has(newName)) {
    acuToast('warning', `任务「${newName}」已存在，请换一个名称`);
    return;
  }
  if (!settings.value.activePresetName.trim()) {
    acuToast('warning', '请先选择当前预设');
    return;
  }
  task.name = newName;
  if (chatScopeActive.value) {
    schedulePersistViewTasks();
    acuToast('success', `任务已重命名为「${newName}」`);
    return;
  }
  if (store.saveActivePreset()) {
    acuToast('success', `任务已重命名为「${newName}」并已保存预设`);
  }
}

async function confirmSaveTaskPresetAsNew(): Promise<void> {
  const origin = chatScopeInfo.value?.originPresetName?.trim();
  const defaultName = hasChatSnapshot.value
    ? origin
      ? `聊天快照-${origin}`
      : `聊天快照-${new Date().toLocaleString('zh-CN')}`
    : settings.value.activePresetName;
  const name = await acuPrompt({
    title: hasChatSnapshot.value ? '将聊天快照另存为全局预设' : '保存为新预设',
    message: hasChatSnapshot.value
      ? '将从「当前聊天快照」创建新的全局预设，并保留本聊天快照。'
      : '请输入新预设名称：',
    confirmText: '保存',
    danger: false,
    prompt: {
      placeholder: '新预设名称',
      defaultValue: defaultName,
    },
  });
  if (!name?.trim()) return;
  const trimmed = name.trim();
  if (trimmed === CHAT_SNAPSHOT_PRESET_NAME) {
    acuToast('warning', '不能使用保留名称');
    return;
  }
  if (settings.value.presets.some(p => p.name === trimmed)) {
    acuToast('warning', `预设「${trimmed}」已存在，请换一个名称`);
    return;
  }
  if (hasChatSnapshot.value) {
    const saved = await saveChatSnapshotAsGlobalPreset(trimmed);
    if (!saved) {
      acuToast('warning', '另存失败：无可用聊天快照或名称冲突');
      return;
    }
    store.reload();
    acuToast('success', `已将聊天快照另存为全局预设「${saved}」`);
    return;
  }
  const saved = store.saveAsNewPreset(trimmed);
  if (saved) {
    acuToast('success', `已保存为新预设「${saved}」`);
  }
}

async function confirmDeleteTaskPreset(): Promise<void> {
  if (hasChatSnapshot.value && !isBrowsingGlobalPreset.value) {
    acuToast('warning', '请先在下拉中切到要删除的全局预设（快照视图下不能删全局预设）');
    return;
  }
  const name = hasChatSnapshot.value
    ? (chatScopeInfo.value?.boundGlobalPresetName?.trim() ?? '')
    : settings.value.activePresetName.trim();
  if (!name) {
    acuToast('warning', '请先选择要删除的预设');
    return;
  }
  if (settings.value.presets.length <= 1) {
    acuToast('warning', '至少需保留 1 个任务预设');
    return;
  }
  if (
    !(await acuConfirm({
      message: hasChatSnapshot.value
        ? `删除全局预设「${name}」？\n不会清除本聊天快照；下拉将切到其他全局或快照。`
        : `删除任务预设「${name}」？\n当前编辑中的任务与上下文配置将切换到其他预设。`,
    }))
  ) {
    return;
  }
  if (!store.deleteTaskPreset(name)) {
    acuToast('warning', `无法删除预设「${name}」`);
    return;
  }
  if (hasChatSnapshot.value) {
    const remaining = settings.value.presets.map(p => p.name);
    const nextGlobal = remaining[0];
    if (nextGlobal) {
      await setChatScopeActiveView({ view: 'global', presetName: nextGlobal });
    } else {
      await setChatScopeActiveView({ view: 'snapshot' });
    }
    await refreshTaskView();
    selectedTaskId.value = displayTasks.value[0]?.id ?? '';
  } else {
    selectedTaskId.value = settings.value.tasks[0]?.id ?? '';
  }
  acuToast('success', `已删除任务预设「${name}」`);
}

function downloadSettingsJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function downloadTextFile(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function sanitizeLogFilenamePart(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
  return cleaned || 'task';
}

function exportAllRunLogs(): void {
  const status = settings.value.lastRunStatus;
  if (!status?.taskResults?.length) {
    acuToast('warning', '暂无运行日志可导出');
    return;
  }
  const mid = status.messageId ?? 'unknown';
  downloadTextFile(formatAllRunLogsText(), `workflow-assistant-run-log-all-floor${mid}.txt`);
  acuToast('success', '已导出全部运行日志');
}

function exportTaskRunLog(task: RunLogTaskResult): void {
  const safeName = sanitizeLogFilenamePart(task.taskName || task.taskId);
  downloadTextFile(formatRunLogTaskText(task), `workflow-assistant-run-log-${safeName}.txt`);
  acuToast('success', `已导出任务「${task.taskName}」日志`);
}

function exportPresetJson() {
  if (hasChatSnapshot.value) {
    const display = _.cloneDeep(settings.value);
    display.tasks = _.cloneDeep(viewTasks.value);
    const name = isBrowsingGlobalPreset.value
      ? chatScopeInfo.value?.boundGlobalPresetName?.trim() || settings.value.activePresetName
      : `聊天快照-${chatScopeInfo.value?.originPresetName || 'export'}`;
    const preset = buildShareablePresetExport(display, name);
    const safeName = sanitizeLogFilenamePart(preset.name);
    downloadSettingsJson(preset, `workflow-assistant-preset-${safeName}.json`);
    return;
  }
  const preset = buildShareablePresetExport(settings.value);
  const safeName = sanitizeLogFilenamePart(preset.name);
  downloadSettingsJson(preset, `workflow-assistant-preset-${safeName}.json`);
}

function triggerImportPreset() {
  importFileInput.value?.click();
}

async function onImportPresetFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const data: unknown = JSON.parse(text);
    if (hasChatSnapshot.value) {
      const result = store.importPresetFromJson(data, file.name, { apply: false });
      const ok = await setChatScopeActiveView({ view: 'global', presetName: result.name });
      if (!ok) {
        acuToast('warning', `已写入全局预设「${result.name}」，但无法切换浏览`);
      } else {
        await refreshTaskView();
        selectedTaskId.value = displayTasks.value[0]?.id ?? '';
      }
      if (result.strippedApiSecrets) {
        acuToast(
          'info',
          `已导入全局预设「${result.name}」并切换浏览（未改聊天快照）；已忽略文件中的 API 配置`,
        );
      } else {
        acuToast('success', `已导入全局预设「${result.name}」并切换浏览（未改聊天快照）`);
      }
      return;
    }
    const result = store.importPresetFromJson(data, file.name);
    selectedTaskId.value = settings.value.tasks[0]?.id ?? '';
    if (result.strippedApiSecrets) {
      acuToast('info', `已导入并应用预设「${result.name}」；已忽略文件中的 API 配置，请在本机 API 页填写密钥`);
    } else {
      acuToast('success', `已导入并应用预设「${result.name}」`);
    }
  } catch (error) {
    console.error(`${SCRIPT_LOG_PREFIX} 导入预设失败:`, error);
    acuToast('error', `导入预设失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatRunLogTime(at?: number): string {
  if (!at) return '';
  return new Date(at).toLocaleString('zh-CN');
}

function runLogStatusText(r: { skipped?: boolean; skipReason?: string; success?: boolean }): string {
  if (r.skipped) return `跳过${r.skipReason ? `（${r.skipReason}）` : ''}`;
  if (r.success) return '成功';
  return '失败';
}

function runLogHadApiRequest(r: { skipped?: boolean; promptMessages?: unknown[] }): boolean {
  return !r.skipped && (r.promptMessages?.length ?? 0) > 0;
}

function runLogAiOutputText(r: { aiOutput?: string }): string {
  return String(r.aiOutput ?? '').trim();
}

function runLogAiReasoningText(r: { aiReasoning?: string }): string {
  return String(r.aiReasoning ?? '').trim();
}

function runLogDurationText(durationMs: number): string {
  const minutes = durationMs / 60_000;
  if (minutes < 10) return `${minutes.toFixed(2)}min`;
  if (minutes < 100) return `${minutes.toFixed(1)}min`;
  return `${Math.round(minutes)}min`;
}

function runLogPromptSegmentTitle(msg: { role: string; name?: string }): string {
  const segmentName = msg.name?.trim() || '未命名段';
  return `[${msg.role}] ${segmentName}`;
}

function runLogExtractedTagEntries(r: { extractedTags?: Record<string, string> }): [string, string][] {
  const tags = filterXmlExtractedTagsForDisplay(r.extractedTags ?? {});
  return Object.entries(tags);
}

function runLogWritableTagNames(): Set<string> {
  return getPostProcessWritableTagNames(settings.value, settings.value.lastRunStatus?.taskResults ?? []);
}

function runLogWritableTagEntries(r: { extractedTags?: Record<string, string> }): [string, string][] {
  const writable = runLogWritableTagNames();
  return runLogExtractedTagEntries(r).filter(([tag]) => writable.has(tag));
}

function runLogOtherTagEntries(r: { extractedTags?: Record<string, string> }): [string, string][] {
  const writable = runLogWritableTagNames();
  const rules = settings.value.chatWorldbookWriteRules ?? [];
  return runLogExtractedTagEntries(r).filter(
    ([tag]) => !writable.has(tag) && !isTagKeyManagedByWorldbookWriteRules(tag, rules),
  );
}

const runLogTagDrafts = ref<Record<string, Record<string, string>>>({});
const runLogTagEditMode = ref<Record<string, boolean>>({});

function runLogTagExportValue(taskId: string, tag: string, fallback: string): string {
  const draft = runLogTagDrafts.value[taskId]?.[tag];
  return draft !== undefined ? draft : fallback;
}

function formatRunLogTaskText(task: RunLogTaskResult): string {
  const lines: string[] = [];
  lines.push(`任务：${task.taskName}`);

  const metaParts: string[] = [];
  if (task.stage != null) metaParts.push(`阶段 ${task.stage}`);
  metaParts.push(runLogStatusText(task));
  if (task.durationMs != null) metaParts.push(runLogDurationText(task.durationMs));
  lines.push(metaParts.join(' · '));
  lines.push('');

  const writable = runLogWritableTagEntries(task);
  if (writable.length) {
    lines.push('## 摘取标签');
    for (const [tag, value] of writable) {
      lines.push(`### ${tag}`);
      lines.push(runLogTagExportValue(task.taskId, tag, value));
      lines.push('');
    }
  }

  const other = runLogOtherTagEntries(task);
  if (other.length) {
    lines.push('## 其他摘取（不写入 post_process_tags）');
    for (const [tag, value] of other) {
      lines.push(`### ${tag}`);
      lines.push(runLogTagExportValue(task.taskId, tag, value));
      lines.push('');
    }
  }

  if (task.promptMessages?.length) {
    lines.push('## 请求提示词');
    for (const msg of task.promptMessages) {
      lines.push(`### ${runLogPromptSegmentTitle(msg)}`);
      lines.push(msg.content ?? '');
      lines.push('');
    }
  } else if (task.skipped || !task.success) {
    lines.push('## 请求提示词');
    lines.push('（本任务未发起 API 请求）');
    lines.push('');
  }

  if (runLogHadApiRequest(task)) {
    lines.push('## AI 输出');
    lines.push(runLogAiOutputText(task) || '（无输出内容）');
    lines.push('');
  }

  const reasoning = runLogAiReasoningText(task);
  if (reasoning) {
    lines.push('## 推理内容 (reasoning_content)');
    lines.push(reasoning);
    lines.push('');
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function formatAllRunLogsText(): string {
  const status = settings.value.lastRunStatus;
  const lines: string[] = ['运行日志'];
  const metaParts: string[] = [];
  if (status?.messageId != null) metaParts.push(`楼层 #${status.messageId}`);
  if (status?.at) metaParts.push(formatRunLogTime(status.at));
  if (metaParts.length) lines.push(metaParts.join(' · '));
  lines.push('');

  for (const task of status?.taskResults ?? []) {
    lines.push('==========');
    lines.push(formatRunLogTaskText(task));
    lines.push('');
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function initRunLogTagDrafts(): void {
  const drafts: Record<string, Record<string, string>> = {};
  const editMode: Record<string, boolean> = {};
  for (const r of settings.value.lastRunStatus?.taskResults ?? []) {
    if (!r.taskId) continue;
    drafts[r.taskId] = _.cloneDeep(filterXmlExtractedTagsForDisplay(r.extractedTags ?? {}));
    editMode[r.taskId] = false;
  }
  runLogTagDrafts.value = drafts;
  runLogTagEditMode.value = editMode;
}

watch(
  () => [settings.value.lastRunStatus?.messageId, settings.value.lastRunStatus?.at] as const,
  () => initRunLogTagDrafts(),
  { immediate: true },
);

function isRunLogTagEditing(taskId: string): boolean {
  return !!runLogTagEditMode.value[taskId];
}

function revertRunLogTagDraft(taskId: string): void {
  const result = settings.value.lastRunStatus?.taskResults?.find(t => t.taskId === taskId);
  if (!result) return;
  runLogTagDrafts.value[taskId] = _.cloneDeep(filterXmlExtractedTagsForDisplay(result.extractedTags ?? {}));
}

function toggleRunLogTagEdit(taskId: string): void {
  if (isRunLogTagEditing(taskId)) {
    revertRunLogTagDraft(taskId);
    runLogTagEditMode.value[taskId] = false;
  } else {
    runLogTagEditMode.value[taskId] = true;
  }
}

function isRunLogTagDraftDirty(taskId: string): boolean {
  const result = settings.value.lastRunStatus?.taskResults?.find(t => t.taskId === taskId);
  if (!result) return false;
  const draft = runLogTagDrafts.value[taskId] ?? {};
  const saved = result.extractedTags ?? {};
  const writable = runLogWritableTagNames();
  for (const key of writable) {
    if (String(draft[key] ?? '').trim() !== String(saved[key] ?? '').trim()) return true;
  }
  return false;
}

function saveRunLogTaskTags(taskId: string): void {
  const messageId = settings.value.lastRunStatus?.messageId;
  if (messageId == null) {
    acuToast('warning', '无运行楼层信息，无法保存');
    return;
  }
  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') {
    acuToast('warning', '目标楼层不存在或不是 AI 回复楼');
    return;
  }
  const draft = runLogTagDrafts.value[taskId];
  if (!draft) return;

  const writable = runLogWritableTagNames();
  const toWrite = pickTagsForPostProcessWrite(draft, writable);
  for (const key of Object.keys(toWrite)) {
    if (isEnumRegistryMarker(toWrite[key] ?? '')) delete toWrite[key];
  }
  if (!Object.keys(toWrite).length) {
    acuToast('warning', '当前模板未声明可写入的标签，或本任务无可写入摘取');
    return;
  }

  try {
    writeFloorTagValues(messageId, toWrite);
    const result = settings.value.lastRunStatus?.taskResults?.find(t => t.taskId === taskId);
    if (result) {
      const next = { ...(result.extractedTags ?? {}) };
      for (const key of writable) {
        if (!(key in draft)) continue;
        const text = String(draft[key] ?? '').trim();
        if (text) next[key] = draft[key];
        else delete next[key];
      }
      result.extractedTags = next;
    }
    store.persist();
    runLogTagEditMode.value[taskId] = false;
    acuToast('success', '已写入本层 post_process_tags');
  } catch (e) {
    console.error(`${SCRIPT_LOG_PREFIX} 保存摘取标签失败:`, e);
    acuToast('error', `保存失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}
</script>

<template>
  <div class="acu-overlay acu-pp-root" :class="{ 'acu-overlay--fullscreen': windowFullscreen }">
    <div class="acu-window" :class="{ 'acu-window--fullscreen': windowFullscreen }">
      <div class="acu-window-header">
        <div class="acu-window-title">
          <span class="acu-window-title-mark">流</span>
          <span>{{ SCRIPT_DISPLAY_NAME }} · 设置</span>
        </div>
        <div class="acu-window-header-end">
          <div class="acu-theme-switch" role="group" aria-label="界面主题">
            <button
              v-for="theme in UI_THEMES"
              :key="theme.id"
              type="button"
              class="acu-theme-btn"
              :class="{ active: settings.uiThemeId === theme.id }"
              :title="theme.name"
              @click="selectUiTheme(theme.id)"
            >
              {{ theme.name }}
            </button>
          </div>
          <button
            class="acu-btn acu-icon-btn acu-fullscreen-toggle"
            type="button"
            :title="windowFullscreen ? '退出全屏' : '全屏'"
            :aria-pressed="windowFullscreen"
            @click="toggleWindowFullscreen"
          >
            <i class="fa-fw fa-solid" :class="windowFullscreen ? 'fa-compress' : 'fa-expand'" aria-hidden="true"></i>
          </button>
          <button class="acu-btn acu-window-close" type="button" title="关闭" @click="closeWindow">×</button>
        </div>
      </div>
      <div class="acu-page-tabs">
        <button
          v-for="tab in PAGE_TABS"
          :key="tab.id"
          type="button"
          class="acu-page-tab"
          :class="{ active: currentPage === tab.id }"
          @click="goToPage(tab.id)"
        >
          <span class="acu-page-tab__full">{{ tab.label }}</span>
          <span class="acu-page-tab__short">{{ tab.shortLabel }}</span>
        </button>
      </div>
      <div class="acu-window-body">
        <div v-show="currentPage === 1" class="acu-page">
          <div class="acu-section">
            <div class="acu-row acu-row--inline">
              <AcuToggle v-model="settings.enabled" :label="`启用 ${SCRIPT_DISPLAY_NAME}`" />
            </div>
            <div class="acu-row acu-row--inline">
              <AcuToggle v-model="settings.messageVarRetention.enabled" label="自动清理旧楼层变量" />
            </div>
            <div class="acu-row">
              <input
                v-model.number="settings.messageVarRetention.keepFloors"
                class="acu-input"
                type="number"
                min="1"
                step="1"
                style="width: 72px"
                :disabled="!settings.messageVarRetention.enabled"
              />
              <label class="acu-label-with-help">
                要保留变量的最近楼层数
                <AcuHelpIconBtn
                  v-model:open="messageVarRetentionHelpOpen"
                  panel-id="message-var-retention-help"
                  label="消息楼层变量保留说明"
                />
              </label>
            </div>
            <AcuHelpPanel
              v-model:open="messageVarRetentionHelpOpen"
              id="message-var-retention-help"
              label="消息楼层变量保留说明"
            >
              <p class="acu-notes acu-notes--sm" style="margin: 0">
                每次工作流执行完成后，自动删除更早楼层的<strong>全部</strong>消息楼层变量（含
                <code>stat_data</code> 与
                <code>post_process_tags</code>），并清理过旧楼层上的
                <code>acu_workflow_run_status</code> 运行快照（保留楼若仍是肥快照会压成轻量），<strong>不可恢复</strong>。最新楼始终保留，不影响变量继承。
              </p>
            </AcuHelpPanel>
          </div>

          <ApiConfigPanel />
        </div>

        <div v-show="currentPage === 2" class="acu-page">
          <PlotWorldbookSection :config="settings.plotWorldbookConfig" @update:config="onPlotWorldbookConfigUpdate" />
          <TaskPlotWorldbookPanel
            v-model:enabled="taskPlotWorldbookOverridesModel"
            :tasks="plotWorldbookPanelTasks"
            :default-plot-worldbook-config="settings.plotWorldbookConfig"
          />
          <Context7Section v-model:config="defaultContextConfigRef" />
          <TaskContextPanel
            v-model:enabled="taskContextOverridesModel"
            :tasks="taskTabTasks"
            :default-context-config="defaultContextConfigRef"
          />
          <div class="acu-section">
            <h4>$6 记忆回溯</h4>
            <p class="acu-notes">
              从世界书读取 shujuku
              <code>CustomExport-纪要-N</code>
              （兼认遗留总结条目）中带 AM 编码的行条目，取最近 N 条；若存在
              <code>纪要-包裹-上/下</code>
              则一并附上（不计 N）。
            </p>
            <div class="acu-row">
              <label>最近</label>
              <input
                v-model.number="memoryRecallRecentCountModel"
                class="acu-input"
                type="number"
                min="0"
                step="1"
                style="width: 5em"
              />
              <span>条 AM 纪要</span>
            </div>
          </div>

          <div class="acu-section">
            <h4>占位符说明</h4>
            <div class="acu-placeholder-legend">
              <div v-for="item in PLACEHOLDER_LEGEND" :key="item.code" class="acu-placeholder-item">
                <code>{{ item.code }}</code> — {{ item.desc }}
              </div>
              <p class="acu-notes" style="margin-top: 8px; margin-bottom: 0">
                相同执行阶段的任务并行执行；不同阶段按阶段号从小到大串行执行。任务完成后按「提取写入标签」从输出摘取标签（单任务输出内裸名取最后一次；<code
                  >标签@属性</code
                >
                如 <code>item@id</code> 按属性值分实例）；多任务/多阶段同名标签内文以换行合并为单段，供后续阶段的
                <code v-pre>{{ 标签名 }}</code> 占位符使用。多实例分别调用 API
                的场景（副本族）见任务页「提取写入标签」说明。
              </p>
            </div>
          </div>

          <div class="acu-section">
            <h4>已注册酒馆助手宏</h4>
            <div class="acu-placeholder-legend acu-macro-legend">
              <p class="acu-notes" style="margin-top: 0; margin-bottom: 8px">
                脚本加载时通过 <code>registerMacroLike</code> 注册，可在主聊天提示词、世界书、正则与 EJS
                宏阶段等走酒馆助手宏管线的文本中直接使用（无需再经工作流脚本
                <code v-pre>{{}}</code> 替换）。任务提示词内仍优先由脚本阶段解析。
              </p>
              <div v-for="item in REGISTERED_MACRO_LEGEND" :key="item.code" class="acu-placeholder-item">
                <code>{{ item.code }}</code> — {{ item.desc }}
              </div>
              <p class="acu-notes" style="margin-top: 8px; margin-bottom: 0">
                宏侧读当前（或上下文）楼层的 <code>post_process_tags</code> 与副本状态快照；无数据时替换为空。auto 的
                launched 过滤依赖最近一次工作流写入的 <code>lastEnumAttrValues</code>，旧楼未跑过 enum 时可能为空。
              </p>
            </div>
          </div>
        </div>

        <div v-show="currentPage === 3" class="acu-page">
          <div class="acu-section acu-preset-section">
            <h4>任务预设</h4>
            <p v-if="hasChatSnapshot" class="acu-notes acu-notes--sm" style="margin-top: 0">
              本聊天有独立快照（来源：{{ chatScopeInfo?.originPresetName || '未知' }}）。下拉可在「当前聊天快照」与全局预设间切换：看快照时编辑只写快照；看全局时手改只改该全局预设、不动快照（要用手改结果更新快照请点「覆盖快照」）。<strong>工作流实际运行跟下拉当前所选：</strong>停在全局时按该全局跑；运行/API 写回会先更新该全局，再覆盖本聊快照并切回「当前聊天快照」。另存可将快照拷贝为新的全局预设。
            </p>
            <div class="acu-row acu-preset-toolbar">
              <select
                :value="presetDropdownValue"
                class="acu-select acu-preset-select"
                @change="applyBuiltinPreset(($event.target as HTMLSelectElement).value)"
              >
                <option v-if="hasChatSnapshot" :value="CHAT_SNAPSHOT_PRESET_NAME">「当前聊天快照」</option>
                <option v-for="p in settings.presets" :key="p.name" :value="p.name">{{ p.name }}</option>
              </select>
              <div class="acu-preset-actions">
                <button
                  class="acu-btn acu-btn--sm acu-icon-btn"
                  type="button"
                  :title="
                    hasChatSnapshot
                      ? '导入为全局预设并切换浏览（不改聊天快照）'
                      : '导入预设'
                  "
                  aria-label="导入预设"
                  @click="triggerImportPreset"
                >
                  <i class="fa-fw fa-solid fa-file-import" aria-hidden="true"></i>
                </button>
                <button
                  class="acu-btn acu-btn--sm acu-icon-btn"
                  type="button"
                  title="导出 JSON（不含 API 配置）"
                  aria-label="导出 JSON"
                  @click="exportPresetJson"
                >
                  <i class="fa-fw fa-solid fa-file-export" aria-hidden="true"></i>
                </button>
                <button
                  class="acu-btn acu-btn--sm acu-icon-btn primary"
                  type="button"
                  :title="
                    hasChatSnapshot
                      ? isBrowsingGlobalPreset
                        ? '保存当前浏览的全局预设'
                        : '快照视图下请用自动写回或「另存为」；切到全局预设后可保存该全局'
                      : '保存预设'
                  "
                  aria-label="保存预设"
                  :disabled="hasChatSnapshot && !isBrowsingGlobalPreset"
                  @click="saveTaskPreset"
                >
                  <i class="fa-fw fa-solid fa-floppy-disk" aria-hidden="true"></i>
                </button>
                <button
                  class="acu-btn acu-btn--sm acu-icon-btn"
                  type="button"
                  :title="hasChatSnapshot ? '将聊天快照另存为新的全局预设（保留快照）' : '另存为新预设'"
                  aria-label="另存为新预设"
                  @click="confirmSaveTaskPresetAsNew"
                >
                  <i class="fa-fw fa-solid fa-clone" aria-hidden="true"></i>
                </button>
                <button
                  v-if="hasChatSnapshot"
                  class="acu-btn acu-btn--sm"
                  type="button"
                  title="用当前下拉选中的全局预设内容覆盖本聊天快照"
                  :disabled="!isBrowsingGlobalPreset"
                  @click="handleOverwriteChatSnapshot"
                >
                  覆盖快照
                </button>
                <button
                  v-if="hasChatSnapshot"
                  class="acu-btn acu-btn--sm"
                  type="button"
                  title="清除本聊天快照"
                  @click="handleClearChatScope"
                >
                  清除快照
                </button>
                <button
                  class="acu-btn acu-btn--sm acu-icon-btn danger"
                  type="button"
                  :title="
                    hasChatSnapshot && !isBrowsingGlobalPreset
                      ? '请先切到要删除的全局预设'
                      : settings.presets.length <= 1
                        ? '至少需保留 1 个预设'
                        : hasChatSnapshot
                          ? '删除当前浏览的全局预设（不清除聊天快照）'
                          : '删除当前活动预设'
                  "
                  aria-label="删除预设"
                  :disabled="settings.presets.length <= 1 || (hasChatSnapshot && !isBrowsingGlobalPreset)"
                  @click="confirmDeleteTaskPreset"
                >
                  <i class="fa-fw fa-solid fa-trash" aria-hidden="true"></i>
                </button>
                <input
                  ref="importFileInput"
                  type="file"
                  accept=".json,application/json"
                  hidden
                  @change="onImportPresetFile"
                />
              </div>
            </div>
          </div>

          <div class="acu-section">
            <div class="acu-heading-with-help">
              <h4>聊天摘取标签</h4>
              <AcuHelpIconBtn
                v-model:open="chatExtractTagsHelpOpen"
                panel-id="chat-extract-tags-help"
                label="聊天摘取标签说明"
              />
            </div>
            <AcuHelpPanel v-model:open="chatExtractTagsHelpOpen" id="chat-extract-tags-help" label="聊天摘取标签说明">
              <p class="acu-notes acu-notes--sm" style="margin-top: 0">
                预设级配置，从酒馆主聊天正文摘取标签并直接写入当前楼层
                <code>post_process_tags</code>，无需「消息楼层标签变量注入」模板。与任务级「提取写入标签」独立；同 key
                时当轮任务摘取优先。
              </p>
              <p class="acu-notes acu-notes--sm">
                <strong>用户输入</strong>：在
                <code>MESSAGE_SENT</code>
                最后阶段（<code>eventMakeLast</code>）从最终用户消息摘取，写入用户楼变量，供下一 AI 楼继承。
                若 shujuku 策略1在已有用户楼上改写正文，会在
                <code>GENERATION_AFTER_COMMANDS</code> 末尾再摘取一次（基于改写后正文）。
              </p>
              <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">
                <strong>AI 输出</strong>：在工作流任务开始前从当前 AI 楼正文摘取并写入，供当轮任务
                <code v-pre>{{ 标签名 }}</code> 与聊天注入引用。语法同任务级：裸名或
                <code>item@id</code>。裸名取正文中<strong>最后一次出现的该开标签</strong>至其闭标签之间的内文；<code
                  >标签@属性</code
                >
                仍按属性分实例枚举。
              </p>
            </AcuHelpPanel>
            <div class="acu-row acu-row--extract-tags">
              <label class="acu-label-with-help" for="chat-extract-user-tags">用户输入摘取</label>
              <input
                id="chat-extract-user-tags"
                class="acu-input"
                style="flex: 1"
                placeholder="半角或全角逗号分隔，如 input,context 或 item@id；留空=关闭"
                :value="chatExtractUserTagsDraft"
                @input="onChatExtractUserTagsInput"
                @blur="onChatExtractUserTagsBlur"
              />
            </div>
            <div class="acu-row acu-row--extract-tags">
              <label class="acu-label-with-help" for="chat-extract-assistant-tags">AI 输出摘取</label>
              <input
                id="chat-extract-assistant-tags"
                class="acu-input"
                style="flex: 1"
                placeholder="半角或全角逗号分隔，如 gametxt,summary 或 item@id；留空=关闭"
                :value="chatExtractAssistantTagsDraft"
                @input="onChatExtractAssistantTagsInput"
                @blur="onChatExtractAssistantTagsBlur"
              />
            </div>
          </div>

          <div class="acu-section">
            <h4>{{ WORKFLOW_TASK_LABEL }}</h4>
            <p class="acu-notes" style="margin-top: 0">
              「跨预设复制」后可切换其他任务预设再「粘贴」；切换预设前请自行保存当前修改。
            </p>
            <div class="acu-task-tabs">
              <span
                v-for="(task, idx) in taskTabTasks"
                :key="task.id"
                class="task-card"
                :class="{ active: task.id === selectedTaskId, 'task-card--disabled': !task.enabled }"
                @click="selectedTaskId = task.id"
              >
                <span class="task-card__stage" :title="`执行阶段 ${task.stage}`">S{{ task.stage }}</span>
                <span class="task-card__name">{{ task.name }}</span>
                <span v-if="task.syncAsReplicaFamily" class="task-card__flag">副本族</span>
                <span v-else-if="!task.enabled" class="task-card__flag">停用</span>
                <template v-if="task.id === selectedTaskId">
                  <button
                    class="task-card__move"
                    type="button"
                    title="向左移动"
                    :disabled="idx === 0"
                    @click.stop="moveTask(idx, -1)"
                  >
                    ◀
                  </button>
                  <button
                    class="task-card__move"
                    type="button"
                    title="向右移动"
                    :disabled="idx === taskTabTasks.length - 1"
                    @click.stop="moveTask(idx, 1)"
                  >
                    ▶
                  </button>
                </template>
              </span>
              <button
                class="acu-btn acu-btn--sm acu-icon-btn"
                type="button"
                title="添加任务"
                aria-label="添加任务"
                @click="addTask"
              >
                <i class="fa-fw fa-solid fa-plus" aria-hidden="true"></i>
              </button>
            </div>
            <div v-if="selectedTask" class="acu-task-editor">
              <div v-if="selectedTask.syncAsReplicaFamily && replicaFamilyMembers.length" class="replica-family-bar">
                <span class="replica-family-bar__label">副本族</span>
                <button
                  type="button"
                  class="replica-family-bar__pill"
                  :class="{ active: !selectedReplicaViewId }"
                  @click="selectedReplicaViewId = null"
                >
                  原本
                </button>
                <button
                  v-for="rep in replicaFamilyMembers"
                  :key="rep.id"
                  type="button"
                  class="replica-family-bar__pill"
                  :class="{ active: selectedReplicaViewId === rep.id }"
                  @click="selectedReplicaViewId = rep.id"
                >
                  {{ rep.replicaFamilyAttrValue ?? rep.name }}
                </button>
                <button
                  v-if="isViewingReplicaMember"
                  type="button"
                  class="acu-btn acu-btn--sm acu-icon-btn danger replica-family-bar__clear"
                  title="删除当前副本及楼层变量"
                  aria-label="删除当前副本及楼层变量"
                  @click="deleteSelectedReplicaMember"
                >
                  <i class="fa-fw fa-solid fa-trash" aria-hidden="true"></i>
                </button>
              </div>
              <p v-if="isViewingReplicaMember" class="acu-notes replica-family-bar__hint">
                当前为副本预览（占位符已替换为精确属性值）；提示词段内容请切回「原本」编辑。API
                预设与提示词自动段启用可在下方对本副本单独配置。
              </p>
              <div
                v-if="isViewingReplicaMember && editorTask"
                class="acu-subsection acu-collapsible-subsection acu-api-config-section"
              >
                <button
                  type="button"
                  class="acu-collapsible-subsection__header"
                  :aria-expanded="apiConfigExpanded"
                  @click="apiConfigExpanded = !apiConfigExpanded"
                >
                  <span class="acu-collapsible-subsection__title">副本 API 配置</span>
                  <span class="acu-collapsible-subsection__summary">{{ replicaApiConfigSummary }}</span>
                  <i
                    class="fa-fw fa-solid acu-collapsible-subsection__chevron"
                    :class="apiConfigExpanded ? 'fa-chevron-up' : 'fa-chevron-down'"
                    aria-hidden="true"
                  />
                </button>
                <div v-show="apiConfigExpanded" class="acu-collapsible-subsection__body">
                  <p class="acu-api-config__intro">
                    默认沿用副本族原本的 API 路由；切到「本副本自定义」后可独立选择主/备预设与并发。
                  </p>
                  <div class="acu-row acu-row--inline">
                    <label>
                      <input v-model="replicaApiPresetMode" type="radio" value="inheritRoot" />
                      沿用任务原本
                    </label>
                    <label>
                      <input v-model="replicaApiPresetMode" type="radio" value="custom" />
                      本副本自定义
                    </label>
                  </div>
                  <template v-if="replicaApiPresetMode === 'inheritRoot'">
                    <p class="acu-notes acu-notes--sm">当前跟随原本：{{ rootApiConfigSummary || '全局默认' }}</p>
                  </template>
                  <template v-else>
                    <div class="acu-api-config__block">
                      <label class="acu-field-label">主要 API 预设</label>
                      <div class="acu-api-routing-row">
                        <select v-model="editorTask.apiPresetName" class="acu-select acu-api-config__preset-select">
                          <option value="">全局默认</option>
                          <option v-for="p in settings.apiPresets" :key="p.name" :value="p.name">
                            {{ p.name }}
                          </option>
                        </select>
                        <span class="acu-api-routing-row__concurrency-label">最大并发</span>
                        <input
                          v-model.number="editorTask.apiPrimaryMaxConcurrency"
                          class="acu-input acu-api-config__concurrency-input"
                          type="number"
                          min="0"
                          step="1"
                          title="0 表示不限制"
                        />
                        <span class="acu-api-config__suffix">次</span>
                      </div>
                      <div class="acu-api-routing-fallbacks">
                        <label class="acu-field-label">备用 API 预设</label>
                        <div
                          v-for="(fallbackName, fbIndex) in editorTask.apiPresetFallbackNames ?? []"
                          :key="`rep-fb-${fbIndex}-${fallbackName}`"
                          class="acu-api-routing-row acu-api-routing-fallback-row"
                        >
                          <select
                            v-model="editorTask.apiPresetFallbackNames![fbIndex]"
                            class="acu-select acu-api-config__preset-select"
                          >
                            <option v-for="p in settings.apiPresets" :key="p.name" :value="p.name">
                              {{ p.name }}
                            </option>
                          </select>
                          <span class="acu-api-routing-row__concurrency-label">最大并发</span>
                          <input
                            v-model.number="editorTask.apiFallbackMaxConcurrencies![fbIndex]"
                            class="acu-input acu-api-config__concurrency-input"
                            type="number"
                            min="0"
                            step="1"
                            title="0 表示不限制"
                          />
                          <span class="acu-api-config__suffix">次</span>
                          <button
                            class="acu-btn acu-btn--sm"
                            type="button"
                            title="删除此备用"
                            @click="removeReplicaApiFallback(fbIndex)"
                          >
                            删除
                          </button>
                        </div>
                        <button
                          class="acu-btn acu-btn--sm"
                          type="button"
                          :disabled="!availableFallbackPresetsForReplicaAdd.length"
                          @click="addReplicaApiFallback"
                        >
                          + 添加备用
                        </button>
                        <p
                          v-if="!settings.apiPresets.length"
                          class="acu-notes acu-notes--sm acu-api-config__empty-hint"
                        >
                          请先在全局「API」页添加至少一个 API 预设。
                        </p>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
              <template v-if="!isViewingReplicaMember">
                <div class="acu-row acu-row--inline acu-task-editor__toolbar">
                  <AcuToggle v-model="selectedTaskEnabledModel" label="启用" />
                  <div class="acu-task-editor__actions">
                    <button
                      class="acu-btn acu-btn--sm acu-icon-btn"
                      type="button"
                      title="重命名任务"
                      aria-label="重命名任务"
                      @click="confirmRenameSelectedTask"
                    >
                      <i class="fa-fw fa-solid fa-pencil" aria-hidden="true"></i>
                    </button>
                    <button
                      class="acu-btn acu-btn--sm acu-icon-btn"
                      type="button"
                      title="复制为新副本"
                      aria-label="复制为新副本"
                      @click="duplicateSelectedTask"
                    >
                      <i class="fa-fw fa-solid fa-clone" aria-hidden="true"></i>
                    </button>
                    <button
                      class="acu-btn acu-btn--sm acu-icon-btn"
                      type="button"
                      title="跨预设复制"
                      aria-label="跨预设复制"
                      @click="copySelectedTask"
                    >
                      <i class="fa-fw fa-solid fa-clipboard" aria-hidden="true"></i>
                    </button>
                    <button
                      class="acu-btn acu-btn--sm acu-icon-btn"
                      type="button"
                      title="粘贴"
                      aria-label="粘贴"
                      :disabled="!hasClipboard"
                      @click="pasteTask"
                    >
                      <i class="fa-fw fa-solid fa-paste" aria-hidden="true"></i>
                    </button>
                    <button
                      class="acu-btn acu-btn--sm acu-icon-btn danger"
                      type="button"
                      title="删除任务"
                      aria-label="删除任务"
                      @click="removeTask(selectedTask.id)"
                    >
                      <i class="fa-fw fa-solid fa-trash" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
                <div class="acu-row">
                  <label>执行阶段</label>
                  <input
                    v-model.number="selectedTask.stage"
                    class="acu-input"
                    type="number"
                    min="1"
                    step="1"
                    title="相同阶段并行，不同阶段串行"
                  />
                </div>
                <TaskWorkflowPresetPanel
                  v-if="selectedTask && !selectedReplicaViewId"
                  :task="selectedTask"
                  @save="onTaskWorkflowPresetSave"
                  @apply="onTaskWorkflowPresetApply"
                  @delete="onTaskWorkflowPresetDelete"
                  @import="onTaskWorkflowPresetImport"
                />
                <ReplicaFamilySchedulerPanel
                  v-if="selectedTask.syncAsReplicaFamily && !selectedReplicaViewId"
                  :root="selectedTask"
                  :members="replicaFamilyMembers"
                  @update-mode="onReplicaScheduleModeChange"
                  @update-member="onReplicaMemberScheduleChange"
                  @create-member="onCreateReplicaMember"
                />
                <div class="acu-subsection acu-collapsible-subsection acu-api-config-section">
                  <button
                    type="button"
                    class="acu-collapsible-subsection__header"
                    :aria-expanded="apiConfigExpanded"
                    @click="apiConfigExpanded = !apiConfigExpanded"
                  >
                    <span class="acu-collapsible-subsection__title">API配置</span>
                    <span class="acu-collapsible-subsection__summary">{{ apiConfigSummary }}</span>
                    <i
                      class="fa-fw fa-solid acu-collapsible-subsection__chevron"
                      :class="apiConfigExpanded ? 'fa-chevron-up' : 'fa-chevron-down'"
                      aria-hidden="true"
                    />
                  </button>
                  <div v-show="apiConfigExpanded" class="acu-collapsible-subsection__body">
                    <p class="acu-api-config__intro">
                      配置本任务的 LLM 路由与并发分流；每个 API
                      预设可单独设置最大并发，同阶段并行时各路由按各自上限分担请求。
                    </p>

                    <AcuHelpPanel
                      v-model:open="apiRouteConcurrencyHelpOpen"
                      id="api-route-concurrency-help"
                      label="路由最大并发说明"
                    >
                      <p class="acu-notes acu-notes--sm acu-api-config__example-text">
                        例：主要上限 5、备用 A 上限 2、备用 B 上限 10；本轮 17
                        次并发时先按各路线上限分配，余量排队后补入有空闲槽位的路由。填 0 表示该路由不限制。
                      </p>
                    </AcuHelpPanel>

                    <div class="acu-api-config__block">
                      <div class="acu-api-config__recommended-model">
                        <span class="acu-api-config__recommended-model-text">
                          推荐模型：{{ selectedTask.recommendedModel?.trim() || '' }}
                        </span>
                        <button
                          class="acu-btn acu-btn--sm acu-icon-btn"
                          type="button"
                          title="编辑推荐模型"
                          aria-label="编辑推荐模型"
                          @click="confirmEditRecommendedModel"
                        >
                          <i class="fa-fw fa-solid fa-pencil" aria-hidden="true"></i>
                        </button>
                      </div>
                      <label class="acu-field-label">主要 API 预设</label>
                      <div class="acu-api-routing-row">
                        <select v-model="selectedTask.apiPresetName" class="acu-select acu-api-config__preset-select">
                          <option value="">全局默认</option>
                          <option v-for="p in settings.apiPresets" :key="p.name" :value="p.name">{{ p.name }}</option>
                        </select>
                        <span class="acu-api-routing-row__concurrency-label">最大并发</span>
                        <input
                          v-model.number="selectedTask.apiPrimaryMaxConcurrency"
                          class="acu-input acu-api-config__concurrency-input"
                          type="number"
                          min="0"
                          step="1"
                          title="0 表示不限制"
                        />
                        <span class="acu-api-config__suffix">次</span>
                        <AcuHelpIconBtn
                          v-model:open="apiRouteConcurrencyHelpOpen"
                          panel-id="api-route-concurrency-help"
                          label="路由最大并发说明"
                        />
                      </div>

                      <div class="acu-api-routing-fallbacks">
                        <label class="acu-field-label">备用 API 预设</label>
                        <div
                          v-for="(fallbackName, fbIndex) in selectedTask.apiPresetFallbackNames ?? []"
                          :key="`fb-${fbIndex}-${fallbackName}`"
                          class="acu-api-routing-row acu-api-routing-fallback-row"
                        >
                          <select
                            v-model="selectedTask.apiPresetFallbackNames![fbIndex]"
                            class="acu-select acu-api-config__preset-select"
                          >
                            <option v-for="p in settings.apiPresets" :key="p.name" :value="p.name">{{ p.name }}</option>
                          </select>
                          <span class="acu-api-routing-row__concurrency-label">最大并发</span>
                          <input
                            v-model.number="selectedTask.apiFallbackMaxConcurrencies![fbIndex]"
                            class="acu-input acu-api-config__concurrency-input"
                            type="number"
                            min="0"
                            step="1"
                            title="0 表示不限制"
                          />
                          <span class="acu-api-config__suffix">次</span>
                          <button
                            class="acu-btn acu-btn--sm"
                            type="button"
                            title="删除此备用"
                            @click="removeTaskApiFallback(fbIndex)"
                          >
                            删除
                          </button>
                        </div>
                        <button
                          class="acu-btn acu-btn--sm"
                          type="button"
                          :disabled="!availableFallbackPresetsForAdd.length"
                          @click="addTaskApiFallback"
                        >
                          + 添加备用
                        </button>
                        <p
                          v-if="!settings.apiPresets.length"
                          class="acu-notes acu-notes--sm acu-api-config__empty-hint"
                        >
                          请先在全局「API」页添加至少一个 API 预设。
                        </p>
                      </div>
                    </div>

                    <ul class="acu-api-config__hints acu-notes acu-notes--sm">
                      <li>API 抛错时按顺序 failover 到备用预设。</li>
                      <li>字数不足或摘取失败时仍在主要预设上重试，不切换到备用分流。</li>
                    </ul>
                  </div>
                </div>
                <div class="acu-subsection acu-collapsible-subsection">
                  <button
                    type="button"
                    class="acu-collapsible-subsection__header"
                    :aria-expanded="executionStrategyExpanded"
                    @click="executionStrategyExpanded = !executionStrategyExpanded"
                  >
                    <span class="acu-collapsible-subsection__title">执行策略</span>
                    <span class="acu-collapsible-subsection__summary">{{ executionStrategySummary }}</span>
                    <i
                      class="fa-fw fa-solid acu-collapsible-subsection__chevron"
                      :class="executionStrategyExpanded ? 'fa-chevron-up' : 'fa-chevron-down'"
                      aria-hidden="true"
                    />
                  </button>
                  <div v-show="executionStrategyExpanded" class="acu-collapsible-subsection__body">
                    <p class="acu-notes">回合间隔与时间间隔分别配置，选择其中一项逻辑执行（手动重跑忽略调度）。</p>
                    <p class="acu-notes">
                      若角色卡启用了 MVU：工作流会等变量更新完成后再执行；若同时开启额外模型解析，则等额外解析结束且变量写入后再执行（无 MVU 的卡仍即时触发）。
                    </p>
                    <div class="acu-row acu-row--inline">
                      <label><input v-model="scheduleMode" type="radio" value="round" /> 按回合间隔</label>
                      <label><input v-model="scheduleMode" type="radio" value="time" /> 按游戏时间间隔</label>
                    </div>
                    <div v-if="scheduleMode === 'round'" class="acu-row">
                      <label>每隔</label>
                      <input
                        v-model.number="selectedRoundInterval"
                        class="acu-input"
                        type="number"
                        min="0"
                        step="1"
                        style="width: 72px"
                      />
                      <span>回合执行一次</span>
                      <span class="acu-notes">（0 或 1 = 每楼都执行）</span>
                    </div>
                    <template v-if="scheduleMode === 'time'">
                      <div class="acu-row">
                        <label>每隔</label>
                        <input
                          v-model.number="timeIntervalValue"
                          class="acu-input"
                          type="number"
                          min="1"
                          step="1"
                          style="width: 72px"
                        />
                        <select v-model="timeIntervalUnit" class="acu-select">
                          <option value="minute">分钟</option>
                          <option value="hour">小时</option>
                          <option value="day">天</option>
                          <option value="week">周</option>
                          <option value="month">月</option>
                          <option value="year">年</option>
                        </select>
                        <span>游戏时间执行一次</span>
                      </div>
                      <div class="acu-row acu-row--inline">
                        <label>时间数据来源</label>
                        <label><input v-model="timeSourceType" type="radio" value="message_tag" /> 正文标签</label>
                        <label><input v-model="timeSourceType" type="radio" value="variable" /> 楼层变量</label>
                      </div>
                      <template v-if="timeSourceType === 'message_tag'">
                        <div class="acu-row">
                          <label>标签名（半角或全角逗号分隔）</label>
                          <input
                            class="acu-input"
                            style="flex: 1"
                            placeholder="time,世界时间 或 time，世界时间"
                            :value="timeTagNamesDraft"
                            @input="onTimeTagNamesInput"
                            @blur="onTimeTagNamesBlur"
                          />
                        </div>
                        <div class="acu-row">
                          <label>扫描范围</label>
                          <select v-model="timeTagScope" class="acu-select">
                            <option value="current_ai">当前 AI 楼正文</option>
                            <option value="current_pair">本轮 user+AI 正文</option>
                          </select>
                        </div>
                      </template>
                      <template v-else>
                        <div class="acu-row">
                          <label>变量域</label>
                          <select v-model="timeVariableType" class="acu-select">
                            <option value="message">最新消息楼层</option>
                            <option value="chat">聊天变量</option>
                            <option value="global">全局变量</option>
                            <option value="character">角色变量</option>
                            <option value="script">脚本变量</option>
                          </select>
                          <input
                            v-model="timeVariablePath"
                            class="acu-input"
                            placeholder="变量路径，如 stat_data.世界.当前时间"
                            style="flex: 2"
                          />
                        </div>
                      </template>
                      <div class="acu-row acu-row--inline acu-game-time-probe">
                        <button
                          class="acu-btn acu-btn--sm primary acu-game-time-probe__btn"
                          type="button"
                          @click="testGameTimeParse"
                        >
                          <i class="fa-fw fa-solid fa-clock" aria-hidden="true"></i>
                          测试时间解析
                        </button>
                        <span
                          v-if="gameTimeParseTestHint"
                          class="acu-notes acu-notes--sm acu-game-time-probe__hint"
                          :class="gameTimeParseTestHintClass"
                          >{{ gameTimeParseTestHint }}</span
                        >
                      </div>
                      <div class="acu-heading-with-help">
                        <span class="acu-collapsible-help__inline-title">支持的时间格式</span>
                        <AcuHelpIconBtn
                          v-model:open="gameTimeFormatHelpOpen"
                          panel-id="game-time-format-help"
                          label="支持的时间格式说明"
                        />
                      </div>
                      <AcuHelpPanel
                        v-model:open="gameTimeFormatHelpOpen"
                        id="game-time-format-help"
                        label="支持的时间格式说明"
                      >
                        <p class="acu-notes acu-notes--sm">{{ GAME_TIME_FORMAT_HELP.preprocess }}</p>
                        <ul class="acu-collapsible-help__list">
                          <li
                            v-for="(line, idx) in GAME_TIME_FORMAT_HELP.examples"
                            :key="idx"
                            class="acu-notes acu-notes--sm"
                          >
                            {{ line }}
                          </li>
                        </ul>
                        <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">
                          {{ GAME_TIME_FORMAT_HELP.footnote }}
                        </p>
                      </AcuHelpPanel>
                    </template>
                  </div>
                </div>
              </template>
              <TaskPromptAutoSegmentsPanel v-if="selectedTask && !isViewingReplicaMember" :task="selectedTask" />
              <TaskPromptAutoSegmentsPanel
                v-else-if="isViewingReplicaMember && editorTask"
                :task="editorTask"
                inserted-only
                :root-task="selectedTask"
              />
              <div class="acu-subsection acu-collapsible-subsection acu-prompt-section">
                <button
                  type="button"
                  class="acu-collapsible-subsection__header"
                  :aria-expanded="promptSectionExpanded"
                  @click="promptSectionExpanded = !promptSectionExpanded"
                >
                  <span class="acu-collapsible-subsection__title">提示词段</span>
                  <span class="acu-collapsible-subsection__summary">{{ promptSectionSummary }}</span>
                  <i
                    class="fa-fw fa-solid acu-collapsible-subsection__chevron"
                    :class="promptSectionExpanded ? 'fa-chevron-up' : 'fa-chevron-down'"
                    aria-hidden="true"
                  />
                </button>
                <div v-show="promptSectionExpanded" class="acu-collapsible-subsection__body">
                  <div ref="promptZoneRef" class="acu-task-prompt-zone">
                    <template v-if="!isViewingReplicaMember">
                      <div class="acu-row acu-row--extract-tags">
                        <label class="acu-label-with-help" for="extract-inject-tags-input">
                          提取写入标签
                          <AcuHelpIconBtn
                            v-model:open="extractInjectTagsHelpOpen"
                            panel-id="extract-inject-tags-help"
                            label="摘取机制说明"
                          />
                        </label>
                        <input
                          id="extract-inject-tags-input"
                          class="acu-input"
                          style="flex: 1"
                          placeholder="半角或全角逗号分隔，如 recall,supplement 或 item@id"
                          :value="extractInjectTagsDraft"
                          @input="onExtractInjectTagsInput"
                          @blur="onExtractInjectTagsBlur"
                        />
                      </div>
                      <AcuHelpPanel
                        v-model:open="extractInjectTagsHelpOpen"
                        id="extract-inject-tags-help"
                        label="提取写入标签说明"
                      >
                        <p class="acu-notes acu-notes--sm acu-extract-tags-help__intro">
                          {{ EXTRACT_INJECT_TAGS_HELP.intro }}
                        </p>
                        <div
                          v-for="mode in EXTRACT_INJECT_TAGS_HELP.modes"
                          :key="mode.config"
                          class="acu-extract-tags-help__mode"
                        >
                          <p class="acu-extract-tags-help__mode-title">
                            {{ mode.title }}：<code>{{ mode.config }}</code>
                          </p>
                          <p class="acu-notes acu-notes--sm">{{ mode.rule }}</p>
                          <p class="acu-extract-tags-help__example">
                            <span class="acu-extract-tags-help__example-label">示例</span>
                            <code>{{ mode.example }}</code>
                          </p>
                        </div>
                        <p class="acu-extract-tags-help__section-title">
                          {{ EXTRACT_INJECT_TAGS_HELP.dynamicPlaceholders.title }}
                        </p>
                        <p class="acu-notes acu-notes--sm">{{ EXTRACT_INJECT_TAGS_HELP.dynamicPlaceholders.intro }}</p>
                        <ul class="acu-extract-tags-help__list">
                          <li
                            v-for="(tip, idx) in EXTRACT_INJECT_TAGS_HELP.dynamicPlaceholders.tips"
                            :key="`dyn-${idx}`"
                            class="acu-notes acu-notes--sm"
                          >
                            <template v-if="'code' in tip && tip.code">
                              <code>{{ tip.code }}</code> {{ tip.desc }}
                            </template>
                            <template v-else>{{ tip.desc }}</template>
                          </li>
                        </ul>
                        <p class="acu-extract-tags-help__section-title">
                          {{ EXTRACT_INJECT_TAGS_HELP.replicaFamily.title }}
                        </p>
                        <p class="acu-notes acu-notes--sm">{{ EXTRACT_INJECT_TAGS_HELP.replicaFamily.intro }}</p>
                        <div
                          v-for="step in EXTRACT_INJECT_TAGS_HELP.replicaFamily.steps"
                          :key="step.title"
                          class="acu-extract-tags-help__mode"
                        >
                          <p class="acu-extract-tags-help__mode-title">{{ step.title }}</p>
                          <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">{{ step.desc }}</p>
                        </div>
                        <ul class="acu-extract-tags-help__list">
                          <li
                            v-for="(note, idx) in EXTRACT_INJECT_TAGS_HELP.replicaFamily.notes"
                            :key="`rep-note-${idx}`"
                            class="acu-notes acu-notes--sm"
                          >
                            {{ note }}
                          </li>
                        </ul>
                        <p class="acu-extract-tags-help__example">
                          <span class="acu-extract-tags-help__example-label">典型流程</span>
                          <code>{{ EXTRACT_INJECT_TAGS_HELP.replicaFamily.example }}</code>
                        </p>
                        <p class="acu-notes acu-notes--sm acu-extract-tags-help__relay">
                          {{ EXTRACT_INJECT_TAGS_HELP.relay }}
                        </p>
                      </AcuHelpPanel>
                      <div class="acu-row acu-row--inline acu-row--task-output-settings">
                        <AcuToggle
                          v-model="promptDragSortEnabled"
                          class="acu-task-output-settings__drag-toggle"
                          label="拖曳排序"
                        />
                        <label>最大重试次数</label>
                        <input
                          v-model.number="selectedTask.maxRetries"
                          class="acu-input"
                          type="number"
                          min="1"
                          step="1"
                          style="width: 96px"
                        />
                        <label>最小回复字数</label>
                        <input
                          v-model.number="selectedTask.minLength"
                          class="acu-input"
                          type="number"
                          min="0"
                          step="1"
                          style="width: 96px"
                        />
                        <label class="acu-label-with-help">
                          结构化 JSON 输出
                          <AcuHelpIconBtn
                            v-model:open="structuredOutputHelpOpen"
                            panel-id="structured-output-help"
                            label="结构化 JSON 输出说明"
                          />
                        </label>
                        <select
                          v-model="selectedTask.structuredOutputMode"
                          class="acu-select acu-task-output-settings__select"
                        >
                          <option value="off">关闭（XML 标签）</option>
                          <option value="mvu_json_patch">MVU JSON Patch</option>
                          <option value="addon_json_patch">Addon JSON Patch</option>
                        </select>
                      </div>
                      <AcuHelpPanel
                        v-model:open="structuredOutputHelpOpen"
                        id="structured-output-help"
                        label="结构化 JSON 输出说明"
                      >
                        <p class="acu-notes acu-notes--sm">{{ STRUCTURED_OUTPUT_MODE_HELP.intro }}</p>
                        <p class="acu-notes acu-notes--sm">{{ STRUCTURED_OUTPUT_MODE_HELP.apiPreset }}</p>
                        <ul class="acu-collapsible-help__list">
                          <li
                            v-for="mode in STRUCTURED_OUTPUT_MODE_HELP.modes"
                            :key="mode.value"
                            class="acu-notes acu-notes--sm"
                          >
                            <strong>{{ mode.title }}</strong
                            >：{{ mode.desc }}
                          </li>
                        </ul>
                        <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">
                          {{ STRUCTURED_OUTPUT_MODE_HELP.retry }}
                        </p>
                      </AcuHelpPanel>
                      <p class="acu-notes" style="margin: 0 0 8px">
                        最小回复字数填 0
                        表示不限制；未达字数将重试（最多「最大重试次数」次）。若已提取到「提取写入标签」内容则视为成功。
                      </p>
                      <p class="acu-notes acu-notes--sm" style="margin: 0 0 8px">
                        灰色自动段为合并预览，请在上方「任务级提示词自动段」中编辑。
                      </p>
                    </template>
                    <template v-for="row in promptPreviewRows" :key="promptRowKey(row)">
                      <PromptSegmentCard
                        :row-key="promptRowKey(row)"
                        :group="row.group"
                        :expanded="isPromptRowExpanded(promptRowKey(row))"
                        :readonly="row.kind === 'auto'"
                        :auto-badge="row.kind === 'auto' ? `自动段 · ${row.slotName}` : ''"
                        :manual-index="row.kind === 'manual' ? row.manualIndex : -1"
                        :manual-count="manualPromptGroupCount"
                        :disabled="isViewingReplicaMember"
                        :drag-enabled="promptDragSortEnabled"
                        :dragging="row.kind === 'manual' && promptDrag?.fromIndex === row.manualIndex"
                        :drop-marker="row.kind === 'manual' ? promptDropMarker(row.manualIndex) : null"
                        @toggle="togglePromptRow(promptRowKey(row))"
                        @move="delta => row.kind === 'manual' && movePromptGroup(row.manualIndex, delta)"
                        @remove="row.kind === 'manual' && removePromptGroup(row.manualIndex)"
                        @drag-start="onPromptDragStart"
                      />
                    </template>
                    <button v-if="!isViewingReplicaMember" class="acu-btn" type="button" @click="addPromptGroup">
                      + 提示词段
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ReplicaFamilyCleanupPanel
            v-if="showReplicaFamilyCleanupPanel"
            v-model:help-open="replicaCleanupHelpOpen"
            v-model:settings="settings"
          />

          <div class="acu-section">
            <div class="acu-heading-with-help">
              <h4>消息楼层标签变量注入</h4>
              <AcuHelpIconBtn
                v-model:open="tagVariableInjectHelpOpen"
                panel-id="tag-variable-inject-help"
                label="消息楼层标签变量注入说明"
              />
            </div>
            <AcuHelpPanel
              v-model:open="tagVariableInjectHelpOpen"
              id="tag-variable-inject-help"
              label="消息楼层标签变量注入说明"
            >
              <p class="acu-notes acu-notes--sm" style="margin-top: 0">
                该注入模板中显式出现的 <code v-pre>{{ 标签名 }}</code> 会写入当前 AI 楼消息变量
                <code>post_process_tags.{标签名}</code>。变量随楼层自动继承，供下轮工作流解读存档数据。
              </p>
              <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">
                存档数据可用酒馆助手宏
                <code v-pre>{{get_message_variable::post_process_tags.{标签名}}}</code>
                或 EJS 代码
                <code v-pre>&lt;%= getMessageVar('post_process_tags.{标签名}') %&gt;</code>
                供外部脚本/酒馆主聊天预设获取。
              </p>
            </AcuHelpPanel>
            <textarea
              v-model="settings.tagVariableInjectTemplate"
              class="acu-textarea"
              placeholder="如 &lt;qc&gt;{{consistency}}&lt;/qc&gt;，可用 {{task:任务名}}"
            />
          </div>

          <div class="acu-section">
            <div class="acu-heading-with-help">
              <h4>AI楼层文末注入</h4>
              <AcuHelpIconBtn
                v-model:open="finalInjectHelpOpen"
                panel-id="final-inject-help"
                label="AI楼层文末注入说明"
              />
            </div>
            <AcuHelpPanel v-model:open="finalInjectHelpOpen" id="final-inject-help" label="AI楼层文末注入说明">
              <p class="acu-notes acu-notes--sm" style="margin: 0">
                渲染后原样追加到 AI 回复文末；请在模板内自行编写所需内容与 <code v-pre>{{ 标签名 }}</code
                >。仅作展示，不写入消息楼层变量，也不再因文末块触发变量更新。本轮任务全部跳过或失败时仍会注入（<code
                  v-pre
                  >{{task:…}}</code
                > 清空，标签走当前楼历史回退）。任务输出含
                <code>&lt;UpdateVariable&gt;</code> 时，在该阶段结果写入 relay 后立即更新本楼
                MVU <code>stat_data</code> / <code>addon_data</code>，供后续阶段读取。
              </p>
            </AcuHelpPanel>
            <textarea
              v-model="settings.finalInjectTemplate"
              class="acu-textarea"
              placeholder="finalInjectTemplate，可用 {{task:任务名}} 与 {{提取写入标签名}}"
            />
          </div>

          <div class="acu-section">
            <div class="acu-heading-with-help">
              <h4>用户输入文末注入</h4>
              <AcuHelpIconBtn
                v-model:open="userInputEndInjectHelpOpen"
                panel-id="user-input-end-inject-help"
                label="用户输入文末注入说明"
              />
            </div>
            <AcuHelpPanel
              v-model:open="userInputEndInjectHelpOpen"
              id="user-input-end-inject-help"
              label="用户输入文末注入说明"
            >
              <p class="acu-notes acu-notes--sm" style="margin-top: 0">
                用户发送消息时，以提示词注入方式贴到最新 user 消息底部（<code>in_chat</code> /
                <code>role:user</code> / <code>depth:0</code>），<strong>不修改楼层正文</strong>，也不创建世界书条目。
                内容默认加入世界书绿灯欲扫描文本（<code>should_scan</code>）。
              </p>
              <p class="acu-notes acu-notes--sm">
                时序（有/无 shujuku 共用）：正常发送时 shujuku 先改写输入框，再
                <code>MESSAGE_SENT</code> 摘取 → 本注入（监听返回 Promise，等待完成）→ 世界书扫描。
                「先落用户楼再生成」（shujuku 策略1）时，在
                <code>GENERATION_AFTER_COMMANDS</code> 的 <code>eventMakeLast</code>
                对最新 user 楼再摘取+注入，保证基于改写后正文且早于世界书扫描。
              </p>
              <p class="acu-notes acu-notes--sm">
                占位符同 AI 楼文末注入：<code v-pre>{{标签名}}</code> /
                <code v-pre>{{task:任务名}}</code> / 酒馆宏。脚本认领的占位符无数据时清空；
                <code v-pre>{{user}}</code> 等核心宏留给酒馆宏管线。
                <strong>只</strong>读上一 AI 楼工作流摘取（楼层
                <code>runStatus</code> / 对齐的 <code>lastRunStatus</code>），含仅进
                relay、未写入 <code>post_process_tags</code> 的标签；
                <strong>不会</strong>用本楼继承的 <code>post_process_tags</code> 回退。
                因此每轮 AI 结果只作用于紧随其后的那句用户输入注入。
              </p>
              <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">
                限制：Prompt 预览（<code>dry_run</code>）会跳过
                <code>GENERATION_AFTER_COMMANDS</code> 兜底，且通常不触发
                <code>MESSAGE_SENT</code>，预览中可能看不到本块。
              </p>
            </AcuHelpPanel>
            <textarea
              v-model="settings.userInputEndInjectTemplate"
              class="acu-textarea"
              placeholder="userInputEndInjectTemplate，可用 {{task:任务名}} 与 {{标签名}}"
            />
          </div>

          <div class="acu-section acu-config-rules-section">
            <div class="acu-heading-with-help">
              <h4>聊天正文标签替换</h4>
              <AcuHelpIconBtn
                v-model:open="chatBodyTagReplaceHelpOpen"
                panel-id="chat-body-tag-replace-help"
                label="聊天正文标签替换说明"
              />
            </div>
            <AcuHelpPanel
              v-model:open="chatBodyTagReplaceHelpOpen"
              id="chat-body-tag-replace-help"
              label="聊天正文标签替换说明"
            >
              <p class="acu-notes acu-notes--sm" style="margin-top: 0">
                仅对 <strong>assistant</strong> 楼生效。可添加多条规则，每条绑定一个「AI
                输出摘取」标签与写入模板；同一标签最多一条规则。
              </p>
              <p class="acu-notes acu-notes--sm">
                工作流按阶段执行：当本阶段任务产出匹配该标签时，先同步
                <code>post_process_tags</code
                >，再在正文中<strong>原位置</strong>替换该标签内文（裸名取最后一次开标签；<code>标签@属性</code>
                按属性实例）。
              </p>
              <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">
                模板占位符同文末注入；模板内 <code>&lt;JSONPatch&gt;</code> /
                <code>&lt;AddonJSONPatch&gt;</code> 不会触发变量解析。
              </p>
            </AcuHelpPanel>
            <div class="acu-subsection acu-collapsible-subsection acu-config-rules-section__collapse">
              <button
                type="button"
                class="acu-collapsible-subsection__header"
                :aria-expanded="chatBodyTagReplaceExpanded"
                @click="chatBodyTagReplaceExpanded = !chatBodyTagReplaceExpanded"
              >
                <span class="acu-collapsible-subsection__title">规则列表</span>
                <span class="acu-collapsible-subsection__summary">{{ chatBodyTagReplaceSummary }}</span>
                <i
                  class="fa-fw fa-solid acu-collapsible-subsection__chevron"
                  :class="chatBodyTagReplaceExpanded ? 'fa-chevron-up' : 'fa-chevron-down'"
                  aria-hidden="true"
                />
              </button>
              <div v-show="chatBodyTagReplaceExpanded" class="acu-collapsible-subsection__body">
                <p v-if="!assistantChatExtractTags.length" class="acu-notes acu-notes--sm">
                  请先在上方「聊天摘取标签」中配置 AI 输出摘取项。
                </p>
                <template v-else>
                  <div class="acu-config-rules-list">
                    <details
                      v-for="rule in settings.chatBodyTagReplaceRules ?? []"
                      :key="rule.id"
                      class="acu-config-rule-item"
                    >
                      <summary class="acu-config-rule-item__summary">
                        <strong class="acu-config-rule-item__name">{{ rule.targetTag || '未命名标签' }}</strong>
                        <span class="acu-config-rule-item__meta">{{ truncateRulePreview(rule.template) }}</span>
                        <span
                          v-if="isChatBodyReplaceTagStale(rule.targetTag)"
                          class="acu-notes acu-log-warn acu-config-rule-item__warn"
                        >
                          未在 AI 输出摘取列表中
                        </span>
                      </summary>
                      <div class="acu-config-rule-item__body">
                        <div class="acu-row" style="align-items: flex-start; gap: 8px">
                          <div style="flex: 0 0 140px">
                            <label class="acu-label-with-help">目标标签</label>
                            <select v-model="rule.targetTag" class="acu-input" style="width: 100%">
                              <option
                                v-for="tag in assistantChatExtractTags"
                                :key="tag"
                                :value="tag"
                                :disabled="isChatBodyReplaceTagUsedByOther(tag, rule.id)"
                              >
                                {{ tag }}
                              </option>
                            </select>
                          </div>
                          <div style="flex: 1">
                            <label class="acu-label-with-help">写入模板</label>
                            <textarea
                              v-model="rule.template"
                              class="acu-textarea"
                              rows="3"
                              placeholder="替换为该模板渲染后的内文，可用 {{task:任务名}} 与 {{标签名}}"
                            />
                          </div>
                          <button
                            type="button"
                            class="acu-btn acu-btn--sm acu-icon-btn"
                            title="删除规则"
                            aria-label="删除规则"
                            style="margin-top: 22px"
                            @click="confirmRemoveChatBodyTagReplaceRule(rule.id)"
                          >
                            <i class="fa-fw fa-solid fa-trash" aria-hidden="true"></i>
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                  <button
                    type="button"
                    class="acu-btn acu-btn--sm acu-icon-btn acu-config-rules-list__add"
                    title="添加规则"
                    aria-label="添加规则"
                    :disabled="!availableChatBodyReplaceTags.length"
                    @click="addChatBodyTagReplaceRule"
                  >
                    <i class="fa-fw fa-solid fa-plus" aria-hidden="true"></i>
                  </button>
                </template>
              </div>
            </div>
          </div>

          <div class="acu-section acu-config-rules-section">
            <div class="acu-heading-with-help acu-heading-with-help--actions">
              <h4>世界书写入规则</h4>
              <AcuHelpIconBtn
                v-model:open="chatWorldbookWriteHelpOpen"
                panel-id="chat-worldbook-write-help"
                label="世界书写入规则说明"
              />
              <button
                type="button"
                class="acu-btn acu-btn--sm acu-heading-with-help__action"
                :disabled="purgingManagedWorldbookEntries"
                @click="handlePurgeAllManagedWorldbookEntries"
              >
                清理全部世界书条目
              </button>
            </div>
            <AcuHelpPanel
              v-model:open="chatWorldbookWriteHelpOpen"
              id="chat-worldbook-write-help"
              label="世界书写入规则说明"
            >
              <p class="acu-notes acu-notes--sm" style="margin-top: 0">
                与「聊天正文标签替换」独立：阶段任务产出匹配标签后，将写入模板渲染结果 upsert
                到世界书条目（默认角色卡主世界书）。典型用于副本族任务 + 绿灯条目，属性值（如
                <code>item@name=圣剑</code>）可自动作为 keyword。
              </p>
              <p class="acu-notes acu-notes--sm">
                绿灯关键词若含间隔号 <code>·</code> / <code>・</code> / <code>･</code>，会自动追加拆分段（如西方人名的名或姓单独出现也可触发）。
              </p>
              <p class="acu-notes acu-notes--sm">
                同一标签可配置多条规则。写入结果保存在 assistant 楼
                message.data；换聊天或删楼时会按聊天历史自动重算世界书（先清理托管条目再重放）。重跑 /
                滑楼（切换候选回复，Swipe）本层会先回放到上一层状态再重新写入，并同步恢复对应的任务副本。
              </p>
              <p class="acu-notes acu-notes--sm">
                托管条目名前缀固定为
                <code>WorkflowHelper-</code
                >；仅这些条目会被自动清理/重放。「清理全部世界书条目」会扫描本机<strong>全部</strong>世界书，数量可能大于当前规则条数（例如曾写入「写卡」等其它书、或旧规则留下的孤儿）。<strong
                  >副本族清理</strong
                >
                或在任务列表手动删除副本时，会一并删除该副本对应的世界书条目并从楼层账本移除，避免下次重算又被重放。模板占位符同正文替换。
              </p>
              <p class="acu-notes acu-notes--sm">
                切换「目标世界书」或手动指定书名时，该规则已写入的托管条目会自动从旧书迁移到新书（含账本重放与孤儿清理），无需手动删旧条目。
              </p>
              <p class="acu-notes acu-notes--sm">
                注入位置：<strong>系统深度</strong> 对应酒馆 @D 系统消息深度；<strong>插入深度</strong>
                仅系统深度时生效；<strong>插入顺序</strong> 为同位置段内的排序，数值越小越靠前（默认 10000）。<strong
                  >防止递归触发</strong
                >
                对应世界书条目「禁止本条目递归激活其他条目」，默认开启。
              </p>
              <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">
                条目名固定为默认：<code>WorkflowHelper-标签名</code>；按属性拆分时为
                <code>WorkflowHelper-标签 属性-属性值</code>（如
                <code>WorkflowHelper-item name-断剑</code
                >）。写入内容保留完整标签块。开启按属性拆分且实际写出属性条目时，会额外维护两条独立恒定条目
                <code>{base}-包裹-上</code> / <code>{base}-包裹-下</code>（正文为可配置的开/闭标签，插入顺序分别为规则
                order±1）。
              </p>
            </AcuHelpPanel>
            <div class="acu-subsection acu-collapsible-subsection acu-config-rules-section__collapse">
              <button
                type="button"
                class="acu-collapsible-subsection__header"
                :aria-expanded="chatWorldbookWriteExpanded"
                @click="chatWorldbookWriteExpanded = !chatWorldbookWriteExpanded"
              >
                <span class="acu-collapsible-subsection__title">规则列表</span>
                <span class="acu-collapsible-subsection__summary">{{ chatWorldbookWriteSummary }}</span>
                <i
                  class="fa-fw fa-solid acu-collapsible-subsection__chevron"
                  :class="chatWorldbookWriteExpanded ? 'fa-chevron-up' : 'fa-chevron-down'"
                  aria-hidden="true"
                />
              </button>
              <div v-show="chatWorldbookWriteExpanded" class="acu-collapsible-subsection__body">
                <p v-if="!worldbookWriteTargetTagOptions.length" class="acu-notes acu-notes--sm">
                  请配置「聊天摘取标签」或任务「提取写入标签」后再添加规则。
                </p>
                <template v-if="worldbookWriteTargetTagOptions.length">
                  <div class="acu-config-rules-list">
                    <details
                      v-for="rule in settings.chatWorldbookWriteRules ?? []"
                      :key="rule.id"
                      class="acu-config-rule-item acu-config-rule-item--wb"
                    >
                      <summary class="acu-config-rule-item__summary">
                        <strong class="acu-config-rule-item__name">{{ rule.targetTag || '未命名标签' }}</strong>
                        <span class="acu-config-rule-item__meta">
                          {{ worldbookWriteRuleEntryTypeLabel(rule.entryType) }} ·
                          {{ worldbookWriteRuleBookLabel(rule) }} ·
                          {{ truncateRulePreview(rule.template) }}
                        </span>
                      </summary>
                      <div class="acu-config-rule-item__body">
                        <div class="acu-wb-write-rule">
                          <div class="acu-wb-write-rule__field acu-wb-write-rule__field--tag">
                            <label class="acu-label-with-help">目标标签</label>
                            <select v-model="rule.targetTag" class="acu-input">
                              <option v-for="tag in worldbookWriteTargetTagOptions" :key="tag" :value="tag">
                                {{ tag }}
                              </option>
                            </select>
                          </div>
                          <div class="acu-wb-write-rule__field acu-wb-write-rule__field--template">
                            <label class="acu-label-with-help">写入模板</label>
                            <textarea
                              v-model="rule.template"
                              class="acu-textarea acu-wb-write-rule__template-input"
                              rows="2"
                              placeholder="可用 {{task:任务名}} 与 {{标签名}}"
                            />
                          </div>
                          <div class="acu-wb-write-rule__side">
                            <div class="acu-wb-write-rule__row acu-wb-write-rule__row--main">
                              <div class="acu-wb-write-rule__field acu-wb-write-rule__field--type">
                                <label class="acu-label-with-help">条目类型</label>
                                <select v-model="rule.entryType" class="acu-input">
                                  <option value="keyword">绿灯 keyword</option>
                                  <option value="constant">蓝灯 constant</option>
                                </select>
                              </div>
                              <div class="acu-wb-write-rule__field acu-wb-write-rule__field--keywords">
                                <label class="acu-label-with-help">关键字</label>
                                <input
                                  v-model="rule.keywords"
                                  class="acu-input"
                                  placeholder="静态 key，逗号分隔"
                                  :disabled="rule.entryType !== 'keyword'"
                                />
                              </div>
                              <div
                                v-if="rule.splitByAttr"
                                class="acu-wb-write-rule__field acu-wb-write-rule__field--wrap"
                              >
                                <label class="acu-label-with-help">包裹标签</label>
                                <input
                                  v-model="rule.wrapTagName"
                                  class="acu-input"
                                  :placeholder="worldbookWriteWrapTagPlaceholder(rule)"
                                />
                              </div>
                              <div class="acu-wb-write-rule__checks">
                                <div class="acu-wb-write-rule__field acu-wb-write-rule__field--check">
                                  <label class="acu-label-with-help">按属性拆分</label>
                                  <label class="acu-checkbox-row acu-wb-write-rule__check">
                                    <input v-model="rule.splitByAttr" type="checkbox" />
                                    <span>启用</span>
                                  </label>
                                </div>
                                <div class="acu-wb-write-rule__field acu-wb-write-rule__field--check">
                                  <label class="acu-label-with-help">防止递归触发</label>
                                  <label class="acu-checkbox-row acu-wb-write-rule__check">
                                    <input v-model="rule.preventRecursion" type="checkbox" />
                                    <span>启用</span>
                                  </label>
                                </div>
                              </div>
                            </div>
                            <div class="acu-wb-write-rule__row acu-wb-write-rule__row--meta">
                              <div class="acu-wb-write-rule__field acu-wb-write-rule__field--book">
                                <label class="acu-label-with-help">目标世界书</label>
                                <select
                                  v-model="rule.bookSource"
                                  class="acu-input"
                                  :disabled="isRuleBookTargetMigrating(rule.id)"
                                  @focus="rememberRuleBookTargetSnapshot(rule)"
                                  @change="onRuleBookSourceChanged(rule)"
                                >
                                  <option value="character">角色主世界书</option>
                                  <option value="manual">手动指定</option>
                                </select>
                              </div>
                              <div
                                v-if="rule.bookSource === 'manual'"
                                class="acu-wb-write-rule__field acu-wb-write-rule__field--book-name"
                              >
                                <label class="acu-label-with-help">世界书名</label>
                                <select
                                  v-model="rule.manualBookName"
                                  class="acu-input"
                                  :disabled="isRuleBookTargetMigrating(rule.id)"
                                  @focus="onManualBookNameFocus(rule)"
                                  @change="onRuleBookTargetChanged(rule)"
                                >
                                  <option value="">请选择</option>
                                  <option v-for="name in allWorldbookNames" :key="name" :value="name">
                                    {{ name }}
                                  </option>
                                </select>
                              </div>
                              <div class="acu-wb-write-rule__field acu-wb-write-rule__field--position">
                                <label class="acu-label-with-help">位置</label>
                                <select
                                  v-model="rule.placement.position"
                                  class="acu-input"
                                  @focus="ensureWorldbookWritePlacement(rule)"
                                  @change="syncWorldbookWritePlacement(rule)"
                                >
                                  <option value="at_depth_as_system">系统深度</option>
                                  <option value="before_character_definition">角色定义前</option>
                                  <option value="after_character_definition">角色定义后</option>
                                </select>
                              </div>
                              <div
                                v-if="isWorldbookWriteAtDepth(rule)"
                                class="acu-wb-write-rule__field acu-wb-write-rule__field--num acu-wb-write-rule__field--depth"
                              >
                                <label class="acu-label-with-help">插入深度</label>
                                <input
                                  v-model.number="rule.placement.depth"
                                  type="number"
                                  class="acu-input"
                                  step="1"
                                  @focus="ensureWorldbookWritePlacement(rule)"
                                />
                              </div>
                              <div class="acu-wb-write-rule__field acu-wb-write-rule__field--num">
                                <label class="acu-label-with-help">插入顺序</label>
                                <input
                                  v-model.number="rule.placement.order"
                                  type="number"
                                  class="acu-input"
                                  min="1"
                                  step="1"
                                  @focus="ensureWorldbookWritePlacement(rule)"
                                  @change="syncWorldbookWritePlacement(rule)"
                                />
                              </div>
                              <button
                                type="button"
                                class="acu-btn acu-btn--sm acu-icon-btn acu-wb-write-rule__delete"
                                title="删除规则"
                                aria-label="删除规则"
                                @click="removeChatWorldbookWriteRule(rule.id)"
                              >
                                <i class="fa-fw fa-solid fa-trash" aria-hidden="true"></i>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>
                </template>
                <button
                  v-if="worldbookWriteTargetTagOptions.length"
                  type="button"
                  class="acu-btn acu-btn--sm acu-icon-btn acu-config-rules-list__add"
                  title="添加规则"
                  aria-label="添加规则"
                  @click="addChatWorldbookWriteRule"
                >
                  <i class="fa-fw fa-solid fa-plus" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-show="currentPage === 4" class="acu-page">
          <div v-if="settings.lastRunStatus.messageId != null" class="acu-notes acu-run-log-page-meta">
            当前楼层 #{{ settings.lastRunStatus.messageId }}
            <span v-if="settings.lastRunStatus.at"> · {{ formatRunLogTime(settings.lastRunStatus.at) }}</span>
          </div>

          <div class="acu-section acu-section--run-log-wb">
            <h4>世界书同步编辑</h4>
            <RunLogWorldbookSyncPanel />
          </div>

          <div class="acu-section">
            <div class="acu-run-log-section__head">
              <h4>运行日志</h4>
              <div class="acu-run-log-section__toolbar">
                <button
                  type="button"
                  class="acu-btn acu-btn--sm acu-icon-btn"
                  title="导出全部运行日志"
                  aria-label="导出全部运行日志"
                  :disabled="!settings.lastRunStatus.taskResults?.length"
                  @click="exportAllRunLogs"
                >
                  <i class="fa-fw fa-solid fa-file-export" aria-hidden="true"></i>
                </button>
              </div>
            </div>
            <div v-if="settings.lastRunStatus.taskResults?.length" class="acu-run-log-task-list">
              <details v-for="r in settings.lastRunStatus.taskResults" :key="r.taskId" class="acu-run-log-task">
                <summary class="acu-run-log-task__summary">
                  <strong class="acu-run-log-task__name">{{ r.taskName }}</strong>
                  <span v-if="r.stage != null" class="acu-notes acu-run-log-task__meta">阶段 {{ r.stage }}</span>
                  <span
                    class="acu-run-log-task__status"
                    :class="r.skipped ? 'acu-log-warn' : r.success ? 'acu-log-ok' : 'acu-log-err'"
                  >
                    {{ runLogStatusText(r) }}
                  </span>
                  <span v-if="r.durationMs != null" class="acu-notes acu-run-log-task__meta">{{
                    runLogDurationText(r.durationMs)
                  }}</span>
                  <button
                    type="button"
                    class="acu-btn acu-btn--sm acu-icon-btn acu-run-log-task__export"
                    title="导出该任务日志"
                    aria-label="导出该任务日志"
                    @click.stop="exportTaskRunLog(r)"
                  >
                    <i class="fa-fw fa-solid fa-file-export" aria-hidden="true"></i>
                  </button>
                </summary>
                <div class="acu-run-log-task__body">
                  <template v-if="runLogWritableTagEntries(r).length">
                    <div class="acu-run-log-tags__head">
                      <div class="acu-run-log-label acu-run-log-tags__title">摘取标签</div>
                      <div class="acu-run-log-tags__toolbar">
                        <button
                          type="button"
                          class="acu-btn acu-btn--sm acu-icon-btn acu-run-log-tags__edit"
                          :class="{ 'acu-run-log-tags__edit--active': isRunLogTagEditing(r.taskId) }"
                          :title="isRunLogTagEditing(r.taskId) ? '退出编辑' : '编辑摘取标签'"
                          :aria-pressed="isRunLogTagEditing(r.taskId)"
                          @click="toggleRunLogTagEdit(r.taskId)"
                        >
                          <i class="fa-fw fa-solid fa-pencil" aria-hidden="true"></i>
                        </button>
                        <button
                          type="button"
                          class="acu-btn acu-btn--sm acu-run-log-tags__save"
                          :class="{ 'acu-run-log-tags__save--dirty': isRunLogTagDraftDirty(r.taskId) }"
                          :disabled="!isRunLogTagEditing(r.taskId)"
                          @click="saveRunLogTaskTags(r.taskId)"
                        >
                          保存摘取标签
                        </button>
                      </div>
                    </div>
                    <p class="acu-notes acu-run-log-tags__hint">
                      保存后仅更新本层 <code>post_process_tags</code> 中「消息楼层标签变量注入」模板声明的标签，不修改
                      AI 楼文末注入块与正文标签替换区域。
                    </p>
                    <div class="acu-run-log-tags">
                      <details v-for="[tag] in runLogWritableTagEntries(r)" :key="tag" class="acu-run-log-tags__item">
                        <summary class="acu-run-log-tags__summary">{{ tag }}</summary>
                        <div class="acu-run-log-tags__body">
                          <textarea
                            v-if="runLogTagDrafts[r.taskId]"
                            v-model="runLogTagDrafts[r.taskId][tag]"
                            class="acu-textarea acu-run-log-tags__input"
                            :class="{ 'acu-run-log-tags__input--locked': !isRunLogTagEditing(r.taskId) }"
                            :readonly="!isRunLogTagEditing(r.taskId)"
                            rows="4"
                          />
                        </div>
                      </details>
                    </div>
                  </template>
                  <template v-if="runLogOtherTagEntries(r).length">
                    <div class="acu-run-log-label acu-run-log-tags--other__title">
                      其他摘取（不写入 post_process_tags）
                    </div>
                    <p class="acu-notes acu-run-log-tags__hint acu-run-log-tags--other__hint">
                      以下标签仅用于文末注入或同轮中转，不会写入本层消息变量。
                    </p>
                    <div class="acu-run-log-tags acu-run-log-tags--other">
                      <details
                        v-for="[tag, value] in runLogOtherTagEntries(r)"
                        :key="tag"
                        class="acu-run-log-tags__item acu-run-log-tags--other__item"
                      >
                        <summary class="acu-run-log-tags__summary">{{ tag }}</summary>
                        <pre class="acu-run-log-pre acu-run-log-tags--other__body">{{ value }}</pre>
                      </details>
                    </div>
                  </template>
                  <template v-if="r.promptMessages?.length">
                    <div class="acu-run-log-label">请求提示词</div>
                    <details v-for="(msg, idx) in r.promptMessages" :key="idx" class="acu-run-log-prompt">
                      <summary class="acu-run-log-prompt__summary">
                        {{ runLogPromptSegmentTitle(msg) }}
                      </summary>
                      <pre class="acu-run-log-pre acu-run-log-prompt__body">{{ msg.content }}</pre>
                    </details>
                  </template>
                  <template v-else-if="r.skipped || !r.success">
                    <div class="acu-run-log-label">请求提示词</div>
                    <div class="acu-notes">（本任务未发起 API 请求）</div>
                  </template>
                  <template v-if="runLogHadApiRequest(r)">
                    <div class="acu-run-log-label">AI 输出</div>
                    <details class="acu-run-log-prompt">
                      <summary class="acu-run-log-prompt__summary">展开查看</summary>
                      <pre v-if="runLogAiOutputText(r)" class="acu-run-log-pre acu-run-log-prompt__body">{{
                        runLogAiOutputText(r)
                      }}</pre>
                      <div v-else class="acu-notes acu-run-log-prompt__body">（无输出内容）</div>
                    </details>
                  </template>
                  <template v-if="runLogAiReasoningText(r)">
                    <div class="acu-run-log-label">推理内容 (reasoning_content)</div>
                    <details class="acu-run-log-prompt">
                      <summary class="acu-run-log-prompt__summary">展开查看</summary>
                      <pre class="acu-run-log-pre acu-run-log-pre--reasoning acu-run-log-prompt__body">{{
                        runLogAiReasoningText(r)
                      }}</pre>
                    </details>
                  </template>
                </div>
              </details>
            </div>
            <div v-else class="acu-notes">尚无运行记录</div>
          </div>
        </div>
      </div>
      <div class="acu-window-footer">
        <div class="acu-footer-nav">
          <button class="acu-btn" type="button" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">
            上一页
          </button>
          <span class="acu-page-indicator">{{ currentPage }} / 4</span>
          <button class="acu-btn" type="button" :disabled="currentPage >= 4" @click="goToPage(currentPage + 1)">
            下一页
          </button>
        </div>
        <div class="acu-footer-actions">
          <button class="acu-btn" type="button" @click="handleRerun">{{ RERUN_BUTTON_LABEL }}</button>
          <button class="acu-btn" type="button" @click="closeWindow">关闭</button>
        </div>
      </div>
    </div>
    <AcuConfirmDialog />
  </div>
</template>

<style src="./acu-theme.css"></style>
