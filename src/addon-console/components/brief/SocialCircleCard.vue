<template>
  <article class="ac-faction-card ac-social-card">
    <header class="ac-plot-card-head">
      <h5 class="ac-plot-card-title">🕸️ {{ name }}</h5>
      <div class="ac-chip-row">
        <StatusTag v-if="nature" :value="nature" />
        <span v-if="frequency" class="ac-meta-chip">⏱ {{ frequency }}</span>
      </div>
    </header>

    <div v-if="infoScope" class="ac-faction-block">
      <div class="ac-kv-key">信息范围</div>
      <div class="ac-prose">{{ infoScope }}</div>
    </div>

    <div v-if="current" class="ac-faction-block">
      <div class="ac-kv-key">当前动态</div>
      <div class="ac-prose">{{ current }}</div>
    </div>

    <div v-if="description" class="ac-faction-block">
      <div class="ac-kv-key">描述</div>
      <div class="ac-prose">{{ description }}</div>
    </div>

    <div v-if="people || stars || group || overlap" class="ac-faction-split">
      <div v-if="people" class="ac-faction-panel">
        <div class="ac-kv-key">社群人脉</div>
        <div class="ac-prose">{{ people }}</div>
      </div>
      <div v-if="stars" class="ac-faction-panel">
        <div class="ac-kv-key">活跃角色</div>
        <div class="ac-prose">{{ stars }}</div>
      </div>
      <div v-if="group" class="ac-faction-panel">
        <div class="ac-kv-key">关联团体</div>
        <div class="ac-prose">{{ group }}</div>
      </div>
      <div v-if="overlap" class="ac-faction-panel">
        <div class="ac-kv-key">关联圈交集</div>
        <div class="ac-prose">{{ overlap }}</div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { textOf } from '../../brief-utils';
import StatusTag from './StatusTag.vue';

const props = defineProps<{
  name: string;
  node?: Record<string, any> | null;
}>();

function field(key: string): string {
  const raw = textOf(props.node?.[key]).trim();
  if (!raw || raw === '无') return '';
  return raw;
}

const nature = computed(() => field('性质'));
const frequency = computed(() => field('互动频率'));
const infoScope = computed(() => field('信息范围'));
const current = computed(() => field('当前动态'));
const description = computed(() => field('描述'));
const people = computed(() => field('社群人脉'));
const stars = computed(() => field('活跃角色'));
const group = computed(() => field('关联团体'));
const overlap = computed(() => field('关联圈交集'));
</script>
