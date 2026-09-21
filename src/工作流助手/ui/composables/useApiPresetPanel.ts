import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  apiPresetDraftFromPreset,
  apiPresetFromDraft,
  createEmptyApiPresetDraft,
  presetMetaLabel,
  type ApiPresetDraft,
} from '../../api/api-preset-utils';
import { getCurrentChatKey } from '../../api/chat-key';
import { findApiPreset } from '../../api/resolve';
import type { ApiPreset } from '../../tasks/schema';
import { useSettingsStore } from '../../settings';
import { acuToast } from '../toast';

export function useApiPresetPanel() {
  const store = useSettingsStore();
  const { settings } = storeToRefs(store);

  const formMode = ref<'empty' | 'edit' | 'create'>('empty');
  const activeDraft = reactive<ApiPresetDraft>(createEmptyApiPresetDraft());
  const activeDraftOriginalName = ref('');
  const activeDraftSnapshot = ref('');
  const activeDraftError = ref('');
  const modelOptions = ref<string[]>([]);
  const modelLoadStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
  const modelLoadError = ref('');

  const activeDraftDirty = computed(() => {
    if (formMode.value === 'create') return JSON.stringify(activeDraft) !== activeDraftSnapshot.value;
    return !!activePreset.value && JSON.stringify(activeDraft) !== activeDraftSnapshot.value;
  });

  const activePresetName = computed({
    get: () => settings.value.activeApiPresetName,
    set: (name: string) => {
      settings.value.activeApiPresetName = name;
    },
  });

  const activePreset = computed(() => findApiPreset(settings.value, activePresetName.value));
  const hasPresets = computed(() => settings.value.apiPresets.length > 0);

  const presetDropdownItems = computed(() =>
    settings.value.apiPresets.map(p => ({
      name: p.name,
      meta: presetMetaLabel(p),
    })),
  );

  function applyPresetToGlobals(preset: ApiPreset) {
    settings.value.apiConfig = _.cloneDeep(preset.apiConfig);
  }

  function refreshActivePresetName() {
    const chatKey = getCurrentChatKey();
    const binding = settings.value.apiPresetBindingsByChat[chatKey];
    const boundName =
      binding && findApiPreset(settings.value, binding.presetName) ? binding.presetName : '';
    const defaultName = findApiPreset(settings.value, settings.value.defaultApiPresetName)
      ? settings.value.defaultApiPresetName
      : '';
    if (!boundName && !defaultName && !settings.value.activeApiPresetName && settings.value.apiPresets[0]) {
      settings.value.activeApiPresetName = settings.value.apiPresets[0].name;
      return;
    }
    settings.value.activeApiPresetName = boundName || defaultName || settings.value.activeApiPresetName;
  }

  function syncActiveDraft() {
    refreshActivePresetName();
    const preset = activePreset.value;
    if (!preset) {
      Object.assign(activeDraft, createEmptyApiPresetDraft());
      activeDraftOriginalName.value = '';
      formMode.value = hasPresets.value ? 'empty' : 'empty';
    } else {
      Object.assign(activeDraft, createEmptyApiPresetDraft(), apiPresetDraftFromPreset(preset));
      activeDraftOriginalName.value = preset.name;
      formMode.value = 'edit';
    }
    activeDraftSnapshot.value = JSON.stringify(activeDraft);
    activeDraftError.value = '';
  }

  function startCreateDraft() {
    Object.assign(activeDraft, createEmptyApiPresetDraft());
    activeDraftOriginalName.value = '';
    formMode.value = 'create';
    activeDraftSnapshot.value = JSON.stringify(activeDraft);
    activeDraftError.value = '';
  }

  function selectPreset(name: string) {
    const preset = findApiPreset(settings.value, name);
    if (!preset) return;
    const chatKey = getCurrentChatKey();
    settings.value.activeApiPresetName = preset.name;
    settings.value.apiPresetBindingsByChat[chatKey] = {
      presetName: preset.name,
      updatedAt: Date.now(),
    };
    applyPresetToGlobals(preset);
    syncActiveDraft();
    store.persist();
  }

  function setDefaultPreset(name: string) {
    const preset = findApiPreset(settings.value, name);
    if (!preset) return;
    settings.value.defaultApiPresetName = preset.name;
    settings.value.defaultTaskApiPreset = preset.name;
    store.persist();
    acuToast('success', `已将「${name}」设为全局默认 API 预设`);
  }

  function deletePreset(name: string) {
    settings.value.apiPresets = settings.value.apiPresets.filter(p => p.name !== name);
    if (settings.value.defaultApiPresetName === name) {
      settings.value.defaultApiPresetName = settings.value.apiPresets[0]?.name ?? '';
      settings.value.defaultTaskApiPreset = settings.value.defaultApiPresetName;
    }
    if (settings.value.activeApiPresetName === name) {
      settings.value.activeApiPresetName = settings.value.defaultApiPresetName;
    }
    if (settings.value.defaultTaskApiPreset === name) {
      settings.value.defaultTaskApiPreset = settings.value.defaultApiPresetName;
    }
    for (const [chatKey, binding] of Object.entries(settings.value.apiPresetBindingsByChat)) {
      if (binding.presetName === name) delete settings.value.apiPresetBindingsByChat[chatKey];
    }
    syncActiveDraft();
    store.persist();
    acuToast('success', `已删除 API 预设「${name}」`);
  }

  function validateActiveDraft(): boolean {
    if (!activeDraft.name.trim()) {
      activeDraftError.value = '预设名称不能为空。';
      return false;
    }
    if (!activeDraft.url.trim()) {
      activeDraftError.value = '请填写端点(基础URL)。';
      return false;
    }
    if (!activeDraft.model.trim()) {
      activeDraftError.value = '请填写模型名。';
      return false;
    }
    activeDraftError.value = '';
    return true;
  }

  function saveActiveDraft() {
    if (!validateActiveDraft()) return;
    const preset = apiPresetFromDraft(activeDraft);
    const oldName = activeDraftOriginalName.value.trim();
    const idxByNew = settings.value.apiPresets.findIndex(p => p.name === preset.name);
    const idxByOld = oldName ? settings.value.apiPresets.findIndex(p => p.name === oldName) : -1;

    if (idxByNew >= 0 && settings.value.apiPresets[idxByNew].name !== oldName) {
      settings.value.apiPresets[idxByNew] = preset;
    } else if (idxByOld >= 0) {
      settings.value.apiPresets[idxByOld] = preset;
    } else {
      settings.value.apiPresets.push(preset);
    }

    if (!settings.value.defaultApiPresetName) {
      settings.value.defaultApiPresetName = preset.name;
      settings.value.defaultTaskApiPreset = preset.name;
    }
    if (oldName && settings.value.defaultApiPresetName === oldName) {
      settings.value.defaultApiPresetName = preset.name;
      settings.value.defaultTaskApiPreset = preset.name;
    }

    if (formMode.value === 'create' || settings.value.activeApiPresetName === oldName || !settings.value.activeApiPresetName) {
      selectPreset(preset.name);
    } else if (oldName && settings.value.activeApiPresetName === oldName) {
      settings.value.activeApiPresetName = preset.name;
    }

    syncActiveDraft();
    store.persist();
    acuToast('success', '已保存当前 API 预设。');
  }

  async function loadModelsForActive() {
    if (!activeDraft.url.trim()) {
      acuToast('warning', '请先填写端点(基础URL)');
      return;
    }
    modelLoadStatus.value = 'loading';
    modelLoadError.value = '';
    try {
      const models = await getModelList({ apiurl: activeDraft.url, key: activeDraft.apiKey || undefined });
      modelOptions.value = models;
      modelLoadStatus.value = 'success';
      if (models.length && !activeDraft.model) activeDraft.model = models[0];
      acuToast('success', `获取到 ${models.length} 个模型`);
    } catch (e) {
      modelOptions.value = [];
      modelLoadStatus.value = 'error';
      modelLoadError.value = e instanceof Error ? e.message : String(e);
      acuToast('error', `加载模型失败: ${modelLoadError.value}`);
    }
  }

  function onChatChanged() {
    refreshActivePresetName();
    const preset = activePreset.value;
    if (preset) applyPresetToGlobals(preset);
    syncActiveDraft();
  }

  let chatChangedOff: EventOnReturn | null = null;
  onMounted(() => {
    refreshActivePresetName();
    syncActiveDraft();
    try {
      chatChangedOff = eventOn(tavern_events.CHAT_CHANGED, onChatChanged);
    } catch {
      /* ignore */
    }
  });
  onUnmounted(() => {
    chatChangedOff?.stop();
  });

  watch(
    () => settings.value.apiPresets.map(p => p.name).join('\0'),
    () => syncActiveDraft(),
  );

  return {
    settings,
    formMode,
    activeDraft,
    activeDraftDirty,
    activeDraftError,
    activePreset,
    activePresetName,
    hasPresets,
    presetDropdownItems,
    modelOptions,
    modelLoadStatus,
    modelLoadError,
    syncActiveDraft,
    startCreateDraft,
    selectPreset,
    setDefaultPreset,
    deletePreset,
    saveActiveDraft,
    loadModelsForActive,
  };
}
