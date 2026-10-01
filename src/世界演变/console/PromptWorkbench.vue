<template>
  <section class="we-prompt-page">
    <div class="we-page-intro">
      <div>
        <p class="we-eyebrow">AI WORKSPACE · PROMPT DRAFT</p>
        <h2>填表提示词</h2>
        <p class="we-subtitle">
          先把多消息提示词放进工作台，支持排序、编辑、导入和导出。当前是草稿，不会参与真实 AI 调用。
        </p>
      </div>
      <span class="we-status-pill">草稿模式 · 未接入真实生成</span>
    </div>

    <div class="we-prompt-boundary">
      这里编辑和保存的是世界演变脚本变量中的独立草稿；不会增加聊天数据库的 revision，也不会进入真实 AI 请求。
    </div>

    <div class="we-prompt-toolbar">
      <section class="we-prompt-tool-group" aria-label="文件操作">
        <strong>文件操作</strong>
        <div class="we-prompt-tool-buttons">
          <button class="we-btn" type="button" @click="importPrompt">导入 JSON</button>
          <button class="we-btn" type="button" @click="exportPrompt">导出 JSON</button>
        </div>
        <small
          >每项至少包含 role 与字符串 content；enabled 可选。导出当前编辑内容，包含停用消息及尚未保存的修改。</small
        >
        <details class="we-import-format">
          <summary>查看 JSON 格式示例</summary>
          <pre><code>[
  {
    "role": "SYSTEM",
    "content": "在这里填写提示词",
    "enabled": true
  }
]</code></pre>
        </details>
      </section>
      <section class="we-prompt-tool-group" aria-label="样例操作">
        <strong>样例与清理</strong>
        <div class="we-prompt-tool-buttons">
          <button class="we-btn" type="button" @click="restoreExample">载入清理版样例</button>
        </div>
        <small>只替换当前编辑区；确认后仍需点击“保存草稿”才会写入脚本变量。</small>
      </section>
      <section class="we-prompt-tool-group we-prompt-save-group" aria-label="保存草稿">
        <strong>保存当前草稿</strong>
        <div class="we-prompt-tool-buttons">
          <button class="we-btn we-btn-primary" type="button" @click="savePrompt">保存草稿</button>
          <span class="we-prompt-status" :class="statusClass" role="status" aria-live="polite">{{ statusText }}</span>
          <span v-if="isDirty" class="we-prompt-dirty-badge">有未保存的改动</span>
        </div>
        <small>保存后仍只保存在本地草稿变量中，不代表已应用到自动演变。</small>
      </section>
    </div>

    <div class="we-prompt-notice">
      清理版样例保留了你给的“多角色消息链”结构，并改成世界演变数据库的 operations
      格式；原文件中要求忽略安全边界、放开年龄限制的段落没有照搬。
      导入和载入样例都不会立即保存。导出则会包含当前编辑区的全部消息（包括停用项）。
    </div>

    <section class="we-prompt-summary" aria-label="消息链摘要">
      <div class="we-prompt-summary-heading">
        <strong>消息链摘要</strong>
        <span class="we-muted">编辑参考；不是实际发送预览</span>
      </div>
      <div class="we-prompt-summary-stats">
        <span>{{ messages.length }} 条消息</span>
        <span>{{ enabledCount }} 条启用</span>
      </div>
      <div class="we-message-sequence">{{ messageSequence || '尚无消息' }}</div>
    </section>

    <section class="we-template-help" aria-label="模板变量说明">
      <div class="we-template-heading">
        <strong>模板变量 · 草稿检查</strong>
        <span class="we-muted">只用于提示词文本编辑，不代表这些变量已接入运行流程</span>
      </div>
      <p>清理版样例中包含以下占位符：</p>
      <div class="we-template-chips">
        <code v-for="variable in sampleTemplateVariables" :key="variable">{{ variable }}</code>
      </div>
      <p v-if="unknownTemplateVariables.length" class="we-template-warning">
        发现样例未列出的占位符：{{ unknownVariableLabel }}。这只是非阻断提醒，文本会原样保留。
      </p>
      <p v-else class="we-muted">当前内容未发现样例之外的占位符；未知占位符不会阻止保存或导出。</p>
    </section>

    <div class="we-message-list">
      <div class="we-message-list-note">消息按此处顺序排列；文本框可拖动右下角调整高度。</div>
      <article v-for="(message, index) in messages" :key="index" class="we-message-card">
        <header class="we-message-head">
          <div class="we-message-number">消息 {{ index + 1 }}</div>
          <select v-model="message.role" class="we-role-select" aria-label="提示词角色" @change="markEdited">
            <option v-for="role in roles" :key="role" :value="role">{{ role }}</option>
          </select>
          <label class="we-enabled">
            <input v-model="message.enabled" type="checkbox" @change="markEdited" />
            <span>启用</span>
          </label>
          <div class="we-message-actions">
            <button
              class="we-icon-btn"
              type="button"
              :disabled="index === 0"
              :aria-label="`上移第 ${index + 1} 条消息`"
              title="上移消息"
              @click="moveMessage(index, -1)"
            >
              ↑
            </button>
            <button
              class="we-icon-btn"
              type="button"
              :disabled="index === messages.length - 1"
              :aria-label="`下移第 ${index + 1} 条消息`"
              title="下移消息"
              @click="moveMessage(index, 1)"
            >
              ↓
            </button>
            <button
              class="we-icon-btn we-expand-btn"
              type="button"
              :aria-label="expandedMessage === message ? '收起编辑区' : '扩大编辑区'"
              :aria-pressed="expandedMessage === message"
              :title="expandedMessage === message ? '收起编辑区' : '扩大编辑区'"
              @click="toggleExpanded(message)"
            >
              {{ expandedMessage === message ? '−' : '＋' }}
            </button>
            <button
              class="we-icon-btn we-icon-danger"
              type="button"
              :disabled="messages.length <= 1"
              :aria-label="`删除第 ${index + 1} 条消息`"
              :title="messages.length <= 1 ? '至少保留一条消息' : '删除消息'"
              @click="removeMessage(index)"
            >
              ×
            </button>
          </div>
        </header>
        <textarea
          v-model="message.content"
          class="we-message-content"
          :class="{ 'we-message-content-expanded': expandedMessage === message }"
          spellcheck="false"
          :aria-label="`第 ${index + 1} 条提示词内容`"
          placeholder="输入这一条消息的提示词内容…"
          @input="markEdited"
        />
      </article>
    </div>

    <button class="we-add-message" type="button" @click="addMessage">＋ 添加消息</button>

    <input ref="fileInput" class="we-file-input" type="file" accept="application/json,.json" @change="onImportFile" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import {
  INITIAL_WORLD_EVOLUTION_PROMPT,
  loadWorldEvolutionPromptDraft,
  normalizeWorldEvolutionPromptMessages,
  resetWorldEvolutionPromptDraft,
  saveWorldEvolutionPromptDraft,
  type WorldEvolutionPromptMessage,
  type WorldEvolutionPromptRole,
} from '../prompt';

