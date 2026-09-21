<template>
  <header v-if="worldName" class="ac-masthead" id="brief-masthead">
    <div class="ac-masthead-ornament" aria-hidden="true" />
    <div class="ac-masthead-main">
      <p class="ac-masthead-kicker">世界时局与经济简报</p>
      <h2 class="ac-masthead-title">{{ worldName }}</h2>
      <p class="ac-masthead-date">⏳ {{ date || '刊报日期未定' }}</p>
    </div>
    <div class="ac-masthead-badges">
      <span v-if="descent" class="ac-badge ac-badge-on">✦ 降临中</span>
      <span v-if="parallel" class="ac-badge ac-badge-parallel">◈ 平行演化</span>
      <span v-if="!descent && !parallel" class="ac-badge">观测外</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { textOf } from '../../brief-utils';

const props = defineProps<{
  worldName: string;
  world: Record<string, any> | null;
}>();

const date = computed(() => textOf(props.world?.刊报日期));
const descent = computed(() => props.world?.降临 === true);
const parallel = computed(() => props.world?.平行演化 === true);
</script>
