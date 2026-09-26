# 世界演变系统 A0.1.0 实施计划

> 状态：M2–M8 已完成本地模拟验证；M9 真机验收仍待完成
> 更新日期：2026-09-26
> 目标版本：A0.1.0
> 详细设计：`docs/WORLD-EVOLUTION-DB-DESIGN.md`
> M2 收口记录：`docs/WORLD-EVOLUTION-M2-CLOSEOUT.md`
> M4 收口记录：`docs/WORLD-EVOLUTION-M4-CLOSEOUT.md`
> M5 收口记录：`docs/WORLD-EVOLUTION-M5-CLOSEOUT.md`
> M6 收口记录：`docs/WORLD-EVOLUTION-M6-CLOSEOUT.md`

## 1. 项目目标

世界演变是一个独立的后台模拟系统，用于维护主角视线之外持续变化的世界状态，包括：

- NPC 的状态、关系、目标和自主行动；
- 组织、阵营和社会关系的变化；
- 地点、环境和区域事件的变化；
- 已发生事件、待发生计划和因果链；
- 面向主 AI 的可控世界书投影；
- 按聊天、楼层和 revision 查询、撤销与重建历史。

系统以独立数据库作为唯一事实源。MVU、工作流助手和 shujuku 只提供输入或参考数据，不拥有世界演变状态；世界书只承担可删除、可重建的输出投影。

## 2. 核心原则

### 2.1 独立事实源

世界演变使用自己的 IndexedDB、schema、repository、revision 和 checkpoint，不直接写入：

- 原生 MVU 数据；
- 工作流助手任务账本；
- shujuku 业务表；
- 用户手工维护的世界书条目。

### 2.2 数据先于投影

固定处理方向为：

```text
聊天楼层
    ↓
稳定输入快照
    ↓
候选查询与 AI operations
    ↓
本地校验和数据库事务
    ↓
revision / delta / checkpoint
    ↓
世界书精确投影
```

数据库提交成功后才允许同步世界书。世界书同步失败只产生待同步状态，不回滚数据库，也不重复调用 AI。

### 2.3 AI 不直接操作存储

AI 只能返回受限的行级操作：

- `upsert`：创建或更新候选记录；
- `append`：追加事件、日志或关系变化；
- `delete`：删除允许删除的候选记录；
- `update_status`：更新计划或事件状态。

AI 不能执行 SQL、调用 IndexedDB、调用世界书 API，或修改本轮候选范围之外的记录。

### 2.4 整批原子提交

一轮 AI 返回的所有操作必须先通过本地校验，再作为一个事务提交。任意操作非法时整批拒绝，不产生半成品。

### 2.5 可见性隔离

世界演变记录保留以下可见性：

- `backstage`：仅后台模拟可见；
- `ai_context`：可提供给主 AI，但不表示主角已知；
- `protagonist_known`：主角已经知道；
- `revealed`：已经在故事中公开呈现。

后台秘密不得因为同步世界书而自动升级为主角已知。

## 3. 系统边界

### 3.1 输入

每轮运行可以读取：

- 当前 `chatKey`；
- 助手消息楼层 ID 和正文；
- 当前及前一份 MVU 快照；
- MVU 变化摘要；
- 世界演变数据库当前 revision；
- 相关 NPC、组织、地点、社会、环境、事件和计划记录；
- shujuku 的只读查询结果；
- 用户手动指定的候选对象。

所有外部输入在进入核心前统一转换为 `WorldEvolutionInput`。核心不依赖某一种 MVU 字段结构或工作流任务格式。

### 3.2 输出

每轮运行只产生：

- `floor_run` 运行记录；
- 一个或零个数据库 revision；
- 正向与逆向 operations；
- 受影响记录集合；
- 世界书投影任务；
- 可审计的日志、错误和运行状态。

### 3.3 非职责范围

- 不代替主 AI 编写当前回复；
- 不代替 MVU 管理角色卡变量；
- 不修改 shujuku 主角资料或业务表；
- 不维护工作流助手任务配置；
- 不将世界书当作唯一事实源。

