<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { hasApiBodyExtras } from '../api/api-preset-utils';
import {
  applyDeepSeekStructuredTemplate,
  applyStrictJsonToDraft,
  applyThinkingModeToDraft,
  DEEPSEEK_STRUCTURED_HELP_LINES,
  DEEPSEEK_STRUCTURED_TEMPLATE_HINT,
  isDeepSeekStructuredBodyParams,
  readThinkingMode,
  restoreDeepSeekDraftSnapshot,
  snapshotDeepSeekDraftFields,
  type DeepSeekDraftSnapshot,
} from '../api/deepseek-presets';
import AcuPresetDropdown from './AcuPresetDropdown.vue';
import AcuHelpIconBtn from './AcuHelpIconBtn.vue';
import AcuHelpPanel from './AcuHelpPanel.vue';
import AcuToggle from './AcuToggle.vue';
import { acuConfirm } from './composables/useAcuConfirm';
import { useApiPresetPanel } from './composables/useApiPresetPanel';
import { acuToast } from './toast';

const {
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
} = useApiPresetPanel();

const deepSeekToolbarVisible = ref(false);
const deepSeekHelpOpen = ref(false);
const deepSeekSnapshot = ref<DeepSeekDraftSnapshot | null>(null);

const cotEnabled = computed({
  get: () => readThinkingMode(activeDraft.bodyParams) === 'enabled',
  set: (enabled: boolean) => {
    applyThinkingModeToDraft(activeDraft, enabled ? 'enabled' : 'disabled');
  },
});

const strictJsonEnabled = computed({
  get: () => isDeepSeekStructuredBodyParams(activeDraft.bodyParams),
  set: (enabled: boolean) => {
    applyStrictJsonToDraft(activeDraft, enabled, cotEnabled.value);
  },
});

function resetDeepSeekToolbar() {
  deepSeekToolbarVisible.value = false;
  deepSeekSnapshot.value = null;
}

async function confirmDeletePreset() {
  const name = activePreset.value?.name;
  if (!name) return;
  if (!(await acuConfirm({ message: `删除 API 预设「${name}」？` }))) return;
  deletePreset(name);
  resetDeepSeekToolbar();
}

function toggleDeepSeekStructuredOutput() {
  if (deepSeekToolbarVisible.value && deepSeekSnapshot.value) {
    restoreDeepSeekDraftSnapshot(activeDraft, deepSeekSnapshot.value);
    deepSeekSnapshot.value = null;
    deepSeekToolbarVisible.value = false;
    acuToast('success', '已恢复一键应用前的 API 配置。');
    return;
  }
  deepSeekSnapshot.value = snapshotDeepSeekDraftFields(activeDraft);
  applyDeepSeekStructuredTemplate(activeDraft, { cotEnabled: false });
  deepSeekToolbarVisible.value = true;
  acuToast('success', DEEPSEEK_STRUCTURED_TEMPLATE_HINT);
}

function handleSyncActiveDraft() {
  resetDeepSeekToolbar();
  syncActiveDraft();
}

watch(activePresetName, () => {
  resetDeepSeekToolbar();
});

const showBodyExtrasWarning = computed(() =>
  hasApiBodyExtras({
    url: activeDraft.url,
    apiKey: activeDraft.apiKey,
    model: activeDraft.model,
    source: 'openai',
    bodyParams: activeDraft.bodyParams,
    excludeBodyParams: activeDraft.excludeBodyParams,
    requestHeaders: activeDraft.requestHeaders,
    customPromptPostProcessing: activeDraft.customPromptPostProcessing,
    includeReasoning: activeDraft.includeReasoning,
    reasoningEffort: activeDraft.reasoningEffort,
  }),
);
</script>

