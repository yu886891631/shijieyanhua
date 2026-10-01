# 世界演变 API 页面重排 UI-1 基线与隔离记录

> 记录日期：2026-10-01
> UI 计划版本：A0.1.0-alpha.12-ui.1
> 基线提交：`cfe4c664c76ee2777c9b0fd4f61b01fdee4fdcea`
> 开发分支：`codex/world-evolution-alpha12-ui`
> 状态：UI-1 已完成，下一阶段为 UI-2 独立 API 页面路由

## 1. 基线范围

本阶段只建立页面重排的安全边界，不修改页面逻辑，不迁移变量，不调用真实 API。

保留的回退版本：

- alpha.11：`A0.1.0-alpha.11`
- alpha.11 导入包：`导入到酒馆中/酒馆助手脚本-世界演变控制台-A0.1.0-alpha.11-API测试版.json`
- alpha.12 发布候选：`A0.1.0-alpha.12`
- alpha.12 导入包：`导入到酒馆中/酒馆助手脚本-世界演变控制台-A0.1.0-alpha.12-API测试版.json`

alpha.12 发布候选仍默认关闭，同时加载世界演变控制台和世界演变数据库。数据库版本继续为 `A0.1.0-alpha.11`，不在 UI 重排中升级。

## 2. 分支隔离

UI 重排使用独立分支：

```text
codex/world-evolution-alpha12-ui
```

该分支从 API 集成计划书提交 `cfe4c66` 创建。此前的 API 路由、引擎接入、事务恢复和 alpha.12 发布候选提交均作为只读基线保留。

当前远程基线：

```text
origin: https://github.com/yu886891631/shijieyanhua.git
```

本阶段不修改 `main`，不覆盖 alpha.11 文件，也不修改聊天中的运行数据。

## 3. 导入包指纹

以下指纹用于确认 UI 重排前的导入包未被意外改写：

```text
E137BEBCEE4918172B47C21AE4630B687B8B9FBF23E3BC8F062EE1FC71C61480  导入到酒馆中/酒馆助手脚本-世界演变控制台-A0.1.0-alpha.11-API测试版.json
BDFDCEBDD7B2DAEC0048B21125D073848D958BF6490F04F529BF4FD1A5E3C3D8  导入到酒馆中/酒馆助手脚本-世界演变控制台-A0.1.0-alpha.12-API测试版.json
```

校验命令：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath `
  '导入到酒馆中/酒馆助手脚本-世界演变控制台-A0.1.0-alpha.11-API测试版.json', `
  '导入到酒馆中/酒馆助手脚本-世界演变控制台-A0.1.0-alpha.12-API测试版.json'
```

## 4. 页面与源码指纹

UI-2 至 UI-6 预计会涉及以下文件。UI-1 记录它们的当前状态，后续差异应限制在页面重排范围内：

```text
6832908B9269E623CCBC22EDC2EF094707315341DEECC9A566F23A90F10F5D97  src/世界演变/console/Workspace.vue
5F09439B83A24F47A3A275DB5A8A9A885CF38CD07C654C1E10689C223F29F7D3  src/世界演变/console/ApiSettingsPanel.vue
133E4369CE935929DA1094223FA7B3E0C249E85295BC0B56F8032AD9377B25E0  src/世界演变/ui.ts
455A2178E3AE034FDAB9B34BAE5916CEA6D476229E919323C9C8ECB14B0CE42B  src/世界演变/api-config.ts
2DBF049E518071AD52AC583B0081CAB8E2AFDE30E5D39A10D4E01EB6013191DC  src/世界演变/store.ts
F4E23AF91DC45AC10587CCAC53D5DFBBB658029E8C5A58185F2FD58FE1EE0D95  src/世界演变/index.ts
E5D21BD5AA2F3183CCD10095369B33865FA3400A5AAF2F4CD1DCDB9B4D96B19C  src/世界演变数据库/types.ts
```

当前入口结构：

```text
Workspace.vue
  ├─ 工作台：总览、世界资料、楼层记录、世界书投影
  └─ 演变配置：自动演变（内含 ApiSettingsPanel）、填表提示词、备份与迁移

ui.ts
  └─ 旧运行面板仍有一套工作流助手 API 预设/备用路由编辑区域
```

因此后续 UI-4 必须处理旧 `ui.ts` 入口，不能只移动新版 `ApiSettingsPanel`，否则会留下两套可编辑 API 配置。

## 5. 数据与变量隔离边界

页面重排不得改变：

- `world_evolution_api_config_v1` 内置 API 配置变量；
- 旧版 `apiPresetName` 和 `apiFallbackPresetNames` 兼容字段；
- API Key 脱敏、导出和日志规则；
- API 路由优先级和工作流助手桥接；
- `acu-world-evolution-db` IndexedDB 数据；
- revision、floor_run、checkpoint 和世界书投影账本；
- `WorldEvolution-*` 角色卡主世界书条目；
- MVU、工作流助手变量和聊天消息。

本阶段不执行迁移函数，不调用 `saveWorldEvolutionApiConfiguration()`，不执行数据库写入，不触发世界演变。

## 6. 页面视觉基线

视觉基线采用用户于 2026-10-01 提供的 alpha.12 控制台截图，当前观察结果：

- API 配置完整嵌在“自动演变”页面；
- API 预设、编辑表单、路由和桥接状态占据自动演变页面的大部分高度；
- 运行控制内容被推到较下方，首屏不够集中；
- 左侧导航已有“演变配置”分组，但缺少独立“API 配置”项；
- 需要保留现有主题、侧栏和居中工作台结构。

截图只作为 UI 参考，不复制进导入包，不写入聊天、世界书或数据库。

## 7. UI-1 完成检查

- [x] 建立独立 UI 重排分支 `codex/world-evolution-alpha12-ui`；
- [x] 记录 alpha.11 和 alpha.12 导入包 SHA-256；
- [x] 记录 API、控制台、旧运行面板和数据库版本相关源码指纹；
- [x] 确认 alpha.11 是可回退版本，未被覆盖；
- [x] 确认 alpha.12 默认关闭，未调用真实 API；
- [x] 确认本阶段不执行变量迁移、数据库迁移或世界书写入；
- [x] 记录当前两套 API 编辑入口，为 UI-4 收口提供基线。

下一阶段：**UI-2：增加独立“API 配置”页面路由**。