## 4. 目标架构

```text
Trigger Adapter
    ↓
Stable Floor Snapshot
    ↓
Candidate Query Service
    ↓
Prompt Builder / AI Adapter
    ↓
Operation Validator
    ↓
WorldEvolution Repository
    ├── materialized tables
    ├── floor_runs
    ├── revisions
    ├── checkpoints
    └── worldbook_projection
            ↓
Worldbook Projection Service
            ↓
Worldbook Gateway
```

模块之间只通过类型化接口交互。UI 不直接访问宿主世界书 API，AI 适配器不直接访问 repository。

## 5. 数据模型

### 5.1 业务表

首版至少包含：

- `npcs`；
- `organizations`；
- `locations`；
- `society_nodes`；
- `environment_nodes`；
- `events`；
- `plans`。

所有业务记录必须具有稳定 ID。名称是可修改的显示字段，不作为主键。

### 5.2 楼层运行表

`floor_runs` 至少记录：

- `chatKey`；
- `messageId`；
- `messageFingerprint`；
- 触发来源；
- 输入快照摘要；
- `baseRevision`；
- 生成的 revision；
- 候选对象；
- 开始和结束时间；
- `queued / running / succeeded / failed / stale / cancelled` 状态；
- 错误和重试次数。

`chatKey + messageId + messageFingerprint` 用于判定同楼层幂等、滑动和重新生成。

### 5.3 Revision

每个成功事务生成一个 revision，至少保存：

- `revisionId` 和父 revision；
- 来源楼层；
- `baseRevision`；
- 正向 operations；
- `inverseOperations`；
- 受影响表和稳定 ID；
- 提交前后摘要；
- 创建时间；
- `valid / stale / reverted` 状态。

### 5.4 Checkpoint

checkpoint 保存某一 revision 的完整可恢复快照，用于：

- 长链路快速重建；
- 中间楼层删除后的冷回放；
- 迁移前保护；
- 手动恢复。

checkpoint 的创建频率可配置。首版采用固定 revision 间隔，并在迁移、批量编辑和历史重建前强制创建。

### 5.5 世界书投影账本

`worldbook_projection` 至少保存：

- `chatKey`；
- 目标世界书真实名称；
- 稳定投影键；
- 世界书条目 `uid`；
- 内容指纹；
- 来源 revision；
- `synced / pending / failed / orphaned` 状态；
- 最近错误和更新时间。

## 6. 触发与运行时序

### 6.1 自动触发

```text
助手楼层生成完成
    ↓
等待 MVU 更新完成事件
    ↓
短轮询确认楼层与变量稳定
    ↓
计算 messageFingerprint
    ↓
进入单并发队列
    ↓
执行世界演变
```

复用工作流助手已经验证的 `VARIABLE_UPDATE_ENDED` 等待、超时回退、稳定采样、单并发和取消机制。

### 6.2 手动触发

手动运行允许用户选择：

- 当前最新助手楼层；
- 指定历史楼层；
- 仅处理手动候选；
- 只重试失败的世界书投影；
- 从 checkpoint 重建且不调用 AI。

### 6.3 同楼层重复触发

当 `messageId` 和 `messageFingerprint` 均未变化时：

- 已成功则返回幂等结果；
- 正在运行则不重复入队；
- 失败则按配置重试；
- 只有显式“重新演算”才撤销旧 revision 并重新调用 AI。

### 6.4 滑动、重新生成和删楼

统一调度入口处理：

- `MESSAGE_SWIPED`；
- `MESSAGE_DELETED`；
- 同 ID 正文变化；
- 聊天切换；
- 手动回退。

发生历史变化时先以 trailing debounce 合并宿主事件，再增加 generation 代次。旧 generation 的异步结果不得提交。

## 7. 候选查询与 AI 协议

### 7.1 候选来源

候选对象按以下来源合并并去重：

