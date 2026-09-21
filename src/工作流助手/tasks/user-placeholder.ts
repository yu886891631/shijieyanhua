import type { DataSnapshot } from '../bridge/database-api';
import { getProtagonistInfoWorldbookContent } from '../worldbook/protagonist-info';
import { processTemplateText } from './template-process';

function readTopLevelWindow(): Window | null {
  try {
    return window.parent ?? window;
  } catch {
    return window;
  }
}

/** 对齐 shujuku getPersonaDescription_ACU */
export function getPersonaDescriptionForPlaceholder(): string {
  try {
    const win = readTopLevelWindow() as Window & {
      SillyTavern?: { getContext?: () => { powerUserSettings?: { persona_description?: string } } };
      power_user?: { persona_description?: string };
    };
    const stContext = win?.SillyTavern?.getContext?.();
    const fromContext = stContext?.powerUserSettings?.persona_description;
    if (fromContext) return String(fromContext);
    const fromPowerUser = win?.power_user?.persona_description;
    if (fromPowerUser) return String(fromPowerUser);
  } catch {
    // fall through
  }
  try {
    return getPersona('current').description ?? '';
  } catch {
    return '';
  }
}

export function buildDollarURaw(personaDesc: string, protagonistContent: string): string {
  return [
    '<{{user}}初始设定>',
    personaDesc,
    '</{{user}}初始设定>',
    '<{{user}}最新数据>',
    protagonistContent,
    '</{{user}}最新数据>',
  ].join('\n');
}

export async function resolveDollarUContent(snapshot: DataSnapshot, messageId: number): Promise<string> {
  const personaDesc = getPersonaDescriptionForPlaceholder();
  let protagonistContent = '';
  try {
    protagonistContent = await getProtagonistInfoWorldbookContent(snapshot.tablesJson, messageId);
  } catch {
    protagonistContent = '';
  }
  const raw = buildDollarURaw(personaDesc, protagonistContent);
  try {
    return await processTemplateText(raw, messageId, { role: 'system' });
  } catch {
    return raw;
  }
}
