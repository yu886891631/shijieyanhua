import { readonly, ref, shallowRef } from 'vue';

export type AcuPromptConfig = {
  placeholder?: string;
  defaultValue?: string;
};

export type AcuConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  prompt?: AcuPromptConfig;
};

type ResolvedAcuConfirmOptions = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  prompt?: AcuPromptConfig;
};

const visible = ref(false);
const options = shallowRef<ResolvedAcuConfirmOptions>({
  title: '请确认',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: true,
});

type DialogMode = 'confirm' | 'prompt';
let mode: DialogMode = 'confirm';
let confirmResolver: ((value: boolean) => void) | null = null;
let promptResolver: ((value: string | null) => void) | null = null;

function resolveOptions(opts: AcuConfirmOptions): ResolvedAcuConfirmOptions {
  return {
    title: opts.title ?? '请确认',
    message: opts.message,
    confirmText: opts.confirmText ?? '确定',
    cancelText: opts.cancelText ?? '取消',
    danger: opts.danger ?? true,
    prompt: opts.prompt,
  };
}

function closeDialog(): void {
  visible.value = false;
  confirmResolver = null;
  promptResolver = null;
}

export function resolveAcuConfirm(confirmed: boolean, inputValue?: string): void {
  if (mode === 'prompt') {
    const resolve = promptResolver;
    closeDialog();
    if (!confirmed) {
      resolve?.(null);
      return;
    }
    const text = (inputValue ?? '').trim();
    resolve?.(text || null);
    return;
  }

  const resolve = confirmResolver;
  closeDialog();
  resolve?.(confirmed);
}

export function acuConfirm(opts: AcuConfirmOptions): Promise<boolean> {
  if (confirmResolver || promptResolver) {
    resolveAcuConfirm(false);
  }

  mode = 'confirm';
  options.value = resolveOptions({ ...opts, prompt: undefined });

  return new Promise<boolean>(resolve => {
    confirmResolver = resolve;
    visible.value = true;
  });
}

export function acuPrompt(opts: AcuConfirmOptions & { prompt: AcuPromptConfig }): Promise<string | null> {
  if (confirmResolver || promptResolver) {
    resolveAcuConfirm(false);
  }

  mode = 'prompt';
  options.value = resolveOptions(opts);

  return new Promise<string | null>(resolve => {
    promptResolver = resolve;
    visible.value = true;
  });
}

export function useAcuConfirmHost() {
  return {
    visible: readonly(visible),
    options: readonly(options),
  };
}