1. 当前楼层直接提及对象；
2. MVU 发生变化的对象；
3. 数据库中存在未完成计划的对象；
4. 与当前地点、组织或事件相关的对象；
5. 用户手动指定对象；
6. 达到计划触发条件的后台对象。

### 7.2 数量限制

每轮分别限制 NPC、组织、地点、社会节点、环境节点、计划和事件数量。超过上限时，按直接相关性、未完成计划、最近活跃时间和用户手动优先级排序。

### 7.3 AI 返回校验

提交前必须验证：

- `baseRevision` 等于当前 revision；
- 操作类型属于白名单；
- 表名和字段属于 schema；
- 目标稳定 ID 在候选范围内或允许创建；
- 可见性转换合法；
- 删除操作满足保护条件；
- 事件和计划引用对象存在；
- 单轮操作数和文本长度未超过限制。

冲突或非法操作整批拒绝，并在 `floor_run` 中记录结构化错误。

## 8. 事务、撤销与确定性回放

### 8.1 正常提交

1. 读取当前 revision；
2. 验证 AI 的 `baseRevision`；
3. 计算逆向操作；
4. 在 IndexedDB 事务中更新业务表；
5. 写入 revision 和 floor_run；
6. 提交事务；
7. 创建世界书投影任务。

### 8.2 同楼层重新演算

1. 找到该楼层原 revision；
2. 确认其后是否存在有效 revision；
3. 无后续 revision 时可直接应用逆向操作；
4. 有后续 revision 时恢复最近 checkpoint；
5. 将受影响楼层标记为 stale；
6. 按顺序重放保留的 operations；
7. 仅在用户明确要求时重新调用 AI；
8. 重建世界书投影。

### 8.3 删除中间楼层

1. 标记该楼层及其后续 revision 为 stale；
2. 恢复删除前最近 checkpoint；
3. 跳过已删除楼层；
4. 按原始顺序重放已保存的有效 operations；
5. 遇到无法确定性重放的 revision 时停止并提示；
6. 只有用户授权后才能重新调用 AI 补算；
7. 清理并重建世界书投影。

### 8.4 回放约束

冷回放默认禁止访问真实 AI。回放只使用已保存 operations，保证自动测试不产生 API 成本，并确保相同操作序列得到相同结果。

## 9. 世界书投影

### 9.1 命名空间

```text
WorldEvolution-索引
WorldEvolution-NPC-<显示名>
WorldEvolution-组织-<显示名>
WorldEvolution-地点-<显示名>
WorldEvolution-社会-<显示名>
WorldEvolution-环境-<显示名>
WorldEvolution-事件-<稳定ID>
WorldEvolution-计划-<稳定ID>
```

显示名称可以改变，但内部投影键始终由 `chatKey + table + rowId` 构成。

### 9.2 同步规则

- 只管理 `managedBy: 'world-evolution-db-v1'` 的条目；
- 不覆盖用户手工创建的同名条目；
- 不修改或删除 shujuku 条目；
- 不把 `backstage` 内容写入主 AI 可读取条目；
- 使用内容指纹跳过无变化写入；
- 只对受影响条目执行 create、set 或 delete；
- 不使用 `replaceWorldbook` 覆盖整本世界书；
- 同一本世界书同时只允许一个写入任务；
- 同步失败记录为 pending 或 failed，不回滚事实源；
- 支持从数据库完整清理并重建全部托管条目。

### 9.3 Reconcile

以下情况执行 reconcile：

- 插件启动；
- 聊天切换；
- 楼层删除或滑动；
- revision 回退或重建；
- 目标世界书名称变化；
- 用户手动重建投影。

reconcile 负责解析真实世界书名称、修复 UID、重试失败条目、更新改名条目并删除可以确认的孤儿条目。

## 10. 可复用实现边界

### 10.1 从 shujuku 复用

可移植或抽取：

