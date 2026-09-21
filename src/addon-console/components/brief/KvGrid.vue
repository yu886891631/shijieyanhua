<template>
  <div v-if="items.length" class="ac-kv-grid" :style="{ '--cols': String(cols) }">
    <div v-for="item in items" :key="item.key" class="ac-kv-cell">
      <div class="ac-kv-key">{{ item.key }}</div>
      <div class="ac-kv-val">{{ item.value }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { kvPairs } from '../../brief-utils';

const props = withDefaults(
  defineProps<{
    data?: unknown;
    labels?: string[];
    cols?: number;
  }>(),
  { data: undefined, labels: undefined, cols: 2 },
);

const items = computed(() => kvPairs(props.data, props.labels));
</script>
