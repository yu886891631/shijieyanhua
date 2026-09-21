<template>
  <div
    class="fold"
    :class="[
      `fold--${variant}`,
      {
        'fold--open': open,
        'fold--leaf': leaf,
      },
    ]"
  >
    <button type="button" class="fold__head" :disabled="leaf" @click="toggle">
      <span v-if="!leaf" class="fold__arrow" aria-hidden="true">▾</span>
      <span v-if="emoji" class="fold__emoji" aria-hidden="true">{{ emoji }}</span>
      <span v-else-if="icon" class="fold__icon" aria-hidden="true"><i :class="icon"></i></span>
      <span class="fold__title">{{ title }}</span>
      <span v-if="summary" class="fold__summary">{{ summary }}</span>
      <span v-if="badge" class="fold__badge" :class="badgeClass">{{ badge }}</span>
    </button>
    <div v-show="leaf || open" class="fold__body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string;
    summary?: string;
    badge?: string;
    badgeClass?: string;
    icon?: string;
    emoji?: string;
    variant?: 'section' | 'entity' | 'sub';
    defaultOpen?: boolean;
    leaf?: boolean;
    forcedOpen?: boolean | null;
  }>(),
  {
    summary: '',
    badge: '',
    badgeClass: '',
    icon: '',
    emoji: '',
    variant: 'sub',
    defaultOpen: false,
    leaf: false,
    forcedOpen: null,
  },
);

const localOpen = ref(props.defaultOpen);

watch(
  () => props.defaultOpen,
  v => {
    localOpen.value = v;
  },
);

watch(
  () => props.forcedOpen,
  v => {
    if (v === true) localOpen.value = true;
    if (v === false) localOpen.value = false;
  },
);

const open = computed(() => (props.leaf ? true : localOpen.value));

function toggle() {
  if (props.leaf) return;
  localOpen.value = !localOpen.value;
}
</script>

