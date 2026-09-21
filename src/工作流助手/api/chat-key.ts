export function getCurrentChatKey(): string {
  try {
    const ctx = (window.parent as Window & { SillyTavern?: { getContext?: () => { chatId?: string } } })
      .SillyTavern?.getContext?.();
    const id = String(ctx?.chatId || '').trim();
    return id || 'unknown_chat';
  } catch {
    return 'unknown_chat';
  }
}
