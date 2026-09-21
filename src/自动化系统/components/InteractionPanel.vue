<template>
  <div v-if="interactions.length" class="major-panel">
    <div class="panel-header" @click="open = !open">
      <span class="panel-icon">🔀</span>
      <span class="panel-label">
        角色交互事件
        <span class="panel-badge">EVENTS ({{ interactions.length }})</span>
      </span>
      <span class="panel-caret" :style="{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }">▼</span>
    </div>
    <div class="panel-content" :class="{ open }">
      <div class="ix-list">
        <div v-for="ix in interactions" :key="ix.id" class="ix-card">
          <div class="ix-top">
            <span class="ix-id">{{ ix.id }}</span>
            <span v-if="ix.roles.length" class="ix-roles">{{ ix.roles.join('、') }}</span>
          </div>
          <div v-if="ix.summary" class="ix-row">
            <span class="ix-label">简述</span>
            <span class="ix-value">{{ ix.summary }}</span>
          </div>
          <div v-if="ix.result" class="ix-row">
            <span class="ix-label">结果</span>
            <span class="ix-value">{{ ix.result }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { InteractionEvent } from '../types';

defineProps<{ interactions: InteractionEvent[] }>();

const open = ref(true);
</script>

<style lang="scss" scoped>
.major-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  margin-bottom: 8px;
  box-shadow: var(--glow-card);
  overflow: hidden;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 2px;
    height: 100%;
    background: linear-gradient(180deg, var(--accent-coral) 0%, var(--accent-gold) 100%);
    border-radius: var(--radius-lg) 0 0 var(--radius-lg);
    opacity: 0.85;
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 12px;
  background: var(--bg-panel-header);
  cursor: pointer;
  font-weight: 700;
  font-size: 0.78rem;
  font-family: var(--font-display);
  color: var(--text-accent);
  letter-spacing: 0.3px;
  gap: 5px;
  min-height: var(--touch-min);
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.2s;

  &:hover {
    background: var(--bg-panel-header-hover);
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
  background: var(--debut-bg);
  color: var(--accent-coral);
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
    max-height: 8000px;
    padding: 8px var(--panel-pad-x) 10px;
  }
}

.ix-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ix-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.ix-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.ix-id {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--accent-coral);
  background: var(--debut-bg);
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
}

.ix-roles {
  font-size: 0.72rem;
  color: var(--text-secondary);
  min-width: 0;
  word-break: break-word;
}

.ix-row {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 6px;
  font-size: 0.72rem;
  line-height: 1.45;
}

.ix-label {
  font-weight: 700;
  color: var(--accent-sky);
  font-size: 0.66rem;
  letter-spacing: 0.2px;
}

.ix-value {
  color: var(--text-primary);
  word-break: break-word;
  min-width: 0;
  flex: 1;
}

@media (max-width: 640px) {
  .major-panel {
    margin-bottom: 6px;
    overflow-x: hidden;
  }

  .panel-header {
    padding: 8px 8px 8px 10px;
    font-size: 0.75rem;
    min-height: var(--touch-min);
  }

  .panel-caret {
    width: var(--touch-min);
    height: var(--touch-min);
  }

  .panel-content.open {
    padding: var(--space-3) var(--panel-pad-x) var(--space-4);
  }

  .ix-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .ix-card {
    padding: var(--card-pad);
    gap: 5px;
  }

  .ix-top {
    gap: 4px 6px;
  }

  .ix-id {
    font-size: 0.72rem;
  }

  .ix-roles {
    font-size: 0.74rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .ix-row {
    flex-direction: column;
    gap: 3px;
    font-size: 0.74rem;
    line-height: 1.5;
  }

  .ix-label {
    font-size: 0.7rem;
  }

  .ix-value {
    font-size: 0.76rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
}
</style>
