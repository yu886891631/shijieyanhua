<template>
  <section class="t12-workbench" aria-label="世界书投影工作台">
    <header>
      <div>
        <h2>世界书投影</h2>
        <p>把已保存、允许主 AI 读取的世界资料送到当前角色卡主世界书。</p>
      </div>
      <span class="badge" :class="{ ready: model.status === 'synced' }">{{ statusName(model.status) }}</span>
    </header>
    <div class="cards">
      <article class="card">
        <h3>目标与源版本</h3>
        <dl>
          <dt>角色卡主世界书</dt>
          <dd>{{ model.target || '尚未确认或没有绑定' }}</dd>
          <dt>当前世界 / 分支</dt>
          <dd>{{ model.worldId }} / {{ model.branchId }}</dd>
          <dt>已保存数据版本</dt>
          <dd>{{ model.revision ?? '尚未检查' }}</dd>
          <dt>运行环境</dt>
          <dd>{{ model.source }}</dd>
        </dl>
        <p>不改附加书、聊天书或全局绑定；不自动新建世界书。</p>
      </article>
      <article class="card">
        <h3>隔离与读取</h3>
        <p>{{ model.isolation }}</p>
        <p>资料保存成功不等于世界书已同步。同步失败不丢世界，不重新调用演变 API。</p>
        <details>
          <summary>能力证据与高级版本</summary>
          <p v-for="e in model.evidence" :key="e">{{ e }}</p>
          <dl>
            <dt>源提交</dt>
            <dd>{{ model.commitId || '已确认初始化快照 / 尚未检查' }}</dd>
            <dt>投影代际指纹</dt>
            <dd>{{ model.generationId || '尚未生成' }}</dd>
          </dl>
        </details>
      </article>
    </div>
    <p v-if="model.error" class="danger" role="alert">{{ model.error }}</p>
    <p v-if="model.message" class="notice" role="status">{{ model.message }}</p>
    <div class="actions">
      <button :disabled="model.busy" @click="controller.inspect()">
        {{ model.busy ? '处理中…' : '检查与预览（不写入）' }}
      </button>
      <button :disabled="!model.canQuery" @click="controller.query()">仅查询同步结果</button>
      <button :disabled="!model.canConfigure" @click="controller.configure()">去表级导出参数</button>
    </div>
    <p class="notice">
      导出规则与世界资料页共用当前已保存模板。逐行条目按关键词触发；索引只列允许的标题；整表常驻包含所选公开字段。界面隐藏不等于主
      AI 保密，请使用主 AI 可见性。
    </p>
    <article class="card">
      <h3>表级导出规则（只读）</h3>
      <p v-if="!model.tables.length">先检查，或先在世界资料中建立并保存表格。</p>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>表</th>
              <th>导出</th>
              <th>方式</th>
              <th>当前用户可预览字段</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in model.tables" :key="i">
              <td>{{ t.name }}</td>
              <td>{{ t.enabled ? '启用' : '关闭 / 不可导出' }}</td>
              <td>{{ modeName(t.mode) }}</td>
              <td>{{ t.fields.join('、') || '无可预览字段' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="card">
      <h3>最终内容预览</h3>
      <p>只显示同时允许当前用户查看的内容；主 AI 可见性不会反向授予用户权限。受限制的内容不从旧条目读回来。</p>
      <p v-if="!model.preview.length">没有可预览的条目。空表或关闭导出不会创建占位条目。</p>
      <details v-for="entry in model.preview" :key="entry.key" class="entry">
        <summary>{{ entry.name }}</summary>
        <p>{{ entry.constant ? '常驻（蓝灯）' : '关键词触发（绿灯）' }}</p>
        <p>关键词：{{ entry.keys.join('、') || '不需要关键词 / 无可预览关键词' }}</p>
        <pre>{{ entry.content }}</pre>
      </details>
    </article>
    <article class="card">
      <h3>实时条目差异</h3>
      <p>
        新增 {{ model.counts.create }} · 更新 {{ model.counts.update }} · 删除 {{ model.counts.delete }} ·
        停用其他世界托管条目 {{ model.counts.deactivate }} · 不变 {{ model.counts.keep }}
      </p>
      <p v-if="!model.diff.length">尚无差异结果。这里的检查是实时读回，不把缓存账本当作同步成功。</p>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>操作</th>
              <th>条目</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(d, i) in model.diff" :key="i">
              <td>{{ actionName(d.kind) }}</td>
              <td>
                {{ d.name }}<small v-if="d.uid !== null">UID {{ d.uid }}</small>
              </td>
              <td>{{ d.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    <article class="danger">
      <h3>同步与修复范围</h3>
      <p>
        仅处理经过确认的本插件托管条目：精确更新当前世界、清理当前世界孤儿/重复条目，停用同书其他世界的本插件条目。用户、TavernDB、MVU、旧版归属不明条目保留。重建只重新计算该范围，不清空整本书。
      </p>
      <label><input v-model="confirmed" type="checkbox" :disabled="model.busy" />我已查看差异，确认上述受控范围</label>
      <div class="actions">
        <button :disabled="!model.canSync || !confirmed" @click="apply('sync')">同步当前已保存版本</button
        ><button :disabled="!model.canRetry || !confirmed" @click="retry">仅重试投影</button
        ><button :disabled="!model.canSync || !confirmed" @click="apply('repair')">修复漂移与孤儿</button
        ><button :disabled="!model.canSync || !confirmed" @click="apply('rebuild')">重算全部托管投影</button>
      </div>
      <p v-if="!model.canSync">尚未检查、源版本过期或缺少安全能力时，保持预览；不会尝试真实写入。</p>
    </article>
  </section>
</template>
<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import type { T12Controller, T12Status } from './t12-controller';
import type { T12Diff } from './t12-gateway';
const props = defineProps<{ controller: T12Controller }>();
const model = ref(props.controller.view()),
  confirmed = ref(false);
const unsubscribe = props.controller.subscribe(() => {
  const next = props.controller.view();
  if (next.busy || next.generationId !== model.value.generationId || next.status === 'stale') confirmed.value = false;
  model.value = next;
});
onUnmounted(unsubscribe); // Closing this page does not cancel a shared service.
const labels: Record<T12Status, string> = {
  unchecked: '尚未检查',
  pending: '世界已保存，投影待同步',
  synced: '完整代际已确认',
  failed: '同步 / 读取失败',
  blocked: '安全条件未满足',
  stale: '旧任务已过期',
};
const statusName = (value: T12Status) => labels[value];
const modeNames: Record<string, string> = { 'per-row': '逐行触发', index: '常驻标题索引', constant: '整表常驻' };
const modeName = (v: string) => modeNames[v] ?? v;
const actionName = (v: T12Diff['kind']) =>
  ({ create: '新增', update: '更新', delete: '删除', deactivate: '停用', keep: '不变' })[v];
async function apply(operation: 'sync' | 'repair' | 'rebuild') {
  await props.controller.sync(confirmed.value, operation);
  confirmed.value = false;
}
async function retry() {
  await props.controller.retry(confirmed.value);
  confirmed.value = false;
}
</script>
<style scoped>
.t12-workbench {
  color: var(--we14-text, #284433);
  display: grid;
  gap: 16px;
  min-width: 0;
}
header,
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
header {
  justify-content: space-between;
}
h2,
h3,
p {
  margin: 0 0 10px;
}
p,
dd,
summary,
td {
  overflow-wrap: anywhere;
}
.cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.card,
.danger {
  padding: 16px;
  border: 1px solid var(--we14-border, #cadbcb);
  border-radius: 14px;
  min-width: 0;
  background: var(--we14-surface, #f1f8ef);
}
.danger {
  background: var(--we14-danger-bg, #fff0f3);
  border-color: var(--we14-danger-border, #e4b9c4);
  color: var(--we14-danger-text, #743044);
}
.notice,
.badge {
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--we14-soft, #edf4ec);
  border: 1px solid var(--we14-border, #cadbcb);
}
.ready {
  background: var(--we14-soft, #dfeeda);
  color: var(--we14-accent, #275131);
}
dl {
  display: grid;
  grid-template-columns: minmax(0, 130px) minmax(0, 1fr);
  gap: 8px;
}
dt {
  color: var(--we14-muted, #516555);
}
dd {
  margin: 0;
}
.table-scroll {
  overflow: auto;
  max-width: 100%;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 14px;
}
th,
td {
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid var(--we14-border, #cadbcb);
  vertical-align: top;
}
small {
  display: block;
  color: var(--we14-muted, #516555);
}
button {
  color: inherit;
  background: var(--we14-card, #f7fbf5);
  border: 1px solid var(--we14-border, #b9d1b9);
  border-radius: 9px;
  padding: 9px 12px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 3px solid var(--we14-focus, #679978);
  outline-offset: 3px;
}
.danger button {
  background: var(--we14-danger-bg, #fff6f8);
  border-color: var(--we14-danger-border, #dca7b5);
}
.entry {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid var(--we14-border, #cadbcb);
  border-radius: 10px;
}
summary {
  cursor: pointer;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0;
}
@media (max-width: 850px) {
  .cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  dl {
    grid-template-columns: minmax(0, 1fr);
  }
  .actions button {
    width: 100%;
  }
  .card,
  .danger {
    padding: 12px;
  }
}
</style>
