<template>
  <div class="currency-grid">
    <div v-for="(c, i) in currencies" :key="i" class="currency-card">
      <div class="cc-name">
        <template v-if="c.code">币种 {{ c.code }}</template>
        <span v-if="c.symbol" class="cc-sym">({{ c.symbol }})</span>
        <template v-if="!c.code && !c.symbol">币种</template>
      </div>
      <div class="cc-total">{{ metrics[i]?.total || '—' }}</div>
      <div
        v-if="metrics[i]?.change"
        class="cc-change"
        :class="metrics[i]?.changeDir"
      >
        Δ {{ metrics[i]?.change }}
      </div>
      <div class="cc-detail">{{ detail(c.text) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { parseCashMetrics } from '../parse';
import type { CurrencyBlock } from '../types';

const props = defineProps<{ currencies: CurrencyBlock[] }>();

const metrics = computed(() => props.currencies.map(c => parseCashMetrics(c.text)));

function detail(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}
</script>

<style lang="scss" scoped>
.currency-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  margin: 8px 0;
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 640px) {
  .currency-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .currency-card {
    padding: 10px;
    min-width: 0;

    &:hover {
      transform: none;
    }
  }

  .cc-total {
    font-size: 1.05rem;
  }
}

.currency-card {
  background: var(--bg-card-alt);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);

  &:hover {
    border-color: var(--border-accent);
    box-shadow: var(--shadow-sm);
    transform: translateY(-1px);
  }
}

.cc-name {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.4px;
}

.cc-sym {
  opacity: 0.65;
  margin-left: 0.2em;
}

.cc-total {
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--text-primary);
  border-bottom: 1px dashed var(--border-subtle);
  padding-bottom: 4px;
  font-variant-numeric: tabular-nums;
}

.cc-change {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 700;

  &.up {
    color: var(--accent-green);
  }
  &.down {
    color: var(--accent-red);
  }
  &.flat {
    color: var(--text-tertiary);
  }
}

.cc-detail {
  font-size: 0.62rem;
  color: var(--text-tertiary);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
</style>
