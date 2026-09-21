<template>
  <BriefSection id="brief-social-circles" icon="🕸️" title="角色社交圈">
    <div v-if="items.length" class="ac-plot-card-stack">
      <SocialCircleCard v-for="[name, node] in items" :key="name" :name="name" :node="node" />
    </div>
    <p v-else class="ac-hint ac-social-empty">暂无社交圈记录</p>
  </BriefSection>
</template>

<script setup lang="ts">
import { entriesOf } from '../../brief-utils';
import BriefSection from './BriefSection.vue';
import SocialCircleCard from './SocialCircleCard.vue';

const props = defineProps<{
  circles?: Record<string, any> | null;
}>();

const items = computed(() => entriesOf(props.circles));
</script>
