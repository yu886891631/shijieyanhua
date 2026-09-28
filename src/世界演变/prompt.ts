export type WorldEvolutionPromptRole = 'SYSTEM' | 'USER' | 'ASSISTANT';

export type WorldEvolutionPromptMessage = {
  role: WorldEvolutionPromptRole;
  content: string;
  enabled?: boolean;
};

export const WORLD_EVOLUTION_PROMPT_VERSION = 'draft-A0.1';
export const WORLD_EVOLUTION_PROMPT_KEY = 'world_evolution_prompt_draft_v1';

/**
 * 初始提示词只作为“编辑器草稿”保存和展示。
 *
 * 它不会自动替换 engine.ts 当前使用的 prompt builder，也不会把整段
 * 用户提供的填表提示词直接发送给模型。先用一个安全、可编辑的世界演变
 * 版本占位，等提示词规则确认后再接入真实生成流程。
 */
export const INITIAL_WORLD_EVOLUTION_PROMPT: WorldEvolutionPromptMessage[] = [
  {
    role: 'SYSTEM',
    content: `你是“世界演变后台记录器”，负责整理主角视线之外仍在发生的世界变化。

你的职责：
- 只处理本轮提供的候选对象及其直接关联的组织、地点、社会和环境；
- 将后台行动记录为受约束的数据库 operations；
- 不代替主 AI 写正文，不改变主角已经知道的事实；
- 不把后台秘密自动提升为主角已知或公开信息；
- 没有合理变化时返回空 operations。

你只能输出一个合法 JSON 对象，不要输出 Markdown、标签、解释文字或 SQL。`,
  },
  {
    role: 'USER',
    content: `【世界背景】
{{world_context}}

【本轮主 AI 楼层】
{{latest_message}}

【MVU 变化摘要】
{{mvu_change_summary}}

【前置工作流结果】
{{workflow_summary}}

【世界演变数据库当前表格】
{{world_evolution_tables}}

【本轮候选对象】
{{candidate_rows}}

请根据以上资料提出本轮后台变化。只输出：
{
  "baseRevision": 0,
  "operations": []

}

operations 只能使用本地协议允许的 upsert、append、update_status、delete；所有引用必须使用数据库稳定 ID。`,
  },
  {
    role: 'ASSISTANT',
    content: `{
  "baseRevision": 0,
  "operations": []
}`,
  },
];

function cloneMessages(messages: WorldEvolutionPromptMessage[]): WorldEvolutionPromptMessage[] {
  return messages.map(message => ({ ...message }));
}

function isRole(value: unknown): value is WorldEvolutionPromptRole {
  return value === 'SYSTEM' || value === 'USER' || value === 'ASSISTANT';
}

function normalizeMessages(value: unknown): WorldEvolutionPromptMessage[] {
  if (!Array.isArray(value)) return cloneMessages(INITIAL_WORLD_EVOLUTION_PROMPT);
  const messages = value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map(item => {
      const rawRole = typeof item.role === 'string' ? item.role.toUpperCase() : '';
      return {
        role: isRole(rawRole) ? rawRole : 'USER',
        content: typeof item.content === 'string' ? item.content : '',
        enabled: item.enabled !== false,
      };
    })
    .filter(item => item.content.trim());
  return messages.length ? messages : cloneMessages(INITIAL_WORLD_EVOLUTION_PROMPT);
}

export function loadWorldEvolutionPromptDraft(): WorldEvolutionPromptMessage[] {
  try {
    const value = getVariables({ type: 'script', script_id: getScriptId() })?.[WORLD_EVOLUTION_PROMPT_KEY];
    return normalizeMessages(value);
  } catch (error) {
    console.warn('[世界演变] 读取提示词草稿失败，使用初始草稿:', error);
    return cloneMessages(INITIAL_WORLD_EVOLUTION_PROMPT);
  }
}

export function saveWorldEvolutionPromptDraft(messages: WorldEvolutionPromptMessage[]): void {
  insertOrAssignVariables(
    {
      [WORLD_EVOLUTION_PROMPT_KEY]: normalizeMessages(messages),
    },
    { type: 'script', script_id: getScriptId() },
  );
}

export function resetWorldEvolutionPromptDraft(): WorldEvolutionPromptMessage[] {
  return cloneMessages(INITIAL_WORLD_EVOLUTION_PROMPT);
}

export function normalizeWorldEvolutionPromptMessages(value: unknown): WorldEvolutionPromptMessage[] {
  return normalizeMessages(value);
}
