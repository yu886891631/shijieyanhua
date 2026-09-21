<template>
  <article class="ac-plot-card ac-rumor-card">
    <header class="ac-plot-card-head">
      <h5 class="ac-plot-card-title">💬 {{ name }}</h5>
      <div class="ac-chip-row">
        <span v-if="influence" class="ac-tag" :class="influenceClass">{{ influence }}</span>
        <span v-if="scope" class="ac-meta-chip">📍 {{ scope }}</span>
      </div>
    </header>

    <div v-if="history.length" class="ac-plot-timeline">
      <div class="ac-kv-key">流变历程</div>
      <div v-for="[step, body] in history" :key="step" class="ac-timeline-node">
        <div class="ac-timeline-node-head">
          <strong>{{ step }}</strong>
          <span v-if="textOf(body?.流变日期)" class="ac-era-group-date">{{ textOf(body?.流变日期) }}</span>
          <span v-if="textOf(body?.预计时效)" class="ac-meta-chip">至 {{ textOf(body?.预计时效) }}</span>
        </div>
        <div v-if="textOf(body?.传闻描述)" class="ac-timeline-node-line">{{ textOf(body?.传闻描述) }}</div>
        <div v-if="textOf(body?.真相)" class="ac-timeline-node-meta">真相：{{ textOf(body?.真相) }}</div>
        <div v-if="textOf(body?.事实偏差)" class="ac-timeline-node-meta">偏差：{{ textOf(body?.事实偏差) }}</div>
        <div v-if="textOf(body?.流变诱因)" class="ac-timeline-node-meta">诱因：{{ textOf(body?.流变诱因) }}</div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { getInfluenceClass, textOf, timelineEntries } from '../../brief-utils';

const props = defineProps<{
  name: string;
  node?: Record<string, any> | null;
}>();

const influence = computed(() => textOf(props.node?.影响力).trim());
const influenceClass = computed(() => getInfluenceClass(props.node?.影响力));
const scope = computed(() => textOf(props.node?.流传范围).trim());
const history = computed(() => timelineEntries(props.node?.流变历程));
</script>
