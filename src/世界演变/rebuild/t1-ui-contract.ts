/**
 * T1 页面与交互意图契约。没有宿主、存档、模型或世界书执行器。
 * available-intent 仅表示 UI 可继续申请该操作，不构成生产授权。
 * 这里的 tableId 只是透明度为零的 UI 身份；正式模板协议由 T2 定义。
 */

export const T1_PAGE_IDS = [
  'overview',
  'data',
  'history',
  'worldbook',
  'api',
  'evolution',
  'prompts',
  'backup',
  'appearance',
] as const;
export type T1PageId = (typeof T1_PAGE_IDS)[number];
export type T1Scope =
  | 'current-world'
  | 'current-template'
  | 'global-template'
  | 'runtime-config'
  | 'display-settings'
  | 'history'
  | 'projection';
export type T1ParameterSection = 'schema' | 'lifecycle' | 'runtime' | 'context' | 'api' | 'export' | 'advanced';
export type T1Route =
  | Readonly<{ page: Exclude<T1PageId, 'data'> }>
  | Readonly<{ page: 'data'; tableId: string | null; tab: 'records' | 'parameters'; section: T1ParameterSection }>;

function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new Error(`${label} contains an unsupported property`);
  }
}

function textValue(value: unknown, label: string, max = 160): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !value ||
    value.length > max ||
    [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    throw new Error(`${label} must be a nonempty printable string`);
  }
  return value;
}

export const T1_PARAMETER_SECTIONS = freeze([
  { id: 'schema', label: '基本结构与字段' },
  { id: 'lifecycle', label: '填表与生命周期规则' },
  { id: 'runtime', label: '演算参数' },
  { id: 'context', label: '上下文' },
  { id: 'api', label: 'API 继承' },
  { id: 'export', label: '世界书导出' },
  { id: 'advanced', label: '高级查询与结构' },
] satisfies { id: T1ParameterSection; label: string }[]);

export const T1_PAGE_ITEMS = freeze([
  { id: 'overview', label: '总览', group: '工作台', description: '查看准备情况与最近变化，不启动演变。' },
  { id: 'data', label: '世界资料', group: '工作台', description: '宏观与微观表格；数据和结构参数分开。' },
  { id: 'history', label: '楼层记录', group: '工作台', description: '查看历史、失败运行与正式提交。' },
  { id: 'worldbook', label: '世界书投影', group: '工作台', description: '预览主 AI 将读取的资料与同步状态。' },
  { id: 'api', label: 'API 配置', group: '演变配置', description: '独立设置模型及继承路由。' },
  { id: 'evolution', label: '自动演变', group: '演变配置', description: '前置等待、宏观后微观、预算与取消。' },
  { id: 'prompts', label: '填表提示词', group: '演变配置', description: '规则草稿、启用版本与发送预览。' },
  { id: 'backup', label: '备份与迁移', group: '演变配置', description: '先预览目标和冲突，再导入或恢复。' },
  { id: 'appearance', label: '外观与显示', group: '设置', description: '主题、密度、缩放与可读性。' },
] satisfies { id: T1PageId; label: string; group: string; description: string }[]);

export const T1_SCOPE_DESCRIPTIONS = freeze({
  'current-world': '当前世界资料：正式接入后写入本聊天的当前世界；不修改全局模板。',
  'current-template': '当前聊天模板：结构修改需预检和迁移；不覆盖其他聊天或全局默认。',
  'global-template': '全局默认模板：只供以后采用它的新世界使用；不改当前世界资料。',
  'runtime-config': '运行配置：保存设置本身不发送 AI 请求；普通 API 参数修改从下一轮生效。',
  'display-settings': '本机显示设置：仅控制本机的主题、密度和缩放；不改世界、模板、模型或世界书。',
  history: '历史记录：查看不写入；恢复已保存版本是另外一项操作，不调用 AI。',
  projection: '世界书投影：仅涉及当前世界受托管条目；预览与实际同步分开。',
} satisfies Record<T1Scope, string>);