- 世界书 gateway/service 分层；
- 世界书列表、真实名称解析和条目 CRUD；
- 宿主返回字段归一化；
- 严格与宽松 API 错误策略；
- `managedBy`、稳定名称和 UID 托管识别；
- 孤儿条目清理；
- 延迟刷新世界书编辑器；
- IndexedDB repository 和事务包装；
- checkpoint、delta、replay 的实现思路。

不得复用：

- shujuku 业务表和字段；
- SQL 操作语义；
- 主角资料模型；
- shujuku checkpoint 的业务命名和删除规则。

### 10.2 从工作流助手复用

可移植或抽取：

- MVU 完成事件等待与超时回退；
- 消息楼层可访问性判断；
- 稳定采样和手动重跑楼层解析；
- 单并发路由池；
- 失败重试和取消；
- 世界书写锁；
- in-flight 防重入和 trailing debounce；
- 聊天切换、删楼和重跑后的 reconcile；
- 关键词归一化、拆分和改名重映射；
- 运行状态、进度和 UI 刷新接口。

不得复用：

- 工作流任务 ID；
- ReplicaEnum 副本族；
- 聊天楼层变量账本；
- 从工作流账本直接推导世界书内容的业务逻辑。

### 10.3 从 A0.0.5 复用

可保留：

- 候选对象优先级和数量上限；
- 可见性等级；
- 稳定楼层快照；
- 批量 AI 调用；
- 可注入模拟 AI；
- `WorldEvolution-*` 命名空间；
- 数据库成功后才同步世界书；
- 投影失败不回滚事实源。

必须替换：

- `world.entities` 整体文档存储；
- 旧版 revision/checkpoint 结构；
- 整本 `replaceWorldbook` 同步；
- 仅能回滚最近一次的逻辑；
- 世界状态与 UI 强耦合的访问方式。

## 11. 管理面板

管理面板至少提供以下视图：

### 11.1 数据表

- 按类型查看、搜索和筛选记录；
- 查看稳定 ID、可见性和更新时间；
- 手动创建、编辑和删除允许操作的记录；
- 批量修改可见性或状态；
- 查看记录来源 revision。

### 11.2 楼层与版本

- 查看 floor_run 状态、指纹、候选和错误；
- 查看 revision 正向和逆向 operations；
- 查看 checkpoint；
- 标记 stale；
- 手动重跑、撤销或从 checkpoint 重建；
- 显示操作是否会调用真实 AI。

### 11.3 AI 设置

- 自动运行开关；
- API 配置；
- 重试和超时；
- 各类候选上限；
- 模型指令；
- 模拟 AI 开关；
- 当前队列、取消和最近错误。

### 11.4 世界书

- 目标世界书；
- 投影 revision；
- synced、pending、failed 和 orphaned 数量；
- 单条重试；
- 清理孤儿；
- 完整重建；
- 最近同步错误。

## 12. 分阶段实施

### M1：数据库内核

交付：A0.1.0 schema、IndexedDB repository、业务表 CRUD、版本迁移框架和数据库自动测试。

完成标准：业务记录可按 `chatKey` 隔离地增删改查，事务失败不留下部分写入。

### M2：楼层账本与确定性回放（核心已收口）

交付：

- `floor_runs`；
- `revisions`；
- 正向和逆向 operations；
- `messageFingerprint`；
- 同楼层幂等；
- checkpoint；
- MESSAGE_DELETED/MESSAGE_SWIPED 统一调度；
- trailing debounce、generation 代次和单并发冷回放。

完成标准：使用固定模拟 operations 可以完成提交、撤销、同楼层重跑、中间删楼和 checkpoint 回放，不调用真实 AI。

当前实现补充：

- `engine.ts` 的真实 AI 结果已适配为数据库 operations；
- 真实提交统一调用 `commitDbRevision`，旧 `saveWorldIfRevisionMatches` 不再承担事实提交；
- 数据库入口监听 `MESSAGE_DELETED` 和 `MESSAGE_SWIPED`，使用单聊天串行、trailing debounce 和 generation 调度；
- 删除/滑动楼层只执行已保存 revision 的确定性回放，并把受影响历史标记为 `stale`；
- 面板已显示 revision/checkpoint，并提供手动创建 checkpoint 与纯回放楼层重建；
- 回归测试覆盖适配器、revision 链、checkpoint、删楼和 mutation scheduler。

