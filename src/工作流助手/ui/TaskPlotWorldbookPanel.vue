<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PlotWorldbookConfig, PlotWorldbookMode, PostProcessTask } from '../tasks/schema';
import PlotWorldbookSection from './PlotWorldbookSection.vue';
import AcuToggle from './AcuToggle.vue';
import AcuHelpIconBtn from './AcuHelpIconBtn.vue';
import AcuHelpPanel from './AcuHelpPanel.vue';

const enabled = defineModel<boolean>('enabled', { default: false });

const props = defineProps<{
  tasks: PostProcessTask[];
  defaultPlotWorldbookConfig: PlotWorldbookConfig;
}>();

const panelTaskId = ref('');
const helpOpen = ref(false);

const panelTask = computed(() => props.tasks.find(t => t.id === panelTaskId.value));

const isReplicaMember = computed(() => !!panelTask.value?.replicaFamilyRootId);

function taskOptionLabel(task: PostProcessTask): string {
  const name = task.name || '未命名任务';
  return task.replicaFamilyRootId ? `[副本] ${name}` : name;
}

const taskPlotWorldbookMode = computed({
  get: (): PlotWorldbookMode => panelTask.value?.plotWorldbookMode ?? 'inherit',
  set: (v: PlotWorldbookMode) => {
    const task = panelTask.value;
    if (!task) return;
    task.plotWorldbookMode = v;
    if (v === 'custom' && !task.plotWorldbookConfig) {
      task.plotWorldbookConfig = _.cloneDeep(props.defaultPlotWorldbookConfig);
    } else if (v !== 'custom') {
      task.plotWorldbookConfig = undefined;
    }
  },
});

const taskPlotWorldbookConfig = computed({
  get: (): PlotWorldbookConfig => {
    const task = panelTask.value;
    if (!task?.plotWorldbookConfig) {
      return props.defaultPlotWorldbookConfig;
    }
    return task.plotWorldbookConfig;
  },
  set: (v: PlotWorldbookConfig) => {
    const task = panelTask.value;
    if (!task) return;
    task.plotWorldbookConfig = v;
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
  () => [panelTaskId.value, panelTask.value?.plotWorldbookMode] as const,
  () => {
    const task = panelTask.value;
    if (task?.plotWorldbookMode === 'custom' && !task.plotWorldbookConfig) {
      task.plotWorldbookConfig = _.cloneDeep(props.defaultPlotWorldbookConfig);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="acu-section acu-task-plot-worldbook-panel">
    <div class="acu-row acu-row--inline acu-heading-with-help" style="margin-bottom: 8px">
      <AcuToggle v-model="enabled" label="按任务配置 $1 世界书" />
      <AcuHelpIconBtn
        v-model:open="helpOpen"
        panel-id="task-plot-worldbook-panel-help"
        label="按任务配置 $1 世界书说明"
      />
    </div>
    <AcuHelpPanel v-model:open="helpOpen" id="task-plot-worldbook-panel-help" label="按任务配置 $1 世界书说明">
      <p class="acu-notes acu-notes--sm" style="margin: 0">
        关闭时，所有含 <code>$1</code> 的任务均使用上方「$1 默认世界书」。开启后可按任务单独配置世界书与条目；仅当任务提示词含
        <code>$1</code> 时生效。副本族成员可在下方下拉框中选择（标记为
        <code>[副本]</code>），支持「沿用任务原本」以跟随副本族原本的世界书配置。触发扫描基底之一 = 最近 N 条 AI 楼，经与 $7 相同的「提取规则 / 排除规则」处理 + 提示词内已展开的
        <code v-pre>{{标签}}</code>（含
        <code>item@id</code> 完整标签块）+（提示词含 <code>$8</code> 时）过滤后的用户输入；触发后条目按酒馆位置/深度/顺序排列（对齐 shujuku）。
      </p>
    </AcuHelpPanel>
    <div v-show="enabled" class="acu-subsection">
      <div v-if="!tasks.length" class="acu-notes acu-notes--sm">暂无任务，请先在「任务」页添加任务。</div>
      <template v-else>
        <div class="acu-row">
          <label>配置任务</label>
          <select v-model="panelTaskId" class="acu-select" style="flex: 1">
            <option v-for="task in tasks" :key="task.id" :value="task.id">
              {{ taskOptionLabel(task) }}
            </option>
          </select>
        </div>
        <div class="acu-row acu-row--inline">
          <label><input v-model="taskPlotWorldbookMode" type="radio" value="inherit" /> 沿用预设默认</label>
          <label v-if="isReplicaMember">
            <input v-model="taskPlotWorldbookMode" type="radio" value="inheritRoot" /> 沿用任务原本
          </label>
          <label><input v-model="taskPlotWorldbookMode" type="radio" value="custom" /> 本任务自定义</label>
        </div>
        <PlotWorldbookSection
          v-if="taskPlotWorldbookMode === 'custom'"
          v-model:config="taskPlotWorldbookConfig"
          embedded
        />
      </template>
    </div>
  </div>
</template>
