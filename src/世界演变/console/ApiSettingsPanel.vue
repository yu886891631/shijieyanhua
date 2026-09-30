<template>
  <section class="we-api-page">
    <div class="we-api-intro">
      <div>
        <p class="we-eyebrow">BUILT-IN API · ALPHA.12</p>
        <h2>内置 API 配置</h2>
        <p>API 配置保存在世界演变脚本自己的设置中。工作流助手仍可作为兼容来源，但不再是必需依赖。</p>
      </div>
      <div class="we-api-badges">
        <span class="we-api-badge" :class="{ good: config.presets.length }">
          {{ config.presets.length }} 个内置预设
        </span>
        <span class="we-api-badge" :class="{ good: bridge.available }">
          工作流助手：{{ bridge.available ? '已连接' : '未连接' }}
        </span>
      </div>
    </div>

    <section class="we-card we-api-section">
      <div class="we-api-section-head">
        <div>
          <span class="we-eyebrow">PRESETS</span>
          <h3>API 预设</h3>
        </div>
        <button class="we-btn we-btn-primary" type="button" @click="startNew">＋ 新建预设</button>
      </div>

      <div v-if="config.presets.length" class="we-api-preset-list">
        <button
          v-for="preset in config.presets"
          :key="preset.id"
          type="button"
          class="we-api-preset"
          :class="{ active: form.id === preset.id }"
          @click="editPreset(preset)"
        >
          <span class="we-api-preset-status" :class="{ enabled: preset.enabled }" />
          <span class="we-api-preset-main">
            <strong>{{ preset.name }}</strong>
            <small>{{ preset.model || '未填写模型' }} · {{ preset.endpoint || '未填写 Endpoint' }}</small>
          </span>
          <span class="we-api-preset-key">{{ preset.apiKey ? 'Key 已配置' : '缺少 Key' }}</span>
        </button>
      </div>
      <div v-else class="we-api-empty">
        还没有内置 API 预设。可以先新建一个，或继续使用工作流助手兼容桥接。
      </div>
    </section>

    <section class="we-card we-api-section">
      <div class="we-api-section-head">
        <div>
          <span class="we-eyebrow">{{ form.id ? 'EDIT PRESET' : 'NEW PRESET' }}</span>
          <h3>{{ form.id ? '编辑 API 预设' : '新建 API 预设' }}</h3>
        </div>
        <span class="we-api-safe-note">Key 只保存在本地，不会进入世界书或导出文件</span>
      </div>

      <div class="we-api-form">
        <label>
          <span>预设名称</span>
          <input v-model.trim="form.name" class="we-input" type="text" placeholder="例如：主 API" />
        </label>
        <label>
          <span>协议</span>
          <select v-model="form.provider" class="we-select">
            <option value="openai-compatible">OpenAI 兼容</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        <label class="wide">
          <span>Endpoint</span>
          <input
            v-model.trim="form.endpoint"
            class="we-input"
            type="url"
            placeholder="https://example.com/v1/chat/completions"
          />
        </label>
        <label class="wide">
          <span>API Key</span>
          <input
            v-model="form.apiKey"
            class="we-input"
            type="password"
            autocomplete="new-password"
            :placeholder="form.id && selectedPreset?.apiKey ? '已配置，留空表示保持原 Key' : '填写 API Key'"
          />
        </label>
        <label>
          <span>模型</span>
          <input v-model.trim="form.model" class="we-input" type="text" placeholder="例如：gpt-4o-mini" />
        </label>
        <label>
          <span>超时（毫秒）</span>
          <input v-model.number="form.timeoutMs" class="we-input" type="number" min="1000" max="600000" step="1000" />
        </label>
        <label>
          <span>重试次数</span>
          <input v-model.number="form.maxRetries" class="we-input" type="number" min="0" max="8" step="1" />
        </label>
        <label class="we-api-checkbox">
          <input v-model="form.enabled" type="checkbox" />
          <span>允许作为内置路由</span>
        </label>
      </div>

      <div class="we-api-actions">
        <button class="we-btn we-btn-primary" type="button" :disabled="busy" @click="savePreset">
          保存预设
        </button>
        <button class="we-btn" type="button" :disabled="busy || !form.name" @click="simulatePreset">
          {{ busy ? '模拟中…' : '模拟连接测试' }}
        </button>
        <button v-if="form.id" class="we-btn" type="button" :disabled="busy" @click="copyPreset">复制为新预设</button>
        <button v-if="form.id" class="we-btn we-btn-danger" type="button" :disabled="busy" @click="removePreset">
          删除预设
        </button>
      </div>
      <p v-if="message" class="we-api-message" :class="{ error: messageType === 'error' }">{{ message }}</p>
    </section>

    <section class="we-card we-api-section">
      <div class="we-api-section-head">
        <div>
          <span class="we-eyebrow">ROUTING</span>
          <h3>主 API 与备用路由</h3>
        </div>
        <button class="we-btn" type="button" @click="saveRouting">保存路由</button>
      </div>
      <div class="we-api-routing">
        <label>
          <span>主 API</span>
          <select v-model="config.routing.primaryPresetId" class="we-select">
            <option :value="null">未选择</option>
            <option v-for="preset in config.presets" :key="preset.id" :value="preset.id">
              {{ preset.name }}
            </option>
          </select>
        </label>
        <div class="we-api-fallbacks">
          <span>备用 API（按顺序）</span>
          <div v-if="fallbackCandidates.length" class="we-api-route-list">
            <label v-for="preset in fallbackCandidates" :key="preset.id" class="we-api-route-row">
              <input
                type="checkbox"
                :checked="config.routing.fallbackPresetIds.includes(preset.id)"
                @change="toggleFallback(preset.id)"
              />
              <span>{{ preset.name }}</span>
              <button
                v-if="config.routing.fallbackPresetIds.includes(preset.id)"
                class="we-route-move"
                type="button"
                :disabled="fallbackIndex(preset.id) <= 0"
                title="上移"
                @click.prevent="moveFallback(preset.id, -1)"
              >
                ↑
              </button>
              <button
                v-if="config.routing.fallbackPresetIds.includes(preset.id)"
                class="we-route-move"
                type="button"
                :disabled="fallbackIndex(preset.id) >= config.routing.fallbackPresetIds.length - 1"
                title="下移"
                @click.prevent="moveFallback(preset.id, 1)"
              >
                ↓
              </button>
            </label>
          </div>
          <small v-else class="we-api-muted">先创建至少两个内置预设，才能设置备用路由。</small>
        </div>
        <label class="we-api-option">
          <input v-model="config.routing.preferBuiltin" type="checkbox" />
          <span>优先使用内置 API</span>
        </label>
        <label class="we-api-option">
          <input v-model="config.routing.allowWorkflowAssistantBridge" type="checkbox" />
          <span>允许工作流助手作为兼容来源</span>
        </label>
        <label class="we-api-option">
          <input v-model="config.routing.testBeforeRun" type="checkbox" />
          <span>运行前先做连接测试（接入运行流程后生效）</span>
        </label>
      </div>
      <div class="we-api-route-summary">
        当前路由：
        <strong>{{ routeSummary }}</strong>
      </div>
    </section>

    <section class="we-card we-api-section we-api-bridge">
      <div class="we-api-section-head">
        <div>
          <span class="we-eyebrow">COMPATIBILITY</span>
          <h3>工作流助手兼容桥接</h3>
        </div>
        <button class="we-btn" type="button" @click="refreshBridge">刷新状态</button>
      </div>
      <p v-if="bridge.available" class="we-api-muted">
        已连接。当前工作流助手预设：{{ bridge.activePresetName || '跟随当前聊天' }}；可用预设 {{ bridge.presets.length }} 个。
      </p>
      <p v-else class="we-api-muted">
        未检测到工作流助手桥接。内置 API 配置不依赖它，后续运行流程接入后可以直接使用内置路由。
      </p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { loadSettings } from '../store';
