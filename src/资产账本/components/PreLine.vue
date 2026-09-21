<template>
  <div v-if="text" class="preline">{{ text }}</div>
</template>

<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<style lang="scss" scoped>
.preline {
  white-space: pre-line;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  line-height: 1.55;
  font-size: 0.82rem;
}
</style>
