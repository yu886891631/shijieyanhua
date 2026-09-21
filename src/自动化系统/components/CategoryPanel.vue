<template>
  <div
    v-if="section.npcs.length"
    class="major-panel"
    :class="'major-panel--' + section.key"
  >
    <div class="panel-header" @click="open = !open">
      <span class="panel-icon">{{ section.icon }}</span>
      <span class="panel-label">
        {{ section.typeLabel }}
        <span class="panel-badge">{{ section.badge }} ({{ section.npcs.length }})</span>
      </span>
      <span class="panel-caret" :style="{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }">▼</span>
    </div>
    <div class="panel-content" :class="{ open }">
      <div class="npc-grid">
        <NpcCard v-for="npc in section.npcs" :key="npc.name" :npc="npc" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CategorySection } from '../types';
import NpcCard from './NpcCard.vue';

defineProps<{ section: CategorySection }>();

const open = ref(true);
</script>

<style lang="scss" scoped>
.major-panel {
  --panel-accent-a: var(--accent-lavender);
  --panel-accent-b: var(--accent-rose);
  --panel-accent-c: var(--accent-sky);
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  margin-bottom: 8px;
  box-shadow: var(--glow-card);
  overflow: hidden;
  transition: box-shadow var(--transition-smooth);
  position: relative;

  &:hover {
    box-shadow: var(--glow-accent);
  }

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 2px;
    height: 100%;
    background: linear-gradient(
      180deg,
      var(--panel-accent-a) 0%,
      var(--panel-accent-b) 45%,
      var(--panel-accent-c) 100%
    );
    border-radius: var(--radius-lg) 0 0 var(--radius-lg);
    opacity: 0.85;
  }

  &--front {
    --panel-accent-a: var(--accent-coral);
    --panel-accent-b: var(--accent-gold);
    --panel-accent-c: var(--accent-rose);
  }

  &--back {
    --panel-accent-a: var(--accent-sky);
    --panel-accent-b: var(--accent-lavender);
    --panel-accent-c: var(--accent-mint);
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 12px;
  background: var(--bg-panel-header);
  cursor: pointer;
  transition: background 0.2s;
  font-weight: 700;
  font-size: 0.78rem;
  font-family: var(--font-display);
  color: var(--text-accent);
  letter-spacing: 0.3px;
  gap: 5px;
  border-bottom: 1px solid transparent;
  min-height: var(--touch-min);
  user-select: none;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: var(--bg-panel-header-hover);
    border-bottom-color: var(--border-glow);
  }
}

.panel-icon {
  font-size: 0.85rem;
  flex-shrink: 0;
  line-height: 1;
}

.panel-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex-wrap: wrap;
}

.panel-badge {
  font-family: var(--font-mono);
  font-size: 0.52rem;
  font-weight: 600;
  background: var(--bg-step);
  color: var(--accent-lavender);
  padding: 1px 5px;
  border-radius: 8px;
  letter-spacing: 0.6px;
  white-space: nowrap;
}

.panel-caret {
  font-size: 0.65rem;
  transition: transform 0.35s;
  color: var(--accent-lavender);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-control);
  flex-shrink: 0;
}

.panel-content {
  max-height: 0;
  overflow: hidden;
  transition:
    max-height 0.4s ease-out,
    padding 0.4s ease-out;
  padding: 0 var(--panel-pad-x);

  &.open {
    max-height: 20000px;
    padding: 8px var(--panel-pad-x) 10px;
  }
}

.npc-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 640px) {
  .major-panel {
    margin-bottom: 6px;
    overflow-x: hidden;
  }

  .npc-grid {
    gap: var(--space-3);
  }

  .panel-header {
    padding: 8px 8px 8px 10px;
    font-size: 0.75rem;
    min-height: var(--touch-min);
  }

  .panel-label {
    gap: 4px;
  }

  .panel-badge {
    font-size: 0.5rem;
  }

  .panel-caret {
    width: var(--touch-min);
    height: var(--touch-min);
  }

  .panel-content.open {
    padding: var(--space-3) var(--panel-pad-x) var(--space-4);
  }
}
</style>
