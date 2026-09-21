const UPDATE_VARIABLE_RE = /<UpdateVariable>/i;

export type StageVariableUpdateResult = {
  success: boolean;
  skipped?: boolean;
  variableUpdateSource?: string;
};

export function hasUpdateVariableTag(text: string): boolean {
  return UPDATE_VARIABLE_RE.test(String(text || ''));
}

/** 本阶段成功任务中含 `<UpdateVariable>` 的全文，按结果顺序（串行 apply 用） */
export function collectStageVariableUpdateSources(stageResults: StageVariableUpdateResult[]): string[] {
  const sources: string[] = [];
  for (const r of stageResults) {
    if (!r.success || r.skipped) continue;
    const src = r.variableUpdateSource ?? '';
    if (!src.trim() || !hasUpdateVariableTag(src)) continue;
    sources.push(src);
  }
  return sources;
}