export const T1_RUN_STATES = freeze([
  { id: 'idle', label: '尚未运行' },
  { id: 'waiting', label: '等待本轮前置处理' },
  { id: 'macro', label: '宏观演变中' },
  { id: 'macro-staged', label: '宏观已暂存，尚未正式保存' },
  { id: 'micro', label: '微观演变中' },
  { id: 'validating', label: '整轮校验中' },
  { id: 'saving', label: '保存中，尚未确认成功' },
  { id: 'projecting', label: '已保存，投影同步中' },
  { id: 'failed', label: '本次运行失败，不代表新增世界版本' },
  { id: 'interrupted', label: '请求已中断，结果未知；不自动重试或假报恢复成功' },
  { id: 'cancelled', label: '已请求取消，已发出的请求不保证退费' },
] as const);
export type T1RunStatus = (typeof T1_RUN_STATES)[number]['id'];

export const T1_UI_STATES = freeze([
  { id: 'uninitialized', label: '未初始化：可以准备草稿，不自动填满表格' },
  { id: 'no-anchor', label: '无有效助手楼层：不能正式保存当前世界' },
  { id: 'sandbox-only', label: '沙盒样例：未写当前聊天，不调用真实 API' },
  { id: 'production', label: '实际存档：只在宿主能力通过后开放对应操作' },
  { id: 'running', label: '运行中：草稿可编辑，数据或结构保存需先取消本轮' },
  { id: 'failed', label: '失败：保留草稿；运行日志与正式提交分开' },
  { id: 'stale', label: '过期：身份或基线已改变，旧结果不能提交' },
  { id: 'dirty', label: '未保存草稿：跨页或关闭先选择留在页面或明确丢弃' },
  { id: 'history-readonly', label: '历史只读：查看不改变当前世界' },
  { id: 'projection-pending', label: '世界已保存，世界书仍待同步' },
  { id: 'save-confirmation-unknown', label: '保存结果尚未确认：只读对账前不能重复保存、恢复、演算或同步' },
] as const);

export function createT1Route(input: unknown): T1Route {
  const value = record(input, 'route');
  if (!T1_PAGE_IDS.includes(value.page as T1PageId)) throw new Error('Unsupported page');
  if (value.page !== 'data') {
    exactKeys(value, ['page'], 'route');
    return freeze({ page: value.page as Exclude<T1PageId, 'data'> });
  }
  exactKeys(value, ['page', 'tableId', 'tab', 'section'], 'data route');
  const tableId = value.tableId === undefined || value.tableId === null ? null : textValue(value.tableId, 'tableId');
  const tab = value.tab === undefined ? 'records' : value.tab;
  if (tab !== 'records' && tab !== 'parameters') throw new Error('Unsupported table tab');
  const section = value.section === undefined ? 'schema' : value.section;
  if (!T1_PARAMETER_SECTIONS.some(item => item.id === section)) throw new Error('Unsupported parameter section');
  if (tab === 'records' && section !== 'schema') throw new Error('Records route cannot select a parameter section');
  return freeze({
    page: 'data',
    tableId,
    tab: tab as 'records' | 'parameters',
    section: section as T1ParameterSection,
  });
}

export type T1ActionId =
  | 'view-data'
  | 'view-history'
  | 'preview-context'
  | 'preview-projection'
  | 'inspect-save-status'
  | 'initialize-world'
  | 'save-data'
  | 'migrate-template'
  | 'save-global-template'
  | 'save-runtime-config'
  | 'save-prompt-draft'
  | 'save-display-settings'
  | 'test-api-local'
  | 'test-api-real'
  | 'run-evolution'
  | 'regenerate'
  | 'recover-history'
  | 'sync-projection'
  | 'retry-projection'
  | 'cancel-run'
  | 'import-world'
  | 'clear-plugin-data';
export type T1Capability =
  | 'chat-write'
  | 'stable-anchor'
  | 'api'
  | 'projection-isolation'
  | 'worldbook-target'
  | 'run-cancel';
