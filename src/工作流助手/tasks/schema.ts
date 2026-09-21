import { z } from 'zod';
import { normalizePromptRole } from './prompt-role';

export const PromptGroupSchema = z.object({
  name: z.string().default(''),
  role: z.preprocess(
    value => (typeof value === 'string' ? normalizePromptRole(value) : value),
    z.enum(['system', 'user', 'assistant']).default('user'),
  ),
  content: z.string().default(''),
  enabled: z.boolean().default(true),
});

/** 自动段插入位（按 order 插在手动 promptGroups 之前） */
export const PromptAutoSlotSchema = z.object({
  id: z.string(),
  name: z.string().default('未命名插入位'),
  order: z.number().int().min(0).default(0),
});

/** 任务级自动提示词段（风味块） */
export const PromptAutoSegmentSchema = z.object({
  id: z.string(),
  slotId: z.string(),
  name: z.string().default(''),
  role: z.preprocess(
    value => (typeof value === 'string' ? normalizePromptRole(value) : value),
    z.enum(['system', 'user', 'assistant']).default('user'),
  ),
  content: z.string().default(''),
  inserted: z.boolean().default(false),
  /** 同插入位内从左到右的排序（越小越靠前） */
  sortOrder: z.number().int().min(0).default(0),
});

export const TimeSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message_tag'),
    tagNames: z.array(z.string()).default(['time']),
    scope: z.enum(['current_ai', 'current_pair']).default('current_ai'),
  }),
  z.object({
    type: z.literal('variable'),
    variableType: z.enum(['chat', 'global', 'message', 'script', 'character']).default('chat'),
    path: z.string().default(''),
    message_id: z.number().optional(),
  }),
]);

export const TaskScheduleSchema = z.object({
  /** 调度模式：按回合间隔 或 按游戏时间间隔，二选一；缺省时由 timeInterval.enabled 推断 */
  mode: z.enum(['round', 'time']).optional(),
  roundInterval: z.number().int().min(0).optional(),
  timeInterval: z
    .object({
      enabled: z.boolean().default(false),
      value: z.number().positive().default(1),
      unit: z.enum(['minute', 'hour', 'day', 'week', 'month', 'year']).default('hour'),
      timeSource: TimeSourceSchema,
      /** @deprecated 读不到/解析失败一律跳过；保留字段仅兼容旧配置 */
      onParseFail: z.enum(['skip', 'run', 'wall_clock']).optional(),
    })
    .optional(),
});

export const PlotWorldbookConfigSchema = z.object({
  source: z.enum(['character', 'manual']).default('character'),
  manualSelection: z.array(z.string()).default([]),
  enabledEntries: z.record(z.string(), z.array(z.number())).default({}),
});

export const PlotWorldbookModeSchema = z.enum(['inherit', 'custom', 'inheritRoot']);

/** 副本族成员 API 路由：沿用原本 / 本副本自定义 */
export const ApiPresetModeSchema = z.enum(['inheritRoot', 'custom']);

