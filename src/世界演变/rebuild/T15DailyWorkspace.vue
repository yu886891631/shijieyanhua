<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import T14Workspace from './T14Workspace.vue';
import T15HostWorkspace from './T15HostWorkspace.vue';
import T15ReadOnlyTables from './T15ReadOnlyTables.vue';
import ApiSettingsPanel from '../console/ApiSettingsPanel.vue';
import { createT15NativeDailyRuntime } from './t15-daily-native';
import { T15_DAILY_VERSION } from './t15-daily-runtime';
import { loadWorldEvolutionApiConfiguration, saveWorldEvolutionApiConfiguration } from '../api-config';
import { createDefaultT2Template } from './t2-defaults';
import { resolveT2TableSettings } from './t2-template';
import { T14_DEFAULT, type T14Appearance } from './t14-appearance';
import type { T1PageId } from './t1-ui-contract';
import type { T4Executor } from './t4-service';
const props = defineProps<{ execute: T4Executor }>();
const emit = defineEmits<{ close: [] }>();
const page = ref<T1PageId>('overview'),
  appearance = ref<T14Appearance>({ ...T14_DEFAULT });
const runtime = createT15NativeDailyRuntime(props.execute, destination => {
    page.value = destination === 'world' ? 'data' : 'api';
  }),
  view = shallowRef(runtime.view());
const confirmEdit = ref(false),
  actionError = ref(''),
  sessionSerial = ref(0),
  cancelButton = ref<HTMLButtonElement>();
