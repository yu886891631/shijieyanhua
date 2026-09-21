<template>
  <div v-if="visible" id="brief-econ" class="ac-econ-page">
    <section v-if="climateVisible" class="ac-econ-block">
      <h4 class="ac-econ-block-title">
        <span class="ac-econ-block-icon" aria-hidden="true">🌡️</span>
        <span>世界经济气候</span>
      </h4>
      <div v-if="phase" class="ac-econ-summary">
        <span class="ac-econ-summary-label">整体周期相位</span>
        <span class="ac-econ-summary-value">{{ phase }}</span>
      </div>
      <div v-if="zones.length" class="ac-trade-regions-grid">
        <div v-for="[name, st] in zones" :key="name" class="ac-region-card">
          <div class="ac-region-name">{{ name }}</div>
          <div class="ac-region-status">{{ textOf(st?.状态) || '—' }}</div>
          <div class="ac-region-industry">产业：{{ textOf(st?.主导产业) || '—' }}</div>
          <div class="ac-region-industry">需求：{{ textOf(st?.需求品类) || '—' }}</div>
        </div>
      </div>
    </section>

    <section v-if="commodityVisible" class="ac-econ-block">
      <h4 class="ac-econ-block-title">
        <span class="ac-econ-block-icon" aria-hidden="true">📦</span>
        <span>大宗商品市场</span>
      </h4>
      <div class="ac-commodity-grid">
        <article
          v-for="item in commodityCards"
          :key="item.key"
          class="ac-commodity-card"
          :class="item.tone"
        >
          <header class="ac-commodity-head">
            <span class="ac-commodity-icon" aria-hidden="true">{{ item.icon }}</span>
            <h5 class="ac-commodity-name">{{ item.key }}</h5>
            <span
              v-if="item.supply"
              class="ac-supply-badge"
              :class="parseSupplyTone(item.supply)"
            >
              {{ item.supply }}
            </span>
            <ChangeBadge :value="item.trend" />
          </header>
          <p v-if="item.highlight" class="ac-commodity-detail">
            <span class="ac-commodity-detail-label">行情要点</span>
            {{ item.highlight }}
          </p>
          <p v-if="item.factor" class="ac-commodity-detail">
            <span class="ac-commodity-detail-label">主要影响因素</span>
            {{ item.factor }}
          </p>
        </article>
      </div>
    </section>

    <section v-if="moneyVisible" class="ac-econ-block">
      <h4 class="ac-econ-block-title">
        <span class="ac-econ-block-icon" aria-hidden="true">💱</span>
        <span>货币与金融</span>
      </h4>
      <div v-if="moneyMetrics.length" class="ac-econ-metrics">
        <div v-for="m in moneyMetrics" :key="m.label" class="ac-econ-metric">
          <div class="ac-econ-metric-label">{{ m.label }}</div>
          <div class="ac-econ-metric-value">{{ m.value }}</div>
        </div>
      </div>
      <div v-if="currencies.length" class="ac-currency-grid">
        <div v-for="[name, c] in currencies" :key="name" class="ac-currency-card">
          <div class="ac-currency-name">{{ name }}</div>
          <div class="ac-currency-rate-row">
            <div class="ac-currency-rate">{{ textOf(c?.汇率?.本期) || '—' }}</div>
            <ChangeBadge :value="c?.汇率?.涨跌" />
          </div>
          <div class="ac-currency-prev">上期 {{ textOf(c?.汇率?.上期) || '—' }}</div>
          <div v-if="textOf(c?.市场情绪)" class="ac-currency-meta">情绪：{{ textOf(c?.市场情绪) }}</div>
          <div v-if="textOf(c?.驱动因素)" class="ac-currency-meta">驱动：{{ textOf(c?.驱动因素) }}</div>
        </div>
      </div>
    </section>

    <section v-if="specVisible" class="ac-econ-block">
      <h4 class="ac-econ-block-title">
        <span class="ac-econ-block-icon" aria-hidden="true">📈</span>
        <span>投机市场</span>
      </h4>
      <div v-if="specMood || hasSpecIndex" class="ac-econ-summary">
        <template v-if="specMood">
          <span class="ac-econ-summary-label">市场情绪</span>
          <span class="ac-econ-summary-value">{{ specMood }}</span>
        </template>
        <span v-if="specMood && hasSpecIndex" class="ac-econ-summary-sep" aria-hidden="true">·</span>
        <template v-if="hasSpecIndex">
          <span class="ac-econ-summary-label">报</span>
          <span class="ac-econ-summary-value">{{ textOf(econ?.投机市场?.投机指数?.报) || '—' }}</span>
          <ChangeBadge :value="econ?.投机市场?.投机指数?.周涨跌" />
        </template>
      </div>
      <div v-if="specAssets.length" class="ac-spec-grid">
        <div v-for="[name, node] in specAssets" :key="name" class="ac-spec-card">
          <header class="ac-spec-head">
            <div class="ac-spec-title">{{ name }}</div>
            <span
              v-if="textOf(node?.交易热度)"
              class="ac-heat-badge"
              :class="parseHeatTone(node?.交易热度)"
              :title="'交易热度 ' + textOf(node?.交易热度)"
            >
              <span class="ac-heat-badge-mark" aria-hidden="true" />
              {{ formatHeatLabel(node?.交易热度) }}
            </span>
          </header>
          <div class="ac-currency-rate-row">
            <div class="ac-spec-price">{{ textOf(node?.当前价格) || '—' }}</div>
            <ChangeBadge :value="node?.涨跌" />
          </div>
          <div class="ac-currency-prev">上期 {{ textOf(node?.上期价格) || '—' }}</div>
          <div class="ac-spec-chips">
            <span v-if="textOf(node?.类型)" class="ac-spec-chip">{{ textOf(node?.类型) }}</span>
            <span v-if="textOf(node?.量能)" class="ac-spec-chip">量能 {{ textOf(node?.量能) }}</span>
          </div>
          <div v-if="textOf(node?.驱动事件)" class="ac-spec-meta">驱动：{{ textOf(node?.驱动事件) }}</div>
        </div>
      </div>
      <div v-if="futures.length" class="ac-futures-block">
        <div class="ac-futures-label">期货合约</div>
        <div class="ac-futures-grid">
          <article v-for="[name, node] in futures" :key="'f-' + name" class="ac-futures-card">
            <header class="ac-futures-head">
              <span class="ac-futures-badge" aria-hidden="true">期</span>
              <h5 class="ac-futures-name">{{ name }}</h5>
            </header>
            <div class="ac-futures-metrics">
              <div class="ac-futures-metric">
                <span class="ac-futures-metric-label">近月</span>
                <span class="ac-futures-metric-value">{{ textOf(node?.近月价格) || '—' }}</span>
              </div>
              <div class="ac-futures-metric">
                <span class="ac-futures-metric-label">远月</span>
                <span class="ac-futures-metric-value">{{ textOf(node?.远月价格) || '—' }}</span>
              </div>
              <div class="ac-futures-metric">
                <span class="ac-futures-metric-label">基差</span>
                <span class="ac-futures-metric-value">{{ textOf(node?.基差) || '—' }}</span>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section v-if="routes.length" class="ac-econ-block">
      <h4 class="ac-econ-block-title">
        <span class="ac-econ-block-icon" aria-hidden="true">🚢</span>
        <span>贸易格局</span>
      </h4>
      <div class="ac-trade-regions-grid">
        <div v-for="[name, st] in routes" :key="name" class="ac-region-card">
          <div class="ac-region-name">{{ name }}</div>
          <div class="ac-region-status">{{ textOf(st?.状态) }}</div>
          <div class="ac-region-industry">{{ textOf(st?.原因) }}</div>
        </div>
      </div>
    </section>

    <section v-if="policies.length" class="ac-econ-block">
      <h4 class="ac-econ-block-title">
        <span class="ac-econ-block-icon" aria-hidden="true">📜</span>
        <span>贸易政策</span>
      </h4>
      <div v-for="[k, v] in policies" :key="k" class="ac-timeline-node">
        <strong>{{ k }} · </strong>
        <span>{{ textOf(v) }}</span>
      </div>
    </section>

    <section v-if="econEvents.length" class="ac-econ-block">
      <h4 class="ac-econ-block-title">
        <span class="ac-econ-block-icon" aria-hidden="true">📰</span>
        <span>经济事件</span>
      </h4>
      <div
        v-for="[name, node] in econEvents"
        :key="name"
        class="ac-timeline-node"
      >
        <div class="ac-timeline-node-head">
          <strong>{{ name }}</strong>
        </div>
        <div v-if="textOf(node?.描述)" class="ac-timeline-node-line">{{ textOf(node?.描述) }}</div>
        <div class="ac-econ-event-tags">
          <span v-if="textOf(node?.影响维度)" class="ac-tag">📊 {{ textOf(node?.影响维度) }}</span>
          <StatusTag v-if="textOf(node?.当前态势)" :value="node?.当前态势" />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { entriesOf, formatHeatLabel, hasAnyText, isNonEmptyText, parseHeatTone, parseSupplyTone, textOf } from '../../brief-utils';
