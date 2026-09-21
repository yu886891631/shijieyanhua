<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface PresetDropdownItem {
  name?: string;
  value?: string;
  label?: string;
  meta?: string;
}

const props = withDefaults(
  defineProps<{
    items: PresetDropdownItem[];
    modelValue: string;
    defaultName: string;
    emptyText?: string;
    placeholder?: string;
    disabled?: boolean;
  }>(),
  {
    emptyText: '暂无预设',
    placeholder: '未选择',
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', name: string): void;
  (e: 'set-default', name: string): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const selectedLabel = computed(() => {
  const item = props.items.find(i => itemValue(i) === props.modelValue);
  return item ? itemLabel(item) : props.placeholder;
});

function itemValue(item: PresetDropdownItem): string {
  return item.value ?? item.name ?? '';
}

function itemLabel(item: PresetDropdownItem): string {
  return item.label ?? item.name ?? item.value ?? '';
}

function toggleOpen() {
  if (props.disabled) return;
  open.value = !open.value;
}

function selectItem(value: string) {
  if (props.disabled) return;
  emit('update:modelValue', value);
  open.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside);
});
</script>

<template>
  <div ref="rootRef" class="acu-preset-dd" :class="{ 'acu-preset-dd--disabled': disabled }">
    <button type="button" class="acu-preset-dd__trigger" :disabled="disabled" @click="toggleOpen">
      <span class="acu-preset-dd__label">{{ selectedLabel }}</span>
      <span class="acu-preset-dd__caret" :class="{ 'acu-preset-dd__caret--open': open }">▾</span>
    </button>
    <ul v-if="open" class="acu-preset-dd__menu">
      <li
        v-for="item in items"
        :key="itemValue(item)"
        class="acu-preset-dd__item"
        :class="{ 'acu-preset-dd__item--active': itemValue(item) === modelValue }"
        @click="selectItem(itemValue(item))"
      >
        <span class="acu-preset-dd__item-name">{{ itemLabel(item) }}</span>
        <span v-if="item.meta" class="acu-preset-dd__item-meta">{{ item.meta }}</span>
        <button
          type="button"
          class="acu-preset-dd__star"
          :class="{ 'acu-preset-dd__star--active': itemValue(item) === defaultName }"
          :title="itemValue(item) === defaultName ? '全局默认' : '设为全局默认'"
          @click.stop="emit('set-default', itemValue(item))"
        >
          {{ itemValue(item) === defaultName ? '★' : '☆' }}
        </button>
        <span v-if="itemValue(item) === modelValue" class="acu-preset-dd__check">✓</span>
      </li>
      <li v-if="!items.length" class="acu-preset-dd__empty">{{ emptyText }}</li>
    </ul>
  </div>
</template>
