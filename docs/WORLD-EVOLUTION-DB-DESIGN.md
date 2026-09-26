# 世界演变数据库核心设计 v0.1

> 版本：A0.1.0 设计基线  
> 日期：2026-09-26  
> 状态：M2–M6 已完成本地模拟验证，尚未进行 SillyTavern 真机验收

## 1. 设计目标

本设计用于把“世界演变”从当前的对象文档式原型，重构为一个独立的、数据库驱动的后台世界状态系统。

核心目标：

1. NPC、组织、地点、社会、环境和事件以逻辑表的形式保存；
2. 世界演变 AI 只负责提出数据库更新操作，不直接修改 MVU、shujuku 或世界书；
3. 每次更新都绑定到聊天、楼层和 revision，支持重试、撤销、重算和恢复；
4. 只查询与本轮相关的表格记录，避免把整个世界状态无差别塞给 AI；
5. 世界书是可重建的投影层，不是真实数据源；
6. MVU、工作流助手和 shujuku 可以提供输入，但不承担世界演变数据库的存储职责。

非目标：

- 不再制作另一套 MVU；
- 不向原生 MVU 输出 `<AddonJSONPatch>`；
- 不直接写入 shujuku 的业务表；
- 不让 AI 执行 SQL 或直接调用 IndexedDB；
- 不要求每个 NPC 单独调用一次 AI；
- 第一版不追求复杂社会仿真或跨设备同步。

## 2. 系统边界

```text
主 AI / 当前楼层
        │
        ▼
MVU、工作流助手、shujuku 适配器
        │ 只读输入
        ▼
世界演变触发器
        │
        ▼
世界演变数据库（事实源）
        │
        ├─ 查询相关表格记录
        ├─ 调用世界演变 AI
        ├─ 校验并事务提交操作
        ├─ 写入楼层 revision
        └─ 重建世界书投影
```

三类数据的职责：

| 数据源 | 职责 |
| --- | --- |
| 原生 MVU | 文游本身的即时变量，例如数值、装备、任务和卡片状态 |
| shujuku | 主角已知的结构化资料；世界演变只读，不直接改写 |
| 世界演变数据库 | 主角视线之外持续变化的 NPC、组织、社会、环境、事件和计划 |

MVU 是可选输入，不是世界演变数据库的存储层。即使没有可用的 MVU，手动运行或工作流触发仍可以处理已有的世界演变记录。

## 3. 数据库实现方式

第一版继续使用浏览器 IndexedDB，但不再把整个世界保存成一个 `world` 文档。

IndexedDB 中使用一个独立数据库：

```text
acu-world-evolution-db
```

每个聊天使用独立的 `chatKey` 分区。逻辑表通过 object store 实现；面板按表格方式展示，查询层对外提供数据库式接口。

建议的 object store：

```text
world_meta
evolution_npc
evolution_organizations
evolution_locations
evolution_society
evolution_environment
evolution_events
evolution_plans
evolution_floor_runs
evolution_revisions
evolution_checkpoints
evolution_settings
```

IndexedDB 只是本地实现细节。上层代码不得依赖某一个 object store 的具体 API，必须通过统一 repository 层访问。

## 4. 逻辑表结构

所有业务行都至少包含以下公共字段：

```ts
type WorldEvolutionRowBase = {
  id: string;
  chatKey: string;
  revision: number;
  sourceMessageId?: number;
  visibility: 'backstage' | 'ai_context' | 'protagonist_known' | 'revealed';
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};
```

### 4.1 NPC 表

```ts
type NpcRow = WorldEvolutionRowBase & {
  table: 'npc';
  name: string;
  aliases: string[];
  state: Record<string, unknown>;
  goals: string[];
  locationId?: string;
  organizationIds: string[];
  autonomy: 'active' | 'paused' | 'retired';
};
```

### 4.2 组织表

```ts
type OrganizationRow = WorldEvolutionRowBase & {
  table: 'organization';
  name: string;
  state: Record<string, unknown>;
  memberIds: string[];
  relationIds: string[];
  autonomy: 'active' | 'paused' | 'retired';
};
```

### 4.3 地点、社会和环境表

地点记录空间状态；社会记录群体、关系和制度变化；环境记录天气、灾害、资源和其他非人物变化。

```ts
type GenericWorldRow = WorldEvolutionRowBase & {
  table: 'location' | 'society' | 'environment';
  name: string;
  state: Record<string, unknown>;
  relatedIds: string[];
};
```

