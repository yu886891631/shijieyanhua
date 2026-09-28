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
      <span class="we-status-pill">仅保存草稿</span>
    </div>

    <div class="we-prompt-toolbar">
      <button class="we-btn" type="button" @click="importPrompt">导入 JSON</button>
      <button class="we-btn" type="button" @click="exportPrompt">导出 JSON</button>
      <button class="we-btn" type="button" @click="restoreExample">载入清理版样例</button>
      <button class="we-btn we-btn-primary" type="button" @click="savePrompt">保存草稿</button>
      <span class="we-prompt-status" role="status">{{ isDirty ? '有未保存的改动' : status }}</span>
    </div>

    <div class="we-prompt-notice">
      这份样例保留了你给的“多角色消息链”结构，并改成世界演变数据库的 operations 格式。
      原文件中要求忽略安全边界、放开年龄限制的段落没有照搬；提示词草稿也尚未接到真实运行链路。
    </div>

    <div class="we-message-list">
      <article v-for="(message, index) in messages" :key="index" class="we-message-card">
        <header class="we-message-head">
          <div class="we-message-number">#{{ index + 1 }}</div>
          <select v-model="message.role" class="we-role-select" aria-label="提示词角色">
            <option v-for="role in roles" :key="role" :value="role">{{ role }}</option>
          </select>
          <label class="we-enabled">
            <input v-model="message.enabled" type="checkbox" />
            <span>启用</span>
          </label>
          <div class="we-message-actions">
            <button
              class="we-icon-btn"
              type="button"
              :disabled="index === 0"
              aria-label="上移"
              title="上移"
              @click="moveMessage(index, -1)"
            >
              ↑
            </button>
            <button
              class="we-icon-btn"
              type="button"
              :disabled="index === messages.length - 1"
              aria-label="下移"
              title="下移"
              @click="moveMessage(index, 1)"
            >
              ↓
            </button>
            <button
              class="we-icon-btn we-icon-danger"
              type="button"
              aria-label="删除"
              title="删除"
              @click="removeMessage(index)"
            >
              ×
            </button>
          </div>
        </header>
        <textarea
          v-model="message.content"
          class="we-message-content"
          spellcheck="false"
          :aria-label="`第 ${index + 1} 条提示词内容`"
          placeholder="输入这一条消息的提示词内容…"
        />
      </article>
    </div>

    <button class="we-add-message" type="button" @click="addMessage">＋ 添加消息</button>

    <input ref="fileInput" class="we-file-input" type="file" accept="application/json,.json" @change="onImportFile" />
  </section>
</template>

<script setup lang="ts">
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
const status = ref('草稿已载入');
const fileInput = ref<HTMLInputElement | null>(null);
let savedPromptJson = JSON.stringify(messages.value);
const isDirty = computed(() => JSON.stringify(messages.value) !== savedPromptJson);

function moveMessage(index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= messages.value.length) return;
  const list = [...messages.value];
  [list[index], list[target]] = [list[target], list[index]];
  messages.value = list;
}

function removeMessage(index: number) {
  if (messages.value.length <= 1) {
    status.value = '至少保留一条消息';
    return;
  }
  messages.value.splice(index, 1);
  status.value = '有未保存的改动';
}

function addMessage() {
  messages.value.push({ role: 'USER', content: '', enabled: true });
  status.value = '有未保存的改动';
}

function savePrompt() {
  try {
    const normalized = normalizeWorldEvolutionPromptMessages(messages.value);
    saveWorldEvolutionPromptDraft(normalized);
    messages.value = normalized;
    savedPromptJson = JSON.stringify(normalized);
    status.value = `已保存 ${normalized.length} 条消息（草稿）`;
  } catch (error) {
    status.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function restoreExample() {
  if (!window.confirm('载入清理版样例会替换当前编辑内容。继续吗？')) return;
  messages.value = resetWorldEvolutionPromptDraft();
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
    messages.value = normalizeWorldEvolutionPromptMessages(parsed);
    status.value = `已导入 ${messages.value.length} 条消息；保存后生效为草稿`;
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
  flex-wrap: wrap;
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
  .we-page-intro {
    display: grid;
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
}
</style>
