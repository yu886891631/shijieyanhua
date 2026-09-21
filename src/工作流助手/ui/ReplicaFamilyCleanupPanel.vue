<script setup lang="ts">
import { computed } from 'vue';
import type { ScriptSettings } from '../tasks/schema';
import { ensureReplicaFamilyCleanupDefaults } from '../tasks/replica-family-cleanup';
import AcuToggle from './AcuToggle.vue';
import AcuHelpPanel from './AcuHelpPanel.vue';
import AcuHelpIconBtn from './AcuHelpIconBtn.vue';

const settings = defineModel<ScriptSettings>('settings', { required: true });

const helpOpen = defineModel<boolean>('helpOpen', { default: false });

const cleanup = computed(() => ensureReplicaFamilyCleanupDefaults(settings.value));
</script>

<template>
  <div class="acu-section replica-cleanup-panel">
    <div class="acu-heading-with-help">
      <h4>副本族清理</h4>
      <AcuHelpIconBtn
        v-model:open="helpOpen"
        panel-id="replica-cleanup-help"
        label="副本族清理说明"
      />
    </div>
    <AcuHelpPanel v-model:open="helpOpen" id="replica-cleanup-help" label="副本族清理说明">
      <p class="acu-notes acu-notes--sm" style="margin-top: 0">
        每隔 N 轮对话触发一次清理。按动态属性规格（同
        spec）统一计算：同
        attr 在所有声明该规格的副本族中一起保留或一起删除。活跃性：本周期调度放行（试过）次数 ≥
        「最少试过次数」（默认 1）视为活跃；设为 0 则关闭活跃过滤。本周期已进可运行名单但仅因间隔/时间未到而未跑，仍视为有效。跳过标签或执行失败仍算试过。成功执行次数仅作展示。
      </p>
      <p class="acu-notes acu-notes--sm" style="margin-bottom: 0">
        自动清理：仅按「已启动 + 活跃」静默保留，不沿用上次手动勾选。手动清理：工作流完成后弹出选择窗（按
        spec 分栏、属性值去重）。默认勾选：手动调度已启动、活跃、或上次手动确认保留的属性值；确认后保留所选属性值及其
        post_process_tags；跳过本次不执行清理。
      </p>
    </AcuHelpPanel>
    <div class="replica-cleanup-panel__controls acu-row acu-row--inline">
      <AcuToggle v-model="cleanup.enabled" label="启用清理周期" />
      <div class="replica-cleanup-panel__cycle-field">
        <label class="acu-field-label">清理周期 N</label>
        <input
          v-model.number="cleanup.cycleRounds"
          class="acu-input"
          type="number"
          min="1"
          step="1"
          style="width: 72px"
          :disabled="!cleanup.enabled"
        />
      </div>
      <div class="replica-cleanup-panel__cycle-field">
        <label class="acu-field-label">最少试过次数</label>
        <input
          v-model.number="cleanup.minActivityTries"
          class="acu-input"
          type="number"
          min="0"
          step="1"
          style="width: 72px"
          :disabled="!cleanup.enabled"
        />
      </div>
    </div>
    <div v-if="cleanup.enabled" class="replica-cleanup-panel__mode">
      <label class="replica-scheduler__mode-option">
        <input v-model="cleanup.mode" type="radio" value="auto" />
        <span>自动清理</span>
      </label>
      <label class="replica-scheduler__mode-option">
        <input v-model="cleanup.mode" type="radio" value="manual" />
        <span>手动清理</span>
      </label>
    </div>
  </div>
</template>