export type T1CapabilityStatus = 'verified' | 'unknown' | 'unsupported';
export type T1ActionDescriptor = Readonly<{
  id: T1ActionId;
  label: string;
  scope: T1Scope;
  phase: string;
  consequence: string;
  effects: Readonly<{
    reads: boolean;
    worldWrite: boolean;
    templateWrite: boolean;
    configWrite: boolean;
    realApi: boolean;
    worldbookWrite: boolean;
    runtimeChange: boolean;
  }>;
  capabilities: readonly T1Capability[];
  requiresConfirmation: boolean;
}>;

function action(
  id: T1ActionId,
  label: string,
  scope: T1Scope,
  phase: string,
  consequence: string,
  flags: Partial<T1ActionDescriptor['effects']> = {},
  capabilities: T1Capability[] = [],
  requiresConfirmation = false,
): T1ActionDescriptor {
  return freeze({
    id,
    label,
    scope,
    phase,
    consequence,
    effects: {
      reads: true,
      worldWrite: false,
      templateWrite: false,
      configWrite: false,
      realApi: false,
      worldbookWrite: false,
      runtimeChange: false,
      ...flags,
    },
    capabilities,
    requiresConfirmation,
  });
}

export const T1_ACTIONS = freeze([
  action('view-data', '查看世界资料', 'current-world', 'T1 / T5', '只查看资料；不保存、不调用 AI、不写世界书。'),
  action('view-history', '查看历史', 'history', 'T1 / T10–T11', '只读历史；不恢复、不生成、不改变当前世界。'),
  action('preview-context', '预览发送内容', 'runtime-config', 'T7', '查看计划发送的内容；预览本身不发送请求。'),
  action(
    'preview-projection',
    '预览世界书',
    'projection',
    'T12',
    '只预览受可见性约束的投影；不读取或修改其他插件数据。',
  ),
  action(
    'inspect-save-status',
    '只读核对保存状态',
    'history',
    'T10',
    '只读检查宿主与本地记录，不重发提交、不调用 AI、不写世界书。',
  ),
  action(
    'initialize-world',
    '准备并初始化世界',
    'current-world',
    'T2 / T4–T5',
    '先选择手动、导入或 AI 补全方式；本操作不隐含调用 AI，正式初始化须确认承载楼层。',
    { worldWrite: true },
    ['chat-write', 'stable-anchor'],
    true,
  ),
  action(
    'save-data',
    '保存当前世界资料',
    'current-world',
    'T4–T5 / T10',
    '仅提交当前世界的已校验数据；不会同时改模板、调用 AI 或同步世界书。',
    { worldWrite: true },
    ['chat-write', 'stable-anchor'],
    true,
  ),
  action(
    'migrate-template',
    '预览并保存当前聊天模板',
    'current-template',
    'T6 / T10',
    '预览结构差异与旧数据映射后，一并提交模板和迁移结果；原始历史保留。',
    { worldWrite: true, templateWrite: true },
    ['chat-write', 'stable-anchor'],
    true,
  ),
  action(
    'save-global-template',
    '保存为全局默认模板',
    'global-template',
    'T6 / T13',
    '只改变以后采用该模板的默认来源；不迁移当前世界或其他聊天。',
    { templateWrite: true },
    [],
    true,
  ),
  action(
    'save-runtime-config',
    '保存运行配置',
    'runtime-config',
    'T7 / T14',
    '仅保存配置；普通 API 参数只影响下一轮，不撤销本轮冻结配置，也不发送 AI 请求。',
    { configWrite: true },
  ),
  action(
    'save-prompt-draft',
    '保存提示词草稿（不启用）',
    'current-template',
    'T7',
    '仅保存当前聊天的提示词草稿；不启用新规则、不改变活动模板或本轮输入、不发送 AI 请求。启用是后续的独立确认操作。',
    { templateWrite: true },
    ['chat-write'],
  ),
  action(
    'save-display-settings',
    '保存本机显示设置',
    'display-settings',
    'T14',
    '仅保存本机外观；不改世界资料、模板、API 路由或世界书，不发送请求。',
    { configWrite: true },
  ),
  action(
    'test-api-local',
    '本地模拟连接测试',
    'runtime-config',
    'T7',
    '仅检查本地假响应流程，不验证网络、Key 或真实演变。',
    { runtimeChange: true },
  ),
  action(
    'test-api-real',
    '真实连接测试',
    'runtime-config',
    'T7 / T15',
    '将访问所选真实 API，可能消耗额度；不保存世界资料。',
    { realApi: true },
    ['api'],
    true,
  ),
  action(
    'run-evolution',
    '开始一轮演变',
    'current-world',
    'T8–T10',
    '等待必要前置后，宏观再微观；可能调用真实 API，成功时整轮统一提交。世界书同步权限单独控制。',
    { worldWrite: true, realApi: true, runtimeChange: true },
    ['chat-write', 'stable-anchor', 'api'],
    true,
  ),
  action(
    'regenerate',
    '重新演算',
    'current-world',
    'T8–T11',
    '重新请求 AI，可能再次收费；不是读取或恢复旧结果。提交前检查最新基线。',
    { worldWrite: true, realApi: true, runtimeChange: true },
    ['chat-write', 'stable-anchor', 'api'],
    true,
  ),
  action(
    'recover-history',
    '恢复已保存世界',
    'current-world',
    'T10–T11',
    '按历史快照与日志恢复到明确目标；写当前世界但不调用 AI，不产生随机新结果。',
    { worldWrite: true },
    ['chat-write', 'stable-anchor'],
    true,
  ),
  action(
    'sync-projection',
    '同步世界书投影',
    'projection',
    'T12',
    '只写当前世界的托管条目；不改已保存世界，不重新生成，不处理其他插件条目。',
    { worldbookWrite: true },
    ['projection-isolation', 'worldbook-target'],
    true,
  ),
  action(
    'retry-projection',
    '仅重试世界书同步',
    'projection',
    'T12',
    '只重试有效世界版本的投影；不调用 AI、不重复提交世界。',
    { worldbookWrite: true },
    ['projection-isolation', 'worldbook-target'],
    true,
  ),
  action(
    'cancel-run',
    '请求取消本轮',
    'runtime-config',
    'T8–T9',
    '使当前运行失效并请求取消；不能保证撤销已发出的请求或费用。关闭面板不是取消。',
    { runtimeChange: true },
    ['run-cancel'],
    true,
  ),
  action(
    'import-world',
    '预览并导入世界数据',
    'current-world',
    'T13',
    '先校验来源、目标、引用与冲突；确认后只改选定世界，不覆盖聊天剧情或其他插件。',
    { worldWrite: true },
    ['chat-write', 'stable-anchor'],
    true,
  ),
  action(
    'clear-plugin-data',
    '清除本插件当前世界数据',
    'current-world',
    'T13',
    '确认备份与目标后，只清本插件当前世界资料；不删剧情、MVU 或数据库插件资料。托管世界书条目清理是另行确认的操作。',
    { worldWrite: true },
    ['chat-write'],
    true,
  ),
] as T1ActionDescriptor[]);

