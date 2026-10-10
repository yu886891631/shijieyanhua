<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import type { T13Controller, T13Path } from './t13-controller';
import type { T13Kind } from './t13-backup';
const props = defineProps<{ controller: T13Controller }>();
const emit = defineEmits<{ export: [text: string, filename: string] }>();
const view = ref(props.controller.view()),
  source = ref(''),
  path = ref<Exclude<T13Path, 'clear'>>('legacy');
const replace = ref(false),
  unresolved = ref(false),
  includePrivate = ref(false),
  kind = ref<Exclude<T13Kind, 'legacy'>>('world');
const unsubscribe = props.controller.subscribe(() => {
  view.value = props.controller.view();
});
onUnmounted(unsubscribe);
watch([source, replace, unresolved], () => props.controller.cancel());
const paths: { id: Exclude<T13Path, 'clear'>; name: string; detail: string }[] = [
  { id: 'legacy', name: '迁移旧版资料', detail: 'alpha.11 七张表 / A0.0.5 实体 JSON；保留旧来源，建立独立迁移起点。' },
  { id: 'restore', name: '恢复指定世界', detail: '只接受同一聊天、世界和分支的新版备份；追加恢复版本，不替换旧账本。' },
  { id: 'copy', name: '导入独立世界', detail: '目标必须已具有不同世界身份；旧来源历史只作为不可变审计材料。' },
  { id: 'template', name: '导入模板', detail: '只改结构与参数；已有资料须通过 T6 原子迁移预检，不自动填种子数据。' },
  { id: 'audit', name: '检查历史审计', detail: '只验证封存历史，不执行 SQL、不保存资料、不调用 AI。' },
];
function choose(id: Exclude<T13Path, 'clear'>) {
  if (view.value.busy || view.value.pending) return;
  props.controller.cancel();
  path.value = id;
  replace.value = false;
  unresolved.value = false;
}
async function backup() {
  const file = await props.controller.backup(kind.value, includePrivate.value);
  if (file) emit('export', JSON.stringify(file, null, 2), `世界演变-${kind.value}-备份.json`);
}
async function rawBackup() {
  const file = await props.controller.exportLegacyOriginal(source.value, includePrivate.value);
  if (file) emit('export', JSON.stringify(file, null, 2), '世界演变-旧版原始材料-凭据脱敏.json');
}
</script>