export const ApiConfigSchema = z.object({
  url: z.string().default(''),
  apiKey: z.string().default(''),
  model: z.string().default(''),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().optional(),
  source: z.string().default('openai'),
  proxy_preset: z.string().optional(),
  bodyParams: z.string().default(''),
  excludeBodyParams: z.string().default(''),
  requestHeaders: z.string().default(''),
  /** SillyTavern custom_prompt_post_processing；DeepSeek 结构化输出推荐 strict */
  customPromptPostProcessing: z.enum(['none', 'strict']).default('none'),
  includeReasoning: z.boolean().default(false),
  reasoningEffort: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const ApiPresetSchema = z.object({
  name: z.string(),
  apiConfig: ApiConfigSchema,
});

export const ApiPresetBindingSchema = z.object({
  presetName: z.string(),
  updatedAt: z.number(),
});

export const ContextTagRuleSchema = z.object({
  start: z.string().default(''),
  end: z.string().default(''),
});

export const TaskContextConfigSchema = z.object({
  contextTurnCount: z.number().int().min(0).default(3),
  contextExtractRules: z.array(ContextTagRuleSchema).default([]),
  contextExcludeRules: z.array(ContextTagRuleSchema).default([]),
});

function migratePostProcessTaskRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const task = { ...(raw as Record<string, unknown>) };
  const legacy = task.apiRouteMaxConcurrency;
  if (task.apiPrimaryMaxConcurrency === undefined && legacy !== undefined) {
    const legacyNum = Math.max(0, Math.floor(Number(legacy) || 5));
    task.apiPrimaryMaxConcurrency = legacyNum;
    const fbNames = Array.isArray(task.apiPresetFallbackNames) ? task.apiPresetFallbackNames : [];
    task.apiFallbackMaxConcurrencies = fbNames.map(() => legacyNum);
  }
  delete task.apiRouteMaxConcurrency;
  if (task.replicaFamilyScheduleMode === undefined && task.syncAsReplicaFamily) {
    task.replicaFamilyScheduleMode = 'auto';
  }
  if (task.replicaFamilyRootId && task.replicaFamilyLaunched === undefined) {
    task.replicaFamilyLaunched = false;
  }
  if (task.taskWorkflowPresets === undefined) {
    task.taskWorkflowPresets = [];
  }
  return task;
}

/** 工作流预设快照：不含 id 与 API 路由字段 */
export const TaskWorkflowPresetSnapshotSchema = z.object({
  name: z.string().default('未命名任务'),
  enabled: z.boolean().default(true),
  stage: z.number().int().min(1).default(1),
  promptGroups: z.array(PromptGroupSchema).default([]),
  promptAutoSlots: z.array(PromptAutoSlotSchema).default([]),
  promptAutoSegments: z.array(PromptAutoSegmentSchema).default([]),
  extractInjectTags: z.array(z.string()).default(['result']),
  mergeStrategy: z.enum(['concat', 'replace', 'first']).default('concat'),
  maxRetries: z.number().int().min(1).default(3),
  minLength: z.number().int().min(0).default(0),
  skipIfTagsFound: z.array(z.string()).optional(),
  recommendedModel: z.string().default(''),
  schedule: TaskScheduleSchema.optional(),
  plotWorldbookMode: PlotWorldbookModeSchema.default('inherit'),
  plotWorldbookConfig: PlotWorldbookConfigSchema.optional(),
  contextMode: z.enum(['inherit', 'custom']).default('inherit'),
  contextConfig: TaskContextConfigSchema.optional(),
  structuredOutputMode: z.enum(['off', 'mvu_json_patch', 'addon_json_patch']).default('off'),
  structuredOutputRules: z
    .object({
      mvu: z.string().optional(),
      addon: z.string().optional(),
    })
    .optional(),
  replicaFamilySpec: z.string().optional(),
  replicaFamilyEnumSpec: z.string().optional(),
  replicaFamilyBaseName: z.string().optional(),
});

export const TaskWorkflowPresetEntrySchema = z.object({
  name: z.string(),
  savedAt: z.number().default(() => Date.now()),
  snapshot: TaskWorkflowPresetSnapshotSchema,
});

const PostProcessTaskShape = z.object({
  id: z.string(),
  name: z.string().default('未命名任务'),
  enabled: z.boolean().default(true),
  stage: z.number().int().min(1).default(1),
  promptGroups: z.array(PromptGroupSchema).default([]),
  /** 自动段插入位分类 */
  promptAutoSlots: z.array(PromptAutoSlotSchema).default([]),
  /** 任务级自动提示词段（风味块） */
  promptAutoSegments: z.array(PromptAutoSegmentSchema).default([]),
  /**
   * 副本族成员：按自动段 id 覆盖 `inserted`；缺 key 则跟随原本该段。
   * 原本任务忽略此字段。
   */
  promptAutoSegmentInsertedOverrides: z.record(z.string(), z.boolean()).optional(),
  extractInjectTags: z.array(z.string()).default(['result']),
  mergeStrategy: z.enum(['concat', 'replace', 'first']).default('concat'),
  maxRetries: z.number().int().min(1).default(3),
  minLength: z.number().int().min(0).default(0),
  skipIfTagsFound: z.array(z.string()).optional(),
  apiPresetName: z.string().default(''),
  recommendedModel: z.string().default(''),
  apiPresetFallbackNames: z.array(z.string()).default([]),
  apiPrimaryMaxConcurrency: z.number().int().min(0).default(5),
  apiFallbackMaxConcurrencies: z.array(z.number().int().min(0)).default([]),
  /** 副本族成员：沿用原本 / 本副本自定义 API 路由；普通任务与原本忽略此字段 */
  apiPresetMode: ApiPresetModeSchema.default('inheritRoot'),
  schedule: TaskScheduleSchema.optional(),
  plotWorldbookMode: PlotWorldbookModeSchema.default('inherit'),
  plotWorldbookConfig: PlotWorldbookConfigSchema.optional(),
  contextMode: z.enum(['inherit', 'custom']).default('inherit'),
  contextConfig: TaskContextConfigSchema.optional(),
  structuredOutputMode: z.enum(['off', 'mvu_json_patch', 'addon_json_patch']).default('off'),
  structuredOutputRules: z
    .object({
      mvu: z.string().optional(),
      addon: z.string().optional(),
    })
    .optional(),
  syncAsReplicaFamily: z.boolean().optional(),
  replicaFamilyRootId: z.string().optional(),
  replicaFamilyAttrValue: z.string().optional(),
  replicaFamilySpec: z.string().optional(),
  replicaFamilyEnumSpec: z.string().optional(),
  replicaFamilyBaseName: z.string().optional(),
  replicaFamilyScheduleMode: z.enum(['auto', 'manual']).optional(),
  replicaFamilyLaunched: z.boolean().optional(),
  taskWorkflowPresets: z.array(TaskWorkflowPresetEntrySchema).default([]),
});

export const PostProcessTaskSchema = z.preprocess(migratePostProcessTaskRaw, PostProcessTaskShape);

/** @deprecated 旧版规则，加载时自动迁移为 ContextTagRule */
export const ContextExcludeRuleSchema = z.object({
  tag: z.string(),
  mode: z.enum(['remove', 'extract']).default('remove'),
});

export const RunLogMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().default(''),
  name: z.string().default(''),
});

