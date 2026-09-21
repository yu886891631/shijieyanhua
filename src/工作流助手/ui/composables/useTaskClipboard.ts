import { computed, readonly, ref } from 'vue';
import type { PostProcessTask } from '../../tasks/schema';

const clipboard = ref<PostProcessTask | null>(null);
const clipboardSourcePreset = ref('');

export function useTaskClipboard() {
  const hasClipboard = computed(() => clipboard.value != null);

  function copyTask(task: PostProcessTask, presetName?: string): void {
    clipboard.value = _.cloneDeep(task);
    clipboardSourcePreset.value = presetName?.trim() ?? '';
  }

  function clearClipboard(): void {
    clipboard.value = null;
    clipboardSourcePreset.value = '';
  }

  return {
    clipboard: readonly(clipboard),
    clipboardSourcePreset: readonly(clipboardSourcePreset),
    hasClipboard,
    copyTask,
    clearClipboard,
  };
}