### 4.4 事件表

事件是已经发生的后台事实，不直接覆盖实体当前状态。

```ts
type EventRow = WorldEvolutionRowBase & {
  table: 'event';
  eventType: string;
  summary: string;
  details?: string;
  actorIds: string[];
  locationId?: string;
  eventTime?: string;
  status: 'active' | 'resolved' | 'cancelled';
};
```

### 4.5 计划表

计划是尚未完成的未来动作或条件触发器。

```ts
type PlanRow = WorldEvolutionRowBase & {
  table: 'plan';
  title: string;
  trigger?: string;
  actorIds: string[];
  dueTime?: string;
  status: 'pending' | 'completed' | 'cancelled';
};
```

### 4.6 楼层运行表

楼层运行表记录“这一楼是否被世界演变处理过”，不等同于业务事件。

```ts
type FloorRunRow = {
  id: string;
  chatKey: string;
  messageId: number;
  messageFingerprint: string;
  source: 'auto' | 'manual' | 'retry' | 'rebuild';
  status: 'queued' | 'running' | 'done' | 'skipped' | 'failed' | 'cancelled';
  baseRevision: number;
  resultRevision?: number;
  operationCount: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
};
```

### 4.7 revision 表

revision 是数据库的审计记录。每次成功事务都必须生成一条 revision。

```ts
type RevisionRow = {
  id: string;
  chatKey: string;
  revision: number;
  messageId: number;
  messageFingerprint: string;
  source: 'auto' | 'manual' | 'retry' | 'rebuild';
  operations: WorldEvolutionOperation[];
  inverseOperations: WorldEvolutionOperation[];
  createdAt: number;
};
```

保存逆操作是为了支持同楼层重跑和局部撤销。数据量允许时，可以额外保存该 revision 完成后的表快照作为 checkpoint。

## 5. 数据可见性

每条实体、事件和计划都必须有可见性：

```text
backstage
  仅世界演变内部使用，不发送给主 AI

ai_context
  可以提供给主 AI，但不代表主角已经知道

protagonist_known
  主角已经知道

revealed
  已经在剧情中公开揭示
```

默认规则：

- 后台 AI 可以读取 `backstage`、`ai_context`、`protagonist_known` 和 `revealed`；
- 主 AI 的世界书投影默认只同步 `ai_context` 及以上可见内容；
- `backstage` 不得因为世界书同步而泄露；
- 任何“后台变成主角已知”的变化必须来自明确的剧情输入，而不是世界演变自动升级。

## 6. 候选筛选与表格查询

世界演变每轮不读取全库，而是先产生候选对象，再查询相关表格。

候选来源按以下优先级合并去重：

1. 本轮 ReplicaEnum 中出现的角色；
2. MVU 本轮变化明确关联的角色或组织；
3. 当前楼层和场景中被提及的对象；
4. 到期计划涉及的对象；
5. 最近事件影响的对象；
6. 用户手动指定的对象；
7. 已启用且最久未更新的后台对象轮转补位。

查询层需要返回：

```ts
type WorldEvolutionContext = {
  candidateRows: {
    table: string;
    rows: unknown[];
  }[];
  relatedEvents: EventRow[];
  pendingPlans: PlanRow[];
  currentFloor: {
    messageId: number;
    text: string;
  };
  mvuSnapshot?: unknown;
  workflowSummary?: unknown;
  databaseSnapshot?: unknown;
};
```

上下文必须保留表名和行边界，禁止只拼成不可追溯的长字符串。AI 应该能明确知道某条资料来自哪张表、哪一行、哪个 revision。

## 7. AI 调用与操作协议

世界演变 AI 不直接生成最终世界书文本，也不执行 SQL。它只返回经过约束的数据库操作。

### 7.1 操作类型

```ts
type WorldEvolutionOperation =
  | {
      op: 'upsert';
      table: 'npc' | 'organization' | 'location' | 'society' | 'environment';
      id: string;
      name: string;
      changes: Record<string, unknown>;
    }
  | {
      op: 'append';
      table: 'event' | 'plan';
      id?: string;
      data: Record<string, unknown>;
    }
  | {
      op: 'update_status';
      table: 'event' | 'plan';
      id: string;
      status: string;
    }
  | {
      op: 'delete';
      table: 'npc' | 'organization' | 'location' | 'society' | 'environment';
      id: string;
      name: string;
    };
```

