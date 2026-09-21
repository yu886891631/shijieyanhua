export const REPLICA_ENUM_PROMPT_GROUP_NAME = 'ReplicaEnum 输出规则';

/**
 * 内置示例与文档共用的 ReplicaEnum 规范输出规则正文。
 * 风格对齐 MVU JSON Patch「变量输出规则」提示词段。
 */
export function buildReplicaEnumPromptGroupContent(): string {
  return `[ReplicaEnum 输出规则]
你必须在回复中包含至少一个 <ReplicaEnum>…</ReplicaEnum> 块，块内为合法 JSON（不要用 markdown 代码围栏包裹该 JSON）。可先输出简短自然语言分析；可选另输出 <result> 摘要。禁止再用 XML 标签（如 <item@name>…</item@name>）枚举实例。

## 业务约束
- spec 形如 tag@attr（本示例为 item@name）；values 为字符串数组，填真实物品名
- 无 task 时广播：所有声明该 spec 的副本族都会收到名单（本示例为「副本族处理」与「副本族旁注」）
- 有 task 时定向：仅喂给该副本族；同一 spec 下定向与广播互斥（有 task 条目则不再写广播键）
- renames：{"from":"旧名","to":"新名"}；改名在下一阶段开头或本轮 workflow 结束前生效
- to 已存在（成员 / 楼层 tags / 世界书）时整包跳过、不覆盖
- 同轮链式 rename（如 a→b 与 b→c）按依赖顺序逐条应用；当前成员不在某条 from 上时跳过该边
- registry 只注册 values ∪ renames.to，不注册 from
- 纯 renames 可不带 values；values 与 renames 可同块出现
- 支持批量 {"enums":[...]}；解析器只认全文**最后一个开标签**配对的 <ReplicaEnum> 闭合块（对齐裸标签摘取；思维链中误开的孤儿标签不会吞掉正文）；推荐单块 + {"enums":[...]}

## 单条广播（无 task）
<ReplicaEnum>{"spec":"item@name","values":["断剑","药剂"]}</ReplicaEnum>

## 定向（有 task）
同轮多个 task 应合并为一块 {"enums":[...]}；若分写多块 XML，仅最后一块生效。
<ReplicaEnum>{"enums":[{"spec":"item@name","values":["断剑"],"task":"副本族处理"},{"spec":"item@name","values":["药剂"],"task":"副本族旁注"}]}</ReplicaEnum>

## 改名 + 枚举（renames 与 values 同块）
<ReplicaEnum>{"spec":"item@name","renames":[{"from":"断剑","to":"锈剑"}],"values":["锈剑","药剂"]}</ReplicaEnum>

## 批量 enums
<ReplicaEnum>{"enums":[{"spec":"item@name","values":["断剑","药剂"]},{"spec":"npc@id","values":["a","b"]}]}</ReplicaEnum>`;
}