export function describeT1Action(id: T1ActionId): T1ActionDescriptor {
  const result = T1_ACTIONS.find(item => item.id === id);
  if (!result) throw new Error('Unsupported action');
  return result;
}

export type T1UiPolicyContext = Readonly<{
  mode: 'sandbox-only' | 'production';
  worldStatus: 'uninitialized' | 'ready' | 'corrupt' | 'history-readonly';
  runStatus: T1RunStatus;
  freshness: 'current' | 'stale';
  saveConfirmation: 'not-applicable' | 'confirmed' | 'unknown';
  hasAssistantAnchor: boolean;
  chatIdentityKnown: boolean;
  capabilities: Readonly<Partial<Record<T1Capability, T1CapabilityStatus>>>;
}>;
export type T1ActionPolicy = Readonly<{
  status: 'available-intent' | 'blocked';
  authorized: false;
  confirmationRequired: boolean;
  scopeNotice: string;
  consequence: string;
  reasons: readonly Readonly<{ code: string; message: string }>[];
}>;

const activeRunStates: readonly T1RunStatus[] = [
  'waiting',
  'macro',
  'macro-staged',
  'micro',
  'validating',
  'saving',
  'projecting',
  'interrupted',
];
const capabilityLabels: Record<T1Capability, string> = {
  'chat-write': '宿主可靠保存与写入协调',
  'stable-anchor': '有效助手楼层锚点',
  api: '所选 API 路由',
  'projection-isolation': '世界书版本与世界隔离',
  'worldbook-target': '角色卡主世界书目标',
  'run-cancel': '运行取消与结果失效机制',
};