### 7.2 AI 返回格式

```json
{
  "baseRevision": 12,
  "operations": [
    {
      "op": "upsert",
      "table": "npc",
      "id": "npc:角色甲",
      "name": "角色甲",
      "changes": {
        "current_goal": "调查失踪事件"
      }
    },
    {
      "op": "append",
      "table": "event",
      "data": {
        "eventType": "npc_action",
        "summary": "角色甲开始调查失踪事件",
        "actorIds": ["npc:角色甲"],
        "visibility": "ai_context"
      }
    }
  ]
}
```

### 7.3 本地校验

提交前必须检查：

- `baseRevision` 与当前数据库 revision 一致；
- 操作表名和操作类型合法；
- NPC/组织等对象只能更新候选对象；
- 不允许写入不存在的外部对象关系；
- 单轮 NPC、其他对象、事件和计划数量不超过设置上限；
- 不允许把 `backstage` 自动改成 `protagonist_known` 或 `revealed`；
- 不允许重复事件 ID；
- 任何一项失败都整批拒绝，不产生部分写入。

M4 实际落地约束：AI 必须只输出 `baseRevision` 与 `operations` 的 JSON；旧的
`updates/events/scheduledEvents` 输出不再接受。实体更新使用本库稳定 ID 加候选全名，
外部表格 ID 只作查询证据。已有实体不支持 AI 改名，后台 AI 也不能修改
`protagonist_known` 或 `revealed` 实体；可见性不得由 `backstage` 自动提升。
`append` 的事件/计划字段分别限制为事件类型、摘要、细节、参与者 ID、地点 ID、时间、
可见性及标题、触发器、参与者 ID、到期时间、可见性；`update_status` 仅对本轮相关的
未完成记录生效；`delete` 仅允许无引用的 `backstage` 候选实体。
总操作数最多 32 条，事件和计划分别最多为本轮 NPC 与其他对象上限之和。
本地先整批校验、转换为持久层行操作，再由 IndexedDB 写事务内复查 `baseRevision`。

API 配置默认复用 SillyTavern 当前全局配置或数据库项目已有的调用适配器。插件不保存 API Key；面板只显示当前调用来源，并允许编辑世界演变专用提示词和数量限制。

## 8. 事务、楼层重跑和重建

### 8.1 正常运行

```text
读取当前 revision
  ↓
查询候选表格
  ↓
调用 AI
  ↓
本地校验 operations
  ↓
生成 inverseOperations
  ↓
同一事务写入业务表、revision、floor_run
  ↓
按需重建世界书投影
```

### 8.2 同楼层重新生成

如果同一楼层正文指纹发生变化：

1. 找到该楼层上一次成功 revision；
2. 先应用该 revision 的 `inverseOperations`；
3. 删除旧的楼层运行结果；
4. 用新楼层内容重新筛选和调用 AI；
5. 生成新的 revision。

如果找不到可靠逆操作，则恢复最近 checkpoint，再从 checkpoint 之后的楼层顺序重放。

### 8.3 删除楼层或回溯历史

删除楼层不能只删除一条日志。必须：

1. 标记受影响楼层及其之后的 revision；
2. 恢复到删除前最近 checkpoint；
3. 按保留下来的楼层顺序重放；
4. 重新生成业务表；
5. 重新生成世界书投影。

这一步是新版本相对于 A0.0.5 的核心能力，不能只依赖“回滚最近一次”。

## 9. 世界书投影

数据库是事实源，世界书是可删除、可重建的投影。

命名约定：

```text
WorldEvolution-索引
WorldEvolution-NPC-角色甲
WorldEvolution-组织-组织甲
WorldEvolution-地点-地点甲
WorldEvolution-社会-社会节点甲
WorldEvolution-环境-环境节点甲
WorldEvolution-事件-EV-001
WorldEvolution-计划-PL-001
```

同步规则：

- 只管理带有 `managedBy: 'world-evolution-db-v1'` 的条目；
- 不覆盖用户手动创建的同名条目；
- 条目消失时可由数据库重新生成；
- 后台可见性内容不写入主 AI 可读取的常驻条目；
- 同步失败不回滚数据库事务，只记录待同步状态；
- 每次数据库重建后，都可以完整重建这些条目。

### 9.1 世界书同步适配器

