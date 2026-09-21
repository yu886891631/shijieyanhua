<template>
  <div
    class="npc-card"
    :class="{ 'npc-card--empty': npc.empty, 'npc-card--open': expanded }"
  >
    <!-- 顶栏：可点击折叠；头像 + 名字 | 社会身份 | 箭头 -->
    <button
      type="button"
      class="npc-card-top"
      :class="{ 'npc-card-top--static': !hasBody }"
      :aria-expanded="hasBody ? expanded : undefined"
      :disabled="!hasBody"
      @click="toggleExpanded"
    >
      <div class="npc-avatar" aria-hidden="true">🌟</div>
      <div class="npc-name">
        <span class="npc-name-icon">💠</span>
        {{ npc.name }}
      </div>
      <div v-if="npc.socialIdentity.length" class="npc-identity-inline" title="社会身份">
        <span
          v-for="(id, i) in npc.socialIdentity"
          :key="'id' + i"
          class="npc-identity-tag"
        >{{ id }}</span>
      </div>
      <span v-else-if="npc.empty" class="npc-identity-empty">暂无行动数据</span>
      <span
        v-if="hasBody"
        class="npc-card-caret"
        :class="{ 'npc-card-caret--open': expanded }"
        aria-hidden="true"
      >▾</span>
    </button>

    <div v-show="expanded && hasBody" class="npc-card-body">
      <!-- 生命档案：紧凑标签行 -->
      <div v-if="lifeChips.length" class="npc-life-row" aria-label="生命档案">
        <span
          v-for="chip in lifeChips"
          :key="chip.key"
          class="npc-life-chip"
        >
          <span class="npc-life-k">{{ chip.label }}</span>
          <span class="npc-life-v">{{ chip.value }}</span>
        </span>
      </div>

      <!-- 社会档案：资金 + 声誉 -->
      <div v-if="npc.wealth || npc.reputation.length" class="npc-social-profile">
        <span v-if="npc.wealth" class="npc-wealth-tag" :class="wealthCls">
          {{ wealthEmoji }} {{ npc.wealth }}
        </span>
        <div v-if="npc.reputation.length" class="npc-rep-inline" title="声誉">
          <span
            v-for="(r, i) in npc.reputation"
            :key="'rep' + i"
            class="npc-chip npc-chip--rep"
            :class="getReputationClass(r.value)"
          >
            <template v-if="r.label">[{{ r.label }}]</template>{{ r.value }}
          </span>
        </div>
      </div>

      <!-- 行为链紧贴名字下方 -->
      <div v-if="npc.actionChain.length || npc.predict" class="npc-chain-section">
        <div class="chain-label">⚡ 行为链</div>
        <div class="chain-flow">
          <template v-for="(step, i) in npc.actionChain" :key="'a' + i">
            <span v-if="i > 0" class="chain-arrow">→</span>
            <span class="chain-step">{{ step }}</span>
          </template>
          <template v-if="npc.predict">
            <span class="chain-arrow">→</span>
            <span class="chain-predict">后续: {{ npc.predict }}</span>
          </template>
          <span v-if="npc.debutReady" class="chain-debut-tag">⚡准备登场</span>
        </div>
      </div>

      <!-- 当前状态：动作/穿着 → 世界/位置/环境 → 正在做的事通栏 -->
      <section v-if="statusCells.length" class="npc-section">
        <header class="npc-section-head">📍 当前状态</header>
        <div
          class="npc-status-grid"
          :class="{
            'npc-status-grid--mapped': statusLayoutMapped,
            'npc-status-grid--has-doing': !!doingCell,
          }"
        >
          <div
            v-for="cell in statusMainCells"
            :key="cell.label"
            class="npc-status-cell"
            :class="statusCellClass(cell.label)"
          >
            <div class="npc-status-k">{{ cell.label }}</div>
            <div class="npc-status-v">{{ cell.value }}</div>
          </div>
          <div v-if="doingCell" class="npc-status-cell npc-status-cell--doing">
            <div class="npc-status-k">{{ doingCell.label }}</div>
            <div class="npc-status-v">{{ doingCell.value }}</div>
          </div>
        </div>
      </section>

      <!-- 人际与背景：统一容器 -->
      <section
        v-if="npc.companions.length || npc.socialNetwork.length || showBackgroundCard"
        class="npc-relations"
      >
        <div class="npc-relations-grid">
          <div v-if="npc.companions.length" class="npc-relations-block npc-relations-block--near">
            <header class="npc-relations-head">
              <span class="npc-relations-ico" aria-hidden="true">👥</span>
              <span>身边人物</span>
              <span class="npc-relations-count">{{ companionCount }}</span>
            </header>
            <div class="npc-chip-flow npc-chip-flow--fill">
              <template v-for="(g, gi) in npc.companions" :key="'cmp' + gi">
                <span
                  v-for="(p, pi) in g.people"
                  :key="'cp' + gi + '-' + pi"
                  class="npc-person-chip"
                >
                  <span class="npc-person-chip-cat">{{ g.category }}</span>
                  <span class="npc-person-chip-name">{{ p.name }}</span>
                  <span v-if="p.note" class="npc-person-chip-note">{{ p.note }}</span>
                </span>
              </template>
            </div>
          </div>

          <div v-if="showBackgroundCard" class="npc-relations-block npc-relations-block--bg">
            <header class="npc-relations-head">
              <span class="npc-relations-ico" aria-hidden="true">🔗</span>
              <span>背景关联</span>
            </header>
            <div class="npc-meta-strip npc-meta-strip--fill">
              <div v-for="row in backgroundRows" :key="row.key" class="npc-meta-chip">
                <span class="npc-meta-k">{{ row.label }}</span>
                <span class="npc-meta-v" :class="{ muted: row.empty }">{{ row.value }}</span>
              </div>
            </div>
          </div>

          <div
            v-if="npc.socialNetwork.length"
            class="npc-relations-block npc-relations-block--social"
          >
            <header class="npc-relations-head">
              <span class="npc-relations-ico" aria-hidden="true">🤝</span>
              <span>社交网络</span>
              <span class="npc-relations-count">{{ socialCount }}</span>
            </header>
            <div class="npc-chip-flow npc-chip-flow--fill">
              <template v-for="(g, gi) in npc.socialNetwork" :key="'soc' + gi">
                <span
                  v-for="(p, pi) in g.people"
                  :key="'p' + gi + '-' + pi"
                  class="npc-person-chip"
                >
                  <span class="npc-person-chip-cat">{{ g.category }}</span>
                  <span class="npc-person-chip-name">{{ p.name }}</span>
                  <span v-if="p.note" class="npc-person-chip-note">{{ p.note }}</span>
                </span>
              </template>
            </div>
          </div>
        </div>
      </section>

      <!-- 长期目标 / 近期打算：并排；近期内联键值 -->
      <div v-if="npc.longGoal || npc.nearPlan.length" class="npc-duo">
        <article v-if="npc.longGoal" class="npc-subcard">
          <header class="npc-subcard-head">🎯 长期目标</header>
          <p class="npc-goal-text">{{ npc.longGoal }}</p>
        </article>
        <article v-if="npc.nearPlan.length" class="npc-subcard">
          <header class="npc-subcard-head">📅 近期打算</header>
          <div class="npc-plan-compact">
            <div v-for="row in nearPlanRows" :key="row.key" class="npc-plan-line">
              <span class="npc-plan-k">{{ row.label }}</span>
              <span class="npc-plan-v">{{ row.value }}</span>
            </div>
          </div>
        </article>
      </div>

      <!-- 可选任务：进行中 + 归档 -->
      <section
        v-if="npc.questLogs.length || npc.questArchive.length"
        class="npc-section npc-quest-section"
      >
        <header class="npc-section-head">
          📋 任务
          <span class="npc-quest-count">{{ questSectionCount }}</span>
        </header>

        <div v-if="npc.questLogs.length" class="npc-quest-logs">
          <article
            v-for="(log, li) in npc.questLogs"
            :key="'qlog' + li"
            class="npc-subcard npc-quest-card"
          >
            <div class="npc-quest-card-top">
              <span class="npc-quest-kind" :class="questKindClass(log.kind)">{{ log.kind || '任务' }}</span>
              <span class="npc-quest-title">{{ log.title }}</span>
            </div>
            <p v-if="log.summary" class="npc-quest-summary">{{ log.summary }}</p>
            <ul v-if="log.items.length" class="npc-quest-items">
              <li
                v-for="(item, ii) in log.items"
                :key="'qi' + li + '-' + ii"
                class="npc-quest-item"
                :class="'npc-quest-item--' + item.status"
              >
                <span class="npc-quest-mark" aria-hidden="true">{{ questStatusMark(item.status) }}</span>
                <span class="npc-quest-item-text">{{ item.text }}</span>
                <ul v-if="item.children.length" class="npc-quest-children">
                  <li
                    v-for="(child, ci) in item.children"
                    :key="'qc' + li + '-' + ii + '-' + ci"
                    class="npc-quest-item npc-quest-item--child"
                    :class="'npc-quest-item--' + child.status"
                  >
                    <span class="npc-quest-mark" aria-hidden="true">{{ questStatusMark(child.status) }}</span>
                    <span class="npc-quest-item-text">{{ child.text }}</span>
                  </li>
                </ul>
              </li>
            </ul>
            <div v-if="log.climax" class="npc-quest-climax">
              <span class="npc-quest-climax-label">收束</span>
              <span class="npc-quest-climax-text">{{ log.climax }}</span>
            </div>
          </article>
        </div>

        <div v-if="npc.questArchive.length" class="npc-quest-archive">
          <header class="npc-quest-archive-head">归档</header>
          <ul class="npc-quest-archive-list">
            <li
              v-for="(entry, ai) in npc.questArchive"
              :key="'qarch' + ai"
              class="npc-quest-archive-row"
            >
              <span class="npc-quest-kind npc-quest-kind--archive" :class="questKindClass(entry.kind)">
                {{ entry.kind }}
              </span>
              <span class="npc-quest-archive-title">{{ entry.title }}</span>
              <span v-if="entry.completedAt" class="npc-quest-archive-date">{{ entry.completedAt }}</span>
              <span v-if="entry.ending" class="npc-quest-archive-ending">{{ entry.ending }}</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- 记忆：三类等宽栏，统一列表样式 -->
      <section v-if="memoryColumns.length" class="npc-section npc-memory-section">
        <header class="npc-section-head">🧠 记忆</header>
        <div
          class="npc-memory-grid"
          :style="{ '--mem-cols': String(memoryColumns.length) }"
        >
          <article
            v-for="col in memoryColumns"
            :key="col.key"
            class="npc-memory-col"
            :class="'npc-memory-col--' + col.key"
          >
            <header class="npc-memory-col-head">
              <span>{{ col.icon }}</span>
              <span>{{ col.title }}</span>
              <span class="npc-memory-count">{{ col.items.length }}</span>
            </header>
            <ol class="npc-memory-list">
              <li v-for="(m, i) in col.items" :key="col.key + i">{{ m }}</li>
            </ol>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getReputationClass, getWealthClass, getWealthEmoji } from '../parse';