/** UI 阻断说明纯函数；不是宿主写入安全门或真实执行授权。 */
export function evaluateT1Action(id: T1ActionId, context: T1UiPolicyContext): T1ActionPolicy {
  const descriptor = describeT1Action(id);
  const reasons: { code: string; message: string }[] = [];
  const value = record(context, 'policy context');
  const validContext =
    (value.mode === 'sandbox-only' || value.mode === 'production') &&
    ['uninitialized', 'ready', 'corrupt', 'history-readonly'].includes(value.worldStatus as string) &&
    T1_RUN_STATES.some(item => item.id === value.runStatus) &&
    (value.freshness === 'current' || value.freshness === 'stale') &&
    ['not-applicable', 'confirmed', 'unknown'].includes(value.saveConfirmation as string) &&
    typeof value.hasAssistantAnchor === 'boolean' &&
    typeof value.chatIdentityKnown === 'boolean';
  const caps = record(value.capabilities, 'capabilities');
  const validCapabilities = Reflect.ownKeys(caps).every(
    key =>
      typeof key === 'string' &&
      Object.hasOwn(capabilityLabels, key) &&
      ['verified', 'unknown', 'unsupported'].includes(caps[key] as string),
  );
  if (!validContext || !validCapabilities) {
    reasons.push({ code: 'invalid-context', message: '页面状态或能力信息无效，不能开放该意图。' });
  } else {
    const effectful = Object.entries(descriptor.effects).some(([key, flag]) => key !== 'reads' && flag);
    if (context.mode === 'sandbox-only' && effectful) {
      reasons.push({
        code: 'future-service',
        message: `T1 仅定义操作；${descriptor.phase} 接入服务后才能使用，本样例不会假报成功。`,
      });
    }
    if (context.mode === 'production' && effectful) {
      for (const capability of descriptor.capabilities) {
        if (context.capabilities[capability] !== 'verified')
          reasons.push({
            code: `capability:${capability}`,
            message: `${capabilityLabels[capability]}尚未验证或不受支持。`,
          });
      }
    }
    if (descriptor.effects.worldWrite && (!context.chatIdentityKnown || !context.hasAssistantAnchor)) {
      reasons.push({
        code: 'no-world-anchor',
        message: '当前聊天身份或有效助手楼层未确认，只能保留草稿，不能正式保存世界。',
      });
    }
    if (descriptor.effects.worldbookWrite && !context.chatIdentityKnown) {
      reasons.push({ code: 'unknown-world', message: '世界身份未知，不能同步到共用世界书。' });
    }
    if (descriptor.effects.worldbookWrite && context.saveConfirmation === 'not-applicable') {
      reasons.push({ code: 'no-confirmed-world', message: '没有已确认保存的正式世界版本，不能同步或重试世界书投影。' });
    }
    if (effectful && descriptor.scope === 'current-template' && !context.chatIdentityKnown) {
      reasons.push({
        code: 'unknown-template-owner',
        message: '当前聊天身份未知，不能把草稿或模板写入一个不明确的聊天。可以继续编辑本页内存草稿。',
      });
    }
    const mutatesBaseline =
      descriptor.effects.worldWrite || (descriptor.scope === 'current-template' && id !== 'save-prompt-draft');
    if (mutatesBaseline && activeRunStates.includes(context.runStatus)) {
      reasons.push({
        code: 'cancel-before-commit',
        message: '本轮仍在运行：可以编辑草稿；正式保存资料或改结构前须先取消本轮。',
      });
    }
    if ((descriptor.effects.worldWrite || descriptor.effects.worldbookWrite) && context.freshness === 'stale') {
      reasons.push({ code: 'stale-baseline', message: '世界身份、活动模板或数据基线已改变；旧结果不能提交或投影。' });
    }
    if (
      (descriptor.effects.worldWrite || descriptor.effects.worldbookWrite) &&
      context.saveConfirmation === 'unknown'
    ) {
      reasons.push({
        code: 'save-confirmation-unknown',
        message: '上次保存结果未知：先只读核对，不得重复保存、恢复、重新演算或同步世界书。',
      });
    }
    if (
      (descriptor.effects.worldWrite || descriptor.effects.worldbookWrite || descriptor.scope === 'current-template') &&
      context.worldStatus === 'history-readonly'
    ) {
      reasons.push({
        code: 'history-readonly',
        message: '正在只读查看过去版本；请回到当前世界，再明确选择恢复或创建分支。',
      });
    }
    if (
      context.worldStatus === 'corrupt' &&
      (descriptor.effects.worldWrite || descriptor.effects.worldbookWrite) &&
      id !== 'recover-history' &&
      id !== 'import-world' &&
      id !== 'clear-plugin-data'
    ) {
      reasons.push({ code: 'corrupt-world', message: '存档校验失败；先保留原档并进入恢复流程。' });
    }
    if (
      context.worldStatus === 'uninitialized' &&
      (id === 'run-evolution' || id === 'regenerate' || descriptor.effects.worldbookWrite)
    ) {
      reasons.push({ code: 'uninitialized-world', message: '尚未初始化世界；先选择资料来源并完成初始化。' });
    }
    if (id === 'cancel-run' && !activeRunStates.includes(context.runStatus)) {
      reasons.push({ code: 'no-active-run', message: '当前没有需要取消的活动运行。' });
    }
  }
  return freeze({
    status: reasons.length ? 'blocked' : 'available-intent',
    authorized: false,
    confirmationRequired: descriptor.requiresConfirmation,
    scopeNotice: T1_SCOPE_DESCRIPTIONS[descriptor.scope],
    consequence: descriptor.consequence,
    reasons,
  });
}