export const RunLogTaskResultSchema = z.object({
  taskId: z.string(),
  taskName: z.string(),
  stage: z.number().int().optional(),
  skipped: z.boolean().optional(),
  skipReason: z.string().optional(),
  success: z.boolean().optional(),
  preview: z.string().optional(),
  extractedTags: z.record(z.string(), z.string()).optional(),
  durationMs: z.number().optional(),
  promptMessages: z.array(RunLogMessageSchema).default([]),
  aiOutput: z.string().default(''),
  aiReasoning: z.string().optional().default(''),
  apiPresetUsed: z.string().optional(),
});

export const ChatExtractTagsConfigSchema = z.object({
  user: z.array(z.string()).default([]),
  assistant: z.array(z.string()).default([]),
});

export const ChatBodyTagReplaceRuleSchema = z.object({
  id: z.string().default(''),
  targetTag: z.string().default(''),
  template: z.string().default(''),
});

export const ChatWorldbookWritePlacementSchema = z.object({
  position: z.string().default('at_depth_as_system'),
  depth: z.number().int().default(2),
  order: z.number().int().default(10000),
});

export const ChatWorldbookWriteRuleSchema = z.object({
  id: z.string().default(''),
  targetTag: z.string().default(''),
  template: z.string().default(''),
  /** 已废弃：保留以免旧预设多字段解析失败；运行时忽略，条目名固定为 WorkflowHelper-… */
  entryName: z.string().default(''),
  bookSource: z.enum(['character', 'manual']).default('character'),
  manualBookName: z.string().default(''),
  entryType: z.enum(['constant', 'keyword']).default('constant'),
  keywords: z.string().default(''),
  splitByAttr: z.boolean().default(false),
  /** 按属性拆分时包裹开/闭标签名；空则用目标标签的 tagName */
  wrapTagName: z.string().default(''),
  placement: ChatWorldbookWritePlacementSchema.default({
    position: 'at_depth_as_system',
    depth: 2,
    order: 10000,
  }),
  preventRecursion: z.boolean().default(true),
});

