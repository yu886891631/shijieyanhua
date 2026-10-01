<template>
  <section class="we-api-page">
    <div class="we-api-intro">
      <div>
        <p class="we-eyebrow">BUILT-IN API · {{ worldEvolutionVersion }}</p>
        <h2>预设、路由与桥接</h2>
        <p>API 配置保存在世界演变脚本自己的设置中。工作流助手仍可作为兼容来源，但不再是必需依赖。</p>
      </div>
      <div class="we-api-badges">
        <span class="we-api-badge" :class="{ good: config.presets.length }">
          {{ config.presets.length }} 个内置预设
        </span>
        <span class="we-api-badge" :class="{ good: bridge.available }">
          工作流助手：{{ bridge.available ? '已检测到路由' : '未检测到路由' }}
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
          <span class="we-api-preset-meta">
            <small :class="{ ready: presetReadinessLabel(preset) === '可作为内置路由' }">
              {{ presetReadinessLabel(preset) }}
            </small>
            <span class="we-api-preset-key">{{ preset.apiKey ? 'Key 已配置' : '缺少 Key' }}</span>
          </span>
        </button>
      </div>
      <div v-else class="we-api-empty" role="status">
        <strong>还没有内置 API 预设</strong>
        <span>可以先新建一个，或继续使用工作流助手兼容桥接。</span>
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
        <section class="we-api-field-group">
          <div class="we-api-field-head">
            <strong>基本信息</strong>
            <span>用于识别和选择这条预设。</span>
          </div>
          <div class="we-api-field-grid">
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
          </div>
        </section>

        <section class="we-api-field-group">
          <div class="we-api-field-head">
            <strong>接口连接</strong>
            <span>Key 仅保存在本机设置，不会写入世界书。</span>
          </div>
          <div class="we-api-field-grid">
            <label class="wide">
              <span>Endpoint</span>
              <input
                v-model.trim="form.endpoint"
                class="we-input"
                type="url"
                placeholder="https://example.com/v1/chat/completions"
              />
            </label>
            <div class="we-api-field-control wide">
              <label for="we-api-key-input">API Key</label>
              <input
                id="we-api-key-input"
                v-model="form.apiKey"
                class="we-input"
                type="password"
                autocomplete="new-password"
                :placeholder="form.id && selectedPreset?.apiKey ? '已配置，留空表示保持原 Key' : '填写 API Key'"
                @input="clearExistingKey = false"
              />
              <button
                v-if="form.id && selectedPreset?.apiKey"
                class="we-btn we-api-key-clear"
                type="button"
                @click="clearSavedApiKey"
              >
                清除已保存 Key
              </button>
              <small v-if="clearExistingKey" class="we-api-key-warning">保存时会清除已保存的 Key。</small>
            </div>
            <label>
              <span>模型</span>
              <input v-model.trim="form.model" class="we-input" type="text" placeholder="例如：gpt-4o-mini" />
            </label>
          </div>
        </section>

        <section class="we-api-field-group">
          <div class="we-api-field-head">
            <strong>请求策略</strong>
            <span>只影响本预设的等待与重试行为。</span>
          </div>
          <div class="we-api-field-grid">
            <label>
              <span>超时（毫秒）</span>
              <input
                v-model.number="form.timeoutMs"
                class="we-input"
                type="number"
                min="1000"
                max="600000"
                step="1000"
              />
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
        </section>
      </div>

      <div class="we-api-actions">
        <button class="we-btn we-btn-primary" type="button" :disabled="busy" @click="savePreset">保存预设</button>
        <button class="we-btn" type="button" :disabled="busy || !form.name" @click="simulatePreset">
          {{ busy ? '模拟中…' : '模拟连接测试' }}
        </button>
        <button v-if="form.id" class="we-btn" type="button" :disabled="busy" @click="copyPreset">复制为新预设</button>
        <button v-if="form.id" class="we-btn we-btn-danger" type="button" :disabled="busy" @click="removePreset">
          删除预设
        </button>
      </div>
      <p
        v-if="message"
        class="we-api-message"
        :class="{ error: messageType === 'error' }"
        :role="messageType === 'error' ? 'alert' : 'status'"
        aria-live="polite"
      >
        {{ message }}
      </p>
    </section>

    <section class="we-card we-api-section">
      <div class="we-api-section-head">
        <div>
          <span class="we-eyebrow">ROUTING</span>
          <h3>主 API 与备用路由</h3>
        </div>
        <div class="we-api-routing-actions">
          <span class="we-api-save-state" :class="{ dirty: routingDirty }">
            {{ routingDirty ? '有未保存更改' : '路由已保存' }}
          </span>
          <button class="we-btn" type="button" :disabled="!routingDirty" @click="saveRouting">保存路由</button>
        </div>
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
            <div v-for="preset in fallbackCandidates" :key="preset.id" class="we-api-route-row">
              <label class="we-api-route-toggle">
                <input
                  type="checkbox"
                  :checked="config.routing.fallbackPresetIds.includes(preset.id)"
                  @change="toggleFallback(preset.id)"
                />
                <span>{{ preset.name }}</span>
              </label>
              <small v-if="fallbackIndex(preset.id) >= 0" class="we-api-route-order">
                备用 {{ fallbackIndex(preset.id) + 1 }}
              </small>
              <button
                v-if="fallbackIndex(preset.id) >= 0"
                class="we-route-move"
                type="button"
                :disabled="fallbackIndex(preset.id) <= 0"
                title="上移"
                @click="moveFallback(preset.id, -1)"
              >
                ↑
              </button>
              <button
                v-if="fallbackIndex(preset.id) >= 0"
                class="we-route-move"
                type="button"
                :disabled="fallbackIndex(preset.id) >= config.routing.fallbackPresetIds.length - 1"
                title="下移"
                @click="moveFallback(preset.id, 1)"
              >
                ↓
              </button>
            </div>
          </div>
          <small v-else class="we-api-muted">先创建至少两个内置预设，才能设置备用路由。</small>
        </div>
        <div class="we-api-routing-options">
          <div class="we-api-field-head">
            <strong>来源与运行策略</strong>
            <span>只决定尝试顺序和兼容来源，不会在这里发起真实请求。</span>
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
      </div>
      <div class="we-api-route-summary" role="status" aria-live="polite">
        <div>
          配置路由：<strong>{{ routeSummary }}</strong>
        </div>
        <div>
          有效来源：<strong>{{ effectiveRouteSummary.state }}</strong>
        </div>
        <div>
          实际尝试顺序：<strong>{{ effectiveRouteSummary.order }}</strong>
        </div>
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
      <div class="we-api-bridge-status" :class="{ ready: bridge.available }" role="status" aria-live="polite">
        <span class="we-api-bridge-dot" aria-hidden="true" />
        <div>
          <strong>{{ bridge.available ? '已检测到可用桥接路由' : '未检测到可用桥接路由' }}</strong>
          <p v-if="bridge.available" class="we-api-muted">
            当前工作流助手预设：{{ bridge.activePresetName || '跟随当前聊天' }}；可用预设
            {{ bridge.presets.length }} 个。此状态仅表示已检测到配置，不代表凭据验证成功。
          </p>
          <p v-else class="we-api-muted">内置 API 配置不依赖工作流助手；后续运行流程接入后，可以直接使用内置路由。</p>
        </div>
      </div>
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
import { resolveWorldEvolutionApiRouting } from '../api-routing';
import { WORLD_EVOLUTION_VERSION } from '../types';

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
  defaultConfig: { model: string; endpointConfigured: boolean; keyConfigured: boolean };
  presets: Array<{ name: string; model: string; endpointConfigured: boolean; keyConfigured: boolean }>;
};

