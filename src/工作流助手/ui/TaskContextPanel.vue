<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PostProcessTask, TaskContextConfig } from '../tasks/schema';
import Context7Section from './Context7Section.vue';
import AcuToggle from './AcuToggle.vue';
import AcuHelpIconBtn from './AcuHelpIconBtn.vue';
import AcuHelpPanel from './AcuHelpPanel.vue';

const enabled = defineModel<boolean>('enabled', { default: false });

const props = defineProps<{
  tasks: PostProcessTask[];
  defaultContextConfig: TaskContextConfig;
}>();

const panelTaskId = ref('');
const helpOpen = ref(false);

const panelTask = computed(() => props.tasks.find(t => t.id === panelTaskId.value));

const taskContextMode = computed({
  get: (): 'inherit' | 'custom' => panelTask.value?.contextMode ?? 'inherit',
  set: (v: 'inherit' | 'custom') => {
    const task = panelTask.value;
    if (!task) return;
    task.contextMode = v;
    if (v === 'custom' && !task.contextConfig) {
      task.contextConfig = _.cloneDeep(props.defaultContextConfig);
    }
  },
});

const taskContextConfig = computed({
  get: (): TaskContextConfig => {
    const task = panelTask.value;
    if (!task?.contextConfig) {
      return props.defaultContextConfig;
    }
    return task.contextConfig;
  },
  set: (v: TaskContextConfig) => {
    const task = panelTask.value;
    if (!task) return;
    task.contextConfig = v;
  },
});

function syncPanelTaskId() {
  const tasks = props.tasks;
  if (!tasks.length) {
    panelTaskId.value = '';
    return;
  }
  if (!tasks.some(t => t.id === panelTaskId.value)) {
    panelTaskId.value = tasks[0].id;
  }
}

watch(
  () => props.tasks.map(t => t.id).join(','),
  () => syncPanelTaskId(),
  { immediate: true },
);

watch(
  () => [panelTaskId.value, panelTask.value?.contextMode] as const,
  () => {
    const task = panelTask.value;
    if (task?.contextMode === 'custom' && !task.contextConfig) {
      task.contextConfig = _.cloneDeep(props.defaultContextConfig);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="acu-section acu-task-context-panel">
    <div class="acu-row acu-row--inline acu-heading-with-help" style="margin-bottom: 8px">
      <AcuToggle v-model="enabled" label="按任务配置 $7 上下文" />
      <AcuHelpIconBtn
        v-model:open="helpOpen"
        panel-id="task-context-panel-help"
        label="按任务配置 $7 上下文说明"
      />
    </div>
    <AcuHelpPanel v-model:open="helpOpen" id="task-context-panel-help" label="按任务配置 $7 上下文说明">
      <p class="acu-notes acu-notes--sm" style="margin: 0">
        关闭时，所有含 <code>$7</code> 的任务均使用上方「$7 默认上下文」。开启后可按任务单独配置 N 与提取/排除规则；仅当任务提示词含
        <code>$7</code> 时生效。同 N 亦用于该任务 $1 世界书扫描基底。
      </p>
    </AcuHelpPanel>
    <div v-show="enabled" class="acu-subsection">
      <div v-if="!tasks.length" class="acu-notes acu-notes--sm">暂无任务，请先在「任务」页添加任务。</div>
      <template v-else>
        <div class="acu-row">
          <label>配置任务</label>
          <select v-model="panelTaskId" class="acu-select" style="flex: 1">
            <option v-for="task in tasks" :key="task.id" :value="task.id">
              {{ task.name || '未命名任务' }}
            </option>
          </select>
        </div>
        <div class="acu-row acu-row--inline">
          <label><input v-model="taskContextMode" type="radio" value="inherit" /> 沿用预设默认</label>
          <label><input v-model="taskContextMode" type="radio" value="custom" /> 本任务自定义</label>
        </div>
        <Context7Section v-if="taskContextMode === 'custom'" v-model:config="taskContextConfig" embedded />
      </template>
    </div>
  </div>
</template>