import { STATUS_LABELS, type NpcCard, type QuestItemStatus } from '../types';

const props = defineProps<{ npc: NpcCard }>();

const expanded = ref(false);

const statusLabels = STATUS_LABELS;
const wealthCls = computed(() => getWealthClass(props.npc.wealth));
const wealthEmoji = computed(() => getWealthEmoji(props.npc.wealth));

const questSectionCount = computed(
  () => props.npc.questLogs.length + props.npc.questArchive.length,
);

function questStatusMark(status: QuestItemStatus): string {
  if (status === 'done') return '☑';
  if (status === 'active') return '▶';
  return '☐';
}

function questKindClass(kind: string): string {
  const k = String(kind ?? '').trim();
  if (k.includes('主线')) return 'quest-kind--main';
  if (k.includes('支线')) return 'quest-kind--side';
  if (k.includes('角色')) return 'quest-kind--char';
  if (k.includes('委托')) return 'quest-kind--errand';
  return 'quest-kind--default';
}

function bgDisplay(v: string): { value: string; empty: boolean } {
  const t = String(v ?? '').trim();
  if (!t || t === '无') return { value: '无', empty: true };
  return { value: t, empty: false };
}

const showBackgroundCard = computed(() => {
  const b = props.npc.background;
  return !!(b.group || b.circle || b.event);
});

