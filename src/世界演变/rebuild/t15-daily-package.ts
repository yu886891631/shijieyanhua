/** New package; old host/import candidates remain unchanged. No preapproved paid/automatic operations. */
import { T15_DAILY_VERSION, T15_DAILY_SCRIPT_ID } from './t15-daily-runtime';
export function createT15DailyImportPackage(bundle: string) {
  return {
    type: 'script',
    enabled: false,
    name: `世界演变 ${T15_DAILY_VERSION}（直接打开工作台，测试版）`,
    id: T15_DAILY_SCRIPT_ID,
    content: bundle,
    info: '打开即显示完整控制台，自动只读识别当前单角色聊天；无需手动连接。查看不创建存档、不调用模型、不写世界书。首次创建资料时单次确认；保存修改会写当前聊天，不是隔离沙盒。API 配置可直接使用，真实演变与自动运行仍需明确启用；数据库完成接口缺失只阻断演变、不阻断浏览。请保留聊天备份、停用旧世界演变脚本，使用一个活动页面。尚未完成你的真实酒馆端到端验收。',
    button: { enabled: true, buttons: [{ name: '打开世界演变面板', visible: true }] },
    data: {
      candidate_version: T15_DAILY_VERSION,
      mode: 'read-first-native-candidate',
      paid_requests_preapproved: false,
      chat_writes_preapproved: false,
    },
    export_with: { tavern_helper: 'script' },
  };
}