export type T1PageBlueprint = Readonly<{
  title: string;
  sections: readonly string[];
  futurePhase: string;
  emptyTitle: string;
  emptyDescription: string;
  primaryActionId: T1ActionId;
}>;
export const T1_PAGE_BLUEPRINTS = freeze({
  overview: {
    title: '总览',
    sections: ['当前世界与分支', '准备检查', '最近变化与下一步'],
    futurePhase: 'T2 / T11',
    emptyTitle: '还没有正式世界资料',
    emptyDescription: '采用默认模板不等于自动生成示例人物。先选择资料来源，再准备初始化。',
    primaryActionId: 'initialize-world',
  },
  data: {
    title: '世界资料',
    sections: ['宏观世界与微观世界表列表', '数据：搜索、记录与草稿差异', '结构参数：字段、规则、上下文、API 与导出'],
    futurePhase: 'T2 / T5–T6',
    emptyTitle: '表格工作台尚未接入',
    emptyDescription: 'T1 只演示表级导航。T5 才会提供真正的新增行、字段编辑与沙盒保存。',
    primaryActionId: 'save-data',
  },
  history: {
    title: '楼层记录',
    sections: ['运行日志与正式提交列表', '前后差异与版本详情', '恢复、创建分支与重新演算入口'],
    futurePhase: 'T10–T11',
    emptyTitle: '没有正式提交记录',
    emptyDescription: '失败运行不是世界版本。查看历史不改变当前世界，恢复与重新演算必须分别选择。',
    primaryActionId: 'recover-history',
  },
  worldbook: {
    title: '世界书投影',
    sections: ['角色卡主世界书与隔离检查', '受可见性限制的投影预览', '新增、更新、删除与同步状态'],
    futurePhase: 'T12',
    emptyTitle: '尚未生成投影预览',
    emptyDescription: '没有主世界书或隔离证明时禁止同步；不会为了演示换书或写入任何条目。',
    primaryActionId: 'sync-projection',
  },
  api: {
    title: 'API 配置',
    sections: ['全局与宏微观阶段继承', '表级覆盖及最终路由', '本地模拟测试与真实测试分开'],
    futurePhase: 'T7',
    emptyTitle: '本样例未读取 API 设置',
    emptyDescription: '不读取旧 Key。普通配置修改下一轮才生效；本地模拟测试不证明真实网络可用。',
    primaryActionId: 'save-runtime-config',
  },
  evolution: {
    title: '自动演变',
    sections: ['触发与必要前置', '频率、预算与运行前检查', '宏观 → 微观 → 校验 → 保存 → 投影'],
    futurePhase: 'T8–T11',
    emptyTitle: '目前没有活动运行',
    emptyDescription: '暂存宏观不是正式保存。关闭面板不取消任务，真实演算可能产生 API 费用。',
    primaryActionId: 'run-evolution',
  },
  prompts: {
    title: '填表提示词',
    sections: ['全局、宏观、微观与表级规则', '草稿、启用版本与本轮冻结版本', '实际发送内容与输入来源预览'],
    futurePhase: 'T7',
    emptyTitle: '本样例没有启用提示词版本',
    emptyDescription: '规则编辑与启用分开；导入不覆盖本轮已冻结输入，系统 SQL 协议由后续服务保护。',
    primaryActionId: 'save-prompt-draft',
  },
  backup: {
    title: '备份与迁移',
    sections: ['世界、模板与历史分别导出', '来源、目标与冲突预览', '迁移、恢复与清除范围确认'],
    futurePhase: 'T13',
    emptyTitle: '没有待导入的资料',
    emptyDescription: '不自动扫描或迁移旧库。先保留原档；清除本插件资料不代表删除剧情或其他插件数据。',
    primaryActionId: 'import-world',
  },
  appearance: {
    title: '外观与显示',
    sections: ['主题与语义色', '字号、密度、列宽与长文本', '缩放、窄页与键盘可达性'],
    futurePhase: 'T14',
    emptyTitle: '保留既有外观基线',
    emptyDescription: '普通与成功用淡绿、危险用淡粉并配文字提示。不能只靠颜色区分错误、锁定或禁用。',
    primaryActionId: 'save-display-settings',
  },
} satisfies Record<T1PageId, T1PageBlueprint>);

