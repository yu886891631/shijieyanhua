<template>
  <BriefSection v-if="epics.length" id="brief-epic" icon="📜" title="史诗传奇">
    <div class="ac-sub-card" v-for="[name, node] in epics" :key="name">
      <div class="ac-epic-head">
        <div class="ac-sub-card-title" style="margin-bottom: 0">📜 {{ name }}</div>
        <StatusTag v-if="textOf(node?.基本类型)" :value="node?.基本类型" />
      </div>
      <div v-if="textOf(node?.核心母题关键词)" class="ac-timeline-node-line">
        母题：{{ textOf(node?.核心母题关键词) }}
      </div>
      <div v-if="textOf(node?.史实真相)" class="ac-timeline-node-meta">真相：{{ textOf(node?.史实真相) }}</div>
      <div v-if="textOf(node?.流变历程)" class="ac-timeline-node-meta">流变：{{ textOf(node?.流变历程) }}</div>

      <div v-if="entriesOf(node?.传世轶闻).length" class="ac-nested">
        <div class="ac-kv-key">传世轶闻</div>
        <div
          v-for="[tale, body] in entriesOf(node?.传世轶闻)"
          :key="tale"
          class="ac-timeline-node"
          :class="{ 'ac-event-completed': !!body?.原典 }"
        >
          <div class="ac-timeline-node-head">
            <strong>📖 {{ tale }}</strong>
            <StatusTag v-if="body?.原典" value="原典" />
            <span v-if="textOf(body?.版本成型时代)" class="ac-era-group-date">
              {{ textOf(body?.版本成型时代) }}
            </span>
          </div>
          <div v-if="textOf(body?.内容梗概)" class="ac-timeline-node-line">{{ textOf(body?.内容梗概) }}</div>
          <div v-if="textOf(body?.关键要素)" class="ac-timeline-node-meta">🔑 {{ textOf(body?.关键要素) }}</div>
          <div v-if="textOf(body?.版本流传范围)" class="ac-timeline-node-meta">
            📜 {{ textOf(body?.版本流传范围) }}
          </div>
        </div>
      </div>
    </div>
  </BriefSection>
</template>

<script setup lang="ts">
import { entriesOf, textOf } from '../../brief-utils';
import BriefSection from './BriefSection.vue';
import StatusTag from './StatusTag.vue';

const props = defineProps<{ world: Record<string, any> | null }>();
const epics = computed(() => entriesOf(props.world?.时代快讯?.史诗传奇));
</script>