const companionCount = computed(() =>
  props.npc.companions.reduce((n, g) => n + g.people.length, 0),
);

const socialCount = computed(() =>
  props.npc.socialNetwork.reduce((n, g) => n + g.people.length, 0),
);

const lifeChips = computed(() => {
  const life = props.npc.lifeArchive;
  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (life.birthday) rows.push({ key: 'birthday', label: '生日', value: life.birthday });
  if (life.race) rows.push({ key: 'race', label: '种族', value: life.race });
  if (life.age) rows.push({ key: 'age', label: '年龄', value: life.age });
  if (life.remainingLife) rows.push({ key: 'life', label: '剩余寿命', value: life.remainingLife });
  return rows;
});

const hasBody = computed(() => {
  const n = props.npc;
  return !!(
    lifeChips.value.length ||
    n.wealth ||
    n.reputation.length ||
    n.actionChain.length ||
    n.predict ||
    n.statusParts.length ||
    n.companions.length ||
    n.socialNetwork.length ||
    showBackgroundCard.value ||
    n.longGoal ||
    n.nearPlan.length ||
    n.questLogs.length ||
    n.questArchive.length ||
    n.recentMemories.length ||
    n.settledMemories.length ||
    n.coreMemories.length
  );
});

function toggleExpanded(): void {
  if (!hasBody.value) return;
  expanded.value = !expanded.value;
}

const DOING_LABEL = '正在做的事';

const STATUS_AREA_KEYS: Record<string, string> = {
  动作: 'action',
  穿着: 'wear',
  正在做的事: 'doing',
  所处世界: 'world',
  位置: 'place',
  环境: 'env',
};

const statusCells = computed(() =>
  props.npc.statusParts.map((value, i) => ({
    label: statusLabels[i] || `详情${i + 1}`,
    value,
  })),
);

const statusMainCells = computed(() =>
  statusCells.value.filter(c => c.label !== DOING_LABEL),
);

const doingCell = computed(
  () => statusCells.value.find(c => c.label === DOING_LABEL) ?? null,
);

/** 六段标准字段齐全时启用语义网格，否则回退自适应 */
const statusLayoutMapped = computed(() => {
  const labels = new Set(statusCells.value.map(c => c.label));
  return ['动作', '穿着', '所处世界', '位置', '环境'].every(l => labels.has(l));
});

function statusCellClass(label: string): string {
  const key = STATUS_AREA_KEYS[label];
  return key ? `npc-status-cell--${key}` : '';
}

const NEAR_PLAN_LABELS = ['事件', '行为', '时段'] as const;

const nearPlanRows = computed(() => {
  const parts = props.npc.nearPlan;
  if (!parts.length) return [];
  if (parts.length === 1) {
    return [{ key: 'plan', label: '内容', value: parts[0]! }];
  }
  return parts.map((value, i) => ({
    key: `p${i}`,
    label: NEAR_PLAN_LABELS[i] ?? `项${i + 1}`,
    value,
  }));
});

const memoryColumns = computed(() => {
  const cols: Array<{ key: string; title: string; icon: string; items: string[] }> = [];
  if (props.npc.recentMemories.length) {
    cols.push({ key: 'recent', title: '近期记忆', icon: '💬', items: props.npc.recentMemories });
  }
  if (props.npc.settledMemories.length) {
    cols.push({ key: 'settled', title: '沉淀记忆', icon: '📜', items: props.npc.settledMemories });
  }
  if (props.npc.coreMemories.length) {
    cols.push({ key: 'core', title: '核心记忆', icon: '💎', items: props.npc.coreMemories });
  }
  return cols;
});

const backgroundRows = computed(() => {
  const b = props.npc.background;
  const g = bgDisplay(b.group);
  const c = bgDisplay(b.circle);
  const e = bgDisplay(b.event);
  return [
    { key: 'group', label: '团体', ...g },
    { key: 'circle', label: '社交圈', ...c },
    { key: 'event', label: '事件', ...e },
  ];
});
</script>