import ChangeBadge from './ChangeBadge.vue';
import StatusTag from './StatusTag.vue';

const props = defineProps<{ world: Record<string, any> | null }>();

const econ = computed(() => props.world?.世界经济简报 as Record<string, any> | undefined);
const phase = computed(() => textOf(econ.value?.世界经济气候?.整体周期相位).trim());
const zones = computed(() => entriesOf(econ.value?.世界经济气候?.主要贸易区状态));
const climateVisible = computed(() => isNonEmptyText(phase.value) || zones.value.length > 0);

type CommodityKey = '粮食' | '矿产' | '能源';

const COMMODITY_META: Record<CommodityKey, { icon: string; tone: string }> = {
  粮食: { icon: '🌾', tone: 'is-grain' },
  矿产: { icon: '⛏️', tone: 'is-ore' },
  能源: { icon: '⚡', tone: 'is-energy' },
};

const COMMODITY_FIELDS = ['供需', '行情要点', '价格趋势', '主要影响因素'] as const;

function hasCommodity(key: CommodityKey): boolean {
  return hasAnyText(econ.value?.大宗商品市场?.[key], [...COMMODITY_FIELDS]);
}

const commodityCards = computed(() =>
  (Object.keys(COMMODITY_META) as CommodityKey[])
    .filter(hasCommodity)
    .map(key => {
      const block = econ.value?.大宗商品市场?.[key] as Record<string, unknown> | undefined;
      const meta = COMMODITY_META[key];
      return {
        key,
        icon: meta.icon,
        tone: meta.tone,
        supply: textOf(block?.供需).trim(),
        trend: block?.价格趋势,
        highlight: textOf(block?.行情要点).trim(),
        factor: textOf(block?.主要影响因素).trim(),
      };
    }),
);