import {
  createEmptyWorldEvolutionApiConfiguration,
  loadWorldEvolutionApiConfiguration,
  removeWorldEvolutionApiPreset,
  saveWorldEvolutionApiConfiguration,
  upsertWorldEvolutionApiPreset,
  type WorldEvolutionApiConfiguration,
  type WorldEvolutionApiPreset,
  type WorldEvolutionApiProvider,
} from '../api-config';
import { callWorldEvolutionApiPreset } from '../api-client';

type ApiForm = {
  id: string;
  name: string;
  provider: WorldEvolutionApiProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
};

type BridgeInfo = {
  available: boolean;
  activePresetName: string;
  presets: Array<{ name: string }>;
};

const legacy = loadSettings();
const config = ref<WorldEvolutionApiConfiguration>(
  loadWorldEvolutionApiConfiguration({
    apiPresetName: legacy.apiPresetName,
    apiFallbackPresetNames: legacy.apiFallbackPresetNames,
  }),
);
const form = reactive<ApiForm>(emptyForm());
const busy = ref(false);
const message = ref('');
const messageType = ref<'ok' | 'error'>('ok');
const bridge = ref<BridgeInfo>({ available: false, activePresetName: '', presets: [] });

const selectedPreset = computed(() => config.value.presets.find(preset => preset.id === form.id));
const fallbackCandidates = computed(() =>
  config.value.presets.filter(preset => preset.id !== config.value.routing.primaryPresetId),
);
const routeSummary = computed(() => {
  const names = new Map(config.value.presets.map(preset => [preset.id, preset.name]));
  const primary = config.value.routing.primaryPresetId
    ? names.get(config.value.routing.primaryPresetId) ?? '未知预设'
    : '未选择';
  const fallbacks = config.value.routing.fallbackPresetIds.map(id => names.get(id) ?? '未知预设');
  return fallbacks.length ? `${primary} → ${fallbacks.join(' → ')}` : primary;
});

