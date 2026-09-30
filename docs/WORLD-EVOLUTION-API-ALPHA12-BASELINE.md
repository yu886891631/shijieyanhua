# 世界演变 API 内置化 alpha.12 基线

> 基线日期：2026-09-30  
> 对应旧版：A0.1.0-alpha.11  
> 对应提交：`7a0dd7724b931c1d54228c69db1c9ca4283cf7b6`  
> 开发分支：`codex/world-evolution-alpha12-api`  
> 状态：S1、S2、S3 已完成

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

下一阶段：**S4：控制台 API 页面**。