<template>
  <section class="we-t13" aria-label="备份与迁移工作台">
    <header>
      <h2>备份与迁移</h2>
      <p>先保留退路，再预览和确认。打开本页不读取旧库、不写聊天、不调用 API，也不更新世界书。</p>
    </header>
    <aside class="scope">
      <strong>当前目标：{{ view.scope.worldId }} / {{ view.scope.branchId }}</strong>
      <p>聊天：{{ view.scope.chatId }} · 本地组件验收不代表真实宿主持久写入已通过。</p>
    </aside>
    <div class="columns">
      <section class="card">
        <h3>1. 先备份当前世界</h3>
        <label
          >备份内容<select v-model="kind" :disabled="view.busy || view.pending">
            <option value="world">完整世界（资料、模板、账本和迁移材料）</option>
            <option value="data">当前资料快照（含进度，不含活跃队列）</option>
            <option value="template">模板与结构参数</option>
            <option value="history">历史审计（只读）</option>
          </select></label
        >
        <label class="check"
          ><input
            v-model="includePrivate"
            type="checkbox"
            :disabled="!view.privateAllowed || view.busy"
          />我理解完整备份含非公开历史；已授权在本地导出，不包含 API 密钥。</label
        >
        <button :disabled="view.busy || view.pending || !includePrivate || !view.privateAllowed" @click="backup">
          生成并导出所选备份
        </button>
        <p>生成备份不等于已经另存。由外层页面提供下载；未保存到外部的内存备份会随关闭丢失。</p>
        <label class="check"
          ><input
            type="checkbox"
            :checked="view.hasBackup"
            :disabled="!view.backupReady || view.busy || view.pending"
            @change="controller.acknowledgeBackup(($event.target as HTMLInputElement).checked)"
          />我已把当前版本的完整世界备份另存到外部。</label
        >
        <p v-if="view.hasBackup" class="success">当前版本已有确认的外部备份。</p>
      </section>
      <section class="card">
        <h3>2. 选择要做的事</h3>
        <nav aria-label="导入向导类型">
          <button
            v-for="item in paths"
            :key="item.id"
            :aria-pressed="path === item.id"
            :disabled="view.busy || view.pending"
            @click="choose(item.id)"
          >
            {{ item.name }}
          </button>
        </nav>
        <p>{{ paths.find(p => p.id === path)?.detail }}</p>
        <p>导入只处理明确选中的文件；不会自动接管旧库或采用源文件的活跃聊天身份。</p>
      </section>
    </div>
    <section class="card">
      <h3>3. 读取来源（不保存）</h3>
      <label
        >粘贴 JSON 文件内容<textarea
          v-model="source"
          rows="7"
          spellcheck="false"
          :disabled="view.busy || view.pending"
          aria-label="导入文件内容"
        />
      </label>
      <div class="actions">
        <button
          :disabled="view.busy || view.pending || !source"
          @click="controller.previewText(source, path, replace, unresolved)"
        >
          校验并预览所选文件
        </button>
        <button
          v-if="path === 'legacy'"
          :disabled="view.busy || view.pending || !view.sourceAvailable"
          @click="controller.readOldSource()"
        >
          只读检查已选旧库
        </button>
        <button
          v-if="path === 'legacy'"
          :disabled="view.busy || view.pending || !source || !includePrivate || !view.privateAllowed"
          @click="rawBackup"
        >
          另存旧版原始材料（剔除凭据）
        </button>
      </div>
      <label class="check"
        ><input
          v-model="unresolved"
          type="checkbox"
          :disabled="path !== 'legacy' || view.busy || view.pending"
        />若关联不能唯一确认，只保留原文；不生成假引用。</label
      >
      <label class="check danger"
        ><input
          v-model="replace"
          type="checkbox"
          :disabled="view.busy || view.pending"
        />允许替换目标已有公开、可手动修改的资料；不绕过锁定或隐藏权限，原版本仍保留。</label
      >
    </section>
    <section v-if="view.report" class="card" aria-label="迁移预览">
      <h3>4. 预览、冲突与限制</h3>
      <p>
        类型：{{ view.report.sourceKind }} · 状态：{{
          view.report.status === 'saved'
            ? '已保存确认'
            : view.report.status === 'already-imported'
              ? '已处理过，不重复导入'
              : view.report.status === 'audit'
                ? '只读审计通过'
                : '私有预览，尚未保存'
        }}
      </p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>表</th>
              <th>可查看记录数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="table in view.report.rows" :key="table.tableId">
              <td>{{ table.name }}</td>
              <td>{{ table.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <details v-if="view.report.mapping.length">
        <summary>查看稳定 ID 映射（{{ view.report.mapping.length }} 条）</summary>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>表</th>
                <th>旧 ID</th>
                <th>新稳定 ID</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in view.report.mapping" :key="m.tableId + '/' + m.sourceId">
                <td>{{ m.tableId }}</td>
                <td>{{ m.sourceId }}</td>
                <td>{{ m.rowId }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <ul>
        <li v-for="line in view.report.limitations" :key="line">{{ line }}</li>
      </ul>
      <ul v-if="view.report.issues.length" class="danger">
        <li v-for="issue in view.report.issues" :key="issue">{{ issue }}</li>
      </ul>
      <p v-if="view.report.redactions">已脱敏 {{ view.report.redactions }} 处凭据；非凭据原始字段及历史仍保留。</p>
      <label v-if="view.report.valid && view.report.status === 'preview'" class="check danger"
        ><input
          type="checkbox"
          :checked="view.consent"
          :disabled="view.busy || view.pending"
          @change="controller.consent(($event.target as HTMLInputElement).checked)"
        />我已核对来源、目标、字段映射和限制；只保存到当前世界，不写世界书或旧库。</label
      >
      <div class="actions">
        <button :disabled="!view.canSave" @click="controller.save()">确认并保存当前目标世界</button
        ><button :disabled="view.busy || !view.pending" @click="controller.query()">仅查询未知保存结果</button
        ><button :disabled="view.busy || view.pending" @click="controller.cancel()">取消私有草稿</button>
      </div>
    </section>
    <section class="danger card">
      <h3>单独操作：清空当前世界</h3>
      <p>
        先导出并另存完整备份。只追加当前分支的空数据版本，保留模板与历史；不清剧情、旧库、MVU
        或数据库插件。旧世界书投影需要另行检查和清理。
      </p>
      <button :disabled="view.busy || view.pending || !view.hasBackup" @click="controller.previewClear()">
        只预览清空范围
      </button>
    </section>
    <p v-if="view.message" role="status" class="scope">{{ view.message }}</p>
    <p v-if="view.error" role="alert" class="danger">{{ view.error }}</p>
    <footer>
      回退：先保留新世界备份，停止新旧插件同时写入。新格式不能直接由旧插件读取；旧原件保留但不会自动复活为当前权威。
    </footer>
  </section>
</template>

<style scoped>
.we-t13 {
  color: var(--we14-text, #294337);
  display: grid;
  gap: 16px;
  min-width: 0;
  line-height: 1.55;
  overflow-wrap: anywhere;
  font-size: 14px;
}
.we-t13 h2,
.we-t13 h3,
.we-t13 p {
  margin: 0 0 10px;
}
.columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  min-width: 0;
}
.card {
  padding: 18px;
  border: 1px solid var(--we14-border, #c9dcc9);
  border-radius: 16px;
  background: var(--we14-card, #fbfdf7);
  min-width: 0;
}
.scope {
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--we14-surface, #f1f8ef);
  border: 1px solid var(--we14-border, #cfdfc9);
}
.danger {
  padding: 12px;
  border-radius: 12px;
  background: var(--we14-danger-bg, #fff0f3);
  border: 1px solid var(--we14-danger-border, #edbec9);
  color: var(--we14-danger-text, #8d344c);
}
label {
  display: grid;
  gap: 7px;
  margin: 10px 0;
  min-width: 0;
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}
.check input {
  flex: none;
  margin-top: 5px;
}
.actions,
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin: 12px 0;
}
button,
select,
textarea {
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  max-width: 100%;
  border: 1px solid var(--we14-border, #a9c7aa);
  border-radius: 9px;
  background: var(--we14-control, #f5faf1);
  padding: 9px 12px;
}
button {
  cursor: pointer;
}
button[aria-pressed='true'] {
  background: var(--we14-soft, #dcedd8);
  border-color: var(--we14-accent, #6f9770);
}
button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
textarea,
select {
  width: 100%;
  min-width: 0;
  background: var(--we14-control, #fffef8);
}
textarea {
  resize: vertical;
}
.scroll {
  overflow: auto;
  max-height: 340px;
  max-width: 100%;
  min-width: 0;
}
table {
  border-collapse: collapse;
  width: 100%;
}
td,
th {
  text-align: left;
  padding: 9px;
  border-bottom: 1px solid var(--we14-border, #dce7d8);
}
summary {
  cursor: pointer;
  margin: 12px 0;
}
.success {
  color: var(--we14-success-text, #326640);
}
footer {
  color: var(--we14-muted, #566b5d);
  font-size: 13px;
}
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--we14-focus, #417d51);
  outline-offset: 3px;
}
@media (max-width: 850px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .card {
    padding: 12px;
  }
  .actions button,
  nav button {
    flex: 1 1 100%;
  }
  .we-t13 {
    gap: 12px;
  }
}
</style>
