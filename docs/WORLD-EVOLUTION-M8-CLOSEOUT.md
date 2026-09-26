# 世界演变 M8 收口记录

> 版本：A0.1.0-alpha.8  
> 日期：2026-09-26  
> 状态：本地模拟验证完成，SillyTavern 真机未验收

## 本阶段完成

- 新增 `src/世界演变数据库/migration.ts` 兼容层；
- 识别 A0.0.5 旧版 `world` 结构，不把旧备份误当作新数据库快照；
- 旧 `entities` 映射到 `npc`、`organization`、`location`、`society`、`environment`；
- 旧 `events` 映射到 `event`，旧 `scheduledEvents` 映射到 `plan`；
- 保留旧楼层运行记录、revision、checkpoint 和已处理楼层；
- 迁移前生成预检报告，阻断目标聊天已有数据、不支持实体类型和重复 ID；
- IndexedDB 版本提升到 4，新增 `migration_backup` store；
- 迁移原始 JSON、来源版本、导入时间和 FNV-1a 校验和被保留；
- 迁移写入使用单事务，异常会 abort，不能留下半成品；
- 迁移成功后面板自动重建当前角色卡 `primary` 世界书投影；
- 普通“导入数据库”遇到 A0.0.5 文件会给出专用迁移提示；
- 数据库管理面板新增“迁移 A0.0.5 旧版备份”和预检报告区块。

## 验证

- M8 迁移预览、映射、一致性、已有数据冲突和不支持类型测试通过；
- 相关回放/一致性测试：16/16 通过；
- `pnpm exec eslint`（M8 文件）通过；
- `pnpm build` 成功；
- 构建仍保留工作流助手已有的 `POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY` 警告，不影响世界演变数据库；
- 未调用真实 API、未进行真实聊天或 SillyTavern 真机验收。

## 使用边界

迁移只写入世界演变自己的 IndexedDB。旧版 `acu-world-evolution` 数据仍保留，不会被删除；世界书只在迁移事务成功后作为可重建投影更新。  
当前版本仍应先用模拟数据验收，M9 再进行 SillyTavern 真机验证和最终 Git import 发布。
