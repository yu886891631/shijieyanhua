# 数据库自动整轮完成通知：独立源码兼容补丁

本目录是开发者用的源码补丁，不是酒馆助手导入 JSON，不是已安装的数据库版本，也不会自行启动世界演变。当前没有应用到用户数据库、构建数据库发布物或覆盖世界演变测试包。

## 固定参考版本

- 仓库：AlbusKen/shujuku。
- 参考提交：`599e3580c3106fa234ead38fdfe8625080419143`。
- 参考 package 版本：`9.2.5`。
- 协议：`WorldEvolution/TavernDB-auto-round/1`。
- 覆盖范围：`automatic-plan`，即数据库自身的外层自动更新计划。
- `candidateOnly: true`：通知只提供整轮完成候选，不证明酒馆聊天已持久保存。

不同版本不能直接套用。生成器先检查两份原文件的精确 SHA-256，再检查每处替换锚点唯一；不匹配时拒绝生成，不宽松猜测插入位置。补丁使用完整文件上下文，应用前仍须检查目标分支和已有修改。

## 改动范围

`automatic-plan-v1.patch` 包含四份源文件：

1. `src/presentation/bootstrap/api-registry.ts`：公开只读的 `getWorldEvolutionCompletion()` 观察接口。
2. `src/presentation/triggers/settings-ui-sync/settings-ui-trigger.ts`：在真实外层自动计划开始、实际各组执行完成和外层 finally 收口处发布通知。
3. `src/shared/world-evolution-completion-protocol.ts`：无网络、存储、定时器或 UI 副作用的可移植协议。
4. `src/service/runtime/world-evolution-completion.ts`：连接当前聊天、消息、swipe、隔离标签、最终表数据和运行时导出；忙碌状态阻止复用旧结果。

不改原有模型调用、SQL、聊天保存、页面布局或异常/返回控制；观察器异常不能改变数据库原流程结果。既有表格更新回调继续保留，只作为数据变化提示。

人工填表、导入、恢复、初始化和显式单次 API 调用不在本协议覆盖范围内。没有把这些更新包装成“本轮自动演算已完成”，也没有声称涵盖所有排队向量任务或后台任务。

## 通知含义

- `begin`：捕获本轮目标和冻结计划，取得不可用 JSON 复制冒充的 ticket。
- 实际执行的普通、旧式 SQLite 和 staging 组各自登记回执；缺组、重复组、未知组、失败组或矛盾汇总不能被最终总成功掩盖。
- 外层 awaited 流程收口后，才发布 `success`、`failure`、`cancelled`、`disabled`、`frequency-skipped` 或 `unverifiable`
  终态。
- `disabled` 和 `frequency-skipped` 是原流程明确跳过，不是超时推测成功。
- coalesced 后续任务使提前结束的一次尝试取消，不发布可复用成功。
- `success`
  或明确跳过仍须校验当前角色/聊天、原消息对象、swipe、正文、隔离标签与表数据；之后世界演变必须独立读取服务端 JSONL，确认所选来源字段实际保存。
- 数据库再次忙碌，或消息、来源数据/运行时导出已变化时，旧候选失效。没有服务端 CAS 或跨标签页锁保证。

## 只读开发检查

以下命令只生成到标准输出或检查补丁；不应用、不安装、不写实际聊天。示例目录是本机已核对的参考 checkout，不能把它当作用户正在运行的数据库安装目录。

在世界演变仓库根目录查看生成结果：

```powershell
node --import tsx src/世界演变/rebuild/t15-db-completion-patch.ts C:/Users/yu332/Documents/Playground/shujuku-inspect-20260925
```

检查补丁是否适配参考 checkout：

```powershell
git -C C:/Users/yu332/Documents/Playground/shujuku-inspect-20260925 apply --check C:/Users/yu332/Documents/Playground/shijieyanhua/compat/shujuku-round-completion/automatic-plan-v1.patch
```

本次已完成该只读检查，参考 checkout 保持干净。后续若要应用、构建并安装到实际数据库，须另行明确目标和授权；本次不提供自动安装步骤。

## 验证边界

专项测试在内存中编译本补丁生成的 API 注册、外层触发、宿主胶水和协议代码，注入假宿主、组执行器、保存和模型服务。它实际覆盖补丁插入点，不只是测试脱离数据库流程的协议模型。

但数据库服务内部仍为替身，不是整个数据库生产构建，也不是真实酒馆端到端验收。当前世界演变消费端已有适配代码，尚未挂入现有隔离导入包；补丁未安装时仍安全等待/阻断，不用普通更新通知冒充整轮完成。

实现与最终测试记录见 [H1 数据库整轮完成通知](../../docs/WORLD-EVOLUTION-T15-DATABASE-COMPLETION.md)。
