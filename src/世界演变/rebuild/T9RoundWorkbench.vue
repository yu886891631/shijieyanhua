<template>
  <section class="we-t9-round" aria-label="整轮演变工作台">
    <header>
      <h2>整轮世界演变</h2>
      <p>宏观条件 → 微观行动 → 统一校验 → 一次模拟保存</p>
    </header>
    <p class="notice">
      本页是本地模拟，零联网、零费用，不修改实际聊天和世界书。开始后会自动保存通过校验的整轮到模拟存档，不是只预览。
    </p>
    <div class="actions">
      <button type="button" :disabled="busy || model.status === 'pending'" @click="start">开始模拟整轮并保存</button>
      <button type="button" class="danger" :disabled="!cancellable" @click="controller.cancel()">取消本轮</button>
      <button type="button" :disabled="busy || !model.canResume" @click="resume">使用同轮暂存续跑 / 重试保存</button>
      <button type="button" :disabled="model.status !== 'pending' || busy" @click="reconcile">仅查询保存结果</button>
    </div>
    <p v-if="localError" role="alert" class="danger-box">{{ localError }}</p>
    <dl class="summary">
      <div>
        <dt>阶段状态</dt>
        <dd>{{ names[model.status] }}</dd>
      </div>
      <div>
        <dt>正式版本</dt>
        <dd>{{ model.baseRevision ?? '未冻结' }} → {{ model.savedRevision ?? '尚未保存' }}</dd>
      </div>
      <div>
        <dt>宏观 / 微观进度</dt>
        <dd>
          {{ model.macro.completed }}/{{ model.macro.total }} ·
          {{ model.batches.filter(b => b.status === 'staged').length }}/{{ model.batches.length }} 张表
        </dd>
      </div>
      <div>
        <dt>整轮模拟发送额度（含重试）</dt>
        <dd>{{ model.sent }} / {{ model.maxRequests }} 次</dd>
      </div>
    </dl>
    <p>
      本轮时间：{{
        model.macro.worldTime
          ? `${model.macro.worldTime.calendarId} · ${model.macro.worldTime.ordinalMinute} 分钟`
          : '未知，未自行编造'
      }}；与数据、频率和轮转同一次保存。
    </p>
    <p v-if="model.error" role="alert" class="danger-box">{{ model.error.message }}</p>
    <p v-if="model.outcome === 'unknown'">
      结果/保存回执未知。模拟不收费；真实请求的取消或超时可能已收费。保存待确认时只查询，不重新生成。
    </p>
    <p v-if="model.outcome === 'saved'" class="notice">
      整轮已确认保存一次。提交 {{ model.commitId }}。{{
        model.status === 'no-change' ? '无业务变化，但成功处理标记已保存，不重复推进。' : '宏观与微观结果同时生效。'
      }}
    </p>
    <p v-else-if="model.outcome === 'not-saved'">整轮未正式保存；宏观变化没有单独落档。</p>
    <section>
      <h3>宏观阶段</h3>
      <p v-if="!model.macro.batches.length">无请求时继承上一份正式宏观条件。</p>
      <p v-for="batch in model.macro.batches" :key="batch.tableId">
        {{ batch.tableName }} · {{ batch.status === 'staged' ? '已校验暂存' : '处理中' }} · 变化
        {{ batch.changedRows }} 行
      </p>
      <p v-for="skip in model.macro.skipped" :key="skip.tableId">{{ skip.tableId }}：{{ skip.reason }}</p>
    </section>
    <section>
      <h3>微观阶段与受影响对象</h3>
      <p v-if="!model.micro">等待本轮宏观通过校验后冻结候选；不会用旧宏观拼接新微观。</p>
      <ul v-if="model.micro">
        <li v-for="c in model.micro.candidates" :key="`${c.tableId}/${c.rowId}`">
          {{ c.tableId }} / {{ c.rowId }} · {{ c.selected ? '入选' : '未入选' }} ·
          {{ c.reasons.join('、') || c.skipped }}
        </li>
      </ul>
      <article v-for="batch in model.batches" :key="batch.tableId" class="card">
        <h4>{{ batch.tableName }} · {{ batchNames[batch.status] }}</h4>
        <p>
          {{ batch.request.route.name }} / {{ batch.request.route.model }} · 已校验变化 {{ batch.changedRows }} 行，新增
          {{ batch.newRows }} 行
        </p>
        <details>
          <summary>实际发送输入（安全文本）</summary>
          <pre>{{ JSON.stringify(batch.request.messages, null, 2) }}</pre>
          <p>请求指纹：{{ batch.request.fingerprint }}</p>
        </details>
      </article>
      <p v-for="skip in model.micro?.tables.filter(t => t.skip) ?? []" :key="skip.tableId">
        {{ skip.tableId }}：{{ skip.skip }}
      </p>
    </section>
    <section>
      <h3>宏微观前后差异</h3>
      <p v-if="!model.changes.length">目前无已校验业务变化；这不代表尚未完成的演算成功。</p>
      <article v-for="change in model.changes" :key="`${change.tableId}/${change.rowId}`" class="card">
        <h4>{{ change.stage === 'macro' ? '宏观' : '微观' }} · {{ change.tableName }} / {{ change.rowId }}</h4>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>原来</th>
                <th>{{ model.outcome === 'saved' ? '已保存结果' : '私有暂存（未保存）' }}</th>
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
      <summary>续跑、恢复与费用边界</summary>
      <p v-for="notice in model.notices" :key="notice">{{ notice }}</p>
      <p>关闭/刷新丢失未保存暂存；重建模拟运行时只恢复同一已保存世界，不重新生成，不自动付费续跑。</p>
    </details>
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue';
import type { T9Round, T9View } from './t9-round';
const props: { controller: T9Round } = defineProps<{ controller: T9Round }>();
const controller: T9Round = props.controller;
const model = shallowRef<T9View>(controller.view()),
  localError = shallowRef<string | null>(null);
