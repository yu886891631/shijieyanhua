const warnedRoles = new Set<string>();

export type NormalizedPromptRole = 'system' | 'user' | 'assistant';

export function normalizePromptRole(role: unknown): NormalizedPromptRole {
  const normalized = String(role ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'system':
      return 'system';
    case 'assistant':
    case 'ai':
      return 'assistant';
    case 'user':
      return 'user';
    default:
      if (normalized) {
        const key = String(role);
        if (!warnedRoles.has(key)) {
          warnedRoles.add(key);
          console.warn(`[工作流助手] 未知 prompt role「${role}」，已按 user 处理`);
        }
      }
      return 'user';
  }
}
