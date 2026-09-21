<template>
  <article
    v-if="visible"
    class="ac-timeline-node ac-era-event-row"
    :class="[variantClass, props.variant === 'completed' ? 'ac-event-completed' : '']"
  >
    <div class="ac-era-event-head">
      <strong v-if="showTitle" class="ac-era-event-title">{{ displayTitle }}</strong>
      <div v-if="metaChips.length" class="ac-era-event-meta">
        <span v-for="chip in metaChips" :key="chip" class="ac-era-event-chip">{{ chip }}</span>
      </div>
    </div>
    <div v-if="mainText" class="ac-timeline-node-line">{{ mainText }}</div>
    <div v-if="impactText" class="ac-timeline-node-meta">{{ impactText }}</div>
    <div v-if="extraText" class="ac-timeline-node-meta">{{ extraText }}</div>
  </article>
</template>

<script setup lang="ts">
import { isNonEmptyText, textOf } from '../../brief-utils';

const props = withDefaults(
  defineProps<{
    title: string;
    body?: Record<string, any> | null;
    /** timeline = 事件脉络；completed = 已完结转折事件 */
    variant?: 'timeline' | 'completed';
  }>(),
  { body: null, variant: 'timeline' },
);

const variantClass = computed(() =>
  props.variant === 'completed' ? 'ac-era-event-row--completed' : 'ac-era-event-row--timeline',
);

/** 纯数字键名（如 "1"）不展示，交给左侧节点表达顺序 */
const showTitle = computed(() => {
  const t = textOf(props.title).trim();
  if (!t) return false;
  if (/^\d+$/.test(t)) return false;
  return true;
});

const displayTitle = computed(() => textOf(props.title).trim());

const dateRange = computed(() => {
  if (props.variant === 'completed') {
    return textOf(props.body?.起止日期).trim();
  }
  const start = textOf(props.body?.开始日期).trim();
  const end = textOf(props.body?.结束日期).trim();
  if (start && end) return `${start} → ${end}`;
  return start || end;
});

const metaChips = computed(() => {
  const chips: string[] = [];
  if (dateRange.value) chips.push(dateRange.value);
  if (props.variant === 'timeline') {
    const dir = textOf(props.body?.干预方向).trim();
    const strength = textOf(props.body?.干预强度).trim();
    if (dir) chips.push(dir);
    if (strength) chips.push(strength);
  }
  return chips;
});

const mainText = computed(() => {
  if (props.variant === 'completed') {
    return textOf(props.body?.最终结局).trim();
  }
  return textOf(props.body?.描述).trim();
});

const impactText = computed(() => {
  if (props.variant === 'completed') {
    const impact = textOf(props.body?.时代影响).trim();
    return impact ? `📜 ${impact}` : '';
  }
  const impact = textOf(props.body?.影响).trim();
  return impact ? `📜 ${impact}` : '';
});

const extraText = computed(() => {
  if (props.variant !== 'completed') return '';
  const thread = textOf(props.body?.事件脉络).trim();
  return thread ? `🔗 ${thread}` : '';
});

const visible = computed(
  () =>
    showTitle.value ||
    isNonEmptyText(mainText.value) ||
    isNonEmptyText(impactText.value) ||
    isNonEmptyText(extraText.value) ||
    metaChips.value.length > 0,
);
</script>