<style lang="scss" scoped>
.npc-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--card-pad);
  box-shadow: var(--glow-card);
  transition:
    background var(--transition-smooth),
    border-color var(--transition-smooth),
    box-shadow var(--transition-smooth);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0.45em;
  min-width: 0;
  width: 100%;
  font-size: 1em;

  &:hover {
    background: var(--bg-card-hover);
    border-color: var(--border-glow);
    box-shadow: var(--glow-accent);
  }

  &--empty {
    opacity: 0.78;
  }
}

/* 顶栏：可点击折叠；名字靠左，社会身份靠右 */
.npc-card-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35em 0.5em;
  position: relative;
  z-index: 1;
  width: 100%;
  margin: 0;
  padding: 0.15em 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--transition-smooth);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--bg-step) 55%, transparent);
  }

  &:focus-visible {
    outline: 2px solid var(--border-glow);
    outline-offset: 2px;
  }

  &--static,
  &:disabled {
    cursor: default;
  }
}

.npc-card-caret {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 0.85em;
  color: var(--text-muted);
  line-height: 1;
  transition: transform 0.2s ease;
  transform: rotate(0deg);

  &--open {
    transform: rotate(180deg);
  }
}

.npc-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.45em;
  width: 100%;
  min-width: 0;
}

.npc-card:not(.npc-card--open) {
  gap: 0;
}

.npc-avatar {
  width: 1.75em;
  height: 1.75em;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--bg-step), rgba(140, 170, 210, 0.18));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85em;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
}

.npc-name {
  font-family: var(--font-display);
  font-size: 0.95em;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.2px;
  line-height: 1.25;
  display: inline-flex;
  align-items: center;
  gap: 0.2em;
  flex-shrink: 0;
}

.npc-name-icon {
  font-size: 0.75em;
  color: var(--accent-gold);
}

.npc-identity-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25em;
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
}

.npc-identity-tag {
  font-size: 0.62em;
  font-weight: 600;
  line-height: 1.32;
  padding: 0.1em 0.4em;
  border-radius: 5px;
  max-width: 100%;
  word-break: break-word;
  white-space: nowrap;
  background: color-mix(in srgb, var(--accent-gold) 14%, var(--bg-step));
  color: var(--accent-gold);
  border: 1px solid color-mix(in srgb, var(--accent-gold) 35%, var(--border-subtle));
  letter-spacing: 0.1px;
}

.npc-identity-empty {
  font-family: var(--font-mono);
  font-size: 0.6em;
  font-weight: 600;
  padding: 0.12em 0.4em;
  border-radius: 5px;
  color: var(--text-muted, var(--text-secondary));
  background: var(--bg-step);
  border: 1px solid var(--border-subtle);
  white-space: nowrap;
  flex-shrink: 0;
}

.npc-rep-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25em;
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
}

.npc-wealth-tag {
  font-family: var(--font-mono);
  font-size: 0.6em;
  font-weight: 600;
  padding: 0.12em 0.4em;
  border-radius: 5px;
  letter-spacing: 0.15px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.npc-social-profile {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3em 0.4em;
  width: 100%;

  .npc-rep-inline {
    flex: 1 1 auto;
    min-width: 0;
  }
}

.wealth-destitute {
  background: var(--wealth-destitute-bg);
  color: var(--wealth-destitute-fg);
  border: 1px solid var(--wealth-destitute-bd);
}
.wealth-poor {
  background: var(--wealth-poor-bg);
  color: var(--wealth-poor-fg);
  border: 1px solid var(--wealth-poor-bd);
}
.wealth-tight {
  background: var(--wealth-tight-bg);
  color: var(--wealth-tight-fg);
  border: 1px solid var(--wealth-tight-bd);
}
.wealth-balanced {
  background: var(--wealth-balanced-bg);
  color: var(--wealth-balanced-fg);
  border: 1px solid var(--wealth-balanced-bd);
}
.wealth-comfortable {
  background: var(--wealth-comfortable-bg);
  color: var(--wealth-comfortable-fg);
  border: 1px solid var(--wealth-comfortable-bd);
}
.wealth-welloff {
  background: var(--wealth-welloff-bg);
  color: var(--wealth-welloff-fg);
  border: 1px solid var(--wealth-welloff-bd);
}
.wealth-rich {
  background: var(--wealth-rich-bg);
  color: var(--wealth-rich-fg);
  border: 1px solid var(--wealth-rich-bd);
}
.wealth-tycoon {
  background: var(--wealth-tycoon-bg);
  color: var(--wealth-tycoon-fg);
  border: 1px solid var(--wealth-tycoon-bd);
}

.npc-chip {
  font-size: 0.58em;
  line-height: 1.32;
  padding: 0.1em 0.36em;
  border-radius: 5px;
  max-width: 100%;
  word-break: break-word;
  border: 1px solid var(--border-subtle);
  background: var(--bg-step);
  color: var(--text-secondary);
  white-space: nowrap;

  &--rep {
    font-weight: 600;
    letter-spacing: 0.1px;
  }
}

.rep-hated {
  background: var(--rep-hated-bg);
  color: var(--rep-hated-fg);
  border-color: var(--rep-hated-bd);
}
.rep-infamous {
  background: var(--rep-infamous-bg);
  color: var(--rep-infamous-fg);
  border-color: var(--rep-infamous-bd);
}
.rep-obscure {
  background: var(--rep-obscure-bg);
  color: var(--rep-obscure-fg);
  border-color: var(--rep-obscure-bd);
}
.rep-known {
  background: var(--rep-known-bg);
  color: var(--rep-known-fg);
  border-color: var(--rep-known-bd);
}
.rep-respected {
  background: var(--rep-respected-bg);
  color: var(--rep-respected-fg);
  border-color: var(--rep-respected-bd);
}
.rep-revered {
  background: var(--rep-revered-bg);
  color: var(--rep-revered-fg);
  border-color: var(--rep-revered-bd);
}
.rep-default {
  background: var(--bg-step);
  color: var(--text-secondary);
  border-color: var(--border-subtle);
}

.npc-chain-section {
  background: var(--bg-chain);
  border-radius: var(--radius-sm);
  padding: 0.4em 0.55em;
  border-left: 2px solid var(--border-chain);
  width: 100%;
}

.chain-label {
  font-family: var(--font-mono);
  font-size: 0.68em;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--accent-lavender);
  text-transform: uppercase;
  margin-bottom: 0.2em;
}

