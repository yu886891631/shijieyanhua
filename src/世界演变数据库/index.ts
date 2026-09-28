import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import { WorldEvolutionMutationScheduler } from './mutation-scheduler';
import { WORLD_EVOLUTION_DB_VERSION } from './types';

const LEGACY_SCRIPT_BUTTON = '打开世界演变数据库';

$(() => {
  // 更新既有安装时移除旧入口，避免与统一控制台的按钮并存。
  updateScriptButtonsWith(buttons => buttons.filter(button => button.name !== LEGACY_SCRIPT_BUTTON));
  const mutationScheduler = new WorldEvolutionMutationScheduler();
  const stopDeleted = eventOn(tavern_events.MESSAGE_DELETED, (messageId: number) => {
    mutationScheduler.schedule({
      chatKey: getCurrentChatKey(),
      messageId,
      kind: 'message_deleted',
    });
  });
  const stopSwiped = eventOn(tavern_events.MESSAGE_SWIPED, (messageId: number) => {
    mutationScheduler.schedule({
      chatKey: getCurrentChatKey(),
      messageId,
      kind: 'message_swiped',
    });
  });
  $(window).one('pagehide.world-evolution-db-mutations', () => {
    mutationScheduler.stop();
    stopDeleted.stop();
    stopSwiped.stop();
  });
  console.info(`[世界演变数据库] 已加载：后台回放监听 ${WORLD_EVOLUTION_DB_VERSION}`);
});
