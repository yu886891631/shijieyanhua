# 世界演变控制台 UI-2 独立 API 配置页面路由

> 完成日期：2026-10-01
> UI 计划版本：A0.1.0-alpha.12-ui.1
> 基线提交：`1761d91`
> 状态：UI-2 已完成，下一阶段为 UI-3

## 1. 本阶段目标

将 API 配置从“自动演变”页面拆出，增加“演变配置 → API 配置”独立入口，同时保持现有配置数据、路由逻辑和兼容桥接不变。

## 2. 已完成修改

修改文件：

```text
src/世界演变/console/Workspace.vue
```

具体内容：

- `WorkspacePage` 增加 `api` 页面类型；
- “演变配置”导航增加“API 配置”项；
- 增加“配置 / API 配置”面包屑和页面标题；
- `ApiSettingsPanel` 移到独立 API 页面容器；
- “自动演变”页面只保留 `mountWorldEvolutionPanel()` 的运行面板容器；
- API 页面和自动演变页面均使用 `v-show`，切换页面时不销毁 API 表单实例，避免未保存输入丢失；
- 未修改 `ui.ts` 中旧版 API 兼容字段，旧入口收口留到 UI-4；
- 未修改 API 配置变量、IndexedDB、世界书、MVU、工作流助手桥接或真实 API 调用逻辑。

## 3. 验证结果

定向 ESLint：

```powershell
pnpm exec eslint --no-warn-ignored "src/世界演变/console/Workspace.vue"
```

结果：通过。

世界演变与数据库测试：

```powershell
pnpm exec tsx --test "src/世界演变/*.test.ts" "src/世界演变数据库/*.test.ts"
```

结果：81/81 通过，未调用真实 API。

生产构建：

```powershell
pnpm build
```

结果：构建成功；输出包含仓库既有 Webpack 警告（缺失旧工作流助手导出和包体积提示），没有新增编译错误。

全量 `pnpm lint` 仍受仓库既有问题影响，未作为本阶段通过条件；本阶段只采用变更文件的定向检查。

## 4. 下一阶段

UI-3 将对独立 API 页面做面板级验收和布局收口：确认预设、Key 脱敏、主备路由、工作流助手桥接和模拟连接测试在页面移动后均保持可用，并继续保持旧兼容字段不被删除。
