<template>
  <section class="we-t6-world">
    <nav aria-label="世界资料子页">
      <button type="button" :aria-pressed="page === 'data'" @click="page = 'data'">数据填写</button
      ><button type="button" :aria-pressed="page === 'structure'" @click="page = 'structure'">结构与参数</button>
    </nav>
    <p>
      两页共用{{
        hostMode ? '当前聊天的世界资料' : '当前模拟世界'
      }}；资料草稿与结构草稿不能混写。切页不保存，不丢弃；关闭或刷新会丢失未保存草稿。
    </p>
    <T5TableWorkbench v-show="page === 'data'" :workbench="data" :host-mode="hostMode" />
    <T6TemplateWorkbench v-show="page === 'structure'" :workbench="structure" :host-mode="hostMode" />
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { T5Workbench } from './t5-workbench';
import type { T6Workbench } from './t6-workbench';
import T5TableWorkbench from './T5TableWorkbench.vue';
import T6TemplateWorkbench from './T6TemplateWorkbench.vue';
defineProps<{ data: T5Workbench; structure: T6Workbench; hostMode?: boolean }>();
const page = ref<'data' | 'structure'>('data');
</script>
<style scoped>
.we-t6-world {
  min-width: 0;
  color: var(--we14-text, #294f3c);
}
nav {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
button {
  padding: 8px 14px;
  background: var(--we14-soft, #e0efe3);
  color: var(--we14-text, #294f3c);
  border: 1px solid var(--we14-border, #a9c5b4);
  border-radius: 8px;
}
button[aria-pressed='true'] {
  background: var(--we14-accent, #397957);
  color: var(--we14-on-accent, #fff);
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 3px;
}
p {
  overflow-wrap: anywhere;
}
</style>
