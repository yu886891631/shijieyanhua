<script setup lang="ts">
import { computed } from 'vue';
import type { z } from 'zod';
import type { PromptGroupSchema } from '../tasks/schema';
import AcuToggle from './AcuToggle.vue';

type PromptGroup = z.infer<typeof PromptGroupSchema>;

const props = withDefaults(
  defineProps<{
    rowKey: string;
    group: PromptGroup;
    expanded: boolean;
    readonly?: boolean;
    autoBadge?: string;
    manualIndex?: number;
    manualCount?: number;
    disabled?: boolean;
    dragEnabled?: boolean;
    dragging?: boolean;
    dropMarker?: 'before' | 'after' | null;
  }>(),
  {
    readonly: false,
    autoBadge: '',
    manualIndex: -1,
    manualCount: 0,
    disabled: false,
    dragEnabled: true,
    dragging: false,
    dropMarker: null,
  },
);

const emit = defineEmits<{
  toggle: [];
  move: [delta: -1 | 1];
  remove: [];
  dragStart: [payload: { pointerId: number; clientY: number; fromIndex: number }];
}>();

const displayName = computed(() => props.group.name?.trim() || '未命名段');

const roleLabel = computed(() => props.group.role || 'user');

const showDragHandle = computed(
  () => !props.readonly && !props.disabled && props.dragEnabled && props.manualIndex >= 0,
);

function onHeaderClick() {
  emit('toggle');
}

function stopPropagation(e: Event) {
  e.stopPropagation();
}

function onDragHandlePointerDown(e: PointerEvent) {
  if (!showDragHandle.value) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget as HTMLElement;
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    // 部分环境不支持 capture，仍可走 window 监听
  }
  emit('dragStart', {
    pointerId: e.pointerId,
    clientY: e.clientY,
    fromIndex: props.manualIndex,
  });
}
</script>

<template>
  <div
    class="acu-prompt-group acu-prompt-group--collapsible"
    :class="{
      'acu-prompt-group--auto-preview': readonly,
      'acu-prompt-group--disabled': group.enabled === false,
      'acu-prompt-group--expanded': expanded,
      'acu-prompt-group--dragging': dragging,
      'acu-prompt-group--drop-before': dropMarker === 'before',
      'acu-prompt-group--drop-after': dropMarker === 'after',
    }"
    :data-manual-index="showDragHandle ? manualIndex : undefined"
  >
    <div class="acu-prompt-group__header-row">
      <span
        v-if="showDragHandle"
        class="acu-prompt-group__drag-handle"
        title="拖动排序"
        role="button"
        tabindex="-1"
        aria-label="拖动排序"
        @pointerdown="onDragHandlePointerDown"
        @click.stop
      >
        <i class="fa-fw fa-solid fa-grip-vertical" aria-hidden="true" />
      </span>
      <button
        type="button"
        class="acu-prompt-group__header"
        :aria-expanded="expanded"
        @click="onHeaderClick"
      >
        <span v-if="autoBadge" class="acu-prompt-group__auto-badge">{{ autoBadge }}</span>
        <span class="acu-prompt-group__header-main">
          <span class="acu-prompt-group__header-name" :title="displayName">{{ displayName }}</span>
          <span class="acu-prompt-group__role-tag">{{ roleLabel }}</span>
        </span>
        <i
          class="fa-fw fa-solid acu-prompt-group__chevron"
          :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'"
          aria-hidden="true"
        />
      </button>
    </div>

    <div v-show="expanded" class="acu-prompt-group__body" @click="stopPropagation">
      <div class="acu-row acu-prompt-group__toolbar">
        <input
          v-model="group.name"
          class="acu-input acu-prompt-group__name"
          type="text"
          placeholder="未命名段"
          :readonly="readonly || disabled"
          :disabled="readonly || disabled"
        />
        <select v-model="group.role" class="acu-select" :disabled="readonly || disabled">
          <option value="system">system</option>
          <option value="user">user</option>
          <option value="assistant">assistant</option>
        </select>
        <template v-if="!readonly">
          <button
            class="acu-btn acu-btn--sm"
            type="button"
            title="上移"
            :disabled="manualIndex <= 0 || disabled"
            @click="emit('move', -1)"
          >
            上移
          </button>
          <button
            class="acu-btn acu-btn--sm"
            type="button"
            title="下移"
            :disabled="manualIndex < 0 || manualIndex >= manualCount - 1 || disabled"
            @click="emit('move', 1)"
          >
            下移
          </button>
          <div class="acu-prompt-group__enable">
            <AcuToggle
              :model-value="group.enabled !== false"
              aria-label="启用本段"
              :disabled="disabled"
              @update:model-value="group.enabled = $event"
            />
          </div>
          <button
            class="acu-btn danger acu-btn--sm acu-prompt-group__delete"
            type="button"
            :disabled="disabled"
            @click="emit('remove')"
          >
            删段
          </button>
        </template>
      </div>
      <textarea
        v-model="group.content"
        class="acu-textarea acu-prompt-group__textarea"
        :readonly="readonly || disabled"
        :disabled="!readonly && disabled"
      />
    </div>
  </div>
</template>
