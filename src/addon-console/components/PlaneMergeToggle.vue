<template>
  <section class="ac-section">
    <h2 class="ac-section-title">🔀 位面交汇</h2>
    <div class="ac-section-body">
      <div class="ac-row">
        <div>
          <div class="ac-label">启用位面交汇</div>
          <div class="ac-muted">默认关闭；写入 addon_data.位面交汇，不对 AI 可见</div>
        </div>
        <ToggleSwitch :model-value="value" @update:model-value="emit('update:value', $event)" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import ToggleSwitch from './ToggleSwitch.vue';

defineProps<{ value: boolean }>();
const emit = defineEmits<{ 'update:value': [boolean] }>();
</script>