.chain-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2em;
  font-size: 0.78em;
  color: var(--text-secondary);
  line-height: 1.45;
}

.chain-step {
  background: var(--bg-step);
  color: var(--text-primary);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-weight: 500;
  white-space: normal;
  word-break: break-word;
  min-width: 0;
}

.chain-arrow {
  color: var(--accent-gold);
  font-weight: 700;
  flex-shrink: 0;
}

.chain-predict {
  color: var(--accent-rose);
  font-weight: 600;
  font-style: italic;
  word-break: break-word;
  min-width: 0;
}

.chain-debut-tag {
  background: var(--debut-bg);
  color: var(--debut-fg);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-weight: 700;
  font-size: 0.85em;
  letter-spacing: 0.2px;
  animation: pulseTag 2s ease-in-out infinite;
  white-space: nowrap;
}

@keyframes pulseTag {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.82;
  }
}

/* —— 分区标题 —— */
.npc-section {
  display: flex;
  flex-direction: column;
  gap: 0.35em;
  width: 100%;
}

.npc-section-head {
  font-family: var(--font-mono);
  font-size: 0.72em;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: var(--accent-lavender);
}

/* 生命档案：紧凑标签行 */
.npc-life-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3em;
  width: 100%;
}

.npc-life-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25em;
  max-width: 100%;
  padding: 0.2em 0.45em;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent-mint) 14%, var(--bg-step));
  border: 1px solid color-mix(in srgb, var(--accent-mint) 35%, var(--border-subtle));
  font-size: 0.68em;
  line-height: 1.35;
}

.npc-life-k {
  font-weight: 700;
  color: var(--accent-mint);
  letter-spacing: 0.2px;
  flex-shrink: 0;
}

.npc-life-v {
  color: var(--text-primary);
  word-break: break-word;
  min-width: 0;
}

.npc-companions-card {
  width: 100%;
}

/* 人际与背景：统一容器 */
.npc-relations {
  width: 100%;
  padding: 0.55em 0.6em 0.6em;
  border-radius: var(--radius-md);
  background:
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--accent-sky) 8%, var(--bg-panel, var(--bg-step))) 0%,
      color-mix(in srgb, var(--accent-lavender) 6%, var(--bg-card)) 55%,
      var(--bg-panel, var(--bg-step)) 100%
    );
  border: 1px solid color-mix(in srgb, var(--accent-lavender) 28%, var(--border-subtle));
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent);
}

.npc-relations-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 0.55em 0.65em;
  width: 100%;
  align-items: start;
}

.npc-relations-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35em;

  &--near {
    grid-column: 1;
    grid-row: 1;
  }

  &--bg {
    grid-column: 2;
    grid-row: 1;
  }

  &--social {
    grid-column: 1 / -1;
    grid-row: 2;
    padding-top: 0.45em;
    border-top: 1px dashed color-mix(in srgb, var(--accent-lavender) 35%, var(--border-subtle));
  }
}

/* 仅身边或仅背景时通栏 */
.npc-relations-grid:not(:has(.npc-relations-block--near)) .npc-relations-block--bg,
.npc-relations-grid:not(:has(.npc-relations-block--bg)) .npc-relations-block--near {
  grid-column: 1 / -1;
}

.npc-relations-grid:not(:has(.npc-relations-block--near)):not(:has(.npc-relations-block--bg))
  .npc-relations-block--social {
  padding-top: 0;
  border-top: none;
}

.npc-relations-head {
  display: flex;
  align-items: center;
  gap: 0.3em;
  font-family: var(--font-mono);
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.35px;
  color: var(--accent-lavender);
  line-height: 1.2;
}

.npc-relations-ico {
  font-size: 0.95em;
  line-height: 1;
}

.npc-relations-count {
  margin-left: auto;
  font-size: 0.9em;
  font-weight: 600;
  color: var(--text-muted, var(--text-secondary));
  background: color-mix(in srgb, var(--accent-lavender) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-lavender) 22%, var(--border-subtle));
  border-radius: 999px;
  padding: 0.05em 0.45em;
  letter-spacing: 0;
}

/* 人物/社交：自适应填满行宽 */
.npc-chip-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35em;
  width: 100%;

  &--fill {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11.5em, 1fr));
    gap: 0.35em;
  }
}

.npc-person-chip {
  display: flex;
  flex-direction: column;
  gap: 0.12em;
  min-width: 0;
  padding: 0.35em 0.5em;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-card) 72%, transparent);
  border: 1px solid var(--border-subtle);
  line-height: 1.35;
  box-shadow: 0 1px 0 color-mix(in srgb, #000 4%, transparent);
}

