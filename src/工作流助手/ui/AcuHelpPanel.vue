<script setup lang="ts">
defineProps<{
  id: string;
  label: string;
}>();

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <div
    v-show="open"
    :id="id"
    class="acu-collapsible-help"
    role="region"
    :aria-label="label"
  >
    <slot />
  </div>
</template>
