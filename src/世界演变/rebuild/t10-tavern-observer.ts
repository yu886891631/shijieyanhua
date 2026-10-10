/** TavernHelper memory observation only. These APIs do NOT establish durable save/CAS. */
import { copyT10, normalizeT10Document, type T10Binding, type T10Document } from './t10-host-protocol';
export interface T10TavernReader {
  binding(): T10Binding;
  getVariables: () => Record<string, unknown>;
  getChatMessages: () => unknown[];
}
/** Caller supplies official getVariables({type:'chat'}) and getChatMessages(...,{include_swipes:true}).
 * No automatic initialization, metadata write, setChatMessages, saveChat or old IDB import. */
export function observeT10Tavern(reader: T10TavernReader): {
  source: 'memory-only';
  writable: false;
  document: T10Document;
} {
  const before = copyT10(reader.binding());
  const document = normalizeT10Document({
    binding: before,
    variables: reader.getVariables(),
    messages: reader.getChatMessages(),
  });
  const after = reader.binding();
  if (before.hostChatId !== after.hostChatId || before.characterId !== after.characterId)
    throw new Error('读取期间已切换聊天；放弃这份观察。');
  return { source: 'memory-only', writable: false, document };
}
