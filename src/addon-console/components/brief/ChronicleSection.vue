<template>
  <BriefSection v-if="visible" id="brief-chronicle" icon="🍂" title="岁月史书">
    <div v-if="official.length" class="ac-sub-stack">
      <div class="ac-sub-card">
        <div class="ac-sub-card-title">📖 正史演变</div>
        <div
          v-for="[name, node] in official"
          :key="name"
          class="ac-timeline-node"
          :class="{ 'ac-event-completed': isCompletedOutcome(node?.历史影响 || node?.描述) }"
        >
          <div class="ac-timeline-node-head">
            <strong>📖 {{ name }}</strong>
            <span v-if="dateRange(node)" class="ac-era-group-date">{{ dateRange(node) }}</span>
            <StatusTag
              v-if="eraShift(node)"
              :value="eraShift(node)"
            />
          </div>
          <div v-if="textOf(node?.描述)" class="ac-timeline-node-line">{{ textOf(node?.描述) }}</div>
          <div v-if="textOf(node?.关键转折)" class="ac-timeline-node-meta">🔑 {{ textOf(node?.关键转折) }}</div>
          <div v-if="textOf(node?.历史影响)" class="ac-timeline-node-meta">📜 {{ textOf(node?.历史影响) }}</div>
        </div>
      </div>
    </div>

    <div v-if="sings.length" class="ac-sub-stack">
      <div class="ac-sub-card">
        <div class="ac-sub-card-title">✦ 特异点</div>
        <FoldBlock
          v-for="[name, node] in sings"
          :key="name"
          :title="name"
          :badge="node?.降临 ? '降临中' : ''"
          :badge-class="node?.降临 ? 'on' : ''"
          :summary="textOf(node?.分歧源头).slice(0, 48)"
          :default-open="!!node?.降临"
          :class="{ 'ac-sing-active': node?.降临 }"
        >
          <div v-if="node?.降临" class="ac-inline-note">当前特异点已降临</div>
          <KvGrid :data="node" :labels="['分歧源头']" :cols="1" />
          <div v-if="entriesOf(node?.事件记录).length" class="ac-nested">
            <div class="ac-kv-key">分歧纪段</div>
            <div
              v-for="[ev, body] in entriesOf(node?.事件记录)"
              :key="ev"
              class="ac-timeline-node"
            >
              <div class="ac-timeline-node-head">
                <strong>📖 {{ ev }}</strong>
                <span v-if="textOf(body?.纪段起止)" class="ac-era-group-date">{{ textOf(body?.纪段起止) }}</span>
              </div>
              <div v-if="textOf(body?.描述)" class="ac-timeline-node-line">{{ textOf(body?.描述) }}</div>
              <div v-if="textOf(body?.关键转折)" class="ac-timeline-node-meta">🔑 {{ textOf(body?.关键转折) }}</div>
              <div v-if="textOf(body?.历史影响)" class="ac-timeline-node-meta">📜 {{ textOf(body?.历史影响) }}</div>
            </div>
          </div>
        </FoldBlock>
      </div>
    </div>
  </BriefSection>
</template>

<script setup lang="ts">
import { entriesOf, isCompletedOutcome, textOf } from '../../brief-utils';
import BriefSection from './BriefSection.vue';
import FoldBlock from './FoldBlock.vue';
import KvGrid from './KvGrid.vue';
import StatusTag from './StatusTag.vue';

const props = defineProps<{ world: Record<string, any> | null }>();

const book = computed(() => props.world?.时代快讯?.岁月史书);
const official = computed(() => entriesOf(book.value?.正史));
const sings = computed(() => entriesOf(book.value?.特异点));
const visible = computed(() => official.value.length > 0 || sings.value.length > 0);

function dateRange(node: any): string {
  return textOf(node?.演变起止).trim();
}

function eraShift(node: any): string {
  const a = textOf(node?.前时代称谓).trim();
  const b = textOf(node?.后时代称谓).trim();
  if (a && b) return `${a} → ${b}`;
  return a || b;
}
</script>
