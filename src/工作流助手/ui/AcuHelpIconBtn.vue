<script setup lang="ts">
defineProps<{
  panelId: string;
  label: string;
}>();

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <button
    type="button"
    class="acu-help-icon-btn"
    :aria-expanded="open"
    :aria-controls="panelId"
    :title="label"
    :aria-label="label"
    @click="open = !open"
  >
    <i class="fa-fw fa-solid fa-circle-question" aria-hidden="true"></i>
  </button>
</template>