世界书同步应直接采用 shujuku 的“网关—服务—投影”分层，而不是在世界演变业务代码中散落调用宿主 API。
目标书解析必须先调用 `getCharWorldbookNames('current')`，默认取 `primary`；没有
`primary` 时跳过投影并记录原因，不回退到用户手填书名或 `additional`：

```text
WorldEvolutionRepository
        ↓
WorldbookProjectionService
        ↓
WorldbookGateway
        ↓
TavernHelper / SillyTavern 世界书 API
```

数据库中已经验证过的机制可以直接复用：

- 读取宿主世界书列表后解析真实名称，兼容首尾空格、全角字符和不可见字符；
- 将宿主 API 包装成 `get / create / set / delete` 网关；
- 对“API 不存在”提供宽松模式，对关键同步路径提供失败关闭的严格模式；
- 通过稳定条目名、`uid` 和 `managedBy` 元数据区分插件条目与用户条目；
- 只对插件托管条目执行 upsert/delete，不用整本 `replaceWorldbook` 覆盖用户内容；
- 批量写入后按需刷新当前世界书编辑器，使用延迟渲染避免连续刷新；
- 对宿主返回的异常字段先归一化，再进入比对和写回流程。

世界演变的投影适配器应使用以下稳定键：

```ts
type WorldbookProjectionKey = {
  chatKey: string;
  table: 'index' | 'npc' | 'organization' | 'location' | 'society' | 'environment' | 'event' | 'plan';
  rowId: string;
};
```

`rowId` 是事实源中的稳定 ID，显示名只用于条目标题和关键词。角色改名时更新同一个条目，不创建第二条同名记录。

### 9.2 世界书投影同步流程

```text
数据库事务提交 revision
        ↓
计算受影响行与应删除行
        ↓
读取目标世界书并解析托管条目
        ↓
按稳定键拆分 create / set / delete
        ↓
在世界书写锁内批量执行
        ↓
记录 projection_revision 与同步结果
        ↓
必要时延迟刷新世界书编辑器
```

同步器必须具备：

- 内容指纹：正文、关键词、触发策略未变化时不写入；
- 孤儿清理：数据库中已删除或永久失效的托管条目必须可识别并删除；
- 受保护条目：非本插件命名空间、用户手动条目和 shujuku 条目不可删除；
- 写锁与并发保护：同一本世界书同时只能执行一轮投影；
- 待同步重试：写入失败只影响投影状态，不重复调用世界演变 AI；
- 完整重建：可从当前数据库快照清理并重建全部 `WorldEvolution-*` 条目；
- 聊天切换隔离：`chatKey` 改变时不能把上一聊天的投影写入当前聊天。

世界演变不应复制工作流助手写入聊天楼层变量的账本。它可以在自己的 `worldbook_projection` store 中保存：

```ts
type WorldbookProjectionRecord = {
  chatKey: string;
  bookName: string;
  projectionKey: string;
  uid?: number | string;
  contentFingerprint: string;
  sourceRevision: number;
  status: 'synced' | 'pending' | 'failed' | 'orphaned';
  error?: string;
  updatedAt: number;
};
```

这样既能像数据库一样按条目精确更新，又能在世界书被手动改动、删除或更换名称后重新收敛。

## 10. 触发时序

世界演变不是六阶段工作流中的必需阶段，而是独立插件。

自动触发条件：

1. 当前聊天已完成主 AI 楼层；
2. MVU 和 shujuku 阶段已完成，或明确跳过；
3. 工作流助手报告本轮没有阻断性失败；
4. 楼层正文和相关变量达到稳定状态；
5. 当前楼层尚未成功处理，或正在执行重跑。

手动触发可以绕过自动触发等待，但仍必须经过稳定读取、候选筛选和事务校验。

## 11. 管理面板

面板不再以“对象卡片库”为主要中心，而是提供数据库管理功能：

### 数据表

- 表选择器：NPC、组织、地点、社会、环境、事件、计划；
- 搜索、类型、可见性和状态筛选；
- 行详情和字段编辑；
- 批量暂停、恢复、删除和导出。

### 楼层与版本

- 当前 revision；
- 楼层运行记录；
- 成功、跳过、失败和重试状态；
- 选择楼层撤销并重建；
- checkpoint 创建、恢复和删除；
- revision 操作和逆操作预览。

### AI 设置

- 当前 API 调用来源；
- 世界演变专用提示词；
- 每轮对象和事件数量上限；
- 自动触发开关；
- 失败重试和稳定等待参数。

