# 世界演变 M5 收口记录

> 版本：A0.1.0-alpha.5  
> 日期：2026-09-26  
> 状态：本地模拟验证完成，SillyTavern 真机未验收

## 已完成

- 新增数据库一致性校验层 `src/世界演变数据库/consistency.ts`；
- 校验行身份、chatKey 分区、稳定 key、表内/实体跨表重复 ID、revision 范围和可见性；
- 校验 `actorIds`、`locationId`、组织/成员/关系等引用的存在性与目标类型；
- 校验事件、计划和实体能否完整投影到旧读取模型；
- 校验事件/计划参与者 ID 与名称、地点 ID 与名称之间的投影一致性；
- 提交 revision 后验证 materialized rows 与确定性重放结果一致；
- 删除楼层重建后验证最终 rows、引用和投影一致；
- 校验 `floor_run` 的 `resultRevision` 与 valid/stale revision 状态一致；
- 一致性失败时整次提交或重建终止，不写入不完整结果。

## 验证

- 世界演变数据库与世界演变相关模拟测试：36/36 通过；
- 新增断引用、实体 ID 冲突、事件投影漂移和 materialized rows 漂移测试；
- 未调用真实 API；
- 生产构建成功，已生成 alpha.5 导入预设。

## 后续

M6 处理精确的 `WorldEvolution-*` 世界书投影、稳定键、内容指纹、孤儿清理、
写锁和失败重试。数据库仍然是事实源，世界书仍然只是可重建投影。
