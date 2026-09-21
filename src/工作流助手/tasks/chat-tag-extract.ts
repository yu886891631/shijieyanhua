import { loadSettings } from '../settings';
import { resolveEffectiveSettings } from './effective-settings';
import { extractInjectTagsFromResponse, getChatExtractTagSpecs } from './tag-extract';
import { isChatMessageFloorAccessible } from './message-floor';
import { inheritTagVariables, writeFloorTagValues } from './tag-variables';
import type { ScriptSettings } from './schema';

export function getChatExtractTagSpecsFromSettings(
  settings: ScriptSettings,
  source: 'user' | 'assistant',
): string[] {
  return getChatExtractTagSpecs(settings.chatExtractTags, source);
}

export function extractAndWriteChatTags(
  messageId: number,
  text: string,
  tagSpecs: string[],
): Record<string, string> {
  if (!tagSpecs.length || !isChatMessageFloorAccessible(messageId)) return {};

  const { extractedTags } = extractInjectTagsFromResponse(text, tagSpecs);
  if (!Object.keys(extractedTags).length) return {};

  writeFloorTagValues(messageId, extractedTags);
  return extractedTags;
}

export function applyUserChatTagExtract(messageId: number, settings?: ScriptSettings): Record<string, string> {
  const resolved = settings ?? resolveEffectiveSettings(loadSettings());
  if (!resolved.enabled) return {};

  const tagSpecs = getChatExtractTagSpecsFromSettings(resolved, 'user');
  if (!tagSpecs.length) return {};

  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'user') return {};

  return extractAndWriteChatTags(messageId, msg.message ?? '', tagSpecs);
}

export function applyAssistantChatTagExtract(
  messageId: number,
  settings?: ScriptSettings,
  options?: { isRerun?: boolean },
): Record<string, string> {
  const resolved = settings ?? resolveEffectiveSettings(loadSettings());
  if (!resolved.enabled) return {};

  const tagSpecs = getChatExtractTagSpecsFromSettings(resolved, 'assistant');
  if (!tagSpecs.length) return {};

  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return {};

  if (!options?.isRerun) {
    inheritTagVariables(messageId);
  }

  return extractAndWriteChatTags(messageId, msg.message ?? '', tagSpecs);
}

export function registerUserChatTagExtractTrigger(): EventOnReturn {
  const off = eventMakeLast(tavern_events.MESSAGE_SENT, (messageId: number) => {
    errorCatched(() => applyUserChatTagExtract(messageId))();
  });

  return { stop: () => off.stop() };
}