function emptyForm(): ApiForm {
  return {
    id: '',
    name: '',
    provider: 'openai-compatible',
    endpoint: '',
    apiKey: '',
    model: '',
    enabled: true,
    timeoutMs: 60_000,
    maxRetries: 2,
  };
}

function setMessage(text: string, type: 'ok' | 'error' = 'ok'): void {
  message.value = text;
  messageType.value = type;
}

function editPreset(preset: WorldEvolutionApiPreset): void {
  Object.assign(form, {
    id: preset.id,
    name: preset.name,
    provider: preset.provider,
    endpoint: preset.endpoint,
    apiKey: '',
    model: preset.model,
    enabled: preset.enabled,
    timeoutMs: preset.timeoutMs,
    maxRetries: preset.maxRetries,
  });
  setMessage(preset.apiKey ? '已载入预设；API Key 留空即可保持不变。' : '已载入预设。');
}

function startNew(): void {
  Object.assign(form, emptyForm());
  setMessage('正在新建内置 API 预设。');
}

function persist(next: WorldEvolutionApiConfiguration, successMessage: string): void {
  config.value = saveWorldEvolutionApiConfiguration(next);
  setMessage(successMessage);
}

function savePreset(): void {
  if (!form.name.trim()) {
    setMessage('请填写预设名称。', 'error');
    return;
  }
  const existing = selectedPreset.value;
  const next = upsertWorldEvolutionApiPreset(config.value, {
    ...form,
    id: form.id || undefined,
    apiKey: form.apiKey || existing?.apiKey || '',
  });
  const saved = next.presets.find(preset => preset.name === form.name.trim());
  persist(next, `已保存“${saved?.name ?? form.name.trim()}”。`);
  if (saved) editPreset(saved);
}

function copyPreset(): void {
  const existing = selectedPreset.value;
  if (!existing) return;
  Object.assign(form, {
    ...emptyForm(),
    name: `${existing.name} 副本`,
    provider: existing.provider,
    endpoint: existing.endpoint,
    model: existing.model,
    timeoutMs: existing.timeoutMs,
    maxRetries: existing.maxRetries,
  });
  setMessage('已复制配置字段；API Key 需要重新填写后保存。');
}

