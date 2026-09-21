<template>
  <BriefSection v-if="visible" id="brief-factions" icon="🏛️" title="团体动态">
    <div v-if="worldFactions.length" class="ac-sub-stack">
      <h4 class="ac-brief-subh">🌐 世界背景团体</h4>
      <div class="ac-plot-card-stack">
        <FactionCard v-for="[name, node] in worldFactions" :key="name" :name="name" :node="node" />
      </div>
    </div>

    <div v-if="regionFactions.length" class="ac-sub-stack">
      <h4 class="ac-brief-subh">📍 当前区域团体</h4>
      <div class="ac-plot-card-stack">
        <FactionCard v-for="[name, node] in regionFactions" :key="name" :name="name" :node="node" />
      </div>
    </div>
  </BriefSection>
</template>

<script setup lang="ts">
import { entriesOf } from '../../brief-utils';
import BriefSection from './BriefSection.vue';
import FactionCard from './FactionCard.vue';

const props = defineProps<{ world: Record<string, any> | null }>();
const factions = computed(() => props.world?.世界剧情态势?.团体动态);
const worldFactions = computed(() => entriesOf(factions.value?.世界背景团体));
const regionFactions = computed(() => entriesOf(factions.value?.当前区域团体));
const visible = computed(() => worldFactions.value.length > 0 || regionFactions.value.length > 0);
</script>
