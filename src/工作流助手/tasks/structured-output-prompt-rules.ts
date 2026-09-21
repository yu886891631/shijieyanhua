import type { PostProcessTask } from './schema';
import type { ActiveStructuredOutputMode, StructuredOutputMode } from './strict-variable-response';

export const MVU_JSON_PATCH_PROMPT_GROUP_NAME = 'MVU JSON Patch变量输出规则';
export const ADDON_JSON_PATCH_PROMPT_GROUP_NAME = 'Addon JSON Patch变量输出规则';

const AUTO_PROMPT_GROUP_NAMES = new Set([MVU_JSON_PATCH_PROMPT_GROUP_NAME, ADDON_JSON_PATCH_PROMPT_GROUP_NAME]);

export function isStructuredOutputRulesPromptGroup(name: string): boolean {
  return AUTO_PROMPT_GROUP_NAMES.has(name.trim());
}

export function buildMvuJsonPatchPromptGroupContent(): string {
  return `[MVU 变量 JSON 输出规则]
你必须仅输出一个合法 JSON 对象（不要使用 markdown 代码围栏，不要输出 XML 或自然语言前后缀）。本规则已包含 json 关键字。

## 业务约束
- patch 使用 JSON Patch (RFC 6902) 风格，但支持扩展操作：replace、delta、insert、remove、move
- insert 到数组末尾时 path 使用 \`-\` 作为索引
- path 相对 stat_data 根路径（如 \`/角色/HP\`，不要写 \`/stat_data/...\`）
- 禁止更新以 \`_\` 开头的只读字段（如 \`_变量\`）
- analysis 须为英文，不超过 80 词，说明：时间流逝、是否允许大幅变动、基于当前上下文的变量变更分析

## 根对象结构
{
  "analysis": "Time passed: ... Dramatic updates allowed: yes/no. Changed: ...",
  "patch": [
    { "op": "replace", "path": "/path/to/variable", "value": "new_value" },
    { "op": "delta", "path": "/path/to/number", "value": -10 },
    { "op": "insert", "path": "/path/to/object/new_key", "value": "new_value" },
    { "op": "insert", "path": "/path/to/array/-", "value": "new_item" },
    { "op": "remove", "path": "/path/to/key" },
    { "op": "move", "from": "/path/from", "to": "/path/to" }
  ]
}`;
}

export function buildAddonJsonPatchPromptGroupContent(): string {
  return `[Addon 变量 JSON 输出规则]
你必须仅输出一个合法 JSON 对象（不要使用 markdown 代码围栏，不要输出 XML 或自然语言前后缀）。本规则已包含 json 关键字。

## 业务约束
- patch 使用 JSON Patch (RFC 6902) 风格，但支持扩展操作：replace、delta、insert、remove、move
- insert 到数组末尾时 path 使用 \`-\` 作为索引
- path 相对 addon_data 根路径（如 \`/模块/字段\`，不要写 \`/addon_data/...\`）
- 禁止更新以 \`_\` 开头的只读字段（如 \`_变量\`）
- analysis 须为英文，不超过 80 词，说明：时间流逝、是否允许大幅变动、基于当前上下文的变量变更分析

## 根对象结构
{
  "analysis": "Time passed: ... Dramatic updates allowed: yes/no. Changed: ...",
  "patch": [
    { "op": "replace", "path": "/path/to/variable", "value": "new_value" },
    { "op": "delta", "path": "/path/to/number", "value": -10 },
    { "op": "insert", "path": "/path/to/object/new_key", "value": "new_value" },
    { "op": "insert", "path": "/path/to/array/-", "value": "new_item" },
    { "op": "remove", "path": "/path/to/key" },
    { "op": "move", "from": "/path/from", "to": "/path/to" }
  ]
}`;
}

function ensureStructuredOutputRules(task: PostProcessTask): NonNullable<PostProcessTask['structuredOutputRules']> {
  if (!task.structuredOutputRules) {
    task.structuredOutputRules = {};
  }
  return task.structuredOutputRules;
}

export function resolveStructuredOutputRulesContent(task: PostProcessTask, mode: ActiveStructuredOutputMode): string {
  const rules = task.structuredOutputRules;
  if (mode === 'mvu_json_patch') {
    const cached = rules?.mvu?.trim();
    if (cached) return cached;
    return buildMvuJsonPatchPromptGroupContent();
  }
  const cached = rules?.addon?.trim();
  if (cached) return cached;
  return buildAddonJsonPatchPromptGroupContent();
}

export function captureStructuredOutputRulesFromTask(task: PostProcessTask): void {
  const rules = ensureStructuredOutputRules(task);
  for (const pg of task.promptGroups) {
    if (pg.name === MVU_JSON_PATCH_PROMPT_GROUP_NAME) {
      rules.mvu = pg.content;
    }
    if (pg.name === ADDON_JSON_PATCH_PROMPT_GROUP_NAME) {
      rules.addon = pg.content;
    }
  }
}

export function updateStructuredOutputRulesCacheFromPromptGroups(task: PostProcessTask): void {
  captureStructuredOutputRulesFromTask(task);
}

function removeAutoPromptGroups(task: PostProcessTask): void {
  task.promptGroups = task.promptGroups.filter(pg => !isStructuredOutputRulesPromptGroup(pg.name));
}

export function syncStructuredOutputPromptGroup(task: PostProcessTask, mode: StructuredOutputMode): void {
  const existingIndex = task.promptGroups.findIndex(pg => isStructuredOutputRulesPromptGroup(pg.name));
  captureStructuredOutputRulesFromTask(task);
  removeAutoPromptGroups(task);
  if (mode === 'off') return;

  const name = mode === 'mvu_json_patch' ? MVU_JSON_PATCH_PROMPT_GROUP_NAME : ADDON_JSON_PATCH_PROMPT_GROUP_NAME;
  const content = resolveStructuredOutputRulesContent(task, mode);
  const group = {
    name,
    role: 'system' as const,
    content,
    enabled: true,
  };
  // 已存在时插回原位，避免手动排序后被 push 到末尾
  const insertAt = existingIndex >= 0 ? Math.min(existingIndex, task.promptGroups.length) : task.promptGroups.length;
  task.promptGroups.splice(insertAt, 0, group);
}
