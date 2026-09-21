<template>
  <article class="ac-faction-card">
    <header class="ac-plot-card-head">
      <h5 class="ac-plot-card-title">🏛️ {{ name }}</h5>
      <div class="ac-chip-row">
        <StatusTag v-if="stance" :value="stance" />
        <span v-if="area" class="ac-meta-chip">📍 {{ area }}</span>
      </div>
    </header>

    <div v-if="politics" class="ac-faction-block">
      <div class="ac-kv-key">内政概况</div>
      <div class="ac-prose">{{ politics }}</div>
    </div>
    <div v-if="current" class="ac-faction-block">
      <div class="ac-kv-key">当前动态</div>
      <div class="ac-prose">{{ current }}</div>
    </div>

    <div v-if="hasReputation" class="ac-faction-block">
      <div class="ac-kv-key">声誉</div>
      <div class="ac-reputation-grid">
        <div v-for="item in reputationItems" :key="item.key" class="ac-reputation-cell">
          <div class="ac-reputation-label">{{ item.key }}</div>
          <div class="ac-reputation-value">{{ item.value }}</div>
        </div>
      </div>
    </div>

    <div v-if="pillars.length || diplomacy.length" class="ac-faction-split">
      <div v-if="pillars.length" class="ac-faction-panel">
        <div class="ac-kv-key">权力支柱</div>
        <div v-for="[k, v] in pillars" :key="k" class="ac-timeline-node">
          <strong>{{ k }} · </strong>
          <span>{{ textOf(v) }}</span>
        </div>
      </div>
      <div v-if="diplomacy.length" class="ac-faction-panel">
        <div class="ac-kv-key">外交关系</div>
        <div v-for="[k, v] in diplomacy" :key="k" class="ac-timeline-node">
          <strong>{{ k }} · </strong>
          <span>{{ textOf(v) }}</span>
        </div>
      </div>
    </div>

    <div v-if="people.length" class="ac-faction-block">
      <div class="ac-kv-key">核心人物</div>
      <div class="ac-people-grid">
        <div v-for="[pname, pbody] in people" :key="pname" class="ac-person-card">
          <div class="ac-person-name">{{ pname }}</div>
          <div v-if="textOf((pbody as any)?.身份职务)" class="ac-person-role">
            {{ textOf((pbody as any)?.身份职务) }}
          </div>
          <div v-if="personPillars(pbody).length" class="ac-person-pillars">
            <div v-for="[k, v] in personPillars(pbody)" :key="k" class="ac-timeline-node-meta">
              <strong>{{ k }}</strong> · {{ textOf(v) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { entriesOf, isNonEmptyText, textOf } from '../../brief-utils';
import StatusTag from './StatusTag.vue';

const props = defineProps<{
  name: string;
  node?: Record<string, any> | null;
}>();

const stance = computed(() => textOf(props.node?.发展态势).trim());
const area = computed(() => textOf(props.node?.活跃区域).trim());
const politics = computed(() => textOf(props.node?.内政概况).trim());
const current = computed(() => textOf(props.node?.当前动态).trim());

const reputationItems = computed(() => {
  const rep = props.node?.声誉;
  if (!rep || typeof rep !== 'object') return [] as { key: string; value: string }[];
  return ['官方', '民间', '暗域', '业界']
    .filter(k => isNonEmptyText((rep as any)[k]))
    .map(k => ({ key: k, value: textOf((rep as any)[k]) }));
});
const hasReputation = computed(() => reputationItems.value.length > 0);

const pillars = computed(() => entriesOf(props.node?.权力支柱));
const diplomacy = computed(() => entriesOf(props.node?.外交关系));
const people = computed(() => entriesOf(props.node?.核心人物));

function personPillars(pbody: unknown): [string, any][] {
  return entriesOf((pbody as any)?.权力支柱);
}
</script>
