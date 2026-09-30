# 世界演变 API 内置化 alpha.12 基线

> 基线日期：2026-09-30  
> 对应旧版：A0.1.0-alpha.11  
> 对应提交：`7a0dd7724b931c1d54228c69db1c9ca4283cf7b6`  
> 开发分支：`codex/world-evolution-alpha12-api`  
> 状态：S1、S2、S3、S4、S5、S6 已完成；下一阶段为 S7

## 1. 基线目的

本文件记录内置 API 改造开始前的稳定边界。alpha.11 是可回退基线，alpha.12 的 API 配置和调用改动必须在独立开发分支中完成。

S1 不接入真实 API，不改变当前世界演变数据库，不改变现有世界书投影，也不替换工作流助手。

## 2. alpha.11 不变量

以下内容在 alpha.12 开发期间必须保持可恢复：

- alpha.11 控制台导入包仍可单独导入；
- alpha.11 的世界演变控制台和世界演变数据库仍使用现有脚本 ID；
- 现有聊天分区、楼层账本、revision、checkpoint 不被清空或重建；
- 现有 `WorldEvolution-*` 世界书条目不被迁移脚本批量改写；
- 工作流助手六阶段流程和已有 API 预设不被删除；
- alpha.11 不因 alpha.12 的开发而自动开启或调用真实 API。

## 3. 已锁定文件指纹

以下 SHA-256 用于确认 alpha.11 基线文件没有被 S1 改写：

```text
E137BEBCEE4918172B47C21AE4630B687B8B9FBF23E3BC8F062EE1FC71C61480  导入到酒馆中/酒馆助手脚本-世界演变控制台-A0.1.0-alpha.11-API测试版.json
A096E720A3905128ECD7E0DF624F1FBA31B5D7B0CCE0B2EA22373047B098F398  src/世界演变/types.ts
E5D21BD5AA2F3183CCD10095369B33865FA3400A5AAF2F4CD1DCDB9B4D96B19C  src/世界演变数据库/types.ts
```

校验命令：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath `
  '导入到酒馆中/酒馆助手脚本-世界演变控制台-A0.1.0-alpha.11-API测试版.json'
```

## 4. alpha.12 隔离规则

### 允许

- 在本分支新增 API 配置、客户端、路由和 UI；
- 新增 alpha.12 的导入包；
- 新增模拟 API 测试和迁移测试；
- 修改计划书和设计文档；
- 在本地构建新的 dist 文件进行验证。

### 暂不允许

- 覆盖 alpha.11 导入包；
- 直接把 API Key 写入源码、测试快照、世界书或楼层日志；
- 修改数据库 schema 以外的既有数据；
- 默认开启自动演变；
- 在没有用户确认时调用真实 API；
- 将 alpha.12 地址指向 `@main` 或未固定的 CDN 内容。

## 5. S1 完成检查

- [x] 创建独立 alpha.12 开发分支；
- [x] 记录 alpha.11 提交和文件指纹；
- [x] 明确数据库、世界书和工作流助手的保护边界；
- [x] 明确 alpha.12 允许修改和禁止修改的范围；
- [x] 保持当前 alpha.11 源码和导入包未改写；
- [x] 未调用真实 API。

## 6. S2 完成检查

- [x] 增加版本化 API 配置结构；
- [x] 增加内置 API 预设和主备路由字段；
- [x] 增加 alpha.11 工作流助手名称迁移；
- [x] 增加 API Key 脱敏导出；
- [x] 增加配置增删改和路由引用一致性处理；
- [x] 增加独立脚本变量存储；
- [x] 增加本地持久化和脱敏测试；
- [x] 未调用真实 API。

S2 实现文件：

- `src/世界演变/api-config.ts`
- `src/世界演变/api-config.test.ts`

上一阶段：**S2：API 配置数据层**。

## 7. S3 完成检查

- [x] 增加 OpenAI 兼容 JSON 请求客户端；
- [x] 增加请求超时和外部取消；
- [x] 增加网络、HTTP、超时、解析、配置和取消错误分类；
- [x] 增加按预设配置的指数退避重试；
- [x] 增加主 API 失败后的备用路由切换；
- [x] 认证失败和格式错误不会盲目切换备用 API；
- [x] 使用注入式 fetch 和 sleep 完成模拟测试；
- [x] 未调用真实 API。

S3 实现文件：

- `src/世界演变/api-client.ts`
- `src/世界演变/api-client.test.ts`

上一阶段：**S3：API 客户端与模拟请求**。

## 8. S4 完成检查

- [x] 在世界演变控制台增加内置 API 配置页面；
- [x] 支持预设列表、新建、编辑、删除和复制；
- [x] 支持 Endpoint、模型、Key、超时和重试设置；
- [x] 支持主 API、备用 API 和备用顺序编辑；
- [x] 支持工作流助手桥接状态展示；
- [x] 支持本地模拟连接测试，不访问网络；
- [x] 控制台开发版本标记为 `A0.1.0-alpha.12`；
- [x] 数据库版本仍保持 `A0.1.0-alpha.11`，未触发数据库迁移；
- [x] 未开启自动演变，未调用真实 API。

S4 实现文件：

- `src/世界演变/console/ApiSettingsPanel.vue`
- `src/世界演变/console/Workspace.vue`
- `src/世界演变/types.ts`

## 9. S5 完成检查

- [x] 新增统一的内置 API / 工作流助手路由解析模块；
- [x] 支持仅内置、仅工作流助手、双来源和无来源四种状态；
- [x] 支持内置优先和明确设置的工作流助手优先顺序；
- [x] 内置主 API、备用 API 继续复用 S3 的重试和错误分类；
- [x] 网络、超时、429/5xx 等可重试失败才允许跨来源继续尝试；
- [x] 认证、解析、请求格式和取消错误不会盲目切换来源；
- [x] 工作流助手桥接只使用 `AcuPostProcessAPI.callApi`，不读取或复制 API Key；
- [x] 控制台显示当前有效来源和实际尝试顺序；
- [x] 新增 11 项纯模拟路由测试，未调用真实 API；
- [x] alpha.11 工作流助手配置和 API 预设未被删除或覆盖。

S5 实现文件：

- `src/世界演变/api-routing.ts`
- `src/世界演变/api-routing.test.ts`
- `src/世界演变/console/ApiSettingsPanel.vue`

## 10. S6 完成检查

- [x] 世界演变引擎的默认 AI 调用已切换到统一内置 API / 工作流助手路由；
- [x] 内置 API 成功时不会调用工作流助手桥接；
- [x] 无内置来源时按既有路由设置兼容工作流助手桥接；
- [x] 不再隐式回退到 SillyTavern 当前全局 API；
- [x] 现有上下文组装、operations 校验、`baseRevision` 检查和 revision 提交顺序保持不变；
- [x] API 调用失败或没有路由时不会提交 revision 或更新世界书；
- [x] 使用模拟 `fetch` 完成默认调用路径测试，未访问真实网络；
- [x] ESLint、S6 联合测试和生产构建已通过；
- [x] alpha.11 导入包、数据库数据、世界书和工作流助手配置未被覆盖。

S6 实现文件：

- `src/世界演变/engine.ts`
- `src/世界演变/ai-call.test.ts`

下一阶段：**S7：事务、投影与恢复测试**。
