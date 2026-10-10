<template>
  <section class="we-t7-world">
    <nav aria-label="模拟工作台页面">
      <button type="button" :aria-pressed="page === 'world'" @click="page = 'world'">世界资料</button
      ><button type="button" :aria-pressed="page === 'prompts'" @click="page = 'prompts'">提示词与发送预览</button>
    </nav>
    <p>页签只切换视图，保留当前内存草稿；不自动保存或发送。</p>
    <T6WorldWorkbench v-show="page === 'world'" :data="data" :structure="structure" />
    <T7PromptWorkbench v-show="page === 'prompts'" :workbench="generation" />
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { T5Workbench } from './t5-workbench';
import type { T6Workbench } from './t6-workbench';
import type { T7Workbench } from './t7-workbench';
import T6WorldWorkbench from './T6WorldWorkbench.vue';
import T7PromptWorkbench from './T7PromptWorkbench.vue';
defineProps<{ data: T5Workbench; structure: T6Workbench; generation: T7Workbench }>();
const page = ref<'world' | 'prompts'>('world');
</script>
<style scoped>
.we-t7-world {
  min-width: 0;
  color: var(--we14-text, #294f3c);
  overflow-wrap: anywhere;
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
  color: var(--we14-on-accent, #fff);
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 3px;
}
</style>