.npc-person-chip-cat {
  font-size: 0.6em;
  font-weight: 700;
  color: var(--accent-sky);
  letter-spacing: 0.25px;
}

.npc-person-chip-name {
  font-size: 0.76em;
  font-weight: 700;
  color: var(--text-primary);
  word-break: break-word;
}

.npc-person-chip-note {
  font-size: 0.66em;
  color: var(--text-secondary);
  word-break: break-word;
}

/* 背景关联：格内铺满 */
.npc-meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35em;
  width: 100%;

  &--fill {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.3em;
  }
}

.npc-meta-chip {
  display: flex;
  flex-direction: column;
  gap: 0.1em;
  min-width: 0;
  padding: 0.32em 0.48em;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent-sky) 8%, var(--bg-card));
  border: 1px solid color-mix(in srgb, var(--accent-sky) 22%, var(--border-subtle));
}

.npc-meta-k {
  font-size: 0.58em;
  font-weight: 700;
  color: var(--accent-sky);
  letter-spacing: 0.2px;
}

.npc-meta-v {
  font-size: 0.74em;
  color: var(--text-primary);
  word-break: break-word;
  line-height: 1.35;

  &.muted {
    color: var(--text-muted, var(--text-secondary));
    opacity: 0.75;
  }
}

/* 移动端统一断点：≤640px */
@media (max-width: 640px) {
  .npc-card {
    overflow-x: hidden;
    gap: 0.5em;
  }

  .npc-card-top {
    align-items: flex-start;
    column-gap: 0.4em;
    row-gap: 0.35em;
    padding-right: 1.6em;
  }

  .npc-avatar {
    width: 1.55em;
    height: 1.55em;
    font-size: 0.78em;
  }

  .npc-name {
    flex: 1 1 calc(100% - 3em);
    flex-shrink: 1;
    min-width: 0;
    max-width: 100%;
    font-size: 0.9em;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .npc-card-caret {
    position: absolute;
    top: 0.15em;
    right: 0;
    margin-left: 0;
    width: var(--touch-min);
    height: var(--touch-min);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .npc-identity-inline {
    flex: 1 1 100%;
    order: 3;
    row-gap: 0.3em;
    gap: 0.25em;
  }

  .npc-identity-tag {
    white-space: normal;
    font-size: 0.58em;
  }

  .npc-identity-empty {
    order: 3;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
    font-size: 0.58em;
  }

  .npc-social-profile {
    gap: 0.28em;

    .npc-chip {
      white-space: normal;
      font-size: 0.56em;
    }

    .npc-wealth-tag {
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      font-size: 0.58em;
    }
  }

  .npc-life-row {
    gap: 0.28em;
  }

  .npc-life-chip {
    font-size: 0.64em;
  }

  /* 当前状态：两列 + 通栏 */
  .npc-status-grid {
    &--mapped {
      grid-template-columns: 1fr 1fr;
      grid-template-areas:
        'action wear'
        'world place'
        'env env'
        'doing doing';
    }

    &--mapped:not(.npc-status-grid--has-doing) {
      grid-template-areas:
        'action wear'
        'world place'
        'env env';
    }

    &:not(.npc-status-grid--mapped) {
      grid-template-columns: 1fr 1fr;

      .npc-status-cell--doing {
        grid-column: 1 / -1;
      }
    }
  }

  .npc-status-cell {
    padding: 0.35em 0.42em;
  }

  .npc-status-k {
    font-size: 0.62em;
  }

  .npc-status-v {
    font-size: 0.74em;
    line-height: 1.4;
  }

  /* 人际容器：单列 */
  .npc-relations {
    padding: 0.45em 0.5em 0.5em;
  }

  .npc-relations-grid {
    grid-template-columns: 1fr;
    gap: 0.45em;
  }

  .npc-relations-block--near,
  .npc-relations-block--bg,
  .npc-relations-block--social {
    grid-column: 1;
    grid-row: auto;
  }

  .npc-relations-block--social {
    padding-top: 0.4em;
  }

  .npc-chip-flow--fill {
    grid-template-columns: repeat(auto-fill, minmax(8.5em, 1fr));
  }

  .npc-meta-strip--fill {
    grid-template-columns: repeat(auto-fill, minmax(7.5em, 1fr));
  }

  /* 目标/打算：单列 */
  .npc-duo {
    grid-template-columns: 1fr;
  }

  /* 任务：单列 */
  .npc-quest-logs {
    grid-template-columns: 1fr;
  }

  /* 记忆：窄屏由 container / auto-fit 自行单列；此处只调可读性 */
  .npc-memory-col {
    padding: 0.55em 0.65em;
  }

  .npc-memory-list {
    gap: 0.45em;
  }

  .npc-memory-list li {
    font-size: 0.8em;
    line-height: 1.55;
  }

  .npc-chain-section {
    padding: 0.5em 0.65em;
  }

  .chain-arrow {
    display: none;
  }

  .chain-step,
  .chain-predict {
    flex: 1 1 100%;
    font-size: 0.78em;
    line-height: 1.45;
    padding: 0.35em 0.5em;
  }

  .npc-subcard {
    padding: 0.55em 0.6em 0.6em;
    gap: 0.45em;
  }

  .npc-social-row {
    grid-template-columns: 1fr;
  }

  .npc-plan-line {
    grid-template-columns: 2.4em minmax(0, 1fr);
    font-size: 0.74em;
  }
}

/* 近期打算：紧凑键值行 */
.npc-plan-compact {
  display: flex;
  flex-direction: column;
  gap: 0.25em;
}

.npc-plan-line {
  display: grid;
  grid-template-columns: 2.6em minmax(0, 1fr);
  gap: 0.35em 0.45em;
  align-items: baseline;
  font-size: 0.76em;
  line-height: 1.45;
}

.npc-plan-k {
  font-size: 0.9em;
  font-weight: 700;
  color: var(--accent-sky);
}

.npc-plan-v {
  color: var(--text-primary);
  word-break: break-word;
  min-width: 0;
}

/* 当前状态：语义分区网格（动作/穿着 → 世界/位置/环境 → 正在做） */
.npc-status-grid {
  display: grid;
  gap: 0.4em;
  width: 100%;
  align-items: stretch;
  grid-template-columns: repeat(auto-fit, minmax(7.5em, 1fr));

  &--mapped {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1.35fr);
    grid-template-areas:
      'action wear wear'
      'world place place'
      'env env env'
      'doing doing doing';
  }

  &--mapped:not(.npc-status-grid--has-doing) {
    grid-template-areas:
      'action wear wear'
      'world place place'
      'env env env';
  }
}

.npc-status-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  padding: 0.4em 0.5em;
  border-radius: 6px;
  background: var(--bg-step);
  border: 1px solid var(--border-subtle);

  &--doing {
    grid-column: 1 / -1;
    background: color-mix(in srgb, var(--accent-sky) 10%, var(--bg-step));
    border-color: color-mix(in srgb, var(--accent-sky) 28%, var(--border-subtle));
  }
}