export const PostProcessPresetSchema = z.object({
  name: z.string(),
  tasks: z.array(PostProcessTaskSchema).default([]),
  finalInjectTemplate: z.string().default(''),
  /** 用户发送时提示词注入（in_chat/user/depth0/should_scan），不改正文 */
  userInputEndInjectTemplate: z.string().default(''),
  tagVariableInjectTemplate: z.string().default(''),
  chatExtractTags: ChatExtractTagsConfigSchema.default({ user: [], assistant: [] }),
  chatBodyTagReplaceRules: z.array(ChatBodyTagReplaceRuleSchema).default([]),
  chatWorldbookWriteRules: z.array(ChatWorldbookWriteRuleSchema).default([]),
  contextTurnCount: z.number().int().min(0).default(3),
  contextExtractRules: z.array(ContextTagRuleSchema).default([]),
  contextExcludeRules: z.array(ContextTagRuleSchema).default([]),
  plotWorldbookConfig: PlotWorldbookConfigSchema.default({
    source: 'character',
    manualSelection: [],
    enabledEntries: {},
  }),
  taskPlotWorldbookOverridesEnabled: z.boolean().default(false),
  taskContextOverridesEnabled: z.boolean().default(false),
  /** $6：最近 N 条 AM 纪要行条目（CustomExport-纪要-N） */
  memoryRecallRecentCount: z.number().int().min(0).default(10),
});

export const ScheduleStateEntrySchema = z.object({
  lastRunRound: z.number().int().default(0),
  lastRunGameTimeRaw: z.string().optional(),
  lastRunGameTimeMs: z.number().optional(),
  lastRunAt: z.number().optional(),
  /** 上次实际执行时所在聊天；用于换聊天后重置回合/时间间隔锚点 */
  lastRunChatKey: z.string().optional(),
});

/** 存于 SillyTavern chatMetadata 的聊天级任务预设快照键 */
export const CHAT_SCOPE_METADATA_KEY = '_post_process_chat_scope';

/** 聊天快照预设内部名称（不出现在全局 presets 列表） */
export const CHAT_SNAPSHOT_PRESET_NAME = '__chat_snapshot__';

export const ChatTaskScopeStateSchema = z.object({
  mode: z.enum(['chat_override', 'inherit_global']).default('inherit_global'),
  snapshot: PostProcessPresetSchema.optional(),
  originPresetName: z.string().default(''),
  updatedAt: z.number().default(0),
  source: z.enum(['api', 'ui', 'inherit']).default('inherit'),
  /** 有快照时：用 snapshot 还是临时套用某全局预设（不改全局 settings） */
  activeView: z.enum(['snapshot', 'global']).default('snapshot'),
  /** activeView === 'global' 时绑定的全局预设名 */
  boundGlobalPresetName: z.string().default(''),
});

