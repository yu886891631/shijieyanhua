<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    ariaLabel?: string;
    labelPosition?: 'before' | 'after';
  }>(),
  { label: '', labelPosition: 'after' },
);
const model = defineModel<boolean>({ required: true });
</script>

<template>
  <label class="acu-toggle">
    <input
      v-model="model"
      type="checkbox"
      class="acu-toggle__input"
      :aria-label="ariaLabel || label || undefined"
    />
    <span v-if="label && labelPosition === 'before'" class="acu-toggle__label">{{ label }}</span>
    <span class="acu-toggle__track" aria-hidden="true" />
    <span v-if="label && labelPosition === 'after'" class="acu-toggle__label">{{ label }}</span>
  </label>
</template>