const commodityVisible = computed(() => commodityCards.value.length > 0);

const baseUnit = computed(() => textOf(econ.value?.货币与金融?.基准计价单位).trim());
const currencies = computed(() => entriesOf(econ.value?.货币与金融?.流通货币));
const moneyMetrics = computed(() => {
  const items: { label: string; value: string }[] = [];
  const fx = econ.value?.货币与金融?.汇率波动指数;
  const credit = econ.value?.货币与金融?.信贷环境;
  const fxRate = textOf(fx?.综合汇率波动率).trim();
  const fxFactor = textOf(fx?.主要影响因素).trim();
  const creditStatus = textOf(credit?.状态).trim();
  const creditRisk = textOf(credit?.金融机构风险).trim();
  if (baseUnit.value) items.push({ label: '基准计价单位', value: baseUnit.value });
  if (fxRate) items.push({ label: '综合汇率波动率', value: fxRate });
  if (fxFactor) items.push({ label: '主要影响因素', value: fxFactor });
  if (creditStatus) items.push({ label: '信贷状态', value: creditStatus });
  if (creditRisk) items.push({ label: '金融机构风险', value: creditRisk });
  return items;
});
const moneyVisible = computed(
  () => currencies.value.length > 0 || moneyMetrics.value.length > 0,
);

const specMood = computed(() => textOf(econ.value?.投机市场?.市场整体情绪).trim());
const specAssets = computed(() => entriesOf(econ.value?.投机市场?.主要交易标的));
const futures = computed(() => entriesOf(econ.value?.投机市场?.期货合约));
const hasSpecIndex = computed(() => hasAnyText(econ.value?.投机市场?.投机指数, ['报', '周涨跌']));
const specVisible = computed(
  () =>
    isNonEmptyText(specMood.value) ||
    specAssets.value.length > 0 ||
    futures.value.length > 0 ||
    hasSpecIndex.value,
);

const routes = computed(() => entriesOf(econ.value?.贸易格局?.主要商路));
const policies = computed(() => entriesOf(econ.value?.贸易格局?.贸易政策));

const econEvents = computed(() => entriesOf(econ.value?.经济事件));

const visible = computed(
  () =>
    climateVisible.value ||
    commodityVisible.value ||
    moneyVisible.value ||
    specVisible.value ||
    routes.value.length > 0 ||
    policies.value.length > 0 ||
    econEvents.value.length > 0,
);
</script>