收口补充：旧版世界演变面板已经通过数据库适配层读取和写入新数据库。旧 store 仅保留设置、旧备份兼容和后续迁移准备，不再承担运行时世界状态事实源。

### M3：查询与候选

交付：MVU、工作流助手和 shujuku 的只读适配器；候选合并、排序和数量限制；保留查询来源和行边界。

完成标准：给定固定输入能稳定得到相同候选集合，外部数据不可被世界演变写回。

当前实现：

- `src/世界演变/query/` 提供统一查询服务和四类只读适配器；
- 支持 ReplicaEnum、MVU 快照、工作流楼层结果、shujuku 表格、当前楼层正文、待办计划、最近事件、已有世界演变表和手动候选；
- 候选保留来源、优先级、证据、表名和行 ID，并按 NPC/其他对象分别限额；
- `engine.ts` 在生成前建立查询上下文，prompt 保留表格边界，未向外部来源写回；
- 固定模拟输入测试通过，未调用真实 API。

### M4：AI 操作协议

交付：prompt builder、operations schema、本地验证器、`baseRevision` 冲突检测、模拟 AI、原子提交和可选真实 API 适配器。

完成标准：非法操作整批拒绝，自动测试不访问网络，真实 AI 仅在明确启用时可用。

当前实现：AI 响应改为 `baseRevision + operations`，旧数组协议明确拒绝；本地校验
操作白名单、实体候选与本库稳定 ID、字段和大小限制、引用类型、可见性、删除保护、
每轮数量以及事件/计划状态，任一非法整批拒绝。行操作交给 M2 的单事务提交，
事务内再次比对 revision，以防不同脚本实例同时写入。模拟测试覆盖成功、非法批次
和冲突；未调用真实 API。事件/计划沿用现有设置，分别以 NPC 与其他对象上限之和限额。

### M5：重建引擎

交付：同楼层撤销、中间楼层删除、checkpoint 恢复、冷回放、stale revision 管理和非确定性缺口报告。

完成标准：删除任意已测试楼层后，重建结果与从头应用保留 operations 的结果一致。

### M6：世界书精确投影

交付：worldbook gateway/service/projection 分层、稳定投影键、内容指纹、差异同步、写锁、失败重试、孤儿清理和完整重建。

完成标准：改名更新同一稳定记录，删除业务记录会清理对应托管条目，用户和 shujuku 条目保持不变。

### M7：数据库管理面板

交付：数据表、楼层、revision、checkpoint、AI 队列、世界书同步状态和日志导出视图。

完成标准：无需开发者控制台即可观察和控制完整运行链路。

### M8：迁移与兼容

交付：A0.0.5 数据识别、迁移预览、旧数据备份、稳定 ID 生成、冲突报告、迁移后投影重建和失败回退。

完成标准：迁移不覆盖旧数据，失败时可恢复，结果能够通过完整性检查。

M8 已实现：

- 旧版 `entities`、`events`、`scheduledEvents`、`runRecords`、`revisions` 和 `checkpoints` 的只读识别；
- 实体映射到 NPC、组织、地点、社会、环境表，事件/计划映射到 `event` / `plan` 表；
- 迁移前预检报告，区分阻断冲突和可继续的警告；
- 目标聊天已有数据时拒绝迁移，避免覆盖；
- 迁移原文以校验和写入独立备份 store；
- 单 IndexedDB 事务提交，失败自动 abort，不产生半成品；
- 迁移后重建当前角色卡 `primary` 世界书投影；
- 模拟迁移、一致性和回放测试通过。

### M9：测试与发布

交付：单元测试、事务测试、队列与触发测试、重跑与删楼测试、投影测试、迁移测试、SillyTavern 真机验收和 Git import 构建。

