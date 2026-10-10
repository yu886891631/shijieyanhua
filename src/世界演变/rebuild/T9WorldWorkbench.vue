<template>
  <section class="we-t9-world">
    <nav aria-label="模拟工作台页面">
      <button type="button" :aria-pressed="page === 'world'" @click="page = 'world'">资料与提示词</button
      ><button type="button" :aria-pressed="page === 'round'" @click="page = 'round'">整轮演变</button>
    </nav>
    <p>切换只改变视图；整轮模拟运行会统一保存到模拟存档，不写实际聊天或世界书。</p>
    <T7WorldWorkbench v-show="page === 'world'" :data="data" :structure="structure" :generation="generation" />
    <T9RoundWorkbench v-show="page === 'round'" :controller="round" />
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { T5Workbench } from './t5-workbench';
import type { T6Workbench } from './t6-workbench';
import type { T7Workbench } from './t7-workbench';
import type { T9Round } from './t9-round';
import T7WorldWorkbench from './T7WorldWorkbench.vue';
import T9RoundWorkbench from './T9RoundWorkbench.vue';
defineProps<{ data: T5Workbench; structure: T6Workbench; generation: T7Workbench; round: T9Round }>();
const page = ref<'world' | 'round'>('world');
</script>
<style scoped>
.we-t9-world {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--we14-text, #294f3c);
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
button {
  background: var(--we14-soft, #e0efe3);
  color: var(--we14-text, #294f3c);
  border: 1px solid var(--we14-border, #a9c5b4);
  border-radius: 8px;
  padding: 8px 12px;
}
button[aria-pressed='true'] {
  background: var(--we14-accent, #397957);
  color: var(--we14-on-accent, white);
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 3px;
}
</style>
