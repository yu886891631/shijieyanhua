<script setup lang="ts">
import { computed, ref, shallowRef, onBeforeUnmount } from 'vue';
import T15HostWorkspace from './T15HostWorkspace.vue';
import { createT15NativeImportRuntime } from './t15-import-native';
import { T15_HOST_VERSION } from './t15-import-runtime';
import type { T4Executor } from './t4-service';
const props = defineProps<{ execute: T4Executor }>();
const emit = defineEmits<{ close: [] }>();
const runtime = createT15NativeImportRuntime(props.execute),
  view = shallowRef(runtime.view());
const off = runtime.subscribe(() => {
  view.value = runtime.view();
});
const mvu = ref(true),
  database = ref(true),
  databaseKey = ref(''),
  backup = ref(false),
  singlePage = ref(false),
  writes = ref(false),
  initialize = ref(false),
  autoConsent = ref(false),
  error = ref('');
const connected = computed(() => view.value.session),
  sessionSerial = ref(0);
let last: unknown = null;
const offSession = runtime.subscribe(() => {
  if (view.value.session !== last) {
    last = view.value.session;
    sessionSerial.value++;
    autoConsent.value = false;
  }
});
async function action(fn: () => Promise<unknown> | void) {
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value =
      '操作未完成：' +
      (e instanceof Error ? e.message.slice(0, 200) : '检查目标、旧脚本、来源和保存状态') +
      '。没有自动重试或丢弃草稿。';
  }
}
async function inspect() {
  await runtime.inspect();
  const keys = runtime.view().inspection?.databaseKeys ?? [];
  databaseKey.value = keys.length === 1 ? keys[0] : '';
}
onBeforeUnmount(() => {
  off();
  offSession();
  runtime.close();
});
</script>
<template>
  <section class="we-import">
    <header>
      <div>
        <strong>世界演变 · {{ T15_HOST_VERSION }}</strong>
        <p>真实宿主接线候选 · 尚未通过你的酒馆验收</p>
      </div>
      <button @click="emit('close')">收起（保留本次会话）</button>
    </header>
    <details :open="!connected">
      <summary>连接与验收控制</summary>
      <p>
        本包不是隔离内存沙盒。未连接前不保存聊天；连接后“世界资料保存”等会写当前测试聊天。真实
        API、自动演变和世界书同步是另外的操作。
      </p>
      <p role="status">{{ view.reason }}</p>
      <button :disabled="view.busy || view.observing || !!connected" @click="action(inspect)">
        1. 只读检查当前聊天（不调用模型、不保存）
      </button>
      <div v-if="view.inspection" class="inspection">
        <p>角色卡：{{ view.inspection.character }}；聊天：{{ view.inspection.binding.hostChatId }}</p>
        <p>
          存档：{{ view.inspection.state }}；角色卡主世界书：{{
            view.inspection.mainBook ?? '未绑定（不会创建或改绑）'
          }}
        </p>
        <p>
          MVU：{{ view.inspection.mvuAvailable ? '已就绪' : '未就绪' }}；数据库整轮协议：{{
            view.inspection.databaseProtocol ? '已检测到，仍须验证通知与保存' : '未检测到；必要数据库启用时不会放行模型'
          }}
        </p>
        <fieldset :disabled="view.observing || view.busy || !!connected">
          <legend>本聊天实际使用的前置插件</legend>
          <label><input v-model="mvu" type="checkbox" />等待 MVU（读取本轮 stat_data）</label>
          <label><input v-model="database" type="checkbox" />等待数据库（需要整轮完成兼容接口）</label>
          <label v-if="database"
            >数据库隔离组<select v-model="databaseKey">
              <option value="">请选择本聊天的实际组</option>
              <option v-for="key in view.inspection.databaseKeys" :key="key" :value="key">{{ key }}</option>
            </select></label
          >
          <p>
            只在本聊天确实没有使用某插件时取消对应项。不要为解除阻断而假装它不存在。没有前置插件时也要等待新的助手完成通知与保存确认。
          </p>
        </fieldset>
        <button
          :disabled="view.busy || view.observing || !!connected"
          @click="action(() => runtime.observe({ mvu, database, databaseKey }))"
        >
          2. 开始观察后续完成通知（不写聊天、不请求模型）
        </button>
      </div>
      <fieldset :disabled="view.busy || !!connected">
        <legend>仅对备份好的单角色测试聊天授权保存</legend>
        <label><input v-model="backup" type="checkbox" />我已备份，并打开专门的测试聊天</label>
        <label><input v-model="singlePage" type="checkbox" />只有一个活动页面，旧世界演变写入脚本已停用</label>
        <label
          ><input
            v-model="writes"
            type="checkbox"
          />允许新工作台保存自有世界演变字段和消息身份（不会改剧情正文；不是收费 API 授权）</label
        >
        <label
          ><input
            v-model="initialize"
            type="checkbox"
          />如果没有新格式存档，允许初始化空白默认表（不会迁移旧库或填入示例角色）</label
        >
      </fieldset>
      <button
        :disabled="view.busy || !view.observing || !!connected || !backup || !singlePage || !writes"
        @click="action(() => runtime.connect(backup && singlePage && writes, initialize))"
      >
        3. 连接测试工作台（可能保存测试聊天）
      </button>
      <div v-if="connected" class="paid">
        <label
          ><input
            v-model="autoConsent"
            type="checkbox"
            :disabled="view.busy || view.uiDirty"
          />允许当前聊天后续自动演变调用真实 API（可能收费；先配置 API 和请求上限）</label
        >
        <button
          :disabled="!autoConsent || view.busy || view.uiDirty || view.armed"
          @click="action(() => runtime.arm(true))"
        >
          明确启用后续自动接管（勾选本身不请求）
        </button>
        <button
          @click="
            action(() => {
              runtime.arm(false);
              autoConsent = false;
            })
          "
        >
          撤销自动与真实 API 权限
        </button>
        <p>
          自动接管：{{ view.armed ? '已授权，等待之后的新通知' : '未授权' }}。换聊天、改 API、停止生成后需要重新确认。
        </p>
      </div>
      <button :disabled="view.busy" @click="action(() => runtime.disconnect())">
        断开连接（有草稿或未确认结果时不丢弃）
      </button>
      <p v-if="error" role="alert">{{ error }}</p>
    </details>
    <T15HostWorkspace
      v-if="connected"
      :key="sessionSerial"
      :session="connected"
      :version="T15_HOST_VERSION"
      @close="emit('close')"
      @api-dirty="runtime.setUiDirty"
    />
  </section>