function removePreset(): void {
  if (!form.id || !selectedPreset.value) return;
  const name = selectedPreset.value.name;
  const next = removeWorldEvolutionApiPreset(config.value, form.id);
  persist(next, `已删除“${name}”。`);
  Object.assign(form, emptyForm());
}

async function simulatePreset(): Promise<void> {
  if (!form.name.trim()) {
    setMessage('请先填写预设名称。', 'error');
    return;
  }
  busy.value = true;
  try {
    const existing = selectedPreset.value;
    const temp = upsertWorldEvolutionApiPreset(config.value, {
      ...form,
      id: form.id || undefined,
      apiKey: form.apiKey || existing?.apiKey || '',
    });
    const preset = temp.presets.find(item => item.name === form.name.trim());
    if (!preset) throw new Error('无法构造模拟 API 预设');
    const result = await callWorldEvolutionApiPreset(
      preset,
      [{ role: 'user', content: '这是一次本地模拟连接测试，不得访问网络。' }],
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ id: 'local-simulation', content: '模拟连接成功' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        sleep: async () => {},
      },
    );
    setMessage(result.ok ? `模拟连接成功：${result.text}` : `模拟连接失败：${result.message}`, result.ok ? 'ok' : 'error');
  } catch (error) {
    setMessage(`模拟连接失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    busy.value = false;
  }
}

function toggleFallback(id: string): void {
  const current = config.value.routing.fallbackPresetIds;
  config.value.routing.fallbackPresetIds = current.includes(id)
    ? current.filter(item => item !== id)
    : [...current, id];
}

function fallbackIndex(id: string): number {
  return config.value.routing.fallbackPresetIds.indexOf(id);
}

function moveFallback(id: string, delta: number): void {
  const index = fallbackIndex(id);
  const nextIndex = index + delta;
  const routes = [...config.value.routing.fallbackPresetIds];
  if (index < 0 || nextIndex < 0 || nextIndex >= routes.length) return;
  [routes[index], routes[nextIndex]] = [routes[nextIndex], routes[index]];
  config.value.routing.fallbackPresetIds = routes;
}

function saveRouting(): void {
  persist(config.value, '已保存 API 路由。');
}

function refreshBridge(): void {
  try {
    const host = (window.parent ?? window) as Window & {
      AcuPostProcessAPI?: {
        listApiPresetDetails?: () => {
          available?: boolean;
          activePresetName?: string;
          presets?: Array<{ name?: string }>;
        };
      };
    };
    const info = host.AcuPostProcessAPI?.listApiPresetDetails?.();
    bridge.value = {
      available: info?.available === true,
      activePresetName: info?.activePresetName ?? '',
      presets: (info?.presets ?? []).filter(item => typeof item.name === 'string').map(item => ({ name: item.name! })),
    };
  } catch {
    bridge.value = { available: false, activePresetName: '', presets: [] };
  }
}

refreshBridge();
if (config.value.presets[0]) editPreset(config.value.presets[0]);
</script>

<style scoped lang="scss">
.we-api-page {
  display: grid;
  align-content: start;
  gap: 13px;
  max-width: 1100px;
}

.we-api-intro,
.we-api-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 15px;
}

.we-api-intro h2,
.we-api-section-head h3 {
  margin: 0;
}

.we-api-intro p:not(.we-eyebrow) {
  max-width: 750px;
  margin: 5px 0 0;
  color: var(--we-muted);
  font-size: 12px;
}

.we-api-badges {
  display: flex;
  flex: none;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.we-api-badge {
  padding: 5px 9px;
  border: 1px solid var(--we-border);
  border-radius: 999px;
  color: var(--we-muted);
  font-size: 10px;
}

.we-api-badge.good {
  border-color: color-mix(in srgb, var(--we-accent) 45%, var(--we-border));
  color: var(--we-accent-strong);
}

.we-api-section {
  display: grid;
  gap: 13px;
  padding: 15px;
}

.we-api-section-head h3 {
  font-size: 15px;
}

.we-api-safe-note,
.we-api-muted {
  color: var(--we-muted);
  font-size: 11px;
}

.we-api-preset-list {
  display: grid;
  gap: 7px;
}

.we-api-preset {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--we-border);
  border-radius: 10px;
  background: var(--we-input);
  color: var(--we-text);
  cursor: pointer;
  text-align: left;
}

.we-api-preset:hover,
.we-api-preset.active {
  border-color: var(--we-accent);
  background: var(--we-tint);
}

.we-api-preset-status {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--we-muted);
}

.we-api-preset-status.enabled {
  background: var(--we-accent);
}

.we-api-preset-main {
  display: grid;
  min-width: 0;
  flex: 1;
}

.we-api-preset-main small {
  overflow: hidden;
  color: var(--we-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.we-api-preset-key {
  color: var(--we-muted);
  font-size: 10px;
}

.we-api-empty {
  padding: 15px;
  border: 1px dashed var(--we-border);
  border-radius: 9px;
  color: var(--we-muted);
  font-size: 11px;
  text-align: center;
}

.we-api-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.we-api-form label,
.we-api-routing > label {
  display: grid;
  gap: 5px;
  color: var(--we-muted);
  font-size: 11px;
}

.we-api-form label.wide {
  grid-column: span 2;
}

.we-input,
.we-select {
  min-height: 35px;
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--we-border);
  border-radius: 8px;
  background: var(--we-input);
  color: var(--we-text);
  font: inherit;
}

.we-api-checkbox,
.we-api-option {
  display: flex !important;
  align-items: center;
  align-self: end;
  gap: 7px;
  min-height: 35px;
}

.we-api-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.we-btn {
  min-height: 35px;
  padding: 6px 11px;
  border: 1px solid var(--we-border);
  border-radius: 8px;
  background: var(--we-surface-soft);
  color: var(--we-text);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}

.we-btn:hover:not(:disabled) {
  border-color: var(--we-accent);
  background: var(--we-tint);
}

.we-btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.we-btn-primary {
  border-color: var(--we-accent);
  background: var(--we-accent);
  color: var(--we-accent-contrast);
  font-weight: 700;
}

.we-btn-danger {
  color: var(--we-danger);
}

.we-api-message {
  margin: 0;
  color: var(--we-accent-strong);
  font-size: 11px;
}

.we-api-message.error {
  color: var(--we-danger);
}

.we-api-routing {
  display: grid;
  grid-template-columns: minmax(220px, 0.7fr) minmax(300px, 1.3fr);
  gap: 12px 18px;
}

.we-api-fallbacks {
  display: grid;
  gap: 6px;
  color: var(--we-muted);
  font-size: 11px;
}

.we-api-route-list {
  display: grid;
  gap: 5px;
}

.we-api-route-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 31px;
  padding: 3px 7px;
  border: 1px solid var(--we-border);
  border-radius: 7px;
  background: var(--we-input);
}

.we-api-route-row span {
  flex: 1;
  color: var(--we-text);
}

.we-route-move {
  width: 23px;
  height: 23px;
  border: 1px solid var(--we-border);
  border-radius: 5px;
  background: transparent;
  color: var(--we-muted);
  cursor: pointer;
}

.we-route-move:disabled {
  cursor: default;
  opacity: 0.4;
}

.we-api-option {
  grid-column: span 2;
  color: var(--we-text) !important;
}

.we-api-route-summary {
  padding: 9px 11px;
  border-radius: 8px;
  background: var(--we-tint);
  color: var(--we-muted);
  font-size: 11px;
}

.we-api-route-summary strong {
  color: var(--we-text);
}

.we-api-bridge {
  padding-bottom: 13px;
}

@media (max-width: 700px) {
  .we-api-intro,
  .we-api-section-head {
    display: grid;
  }

  .we-api-badges {
    justify-content: flex-start;
  }

  .we-api-form,
  .we-api-routing {
    grid-template-columns: 1fr;
  }

  .we-api-form label.wide,
  .we-api-option {
    grid-column: auto;
  }
}
</style>