.npc-status-grid--mapped {
  .npc-status-cell--action {
    grid-area: action;
  }
  .npc-status-cell--wear {
    grid-area: wear;
  }
  .npc-status-cell--world {
    grid-area: world;
  }
  .npc-status-cell--place {
    grid-area: place;
  }
  .npc-status-cell--env {
    grid-area: env;
  }
  .npc-status-cell--doing {
    grid-area: doing;
    grid-column: auto;
  }
}

.npc-status-k {
  font-size: 0.65em;
  font-weight: 700;
  color: var(--accent-sky);
  letter-spacing: 0.3px;
  margin-bottom: 0.15em;
}

.npc-status-v {
  font-size: 0.78em;
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
}

/* 双卡：够宽则并排，否则自动折行 */
.npc-duo {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12em, 1fr));
  gap: 0.5em;
  width: 100%;
  align-items: stretch;

  &:has(> :only-child) {
    grid-template-columns: 1fr;
  }
}

.npc-subcard {
  background: var(--bg-panel, var(--bg-step));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0.45em 0.55em 0.5em;
  display: flex;
  flex-direction: column;
  gap: 0.35em;
  min-width: 0;
  min-height: 100%;
}

.npc-subcard-head {
  font-family: var(--font-mono);
  font-size: 0.72em;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: var(--accent-lavender);
  padding-bottom: 0.25em;
  border-bottom: 1px dashed var(--border-subtle);
}

.npc-subcard-body {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
  flex: 1;
}

.npc-goal-text {
  margin: 0;
  font-size: 0.8em;
  line-height: 1.5;
  color: var(--text-primary);
  word-break: break-word;
  flex: 1;
}

/* 社交：分类在左，人物在右 */
.npc-social-row {
  display: grid;
  grid-template-columns: 3.2em minmax(0, 1fr);
  gap: 0.35em 0.5em;
  align-items: start;
}

.npc-social-cat {
  font-size: 0.7em;
  font-weight: 700;
  color: var(--accent-sky);
  line-height: 1.45;
  padding-top: 0.1em;
}

.npc-social-people {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25em;
  min-width: 0;
}

.npc-person {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15em 0.4em;
  padding: 0.2em 0.4em;
  border-radius: 6px;
  background: var(--memory-bg, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--memory-bd, var(--border-subtle));
  max-width: 100%;
}

.npc-person-name {
  font-size: 0.78em;
  font-weight: 700;
  color: var(--text-primary);
}

.npc-person-note {
  font-size: 0.7em;
  color: var(--text-secondary);
  word-break: break-word;
}

/* 背景 / 近期打算：键值行 */
.npc-bg-rows {
  gap: 0.3em;
}

.npc-bg-row {
  display: grid;
  grid-template-columns: 3.5em minmax(0, 1fr);
  gap: 0.35em 0.5em;
  align-items: baseline;
  padding: 0.25em 0.35em;
  border-radius: 6px;
  background: rgba(120, 150, 200, 0.08);
  border: 1px solid rgba(120, 150, 200, 0.2);
}

.npc-bg-key {
  font-size: 0.7em;
  font-weight: 700;
  color: var(--accent-sky);
}

.npc-bg-val {
  font-size: 0.78em;
  color: var(--text-primary);
  word-break: break-word;

  &.muted {
    color: var(--text-muted, var(--text-secondary));
    opacity: 0.75;
  }
}

/* 记忆：按卡片实际宽度自适应；窄屏单列，宽屏再分栏（iframe 内 media 常不准） */
.npc-memory-section {
  gap: 0.45em;
  container-type: inline-size;
  container-name: npc-memory;
}

.npc-memory-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.55em;
  width: 100%;
  align-items: stretch;
}

@container npc-memory (min-width: 36rem) {
  .npc-memory-grid {
    grid-template-columns: repeat(var(--mem-cols, 3), minmax(0, 1fr));
    gap: 0.5em;
  }
}

