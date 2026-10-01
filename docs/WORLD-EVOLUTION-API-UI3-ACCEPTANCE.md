# 世界演变控制台 UI-3 面板迁移验收与布局收口

> 完成日期：2026-10-01
> UI 计划版本：A0.1.0-alpha.12-ui.1
> 基线提交：`d78afa0`
> 状态：UI-3 已完成，下一阶段为 UI-4 收口旧版运行面板 API 入口

## 1. 验收范围

本阶段验证 UI-2 移动到独立页面的 `ApiSettingsPanel`，并修正页面最大宽度下的对齐方式。没有修改 API 数据结构、存储位置、引擎路由或工作流助手桥接。

## 2. 行为检查

| 功能 | 实现/覆盖依据 | 结果 |
| --- | --- | --- |
| 已有预设读取与刷新后恢复 | 面板初始化调用 `loadWorldEvolutionApiConfiguration()`；API 配置 round-trip 测试 | 通过 |
| 新建、编辑、复制、删除预设 | 面板事件处理调用 API 配置 upsert/remove；Key 不随复制带入 | 通过代码检查 |
| 已存 Key 脱敏 | 编辑时表单 Key 清空，密码输入显示“已配置，留空表示保持原 Key”；配置导出脱敏测试 | 通过 |
| 显式清除已存 Key | 新增“清除已保存 Key”操作；保存前仅保存在表单状态 | 通过，新增配置单测 |
| 主 API 与备用路由 | 独立路由选择、备用勾选/排序和保存；配置引用一致性及 API failover 测试 | 通过 |
| 工作流助手兼容桥接 | `refreshBridge()` 只读取脱敏详情；路由测试覆盖桥接来源和优先级；界面注明检测不代表凭据验证 | 通过 |
| 模拟连接 | `simulatePreset()` 向客户端注入本地 `fetchImpl` 与本地 `Response`，没有网络请求 | 通过代码检查 |
| 页面切换保留未保存表单 | Workspace 的 API 页面使用 `v-show`，不会卸载面板实例 | 通过代码检查 |

## 3. 布局收口

`ApiSettingsPanel.vue` 的面板根元素保持 `max-width: 1100px`，补充 `width: 100%` 和水平自动外边距，使其在控制台可用区域中居中；页内副标题改为“预设、路由与桥接”，避免和控制台顶栏重复；原有窄屏媒体查询继续把表单和路由区域改为单列。页面滚动由 Workspace 的 `.we-page-scroll` 统一承载。

## 4. 自动化验证

API 配置、客户端和路由测试：

```powershell
pnpm exec tsx --test "src/世界演变/api-config.test.ts" "src/世界演变/api-client.test.ts" "src/世界演变/api-routing.test.ts"
```

全量世界演变与数据库测试：

```powershell
pnpm exec tsx --test "src/世界演变/*.test.ts" "src/世界演变数据库/*.test.ts"
```

ESLint：

```powershell
pnpm exec eslint --no-warn-ignored "src/世界演变/console/Workspace.vue" "src/世界演变/console/ApiSettingsPanel.vue" "src/世界演变/api-config.test.ts"
```

生产构建：

```powershell
pnpm build
```

本阶段 API 配置、客户端和路由测试 **23/23 通过**；完整世界演变与数据库测试 **82/82 通过**；变更文件定向 ESLint 通过；`pnpm build` 成功（包含既有 Webpack 警告）。

仓库没有 Vue 组件测试环境；按钮交互通过源代码检查和底层单测验证。当前没有已打开的 SillyTavern 页面，因此未声称完成真机视觉验收；仍需在后续真机验收中检查常用缩放和窄窗口布局。

已知非本阶段缺口：协议下拉仍提供“自定义”，但当前 API 客户端仍按 OpenAI Chat Completions 格式构造请求；选择“自定义”不会切换协议。桥接“已检测到路由”只代表检测到配置，不是凭据验证或实际连通性测试。协议支持和真实连接测试需单独处理，避免页面迁移阶段引入网络请求。

## 5. 安全与数据边界

- 没有调用真实 API，也没有消耗 API 额度；
- 没有读取或操作酒馆中的真实 API Key；Key 清除和脱敏测试使用单测内的假凭据与内存存储；
- 没有修改脚本变量、IndexedDB、世界书、聊天记录、MVU 或工作流助手设置；
- 没有生成或覆盖发布导入包。

## 6. 下一阶段

UI-4 收口 `src/世界演变/ui.ts` 中旧版可编辑 API 入口，保留旧设置兼容读取能力，避免产生两套可编辑主备 API 配置。
