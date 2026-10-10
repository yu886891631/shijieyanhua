<template>
  <section class="we-t7-prompts">
    <header>
      <h2>填表提示词与发送预览</h2>
      <p>仅本地模拟，不联网、不保存聊天、不写世界书。模拟成功不验证真实 API Key。</p>
    </header>
    <div class="we-t7-columns">
      <section class="we-t7-card">
        <h3>规则草稿</h3>
        <p>
          启用版本 {{ model.prompts.enabled.revision }} · 草稿保存次数 {{ model.prompts.draftRevision }} ·
          {{ model.prompts.dirty ? '有未保存编辑' : '草稿已保存到内存' }}
        </p>
        <label
          >规则层级<select :value="scope" :disabled="model.busy" @change="selectScope">
            <option value="global">全局</option>
            <option value="phase:macro">宏观阶段</option>
            <option value="phase:micro">微观阶段</option>
            <option v-for="table in model.tables" :key="table.id" :value="`table:${table.id}`">
              表：{{ table.name }}（{{ table.id }}）
            </option>
          </select></label
        >
        <label v-if="scope !== 'global'"
          >继承方式<select :value="choice.state" :disabled="model.busy" @change="changeMode">
            <option value="inherit">继承上层</option>
            <option value="value">此层自定义</option>
            <option value="disabled">关闭此层补充规则</option>
          </select></label
        >
        <label v-if="choice.state === 'value'"
          >补充规则<textarea
            :value="choice.value"
            :disabled="model.busy"
            maxlength="12000"
            rows="7"
            @input="editText"
          ></textarea>
        </label>
        <p>关闭补充规则不关闭全局规则、表级生命周期规则或代码校验。表级新增/更新/归档规则仍在“结构与参数”编辑。</p>
        <div class="we-t7-actions">
          <button type="button" :disabled="model.busy" @click="workbench.saveDraft()">保存草稿</button
          ><button type="button" :disabled="model.busy || model.prompts.dirty" @click="workbench.enable()">
            启用已保存草稿</button
          ><button type="button" :disabled="model.busy" @click="workbench.discardDraft()">撤销未保存编辑</button>
        </div>
        <p>保存草稿不会进入生成；启用只影响下一轮。当前冻结请求不会随编辑改变。关闭/刷新会丢失本地配置。</p>
      </section>
      <section class="we-t7-card">
        <h3>冻结一轮输入</h3>
        <p>使用已保存世界资料和启用规则；未保存的资料/结构草稿不能混入。</p>
        <div class="we-t7-actions">
          <button type="button" :disabled="model.busy" @click="workbench.freeze()">冻结并预览宏观请求</button
          ><button type="button" :disabled="model.busy || !model.run" @click="workbench.planMicro()">
            查看微观计划</button
          ><button type="button" :disabled="model.busy || !model.run" @click="workbench.discardRun()">
            关闭本轮预览
          </button>
        </div>
        <p v-if="!model.run">尚未冻结。这里没有真实演变的运行按钮。</p>
        <template v-else
          ><p>
            资料版本 {{ model.run.baseRevision }} · 模板版本 {{ model.run.templateVersion }} · 发送规则版本
            {{ model.run.promptVersion }}
          </p>
          <p>模拟已发送 {{ model.run.sent }} / {{ model.run.maxRequests }} 次（重试也计数）</p>
          <p>前置状态：{{ model.run.ready ? '已核对本轮证据' : '阻断：必要前置未完成/未落盘/身份失配' }}</p>
          <ul>
            <li v-for="source in model.run.prerequisites.reports" :key="source.sourceId">
              {{ source.sourceId }} · {{ source.state }} · {{ source.reason }}
            </li>
          </ul></template
        >
      </section>
    </div>
    <p v-if="model.error" class="we-t7-error" role="alert">{{ model.error }}</p>
    <p v-if="model.inputInvalidated" class="we-t7-error" role="alert">
      本轮剧情/swipe 或前置结果已改变；旧请求不能发送，请重新冻结。
    </p>
    <section v-for="phase in phases" :key="phase.stage" class="we-t7-card">
      <h3>
        {{ phase.stage === 'macro' ? '宏观世界' : '微观世界' }} ·
        {{ phase.status === 'final' ? '已冻结计划' : '待宏观结果，不是最终输入' }}
      </h3>
      <ul>
        <li v-for="table in phase.tables" :key="table.tableId">
          {{ tableLabel(table.tableId) }} · API 来源：{{ table.route.source }} → {{ table.route.name || '未配置' }} /
          {{ table.route.model || '无模型' }}<span v-if="table.skip"> · {{ table.skip }}</span>
        </li>
      </ul>
      <details v-if="phase.candidates.length">
        <summary>候选与跳过理由（稳定表 ID + 行 ID）</summary>
        <ul>
          <li v-for="candidate in phase.candidates" :key="`${candidate.tableId}/${candidate.rowId}`">
            {{ candidate.tableId }}/{{ candidate.rowId }} · {{ candidate.reasons.join('、') || '后台候选' }} ·
            {{ candidate.selected ? '已选择' : candidate.skipped }}
          </li>
        </ul>
      </details>
      <article v-for="request in phase.requests" :key="request.id" class="we-t7-request">
        <h4>{{ tableLabel(request.tableId) }} · 补充规则来源 {{ request.promptSource }}</h4>
        <p>
          {{ request.contextRows }} 行 · {{ request.chars }} 字符 · 约 {{ request.estimatedTokens }} token（非费用保证）
        </p>
        <p>{{ request.sources.map(s => `${s.source}：${s.label}`).join(' / ') }}</p>
        <ul>
          <li v-for="(cut, index) in request.omitted" :key="index">{{ cut.source }}：{{ cut.reason }}</li>
        </ul>
        <details>
          <summary>实际 messages 内容（不含认证头/Key）</summary>
          <div v-for="(message, index) in request.messages" :key="index">
            <h4>{{ message.role }}</h4>
            <pre>{{ message.content }}</pre>
          </div>
        </details>
        <button type="button" :disabled="model.busy" @click="workbench.simulate(request.id)">
          模拟此请求（不联网）
        </button>
      </article>
    </section>
    <section v-if="model.result" class="we-t7-card">
      <h3>模拟响应</h3>
      <p>仅假模型返回，未执行 SQL、未更新世界。</p>
      <pre>{{ JSON.stringify(model.result, null, 2) }}</pre>
    </section>
    <ul v-if="model.run">
      <li v-for="notice in model.run.notices" :key="notice">{{ notice }}</li>
    </ul>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import type { T2Inherited } from './t2-template';