const legacy = loadSettings();
const worldEvolutionVersion = WORLD_EVOLUTION_VERSION;
const config = ref<WorldEvolutionApiConfiguration>(
  loadWorldEvolutionApiConfiguration({
    apiPresetName: legacy.apiPresetName,
    apiFallbackPresetNames: legacy.apiFallbackPresetNames,
  }),
);
const form = reactive<ApiForm>(emptyForm());
const busy = ref(false);
const clearExistingKey = ref(false);
const message = ref('');
const messageType = ref<'ok' | 'error'>('ok');
const bridge = ref<BridgeInfo>({
  available: false,
  activePresetName: '',
  defaultConfig: { model: '', endpointConfigured: false, keyConfigured: false },
  presets: [],
});
const savedRoutingFingerprint = ref('');

const selectedPreset = computed(() => config.value.presets.find(preset => preset.id === form.id));
const fallbackCandidates = computed(() => [
  ...config.value.routing.fallbackPresetIds
    .map(id => config.value.presets.find(preset => preset.id === id))
    .filter((preset): preset is WorldEvolutionApiPreset => Boolean(preset)),
  ...config.value.presets.filter(
    preset =>
      preset.id !== config.value.routing.primaryPresetId && !config.value.routing.fallbackPresetIds.includes(preset.id),
  ),
]);
const routingDirty = computed(() => JSON.stringify(config.value.routing) !== savedRoutingFingerprint.value);
const routeSummary = computed(() => {
  const names = new Map(config.value.presets.map(preset => [preset.id, preset.name]));
  const primary = config.value.routing.primaryPresetId
    ? (names.get(config.value.routing.primaryPresetId) ?? '未知预设')
    : '未选择';
  const fallbacks = config.value.routing.fallbackPresetIds.map(id => names.get(id) ?? '未知预设');
  return fallbacks.length ? `${primary} → ${fallbacks.join(' → ')}` : primary;
});
const effectiveRouteSummary = computed(() => {
  // 这里只用一个无副作用探针判断桥接是否存在，不会调用它或接触任何凭据。
  const bridgeProbe = bridge.value.available ? { callApi: async () => ({ content: '' }) } : null;
  const resolved = resolveWorldEvolutionApiRouting(config.value, { bridge: bridgeProbe });
  const names = new Map(config.value.presets.map(preset => [preset.id, preset.name]));
  const labels = resolved.effectiveRoutes.map(route => {
    if (route.source === 'builtin') return `内置：${names.get(route.presetId ?? '') ?? '未知预设'}`;
    return `工作流助手：${route.presetName || bridge.value.activePresetName || '跟随当前预设'}`;
  });
  return {
    state:
      resolved.state === 'builtin-only'
        ? '仅内置 API'
        : resolved.state === 'workflow-only'
          ? '仅工作流助手桥接'
          : resolved.state === 'both'
            ? '内置 API + 工作流助手桥接'
            : '未配置可用来源',
    order: labels.length ? labels.join(' → ') : '无可用路由',
  };
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

function presetReadinessLabel(preset: WorldEvolutionApiPreset): string {
  if (!preset.enabled) return '已停用';
  const missing: string[] = [];
  if (!preset.endpoint.trim()) missing.push('Endpoint');
  if (!preset.model.trim()) missing.push('模型');
  if (!preset.apiKey.trim()) missing.push('Key');
  return missing.length ? `缺少 ${missing.join('、')}` : '可作为内置路由';
}

function editPreset(preset: WorldEvolutionApiPreset): void {
  clearExistingKey.value = false;
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
  clearExistingKey.value = false;
  Object.assign(form, emptyForm());
  setMessage('正在新建内置 API 预设。');
}

function clearSavedApiKey(): void {
  form.apiKey = '';
  clearExistingKey.value = true;
  setMessage('保存预设时将清除已保存的 API Key。');
}

function persist(next: WorldEvolutionApiConfiguration, successMessage: string): void {
  config.value = saveWorldEvolutionApiConfiguration(next);
  savedRoutingFingerprint.value = JSON.stringify(config.value.routing);
  setMessage(successMessage);
}

function savePreset(): void {
  if (!form.name.trim()) {
    setMessage('请填写预设名称。', 'error');
    return;
  }
  try {
    const existing = selectedPreset.value;
    const next = upsertWorldEvolutionApiPreset(config.value, {
      ...form,
      id: form.id || undefined,
      apiKey: clearExistingKey.value ? '' : form.apiKey || existing?.apiKey || '',
    });
    const saved = next.presets.find(preset => preset.name === form.name.trim());
    persist(next, `已保存“${saved?.name ?? form.name.trim()}”。`);
    if (saved) editPreset(saved);
  } catch (error) {
    setMessage(`保存预设失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function copyPreset(): void {
  const existing = selectedPreset.value;
  if (!existing) return;
  clearExistingKey.value = false;
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
  if (!window.confirm(`确定删除 API 预设“${name}”吗？\n如果它是主路由或备用路由，关联路由也会被移除。`)) return;
  const next = removeWorldEvolutionApiPreset(config.value, form.id);
  persist(next, `已删除“${name}”。`);
  clearExistingKey.value = false;
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
      apiKey: clearExistingKey.value ? '' : form.apiKey || existing?.apiKey || '',
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
    setMessage(
      result.ok ? `模拟连接成功：${result.text}` : `模拟连接失败：${result.message}`,
      result.ok ? 'ok' : 'error',
    );
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
          defaultConfig?: { model?: string; endpointConfigured?: boolean; keyConfigured?: boolean };
          presets?: Array<{
            name?: string;
            model?: string;
            endpointConfigured?: boolean;
            keyConfigured?: boolean;
          }>;
        };
      };
    };
    const info = host.AcuPostProcessAPI?.listApiPresetDetails?.();
    const defaultConfig = {
      model: info?.defaultConfig?.model ?? '',
      endpointConfigured: info?.defaultConfig?.endpointConfigured === true,
      keyConfigured: info?.defaultConfig?.keyConfigured === true,
    };
    const hasConfiguredPreset = (info?.presets ?? []).some(
      item => typeof item.name === 'string' && item.endpointConfigured === true && Boolean(item.model?.trim()),
    );
    const hasConfiguredDefault = defaultConfig.endpointConfigured && Boolean(defaultConfig.model.trim());
    bridge.value = {
      // listApiPresetDetails.available 代表桥接对象存在，不代表其中已经配置 API。
      available: info?.available === true && (hasConfiguredPreset || hasConfiguredDefault),
      activePresetName: info?.activePresetName ?? '',
      defaultConfig,
      presets: (info?.presets ?? [])
        .filter(item => typeof item.name === 'string')
        .map(item => ({
          name: item.name!,
          model: item.model ?? '',
          endpointConfigured: item.endpointConfigured === true,
          keyConfigured: item.keyConfigured === true,
        })),
    };
  } catch {
    bridge.value = {
      available: false,
      activePresetName: '',
      defaultConfig: { model: '', endpointConfigured: false, keyConfigured: false },
      presets: [],
    };
  }
}

refreshBridge();
savedRoutingFingerprint.value = JSON.stringify(config.value.routing);
if (config.value.presets[0]) editPreset(config.value.presets[0]);
</script>

<style scoped lang="scss">
.we-api-page {
  display: grid;
  width: 100%;
  margin: 0 auto;
  align-content: start;
  gap: clamp(11px, 1.4vw, 17px);
  max-width: 1180px;
  min-width: 0;
  container-type: inline-size;
}

.we-api-page,
.we-api-page * {
  box-sizing: border-box;
}

.we-api-intro,
.we-api-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 15px;
  min-width: 0;
  flex-wrap: wrap;
}

.we-api-intro > div:first-child,
.we-api-section-head > div:first-child {
  min-width: 0;
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
  gap: clamp(11px, 1.3vw, 15px);
  min-width: 0;
  padding: clamp(13px, 1.5vw, 18px);
}

.we-api-section-head h3 {
  font-size: 15px;
}

.we-api-safe-note,
.we-api-muted {
  color: var(--we-muted);
  font-size: 11px;
}

.we-api-key-clear {
  justify-self: start;
}

.we-api-key-warning {
  color: var(--we-danger);
  font-size: 10px;
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

.we-api-preset-meta {
  display: grid;
  flex: none;
  justify-items: end;
  gap: 2px;
  min-width: 0;
  text-align: right;
}

.we-api-preset-meta > small {
  color: var(--we-warning, var(--we-muted));
  font-size: 10px;
  white-space: nowrap;
}

.we-api-preset-meta > small.ready {
  color: var(--we-success, var(--we-accent-strong));
}

.we-api-empty {
  display: grid;
  gap: 4px;
  padding: 15px;
  border: 1px dashed var(--we-border);
  border-radius: 9px;
  color: var(--we-muted);
  font-size: 11px;
  text-align: center;
}

.we-api-empty strong {
  color: var(--we-text);
  font-size: 11px;
}

.we-api-empty span {
  color: var(--we-muted);
  font-size: 10px;
}

.we-api-form {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.we-api-field-group {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 11px;
  border: 1px solid var(--we-border);
  border-radius: var(--we-radius-sm, 8px);
  background: color-mix(in srgb, var(--we-input) 70%, var(--we-surface));
}

.we-api-field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

.we-api-field-head strong {
  color: var(--we-text);
  font-size: 11px;
}

.we-api-field-head span {
  color: var(--we-muted);
  font-size: 10px;
}

.we-api-field-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
}

.we-api-field-grid label,
.we-api-field-control,
.we-api-routing > label {
  display: grid;
  min-width: 0;
  gap: 5px;
  color: var(--we-muted);
  font-size: 11px;
}

.we-api-field-grid label.wide,
.we-api-field-control.wide {
  grid-column: span 2;
}

.we-api-field-control > label {
  color: var(--we-muted);
  font-size: 11px;
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

.we-api-field-grid input,
.we-api-field-grid select,
.we-api-routing select {
  min-width: 0;
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
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.we-api-routing-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  flex-wrap: wrap;
}

.we-api-save-state {
  color: var(--we-muted);
  font-size: 10px;
}

.we-api-save-state.dirty {
  color: var(--we-warning, var(--we-muted));
  font-weight: 700;
}

.we-api-actions .we-btn {
  flex: 0 1 auto;
  min-width: 108px;
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
  grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.3fr);
  gap: 12px 18px;
  min-width: 0;
}

.we-api-routing-options {
  display: grid;
  grid-column: span 2;
  gap: 5px;
  min-width: 0;
  padding-top: 2px;
}

.we-api-routing-options .we-api-field-head {
  margin-bottom: 2px;
}

.we-api-fallbacks {
  display: grid;
  min-width: 0;
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
  min-width: 0;
  min-height: 31px;
  padding: 3px 7px;
  border: 1px solid var(--we-border);
  border-radius: 7px;
  background: var(--we-input);
}

.we-api-route-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
  color: var(--we-text);
  cursor: pointer;
  font-size: 11px;
}

.we-api-route-toggle span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.we-api-route-order {
  flex: none;
  color: var(--we-muted);
  font-size: 10px;
  white-space: nowrap;
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
  color: var(--we-text) !important;
}

.we-api-route-summary {
  display: grid;
  gap: 4px;
  overflow-wrap: anywhere;
  padding: 9px 11px;
  border-radius: 8px;
  background: var(--we-tint);
  color: var(--we-muted);
  font-size: 11px;
}

.we-api-route-summary strong {
  overflow-wrap: anywhere;
  color: var(--we-text);
  word-break: break-word;
}

.we-api-bridge {
  padding-bottom: 13px;
}

.we-api-bridge-status {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--we-border);
  border-radius: var(--we-radius-sm, 8px);
  background: var(--we-input);
}

.we-api-bridge-status.ready {
  border-color: color-mix(in srgb, var(--we-success, var(--we-accent)) 45%, var(--we-border));
  background: color-mix(in srgb, var(--we-success, var(--we-accent)) 7%, var(--we-input));
}

.we-api-bridge-status > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.we-api-bridge-status strong {
  color: var(--we-text);
  font-size: 11px;
}

.we-api-bridge-status p {
  margin: 0;
}

.we-api-bridge-dot {
  width: 8px;
  height: 8px;
  flex: none;
  margin-top: 4px;
  border-radius: 50%;
  background: var(--we-muted);
}

.we-api-bridge-status.ready .we-api-bridge-dot {
  background: var(--we-success, var(--we-accent));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--we-success, var(--we-accent)) 18%, transparent);
}

@media (max-width: 700px) {
  .we-api-intro,
  .we-api-section-head {
    display: grid;
  }

  .we-api-badges {
    justify-content: flex-start;
  }

  .we-api-field-grid,
  .we-api-routing {
    grid-template-columns: 1fr;
  }

  .we-api-field-grid label.wide,
  .we-api-field-control.wide,
  .we-api-routing-options {
    grid-column: auto;
  }

  .we-api-section-head {
    gap: 9px;
  }

  .we-api-section-head .we-btn {
    width: 100%;
  }

  .we-api-actions .we-btn {
    flex: 1 1 calc(50% - 8px);
  }
}

@media (max-width: 420px) {
  .we-api-actions .we-btn {
    flex-basis: 100%;
    min-width: 0;
  }
}

@container (max-width: 980px) {
  .we-api-field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .we-api-routing {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  }
}

@container (max-width: 720px) {
  .we-api-field-grid,
  .we-api-routing {
    grid-template-columns: 1fr;
  }

  .we-api-field-grid label.wide,
  .we-api-field-control.wide,
  .we-api-routing-options {
    grid-column: auto;
  }
}
</style>