/** 未来服务仅有签名；没有默认实现或自动回退，不在 T1 调用。 */
export interface T1FutureReadServices {
  readCurrentWorld(): Promise<unknown>;
  readHistory(targetId: string): Promise<unknown>;
  previewContext(): Promise<unknown>;
  previewProjection(): Promise<unknown>;
}
export interface T1FutureIntentServices {
  saveWorldData(draft: unknown): Promise<unknown>;
  migrateCurrentTemplate(preview: unknown): Promise<unknown>;
  saveGlobalTemplate(template: unknown): Promise<unknown>;
  saveRuntimeConfig(config: unknown): Promise<unknown>;
  runEvolution(): Promise<unknown>;
  regenerate(targetId: string): Promise<unknown>;
  recoverHistory(targetId: string): Promise<unknown>;
  syncProjection(): Promise<unknown>;
  requestCancel(): Promise<unknown>;
}

export type T1DraftMarker = Readonly<{ scope: T1Scope; label: string }>;
export type T1PendingLeave = Readonly<{ kind: 'navigate'; target: T1Route } | { kind: 'close' }>;
export type T1SandboxState = Readonly<{
  mode: 'sandbox-only';
  isOpen: boolean;
  route: T1Route;
  dirtyDraft: T1DraftMarker | null;
  pending: T1PendingLeave | null;
  notice: string | null;
}>;
export interface T1SandboxController {
  readonly mode: 'sandbox-only';
  getState(): T1SandboxState;
  navigate(route: unknown): T1SandboxState;
  requestClose(): T1SandboxState;
  resolvePending(choice: 'stay' | 'discard'): T1SandboxState;
  markDraft(scope: T1Scope, label: string): T1SandboxState;
}

