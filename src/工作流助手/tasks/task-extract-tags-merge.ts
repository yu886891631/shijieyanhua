import { parseExtractTagSpec } from './tag-extract';
import type { PostProcessTask } from './schema';

export type TaskExecutionOptionsPatch = Partial<{
  maxRetries: number;
  minLength: number;
  skipIfTagsFound: string[] | undefined;
}>;

export function normalizeExtractInjectTags(tags: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    if (!parseExtractTagSpec(trimmed)) {
      throw new Error(`无效提取标签规格: ${trimmed}`);
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }

  if (!normalized.length) {
    throw new Error('至少需要一个提取标签');
  }
  return normalized;
}

function normalizeSkipIfTagsFound(tags: string[] | undefined): string[] | undefined {
  if (tags === undefined) return undefined;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

export function mergeTaskExecutionOptions(
  existing: Pick<PostProcessTask, 'maxRetries' | 'minLength' | 'skipIfTagsFound'>,
  patch: TaskExecutionOptionsPatch,
): Partial<PostProcessTask> {
  const result: Partial<PostProcessTask> = {};

  if (patch.maxRetries !== undefined) {
    if (!Number.isInteger(patch.maxRetries) || patch.maxRetries < 1) {
      throw new Error(`maxRetries 无效: ${patch.maxRetries}（须为 >= 1 的整数）`);
    }
    result.maxRetries = patch.maxRetries;
  }

  if (patch.minLength !== undefined) {
    if (!Number.isInteger(patch.minLength) || patch.minLength < 0) {
      throw new Error(`minLength 无效: ${patch.minLength}（须为 >= 0 的整数）`);
    }
    result.minLength = patch.minLength;
  }

  if (patch.skipIfTagsFound !== undefined) {
    result.skipIfTagsFound = normalizeSkipIfTagsFound(patch.skipIfTagsFound);
  }

  return result;
}
