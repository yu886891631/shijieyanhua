# 世界演变 M6 收口记录

> 版本：A0.1.0-alpha.6  
> 日期：2026-09-26  
> 状态：本地模拟验证完成，SillyTavern 真机未验收

## 本阶段完成

- 世界书同步不再调用 `replaceWorldbook`，改为 `getWorldbook` 后使用：
  - `deleteWorldbookEntries` 清理孤儿；
  - `updateWorldbookWith` 更新发生变化的 UID；
  - `createWorldbookEntries` 创建缺失投影。
- 条目身份从显示名改为稳定投影键：
  - `chatKey + table + rowId`；
  - 例如 `["chat-1","npc","npc:角色甲"]`；
  - 显示名为 `WorldEvolution-NPC-npc:角色甲`，改名不会新建第二条。
- 每条托管条目写入 `extra` 元数据：
  - `acuWorldEvolution: true`；
  - `managedBy: world-evolution-db-v1`；
  - `chatKey`、`projectionKey`、`projectionTable`、`projectionRowId`；
  - `contentFingerprint`、`sourceRevision`。
- 内容指纹覆盖正文、关键词、策略、可见性/插入位置等投影配置；指纹不变时跳过世界书写入。
- 孤儿清理只处理明确带世界演变元数据、且属于当前聊天的条目；用户条目、其他插件条目和其他聊天的 M6 条目保持不动。
- 兼容 `managedBy: world-evolution-v1` 的旧条目；能按旧显示名对应到当前记录时原 UID 迁移到稳定键，否则作为旧托管孤儿清理。
- 世界书写入增加按世界书名称的串行锁，避免同一本世界书并发 reconcile 互相覆盖。
- 世界演变数据库从 IndexedDB v2 升级到 v3，新增 `worldbook_projection` store 作为投影账本，记录 UID、指纹、源 revision、状态和失败原因。
- 投影失败只记录为 `failed` 并保留数据库事实源；下一次自动恢复或手动重试可以重新收敛。
- 写入目标与数据库、工作流助手保持一致：自动解析当前角色卡绑定的 `primary` 世界书；
  不使用旧设置中的手动 `worldbookName`，也不自动写入 `additional` 世界书。
- 面板中的世界书目标改为只读显示当前角色卡 `primary`；未绑定主世界书时明确跳过投影并提示原因。

## 模拟验证

世界书与数据库相关测试通过：

- 稳定键、后台过滤和用户条目保留；
- 内容不变零写入；
- 单条内容变化只更新原 UID；
- 删除/隐藏只清理当前聊天托管孤儿；
- 改名复用稳定 UID；
- 旧版 `managedBy` 条目迁移；
- 当前角色卡 `primary` 世界书解析、无主世界书跳过和附加世界书不误写；
- M5 数据库一致性、引用、重放与适配器测试。

本阶段未调用真实 API，也未进行真实聊天或 SillyTavern 真机验证。

## 使用

同时更新并启用：

- `导入到酒馆中/酒馆助手脚本-世界演变数据库-A0.1.0-alpha.6.json`
- `导入到酒馆中/酒馆助手脚本-世界演变-GitHub版-A0.1.0-alpha.6.json`

数据库仍是事实源；`WorldEvolution-*` 世界书只是可删除、可重建的投影。
