<template>
  <span v-if="label" class="ac-change" :class="tone">{{ label }}</span>
</template>

<script setup lang="ts">
import { parseChangeTone, textOf } from '../../brief-utils';

const props = defineProps<{ value?: unknown }>();
const label = computed(() => textOf(props.value).trim());
const tone = computed(() => parseChangeTone(props.value));
</script>