.npc-memory-col {
  display: flex;
  flex-direction: column;
  gap: 0.35em;
  min-width: 0;
  padding: 0.5em 0.65em;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--memory-bg, var(--bg-step));
  min-height: 100%;

  &--settled {
    background: var(--memory-settled-bg, var(--bg-step));
    border-color: var(--memory-settled-bd, var(--border-subtle));
  }

  &--core {
    background: var(--memory-core-bg, var(--bg-step));
    border-color: var(--memory-core-bd, var(--border-subtle));
  }
}

.npc-memory-col-head {
  display: flex;
  align-items: center;
  gap: 0.3em;
  font-family: var(--font-mono);
  font-size: 0.72em;
  font-weight: 700;
  color: var(--accent-lavender);
  letter-spacing: 0.3px;
  padding-bottom: 0.3em;
  border-bottom: 1px dashed var(--border-subtle);
}

.npc-memory-col--core .npc-memory-col-head {
  color: var(--accent-gold);
}

.npc-memory-count {
  margin-left: auto;
  font-weight: 600;
  opacity: 0.7;
  font-size: 0.95em;
}

.npc-memory-list {
  margin: 0;
  padding: 0 0 0 1.2em;
  display: flex;
  flex-direction: column;
  gap: 0.4em;
  list-style: decimal;
}

.npc-memory-list li {
  font-size: 0.78em;
  line-height: 1.55;
  color: var(--text-secondary);
  word-break: break-word;
  overflow-wrap: anywhere;
  padding-left: 0.15em;
}

.npc-memory-col--core .npc-memory-list li {
  color: var(--text-primary);
}

/* —— 可选任务模块 —— */
.npc-quest-section {
  gap: 0.45em;
}

.npc-section-head {
  display: flex;
  align-items: center;
  gap: 0.4em;
}

.npc-quest-count {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-step);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: 0.05em 0.45em;
  letter-spacing: 0;
}

.npc-quest-logs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14em, 1fr));
  gap: 0.45em;
  width: 100%;
  align-items: stretch;
}

.npc-quest-card {
  min-width: 0;
  min-height: 100%;
  height: 100%;
}

.npc-quest-card-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35em 0.5em;
}

.npc-quest-kind {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 0.12em 0.4em;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  line-height: 1.3;
}

.quest-kind--main {
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-gold) 35%, transparent);
}

.quest-kind--side {
  color: var(--accent-sky);
  background: color-mix(in srgb, var(--accent-sky) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-sky) 35%, transparent);
}

.quest-kind--char {
  color: var(--accent-rose);
  background: color-mix(in srgb, var(--accent-rose) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-rose) 35%, transparent);
}

.quest-kind--errand {
  color: var(--accent-mint);
  background: color-mix(in srgb, var(--accent-mint) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-mint) 35%, transparent);
}

.quest-kind--default {
  color: var(--accent-lavender);
  background: var(--bg-step);
}

.npc-quest-title {
  font-size: 0.84em;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.35;
  word-break: break-word;
  min-width: 0;
}

.npc-quest-summary {
  margin: 0;
  font-size: 0.74em;
  line-height: 1.45;
  color: var(--text-muted);
  word-break: break-word;
}

.npc-quest-items,
.npc-quest-children {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28em;
}

.npc-quest-item {
  display: grid;
  grid-template-columns: 1.1em minmax(0, 1fr);
  column-gap: 0.35em;
  row-gap: 0.2em;
  align-items: start;
  font-size: 0.76em;
  line-height: 1.45;
  color: var(--text-secondary);

  &--done {
    color: var(--text-muted);

    .npc-quest-item-text {
      text-decoration: line-through;
      text-decoration-color: color-mix(in srgb, var(--text-muted) 55%, transparent);
    }
  }

  &--active {
    color: var(--text-primary);
    font-weight: 600;
  }

  &--todo {
    color: var(--text-secondary);
  }
}

.npc-quest-mark {
  font-size: 0.9em;
  line-height: 1.45;
  color: var(--accent-sky);
  text-align: center;
}

.npc-quest-item--done .npc-quest-mark {
  color: var(--accent-mint);
}

.npc-quest-item--active .npc-quest-mark {
  color: var(--accent-gold);
}

.npc-quest-item-text {
  word-break: break-word;
  min-width: 0;
}

.npc-quest-children {
  grid-column: 1 / -1;
  padding-left: 1.35em;
  border-left: 1px dashed var(--border-subtle);
  margin-left: 0.35em;
}

.npc-quest-climax {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35em 0.5em;
  margin-top: 0.15em;
  padding-top: 0.35em;
  border-top: 1px dashed var(--border-subtle);
}

.npc-quest-climax-label {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--accent-coral);
}

.npc-quest-climax-text {
  font-size: 0.74em;
  line-height: 1.45;
  color: var(--text-secondary);
  word-break: break-word;
  min-width: 0;
}

.npc-quest-archive {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
  padding: 0.4em 0.5em 0.45em;
  border-radius: var(--radius-sm);
  background: var(--bg-step);
  border: 1px solid var(--border-subtle);
}

.npc-quest-archive-head {
  font-family: var(--font-mono);
  font-size: 0.68em;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

.npc-quest-archive-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35em;
}

.npc-quest-archive-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25em 0.45em;
  font-size: 0.74em;
  line-height: 1.4;
}

.npc-quest-kind--archive {
  opacity: 0.9;
}

.npc-quest-archive-title {
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-word;
}

.npc-quest-archive-date {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.npc-quest-archive-ending {
  flex: 1 1 100%;
  color: var(--text-secondary);
  word-break: break-word;
}
</style>