onUnmounted(
  controller.subscribe(() => {
    model.value = controller.view();
  }),
);
const busy = computed(() => ['macro', 'micro', 'validating', 'saving'].includes(model.value.status));
const cancellable = computed(() => busy.value || model.value.canResume);
const names = {
  idle: '尚未开始',
  macro: '等待前置 / 宏观演算',
  micro: '微观演算',
  validating: '整批校验',
  saving: '保存待确认',
  saved: '整轮已保存',
  'no-change': '无变化，成功标记已保存',
  paused: '已暂停，未保存',
  pending: '保存回执未知',
  failed: '整轮未通过',
  cancelled: '已取消',
  stale: '输入过期',
};
const batchNames = { pending: '待处理', sending: '模拟发送中', validating: 'SQL 校验中', staged: '已校验暂存' };
let sequence = 0;
async function start() {
  localError.value = null;
  try {
    const result = await controller.start(`t9-ui-${++sequence}`);
    if (result.duplicate) localError.value = '重复触发已忽略，没有再次发送或保存。';
  } catch {
    localError.value = '无法启动：请检查配置、前置或未保存草稿。';
  }
}
async function resume() {
  localError.value = null;
  try {
    await controller.resume();
  } catch {
    localError.value = '无法续跑；请检查暂存有效期、权限与剩余额度。';
  }
}
async function reconcile() {
  localError.value = null;
  try {
    await controller.reconcile();
  } catch {
    localError.value = '保存结果尚不可确认；没有重新生成。';
  }
}
</script>
<style scoped>
.we-t9-round {
  background: var(--we14-surface, #f1f8ef);
  color: var(--we14-text, #294f3c);
  padding: 16px;
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
.summary > div {
  flex: 1 1 170px;
}
.summary > div,
.notice,
.card {
  background: var(--we14-card, #fcfffa);
  border: 1px solid var(--we14-border, #b6ccba);
  border-radius: 9px;
  padding: 12px;
}
.card {
  margin: 10px 0;
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
.table-scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 8px;
  border-bottom: 1px solid var(--we14-border, #cad9cc);
}
pre {
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  background: var(--we14-soft, #e8f2e6);
  padding: 10px;
  border-radius: 8px;
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 3px;
}
summary {
  cursor: pointer;
}
@media (max-width: 600px) {
  .we-t9-round {
    padding: 10px;
  }
  .actions button {
    flex: 1 1 150px;
  }
}
</style>
