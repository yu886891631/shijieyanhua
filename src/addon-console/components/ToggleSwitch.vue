<template>
  <label class="ac-switch" :title="title">
    <input type="checkbox" :checked="modelValue" :disabled="disabled" @change="onChange" />
    <span />
  </label>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  title?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
}>();

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked);
}
</script>