import type { T7Workbench, T7WorkbenchView } from './t7-workbench';
const props: { workbench: T7Workbench } = defineProps<{ workbench: T7Workbench }>();
const workbench: T7Workbench = props.workbench;
const model = shallowRef<T7WorkbenchView>(workbench.view());
const scope = ref('global');
const stop = workbench.subscribe(() => {
  model.value = workbench.view();
});
onBeforeUnmount(stop);
const choice = computed<T2Inherited<string>>(() => {
  const draft = model.value.prompts.draft;
  return scope.value === 'global'
    ? { state: 'value', value: draft.global }
    : scope.value === 'phase:macro' || scope.value === 'phase:micro'
      ? draft.phases[scope.value === 'phase:macro' ? 'macro' : 'micro']
      : (draft.tables[scope.value.slice(6)] ?? { state: 'inherit' });
});
const phases = computed(() =>
  model.value.run ? [model.value.run.macro, model.value.run.micro].filter(p => p !== null) : [],
);
function value(event: Event) {
  return (event.target as HTMLInputElement).value;
}
function tableLabel(id: string) {
  const table = model.value.tables.find(t => t.id === id);
  return table ? `${table.name}（${id}）` : id;
}
function selectScope(event: Event) {
  scope.value = value(event);
}
function changeMode(event: Event) {
  const mode = value(event);
  workbench.editPrompt(
    scope.value,
    mode === 'value'
      ? { state: 'value', value: '' }
      : mode === 'disabled'
        ? { state: 'disabled' }
        : { state: 'inherit' },
  );
}
function editText(event: Event) {
  workbench.editPrompt(scope.value, { state: 'value', value: value(event) });
}
</script>
<style scoped>
.we-t7-prompts {
  min-width: 0;
  color: var(--we14-text, #294f3c);
  background: var(--we14-surface, #f0f7ef);
  padding: 16px;
  border-radius: 12px;
  overflow-wrap: anywhere;
}
.we-t7-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
  gap: 14px;
}
.we-t7-card {
  background: var(--we14-card, #f9fcf7);
  border: 1px solid var(--we14-border, #b6cebc);
  padding: 14px;
  border-radius: 10px;
  margin-bottom: 14px;
  min-width: 0;
}
.we-t7-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
label {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}
textarea,
select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  color: var(--we14-text, #294f3c);
  background: var(--we14-control, #fffef8);
  border: 1px solid var(--we14-border, #a9c5b4);
  padding: 8px;
  border-radius: 8px;
}
button {
  color: var(--we14-text, #294f3c);
  background: var(--we14-soft, #e0efe3);
  border: 1px solid var(--we14-border, #a9c5b4);
  border-radius: 8px;
  padding: 8px 12px;
  white-space: normal;
}
button:disabled {
  opacity: 0.55;
}
.we-t7-error {
  color: var(--we14-danger-text, #7d3049);
  background: var(--we14-danger-bg, #fce6ee);
  padding: 12px;
  border-radius: 8px;
}
.we-t7-request {
  border-top: 1px solid var(--we14-border, #c6d9ca);
  padding-top: 12px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.9em;
  background: var(--we14-soft, #edf4e9);
  padding: 10px;
  border-radius: 8px;
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 3px;
}
</style>
