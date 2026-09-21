<template>
  <section v-if="show" class="ac-section-card" :id="id || undefined">
    <div class="ac-section-head">
      <span v-if="icon" class="ac-section-head-icon" aria-hidden="true">{{ icon }}</span>
      <span class="ac-section-head-text">{{ title }}</span>
    </div>
    <div class="ac-section-body-pad">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    id?: string;
    show?: boolean;
  }>(),
  { icon: '', id: '', show: true },
);
</script>