完成标准：所有自动测试无需真实 API，真机测试通过后才切换默认 Git import 地址。

## 13. 测试策略

### 13.1 默认禁止真实 API

开发和 CI 默认注入模拟 AI。测试若意外访问真实 API 或网络，应立即失败。

### 13.2 必测场景

1. 空数据库手动创建 NPC 并提交一轮 operations；
2. 同楼层重复触发不重复追加事件；
3. 同 ID 正文变化被识别为重新生成；
4. 非法字段、越权对象或错误 `baseRevision` 整批拒绝；
5. 事务失败不产生半成品；
6. 删除最新楼层可通过逆向操作恢复；
7. 删除中间楼层可从 checkpoint 冷回放；
8. 冷回放不调用 AI；
9. 聊天切换时旧 generation 不能提交；
10. 改名不会创建第二条业务记录或投影；
11. 投影失败不重复提交世界状态；
12. 世界书完整重建后内容与数据库一致；
13. 用户条目和 shujuku 条目不会被修改或删除；
14. A0.0.5 迁移失败可以安全回退；
15. 刷新和重新导入后聊天数据仍相互隔离。

### 13.3 真机验收顺序

1. 安装独立 A0.1.0 测试构建；
2. 关闭自动运行并使用模拟 AI；
3. 验证数据库 CRUD；
4. 验证楼层账本、重跑和删楼；
5. 验证世界书精确投影；
6. 开启自动触发但继续使用模拟 AI；
7. 验证 MVU 完成等待和单并发；
8. 最后才为单轮测试启用真实 API；
9. 检查日志、成本、错误恢复和聊天隔离。

## 14. 发布门槛

A0.1.0 不得替换默认导入地址，直到同时满足：

- M1 至 M8 全部完成；
- 自动测试全部通过；
- 没有测试调用真实 API；
- 中间删楼可以确定性重建；
- 世界书可以从数据库完整删除并重建；
- 用户和 shujuku 条目保持不变；
- A0.0.5 数据可迁移或明确保留；
- SillyTavern 真机完成自动触发、重跑、删楼和聊天切换；
- 构建版本、脚本日志和管理面板显示相同版本号；
- 保留 A0.0.5 可用构建作为回退版本。

## 15. 当前执行顺序

```text
M1 schema/repository 完整性检查
    ↓
M2 floor_runs/revisions/checkpoints
    ↓
用模拟 operations 验证撤销与冷回放
    ↓
M3 候选查询
    ↓
M4 AI operations 校验与提交
    ↓
M5 中间删楼重建
    ↓
M6 世界书精确投影
    ↓
M7 管理面板
    ↓
M8 迁移
    ↓
M9 真机验收与发布
```

M2–M8 已完成纯本地模拟验证；下一步是 M9 SillyTavern 真机验收与发布。真实 API 仍未在测试中调用。

## 16. 明确禁止事项

- 不复制 shujuku 业务表作为世界演变表；
- 不直接修改原生 MVU 或工作流助手账本；
- 不让 AI 执行 SQL、IndexedDB 或世界书 API；
- 不使用显示名代替稳定 ID；
- 不用 `replaceWorldbook` 覆盖整本用户世界书；
- 不因世界书同步失败而重复写入世界状态；
- 不在删楼后无提示重新调用历史楼层 AI；
- 不把后台秘密自动标记为主角已知；
- 不在模拟测试中访问真实 API；
- 不在 M1 至 M8 未完成前替换稳定版默认导入地址。

## 17. A0.0.5 的角色

A0.0.5 保留为原型、迁移来源和安全回退版本，不再继续扩张其 `world.entities` 整体文档模型。

A0.1.0 可以参考并迁移其中经过验证的候选筛选、可见性、稳定楼层、模拟 AI 和世界书命名，但所有状态最终必须进入新的业务表、floor_runs、revisions、checkpoints 和 worldbook_projection。
