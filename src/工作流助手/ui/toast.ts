import { ensureAcuToastStyles } from './toast-styles';

type ToastType = 'success' | 'info' | 'warning' | 'error';

const TOAST_CLASS: Record<ToastType, string> = {
  success: 'toast acu-pp-toast acu-pp-toast--success',
  info: 'toast acu-pp-toast acu-pp-toast--info',
  warning: 'toast acu-pp-toast acu-pp-toast--warning',
  error: 'toast acu-pp-toast acu-pp-toast--error',
};

const DEFAULT_TIMEOUT: Record<ToastType, number> = {
  success: 2500,
  info: 2500,
  warning: 3500,
  error: 5000,
};

export function acuToast(
  type: ToastType,
  message: string,
  options?: { timeOut?: number; title?: string; escapeHtml?: boolean },
): JQuery {
  ensureAcuToastStyles();
  return toastr[type](message, options?.title ?? '', {
    timeOut: options?.timeOut ?? DEFAULT_TIMEOUT[type],
    toastClass: TOAST_CLASS[type],
    escapeHtml: options?.escapeHtml ?? true,
  });
}
