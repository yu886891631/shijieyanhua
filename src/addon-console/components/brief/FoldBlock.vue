<template>
  <div class="ac-fold" :class="{ open }">
    <button type="button" class="ac-fold-head" :aria-expanded="open" @click="open = !open">
      <span class="ac-fold-arrow" aria-hidden="true">▾</span>
      <span class="ac-fold-title">{{ title }}</span>
      <span v-if="summary" class="ac-fold-summary">{{ summary }}</span>
      <span v-if="badge" class="ac-fold-badge" :class="badgeClass">{{ badge }}</span>
    </button>
    <div v-show="open" class="ac-fold-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string;
    summary?: string;
    badge?: string;
    badgeClass?: string;
    defaultOpen?: boolean;
  }>(),
  { summary: '', badge: '', badgeClass: '', defaultOpen: false },
);

const open = ref(props.defaultOpen);
</script>
