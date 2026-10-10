# 世界演变 T0：宿主能力与真实接入安全门槛

> 日期：2026-10-05。结论等级：本地静态审计，不是真机可行性通过。
>
> 审计代码 HEAD：37362107567133fb71c023810143a5f944152c7e；工作区已有未提交文档，按工作区实际文件阅读，不将 HEAD 等同于全部文件内容。
>
> 对应 [总实施计划](WORLD-EVOLUTION-SQL-UI-MASTER-PLAN.md) 的 T0、T10、T12 及第 3、15.7 节。本报告不改变总计划、不授权后续真实写入。

## 1. 结论与证据等级

可以继续 T1–T9 的独立沙盒设计、实现和模拟测试。现有声明提供了消息数据、聊天保存、当前角色卡主世界书、注入及事件入口；现有实现也有可参考的局部并发和投影机制。但是，本轮没有证明宿主聊天的原子提交、持久化读回、稳定分支身份或主 AI 请求级世界书隔离。正式聊天存档和真实世界书投影仍须分别经过 T10、T12 安全门槛。

本报告所称“阻断”是本轮操作边界与新架构的接入要求，不表示已修复 alpha.16 的旧自动恢复/同步路径。旧入口风险及 T0 总体完成记录见 [T0 基线报告](WORLD-EVOLUTION-T0-BASELINE.md)。

本报告使用三种证据，不互相替代：

| 等级 | 含义 | 本轮能证明什么 |
| --- | --- | --- |
| 类型声明 | 仓库内 @types 的函数、字段及注释 | 本地适配器可以按什么形状设计；不证明已安装版本的实现或持久化语义 |
| 现有实现 | 仓库源码实际执行的步骤 | 现有代码采用的机制和缺口；不证明代码已在当前页面加载或运行成功 |
| 实际宿主 | 指定宿主版本和测试范围中的运行证据 | 本轮未取得保存、冲突、恢复或投影验收证据，均待授权验证 |

主代理本轮只读连接到 127.0.0.1:8000，能看到 SP 数据库编辑器；可见 DOM 不能证明世界演变候选入口已加载，也不能证明保存、CAS 或投影接口可用。当前宿主、酒馆助手、SP 数据库和已加载世界演变脚本的准确版本均未确认。总计划记录的本地 alpha.16 / 数据格式 alpha.11、既往截图记录和参考仓库版本都不是本轮真机通过证据。

## 2. 审计范围与不执行事项

