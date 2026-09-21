<template>
  <div class="ac-brief">
    <template v-if="!world">
      <div class="ac-hint">📜 请选择世界以查看简报</div>
    </template>
    <template v-else>
      <div class="ac-brief-scroll">
        <div v-show="briefPage === 'era'" class="ac-brief-page">
          <EraStageSection :world="world" />
          <EraDynamicsSection :world="world" />
          <ChronicleSection :world="world" />
          <EpicSection :world="world" />
        </div>

        <div v-show="briefPage === 'plot'" class="ac-brief-page">
          <PlotEventsSection :world="world" />
          <FactionsSection :world="world" />
        </div>

        <div v-show="briefPage === 'social'" class="ac-brief-page">
          <SocialCirclesSection :circles="socialCircles" />
        </div>

        <div v-show="briefPage === 'econ'" class="ac-brief-page">
          <EconomySection :world="world" />
        </div>

        <p class="ac-brief-foot">✧ 星穹档案馆编撰 · 帝国天文台印制 ✧</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import ChronicleSection from './brief/ChronicleSection.vue';
import EconomySection from './brief/EconomySection.vue';
import EpicSection from './brief/EpicSection.vue';
import EraDynamicsSection from './brief/EraDynamicsSection.vue';
import EraStageSection from './brief/EraStageSection.vue';
import FactionsSection from './brief/FactionsSection.vue';
import PlotEventsSection from './brief/PlotEventsSection.vue';
import SocialCirclesSection from './brief/SocialCirclesSection.vue';

export type BriefPage = 'era' | 'plot' | 'social' | 'econ';

defineProps<{
  world: Record<string, any> | null;
  worldName: string;
  briefPage: BriefPage;
  socialCircles?: Record<string, any> | null;
}>();
</script>