</template>
<style scoped>
.we-import {
  min-height: 100%;
  background: #edf4e9;
  color: #294333;
  font:
    15px/1.6 system-ui,
    sans-serif;
  padding: 16px;
  box-sizing: border-box;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
header p {
  margin: 4px 0;
}
details {
  margin: 12px 0;
  padding: 16px;
  border: 1px solid #aac0a5;
  border-radius: 12px;
  background: #f8fbf5;
}
summary {
  cursor: pointer;
  font-weight: 700;
}
button,
select {
  font: inherit;
  padding: 8px 12px;
  border: 1px solid #789a78;
  border-radius: 8px;
  background: #f0f8e9;
  color: #294333;
  white-space: normal;
  max-width: 100%;
}
button {
  cursor: pointer;
  margin: 6px 8px 6px 0;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
fieldset {
  display: grid;
  gap: 10px;
  border: 1px solid #bdd0b3;
  border-radius: 10px;
  margin: 12px 0;
}
label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.inspection {
  margin: 12px 0;
}
.paid,
[role='alert'] {
  background: #fae9eb;
  border: 1px solid #dca6b2;
  border-radius: 10px;
  padding: 12px;
  color: #77354b;
}
input {
  margin-top: 6px;
}
p {
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .we-import {
    padding: 8px;
  }
  header {
    flex-direction: column;
  }
  button {
    width: 100%;
  }
}
</style>
