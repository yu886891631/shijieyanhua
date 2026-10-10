<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, ref, watch } from 'vue';
import T14Workspace from './T14Workspace.vue';
import T6WorldWorkbench from './T6WorldWorkbench.vue';
import T7PromptWorkbench from './T7PromptWorkbench.vue';
import T11DailyWorkbench from './T11DailyWorkbench.vue';
import T12ProjectionWorkbench from './T12ProjectionWorkbench.vue';
import T13BackupWorkbench from './T13BackupWorkbench.vue';
import ApiSettingsPanel from '../console/ApiSettingsPanel.vue';
import { createT15Session, parseT15File, T15_VERSION, type T15Session } from './t15-session';
import type { T4Executor } from './t4-service';
import type { T1PageId } from './t1-ui-contract';
const props = defineProps<{ execute: T4Executor }>();
const emit = defineEmits<{ close: [] }>();
const session = ref<T15Session>(),
  page = ref<T1PageId>('overview'),
  tick = ref(0),
  key = ref(0);
const story = ref('本轮在城中下起暴雨。'),
  error = ref(''),
  message = ref(''),
  busy = ref(false),
  apiDirty = ref(false);
const allowSimulation = ref(false),
  unsubscribers: Array<() => void> = [];
let destroyed = false;
function navigate(destination: string) {
  page.value =
    destination === 'world'
      ? 'data'
      : destination === 'projection'
        ? 'worldbook'
        : destination === 'recovery'
          ? 'history'
          : (destination as T1PageId);
}
function attach(next: T15Session) {
  for (const off of unsubscribers.splice(0)) off();
  session.value?.close();
  session.value = markRaw(next);
  apiDirty.value = false;
  for (const controller of [
    next.data,
    next.structure,
    next.generation,
    next.daily,
    next.projection,
    next.backup,
    next.round,
  ])
    unsubscribers.push(controller.subscribe(() => tick.value++));
  story.value = next.readInput().story.at(-1)!.text;
  key.value++;
  next.daily.selectPage(page.value === 'history' ? 'history' : page.value === 'evolution' ? 'automatic' : 'overview');
}
async function action(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败，未替换工作区';
  } finally {
    busy.value = false;
    tick.value++;
  }
}
void action(async () => {
  const next = await createT15Session({ execute: props.execute, navigate });
  if (destroyed) {
    next.close();
    return;
  }
  attach(next);
  await next.refresh();
});
watch(page, value =>
  session.value?.daily.selectPage(value === 'history' ? 'history' : value === 'evolution' ? 'automatic' : 'overview'),
);
const dirty = computed(() => {
  void tick.value;
  const s = session.value;
  if (!s) return [];
  return [
    s.data.dirty() && '世界资料',
    s.structure.dirty() && '结构参数',
    s.generation.view().prompts.dirty && '填表提示词',
    apiDirty.value && 'API 表单（仅内存）',
    busy.value && '工作区操作进行中',
    ['macro', 'micro', 'saving', 'validating', 'pending'].includes(s.round.view().status) && '演算/回执未结束',
    s.service.view().draft && s.service.view().status !== 'saved' && '尚未确认的提交',
    story.value !== s.readInput().story.at(-1)?.text && '本地剧情草稿',
  ].filter((v): v is string => !!v);
});
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function openFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await action(async () => {
    if (!session.value || dirty.value.filter(v => v !== '工作区操作进行中').length)
      throw new Error('先处理未保存内容再打开文件');
    session.value.assertIdle();
    if (file.size > 24_000_000) throw new Error('文件过大');
    const old = session.value,
      stamp = old.service.headToken();
    const next = await createT15Session({
      execute: props.execute,
      file: await parseT15File(await file.text()),
      navigate,
    });
    try {
      old.assertIdle();
      if (
        destroyed ||
        JSON.stringify(old.service.headToken()) !== JSON.stringify(stamp) ||
        old.data.dirty() ||
        old.structure.dirty()
      )
        throw new Error('打开文件期间工作区已变化；原工作区保留');
      attach(next);
      await next.refresh();
      message.value = '已打开隔离工作区；API Key 和模拟世界书不从文件恢复。';
    } catch (e) {
      next.close();
      throw e;
    }
  });
}
function close() {
  emit('close');
} // Embedding entry hides the still-live workspace; pagehide disposes it.
onBeforeUnmount(() => {
  destroyed = true;
  for (const off of unsubscribers) off();
  session.value?.close();
});
</script>
<template>
  <div class="we15-candidate">
    <section class="candidate-notice" aria-label="候选版安全范围">
      <strong>{{ T15_VERSION }} · 隔离功能候选版，不是正式发布版</strong>
      <p>
        真实 SQLite 填写与校验、本地存档、模拟演算和模拟世界书已接线。不读取聊天、不调用真实 API、不修改角色卡世界书。
      </p>
      <p>
        保存只保存在当前脚本内存。关闭酒馆或重载前请导出工作区；重新打开文件可恢复资料、结构、已保存提示词与外观。API
        Key 不导出。
      </p>
      <div class="candidate-actions">
        <button
          :disabled="busy || !session"
          @click="
            action(async () => {
              download(await session!.exportWorkspace(), '世界演变-T15-隔离工作区.json');
              message = '已请求下载，请确认文件确实保存到磁盘。';
            })
          "
        >
          导出完整隔离工作区
        </button>
        <label
          >打开隔离工作区文件<input
            type="file"
            accept=".json,application/json"
            :disabled="busy || !session"
            @change="openFile"
        /></label>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="message" role="status">{{ message }}</p>
    </section>
    <T14Workspace
      v-if="session"
      :key="key"
      v-model:page="page"
      :inert="busy"
      :version="T15_VERSION"
      :dirty-labels="dirty"
      :initial-appearance="session.readAppearance()"
      activity="隔离存档 · 没有真实聊天/API/世界书权限"
      @appearance="session.setAppearance"
      @close="close"
    >
      <template #overview><T11DailyWorkbench :controller="session!.daily" embedded /></template>
      <template #data><T6WorldWorkbench :data="session!.data" :structure="session!.structure" /></template>
      <template #history><T11DailyWorkbench :controller="session!.daily" embedded /></template>
      <template #worldbook
        ><p class="candidate-notice">
          此页目标是本地模拟世界书。同步在内存中执行，关闭/重载后需重新同步，不会写入角色卡。
        </p>
        <T12ProjectionWorkbench :controller="session!.projection"
      /></template>
      <template #api
        ><p class="candidate-notice">
          复用既有 API 编辑器，仅用于检查配置界面；配置只存内存，不绑定此候选版演算，不读取旧 Key。请使用假
          Key。连接测试为本地模拟。
        </p>
        <ApiSettingsPanel :version="T15_VERSION" :port="session!.apiPort" @dirty="apiDirty = $event"
      /></template>
      <template #evolution>
        <section class="candidate-notice">
          <h3>本地模拟输入与路由</h3>
          <label>本轮剧情（不会发送至服务器）<textarea v-model="story" :disabled="busy" /></label>
          <button
            :disabled="busy"
            @click="
              action(async () => {
                await session!.setStory(story);
                message = '本地剧情已采用，未运行模型。';
              })
            "
          >
            采用本地剧情
          </button>
          <label><input v-model="allowSimulation" type="checkbox" />确认把当前模板默认 API 路由改为仅本地模拟</label>
          <button
            :disabled="busy || !allowSimulation"
            @click="
              action(async () => {
                await session!.enableSimulation(allowSimulation);
                allowSimulation = false;
                message = '已启用模拟路由，没有增加请求额度。';
              })
            "
          >
            启用模拟路由
          </button>
          <p>
            默认请求额度为五次，实际次数取决于到期表、候选记录与新增权限。超过额度时，请在结构参数内明确调整请求上限或表频率；系统不会擅自扩额。模拟默认返回无变化
            SQL，不会根据剧情自动编造 NPC。
          </p>
          <button
            :disabled="busy"
            @click="
              action(async () => {
                await session!.refresh();
                message = '已核对本地正式存档与进度。';
              })
            "
          >
            核对资料与进度
          </button>
        </section>
        <T11DailyWorkbench :controller="session!.daily" :events-available="false" embedded />
      </template>
      <template #prompts><T7PromptWorkbench :workbench="session!.generation" /></template>
      <template #backup><T13BackupWorkbench :controller="session!.backup" @export="download" /></template>
    </T14Workspace>
    <p v-else role="status">正在初始化独立工作区……</p>
  </div>
</template>
<style scoped>
.we15-candidate {
  padding: 12px;
  background: #e8eee5;
  color: #294734;
  font:
    14px/1.65 system-ui,
    'Microsoft YaHei',
    sans-serif;
  min-width: 0;
}
.candidate-notice {
  padding: 14px;
  margin-bottom: 12px;
  border: 1px solid #6f8b73;
  border-radius: 12px;
  background: #fbfdfa;
  overflow-wrap: anywhere;
}
.candidate-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
button,
input,
textarea {
  font: inherit;
  max-width: 100%;
}
button {
  padding: 7px 12px;
  color: #294734;
  border: 1px solid #6f8b73;
  border-radius: 8px;
  background: #f1f8ef;
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.6;
}
label {
  display: block;
  margin: 10px 0;
}
textarea {
  display: block;
  width: 100%;
  min-height: 90px;
  box-sizing: border-box;
}
[role='alert'] {
  padding: 10px;
  color: #853c52;
  background: #fff0f3;
}
:focus-visible {
  outline: 2px solid #315e40;
  outline-offset: 3px;
}
</style>
