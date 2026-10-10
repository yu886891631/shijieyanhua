<template>
  <section class="we-t11" aria-label="世界演变日常工作台">
    <header v-if="!embedded" class="heading">
      <div>
        <h2>世界演变</h2>
        <p>先更新宏观条件，再让微观对象行动；整轮统一保存。</p>
      </div>
      <span class="badge">{{ model.source }}</span>
    </header>
    <nav v-if="!embedded" class="tabs" aria-label="日常页面">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :aria-current="model.page === tab.id ? 'page' : undefined"
        @click="controller.selectPage(tab.id)"
      >
        {{ tab.name }}
      </button>
    </nav>
    <p class="notice">本地开发版：假模型请求不联网、不收费。运行会保存模拟存档，不是只做预览；本页不写世界书。</p>
    <div class="actions">
      <button type="button" :disabled="model.busy" @click="controller.refresh()">
        检查准备情况 / 刷新记录（只读）
      </button>
      <button type="button" :disabled="!model.canReload" @click="controller.reloadFormal()">
        重新载入正式资料（不生成）
      </button>
    </div>
    <p v-if="model.error" class="danger-box" role="alert">{{ model.error }}</p>
    <p v-if="model.message" role="status">{{ model.message }}</p>

    <template v-if="model.page === 'overview'">
      <h3>已保存的世界</h3>
      <p v-if="!model.confirmed" class="danger-box">
        存档尚未确认。下面仅表示已载入的资料，不保证仍是当前有效世界；先做只读检查。
      </p>
      <dl class="stats">
        <div>
          <dt>世界 / 分支</dt>
          <dd>{{ model.worldId }} / {{ model.branchId }}</dd>
        </div>
        <div>
          <dt>表格模板</dt>
          <dd>{{ model.templateName }} · v{{ model.templateVersion }}</dd>
        </div>
        <div>
          <dt>正式数据版本</dt>
          <dd>{{ model.revision }}（提交 {{ model.seq }}）</dd>
        </div>
        <div>
          <dt>宏观 / 微观</dt>
          <dd>
            {{ model.macroTables }} / {{ model.microTables }} 张表；{{ model.macroRows }} /
            {{ model.microRows }} 条公开记录
          </dd>
        </div>
      </dl>
      <p v-if="!model.macroRows && !model.microRows" class="empty">
        表格还没有公开资料。请先到世界资料页填写；不会自动把演示 NPC 写入世界。
      </p>
      <h3>运行准备</h3>
      <ul class="checks">
        <li v-for="check in model.readiness" :key="check.id">
          <span :class="['badge', { warning: !check.ok }]">{{ check.ok ? '已检查' : '待处理' }}</span>
          <div>
            <strong>{{ check.label }}</strong>
            <p>{{ check.detail }}</p>
          </div>
        </li>
      </ul>
      <div class="actions">
        <button type="button" :disabled="!controller.hasNavigation" @click="controller.navigate('world')">
          填写世界资料
        </button>
        <button type="button" :disabled="!controller.hasNavigation" @click="controller.navigate('api')">
          配置 API
        </button>
        <button type="button" @click="controller.selectPage('automatic')">查看本轮准备 / 运行</button>
        <button type="button" @click="controller.selectPage('history')">查看错误与楼层记录</button>
      </div>
      <p v-if="!controller.hasNavigation" class="muted">
        此隔离组件未接外部页面导航；不会提供无效跳转。已有表格/API 页应由宿主统一挂载。
      </p>
      <h3>最近一轮</h3>
      <div :class="['card', { 'danger-box': !!model.run.error }]">
        <p>{{ model.run.label }} · {{ model.run.outcome }}</p>
        <p>已发送 {{ model.run.sent }} / {{ model.run.cap }} 次（两阶段、客户端重试与续跑共用额度）。</p>
        <p v-if="model.run.error">
          {{ model.run.phase }}{{ model.run.failureTable ? ` · ${model.run.failureTable}` : '' }}：{{ model.run.error }}
        </p>
      </div>
      <h3>最近已保存变化</h3>
      <p v-if="!model.history.length" class="empty">
        还没有已保存提交，或存档尚未通过检查。失败运行不出现在已保存版本中。
      </p>
      <article v-else class="card">
        <p>
          提交 {{ model.history[0].seq }} · {{ kindName(model.history[0].kind) }} · 版本 {{ model.history[0].revision }}
        </p>
        <p>
          公开差异：宏观 {{ model.history[0].macro }} 条，微观 {{ model.history[0].micro }} 条。{{
            model.history[0].truncated ? '仅展示前 100 条；完整存档未被截断。' : ''
          }}
        </p>
        <p v-if="!model.history[0].changes.length">无公开业务变化；这不表示运行失败，也不公开隐藏变化。</p>
      </article>
      <p class="notice">世界书：{{ projectionName(model.projection.status) }}。{{ model.projection.detail }}</p>
    </template>

    <template v-else-if="model.page === 'automatic'">
      <h3>自动与手动运行</h3>
      <label class="toggle"
        ><input
          type="checkbox"
          :checked="model.autoEnabled"
          :disabled="eventsAvailable === false"
          @change="setAutomatic"
        />
        自动接收当前剧情完成 / 前置结果变更事件（本实例，默认关闭）</label
      >
      <p v-if="eventsAvailable === false">
        此隔离候选没有接入酒馆剧情或前置完成事件，只支持手动本地模拟；自动触发不可开启。
      </p>
      <p v-else>
        开启不会立刻生成，也不会把历史重放成新剧情。关闭自动会停止正在等待/运行的自动任务，不会取消手动任务。
      </p>
      <div class="actions">
        <button type="button" :disabled="!model.canStart" @click="controller.start()">
          手动运行整轮并保存模拟存档
        </button>
        <button type="button" class="danger" :disabled="!model.canCancel" @click="controller.cancel()">取消本轮</button>
        <button type="button" :disabled="!model.canResume" @click="controller.resume()">同轮续跑 / 仅重试保存</button>
        <button type="button" :disabled="!model.canQuery" @click="controller.queryReceipt()">
          仅查询保存结果（零模型请求）
        </button>
      </div>
      <p v-if="!model.canStart" class="muted">
        开始前请检查准备情况，并处理运行、草稿或保存待确认项；不绕过缺项调用 AI。
      </p>
      <div class="card" aria-live="polite">
        <h4>{{ model.run.phase }}</h4>
        <p>{{ model.run.outcome }}</p>
        <p>
          宏观 {{ model.run.macroDone }} / {{ model.run.macroTotal }} 张；微观 {{ model.run.microDone }} /
          {{ model.run.microTotal }} 张。
        </p>
        <p>
          基准版本 {{ model.run.baseRevision ?? '尚未冻结' }} → 本轮保存版本
          {{ model.run.savedRevision ?? '尚未确认' }}；当前正式版本 {{ model.revision }}。
        </p>
        <p>
          已发送 {{ model.run.sent }} /
          {{ model.run.cap }} 次；两阶段、重试与续跑共用额度。宏观暂存成功不等于整轮已保存。
        </p>
        <p v-if="model.run.error" role="alert" class="danger-box">
          失败位置：{{ model.run.phase }} / {{ model.run.failureTable ?? '未定位到具体表，不猜测字段或语句' }}。{{
            model.run.error
          }}
        </p>
        <p v-if="model.run.failureCode" class="muted">
          <template v-if="model.run.failureField || model.run.failureStatement"
            >本地校验定位：{{ model.run.failureField ?? '未定位到字段' }}；{{
              model.run.failureStatement ? `第 ${model.run.failureStatement} 条语句` : '未定位到语句'
            }}。</template
          >
          错误分类：{{
            model.run.failureCode
          }}；SQL/业务错误不盲目整轮重试。微观网络中断只在同实例、同基准且未过期时可续跑。
        </p>
      </div>
      <details class="card">
        <summary>表级频率、候选与最终请求计划</summary>
        <p>
          频率以“合格剧情轮”计算，不是楼层号。失败、重试不推进成功标记；成功无变化也记成功。微观计划必须读取本轮最新宏观，不能提前当作最终计划。
        </p>
        <article v-for="table in model.tables" :key="table.id" class="table-card">
          <h4>{{ table.group === 'macro' ? '宏观' : '微观' }} · {{ table.name }}</h4>
          <p>
            {{ table.frequency }}；上次成功 {{ table.lastSuccess ?? '尚无' }}；下次到期
            {{ table.nextDue ?? '停用' }}。{{ table.due ? '本轮到期（不表示已执行）' : '本轮未到期或停用' }}
          </p>
          <p>路由：{{ table.route }}。{{ table.routeReady ? '配置就绪' : '未就绪 / 未检查' }}</p>
          <p v-if="table.pending" class="muted">微观候选待本轮宏观交接后冻结，不以旧宏观伪造最终结果。</p>
          <p v-if="table.skip">跳过 / 阻断：{{ table.skip }}</p>
          <p>
            上下文 {{ table.chars ?? '待确定' }} 字符；估算 {{ table.estimatedTokens ?? '待确定' }} token；此批最大
            {{ table.requestCap ?? '待确定' }} 次。token/费用估算不是硬性费用保证。
          </p>
          <ul v-if="table.candidates.length">
            <li v-for="candidate in table.candidates" :key="candidate.rowId">
              {{ candidate.rowId }}：{{ candidate.selected ? '入选' : '未入选' }} ·
              {{ candidate.reasons.join('、') || '仅提供可读条件'
              }}{{ candidate.skipped ? ` · ${candidate.skipped}` : '' }}
            </li>
          </ul>
          <p v-else class="muted">没有公开候选，或当前计划尚未确定；不会为了凑表而强制生成。</p>
        </article>
      </details>
      <p class="notice">
        预算、表频率、读写权限与 API 继承使用同一模板/运行配置；修改下轮配置请回结构参数与 API
        页。当前已冻结运行不临时换模型或扩大额度。
      </p>
      <div class="actions">
        <button type="button" :disabled="!controller.hasNavigation" @click="controller.navigate('world')">
          调整表级结构与预算
        </button>
        <button type="button" :disabled="!controller.hasNavigation" @click="controller.navigate('prompts')">
          调整填表提示词
        </button>
      </div>
    </template>

    <template v-else>
      <h3>运行记录（不等于已保存版本）</h3>
      <p v-if="!model.runs.length" class="empty">暂无本实例运行或已核对的持久运行记录；刷新不会自动继续请求。</p>
      <div v-else class="scroll" tabindex="0" aria-label="运行记录横向滚动区">
        <table>
          <thead>
            <tr>
              <th>运行 / 来源</th>
              <th>消息 / swipe</th>
              <th>阶段与结果</th>
              <th>已发送</th>
              <th>保存确认</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in model.runs" :key="run.runId">
              <td>{{ run.runId }}<br />{{ sourceName(run.source) }}</td>
              <td>{{ run.messageId || '刷新记录未存消息展示信息' }} / {{ run.swipeId || '见正式提交' }}</td>
              <td>
                {{ run.label }}
                <p v-if="run.error">{{ run.error }}</p>
              </td>
              <td>{{ run.sent }} / {{ run.cap }}</td>
              <td>
                {{
                  run.saved
                    ? run.effective === false
                      ? '原提交已确认，当前依赖失效'
                      : run.effective === null
                        ? '原提交已确认，当前有效性待核对'
                        : '已确认'
                    : '未确认，不计新版本'
                }}<br />{{ run.commitId }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>已保存提交链</h3>
      <p>
        只有网关确认的提交才能推进正式版本。查看历史、固定 SQL 和检查点不重新执行 SQL、不请求
        AI，也不取消其他页面的草稿。
      </p>
      <div class="actions"><button type="button" @click="selectHistory('genesis')">查看起始检查点（只读）</button></div>
      <p v-if="!model.history.length" class="empty">暂无已保存提交。起始检查点和无变化成功处理不是失败。</p>
      <div v-else class="scroll" tabindex="0" aria-label="提交链横向滚动区">
        <table>
          <thead>
            <tr>
              <th>提交 / 版本</th>
              <th>来源</th>
              <th>消息 / swipe</th>
              <th>宏观 / 微观公开差异</th>
              <th>查看</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in model.history" :key="entry.id">
              <td>{{ entry.seq }} / {{ entry.revision }}</td>
              <td>{{ kindName(entry.kind) }}</td>
              <td>{{ entry.messageId }} / {{ entry.swipeId }}</td>
              <td>{{ entry.macro }} / {{ entry.micro }}{{ entry.truncated ? '（展示截取）' : '' }}</td>
              <td>
                <button type="button" @click="selectHistory(entry.id)">查看提交 {{ entry.seq }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="model.invalidated.length" class="danger-box">
        <h4>失效尾部 / 待重算</h4>
        <p v-for="item in model.invalidated" :key="item.id">提交 {{ item.seq }}：{{ item.reason }}</p>
        <p>当前只采用有效祖先；没有把失效结果重新应用或自动续发 AI。</p>
      </div>
      <article v-if="model.selected" class="card">
        <h4>提交 {{ model.selected.seq }} 的详细记录</h4>
        <p>
          {{ model.selected.id }}；父提交 {{ model.selected.parent ?? '起始快照' }}；恢复来源
          {{ model.selected.source ?? '非恢复提交 / 起始快照' }}。
        </p>
        <p>
          模板 {{ model.selected.templateName }} · v{{ model.selected.templateVersion }}；世界时间
          {{
            model.selected.worldTime
              ? `${model.selected.worldTime.calendarId} / ${model.selected.worldTime.ordinalMinute} 分钟`
              : '未记录，不编造现实时间'
          }}。
        </p>
        <p>
          本轮发送 {{ model.selected.sent ?? '旧/人工记录未存发送计数' }}；检查点覆盖至提交
          {{ model.selected.checkpoint.throughSeq }}。
        </p>
        <details>
          <summary>宏观 / 微观公开差异</summary>
          <div v-for="change in model.selected.changes" :key="`${change.tableId}/${change.rowId}`" class="table-card">
            <h5>{{ change.groupName }} · {{ change.tableName }} · {{ change.operation }}</h5>
            <p>{{ change.rowId }}</p>
            <p v-for="field in change.fields" :key="field.fieldId">
              {{ field.name }}：{{ field.before }} → {{ field.after }}
            </p>
          </div>
          <p v-if="!model.selected.changes.length">无公开业务差异。未公开字段不在这里显示。</p>
        </details>
        <details>
          <summary>固定 SQL / 参数（只读，不执行）</summary>
          <div v-for="(batch, index) in model.selected.sql" :key="index" class="table-card">
            <h5>批次 {{ index + 1 }} · {{ batch.batchId }}</h5>
            <p v-if="batch.reason">{{ batch.reason }}</p>
            <template v-else>
              <pre>{{ batch.sql }}</pre>
              <pre>{{ JSON.stringify(batch.parameters, null, 2) }}</pre>
            </template>
          </div>
          <p v-if="!model.selected.sql.length">该提交没有 SQL；恢复/结构迁移使用经过校验的完整快照。</p>
        </details>
        <details>
          <summary>完整性指纹 / 检查点覆盖</summary>
          <p>{{ model.selected.checkpoint.fingerprint }}</p>
          <p>{{ model.selected.checkpoint.throughCommitId }}</p>
          <p>指纹用于损坏检测，不是数字签名，也不证明宿主原子写入。</p>
        </details>
      </article>
      <details v-if="model.checkpoint" class="card">
        <summary>所选历史检查点的公开资料（只读）</summary>
        <div v-for="row in model.checkpoint.changes" :key="`${row.tableId}/${row.rowId}`" class="table-card">
          <h4>{{ row.tableName }} · {{ row.rowId }}</h4>
          <p v-for="field in row.fields" :key="field.fieldId">{{ field.name }}：{{ field.after }}</p>
        </div>
        <p v-if="!model.checkpoint.changes.length">这个检查点没有公开资料。</p>
        <p v-if="model.checkpoint.summary.truncated">只展示前 100 条；存档没有被截断。</p>
      </details>
      <article v-if="model.impact" class="card">
        <h4>所选点之后的范围</h4>
        <p>
          本分支后续 {{ model.impact.commits }} 次提交；涉及消息 {{ model.impact.messageIds.join('、') || '暂无' }}。
        </p>
        <p>{{ model.impact.detail }}</p>
        <button type="button" :disabled="model.canCancel || model.canQuery || model.busy" @click="previewRestore">
          预览恢复到所选检查点
        </button>
      </article>
      <article v-if="model.restore" class="danger-box">
        <h4>恢复确认（会写入新版本，不删除历史）</h4>
        <p>目标：{{ model.restore.sourceId ?? '起始检查点' }}。{{ model.restore.reason }}</p>
        <p>恢复整个检查点，包含未公开字段、结构和频率进度；下面只显示公开差异。不会调用 AI，不自动同步世界书。</p>
        <div v-for="change in model.restore.preview.changes" :key="`${change.tableId}/${change.rowId}`">
          <h5>{{ change.tableName }} · {{ change.rowId }} · {{ change.operation }}</h5>
          <p v-for="field in change.fields" :key="field.fieldId">
            {{ field.name }}：{{ field.before }} → {{ field.after }}
          </p>
        </div>
        <label class="toggle"
          ><input v-model="consent" type="checkbox" />我确认恢复整个检查点，并追加新提交；原历史保留。</label
        >
        <div class="actions">
          <button
            type="button"
            class="danger"
            :disabled="!consent || !model.restore.canConfirm"
            @click="controller.confirmRestore(consent)"
          >
            确认恢复 / 重试同一保存
          </button>
          <button type="button" :disabled="model.canQuery" @click="controller.cancelRestore()">取消恢复草稿</button>
          <button type="button" :disabled="!model.canQuery" @click="controller.queryReceipt()">
            仅核对恢复保存结果
          </button>
        </div>
      </article>
      <p class="muted">
        恢复当前存档只需“重新载入正式资料”；恢复所选历史会追加新版本；重算需要新的剧情身份并可能收费；复制/分支需要独立目标身份。不能混成一个“恢复”按钮。
      </p>
    </template>
    <details class="card">
      <summary>范围、草稿与恢复说明</summary>
      <p v-for="notice in model.notices" :key="notice">{{ notice }}</p>
    </details>
  </section>
</template>

<script setup lang="ts">
import { onUnmounted, ref, shallowRef } from 'vue';
import type { T11Controller, T11Page, T11View } from './t11-controller';
const props = withDefaults(
  defineProps<{ controller: T11Controller; embedded?: boolean; eventsAvailable?: boolean }>(),
  {
    eventsAvailable: true,
  },
);
const controller = props.controller,
  model = shallowRef(controller.view()),
  consent = ref(false);
const unsubscribe = controller.subscribe(() => {
  model.value = controller.view();
});
onUnmounted(unsubscribe); // Closing a tab does not own or cancel the shared world runtime.
const tabs: { id: T11Page; name: string }[] = [
  { id: 'overview', name: '总览' },
  { id: 'automatic', name: '自动演变' },
  { id: 'history', name: '楼层记录' },
];
const kindName = (kind: 'manual' | 'model' | 'migration' | 'restore') =>
  ({ manual: '人工编辑', model: '整轮演变', migration: '结构迁移', restore: '历史恢复' })[kind];
const sourceName = (source: 'manual' | 'automatic' | 'recovered') =>
  ({ manual: '手动入口', automatic: '自动入口', recovered: '恢复记录' })[source];
const projectionName = (status: T11View['projection']['status']) =>
  ({ unavailable: '未接入', pending: '待同步', synced: '投影服务已确认', failed: '同步失败' })[status];
function setAutomatic(event: Event) {
  if (props.eventsAvailable === false) return;
  controller.setAutomatic((event.target as HTMLInputElement).checked);
}
function selectHistory(id: string) {
  consent.value = false;
  controller.selectHistory(id);
}
function previewRestore() {
  consent.value = false;
  controller.previewRestore();
}
</script>

<style scoped>
.we-t11 {
  --surface: var(--we14-surface, #f1f8ef);
  --card: var(--we14-card, #fbfdfa);
  --border: var(--we14-border, #b8ceba);
  --text: var(--we14-text, #294734);
  --muted: var(--we14-muted, #516752);
  --accent: var(--we14-accent, #315e40);
  --danger-bg: var(--we14-danger-bg, #fff0f3);
  --danger-text: var(--we14-danger-text, #853c52);
  --danger-border: var(--we14-danger-border, #d9a6b6);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: clamp(12px, 2.5%, 24px);
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.heading > div {
  min-width: 0;
  flex: 1 1 280px;
}
h2,
h3,
h4,
h5 {
  color: var(--text);
  margin: 0.8em 0 0.5em;
}
p {
  line-height: 1.65;
  margin: 0.6em 0;
}
.tabs,
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
button {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--accent);
  background: var(--card);
  padding: 9px 12px;
  white-space: normal;
  overflow-wrap: anywhere;
  font: inherit;
  cursor: pointer;
  min-height: 40px;
  max-width: 100%;
}
button[aria-current='page'] {
  color: var(--we14-on-accent, #fafffa);
  background: var(--accent);
  border-color: var(--accent);
}
button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible,
.scroll:focus-visible {
  outline: 3px solid var(--we14-focus, #528266);
  outline-offset: 3px;
}
.badge {
  display: inline-block;
  border-radius: 8px;
  border: 1px solid var(--border);
  padding: 5px 8px;
  background: var(--we14-soft, #e0eedf);
  font-size: 0.9em;
}
.warning {
  color: var(--we14-warning-text, #72501f);
  border-color: var(--we14-warning-border, #ccb981);
  background: var(--we14-warning-bg, #faf3df);
}
.notice,
.card,
.empty {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  padding: 12px;
  margin: 12px 0;
  min-width: 0;
}
.notice {
  background: var(--we14-success-bg, #e7f1e3);
}
.muted,
dt,
.empty {
  color: var(--muted);
}
.danger,
.danger-box {
  color: var(--danger-text);
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
}
.danger-box {
  padding: 12px;
  margin: 12px 0;
  border-radius: 10px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.stats > div {
  border: 1px solid var(--border);
  background: var(--card);
  padding: 12px;
  border-radius: 10px;
  min-width: 0;
}
dd {
  margin: 6px 0 0;
  font-weight: 600;
}
.checks {
  list-style: none;
  padding: 0;
}
.checks li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
}
.checks li > div {
  min-width: 0;
}
.checks p {
  margin: 3px 0;
}
.toggle {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  line-height: 1.6;
}
input[type='checkbox'] {
  appearance: auto;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-top: 4px;
  accent-color: var(--accent);
}
.table-card {
  border-top: 1px solid var(--border);
  padding: 12px 0;
  min-width: 0;
}
summary {
  cursor: pointer;
  font-weight: 600;
  padding: 5px 0;
}
.scroll {
  overflow: auto;
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95em;
  background: var(--card);
}
th,
td {
  text-align: left;
  vertical-align: top;
  padding: 10px;
  border-bottom: 1px solid var(--border);
  min-width: 110px;
}
th {
  background: var(--we14-soft, #e4eee1);
  color: var(--accent);
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--we14-soft, #eaf2e7);
  color: var(--text);
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 0;
  max-height: 320px;
  overflow: auto;
}
@media (max-width: 850px) {
  .heading {
    display: block;
  }
  .stats {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .actions button {
    flex: 1 1 100%;
  }
  .tabs button {
    flex: 1 1 90px;
  }
  .checks li {
    gap: 8px;
  }
}
</style>
