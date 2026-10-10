<script setup lang="ts">
import { computed, ref } from 'vue';
import T14Workspace from './T14Workspace.vue';
import T6WorldWorkbench from './T6WorldWorkbench.vue';
import T7PromptWorkbench from './T7PromptWorkbench.vue';
import T11DailyWorkbench from './T11DailyWorkbench.vue';
import T12ProjectionWorkbench from './T12ProjectionWorkbench.vue';
import T13BackupWorkbench from './T13BackupWorkbench.vue';
import ApiSettingsPanel from '../console/ApiSettingsPanel.vue';
import type { T1PageId } from './t1-ui-contract';
import type { createT14VisualViews } from './t14-visual-fixtures';
import type { T5Workbench } from './t5-workbench';
import type { T6Workbench } from './t6-workbench';
import type { T7Workbench } from './t7-workbench';
import type { T11Controller } from './t11-controller';
import type { T12Controller } from './t12-controller';
import type { T13Controller } from './t13-controller';
const props = defineProps<{ initialViews: Awaited<ReturnType<typeof createT14VisualViews>> }>();
const page = ref<T1PageId>('overview'),
  width = ref(1200),
  zoom = ref(100),
  scenario = ref('normal'),
  key = ref(0);
const initial = () => structuredClone(props.initialViews);
const views = ref(initial());
function scenarioChanged() {
  views.value = initial();
  const v = views.value;
  if (scenario.value === 'empty') {
    v.data.rows = [];
    v.data.total = 0;
    v.daily.macroRows = v.daily.microRows = 0;
  }
  if (scenario.value === 'long') {
    const text = '这是一段很长的角色资料与多语言名称，用来检查换行、宽表与可达操作。'.repeat(18);
    v.data.table.name = text.slice(0, 180);
    v.data.rows[0].title = text.slice(0, 180);
    for (const cell of v.data.rows[0].cells) cell.text = text;
    v.daily.worldId = 'world-'.repeat(40);
  }
  if (scenario.value === 'error') {
    for (const target of [v.data, v.structure, v.generation, v.daily, v.projection, v.backup])
      target.error = '校验未通过：本地错误样例。没有保存，没有发送请求，请检查字段或权限。';
  }
  if (scenario.value === 'pending') {
    v.backup.pending = true;
    v.backup.canSave = false;
    v.daily.canStart = false;
    v.daily.canQuery = true;
    v.daily.message = '保存结果未知：只能查询；请勿重新发送模型请求。';
  }
  if (scenario.value === 'locked') {
    v.data.rows[0].locked = true;
    v.data.rows[0].archived = true;
  }
  key.value++;
}
// Presentation fixtures have no persistence methods: actions do not perform or pretend business saves.
function port<T>(view: () => unknown, actions: Record<string, unknown> = {}): T {
  return new Proxy(
    { view, subscribe: () => () => {}, ...actions },
    { get: (target, name) => (name in target ? target[name as keyof typeof target] : () => {}) },
  ) as T;
}
const data = port<T5Workbench>(() => ({ ...views.value.data, canAdd: false, canSave: false }), {
  search: (q: string) => {
    views.value.data.query = q;
  },
  dirty: () => scenario.value === 'draft',
});
const structure = port<T6Workbench>(() => ({ ...views.value.structure, canSave: false, busy: true }));
const generation = port<T7Workbench>(() => ({ ...views.value.generation, busy: true }));
function daily(which: 'overview' | 'history' | 'automatic') {
  return port<T11Controller>(
    () => ({ ...views.value.daily, page: which, canStart: false, canResume: false, canCancel: false }),
    {
      hasNavigation: true,
      navigate: (target: string) => {
        page.value = target === 'world' ? 'data' : target === 'api' ? 'api' : 'prompts';
      },
    },
  );
}
const overview = daily('overview'),
  history = daily('history'),
  automatic = daily('automatic');
const projection = port<T12Controller>(() => ({ ...views.value.projection, canSync: false, canRetry: false }));
const backup = port<T13Controller>(() => ({ ...views.value.backup, canSave: false, privateAllowed: false }));
const dirty = computed(() => (scenario.value === 'draft' ? ['世界资料：未保存填写（视觉夹具）'] : []));
</script>
<template>
  <div class="we14-fixture">
    <aside class="fixture-controls">
      <strong>T14 独立视觉验收 · 不是酒馆导入包</strong>
      <p>
        固定视图夹具；业务按钮不写入、不生成。API 页使用既有组件，但导入在构建时替换为纯内存假模块，不读取任何真实 Key。
      </p>
      <label
        >工作区宽度<select v-model="width">
          <option :value="1200">1200 px</option>
          <option :value="900">900 px</option>
          <option :value="600">600 px</option>
          <option :value="360">360 px</option>
        </select></label
      ><label
        >CSS 缩放模拟（不是原生浏览器缩放）<select v-model="zoom">
          <option :value="100">100%</option>
          <option :value="110">110%</option>
          <option :value="125">125%</option>
        </select></label
      ><label
        >视觉场景<select v-model="scenario" @change="scenarioChanged">
          <option value="normal">普通</option>
          <option value="empty">空资料</option>
          <option value="long">长名称 / 密集字段</option>
          <option value="error">校验错误</option>
          <option value="locked">锁定 / 归档</option>
          <option value="draft">未保存</option>
          <option value="pending">保存待确认</option>
        </select></label
      >
    </aside>
    <div class="fixture-stage" :style="{ width: `${width}px`, maxWidth: '100%', zoom: zoom / 100 }">
      <T14Workspace :key="key" v-model:page="page" :dirty-labels="dirty" activity="视觉夹具：业务写入与模型发送已阻断">
        <template #overview><T11DailyWorkbench :controller="overview" embedded /></template
        ><template #data><T6WorldWorkbench :data="data" :structure="structure" /></template
        ><template #history><T11DailyWorkbench :controller="history" embedded /></template
        ><template #worldbook><T12ProjectionWorkbench :controller="projection" /></template
        ><template #api><ApiSettingsPanel /></template
        ><template #evolution><T11DailyWorkbench :controller="automatic" embedded /></template
        ><template #prompts><T7PromptWorkbench :workbench="generation" /></template
        ><template #backup><T13BackupWorkbench :controller="backup" /></template>
      </T14Workspace>
    </div>
  </div>
</template>
<style scoped>
.we14-fixture {
  font:
    14px/1.6 system-ui,
    sans-serif;
  color: #294734;
  padding: 12px;
  background: #e8eee5;
}
.fixture-controls {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid #6f8b73;
  border-radius: 12px;
  background: #fbfdfa;
}
.fixture-controls p {
  margin: 4px 0 12px;
}
.fixture-controls label {
  display: inline-grid;
  gap: 4px;
  margin: 0 12px 8px 0;
}
.fixture-controls select {
  font: inherit;
  padding: 7px;
  color: #294734;
  background: #ffffff;
}
.fixture-stage {
  margin-inline: auto;
}
</style>
