<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import T14Workspace from './T14Workspace.vue';
import T6WorldWorkbench from './T6WorldWorkbench.vue';
import T7PromptWorkbench from './T7PromptWorkbench.vue';
import T11DailyWorkbench from './T11DailyWorkbench.vue';
import T12ProjectionWorkbench from './T12ProjectionWorkbench.vue';
import T13BackupWorkbench from './T13BackupWorkbench.vue';
import ApiSettingsPanel from '../console/ApiSettingsPanel.vue';
import type { T15HostWorkspace } from './t15-host-workspace';
import type { T15Automatic } from './t15-automatic';
import type { T1PageId } from './t1-ui-contract';
const props = defineProps<{ session: T15HostWorkspace & { automatic?: T15Automatic }; version: string }>();
const emit = defineEmits<{ close: []; apiDirty: [value: boolean] }>();
const page = ref<T1PageId>('overview'),
  consent = ref(false),
  routeConsent = ref(false),
  busy = ref(false),
  error = ref(''),
  apiDirty = ref(false),
  tick = ref(0);
const offs = [
  props.session.prerequisites,
  props.session.data,
  props.session.structure,
  props.session.generation,
  props.session.daily,
  props.session.projection,
  props.session.backup,
  props.session.round,
  ...(props.session.automatic ? [props.session.automatic] : []),
].map(c => c.subscribe(() => tick.value++));
async function action(fn: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作被阻断';
  } finally {
    busy.value = false;
    tick.value++;
  }
}
function select(value: T1PageId) {
  page.value = value;
  props.session.daily.selectPage(value === 'history' ? 'history' : value === 'evolution' ? 'automatic' : 'overview');
}
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' })),
    a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onBeforeUnmount(() => {
  for (const off of offs) off();
  props.session.close();
});
</script>
<template>
  <T14Workspace
    mode="compatibility"
    :page="page"
    :version="version"
    :inert="busy"
    :initial-appearance="session.readAppearance()"
    :data-revision="tick"
    :dirty-labels="
      [
        session.data.dirty() && '世界资料',
        session.structure.dirty() && '结构参数',
        session.generation.view().prompts.dirty && '填表提示词',
        apiDirty && 'API 表单',
      ].filter((v): v is string => !!v)
    "
    activity="单活动页面兼容接线 · 不是已验收正式版"
    @update:page="select"
    @appearance="session.setAppearance"
    @close="emit('close')"
  >
    <template #overview><T11DailyWorkbench :controller="session.daily" embedded /></template>
    <template #data><T6WorldWorkbench :data="session.data" :structure="session.structure" /></template>
    <template #history><T11DailyWorkbench :controller="session.daily" embedded /></template>
    <template #worldbook>
      <p role="note">目标仅为角色卡主世界书。同步会真实写入，仅管理有归属标记的条目；同步期间不要生成剧情。</p>
      <T12ProjectionWorkbench :controller="session.projection" />
    </template>
    <template #api
      ><ApiSettingsPanel
        :version="version"
        :port="session.apiPort"
        port-mode="host"
        @dirty="
          apiDirty = $event;
          emit('apiDirty', $event);
        "
    /></template>
    <template #evolution>
      <section class="host-controls" :data-revision="tick">
        <p>先等剧情、MVU 与数据库完成并保存，再检查本轮前置。普通更新通知不代表整轮完成。</p>
        <button :disabled="busy" @click="action(session.refresh)">检查当前回复与前置保存状态（不调用模型）</button>
        <ul>
          <li v-for="proof in session.readInput().proofs" :key="proof.sourceId">
            {{ proof.sourceId }}：{{ proof.reason }}
          </li>
        </ul>
        <label
          ><input v-model="routeConsent" type="checkbox" />确认将 API
          页主预设用于模板默认路由（保存模板，不请求模型）</label
        >
        <button
          :disabled="busy || !routeConsent || apiDirty"
          @click="
            action(async () => {
              await session.applyPrimaryRoute(routeConsent);
              routeConsent = false;
              consent = false;
            })
          "
        >
          采用当前主预设
        </button>
        <label
          ><input
            v-model="consent"
            type="checkbox"
            :disabled="apiDirty || busy"
            @change="action(async () => session.authorizeRealApi(consent))"
          />允许手动运行及已开启的自动运行调用真实 API（可能收费；勾选本身不请求）</label
        >
        <p>
          实际请求权限：{{ session.realApiEnabled() ? '已允许（仍需前置证据通过）' : '未允许，或配置变化后已撤销' }}
        </p>
        <p>自动来源接线：{{ session.automatic?.view().reason ?? '本会话未接自动来源调度；开关本身不请求模型' }}</p>
        <p v-if="error" role="alert">{{ error }}</p>
      </section>
      <T11DailyWorkbench :controller="session.daily" embedded />
    </template>
    <template #prompts
      ><p>这里的单批“模拟”仍是本地假响应；真实生成使用自动演变页的整轮入口。</p>
      <T7PromptWorkbench :workbench="session.generation"
    /></template>
    <template #backup><T13BackupWorkbench :controller="session.backup" @export="download" /></template>
  </T14Workspace>
</template>
<style scoped>
.host-controls {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--we14-border);
  border-radius: 12px;
  background: var(--we14-card);
}
.host-controls label {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.host-controls button {
  justify-self: start;
  max-width: 100%;
  white-space: normal;
}
</style>
