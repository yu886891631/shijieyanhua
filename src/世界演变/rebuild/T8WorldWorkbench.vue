<template>
  <section class="we-t8-world">
    <nav aria-label="模拟工作台页面">
      <button type="button" :aria-pressed="page === 'world'" @click="page = 'world'">资料与提示词</button
      ><button type="button" :aria-pressed="page === 'macro'" @click="page = 'macro'">宏观演算</button>
    </nav>
    <p>只切换内存视图，不自动保存或调用真实 API。</p>
    <T7WorldWorkbench v-show="page === 'world'" :data="data" :structure="structure" :generation="generation" />
    <T8MacroWorkbench v-show="page === 'macro'" :controller="macro" />
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { T5Workbench } from './t5-workbench';
import type { T6Workbench } from './t6-workbench';
import type { T7Workbench } from './t7-workbench';
import type { T8Control } from './t8-control';
import T7WorldWorkbench from './T7WorldWorkbench.vue';
import T8MacroWorkbench from './T8MacroWorkbench.vue';
defineProps<{ data: T5Workbench; structure: T6Workbench; generation: T7Workbench; macro: T8Control }>();
const page = ref<'world' | 'macro'>('world');
</script>
<style scoped>
.we-t8-world {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--we14-text, #294f3c);
}
nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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