### 世界书

- 当前角色卡主世界书（`getCharWorldbookNames('current').primary`，只读）；
- 不自动写入角色卡 `additional` 世界书；
- 旧版手动 `worldbookName` 仅保留用于设置兼容，不作为 M6+ 写入目标；
- 最近同步状态；
- 重新投影；
- 清理并重建受插件管理的条目。

## 12. 迁移策略

A0.0.5 不直接覆盖新数据库。

首次升级时提供明确的迁移动作：

1. 在面板中选择 A0.0.5 JSON 备份，只读生成迁移预览；
2. 将 `entities` 转为对应的 NPC、组织、地点、社会或环境表；
3. 将 `events` 转为事件表；
4. 将 `scheduledEvents` 转为计划表；
5. 将已有 revision、floor run 和 checkpoint 转为新格式，并追加一个 `migration` revision 作为最终状态提交；
6. 报告重复 ID、同名对象、不支持类型、未解析引用和目标聊天已有数据等冲突；
7. 用户确认后，以单个 IndexedDB 事务写入新数据库，同时保留原始 JSON、来源版本和校验和；
8. 事务成功后重建当前角色卡 `primary` 世界书投影，失败则自动 abort；
9. 迁移完成后才允许启用 A0.1.0 自动运行。

迁移必须可重复执行且幂等。迁移失败时保留旧数据，不删除 A0.0.5 数据。

## 13. 分阶段实现计划

### M1：数据库内核

- repository 层；
- 逻辑表；
- chatKey 隔离；
- 统一 row 基础字段；
- 导出、导入和 schema 校验。

### M2：楼层账本

- floor_runs；
- revisions；
- inverseOperations；
- 同楼层幂等和重跑；
- checkpoint；
- `messageFingerprint`；
- `MESSAGE_DELETED` / `MESSAGE_SWIPED` 统一调度；
- trailing 防抖、generation 代次和单并发冷回放。

### M3：查询与候选

- MVU、工作流和 shujuku 只读适配器；
- ReplicaEnum 解析；
- 相关表格查询；
- 查询结果保留表名和行边界。

### M4：AI 操作协议

- 复用数据库调用适配器；
- operations schema；
- 本地校验；
- 模拟 AI；
- 整批原子提交。

### M5：重建引擎

- 删除楼层；
- 从 checkpoint 重放；
- 重新生成 materialized tables；
- 重新计算世界书投影；
- 重建后的引用与旧读取模型投影一致性校验；
- materialized rows 与 revision 重放结果一致性校验。

### M6：世界书投影

- `WorldEvolution-*` 条目；
- 常驻索引；
- 条目清理；
- 同步失败重试；
- worldbook gateway / service / projection 分层；
- 稳定键、内容指纹、写锁和孤儿清理；
- 只更新插件托管条目，不整本覆盖世界书。

### M7：数据库管理面板

- 表格视图；
- 行编辑；
- 批量操作；
- 楼层与 revision 管理；
- API 和同步状态；
- 当前角色卡 `primary` 世界书的投影账本、漂移/缺失/孤儿统计；
- 投影同步、孤儿清理、失败重试和完整重建。

### M8：迁移与兼容

- A0.0.5 导入；
- 迁移报告；
- 旧数据保留；
- 版本号和缓存更新策略。

### M9：测试与发布

- 不调用真实 API 的模拟测试；
- 队列、事务、重跑、删楼、迁移和世界书测试；
- SillyTavern 真机验收；
- 发布 `A0.1.0` Git import 版本。

## 14. 验收标准

新版本至少必须通过：

1. 空数据库可以手动添加 NPC 并运行一轮；
2. AI 只能更新候选表格记录；
3. 非法操作整批拒绝，数据库不产生半成品；
4. 同楼层重复触发不会重复写入；
5. 同楼层重新生成会撤销旧 revision 后重算；
6. 删除中间楼层后可以从 checkpoint 重建后续状态；
7. 世界书条目可以从数据库完整删除并重建；
8. shujuku 条目不会被直接修改；
9. MVU 不可用时，手动运行仍可处理已有数据库记录；
10. 刷新页面、切换聊天和重新导入后数据仍保持隔离；
11. 所有模拟测试不调用真实 API；
12. SillyTavern 中能够看到版本号、表格、楼层记录和同步状态。

## 15. 与 A0.0.5 的关系

