<template>
  <section class="we-t8-macro" aria-label="宏观演算工作台">
    <header>
      <h2>宏观演算</h2>
      <p>先更新宏观条件，再交给微观对象。本页仅使用本地模拟响应。</p>
    </header>
    <div class="notice" role="status">
      {{ model.status === 'staged' ? '宏观结果暂存中，尚未正式保存。' : '本阶段只会暂存宏观结果，不会正式保存。' }}
      这里没有保存世界、调用真实 API 或上传世界书的按钮。
    </div>
    <div class="actions">
      <button type="button" :disabled="busy" @click="start">开始模拟宏观</button>
      <button type="button" :disabled="!cancellable" class="danger" @click="controller.cancel()">取消本轮</button>
      <button type="button" :disabled="!model.runId" @click="controller.check()">检查暂存是否仍有效</button>
    </div>
    <p v-if="localError" role="alert" class="danger-box">{{ localError }}</p>
    <dl class="summary">
      <div>
        <dt>运行状态</dt>
        <dd>{{ statusName[model.status] }}</dd>
      </div>
      <div>
        <dt>正式版本</dt>
        <dd>{{ model.baseRevision ?? '尚未冻结' }}</dd>
      </div>
      <div>
        <dt>模板 / 提示词版本</dt>
        <dd>{{ model.templateVersion ?? '未冻结' }} / {{ model.promptVersion ?? '未冻结' }}</dd>
      </div>
      <div>
        <dt>宏观进度</dt>
        <dd>{{ model.completed }} / {{ model.total }} 张表</dd>
      </div>
      <div>
        <dt>模拟发送额度</dt>
        <dd>{{ model.sent }} / {{ model.maxRequests }} 次（包括重试）</dd>
      </div>
    </dl>
    <p>
      本轮世界时间：{{
        model.worldTime ? `${model.worldTime.calendarId} · ${model.worldTime.ordinalMinute} 分钟` : '未指定'
      }}（本阶段不推进）
    </p>
    <section>
      <h3>必要前置</h3>
      <p v-if="!model.prerequisites">开始后逐一检查；没有前置来源的模拟样本直接运行。</p>
      <p v-else-if="!model.prerequisites.reports.length">本样本未启用 MVU 或外部数据库前置，不读取它们的资料。</p>
      <ul v-else>
        <li v-for="proof in model.prerequisites.reports" :key="proof.sourceId">
          {{ proof.sourceId }}：{{ proofName[proof.state] }} · {{ proof.required ? '必要' : '可选' }} ·
          {{ proof.reason }}
        </li>
      </ul>
    </section>
    <div v-if="model.error" role="alert" class="danger-box">
      <p>{{ model.error.message }}</p>
      <details>
        <summary>错误详情</summary>
        <p>{{ model.error.code }} · {{ model.runId }}</p>
      </details>
    </div>
    <p v-if="model.outcome === 'simulation-result-unknown'">
      已发出过模拟请求，但这轮结果不可继续使用；模拟不收费。未来真实请求的取消不代表服务商免费或已撤销。
    </p>
    <section>
      <h3>宏观表处理顺序</h3>
      <p v-if="!model.batches.length">没有宏观请求。未到频率、停用或预算阻断的表继承上一次正式状态。</p>
      <article v-for="batch in model.batches" :key="batch.tableId" class="card">
        <h4>{{ batch.tableName }} · {{ batchName[batch.status] }}</h4>
        <p>
          已校验变化 {{ batch.changedRows }} 行，新增 {{ batch.newRows }} 行。API：{{ batch.request.route.name }} /
          {{ batch.request.route.model }}
        </p>
        <details>
          <summary>实际模拟输入与追溯指纹</summary>
          <p>请求：{{ batch.request.fingerprint }}</p>
          <p>执行前：{{ batch.beforeFingerprint ?? '未执行' }}</p>
          <p>执行后：{{ batch.afterFingerprint ?? '未接受结果' }}</p>
          <pre>{{ JSON.stringify(batch.request.messages, null, 2) }}</pre>
        </details>
      </article>
      <ul>
        <li v-for="skip in model.skipped" :key="skip.tableId">{{ skip.tableId }}：{{ skip.reason }}</li>
      </ul>
    </section>
    <section>
      <h3>暂存变化预览</h3>
      <p v-if="model.status === 'staged' && !model.changes.length">宏观处理成功，无有效数据变化；仍未正式保存。</p>
      <p v-else-if="model.status !== 'staged'">整轮宏观校验完成后显示变化；失败、取消或过期后不保留可用暂存。</p>
      <article v-for="change in model.changes" :key="`${change.tableId}/${change.rowId}`" class="card">
        <h4>{{ change.tableName }} · {{ change.rowId }} · {{ changeName[change.kind] }}</h4>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>原来</th>
                <th>暂存结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="field in change.fields" :key="field.id">
                <td>{{ field.name }}</td>
                <td>{{ field.beforePresent ? JSON.stringify(field.before) : '未提供' }}</td>
                <td>{{ field.afterPresent ? JSON.stringify(field.after) : '未提供' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>
    <details>
      <summary>本阶段范围与安全边界</summary>
      <p v-for="notice in model.notices" :key="notice">{{ notice }}</p>
      <p>当前暂存仅在本页运行时内存中；刷新会丢失，不自动重发。</p>
    </details>
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue';
import type { T8Control, T8View } from './t8-control';
const props: { controller: T8Control } = defineProps<{ controller: T8Control }>();
const controller: T8Control = props.controller;
const model = shallowRef<T8View>(controller.view()),
  localError = shallowRef<string | null>(null);
onUnmounted(
  controller.subscribe(() => {
    model.value = controller.view();
  }),
);
const busy = computed(() => ['queued', 'waiting', 'running'].includes(model.value.status));
const cancellable = computed(() => ['queued', 'waiting', 'running', 'staged'].includes(model.value.status));
const statusName = {
  idle: '尚未开始',
  queued: '正在排队',
  waiting: '等待必要前置',
  running: '正在演算宏观',
  staged: '宏观已暂存，未保存',
  cancelled: '已取消',
  stale: '输入过期',
  failed: '未通过检查',
};
const proofName = {
  'not-installed': '未安装',
  disabled: '本轮停用',
  'frequency-skipped': '按频率跳过',
  waiting: '等待完成',
  success: '成功',
  failure: '失败',
  unverifiable: '无法验证',
};
const batchName = { pending: '等待处理', sending: '模拟发送中', validating: 'SQL 校验中', staged: '已校验暂存' };
const changeName = { insert: '新增', update: '修改', delete: '删除' };
let sequence = 0;
async function start() {
  localError.value = null;
  try {
    const result = await controller.start(`t8-ui-${++sequence}`);
    if (result.duplicate) localError.value = '本轮已运行或排队，重复触发已忽略；没有再次发送。';
  } catch {
    localError.value = '无法启动：请检查 API 路由、必要前置或未保存草稿。';
  }
}
</script>
<style scoped>
.we-t8-macro {
  padding: 16px;
  color: var(--we14-text, #294f3c);
  background: var(--we14-surface, #f1f8ef);
  min-width: 0;
  overflow-wrap: anywhere;
  border-radius: 12px;
}
.actions,
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 14px 0;
}
.summary > div,
.card,
.notice {
  padding: 12px;
  background: var(--we14-card, #fcfffa);
  border: 1px solid var(--we14-border, #b6ccba);
  border-radius: 9px;
}
.summary > div {
  flex: 1 1 160px;
}
dt {
  font-size: 0.9em;
}
dd {
  margin: 5px 0 0;
}
button {
  background: var(--we14-soft, #e0efe3);
  color: var(--we14-text, #294f3c);
  border: 1px solid var(--we14-border, #a9c5b4);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
.danger,
.danger-box {
  background: var(--we14-danger-bg, #fbe9ee);
  color: var(--we14-danger-text, #85344e);
  border: 1px solid var(--we14-danger-border, #dca7b6);
  border-radius: 9px;
  padding: 10px;
}
.card {
  margin: 10px 0;
}
h2,
h3,
h4 {
  margin-top: 0;
}
section > h3 {
  margin-top: 22px;
}
.table-scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 8px;
  border-bottom: 1px solid var(--we14-border, #cad9cc);
  text-align: left;
}
pre {
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  background: var(--we14-soft, #e8f2e6);
  padding: 10px;
  border-radius: 8px;
}
summary {
  cursor: pointer;
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .we-t8-macro {
    padding: 10px;
  }
  .actions button {
    flex: 1 1 150px;
  }
}
</style>
