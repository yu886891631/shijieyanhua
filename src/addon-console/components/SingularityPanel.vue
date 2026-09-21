<template>
  <section class="ac-section">
    <h2 class="ac-section-title">✦ 特异点</h2>
    <div class="ac-section-body">
      <div v-if="!items.length" class="ac-muted">当前世界暂无特异点条目</div>
      <div v-for="item in items" :key="item.name" class="ac-row">
        <div>
          <div class="ac-label">{{ item.name }}</div>
          <div class="ac-muted">{{ item.降临 ? '已降临（全局互斥）' : '未降临' }}</div>
        </div>
        <ToggleSwitch
          :model-value="item.降临"
          @update:model-value="emit('toggle', item.name, $event)"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import ToggleSwitch from './ToggleSwitch.vue';

defineProps<{
  items: Array<{ name: string; 降临: boolean }>;
}>();

const emit = defineEmits<{
  toggle: [name: string, value: boolean];
}>();
</script>