<style lang="scss" scoped>
.fold {
  width: 100%;
  box-sizing: border-box;

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    width: 100%;
    margin: 0;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
    font: inherit;
    -webkit-tap-highlight-color: transparent;

    &:disabled {
      cursor: default;
    }
  }

  &__arrow {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(176, 125, 68, 0.1);
    color: var(--accent-primary);
    font-size: 12px;
    transition: transform 0.35s cubic-bezier(0.33, 1, 0.68, 1);
    line-height: 1;
  }

  &:not(.fold--open) > .fold__head .fold__arrow {
    transform: rotate(-90deg);
  }

  &__emoji {
    font-size: 1.1em;
    line-height: 1;
    flex-shrink: 0;
  }

  &__icon {
    color: var(--accent-primary);
    font-size: 0.9em;
    flex-shrink: 0;
  }

  &__title {
    font-weight: 700;
    letter-spacing: 0.02em;
    min-width: 0;
  }

  &__summary {
    flex: 1 1 6em;
    min-width: 0;
    color: var(--text-tertiary);
    font-size: 0.78em;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  &__badge {
    margin-left: auto;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 12px;
    background: rgba(176, 125, 68, 0.12);
    color: var(--accent-primary);
    letter-spacing: 0.4px;
    white-space: nowrap;

    &.is-plus {
      color: var(--accent-green);
      background: rgba(74, 124, 92, 0.15);
      border: 1px solid rgba(74, 124, 92, 0.25);
    }

    &.is-minus {
      color: var(--accent-red);
      background: rgba(184, 72, 58, 0.15);
      border: 1px solid rgba(184, 72, 58, 0.25);
    }
  }

  &__body {
    overflow-wrap: anywhere;
    color: var(--text-secondary);
  }

  /* —— section —— */
  &--section {
    background: var(--bg-card);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-xs);
    overflow: hidden;
    position: relative;
    margin: 0;
    transition: box-shadow var(--transition-smooth), border-color var(--transition-fast);

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      width: 4px;
      height: 100%;
      background: linear-gradient(
        180deg,
        var(--accent-primary) 0%,
        var(--accent-teal) 50%,
        var(--accent-warm) 100%
      );
      border-radius: var(--radius-md) 0 0 var(--radius-md);
      opacity: 0.7;
      z-index: 1;
      pointer-events: none;
    }

    &:hover {
      box-shadow: var(--shadow-sm);
      border-color: var(--border-subtle);
    }

    > .fold__head {
      padding: 10px 14px 10px 16px;
      position: relative;
      z-index: 2;

      &:hover:not(:disabled) {
        background: rgba(176, 125, 68, 0.05);
      }
    }

    > .fold__head .fold__title {
      font-family: var(--font-display);
      font-size: 0.95rem;
    }

    > .fold__body {
      padding: 4px 14px 14px 16px;
      position: relative;
      z-index: 2;
    }
  }

  /* —— entity —— */
  &--entity {
    background: var(--bg-card-alt);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    margin: 8px 0;
    overflow: hidden;

    > .fold__head {
      padding: 10px 14px;
      background: linear-gradient(
        135deg,
        rgba(176, 125, 68, 0.08) 0%,
        rgba(176, 125, 68, 0.02) 100%
      );
      border-bottom: 1px solid transparent;
      font-family: var(--font-display);
      font-size: 0.85rem;
    }

    &.fold--open > .fold__head {
      border-bottom-color: var(--border-subtle);
    }

    > .fold__body {
      padding: 10px 14px;
    }
  }

  /* —— sub —— */
  &--sub {
    background: var(--bg-card-alt);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    margin: 6px 0;
    padding: 0;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

    &:hover {
      border-color: var(--border-accent);
      box-shadow: var(--shadow-xs);
    }

    > .fold__head {
      padding: 8px 10px;
      align-items: flex-start;
      min-height: 32px;

      &:hover:not(:disabled) {
        background: rgba(176, 125, 68, 0.05);
      }
    }

    > .fold__head .fold__title {
      font-size: 0.82rem;
      font-weight: 650;
    }

    > .fold__head .fold__arrow {
      width: 20px;
      height: 20px;
      font-size: 10px;
      margin-top: 2px;
    }

    > .fold__body {
      padding: 0 10px 10px;
    }

    &.fold--leaf {
      background: transparent;
      border: 0;
      margin: 4px 0;

      > .fold__head {
        padding: 4px 0;
      }

      > .fold__body {
        padding: 0 0 4px;
      }
    }
  }
}

.theme-dark .fold--section::before {
  opacity: 0.85;
}

@media (max-width: 640px) {
  .fold__head {
    align-items: flex-start;
    gap: 4px 6px;
  }

  .fold__arrow {
    width: 36px;
    height: 36px;
  }

  .fold__summary {
    flex: 1 1 100%;
    order: 10;
    font-size: 0.72em;
    line-height: 1.4;
    padding-left: calc(36px + 6px);
    overflow-wrap: anywhere;
  }

  .fold__badge {
    margin-left: 0;
    flex-shrink: 0;
  }

  .fold--section > .fold__head {
    padding: 8px 10px 8px 12px;
  }

  .fold--section > .fold__head .fold__title {
    font-size: 0.9rem;
  }

  .fold--section > .fold__body {
    padding: 2px 10px 10px 12px;
  }

  .fold--entity > .fold__head {
    padding: 8px 10px;
    font-size: 0.8rem;
  }

  .fold--entity > .fold__body {
    padding: 8px 10px;
  }

  .fold--sub > .fold__head {
    padding: 8px;
    min-height: 40px;
    align-items: center;
  }

  .fold--sub > .fold__head .fold__arrow {
    width: 36px;
    height: 36px;
    font-size: 12px;
    margin-top: 0;
  }

  .fold--sub > .fold__body {
    padding: 0 8px 8px;
  }

  .fold--sub.fold--leaf > .fold__head {
    min-height: 0;
    padding: 4px 0;
  }
}
</style>