<template>
  <div class="acu-section acu-api-config-panel">
    <h4>API 预设</h4>
    <p class="acu-notes">
      编辑当前聊天使用的自定义 API，供工作流任务调用。下拉切换当前预设，星标设为全局默认；右侧按钮可新建或删除预设。
    </p>

    <div v-if="!hasPresets" class="acu-message acu-message--warn">
      暂无可用 API 预设，请新建并设为当前或全局默认。
    </div>

    <div class="acu-form-row">
      <label class="acu-field-label">当前 API 预设</label>
      <div class="acu-api-config-panel__select-row">
        <AcuPresetDropdown
          :items="presetDropdownItems"
          :model-value="activePresetName"
          :default-name="settings.defaultApiPresetName"
          :disabled="!hasPresets"
          placeholder="未选择 API 预设"
          @update:model-value="selectPreset"
          @set-default="setDefaultPreset"
        />
        <button class="acu-btn acu-btn--sm acu-icon-btn" type="button" title="新建预设" @click="startCreateDraft">+</button>
        <button
          class="acu-btn acu-btn--sm acu-icon-btn danger"
          type="button"
          title="删除当前预设"
          :disabled="!activePreset"
          @click="confirmDeletePreset"
        >
          ×
        </button>
      </div>
      <p class="acu-notes acu-api-config-panel__hint">星标表示新聊天默认使用的预设。</p>
    </div>

    <form v-if="formMode !== 'empty'" class="acu-api-config-panel__editor" @submit.prevent="saveActiveDraft()">
      <div class="acu-form-row">
        <label class="acu-field-label">预设名称</label>
        <input v-model="activeDraft.name" class="acu-input" type="text" autocomplete="off" />
      </div>

      <div class="acu-api-config-panel__editor-section">
        <div class="acu-form-row">
          <label class="acu-field-label">端点(基础URL)</label>
          <input v-model="activeDraft.url" class="acu-input" type="text" placeholder="https://example.com/v1" />
        </div>
        <div class="acu-form-row">
          <label class="acu-field-label">API 密钥</label>
          <input v-model="activeDraft.apiKey" class="acu-input" type="password" autocomplete="off" />
        </div>
        <div class="acu-form-row">
          <label class="acu-field-label">模型名</label>
          <input v-model="activeDraft.model" class="acu-input" type="text" />
        </div>
        <div class="acu-api-config-panel__inline-action">
          <button class="acu-btn acu-btn--sm" type="button" @click="loadModelsForActive()">加载模型</button>
          <span v-if="modelLoadStatus === 'loading'" class="acu-api-config-panel__muted">加载中...</span>
          <span v-else-if="modelLoadStatus === 'error'" class="acu-api-config-panel__danger">
            {{ modelLoadError }}
          </span>
        </div>
        <div v-if="modelOptions.length" class="acu-form-row">
          <label class="acu-field-label">模型列表</label>
          <select v-model="activeDraft.model" class="acu-select">
            <option value="" disabled>请选择</option>
            <option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option>
          </select>
        </div>
      </div>

      <div class="acu-api-config-panel__two-col">
        <div class="acu-form-row">
          <label class="acu-field-label">最大回复长度</label>
          <input v-model.number="activeDraft.max_tokens" class="acu-input" type="number" min="1" step="1" />
        </div>
        <div class="acu-form-row">
          <label class="acu-field-label">温度</label>
          <input v-model.number="activeDraft.temperature" class="acu-input" type="number" min="0" max="2" step="0.05" />
        </div>
      </div>

      <div class="acu-api-config-panel__editor-section">
        <div class="acu-deepseek-actions">
          <button
            class="acu-btn acu-btn--sm acu-deepseek-btn"
            :class="{ 'acu-deepseek-btn--active': deepSeekToolbarVisible }"
            type="button"
            @click="toggleDeepSeekStructuredOutput()"
          >
            一键 DeepSeek 结构化输出
          </button>
          <AcuHelpIconBtn
            v-model:open="deepSeekHelpOpen"
            panel-id="deepseek-structured-help"
            label="DeepSeek 结构化输出说明"
          />
          <AcuToggle
            v-if="deepSeekToolbarVisible"
            v-model="strictJsonEnabled"
            label="开启 严格 JSON 变量响应"
            label-position="before"
          />
          <AcuToggle
            v-if="deepSeekToolbarVisible"
            v-model="cotEnabled"
            label="开启COT"
            label-position="before"
          />
        </div>
        <AcuHelpPanel
          v-model:open="deepSeekHelpOpen"
          id="deepseek-structured-help"
          label="DeepSeek 结构化输出说明"
        >
          <ul class="acu-collapsible-help__list">
            <li v-for="(line, idx) in DEEPSEEK_STRUCTURED_HELP_LINES" :key="idx" class="acu-notes acu-notes--sm">
              {{ line }}
            </li>
          </ul>
        </AcuHelpPanel>
        <div v-if="showBodyExtrasWarning" class="acu-message acu-message--warn">
          已填写 body/headers 扩展时会合并到自定义 API 请求体；工作流助手已禁用 ST 预设压扁。
        </div>
        <div class="acu-form-row">
          <label class="acu-field-label">Prompt 后处理</label>
          <select v-model="activeDraft.customPromptPostProcessing" class="acu-select">
            <option value="none">none</option>
            <option value="strict">strict（DeepSeek 推荐）</option>
          </select>
        </div>
        <div class="acu-form-row acu-form-row--stack">
          <label class="acu-field-label">附加主体参数</label>
          <p class="acu-notes">SillyTavern custom_include_body，填写 YAML object，会合并到最终模型请求体。</p>
          <textarea
            v-model="activeDraft.bodyParams"
            class="acu-textarea"
            rows="4"
            placeholder="response_format:&#10;  type: json_object&#10;thinking:&#10;  type: disabled"
          />
        </div>
        <div class="acu-form-row acu-form-row--stack">
          <label class="acu-field-label">排除主体参数</label>
          <p class="acu-notes">会转换为 SillyTavern custom_exclude_body，从最终模型请求体删除指定字段。</p>
          <textarea v-model="activeDraft.excludeBodyParams" class="acu-textarea" rows="2" placeholder="top_p, reasoning_effort" />
        </div>
        <div class="acu-form-row acu-form-row--stack">
          <label class="acu-field-label">附加请求标头</label>
          <p class="acu-notes">每行一个 Header: Value，追加到请求头中。</p>
          <textarea v-model="activeDraft.requestHeaders" class="acu-textarea" rows="2" placeholder="X-Custom-Header: value" />
        </div>
      </div>

      <div v-if="activeDraftError" class="acu-message acu-message--error">{{ activeDraftError }}</div>

      <div class="acu-api-config-panel__actions">
        <button class="acu-btn acu-btn--sm" type="button" :disabled="!activeDraftDirty" @click="handleSyncActiveDraft()">
          放弃修改
        </button>
        <button class="acu-btn acu-btn--sm primary" type="submit" :disabled="!activeDraftDirty">
          {{ formMode === 'create' ? '保存并选中预设' : '保存当前预设' }}
        </button>
      </div>
    </form>

    <div v-else-if="!hasPresets" class="acu-message acu-message--warn">点击右上角「+」新建第一个 API 预设。</div>
  </div>
</template>
