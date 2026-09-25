import { getCurrentChatKey } from '../工作流助手/api/chat-key';
import { ACU_PP_WORKFLOW_COMPLETED, type WorkflowCompletedPayload } from '../工作流助手/tasks/events';
import { loadSettings } from './store';
import { openWorldEvolutionPanel } from './ui';
import { runWorldEvolution } from './engine';

const SCRIPT_BUTTON = '打开世界演变面板';
const LOG_PREFIX = '[世界演变]';

function registerWorldEvolution(): void {
  appendInexistentScriptButtons([{ name: SCRIPT_BUTTON, visible: true }]);
  eventOn(getButtonEvent(SCRIPT_BUTTON), () => openWorldEvolutionPanel());

  eventOn(ACU_PP_WORKFLOW_COMPLETED, (payload: WorkflowCompletedPayload) => {
    const settings = loadSettings();
    if (!settings.enabled || !settings.autoRun || payload.cancelled || !payload.hasSuccess) return;
    if (payload.chatKey !== getCurrentChatKey()) return;
    void runWorldEvolution(payload.messageId, { source: 'auto' });
  });

  eventOn(tavern_events.CHAT_CHANGED, () => {
    console.info(`${LOG_PREFIX} 已切换聊天，等待下一轮工作流完成信号`);
  });

  console.info(`${LOG_PREFIX} 已加载：独立世界演变插件；默认关闭`);
}

$(() => {
  registerWorldEvolution();
  // 面板不强制打开；只在脚本按钮中提供入口。
});