export function createT1SandboxController(options: { initialRoute?: unknown } = {}): T1SandboxController {
  const input = record(options, 'controller options');
  exactKeys(input, ['initialRoute'], 'controller options');
  let state: T1SandboxState = {
    mode: 'sandbox-only',
    isOpen: true,
    route: createT1Route(input.initialRoute ?? { page: 'overview' }),
    dirtyDraft: null,
    pending: null,
    notice: null,
  };
  const snapshot = (): T1SandboxState =>
    freeze({
      ...state,
      route: createT1Route(state.route),
      dirtyDraft: state.dirtyDraft ? { ...state.dirtyDraft } : null,
      pending: state.pending
        ? state.pending.kind === 'navigate'
          ? { kind: 'navigate', target: createT1Route(state.pending.target) }
          : { kind: 'close' }
        : null,
    });
  const ensureOpen = (): void => {
    if (!state.isOpen) throw new Error('Sandbox workbench is closed');
  };
  const ensureNoPending = (): void => {
    if (state.pending) throw new Error('Resolve pending leave before another change');
  };
  return freeze({
    mode: 'sandbox-only',
    getState: snapshot,
    navigate(route: unknown) {
      const target = createT1Route(route);
      ensureOpen();
      if (JSON.stringify(target) === JSON.stringify(state.route)) return snapshot();
      ensureNoPending();
      if (state.dirtyDraft)
        state = {
          ...state,
          pending: { kind: 'navigate', target },
          notice: '存在未保存草稿：留在页面，或明确丢弃后离开。不会自动保存。',
        };
      else state = { ...state, route: target, notice: null };
      return snapshot();
    },
    requestClose() {
      if (!state.isOpen) return snapshot();
      ensureNoPending();
      if (state.dirtyDraft)
        state = {
          ...state,
          pending: { kind: 'close' },
          notice: '存在未保存草稿：留在页面，或明确丢弃后关闭。关闭不取消后台任务。',
        };
      else state = { ...state, isOpen: false, notice: '已关闭沙盒样例；没有取消或执行任何后台任务。' };
      return snapshot();
    },
    resolvePending(choice: 'stay' | 'discard') {
      ensureOpen();
      if (choice !== 'stay' && choice !== 'discard') throw new Error('Unsupported leave choice');
      if (!state.pending) throw new Error('No pending leave to resolve');
      if (choice === 'stay') state = { ...state, pending: null, notice: '已留在当前页面，草稿仍未保存。' };
      else {
        const destination = state.pending;
        state = {
          ...state,
          route: destination.kind === 'navigate' ? destination.target : state.route,
          isOpen: destination.kind !== 'close',
          dirtyDraft: null,
          pending: null,
          notice: '已明确丢弃本样例草稿；没有写入任何存档。',
        };
      }
      return snapshot();
    },
    markDraft(scope: T1Scope, label: string) {
      ensureOpen();
      ensureNoPending();
      if (!Object.hasOwn(T1_SCOPE_DESCRIPTIONS, scope)) throw new Error('Unsupported draft scope');
      const marker = freeze({ scope, label: textValue(label, 'draft label') });
      if (state.dirtyDraft && (state.dirtyDraft.scope !== marker.scope || state.dirtyDraft.label !== marker.label)) {
        throw new Error('Existing draft must be explicitly discarded before replacing its marker');
      }
      state = { ...state, dirtyDraft: marker, notice: '仅创建本页的内存草稿标记；未填写或保存正式世界资料。' };
      return snapshot();
    },
  });
}
