<template>
  <div class="ac-era-group" :class="variant === 'twist' ? 'ac-twist-group' : 'ac-potential-group'">
    <button
      type="button"
      class="ac-era-group-head"
      :class="{ 'no-children': !hasChildren }"
      :aria-expanded="hasChildren ? open : undefined"
      @click="toggle"
    >
      <span v-if="hasChildren" class="ac-fold-arrow" :class="{ collapsed: !open }" aria-hidden="true">▾</span>
      <div class="ac-era-group-main">
        <div class="ac-era-group-title-row">
          <strong class="ac-era-group-name">📌 {{ name }}</strong>
          <StatusTag :value="statusLabel" :force-critical="critical" />
          <span v-if="startDate" class="ac-era-group-date">📅始于 {{ startDate }}</span>
        </div>
        <div v-if="desc" class="ac-era-group-desc">{{ desc }}</div>
        <ProgressBar
          :value="progress"
          :label="progressLabel"
          :critical="isCritical"
          :show-zero="true"
        />
        <div v-if="push || inhibit" class="ac-force-row">
          <span v-if="push">🚀 {{ push }}</span>
          <span v-if="inhibit">🛡️ {{ inhibit }}</span>
        </div>
        <div v-if="extraLine" class="ac-era-group-extra">{{ extraLine }}</div>
      </div>
    </button>
    <div v-show="hasChildren && open" class="ac-era-group-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { isCriticalStatus, textOf } from '../../brief-utils';
import ProgressBar from './ProgressBar.vue';
import StatusTag from './StatusTag.vue';

const props = withDefaults(
  defineProps<{
    name: string;
    node?: Record<string, any> | null;
    variant?: 'potential' | 'twist';
    hasChildren?: boolean;
    defaultOpen?: boolean;
  }>(),
  { node: null, variant: 'potential', hasChildren: false, defaultOpen: false },
);

const open = ref(props.defaultOpen);

const critical = computed(() => props.node?.临界事件 === true);
const statusLabel = computed(() => {
  if (critical.value) return textOf(props.node?.状态).trim() || '临界';
  return textOf(props.node?.状态).trim();
});
const isCritical = computed(() => critical.value || isCriticalStatus(statusLabel.value));

const startDate = computed(() =>
  textOf(props.node?.开始日期 || props.node?.演化开始日期).trim(),
);
const desc = computed(() => textOf(props.node?.描述).trim());
const progress = computed(() => props.node?.进度);
const progressLabel = computed(() => (props.variant === 'twist' ? '转折进度' : '演化进度'));

const push = computed(() =>
  textOf(props.node?.推动因子 || props.node?.推动 || props.node?.干预态势?.推动力).trim(),
);
const inhibit = computed(() =>
  textOf(
    props.node?.抑止因子 || props.node?.抑制因子 || props.node?.抑制 || props.node?.干预态势?.抑止力,
  ).trim(),
);

const extraLine = computed(() => {
  if (props.variant !== 'twist') return '';
  const linked = textOf(props.node?.关联潜在时代).trim();
  const impact = textOf(props.node?.总体影响).trim();
  return [linked && `关联：${linked}`, impact && `影响：${impact}`].filter(Boolean).join(' · ');
});

function toggle() {
  if (!props.hasChildren) return;
  open.value = !open.value;
}
</script>