A0.0.5 保留为原型和回退版本，不再继续扩张其 `world.entities` 文档模型。

新版本优先复用：

- 楼层稳定等待；
- 单并发队列；
- 失败重试；
- IndexedDB 基础能力；
- 世界书同步测试；
- 模拟 AI 测试框架。

新版本必须重写：

- 数据库 schema；
- repository 和查询层；
- AI 操作协议；
- 楼层重建逻辑；
- 数据库管理面板。

只有当 M1–M8 完成并通过模拟验收后，才替换 Git import 默认地址。这样可以始终保留 A0.0.5 作为安全回退。 

## 16. 可复用实现矩阵

本项目允许“参考实现并移植边界清晰的机制”，不允许把三个项目的业务数据互相混写。

### 16.1 可以直接移植或抽成公共工具

来源为 shujuku：

- 世界书 API 网关：列表、名称解析、读取、创建、更新、删除；
- 世界书 service 层与严格/宽松错误策略；
- 世界书条目字段归一化；
- `managedBy` / 稳定名称 / `uid` 的托管条目识别；
- 按托管范围清理孤儿条目；
- 条目排序、关键词和递归设置的默认值；
- 世界书编辑器的延迟刷新；
- chatKey 隔离与 IndexedDB repository 的事务包装。

来源为工作流助手：

- 世界书写锁；
- trailing debounce 与 in-flight 防重入；
- 聊天切换、删楼和重跑后的 reconcile；
- 运行账本与孤儿清理；
- 关键词归一化、拆分和改名重映射；
- 消息楼层可访问性判断；
- MVU 完成事件等待与超时回退；
- 单并发 API 路由池和失败重试；
- 运行状态、取消、进度和 UI 刷新接口。

来源为 A0.0.5 世界演变：

- `WorldEvolution-*` 命名空间；
- `backstage / ai_context / protagonist_known / revealed` 可见性；
- 候选对象优先级和数量上限；
- 稳定楼层快照；
- AI 调用器可注入模拟实现；
- 数据库提交成功后再同步世界书；
- 世界书同步失败不回滚事实源。

### 16.2 只能借鉴接口，不能原样复用业务逻辑

- shujuku 的表名、列名、SQL 操作和业务行格式；
- 工作流助手的任务 ID、ReplicaEnum 副本族和聊天楼层变量格式；
- A0.0.5 的 `world.entities` 整体文档状态；
- 工作流助手的“从聊天楼层账本推导世界书内容”逻辑；
- shujuku 的 checkpoint 命名和删除恢复规则；
- 任何直接写入原生 MVU 或 shujuku 业务表的路径。

世界演变必须通过自己的 `WorldEvolutionOperation`、`floor_runs`、`revisions` 和 `WorldbookProjectionRecord` 运行。

### 16.3 必须重写的核心

1. 世界演变数据库的 repository 与 schema；
2. AI 输出到行级 `upsert / append / delete / update_status` 的转换；
3. baseRevision 冲突检测和整批原子提交；
4. 从 checkpoint 到目标楼层的确定性重放；
5. 删除/滑动/重生成后的 stale 标记与重算策略；
6. 世界书投影从“整本替换”改为“受影响行的精确同步”；
7. UI 中表格、revision、checkpoint 与世界书同步状态的统一视图。

### 16.4 明确禁止的复制方式

- 不复制 shujuku 的业务表到世界演变数据库；
- 不让世界演变 AI 直接执行 SQL 或直接调用世界书 API；
- 不把世界书当作唯一事实源；
- 不在删楼后无提示地重新调用所有历史楼层 AI；
- 不使用显示名代替稳定 ID；
- 不用 `replaceWorldbook` 覆盖整本用户世界书；
- 不因世界书同步失败而重复写入世界状态；
- 不把后台秘密自动升级为主角已知。

### 16.5 推荐的落地顺序

```text
先移植 shujuku 的 worldbook gateway/service
        ↓
再移植工作流助手的写锁、reconcile、稳定等待和单并发
        ↓
接入 A0.0.5 的候选筛选、可见性和模拟 AI
        ↓
最后接入 M2 的 revision/checkpoint/replay
        ↓
用模拟测试验证删楼、重跑、改名、世界书孤儿清理
```

M2 的目标不是立即接入真实 AI，而是先证明：给定一组楼层操作，数据库可以稳定提交、撤销、回放，并把结果准确投影到世界书。
