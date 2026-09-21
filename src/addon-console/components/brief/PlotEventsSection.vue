<template>
  <BriefSection v-if="visible" id="brief-plot" icon="⚔️" title="时局动态">
    <div v-if="worldEvents.length" class="ac-sub-stack">
      <h4 class="ac-brief-subh">🌐 世界背景事件</h4>
      <div class="ac-plot-card-stack">
        <PlotEventCard v-for="[name, node] in worldEvents" :key="name" :name="name" :node="node" />
      </div>
    </div>

    <div v-if="regionEvents.length" class="ac-sub-stack">
      <h4 class="ac-brief-subh">📍 当前区域事件</h4>
      <div class="ac-plot-card-stack">
        <PlotEventCard v-for="[name, node] in regionEvents" :key="name" :name="name" :node="node" />
      </div>
    </div>

    <div v-if="rumors.length" class="ac-sub-stack">
      <h4 class="ac-brief-subh">💬 传闻</h4>
      <div class="ac-plot-card-stack">
        <RumorCard v-for="[name, node] in rumors" :key="name" :name="name" :node="node" />
      </div>
    </div>
  </BriefSection>
</template>

<script setup lang="ts">
import { entriesOf } from '../../brief-utils';
import BriefSection from './BriefSection.vue';
import PlotEventCard from './PlotEventCard.vue';
import RumorCard from './RumorCard.vue';

const props = defineProps<{ world: Record<string, any> | null }>();
const plot = computed(() => props.world?.世界剧情态势?.时局动态);
const worldEvents = computed(() => entriesOf(plot.value?.世界背景事件));
const regionEvents = computed(() => entriesOf(plot.value?.当前区域事件));
const rumors = computed(() => entriesOf(plot.value?.传闻));
const visible = computed(
  () => worldEvents.value.length > 0 || regionEvents.value.length > 0 || rumors.value.length > 0,
);
</script>
