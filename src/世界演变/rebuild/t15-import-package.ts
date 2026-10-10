/** Pure package metadata. Import stays disabled and never pre-authorizes writes or paid requests. */
import { T15_HOST_VERSION, T15_HOST_SCRIPT_ID } from './t15-import-runtime';
export function createT15HostImportPackage(bundle: string) {
  return {
    type: 'script',
    enabled: false,
    name: `世界演变 ${T15_HOST_VERSION}（真实接线候选，未真机验收）`,
    id: T15_HOST_SCRIPT_ID,
    content: bundle,
    info: '独立自包含真实宿主候选，内嵌 SQLite/WASM。默认禁用；打开只显示连接页。只读检查后需另行允许测试聊天保存，真实 API/自动运行默认关闭。世界资料保存会写当前聊天，不是隔离沙盒；只在备份的单角色测试聊天、单活动页面使用。必要数据库仍需固定版本整轮通知补丁，未安装时阻断；不会自动关闭旧脚本、迁移旧库、创建或改绑世界书。尚未完成真机验收。',
    button: { enabled: true, buttons: [{ name: '打开世界演变真实接线候选', visible: true }] },
    data: {
      candidate_version: T15_HOST_VERSION,
      mode: 'controlled-native-candidate',
      paid_requests_preapproved: false,
      chat_writes_preapproved: false,
    },
    export_with: { tavern_helper: 'script' },
  };
}