let last: unknown = null;
const off = runtime.subscribe(() => {
  view.value = runtime.view();
  if (view.value.session !== last) {
    last = view.value.session;
    sessionSerial.value++;
    view.value.session?.setAppearance({ ...appearance.value });
  }
});
const apiPort = {
  read: loadWorldEvolutionApiConfiguration,
  save: saveWorldEvolutionApiConfiguration,
};
const template = computed(() => view.value.info?.recovery.state?.template ?? createDefaultT2Template());
const reason = computed(
  () =>
    ({
      empty: '尚未创建',
      ready: '已载入',
      'restored-ancestor': '历史有变化，已读取有效资料',
      damaged: '存档需检查',
      'identity-mismatch': '存档归属不匹配',
      'read-failed': '读取失败',
    })[view.value.info?.recovery.status ?? 'read-failed'],
);
async function edit() {
  actionError.value = '';
  try {
    await runtime.edit(true);
    confirmEdit.value = false;
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '操作未完成';
  }
}
async function automatic(value: boolean) {
  actionError.value = '';
  try {
    runtime.arm(value);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '无法启用';
  }
}
async function selectDatabase(value: string) {
  actionError.value = '';
  try {
    await runtime.selectDatabaseKey(value);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '无法选择';
  }
}
watch(confirmEdit, async value => {
  if (value) {
    await nextTick();
    cancelButton.value?.focus();
  }
});
onMounted(() => {
  void runtime.refresh();
});
onBeforeUnmount(() => {
  off();
  runtime.close();
});
</script>
<template>
  <div class="daily-root">
    <T15HostWorkspace
      v-if="view.session"
      :key="sessionSerial"
      :inert="confirmEdit || undefined"
      :session="view.session"
      :version="T15_DAILY_VERSION"
      :initial-page="page"
      daily-entry
      @page="page = $event"
      @appearance="appearance = $event"
      @api-dirty="runtime.setDirty"
      @close="emit('close')"
    >
      <template #entry-status>
        <section class="daily-card">
          <h3>当前聊天</h3>
          <p>{{ view.info?.character }} · {{ view.info?.binding.hostChatId }}</p>
          <p>{{ view.notice }}</p>
          <p v-if="view.info?.databaseRequired && !view.info.databaseProtocol" class="warning">
            数据库完成接口尚未接入：可以查看、编辑资料；演变运行暂不可用。
          </p>
          <button :disabled="view.busy || view.dirty" @click="runtime.refresh()">刷新当前资料</button>
          <label
            ><input
              :checked="view.armed"
              type="checkbox"
              :disabled="!view.armed && (view.busy || view.dirty || view.stale)"
              @change="automatic(($event.target as HTMLInputElement).checked)"
            />开启后续自动演变（使用已配置 API，可能收费；开启本身不发请求）</label
          >
          <p v-if="actionError" role="alert">{{ actionError }}</p>
        </section>
      </template>
      <template #evolution-controls
        ><section class="daily-card">
          <h3>自动演变开关</h3>
          <label v-if="view.info && view.info.databaseKeys.length > 1"
            >当前聊天的数据库表组<select
              :value="view.databaseKey"
              :disabled="view.busy || view.dirty"
              @change="selectDatabase(($event.target as HTMLSelectElement).value)"
            >
              <option value="">请选择实际使用的组</option>
              <option v-for="key in view.info.databaseKeys" :key="key" :value="key">{{ key }}</option>
            </select></label
          >
          <label
            ><input
              :checked="view.armed"
              type="checkbox"
              :disabled="!view.armed && (view.busy || view.dirty || view.stale)"
              @change="automatic(($event.target as HTMLInputElement).checked)"
            />后续剧情与前置更新结束后自动演变（使用已配置 API，可能收费）</label
          >
          <p>开启本身不发请求；旧剧情不会自动重跑。缺少前置完成接口时仍会阻止运行。</p>
          <p v-if="actionError" role="alert">{{ actionError }}</p>
        </section></template
      >
    </T15HostWorkspace>
    <T14Workspace
      v-else
      :inert="confirmEdit || undefined"
      mode="readonly"
      :version="T15_DAILY_VERSION"
      :page="page"
      :initial-appearance="appearance"
      :activity="view.notice"
      :dirty-labels="view.dirty ? ['API 表单'] : []"
      @update:page="page = $event"
      @appearance="appearance = $event"
      @close="emit('close')"
    >
      <template #overview>
        <section class="daily-card">
          <h3>{{ view.info ? '当前聊天已识别' : '当前聊天' }}</h3>
          <p>
            {{
              view.info
                ? view.info.character + ' · ' + view.info.binding.hostChatId
                : '请在酒馆打开一个单角色聊天。未打开聊天也可以先配置 API。'
            }}
          </p>
          <p>{{ view.notice }}</p>
          <p v-if="view.error" role="alert">{{ view.error }}</p>
          <button :disabled="view.busy || view.dirty" @click="runtime.refresh()">
            {{ view.busy ? '正在读取…' : '刷新当前资料' }}
          </button>
          <button @click="page = 'api'">配置 API</button><button @click="page = 'data'">查看世界资料</button>
        </section>
        <div class="daily-stats">
          <section class="daily-card">
            <h3>世界资料</h3>
            <strong>{{ reason }}</strong>
            <p>宏观、微观两组 · {{ template.tables.length }} 张表</p>
          </section>
          <section class="daily-card">
            <h3>演变运行</h3>
            <strong>尚未启用</strong>
            <p>打开页面不会调用模型，也不会创建存档。</p>
          </section>
        </div>
        <section class="daily-card">
          <h3>运行准备</h3>
          <p>
            MVU：{{
              view.info?.mvuAvailable ? '已检测到，等待新剧情完成' : view.info?.mvuRequired ? '等待就绪' : '未检测到'
            }}
          </p>
          <p>
            数据库：{{
              view.info?.databaseRequired
                ? view.info.databaseProtocol
                  ? '已检测到完成接口'
                  : '完成接口尚未接入（仅影响演变运行）'
                : '未检测到'
            }}
          </p>
          <p>角色卡主世界书：{{ view.info?.mainBook ?? '未绑定；不会自动创建或改绑' }}</p>
          <p>接下来：配置 API → 创建或编辑世界资料 → 按需要手动运行或开启自动。</p>
        </section>
      </template>
      <template #data
        ><p v-if="view.info?.recovery.runs.some(r => ['interrupted', 'stale'].includes(r.status))" class="warning">
          有一轮演变尚未确认；先保留备份并检查记录，不会自动重发请求。
        </p>
        <T15ReadOnlyTables
          :state="view.info?.recovery.state ?? null"
          :can-edit="
            !!view.info &&
            !view.busy &&
            !view.dirty &&
            !view.stale &&
            !view.info.recovery.runs.some(r => ['interrupted', 'stale'].includes(r.status)) &&
            ['ready', 'empty'].includes(view.info.recovery.status)
          "
          @edit="confirmEdit = true"
      /></template>
      <template #history
        ><section class="daily-card">
          <h3>已保存楼层记录</h3>
          <p v-if="view.info?.recovery.head">
            当前有效提交：第 {{ view.info.recovery.head.seq }} 次；{{ view.info.recovery.pending.length }}
            条历史待处理。
          </p>
          <p v-else>当前聊天尚无世界演变楼层记录。</p>
          <p v-for="run in view.info?.recovery.runs ?? []" :key="run.runId">
            {{ run.runId }} · {{ run.status }} · 已发 {{ run.sent }} 次请求
          </p>
          <p>这里只读取保存结果；不会自动续跑或重发请求。完整账本与恢复操作在资料工作台启用后使用。</p>
        </section></template
      >
      <template #worldbook
        ><section class="daily-card">
          <h3>世界书投影目标</h3>
          <p>{{ view.info?.mainBook ?? '角色卡尚未绑定主世界书' }}</p>
          <p>同步只使用本角色卡的主世界书。打开本页不写世界书。</p>
          <p>创建资料存档后，可在原投影页面预览条目，再决定是否同步。</p>
        </section></template
      >
      <template #api
        ><ApiSettingsPanel :version="T15_DAILY_VERSION" :port="apiPort" port-mode="host" @dirty="runtime.setDirty"
      /></template>
      <template #evolution
        ><section class="daily-card">
          <h3>演变状态</h3>
          <p>自动演变：关闭。先配置 API 和世界资料，再决定是否启用。</p>
          <p>宏观先更新社会、环境、地点，微观再依据最新条件处理 NPC、组织、计划。</p>
          <p v-if="view.info?.databaseRequired && !view.info.databaseProtocol" class="warning">
            数据库完成接口尚未接入。不会通过固定延迟猜测完成，也不会偷偷跳过数据库。
          </p>
          <label v-if="view.info && view.info.databaseKeys.length > 1"
            >本聊天使用的数据库表组<select
              :value="view.databaseKey"
              :disabled="view.busy || view.dirty"
              @change="selectDatabase(($event.target as HTMLSelectElement).value)"
            >
              <option value="">请选择实际使用的组</option>
              <option v-for="key in view.info.databaseKeys" :key="key" :value="key">{{ key }}</option>
            </select></label
          >
          <p v-if="actionError" role="alert">{{ actionError }}</p>
          <p v-else-if="view.databaseKey">数据库表组：{{ view.databaseKey }}（自动识别）</p>
          <button @click="page = 'api'">配置 API</button><button @click="page = 'data'">准备世界资料</button>
        </section>
        <section class="daily-card">
          <h3>当前表格设置</h3>
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>表格</th>
                  <th>阶段</th>
                  <th>频率</th>
                  <th>最多处理</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="table in template.tables" :key="table.id">
                  <td>{{ table.name }}</td>
                  <td>{{ table.groupId === 'macro' ? '宏观' : '微观' }}</td>
                  <td>每 {{ resolveT2TableSettings(template, table.id).frequency.value?.every ?? '未设置' }} 轮</td>
                  <td>{{ resolveT2TableSettings(template, table.id).budget.value?.maxRows ?? '未设置' }} 条</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
      <template #prompts
        ><section class="daily-card">
          <h3>填表规则</h3>
          <p>全局规则 → 宏观／微观阶段规则 → 每张表的操作规则。默认表规则已经准备好。</p>
          <details v-for="table in template.tables" :key="table.id">
            <summary>{{ table.name }}</summary>
            <p>{{ table.description }}</p>
            <pre>{{ JSON.stringify(table.rules, null, 2) }}</pre>
          </details>
          <p>创建资料存档后，沿用原提示词工作台编辑与查看发送预览。打开本页不会请求模型。</p>
        </section></template
      >
      <template #backup
        ><section class="daily-card">
          <h3>备份与迁移</h3>
          <p>当前存档：{{ reason }}。{{ view.info?.recovery.bytes ?? 0 }} 字节。</p>
          <p>首次创建前请先备份酒馆聊天；新存档不会自动迁移、覆盖旧库。</p>
          <p>资料工作台启用后，使用原备份向导的预览、下载与恢复功能。这里只查看状态，不执行迁移、清空或恢复。</p>
          <button @click="page = 'data'">查看世界资料</button>
        </section></template
      >
    </T14Workspace>
    <div v-if="confirmEdit" class="confirm-backdrop" @keydown.esc="!view.busy && (confirmEdit = false)">
      <section role="dialog" aria-modal="true" aria-labelledby="daily-save-title" class="save-confirm">
        <h2 id="daily-save-title">
          {{ view.info?.recovery.status === 'empty' ? '创建当前聊天的世界资料？' : '编辑当前聊天的世界资料？' }}
        </h2>
        <p>{{ view.info?.character }} · {{ view.info?.binding.hostChatId }}</p>
        <p>
          {{
            view.info?.recovery.status === 'empty'
              ? '将空白默认表保存到当前聊天。不会填入演示角色，不会迁移或覆盖旧数据库。'
              : '启用编辑会保存本插件的消息标记；后续保存会更新当前聊天的世界演变资料。'
          }}不会修改剧情正文，不会调用收费 API 或写世界书。
        </p>
        <p>请在备份好的测试聊天使用，并停用旧世界演变脚本；不要同时开多个酒馆页面编辑。</p>
        <p v-if="actionError" role="alert">{{ actionError }}</p>
        <button ref="cancelButton" :disabled="view.busy" @click="confirmEdit = false">取消</button
        ><button :disabled="view.busy || view.dirty" @click="edit">
          {{ view.busy ? '处理中…' : view.info?.recovery.status === 'empty' ? '创建并保存' : '启用资料编辑' }}
        </button>
      </section>
    </div>
  </div>
