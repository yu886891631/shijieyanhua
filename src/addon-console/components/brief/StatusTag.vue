<template>
  <span v-if="label" class="ac-tag" :class="statusClass">{{ label }}</span>
</template>

<script setup lang="ts">
import { getStatusClass, textOf } from '../../brief-utils';

const props = withDefaults(
  defineProps<{
    value?: unknown;
    forceCritical?: boolean;
  }>(),
  { value: '', forceCritical: false },
);

const label = computed(() => textOf(props.value).trim());
const statusClass = computed(() => {
  if (props.forceCritical) return 'status-critical';
  return getStatusClass(props.value);
});
</script>
