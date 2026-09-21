<template>
  <BriefSection v-if="visible" id="brief-dynamics" icon="🌊" title="世界时局演进动态">
    <div v-if="drive" class="ac-prose-block">
      <div class="ac-kv-key">演进驱动力</div>
      <div class="ac-prose">{{ drive }}</div>
    </div>
    <div v-if="gap" class="ac-prose-block">
      <div class="ac-kv-key">时代差格局</div>
      <div class="ac-prose">{{ gap }}</div>
    </div>

    <div v-if="potentials.length" class="ac-sub-stack">
      <div class="ac-sub-card">
        <div class="ac-sub-card-title">🌱 潜在时代演化</div>
        <EraGroupCard
          v-for="[name, node] in potentials"
          :key="name"
          :name="name"
          :node="node"
          variant="potential"
          :has-children="entriesOf(node?.已完结转折点事件影响).length > 0"
        >
          <div class="ac-sub-item-block">
            <div class="ac-sub-item-title">⚡ 已完结转折事件</div>
            <div class="ac-era-event-list">
              <EraEventRow
                v-for="[ev, body] in entriesOf(node?.已完结转折点事件影响)"
                :key="ev"
                :title="ev"
                :body="body"
                variant="completed"
              />
            </div>
          </div>
        </EraGroupCard>
      </div>
    </div>

    <div v-if="turning.length" class="ac-sub-stack">
      <div class="ac-sub-card">
        <div class="ac-sub-card-title">⚡ 时代关键转折点</div>
        <EraGroupCard
          v-for="[name, node] in turning"
          :key="name"
          :name="name"
          :node="node"
          variant="twist"
          :has-children="entriesOf(node?.事件脉络).length > 0"
          :default-open="!!node?.临界事件"
        >
          <div class="ac-sub-item-block">
            <div class="ac-sub-item-title">🔗 事件脉络</div>
            <div class="ac-era-event-list">
              <EraEventRow
                v-for="[ev, body] in entriesOf(node?.事件脉络)"
                :key="ev"
                :title="ev"
                :body="body"
                variant="timeline"
              />
            </div>
          </div>
        </EraGroupCard>
      </div>
    </div>
  </BriefSection>
</template>

<script setup lang="ts">
import { entriesOf, isNonEmptyText, textOf } from '../../brief-utils';
import BriefSection from './BriefSection.vue';
import EraEventRow from './EraEventRow.vue';
import EraGroupCard from './EraGroupCard.vue';

const props = defineProps<{ world: Record<string, any> | null }>();

const dyn = computed(() => props.world?.时代快讯?.世界时局演进动态);
const drive = computed(() => textOf(dyn.value?.演进驱动力).trim());
const gap = computed(() => textOf(dyn.value?.时代差格局).trim());
const potentials = computed(() => entriesOf(dyn.value?.潜在时代演化));
const turning = computed(() => entriesOf(dyn.value?.时代关键转折点));
const visible = computed(
  () =>
    isNonEmptyText(drive.value) ||
    isNonEmptyText(gap.value) ||
    potentials.value.length > 0 ||
    turning.value.length > 0,
);
</script>