已完整阅读 AGENTS.md、CLAUDE.md，以及 CLAUDE.md 所列规则的现存 .cursor/rules/*.md 对应文件；仓库中链接的 .mdc 文件缺失，未把它们当成已阅读文件。规则涉及项目概念、助手接口、脚本、变量、MCP、前端、MVU 框架与 MVU 角色卡。优先检查公开助手接口，SillyTavern 上下文只作为较低层候选能力。

本轮只读核对 @types、现有 adapter/store/worldbook/inject 与关联恢复路径，并新增本报告。没有导入或执行现有入口，没有运行真实插件，没有调用真实 AI、保存聊天、变量写入或世界书增删改，没有浏览器点击、刷新或读取凭据。真实宿主验收清单是后续任务，不是本轮执行记录。

## 3. 能力总表

| 能力 | 类型声明 | 现有实现 | 实际宿主 / 支持结论 |
| --- | --- | --- | --- |
| 读取消息及当前/全部 swipe | getChatMessages、ChatMessageSwiped | 现有引擎主要读取当前页的数值楼层和正文指纹 | 待验证选页映射与事件时序；不能把数值索引当稳定全局身份 |
| 写消息 JSON 数据 | setChatMessages 可提交 data / swipes_data | 工作流注入显式展开旧 data 后加入自身字段 | 可设计命名空间网关；合并、序列化、选页持久化未验收 |
| 保存调用完成 | setChatMessages、SillyTavern.saveChat 返回 Promise<void> | 工作流等待 setChatMessages；世界状态主链写入 IndexedDB | Promise 完成的持久化含义未知；不能当作服务器确认回执 |
| 持久化读回 | 有消息 getter、上下文 chat、reloadCurrentChat | 当前提交主链没有聊天 JSON 存档的独立读回确认 | getter 可能只是内存视图；真实刷新/重开读回待验证 |
| 宿主聊天 CAS | 所查消息/保存声明没有 expectedRevision 参数或 CAS 回执 | 未见新计划的宿主聊天 CAS 网关 | 未证实，不等于确定宿主不存在；正式接入待证或阻断 |
| 本地数据库 CAS | 属于 IndexedDB，不是宿主接口 | commitDbRevision 在同一 readwrite 事务内复查 revision | 有静态实现；不替代聊天保存、跨设备或世界书互斥 |
| 跨实例协调 | 未见所查助手声明提供此专用保证 | chatWriteTails、worldbookLocks 是模块内 Map；IDB 提交另有事务 CAS | 锁范围须重新声明并验证；不能声称覆盖所有窗口、设备、旧写入器 |
| 当前角色卡主世界书 | getCharWorldbookNames('current').primary | resolveCurrentCharacterWorldbookName 读取 primary，缺失返回 null | 目标解析有实现；群聊、切卡、切聊天时的准确绑定待验 |
| 精确托管投影 | 世界书条目有 uid、extra，支持更新/增删 | 按插件标记、chatKey、projectionKey 管理并保存投影账本 | 已有写入范围控制；不等于主 AI 读取隔离或原子投影 |
| 主 AI 请求级隔离 | 有世界书/提示词事件、injectPrompts | 未见世界演变主链接入请求级世界书过滤 | 尚不满足新门槛；真实投影保持阻断，直到可靠过滤或受控单活通过 |
| 一致投影快照 | 世界书操作各有 Promise，未声明整批事务 | 删除、更新、创建分步执行，结束后更新本地账本 | 部分失败和生成穿插可能存在；一致读取与重试待实现、验证 |
| 复制、分支、锚点稳定身份 | 聊天字符串、数值楼层/swipe 和变化事件 | chatId 或 unknown_chat；正文指纹；删楼/swipe 调度 | 不足以证明独立世界/分支与复制继承关系；需 T4/T10 协议 |

以上“未见”限于下文列出的本地声明和代码，不是对实际宿主所有内部接口的断言。

## 4. 消息数据、保存确认与权威存档

### 4.1 声明能表达 JSON，但未承诺原子合并

证据：[chat_message.d.ts](../@types/function/chat_message.d.ts) 的 ChatMessage、ChatMessageSwiped、getChatMessages、setChatMessages；[variables.d.ts](../@types/function/variables.d.ts) 的 replaceVariables、updateVariablesWith。

- ChatMessage.data 是 Record<string, any>，swiped 视图有 swipes_data 数组；默认 getter 只取当前被使用的消息页。
- setChatMessages 接受消息局部字段，返回 Promise<void>；其选项是界面刷新方式，不包含版本前提、保存回执或合并冲突策略。
- 类型示例先读取 data 再写回。变量接口的注释也明确说明若干助手方法是 get → 处理 → replace，不能仅凭 updater 函数名认定原子事务。
- 下层 [exported.sillytavern.d.ts](../@types/iframe/exported.sillytavern.d.ts) 的 ChatMessage 主要暴露 variables、extra 等字段，与助手 data 的实际映射、选页序列化规则须在目标版本验证。不能绕开公开接口随意添加原始 chat 自定义字段并宣称受支持。

现有参考：[工作流注入 inject.ts](../src/工作流助手/tasks/inject.ts) 的 injectToAiFloor 显式使用展开旧 data 的方式加入 _post_process_done 和注入内容，同时修改消息正文。它保存了“读取当时”其他顶层字段，但不是并发安全合并；不能直接复用为不修改正文的世界存档网关。

T10 网关应仅合并独立插件命名空间，保留其他插件和 MVU 数据、其他 swipe 以及正文；依靠经过验证的互斥/CAS 后再读取最新数据进行精确合并。对并发新增、删除、嵌套字段和 JSON 类型限制均须测试。没有消息锚点时保留草稿，不偷偷创建真实楼层。

### 4.2 三种确认不能混为一谈

1. 内存写入或界面刷新成功。
2. 保存函数的 Promise 正常结束。
3. 在明确的持久化边界之后，独立读回匹配插件提交 ID、分支、revision、载荷摘要且其他字段未受损。

第 3 类是新协议需要的确认，读回仍不能代替互斥。同步 getChatMessages 和上下文 chat 本身不证明已读到服务器持久化副本；盲目把它们紧接在 setter 后面只能证明可能的内存一致性。

下层上下文在 [exported.sillytavern.d.ts](../@types/iframe/exported.sillytavern.d.ts) 声明了 saveChat、saveMetadata、reloadCurrentChat、getCurrentChatId、updateChatMetadata。它们没有在本地声明中提供服务器版本回执。T10 须查明已安装宿主的实际保存与加载实现、错误传播和自动保存交错行为，不能用函数名补出没有证据的保证。

### 4.3 当前权威链不是计划中的聊天 JSON 链

证据：[数据库 store.ts](../src/世界演变数据库/store.ts) 的 DB_NAME、loadDbSnapshot、commitDbRevision；[adapter.ts](../src/世界演变数据库/adapter.ts) 的 dbSnapshotToWorld；[engine.ts](../src/世界演变/engine.ts) 的 runWorldEvolution / commitDbRevision 调用链。

当前主链使用 acu-world-evolution-db 的 IndexedDB（版本 4），将元信息、楼层运行、修订、检查点、投影账本等保存为本地记录；adapter 将快照转换成旧 WorldEvolutionWorld 供界面和投影使用。它未构成新计划所需的“聊天 JSON 为持久权威、SQLite/IndexedDB 仅可重建运行时或缓存”的宿主提交路径。

另有 [旧 store.ts](../src/世界演变/store.ts) 的 acu-world-evolution 库和 saveWorldIfRevisionMatches；脚本变量主要承载设置。T0 不迁移、不清空两套旧库；T13 才在备份、预览及授权条件下处理。新沙盒不得借用旧库，也不得把宿主提交失败降级为旧 IDB 写入成功。

## 5. CAS、锁与并发范围

现有本地提交不是完全没有 CAS：[数据库 store.ts](../src/世界演变数据库/store.ts) 的 commitDbRevision 在 readwrite 事务内读取最新 meta，比较 input.baseRevision，冲突时抛出 WorldEvolutionRevisionConflictError，并在事务完成后返回。事务之外还以 withChatWriteLock / chatWriteTails 串行化同一模块的写入。这是可借鉴的局部实现，不能误报为宿主聊天 CAS 已实现。

[worldbook.ts](../src/世界演变/worldbook.ts) 的 withWorldbookProjectionLock / worldbookLocks 仅是本模块 Promise 队列。它不证明另一个脚本 iframe、标签页、设备或其他插件遵守同一锁；本地 IDB CAS 也不围住宿主聊天或世界书操作。世界书 updateWorldbookWith 虽提供 updater，本地声明未保证服务器原子版本检查或整批事务。

本轮可声明的支持范围仅为：独立沙盒中的协议模拟，以及对当前局部机制的静态识别。正式并发范围尚未验收。

后续若选择跨实例写锁，须记录实际覆盖的同源、iframe、标签页、窗口、用户与设备范围，锁失效/实例退出/过期写入的处理，以及旧版写入器是否退出。只覆盖同源窗口的协调不能被描述为跨设备互斥。强制单写者必须有可验证的准入与失效机制，不是提示用户“不要开第二个窗口”。不能可靠排除范围内竞争者时，阻断正式提交。

## 6. 消息、swipe、复制和聊天身份

证据：[chat-key.ts](../src/工作流助手/api/chat-key.ts) 的 getCurrentChatKey；[engine.ts](../src/世界演变/engine.ts) 的 getLatestMessage、fingerprintText、isDbMessageProcessed 调用；[数据库 index.ts](../src/世界演变数据库/index.ts) 与 [mutation-scheduler.ts](../src/世界演变数据库/mutation-scheduler.ts)；[event.d.ts](../@types/iframe/event.d.ts) 的消息变化和 CHAT_CHANGED 事件。

当前 chat key 读取下层 chatId，缺失或异常返回 unknown_chat。这个共同回退值不适合真实存档隔离：新网关遇到未知聊天身份须阻断，不能将多个未知聊天写进同一分区。

当前楼层用数值 message_id，swipe 用数值 swipe_id / 数组位置；引擎另计算正文指纹。声明没有承诺这些索引在中间删楼、插入、重新生成、swipe 删除、聊天复制或分支后保持全球唯一。相同正文指纹也不是分支身份；它可用于复查输入，不代替稳定消息/选页标识。

现有数据库监听 MESSAGE_DELETED、MESSAGE_SWIPED，并按数值楼层调度本地重建。仓库声明还包含 MESSAGE_EDITED、MESSAGE_UPDATED、MESSAGE_SWIPE_DELETED、CHAT_CHANGED 等事件；现有调度不代表新计划的全部编辑、复制、依赖失效和分支恢复协议已完成。

T4 固定世界、聊天、分支、消息/选页、运行与提交身份协议；T10 验证它们在宿主中的承载、复制保留/重建及映射。绑定不能只在启动时捕获，也须在正式提交与投影前复查，防止运行中切聊天或切角色卡把旧结果写到新目标。无法证明映射时只能显示只读历史/草稿，不能猜测有效祖先后提交。

## 7. 主世界书、读取隔离与一致投影

### 7.1 主世界书目标有明确实现，动态绑定仍待验

证据：[worldbook.d.ts](../@types/function/worldbook.d.ts) 的 CharWorldbooks、getCharWorldbookNames、getChatWorldbookName；[worldbook.ts](../src/世界演变/worldbook.ts) 的 resolveCurrentCharacterWorldbookName。

当前代码选择 getCharWorldbookNames('current').primary，缺失或异常返回 null；不改写 additional 世界书，也不使用旧设置的任意手填书名。聊天绑定世界书是另一个接口，不能冒充角色卡 primary。仍须验证目标宿主在无角色卡、群聊、切卡/切聊天等模式中的实际语义。没有可靠主目标时阻断真实投影，不创建或重新绑定世界书。

[engine.ts](../src/世界演变/engine.ts) 在本地提交完成后解析当前 primary；retryPendingWorldbookSync 也解析当前 primary，而不是证明它仍对应原提交冻结的聊天/角色卡绑定。新实现必须持有并复查目标绑定及提交身份，不能照搬这条重试路径后宣称切聊天安全。

### 7.2 写入归属不等于主 AI 读取隔离

证据：[worldbook.ts](../src/世界演变/worldbook.ts) 的 projectionKey、withProjectionMetadata、basePartial、buildProjections、syncWorldEvolutionWorldbookUnlocked。

当前托管条目有 managedBy、chatKey、projectionKey、sourceRevision 等 extra 标记；同步只处理符合自身标记及当前聊天条件的条目，并保留其他聊天的条目。当前 projectionKey 由聊天、表、行组合，不包含新协议的独立世界/分支身份。条目默认 enabled: true，索引使用常驻策略；extra 的 chatKey 不是声明中的宿主读取 ACL。

因此，“不删除其他聊天投影”不意味着“其他聊天投影不会进入本次主 AI”。当前源码未提供世界演变的请求级过滤，不能根据不同名称、不同投影键或本地写锁假称共享 primary 世界书已经隔离。是否实际串读及具体扫描时序仍须在目标宿主验证，不能用静态缺口声称本轮已观察到泄漏。

### 7.3 候选钩子存在，但不能先假定它们满足请求协议

证据：[inject.d.ts](../@types/function/inject.d.ts) 的 injectPrompts；[generate.d.ts](../@types/function/generate.d.ts) 的生成参数/overrides；[event.d.ts](../@types/iframe/event.d.ts) 的 WORLDINFO_ENTRIES_LOADED、WORLDINFO_SCAN_DONE、CHAT_COMPLETION_PROMPT_READY、iframe 生成事件。

- injectPrompts 声明注入只作用于当前聊天文件，可带 filter 和 once。但 filter 没有显式请求 ID 参数，once 表示下一次请求，不能直接当成指定运行的隔离令牌；它也不是过滤已有世界书条目的接口。
- 世界书和提示词事件暴露条目或发送消息，本地回调声明不保证修改会被宿主采用、不保证异步过滤会被等待，也不描述所有主 AI/重生成/继续/群聊路径的覆盖与并发时序。
- iframe 生成事件带 generation_id；不能据此推断主 AI 的世界书扫描钩子必然携带可对应的请求身份。generate 自有 overrides 也不能证明接管了全部主 AI 路径。

T0/T1 可以先确定候选适配契约；T12 必须在指定宿主证明同一请求只读取当前有效世界/分支的一致提交投影，秘密过滤先于扫描及递归，且不改写用户世界书的其他内容。若只能采用单活投影，必须验证所有受支持主 AI 请求均受门控、切换先撤销旧活跃投影、同步中与失败时不读取半份结果、锁范围内没有其他活跃实例。仅将旧条目全局开关切换一次不构成可靠单活方案；不能证明则阻断真实投影。

### 7.4 当前分步同步与账本不能证明整批原子可见

当前 syncWorldEvolutionWorldbookUnlocked 依次执行删除、更新、创建，再将本地投影账本标为 synced；发生异常标为 failed。它没有在同步结束后独立读取目标世界书并确认完整代际，也没有以宿主整批事务防止主 AI 在中间扫描。inspect 方法的读回诊断不能等同于提交期间的请求门控。

新投影应从一个已确认提交生成不可变批次，携带世界/分支/提交/投影格式身份；更新、重试和失败后恢复都围绕该批次进行，不能反向推进世界或再调用演变 AI。遗留 managedBy 条目的归属不明确时，须在迁移预览中解决，不能自动把“旧版插件标记”解释为当前世界的删除授权。

## 8. 参考数据库的可借鉴边界

本地参考源 shujuku-inspect-20260925 与当前浏览器的 SP 数据库版本不等同。其 [chat-gateway.ts](../../shujuku-inspect-20260925/src/data/gateways/chat-gateway.ts) 的 saveChatToHost_ACU / saveChatToHostStrict_ACU 区分了“缺保存能力可跳过”和“必须保存时缺能力即失败”，这项职责划分可以借鉴。

但该网关主要检查函数存在并等待 saveChat；静态源码不提供当前宿主 CAS、服务器持久化回执或独立读回证明。新生产权威存档不能采用静默跳过保存的路径；也不能把参考源向原始 chat 对象写自定义字段的做法直接当作公开接口持久化保证。本报告未执行参考插件。

## 9. T10 / T12 安全门槛

### T10：真实聊天存档

正式写入前全部满足：

- 确认候选脚本、宿主与助手版本，以及测试聊天/角色卡、锚点和授权范围；不会触发旧入口、旧恢复或真实 API。
- 定义唯一权威和独立命名空间；证明其他插件、正文及所有 swipe 数据在合并、保存、重开后保持不变。
- 在声明范围内实现并验证 CAS 或可靠锁/可验证单写者；提交 ID 幂等，冲突零覆盖，过期实例不能补写。
- 建立保存确认和独立持久化读回契约；失败、回包丢失、读回失败进入已说明的待确认/恢复分支，不切换正式状态、不回退旧库。
- 验证聊天复制、分支、选页和中间删楼的身份/有效祖先映射；未知身份、无锚点、依赖不明时阻断或只保留草稿。
- 明示并测试正式支持范围；模拟通过与目标版本真机通过分别记录。

### T12：真实世界书投影

正式增删改前全部满足：

- 当前角色卡 primary 解析可靠，目标绑定与已确认提交匹配；无目标、切换失配或无写权限时阻断。
- 证明共享世界书的请求级隔离，或可靠的单活/并发限制；不满足时仅预览，不执行写入。
- 读取和写入围绕同一投影代际，主 AI 不读取半份同步；同步失败不推进世界、不再次演变。
- 仅处理经证明属于本插件当前世界/分支的稳定键/UID；用户、其他插件、其他世界及未确认归属的遗留条目保留。
- 秘密与读取权限在全部受支持请求、常驻索引、关键词扫描和递归中生效；重试复查目标，不因切聊天写错书。

## 10. 支持、阻断与后续验证清单

### 本轮允许继续

- 独立沙盒 JSON 权威、假宿主、假世界书、假模型；适配器边界和协议测试不联真实接口。
- 本地纯函数验证、身份与提交格式设计、页面及投影预览；不得自动加载或迁移旧库。
- 使用现有局部 CAS、显式字段合并、托管稳定键和失败账本作为设计参考，并保留它们的范围限制。

### 本轮保持阻断

- 对当前真实聊天的初始化、保存、恢复写回、swipe 修改、分支建立或数据清空。
- 对当前 primary 世界书的新增、删除、更新、重建、绑定或自动重试。
- 宣布聊天 CAS、跨实例互斥、持久化恢复、复制身份或共享世界书请求隔离“已通过”。
- 为了能力检查导入现有入口：现有启动/聊天切换恢复会进入重试路径，不能把它当只读检查。

### 后续先模拟，真机仅在单独授权的测试范围执行

| 验证项 | 可验收用例 | 责任阶段 / 当前状态 |
| --- | --- | --- |
| data 合并和选页序列化 | 两个插件命名空间与嵌套数据并存；写当前页不损其他页；重开后数据及正文逐项匹配 | T4 模拟、T10 真机；待验证 |
| 保存完成/读回 | 保存抛错、保存回包丢失、读回失败、实际重开读回；不能因本地 getter 成功提前确认 | T4/T10；待验证 |
| 写入竞争 | 两 iframe/标签页同时写同 revision；一个成功另一个冲突；锁持有者退出后旧结果仍不可补写；未支持设备明确阻断 | T4/T10；待验证 |
| 身份与依赖 | 中间插删楼、相同正文的两次生成、swipe 切换/删除、聊天复制/分支、运行中切聊天；只恢复当前有效祖先 | T4/T10；待验证 |
| 目标绑定 | 无 primary、切角色卡、共享 primary 的两聊天、群聊；重试不能采用另一个角色卡的目标 | T10/T12；待验证 |
| 请求隔离 | 同书两世界/分支含互斥标记；捕获实际最终请求，仅含当前代际；重生成、继续、并发和递归同样成立 | T1 候选契约、T12 真机；待验证 |
| 投影中断 | 删除/更新/创建各步故障或同时发起主 AI；只读取完整有效代际；重试不删用户条目、不调用演变 AI | T12；待验证 |
| 前置和接管 | 当前运行/消息/分支的必要前置完成证据，而非单个布尔标记；新旧入口不能重复启动演变 | T0/T7/T8；由关联运行审计跟进，未据本报告宣称通过 |

验证须记录实际版本、入口、范围、步骤、结果和失败证据。真实写入测试需可恢复备份、独立测试聊天和明确授权；没有授权可继续独立模拟，但保留真实验收待办。所有能力未知项默认禁用相应真实动作，而不是尝试后静默降级。

## 11. 本轮交付界限

本报告完成了 T0 的宿主静态能力子项，不代表整个 T0 或 T10/T12 已通过。仅新增此文档；未修改源码、旧文档、真实聊天、世界书、配置或 API。后续实现应据本报告冻结支持范围与阻断状态，不把声明、模拟或历史截图转写为真机证明。