const roles: WorldEvolutionPromptRole[] = ['SYSTEM', 'USER', 'ASSISTANT'];
const messages = ref<WorldEvolutionPromptMessage[]>(loadWorldEvolutionPromptDraft());
const status = ref('当前脚本变量中的草稿已载入');
const fileInput = ref<HTMLInputElement | null>(null);
const expandedMessage = shallowRef<WorldEvolutionPromptMessage | null>(null);
let savedPromptJson = JSON.stringify(messages.value);
const isDirty = computed(() => JSON.stringify(messages.value) !== savedPromptJson);
const statusText = computed(() => status.value);
const statusClass = computed(() => {
  if (/失败|错误|无效|为空/.test(status.value)) return 'is-error';
  if (/已保存|已导出/.test(status.value)) return 'is-success';
  return '';
});
const enabledCount = computed(() => messages.value.filter(message => message.enabled !== false).length);
const messageSequence = computed(() =>
  messages.value
    .map((message, index) => `${index + 1}. ${message.role}${message.enabled === false ? '（停用）' : ''}`)
    .join(' → '),
);

function extractTemplateVariables(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g), match => match[1]);
}

const sampleTemplateVariables = Array.from(
  new Set(INITIAL_WORLD_EVOLUTION_PROMPT.flatMap(message => extractTemplateVariables(message.content))),
);
const currentTemplateVariables = computed(() =>
  Array.from(new Set(messages.value.flatMap(message => extractTemplateVariables(message.content)))),
);
const unknownTemplateVariables = computed(() =>
  currentTemplateVariables.value.filter(variable => !sampleTemplateVariables.includes(variable)),
);
const unknownVariableLabel = computed(() =>
  unknownTemplateVariables.value.map(variable => `{{${variable}}}`).join('、'),
);

function beforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));

function toggleExpanded(message: WorldEvolutionPromptMessage) {
  expandedMessage.value = expandedMessage.value === message ? null : message;
}

function markEdited() {
  status.value = '草稿内容已修改';
}

function moveMessage(index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= messages.value.length) return;
  const list = [...messages.value];
  [list[index], list[target]] = [list[target], list[index]];
  messages.value = list;
  markEdited();
}

function removeMessage(index: number) {
  if (messages.value.length <= 1) {
    status.value = '至少保留一条消息';
    return;
  }
  if (expandedMessage.value === messages.value[index]) expandedMessage.value = null;
  messages.value.splice(index, 1);
  markEdited();
}

function addMessage() {
  messages.value.push({ role: 'USER', content: '', enabled: true });
  markEdited();
}

function savePrompt() {
  const emptyIndex = messages.value.findIndex(message => !message.content.trim());
  if (emptyIndex >= 0) {
    status.value = `第 ${emptyIndex + 1} 条消息内容为空；请补全或删除后再保存，避免空消息被规范化时跳过`;
    return;
  }
  try {
    const normalized = normalizeWorldEvolutionPromptMessages(messages.value);
    saveWorldEvolutionPromptDraft(normalized);
    messages.value = normalized;
    expandedMessage.value = null;
    savedPromptJson = JSON.stringify(normalized);
    status.value = `已保存 ${normalized.length} 条消息（草稿）`;
  } catch (error) {
    status.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function restoreExample() {
  const overwriteNote = isDirty.value ? '\n\n这会覆盖当前未保存的修改。' : '';
  const rolePreview = INITIAL_WORLD_EVOLUTION_PROMPT.map(message => message.role).join(' → ');
  if (
    !window.confirm(
      `载入清理版样例将替换当前编辑区（${INITIAL_WORLD_EVOLUTION_PROMPT.length} 条消息：${rolePreview}）。\n样例已改为 operations 格式，并移除了原文件中忽略安全边界、放开年龄限制的段落。\n本次只替换内存编辑内容，不会立即保存或接入真实 AI。${overwriteNote}\n\n继续载入？`,
    )
  ) {
    status.value = '已取消载入；当前编辑内容未更改';
    return;
  }
  messages.value = resetWorldEvolutionPromptDraft();
  expandedMessage.value = null;
  status.value = `已载入 ${INITIAL_WORLD_EVOLUTION_PROMPT.length} 条清理版样例；点击“保存草稿”后写入`;
}

function importPrompt() {
  fileInput.value?.click();
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    if (!Array.isArray(parsed)) throw new Error('提示词 JSON 顶层必须是消息数组');
    if (!parsed.length) throw new Error('消息数组为空；为避免自动回退到清理版样例，本次未导入');

    const warnings: string[] = [];
    parsed.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`第 ${index + 1} 项必须是消息对象`);
      }
      const message = item as Record<string, unknown>;
      if (typeof message.content !== 'string') {
        throw new Error(`第 ${index + 1} 项的 content 必须是字符串`);
      }
      const role = typeof message.role === 'string' ? message.role.toUpperCase() : '';
      if (!roles.includes(role as WorldEvolutionPromptRole)) {
        warnings.push(`第 ${index + 1} 项角色无效，将按现有规则转为 USER`);
      }
      if (!message.content.trim()) warnings.push(`第 ${index + 1} 项内容为空，导入规范化时会跳过`);
      if (message.enabled !== undefined && typeof message.enabled !== 'boolean') {
        warnings.push(`第 ${index + 1} 项 enabled 不是布尔值，将按现有规则处理为启用`);
      }
    });

    const validContentCount = parsed.reduce((count, item) => {
      const content = (item as Record<string, unknown>).content;
      return count + (typeof content === 'string' && content.trim() ? 1 : 0);
    }, 0);
    if (!validContentCount) throw new Error('没有可导入的非空消息；当前草稿未更改');

    const normalized = normalizeWorldEvolutionPromptMessages(parsed);
    const enabledInNormalized = normalized.filter(message => message.enabled !== false).length;
    const warningPreview = warnings.slice(0, 6);
    if (warnings.length > warningPreview.length) {
      warningPreview.push(`另有 ${warnings.length - warningPreview.length} 条同类提醒`);
    }
    const warningSummary = warningPreview.length ? `\n\n导入规范化提示：\n- ${warningPreview.join('\n- ')}` : '';
    const overwriteSummary = isDirty.value ? '\n\n这会覆盖当前未保存的修改。' : '';
    const rolePreview = normalized.map(message => message.role).slice(0, 10);
    if (normalized.length > rolePreview.length) rolePreview.push(`另有 ${normalized.length - rolePreview.length} 条`);
    const confirmed = window.confirm(
      `导入预览：${file.name}\n${normalized.length} 条有效消息，${enabledInNormalized} 条启用。\n消息顺序：${rolePreview.join(' → ')}。\n导入后只替换编辑区，仍需点击“保存草稿”才会写入。${warningSummary}${overwriteSummary}\n\n确认导入？`,
    );
    if (!confirmed) {
      status.value = '已取消导入；当前编辑内容未更改';
      return;
    }

    messages.value = normalized;
    expandedMessage.value = null;
    status.value = `已导入 ${normalized.length} 条消息到编辑区；点击“保存草稿”后写入`;
  } catch (error) {
    status.value = `导入失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    input.value = '';
  }
}

function exportPrompt() {
  const normalized = messages.value.map(message => ({
    role: message.role,
    content: message.content,
    deletable: true,
    mainSlot: '',
    isMain: false,
    isMain2: false,
    enabled: message.enabled !== false,
  }));
  const blob = new Blob([JSON.stringify(normalized, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'world-evolution-prompt-draft.json';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  status.value = `已导出当前编辑区 ${normalized.length} 条消息（含停用项${isDirty.value ? '及未保存修改' : ''}）`;
}
</script>

<style scoped lang="scss">
.we-prompt-page {
  display: grid;
  gap: 16px;
  max-width: 1120px;
  margin: 0 auto;
}

.we-page-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.we-eyebrow {
  margin: 0 0 5px;
  color: var(--we-accent);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.we-page-intro h2 {
  margin: 0;
  color: var(--we-text);
  font-size: 24px;
}

.we-subtitle {
  margin: 6px 0 0;
  color: var(--we-muted);
  font-size: 13px;
}

.we-status-pill {
  flex: none;
  padding: 5px 10px;
  border: 1px solid var(--we-border);
  border-radius: 999px;
  background: var(--we-tint);
  color: var(--we-accent);
  font-size: 12px;
}

.we-prompt-toolbar,
.we-message-head,
.we-message-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.we-prompt-toolbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.we-prompt-boundary,
.we-prompt-notice,
.we-prompt-summary,
.we-template-help {
  padding: 12px 14px;
  border: 1px solid var(--we-border);
  border-radius: 11px;
  background: var(--we-surface);
  color: var(--we-text);
  line-height: 1.55;
}

.we-prompt-boundary {
  border-left: 4px solid var(--we-accent);
  background: var(--we-tint);
  font-size: 12px;
}

.we-prompt-tool-group {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--we-border);
  border-radius: 11px;
  background: var(--we-surface);
}

.we-prompt-tool-group > strong,
.we-prompt-summary-heading,
.we-template-heading {
  color: var(--we-text);
  font-size: 13px;
  font-weight: 700;
}

.we-prompt-tool-group small {
  color: var(--we-muted);
  font-size: 11px;
  line-height: 1.5;
}

.we-prompt-tool-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.we-prompt-save-group {
  border-color: color-mix(in srgb, var(--we-accent) 35%, var(--we-border));
}

.we-prompt-status {
  min-width: 0;
  color: var(--we-muted);
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.we-prompt-status.is-success {
  color: var(--we-accent);
}

.we-prompt-status.is-error {
  color: var(--we-danger);
}

.we-prompt-dirty-badge {
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--we-danger) 35%, var(--we-border));
  border-radius: 999px;
  color: var(--we-danger);
  font-size: 11px;
  white-space: nowrap;
}

.we-prompt-summary,
.we-template-help {
  display: grid;
  gap: 8px;
}

.we-prompt-summary-heading,
.we-template-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.we-prompt-summary-stats,
.we-template-chips {
  display: flex;
  gap: 7px;
  align-items: center;
  flex-wrap: wrap;
}

.we-prompt-summary-stats span,
.we-template-chips code {
  padding: 4px 8px;
  border: 1px solid var(--we-border);
  border-radius: 999px;
  background: var(--we-tint);
  color: var(--we-text);
  font-size: 11px;
}

.we-message-sequence {
  overflow-wrap: anywhere;
  color: var(--we-text);
  font-size: 12px;
}

.we-template-help p {
  margin: 0;
  color: var(--we-muted);
  font-size: 12px;
}

.we-template-chips code {
  color: var(--we-accent);
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
}

.we-template-warning {
  color: var(--we-danger) !important;
}

.we-btn,
.we-icon-btn,
.we-add-message,
.we-role-select {
  border: 1px solid var(--we-border);
  border-radius: 9px;
  background: var(--we-surface);
  color: var(--we-text);
  font: inherit;
}

.we-btn {
  min-height: 36px;
  padding: 6px 12px;
  cursor: pointer;
}

.we-btn:hover,
.we-icon-btn:hover:not(:disabled),
.we-add-message:hover {
  border-color: var(--we-accent);
  background: var(--we-tint);
}

.we-btn-primary {
  border-color: transparent;
  background: var(--we-accent);
  color: var(--we-accent-contrast);
  font-weight: 700;
}

.we-prompt-status {
  color: var(--we-muted);
  font-size: 12px;
}

.we-prompt-notice {
  padding: 11px 13px;
  border: 1px solid var(--we-border);
  border-left: 4px solid var(--we-accent);
  border-radius: 10px;
  background: var(--we-tint);
  color: var(--we-text);
  font-size: 12px;
  line-height: 1.6;
}

.we-message-list {
  display: grid;
  gap: 12px;
}

.we-message-list-note {
  color: var(--we-muted);
  font-size: 12px;
}

.we-message-card {
  display: grid;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--we-border);
  border-radius: 13px;
  background: var(--we-surface);
  box-shadow: var(--we-shadow);
}

.we-message-number {
  color: var(--we-accent);
  font-size: 12px;
  font-weight: 750;
}

.we-role-select {
  min-height: 34px;
  padding: 4px 9px;
}

.we-enabled {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  color: var(--we-muted);
  font-size: 12px;
}

.we-message-actions {
  margin-left: 4px;
}

.we-icon-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  cursor: pointer;
  font-size: 17px;
  line-height: 1;
}

.we-icon-btn:disabled {
  opacity: 0.38;
  cursor: default;
}

.we-icon-danger {
  color: var(--we-danger);
}

.we-message-content {
  box-sizing: border-box;
  width: 100%;
  min-height: 155px;
  resize: vertical;
  border: 1px solid var(--we-border);
  border-radius: 9px;
  background: var(--we-input);
  color: var(--we-text);
  padding: 11px 12px;
  font:
    12px/1.6 ui-monospace,
    'Cascadia Code',
    Consolas,
    monospace;
  white-space: pre-wrap;
}

.we-message-content-expanded {
  min-height: 430px;
}

.we-message-content:focus,
.we-role-select:focus {
  outline: 2px solid color-mix(in srgb, var(--we-accent) 52%, transparent);
  outline-offset: 1px;
}

.we-add-message {
  min-height: 42px;
  border-style: dashed;
  color: var(--we-accent);
  cursor: pointer;
  font-weight: 650;
}

.we-file-input {
  display: none;
}

@media (max-width: 640px) {
  .we-prompt-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .we-prompt-save-group {
    grid-column: auto;
  }

  .we-page-intro {
    display: grid;
  }

  .we-status-pill {
    justify-self: start;
  }

  .we-message-head {
    flex-wrap: wrap;
  }

  .we-enabled {
    margin-left: 0;
  }

  .we-message-actions {
    margin-left: auto;
  }

  .we-prompt-tool-buttons .we-btn {
    flex: 1 1 auto;
  }
}

@media (min-width: 641px) and (max-width: 920px) {
  .we-prompt-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .we-prompt-save-group {
    grid-column: 1 / -1;
  }
}
</style>