</template>
<style scoped>
.daily-root {
  min-width: 0;
  height: 100%;
}
.daily-card {
  margin-bottom: 16px;
  padding: 18px;
  border: 1px solid var(--we14-border);
  border-radius: 12px;
  color: var(--we14-text);
  background: var(--we14-card);
  overflow-wrap: anywhere;
}
.daily-card h3 {
  margin-top: 0;
}
.daily-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.daily-card button,
.daily-card select {
  font: inherit;
  color: var(--we14-text);
  background: var(--we14-control);
  border: 1px solid var(--we14-border);
  border-radius: 8px;
  padding: 9px 12px;
  cursor: pointer;
  margin: 4px 8px 4px 0;
  white-space: normal;
  max-width: 100%;
}
.daily-card label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.daily-card button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.warning {
  color: var(--we14-warning-text);
  background: var(--we14-warning-bg);
  padding: 12px;
  border-radius: 8px;
}
.scroll {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 10px;
  text-align: left;
  border-bottom: 1px solid var(--we14-border);
}
th {
  background: var(--we14-soft);
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  background: rgb(0 0 0 / 0.3);
  display: grid;
  place-items: center;
  padding: 16px;
  box-sizing: border-box;
  overflow: auto;
}
.save-confirm {
  max-width: 560px;
  padding: 22px;
  border-radius: 14px;
  background: #fff0f3;
  border: 1px solid #b56780;
  color: #853c52;
  font:
    15px/1.6 system-ui,
    sans-serif;
}
.save-confirm button {
  font: inherit;
  background: #fff;
  color: inherit;
  padding: 9px 14px;
  border: 1px solid #b56780;
  border-radius: 8px;
  margin-right: 10px;
  cursor: pointer;
}
:focus-visible {
  outline: 3px solid var(--we14-focus, #315e40);
  outline-offset: 2px;
}
@container we14 (max-width: 720px) {
  .daily-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
