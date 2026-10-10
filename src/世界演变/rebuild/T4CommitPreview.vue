<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { createT4PreviewModel } from './t4-preview';

const props = defineProps<{ input?: unknown }>();
const emit = defineEmits<{ 'consent-change': [consent: boolean] }>();
const model = computed(() => createT4PreviewModel(props.input));
const consent = ref(false);
// Consent belongs to one exact preview, never carries across replacement input/status.
watch(
  () => props.input,
  () => {
    consent.value = false;
    emit('consent-change', false);
  },
  { deep: false },
);
function setConsent(event: Event): void {
  const checked = (event.target as HTMLInputElement | null)?.checked === true;
  consent.value = model.value.confirmationAllowed && checked;
  emit('consent-change', consent.value);
}
</script>

<template>
  <section class="we-t4-preview" aria-label="T4 模拟提交只读预览">
    <header>
      <p class="we-t4-eyebrow">T4 · 提交与恢复预览</p>
      <h2>确认修改与保存范围</h2>
      <p class="we-t4-boundary">独立模拟存档，未写当前聊天</p>
      <p class="we-t4-note">这里不执行SQL、不调用API、不写世界书。状态来自提交流程，勾选确认也不会直接保存。</p>
    </header>
    <section :class="['we-t4-status', `we-t4-${model.tone}`]" :role="model.tone === 'danger' ? 'alert' : 'status'">
      <strong>{{ model.badge }}</strong>
      <p>{{ model.explanation }}</p>
      <p v-if="model.error">{{ model.error }}</p>
      <p class="we-t4-note">{{ model.draftNotice }}</p>
    </section>
    <template v-if="model.valid">
      <section class="we-t4-card">
        <h3>本次操作范围 · {{ model.kindLabel }}</h3>
        <dl v-if="model.scope">
          <div>
            <dt>模拟聊天</dt>
            <dd>{{ model.scope.chatId }}</dd>
          </div>
          <div>
            <dt>世界</dt>
            <dd>{{ model.scope.worldId }}</dd>
          </div>
          <div>
            <dt>分支</dt>
            <dd>{{ model.scope.branchId }}</dd>
          </div>
          <template v-if="model.anchor">
            <div>
              <dt>助手消息</dt>
              <dd>{{ model.anchor.messageId }}</dd>
            </div>
            <div>
              <dt>消息版本</dt>
              <dd>{{ model.anchor.swipeId }}</dd>
            </div>
          </template>
        </dl>
        <p v-if="model.commit" class="we-t4-note">
          提交身份：{{ model.commit.id }}<span v-if="model.commit.seq !== null"> · 序号{{ model.commit.seq }}</span>
        </p>
        <p>{{ model.confirmationReason }}</p>
        <label class="we-t4-confirm">
          <input
            type="checkbox"
            :checked="consent && model.confirmationAllowed"
            :disabled="!model.confirmationAllowed"
            @change="setConsent"
          />
          <span>我已查看差异，并确认操作只针对上述独立模拟世界</span>
        </label>
        <p class="we-t4-note">此勾选仅表达确认，不授予保存权限，也不会改动原聊天或其它世界。</p>
      </section>
      <section class="we-t4-card">
        <h3>用户可见的修改</h3>
        <div class="we-t4-summary">
          <div>
            <span>新增</span><strong>{{ model.summary.inserted }}</strong>
          </div>
          <div>
            <span>修改</span><strong>{{ model.summary.updated }}</strong>
          </div>
          <div>
            <span>删除</span><strong>{{ model.summary.deleted }}</strong>
          </div>
        </div>
        <p class="we-t4-note">只统计能够公开展示的业务变化；隐藏表、记录、字段与私密引用不在摘要中公开。</p>
        <article v-for="change in model.changes" :key="`${change.tableId}:${change.rowId}`" class="we-t4-change">
          <h4>{{ change.operation }} · {{ change.groupName }} / {{ change.tableName }}</h4>
          <p class="we-t4-note">记录：{{ change.rowId }}</p>
          <div v-for="field in change.fields" :key="field.fieldId" class="we-t4-field">
            <strong>{{ field.name }}</strong>
            <div class="we-t4-diff">
              <div>
                <span>修改前</span>
                <p>{{ field.before }}</p>
              </div>
              <div>
                <span>修改后</span>
                <p>{{ field.after }}</p>
              </div>
            </div>
          </div>
        </article>
        <p v-if="!model.changes.length">没有可公开展示的业务差异。这里不会据此猜测隐藏内容或声称已经保存。</p>
        <p v-if="model.summary.truncated" class="we-t4-note">
          记录较多，只展开前100条可见差异；上方数量为全部可见差异。
        </p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.we-t4-preview {
  color: #29443a;
  background: #f5f7ed;
  border: 1px solid #d3e1cd;
  border-radius: 16px;
  padding: 20px;
  overflow-wrap: anywhere;
  font:
    14px/1.65 system-ui,
    sans-serif;
}
.we-t4-preview h2,
.we-t4-preview h3,
.we-t4-preview h4,
.we-t4-preview p {
  margin: 0 0 10px;
}
.we-t4-eyebrow,
.we-t4-boundary {
  color: #477b60;
  font-weight: 700;
}
.we-t4-boundary {
  background: #e8f0df;
  padding: 10px 12px;
  border-radius: 8px;
}
.we-t4-note {
  color: #617166;
  font-size: 13px;
}
.we-t4-status,
.we-t4-card {
  margin-top: 16px;
  border: 1px solid #dae4d4;
  border-radius: 12px;
  padding: 16px;
  background: #fffef9;
}
.we-t4-success {
  background: #e8f0df;
  border-color: #bad4b0;
}
.we-t4-warning {
  background: #faf1d9;
  border-color: #dfd0a7;
  color: #705b2e;
}
.we-t4-danger {
  background: #fce9ec;
  border-color: #edc1cd;
  color: #803d50;
}
.we-t4-preview dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 24px;
  margin: 0 0 12px;
}
.we-t4-preview dl div {
  min-width: 0;
}
.we-t4-preview dt {
  color: #617166;
}
.we-t4-preview dd {
  margin: 0;
  font-weight: 600;
}
.we-t4-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.we-t4-summary div {
  background: #e8f0df;
  border-radius: 10px;
  padding: 12px;
}
.we-t4-summary span,
.we-t4-summary strong {
  display: block;
}
.we-t4-summary strong {
  font-size: 22px;
}
.we-t4-confirm {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  margin-bottom: 10px;
}
.we-t4-confirm input {
  flex: 0 0 auto;
  margin: 5px 0 0;
  accent-color: #507e58;
}
.we-t4-confirm input:focus-visible {
  outline: 2px solid #507e58;
  outline-offset: 3px;
}
.we-t4-confirm:has(input:disabled) {
  cursor: default;
  color: #617166;
}
.we-t4-change {
  margin-top: 16px;
  border-top: 1px solid #dae4d4;
  padding-top: 16px;
}
.we-t4-field + .we-t4-field {
  margin-top: 10px;
}
.we-t4-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 6px;
}
.we-t4-diff > div {
  min-width: 0;
  border-radius: 8px;
  padding: 10px;
  background: #f5f7ed;
}
.we-t4-diff > div + div {
  background: #e8f0df;
}
.we-t4-diff span {
  color: #617166;
  font-size: 12px;
}
.we-t4-diff p {
  white-space: pre-wrap;
}
@media (max-width: 680px) {
  .we-t4-preview,
  .we-t4-card,
  .we-t4-status {
    padding: 12px;
  }
  .we-t4-preview dl,
  .we-t4-diff {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