export const ScriptSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    apiConfig: ApiConfigSchema.default({
      url: '',
      apiKey: '',
      model: '',
      source: 'openai',
    }),
    apiPresets: z.array(ApiPresetSchema).default([]),
    defaultApiPresetName: z.string().default(''),
    activeApiPresetName: z.string().default(''),
    apiPresetBindingsByChat: z.record(z.string(), ApiPresetBindingSchema).default({}),
    defaultTaskApiPreset: z.string().default(''),
    taskApiPresetOverridesById: z.record(z.string(), z.string()).default({}),
    tasks: z.array(PostProcessTaskSchema).default([]),
    contextTurnCount: z.number().int().min(0).default(3),
    contextExtractRules: z.array(ContextTagRuleSchema).default([]),
    contextExcludeRules: z.array(ContextTagRuleSchema).default([]),
    plotWorldbookConfig: PlotWorldbookConfigSchema.default({
      source: 'character',
      manualSelection: [],
      enabledEntries: {},
    }),
    taskPlotWorldbookOverridesEnabled: z.boolean().default(false),
    taskContextOverridesEnabled: z.boolean().default(false),
    memoryRecallRecentCount: z.number().int().min(0).default(10),
    finalInjectTemplate: z.string().default(''),
    userInputEndInjectTemplate: z.string().default(''),
    tagVariableInjectTemplate: z.string().default(''),
    chatExtractTags: ChatExtractTagsConfigSchema.default({ user: [], assistant: [] }),
    chatBodyTagReplaceRules: z.array(ChatBodyTagReplaceRuleSchema).default([]),
    chatWorldbookWriteRules: z.array(ChatWorldbookWriteRuleSchema).default([]),
    presets: z.array(PostProcessPresetSchema).default([]),
    activePresetName: z.string().default(''),
    scheduleState: z.record(z.string(), ScheduleStateEntrySchema).default({}),
    lastRunStatus: z
      .object({
        messageId: z.number().optional(),
        at: z.number().optional(),
        taskResults: z.array(RunLogTaskResultSchema).default([]),
      })
      .default({ taskResults: [] }),
    messageVarRetention: z
      .object({
        enabled: z.boolean().default(true),
        keepFloors: z.number().int().min(1).default(20),
      })
      .default({ enabled: true, keepFloors: 20 }),
    replicaFamilyCleanup: z
      .object({
        enabled: z.boolean().default(false),
        cycleRounds: z.number().int().min(1).default(10),
        /** 本周期最少调度放行（试过）次数才算活跃；0=关闭活跃过滤 */
        minActivityTries: z.number().int().min(0).default(1),
        /** @deprecated 由 ensureReplicaFamilyCleanupDefaults 迁入 minActivityTries 后删除 */
        activityRatio: z.number().min(0).max(1).optional(),
        mode: z.enum(['auto', 'manual']).default('manual'),
        roundsSinceCleanup: z.number().int().min(0).default(0),
        cycleRunCounts: z.record(z.string(), z.number().int().min(0)).default({}),
        /** 本清理周期内调度放行次数（试过）；活跃判定用，须 ≥ cycleRunCounts */
        cycleOpportunityCounts: z.record(z.string(), z.number().int().min(0)).default({}),
        /** 本周期已进 runnable 但调度未放行（等间隔/时间）次数；>0 视为仍有效 */
        cycleScheduleWaitCounts: z.record(z.string(), z.number().int().min(0)).default({}),
        lastManualKeepBySpec: z.record(z.string(), z.array(z.string())).default({}),
        /** @deprecated 加载后由 ensureReplicaFamilyCleanupDefaults 迁入 lastManualKeepBySpec */
        lastManualKeepByRoot: z.record(z.string(), z.array(z.string())).optional(),
        lastCleanupRound: z.number().int().min(0).default(0),
      })
      .default({
        enabled: false,
        cycleRounds: 10,
        minActivityTries: 1,
        mode: 'manual',
        roundsSinceCleanup: 0,
        cycleRunCounts: {},
        cycleOpportunityCounts: {},
        cycleScheduleWaitCounts: {},
        lastManualKeepBySpec: {},
        lastCleanupRound: 0,
      }),
    uiThemeId: z.string().default('creamy-minimal'),
    /** 进度 HUD 自定义位置（视口比例）；null = CSS 默认右上角 */
    progressHudPosition: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .nullable()
      .default(null),
  })
  .prefault({});

export type PostProcessTask = z.infer<typeof PostProcessTaskSchema>;
export type ChatExtractTagsConfig = z.infer<typeof ChatExtractTagsConfigSchema>;
export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type ApiPreset = z.infer<typeof ApiPresetSchema>;
export type ApiPresetBinding = z.infer<typeof ApiPresetBindingSchema>;
export type PlotWorldbookConfig = z.infer<typeof PlotWorldbookConfigSchema>;
export type PlotWorldbookMode = z.infer<typeof PlotWorldbookModeSchema>;
export type ApiPresetMode = z.infer<typeof ApiPresetModeSchema>;
export type TaskContextConfig = z.infer<typeof TaskContextConfigSchema>;
export type PostProcessPreset = z.infer<typeof PostProcessPresetSchema>;
export type ScriptSettings = z.infer<typeof ScriptSettingsSchema>;
export type ContextTagRule = z.infer<typeof ContextTagRuleSchema>;
export type RunLogMessage = z.infer<typeof RunLogMessageSchema>;
export type RunLogTaskResult = z.infer<typeof RunLogTaskResultSchema>;
export type ScheduleStateEntry = z.infer<typeof ScheduleStateEntrySchema>;
export type TaskSchedule = z.infer<typeof TaskScheduleSchema>;
export type ChatWorldbookWriteRule = z.infer<typeof ChatWorldbookWriteRuleSchema>;
export type ChatWorldbookWritePlacement = z.infer<typeof ChatWorldbookWritePlacementSchema>;
export type ChatTaskScopeState = z.infer<typeof ChatTaskScopeStateSchema>;
export type TaskWorkflowPresetEntry = z.infer<typeof TaskWorkflowPresetEntrySchema>;
export type TaskWorkflowPresetSnapshot = z.infer<typeof TaskWorkflowPresetSnapshotSchema>;
export type ReplicaFamilyScheduleMode = 'auto' | 'manual';
