<template>
  <BriefSection v-if="visible" id="brief-era" icon="🕰️" title="世界时代阶段">
    <div v-if="stageName" class="ac-era-badge">
      <span class="ac-era-badge-dot" aria-hidden="true" />
      🕰️ 当前时代 · {{ stageName }}
    </div>
    <div v-if="features.length" class="ac-stat-list">
      <div v-for="item in features" :key="item.key" class="ac-stat-item">
        <span class="ac-stat-icon" aria-hidden="true">{{ eraFieldIcon(item.key) }}</span>
        <span class="ac-stat-label">{{ item.key }}:</span>
        <span class="ac-stat-value">{{ item.value }}</span>
      </div>
    </div>
    <div v-else class="ac-muted">📜 时代特征数据待填充</div>
  </BriefSection>
</template>

<script setup lang="ts">
import { eraFieldIcon, hasAnyText, kvPairs, textOf } from '../../brief-utils';
import BriefSection from './BriefSection.vue';

const props = defineProps<{ world: Record<string, any> | null }>();

const featureLabels = [
  '核心社会组织形式',
  '主流世界观与思潮',
  '主要经济模式',
  '技术特征',
  '主导性能源与动力',
  '关键材料标志',
  '社会阶级结构',
  '生产力与生产关系矛盾',
  '世界秩序格局',
];

const stage = computed(() => props.world?.时代快讯?.世界时代阶段);
const stageName = computed(() => textOf(stage.value?.时代阶段).trim());
const features = computed(() => kvPairs(stage.value, featureLabels));
const visible = computed(
  () => !!stageName.value || hasAnyText(stage.value, featureLabels),
);
</script>
