<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue';
import { resolveAcuConfirm, useAcuConfirmHost } from './composables/useAcuConfirm';

const { visible, options } = useAcuConfirmHost();
const promptValue = ref('');
const promptInputRef = ref<HTMLInputElement | null>(null);

function onCancel(): void {
  resolveAcuConfirm(false);
}

function onConfirm(): void {
  if (options.value.prompt) {
    resolveAcuConfirm(true, promptValue.value);
    return;
  }
  resolveAcuConfirm(true);
}

function onKeydown(event: KeyboardEvent): void {
  if (!visible.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    onCancel();
  }
}

function onPromptKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    onConfirm();
  }
}

watch(visible, open => {
  if (open) {
    if (options.value.prompt) {
      promptValue.value = options.value.prompt.defaultValue ?? '';
      void nextTick(() => promptInputRef.value?.focus());
    }
    document.addEventListener('keydown', onKeydown);
  } else {
    document.removeEventListener('keydown', onKeydown);
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div
    v-if="visible"
    class="acu-confirm-overlay"
    @click.self="onCancel"
  >
    <div
      class="acu-confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="'acu-confirm-title'"
      :aria-describedby="'acu-confirm-message'"
    >
      <h4 id="acu-confirm-title" class="acu-confirm-dialog__title">{{ options.title }}</h4>
      <p id="acu-confirm-message" class="acu-confirm-dialog__message">{{ options.message }}</p>
      <input
        v-if="options.prompt"
        ref="promptInputRef"
        v-model="promptValue"
        class="acu-input acu-confirm-dialog__input"
        type="text"
        :placeholder="options.prompt.placeholder"
        @keydown="onPromptKeydown"
      />
      <div class="acu-confirm-dialog__actions">
        <button class="acu-btn" type="button" @click="onCancel">{{ options.cancelText }}</button>
        <button
          class="acu-btn"
          :class="{ danger: options.danger, primary: !options.danger }"
          type="button"
          @click="onConfirm"
        >
          {{ options.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
