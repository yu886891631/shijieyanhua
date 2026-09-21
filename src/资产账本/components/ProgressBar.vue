<template>
  <div v-if="info.pct > 0 || showZero" class="progress-wrap">
    <div class="progress-info">
      <span>{{ label }}</span>
      <span>{{ info.pct }}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" :class="info.tone" :style="{ width: `${info.pct}%` }" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { parseProgressPct } from '../parse';

const props = withDefaults(
  defineProps<{
    attrs: Record<string, string>;
    extraText?: string;
    label?: string;
    showZero?: boolean;
  }>(),
  {
    extraText: '',
    label: '进度',
    showZero: true,
  },
);

const info = computed(() => parseProgressPct(props.attrs, props.extraText));
</script>

<style lang="scss" scoped>
.progress-wrap {
  margin: 4px 0 8px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 0.68rem;
  color: var(--text-secondary);
  margin-bottom: 3px;
}

.progress-bar {
  height: 6px;
  border-radius: 8px;
  background: var(--bg-subtle);
  overflow: hidden;
}

@media (max-width: 640px) {
  .progress-bar {
    height: 8px;
  }

  .progress-info {
    font-size: 0.72rem;
  }
}

.progress-fill {
  height: 100%;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-teal), var(--accent-primary));
  background-size: 200% 100%;
  animation: ledger-shimmer 3s infinite;
  transition: width 0.7s;

  &.warn {
    background: linear-gradient(90deg, var(--accent-warm), #e0a060, var(--accent-warm));
    background-size: 200% 100%;
  }

  &.critical {
    background: linear-gradient(90deg, var(--accent-red), #e88070, var(--accent-red));
    background-size: 200% 100%;
    animation: ledger-shimmer 1.5s infinite;
  }
}
</style>
