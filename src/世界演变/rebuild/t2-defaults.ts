import {
  normalizeT2Template,
  type T2Cell,
  type T2Field,
  type T2Row,
  type T2Table,
  type T2Template,
  type T2WorldData,
} from './t2-template';
import { normalizeT2WorldData } from './t2-values';

/** Templates never contain business rows. Demo rows require an explicit fixture factory. */
export const T2_DEFAULT_TABLE_IDS = [
  'society',
  'environment',
  'location',
  'npc',
  'organization',
  'plan',
  'event',
] as const;

const visible = () => ({ user: true, evolutionAi: true, mainAi: true });
const inherit = () => ({ state: 'inherit' as const });

function field(
  id: string,
  name: string,
  description: string,
  type: T2Field['type'] = 'text',
  options: Partial<T2Field> = {},
): T2Field {
  const controls: Record<T2Field['type'], T2Field['control']> = {
    text: 'multiline',
    integer: 'integer',
    number: 'number',
    decimal: 'decimal',
    boolean: 'toggle',
    enum: 'select',
    'string-list': 'string-list',
    reference: 'reference',
    'reference-list': 'reference-list',
    'world-time': 'world-time',
  };
  return {
    id,
    sqlName: `f_${id}`,
    name,
    description,
    type,
    nullable: false,
    required: true,
    readonly: false,
    hiddenUi: false,
    permissions: { manualWrite: true, aiWrite: true },
    visibility: visible(),
    constraints: {},
    control: controls[type],
    ...options,
  };
}

const text = (id: string, name: string, description: string) =>
  field(id, name, description, 'text', {
    defaultValue: '',
    constraints: { maxLength: 4000 },
  });
const title = (name: string, description: string) =>
  field('name', name, description, 'text', {
    constraints: { maxLength: 160 },
    control: 'single-line',
  });
const choices = (id: string, name: string, description: string, enumValues: string[], defaultValue: string) =>
  field(id, name, description, 'enum', { constraints: { enumValues }, defaultValue });
const labels = (id: string, name: string, description: string) =>
  field(id, name, description, 'string-list', {
    defaultValue: [],
    constraints: { maxItems: 32, maxLength: 160 },
  });
const references = (id: string, name: string, description: string, tableIds: string[]) =>
  field(id, name, description, 'reference-list', {
    defaultValue: [],
    constraints: { maxItems: 64, reference: { tableIds, onDelete: 'restrict' } },
  });
const reference = (id: string, name: string, description: string, tableIds: string[]) =>
  field(id, name, description, 'reference', {
    nullable: true,
    defaultValue: null,
    constraints: { reference: { tableIds, onDelete: 'restrict' } },
  });
const time = (id: string, name: string, description: string) =>
  field(id, name, description, 'world-time', {
    semantic:
      id === 'deadline'
        ? 'deadline'
        : ['observed_time', 'last_action_time', 'occurred_at'].includes(id)
          ? 'fact-time'
          : 'none',
    nullable: true,
    defaultValue: null,
    constraints: { calendarId: 'demo-calendar' },
  });
const rating = (id: string, name: string, description: string) =>
  field(id, name, description, 'integer', {
    defaultValue: 0,
    constraints: { min: 0, max: 100 },
  });
const secret = (id: string, name: string, description: string) => text(id, name, descriptionWithPrivacy(description));
const descriptionWithPrivacy = (description: string) =>
  `${description} 此列允许后台演变 AI 与用户读取，不得进入主 AI 世界书投影。`;

function privateField(id: string, name: string, description: string): T2Field {
  return { ...secret(id, name, description), visibility: { user: true, evolutionAi: true, mainAi: false } };
}

function table(
  id: string,
  name: string,
  description: string,
  groupId: T2Table['groupId'],
  purpose: T2Table['purpose'],
  fields: T2Field[],
  rules: T2Table['rules'],
): T2Table {
  const publicFields = fields.filter(item => item.visibility.mainAi).map(item => item.id);
  return {
    id,
    sqlName: `we_${id}`,
    name,
    description,
    groupId,
    purpose,
    fields,
    visibility: visible(),
    locked: false,
    permissions: {
      manual: { insert: true, update: true, archive: true, delete: true },
      ai: { insert: true, update: true, archive: true, delete: false },
    },
    rules,
    runtime: { enabled: true, frequency: inherit(), budget: inherit(), api: inherit() },
    context: {
      settings: inherit(),
      fieldIds: fields.filter(item => item.visibility.evolutionAi).map(item => item.id),
      relatedTableIds: [],
    },
    export: {
      enabled: true,
      mode: 'per-row',
      fieldIds: publicFields,
      titleFieldId: 'name',
      keyFieldIds: ['name'],
      prefix: 'WorldEvolution-',
      maxChars: 8000,
      includeArchived: false,
    },
  };
}

function macroRules(subject: string): T2Table['rules'] {
  return {
    initialize: `人工建立或只读导入已确认的${subject}基线；采用模板不自动造记录，不调用 API。`,
    insert: `仅在剧情或用户确认出现独立${subject}对象且有来源时新增；名称不是身份，不因重名合并。`,
    update: `继承上次已提交的${subject}条件，结合本轮剧情与已冻结前置结果修改；不强求变化，不重写已确认剧情事实。`,
    archive: `${subject}对象停止作用且确认无需继续演算时可归档；保留历史和关系，关联微观对象仍可读取有效条件。`,
    delete: 'AI 禁止物理删除；人工删除必须确认范围、通过引用/历史/类型校验和统一提交，不为减少行数抹去历史。',
  };
}

function microRules(subject: string): T2Table['rules'] {
  return {
    initialize: `人工建立或只读导入${subject}起始资料，明确稳定行身份和来源；不默默生成示例对象。`,
    insert: `本轮最新宏观条件和剧情确实产生新${subject}时才新增，服从独立新增预算；同批引用最终整批校验。`,
    update: `使用本轮最新宏观暂存条件及上次已提交的${subject}状态行动；遵守认知、距离、资源和时间限制，同一对象不重复行动。`,
    archive: `不再参与主动行动的${subject}可归档；归档不删除过去发生的事实、可读关系或引用，不自动复活。`,
    delete: 'AI 禁止物理删除；人工删除需独立确认并检查所有引用和历史，不能把任务完成、死亡或停用等同于删除。',
  };
}

function defaultTables(): T2Table[] {
  const society = table(
    'society',
    '社会',
    '宏观条件：制度、经济、秩序、舆论与长期矛盾。微观行动继承这些约束，不擅自越过已确认事实。',
    'macro',
    'society',
    [
      title('社会单元', '区域或社会体系的完整名称；显示名允许重名，身份由稳定行 ID 决定。'),
      text('scope', '覆盖范围', '描述适用人口、地域和制度边界，不把局部变化无理由推广到整个世界。'),
      references('locations', '关联地点', '受此社会条件覆盖的地点，使用稳定引用。', ['location']),
      text('institutions', '制度与治理', '权力结构、法规、行政方式及正在实施的政策。'),
      text('economy', '经济与供给', '生产、交易、就业、物资和价格变化的已知状态。'),
      rating('order', '秩序指数', '0–100 的模板约定指标；只用于粗粒度秩序变化，不把未知情况视为自动计算事实。'),
      text('public_opinion', '舆论与消息', '公众已获得的信息、流言及不同群体意见；不能把秘密自动视为公开。'),
      text('conflicts', '社会矛盾', '已存在的群体冲突、压力、争端与触发条件。'),
      text('customs', '风俗与日常', '社会习惯、节庆、作息和人际规则，为角色行动提供生活背景。'),
      text('resources', '公共资源', '道路维护、粮食、医疗等社会可用资源及已确认短缺。'),
      text('policies', '本轮政策变化', '本轮已确认的政策/秩序变化，没有变化就继承原值。'),
      text('ongoing_effects', '持续影响', '仍在生效的社会变化及其后续约束，不凭空生成无限连锁事件。'),
      time('effective_time', '条件生效时间', '已确认条件开始生效的世界时间，宏观与微观共用同一轮时间边界。'),
      labels('tags', '影响标签', '便于候选关联的明确标签，标签本身不授权读取或修改。'),
      privateField('unpublished_policy', '未公开政策', '尚未公开的治理安排及知情范围。'),
    ],
    macroRules('社会'),
  );
  society.context.relatedTableIds = ['location', 'organization', 'event'];
  society.export.mode = 'constant';

  const environment = table(
    'environment',
    '环境',
    '宏观条件：天气、资源、灾害与风险。未到更新频率时继承上次有效状态，微观仍使用这些条件。',
    'macro',
    'environment',
    [
      title('环境单元', '独立环境区域或环境现象的名称。'),
      text('region', '地域范围', '环境作用的明确空间范围。'),
      references('locations', '影响地点', '环境影响的地点，用于宏观变化后扩展微观候选。', ['location']),
      time('observed_time', '观测时间', '该环境状态对应的世界时间，不在每个阶段分别推进。'),
      time('valid_until', '有效至', '已知有效边界；未知可以为 NULL，不把未知当为永久。'),
      choices(
        'weather',
        '天气',
        '记录已确认天气；具体强度、异常和范围写在说明。',
        ['未知', '晴', '阴', '雨', '雪', '风暴', '其他'],
        '未知',
      ),
      field('temperature', '温度', '已测得或明确设定的温度，未知为 NULL，不推断传感器精度。', 'number', {
        nullable: true,
        defaultValue: null,
        constraints: { min: -273.15, max: 1000 },
      }),
      text('terrain', '地形与地表', '地形、土壤、水位、积雪等环境条件。'),
      text('resources', '自然资源', '水源、食物、燃料等已确认资源及可用限制。'),
      text('hazards', '灾害与异常', '已发生或正在发生的环境威胁，不把预测写成已发生事件。'),
      rating('risk', '风险指数', '0–100 的模板风险摘要，必须有说明和来源。'),
      text('travel_constraints', '通行影响', '环境造成的交通、视野、通信与行动限制。'),
      text('trend', '变化趋势', '有依据的预测或趋势，必须与当前已发生事实区分。'),
      text('summary', '条件摘要', '供微观行动使用的本轮有效环境条件。'),
      labels('tags', '影响标签', '暴雨、缺水等明确影响分类，可用于选中相关对象。'),
      privateField('unobserved_risk', '未公开风险', '只有指定对象知情的环境隐患。'),
    ],
    macroRules('环境'),
  );
  environment.runtime.frequency = { state: 'value', value: { unit: 'eligible-story-round', every: 3, offset: 1 } };
  environment.context.relatedTableIds = ['location', 'event'];
  environment.export.mode = 'constant';

  const location = table(
    'location',
    '地点',
    '宏观空间条件：地理层级、控制方、通行和设施。地点 ID 稳定，显示名和现场状态可改变。',
    'macro',
    'location',
    [
      title('地点名称', '地点的完整显示名，不作为跨表去重键。'),
      reference('parent', '上级地点', '所属区域或上级地点；根地点为空，不能自引用成地理循环。', ['location']),
      choices(
        'kind',
        '地点类别',
        '分类服务于展示和候选关联，改显示名不改变分类。',
        ['区域', '城镇', '道路', '建筑', '场所', '其他'],
        '场所',
      ),
      text('geography', '地理位置', '相对位置、出入口、距离和环境描述。'),
      reference('controller', '控制组织', '已确认控制或管理此地点的组织，不以姓名字符串代替引用。', ['organization']),
      choices(
        'access',
        '通行状态',
        '当前通行条件，不擅自允许角色穿越已封闭地点。',
        ['未知', '开放', '受限', '封闭'],
        '未知',
      ),
      text('access_rules', '通行要求', '所需身份、时间、费用、道路条件及例外。'),
      text('facilities', '设施与服务', '医疗、交通、仓储、通讯等设施及其状态。'),
      text('capacity', '容量与负载', '已确认的承载能力、拥挤、拥堵与临时使用情况。'),
      text('resources', '现场资源', '现场物资、补给和可使用设施，不向角色无条件赠送资源。'),
      text('current_state', '现场状态', '本轮有效的活动、损坏、警戒与环境变化。'),
      references('links', '相邻地点', '可关联的相邻地点，是否可通行仍需读通行状态。', ['location']),
      text('risks', '现场风险', '当前风险与影响范围；预测和已确认事实分别描述。'),
      time('observed_time', '状态时间', '地点状态的世界时间。'),
      labels('tags', '地点标签', '候选关联标签不自动给予访问或写入权限。'),
    ],
    macroRules('地点'),
  );
  location.context.relatedTableIds = ['environment', 'society', 'organization'];

  const npc = table(
    'npc',
    'NPC',
    '微观行动主体：读取最新宏观条件及旧状态自主行动；有认知与能力限制，不能读取主角未知信息即自动全知。',
    'micro',
    'npc',
    [
      title('角色全名', '完整姓名只用于显示和明确来源匹配；同名角色保留各自稳定行身份。'),
      text('identity', '身份背景', '角色身份、职业、经历与社会关系的简明基线。'),
      reference('location', '当前位置', '已确认所在地点；受剧情事实和通行条件约束。', ['location']),
      references('organizations', '所属组织', '角色与组织的明确关系；组织成员列表不自动替代个人认知。', [
        'organization',
      ]),
      choices(
        'status',
        '行动状态',
        '死亡、失踪或停用不等于删除；不得自动复活。',
        ['活跃', '休整', '失踪', '死亡', '停用'],
        '活跃',
      ),
      text('condition', '身体与能力', '伤势、体力、技能和可执行行动限制。'),
      text('knowledge', '已知信息', '仅记录角色实际知晓的信息，消息传播要有途径。'),
      text('goals', '公开目标', '当前可以公开的目标和优先级，不把计划视为已经完成。'),
      text('resources', '可用资源', '角色实际持有或可使用的时间、物资、关系与资金。'),
      references('relationships', '相关角色', '稳定角色引用；关系性质写在说明而不是塞进显示名称。', ['npc']),
      text('relationship_notes', '关系说明', '合作、亲属、敌对等关系及已确认的变化。'),
      text('constraints', '行动限制', '距离、身份、能力、承诺及当前宏观条件造成的约束。'),
      text('last_action', '最近行动', '本轮真实执行的行动和结果，不能把待做事项当已发生。'),
      time('last_action_time', '最近行动时间', '同一轮行动时间边界，不因重试重复推进。'),
      privateField('private_goal', '私人目标', '未公开目标与秘密动机。'),
      field('editor_note', '用户备注', '仅用户可读写的备注；隐藏列仅影响界面，不代替保密规则。', 'text', {
        required: false,
        hiddenUi: true,
        permissions: { manualWrite: true, aiWrite: false },
        visibility: { user: true, evolutionAi: false, mainAi: false },
        constraints: { maxLength: 2000 },
      }),
    ],
    microRules('角色'),
  );
  npc.context.relatedTableIds = ['environment', 'society', 'location', 'organization', 'plan', 'event'];
  npc.fields.find(f => f.id === 'status')!.constraints.terminalValues = ['死亡'];
  npc.runtime.budget = {
    state: 'value',
    // Includes related macro/micro SQL aliases and the final authority packet.
    // New default only: existing user templates keep their explicit limit.
    value: { maxRows: 12, maxNewRows: 4, maxRequests: 2, maxContextChars: 20000 },
  };

  const organization = table(
    'organization',
    '组织',
    '微观集合主体：依据宏观条件安排成员与资源；组织行动形成的宏观影响默认进入下一轮。',
    'micro',
    'organization',
    [
      title('组织全称', '组织完整名称；可以与角色同名，稳定表身份避免串行。'),
      text('identity', '组织背景', '性质、沿革、组织结构和已确认职责。'),
      reference('base', '驻地', '组织主要驻地及其宏观通行、设施条件。', ['location']),
      references('members', '主要成员', '本轮有关的角色引用，不能凭空赋予成员资源。', ['npc']),
      text('leadership', '决策与分工', '谁负责决定、执行和传递消息；必须有关系依据。'),
      text('goals', '组织目标', '当前目标、优先顺序和完成条件。'),
      text('resources', '可用资源', '人力、物资、资金和影响力等实际约束。'),
      text('stance', '社会立场', '对制度、冲突和本轮宏观条件的已知态度。'),
      references('related_organizations', '关联组织', '合作、竞争等组织引用；不能用关系直接越权改写其他对象。', [
        'organization',
      ]),
      text('relationship_notes', '关系说明', '组织之间的具体关系及成立依据。'),
      text('action_arrangements', '行动安排', '受最新宏观条件限制的人员与资源安排。'),
      text('last_result', '最近结果', '已经执行的结果，不将安排或承诺当为事实。'),
      privateField('confidential_strategy', '秘密策略', '尚未公开的内部策略与知情范围。'),
    ],
    microRules('组织'),
  );
  organization.context.relatedTableIds = ['society', 'environment', 'location', 'npc', 'plan', 'event'];

  const planRules = microRules('计划');
  planRules.update += ' 完成/失败/取消都只改变生命周期，不自动删行；完成结果必须有证据。';
  planRules.archive =
    '完成、失败或取消且不再需主动调度的计划可归档；保留执行者、条件、结果、事件引用和历史，禁止自动物理删除。';
  const plan = table(
    'plan',
    '计划',
    '待执行意图与生命周期：不等于事件，不因计划存在就视为已经发生；到期与受阻依赖最新宏观条件。',
    'micro',
    'plan',
    [
      title('计划名称', '计划显示名称，稳定行身份不随阶段或名称变化。'),
      references('executors', '执行者', '参与执行的角色或组织，跨表稳定引用。', ['npc', 'organization']),
      reference('location', '行动地点', '计划涉及的地点及通行条件。', ['location']),
      text('objective', '目标与成功条件', '明确可检查的目标与完成证据，不以尝试本身代替成功。'),
      text('trigger_conditions', '触发条件', '依据宏观条件、消息和资源是否开始执行。'),
      time('not_before', '最早开始时间', '未到时间不得提前完成，未知可为 NULL。'),
      time('deadline', '期限', '计划世界时间期限，不硬转现实 Date。'),
      choices(
        'status',
        '生命周期',
        '完成/失败/取消保留记录，不自动抹去历史。',
        ['待启动', '进行中', '受阻', '完成', '失败', '取消'],
        '待启动',
      ),
      text('stage', '当前步骤', '正在进行的具体步骤及上一步结果。'),
      text('obstacles', '阻碍', '最新宏观条件、资源、认知和其他计划造成的已知阻碍。'),
      text('resource_requirements', '资源需求', '执行所需资源与尚未满足的条件。'),
      references('dependencies', '依赖计划', '先决计划引用，不能将失败前置自动标成成功。', ['plan']),
      text('result', '结果与证据', '完成后保留证据；未执行时不编造结果。'),
      references('result_events', '结果事件', '已经发生并记入事件表的结果，不能指向未来计划。', ['event']),
      privateField('private_conditions', '非公开条件', '不能公开的执行条件与知情范围。'),
    ],
    planRules,
  );
  plan.context.relatedTableIds = ['environment', 'society', 'location', 'npc', 'organization', 'event'];
  plan.fields.find(f => f.id === 'status')!.constraints.terminalValues = ['完成', '失败', '取消'];

  const eventRules = microRules('事件');
  eventRules.insert = '只记录已发生且有来源的事实、行动与结果；预测、计划、未执行承诺不得写作已发生事件。';
  eventRules.update =
    '后台 AI 不覆盖已确认事件；必要的人工事实修订须说明依据、预览影响并统一提交，不能偷偷改变剧情历史。';
  eventRules.archive =
    '不再需要主动展示的已发生事件可归档，但保留事实、时间、参与者、计划引用与后续影响，不自动物理删除。';
  const event = table(
    'event',
    '事件',
    '已经发生的事实账目：时间、地点、参与者和结果有依据；尚未发生的行动放计划表。',
    'micro',
    'event',
    [
      title('事件标题', '事实摘要标题，不把预测写成肯定发生。'),
      time('occurred_at', '发生时间', '已确认事件的世界时间，未知可为空并注明。'),
      reference('location', '发生地点', '实际发生地点，不把计划目的地当作事实。', ['location']),
      references('participants', '参与者', '已参与的角色/组织；引用不能赋予对象全知信息。', ['npc', 'organization']),
      choices('kind', '事实类别', '已发生事实的业务分类。', ['行动', '交互', '社会', '环境', '其他'], '其他'),
      text('facts', '已发生事实', '客观发生内容，必须和推测、动机与未来安排区分。'),
      text('result', '结果', '实际结果及未达成部分，不强凑成功。'),
      text('evidence', '依据与来源', '剧情、前置已确认结果或本轮已执行行动的证据摘要。'),
      references('related_plans', '相关计划', '事件对应的计划，已完成计划仍保留可解引用。', ['plan']),
      text('ongoing_effects', '后续影响', '已成立持续影响；对宏观的反馈默认下轮处理，不同轮无限循环。'),
      references('informed_npcs', '已知情角色', '真正收到信息的角色，不默认通知所有 NPC。', ['npc']),
      labels('tags', '事实标签', '关联查询标签，不自动改写事实或可见性。'),
      privateField('private_evidence', '非公开依据', '只允许后台与用户读取的事件依据。'),
    ],
    eventRules,
  );
  event.permissions.ai.update = false;
  event.context.relatedTableIds = ['society', 'environment', 'location', 'npc', 'organization', 'plan'];
  event.export.mode = 'index';

  return [society, environment, location, npc, organization, plan, event];
}

function baseTemplate(tables: T2Table[], id: string, name: string, description: string): T2Template {
  return normalizeT2Template({
    format: 'world-evolution-template',
    schemaVersion: 1,
    dataVersion: 1,
    templateVersion: 1,
    id,
    name,
    description,
    groups: [
      { id: 'macro', name: '宏观世界', description: '上轮宏观＋本轮剧情/前置结果，产生本轮微观行动的先决条件。' },
      { id: 'micro', name: '微观世界', description: '上轮对象＋本轮最新宏观条件，行动后与宏观一起校验、一次提交。' },
    ],
    calendars: [{ id: 'demo-calendar', name: '自定义世界历', epoch: '世界纪元起点', minutesPerDay: 1440 }],
    defaults: {
      frequency: { unit: 'eligible-story-round', every: 1, offset: 1 },
      budget: { maxRows: 40, maxNewRows: 8, maxRequests: 5, maxContextChars: 40000 },
      context: {
        maxRows: 30,
        maxChars: 20000,
        includeArchived: false,
        lastAssistantMessages: 3,
        sources: ['story', 'mvu', 'database', 'worldbook'],
      },
      api: { state: 'disabled' },
    },
    phases: {
      macro: { enabled: true, frequency: inherit(), budget: inherit(), context: inherit(), api: inherit() },
      micro: { enabled: true, frequency: inherit(), budget: inherit(), context: inherit(), api: inherit() },
    },
    hardLimits: { maxRows: 100, maxNewRows: 20, maxRequests: 10, maxContextChars: 100000 },
    tables,
  });
}

export function createDefaultT2Template(): T2Template {
  return baseTemplate(
    defaultTables(),
    'world-evolution-default-v1',
    '世界演变默认七表',
    '七张起始业务表的结构与规则；没有内置角色或剧情数据，采用模板不会生成、保存或同步世界书。',
  );
}

/** Independent two-table starter; references to absent optional tables are removed, not left dangling. */
export function createMinimalT2Template(): T2Template {
  const tables = defaultTables().filter(item => item.id === 'environment' || item.id === 'npc');
  for (const current of tables) {
    current.fields = current.fields.filter(
      item => !item.constraints.reference || item.constraints.reference.tableIds.every(id => id === 'npc'),
    );
    const allowed = new Set(current.fields.map(item => item.id));
    current.context.fieldIds = current.context.fieldIds.filter(id => allowed.has(id));
    current.context.relatedTableIds = current.id === 'environment' ? [] : ['environment'];
    current.export.fieldIds = current.export.fieldIds.filter(id => allowed.has(id));
    current.export.keyFieldIds = current.export.keyFieldIds.filter(id => allowed.has(id));
  }
  return baseTemplate(
    tables,
    'world-evolution-minimal-v1',
    '环境＋NPC 最小模板',
    '无需 MVU 或其他数据库即可人工开始的两表结构；环境先提供条件，角色按旧状态与最新条件行动；无示例数据自动补种。',
  );
}

export type T2DemoFixture = { template: T2Template; data: T2WorldData };
const ref = (tableId: string, rowId: string) => ({ tableId, rowId });
const demoTime = (ordinalMinute: number, display: string): T2Cell => ({
  calendarId: 'demo-calendar',
  ordinalMinute,
  display,
});

/** Only explicit demo creation applies defaults; normalization/restoration never calls this helper. */
function demoRow(current: T2Table, id: string, values: Record<string, T2Cell>, archived = false): T2Row {
  const cells: Record<string, T2Cell> = {};
  for (const item of current.fields) {
    if (Object.hasOwn(values, item.id)) cells[item.id] = values[item.id];
    else if (Object.hasOwn(item, 'defaultValue')) cells[item.id] = item.defaultValue as T2Cell;
  }
  return {
    meta: {
      id,
      locked: false,
      lockedFieldIds: [],
      archived,
      visibility: visible(),
      source: { kind: 'manual', detail: '固定虚构沙盒示例，非任何实际聊天资料。' },
      createdAtRevision: 1,
      updatedAtRevision: 1,
    },
    values: cells,
  };
}

function fixtureData(
  template: T2Template,
  rows: Record<string, { id: string; values: Record<string, T2Cell>; archived?: boolean }[]>,
): T2WorldData {
  const tables: T2WorldData['tables'] = {};
  for (const current of template.tables) {
    tables[current.id] = (rows[current.id] ?? []).map(item => demoRow(current, item.id, item.values, item.archived));
  }
  return normalizeT2WorldData(template, {
    format: 'world-evolution-data',
    dataVersion: 1,
    schemaVersion: 1,
    worldId: 'demo-world',
    branchId: 'demo-main',
    revision: 1,
    templateId: template.id,
    templateVersion: template.templateVersion,
    tables,
  });
}

export function createDefaultT2Fixture(): T2DemoFixture {
  const template = createDefaultT2Template();
  const now = demoTime(14580, '雾港纪元 第11日 03:00');
  const data = fixtureData(template, {
    society: [
      {
        id: 'harbor-society',
        values: {
          name: '雾港社区',
          scope: '雾港及北门周边居民',
          locations: [ref('location', 'harbor'), ref('location', 'north-gate')],
          institutions: '港务议事会维持道路和防汛秩序。',
          economy: '暴雨使运货延误，公共粮仓仍可供给。',
          order: 72,
          public_opinion: '居民已知北门积水，尚不知道堤岸暗伤。',
          conflicts: '运货延期使商人与巡守之间出现摩擦。',
          customs: '每日清晨由巡守公布通行消息。',
          resources: '公共仓库有沙袋和两辆运输车。',
          policies: '临时限制北门夜间通行。',
          ongoing_effects: '限行增加通勤时间；组织应调整路线而不是让 NPC 瞬移。',
          effective_time: now,
          tags: ['防汛', '北门限行'],
          unpublished_policy: '议事会在核实堤岸状况，尚未正式对外发布。',
        },
      },
    ],
    environment: [
      {
        id: 'harbor-weather',
        values: {
          name: '雾港雨情',
          region: '北门与港区',
          locations: [ref('location', 'harbor'), ref('location', 'north-gate')],
          observed_time: now,
          valid_until: demoTime(14880, '雾港纪元 第11日 08:00'),
          weather: '雨',
          temperature: 16.5,
          terrain: '北门低洼处积水，港区堤岸尚未决口。',
          resources: '饮水充足，路面湿滑。',
          hazards: '道路积水影响运输。',
          risk: 55,
          travel_constraints: '北门货车通行受限，徒步仍需巡守批准。',
          trend: '持续降雨可能加重积水，这是预测而不是已发生事件。',
          summary: '先检查北门通行，再安排运货与巡查。',
          tags: ['暴雨', '北门'],
          unobserved_risk: '堤岸暗伤目前只有巡守负责人知晓。',
        },
      },
    ],
    location: [
      {
        id: 'harbor',
        values: {
          name: '雾港',
          kind: '城镇',
          geography: '海湾内港',
          controller: ref('organization', 'watch'),
          access: '开放',
          facilities: '港务所、公共粮仓、巡守驻地',
          current_state: '持续降雨，仓库已完成加固。',
          links: [ref('location', 'north-gate')],
          observed_time: now,
          tags: ['港区'],
        },
      },
      {
        id: 'north-gate',
        values: {
          name: '雾港北门',
          parent: ref('location', 'harbor'),
          kind: '场所',
          geography: '雾港北侧低洼出入口',
          controller: ref('organization', 'watch'),
          access: '受限',
          access_rules: '步行需巡守批准，重载货车暂停通行。',
          facilities: '值班岗亭与排水渠',
          current_state: '积水，巡守正在检查排水。',
          links: [ref('location', 'harbor')],
          risks: '路面湿滑、货车陷入积水。',
          observed_time: now,
          tags: ['北门', '积水'],
        },
      },
    ],
    npc: [
      {
        id: 'lin-watch',
        values: {
          name: '林澄',
          identity: '雾港巡守，负责北门防汛。',
          location: ref('location', 'north-gate'),
          organizations: [ref('organization', 'watch')],
          condition: '身体健康，具备排水检查经验。',
          knowledge: '知道北门积水、夜间限行；未获得议事会完整政策。',
          goals: '先保障居民通行安全。',
          resources: '两名巡守可协助，沙袋需从仓库领取。',
          relationships: [ref('npc', 'lin-merchant')],
          relationship_notes: '与同名商人是不同的人，因运输审批有业务联系。',
          constraints: '不能无依据宣布整个港区封闭。',
          last_action: '检查北门排水渠并向驻地报告。',
          last_action_time: now,
          private_goal: '担心堤岸暗伤，计划独自复查但尚未执行。',
          editor_note: '用户专属备注，隐藏显示不等于自动保密。',
        },
      },
      {
        id: 'lin-merchant',
        values: {
          name: '林澄',
          identity: '运货商人，与巡守同名但身份独立。',
          location: ref('location', 'harbor'),
          knowledge: '从公告得知北门限行，不知道堤岸暗伤。',
          goals: '等待许可后送货，不直接穿过封闭路段。',
          resources: '一辆货车和一批粮食。',
          relationships: [ref('npc', 'lin-watch')],
          constraints: '运输需要有效通行许可。',
        },
      },
    ],
    organization: [
      {
        id: 'watch',
        values: {
          name: '雾港巡守会',
          identity: '维护港区治安、道路与防汛秩序。',
          base: ref('location', 'harbor'),
          members: [ref('npc', 'lin-watch')],
          leadership: '由值班负责人批准北门临时通行。',
          goals: '维护通行安全并核实风险。',
          resources: '沙袋、运输车和巡守人手有限。',
          stance: '执行临时限行，避免把预测当为事实公开。',
          action_arrangements: '先检查北门，确认后再安排运输。',
          last_result: '公共粮仓加固已经完成。',
          confidential_strategy: '安排复查堤岸暗伤，消息仅告知负责人。',
        },
      },
    ],
    plan: [
      {
        id: 'gate-drainage',
        values: {
          name: '北门排水检查',
          executors: [ref('npc', 'lin-watch'), ref('organization', 'watch')],
          location: ref('location', 'north-gate'),
          objective: '确认排水渠是否可恢复重载通行。',
          trigger_conditions: '持续降雨且北门积水。',
          not_before: now,
          deadline: demoTime(14880, '雾港纪元 第11日 08:00'),
          status: '进行中',
          stage: '正在检查排水渠；尚未宣布通行恢复。',
          obstacles: '持续降雨和人手有限。',
          resource_requirements: '需要巡守许可和排水工具。',
          dependencies: [ref('plan', 'warehouse-reinforcement')],
          private_conditions: '检查时顺便留意暗伤，不公开未经核实的风险。',
        },
      },
      {
        id: 'warehouse-reinforcement',
        archived: true,
        values: {
          name: '公共粮仓加固',
          executors: [ref('organization', 'watch')],
          location: ref('location', 'harbor'),
          objective: '完成仓库沙袋加固。',
          trigger_conditions: '已确认暴雨影响港区。',
          status: '完成',
          stage: '已完成，保留历史而非自动删除。',
          result: '负责人确认仓库入口加固完成。',
          result_events: [ref('event', 'reinforcement-finished')],
        },
      },
    ],
    event: [
      {
        id: 'reinforcement-finished',
        values: {
          name: '公共粮仓加固完成',
          occurred_at: demoTime(14520, '雾港纪元 第11日 02:00'),
          location: ref('location', 'harbor'),
          participants: [ref('organization', 'watch')],
          kind: '行动',
          facts: '巡守会完成仓库入口沙袋加固。',
          result: '粮仓入口得到保护，北门通行尚未恢复。',
          evidence: '固定示例中负责人已确认完成。',
          related_plans: [ref('plan', 'warehouse-reinforcement')],
          ongoing_effects: '仓库加固可作为后续防汛条件，下轮宏观读取其影响。',
          informed_npcs: [ref('npc', 'lin-watch')],
          tags: ['防汛', '已完成'],
        },
      },
    ],
  });
  return { template, data };
}

export function createMinimalT2Fixture(): T2DemoFixture {
  const template = createMinimalT2Template();
  return {
    template,
    data: fixtureData(template, {
      environment: [
        {
          id: 'small-valley-weather',
          values: {
            name: '山谷雨情',
            region: '独立虚构山谷',
            weather: '雨',
            risk: 30,
            summary: '道路湿滑，行人需要放慢速度。',
          },
        },
      ],
      npc: [
        {
          id: 'traveler',
          values: {
            name: '陈望',
            identity: '山谷旅人',
            knowledge: '观察到降雨。',
            goals: '安全到达营地。',
            constraints: '依照最新环境条件降低行进速度。',
          },
        },
      ],
    }),
  };
}

/** Non-default eighth business table proves schema extension without a hardcoded seven-table enum. */
export function createCustomT2Fixture(): T2DemoFixture {
  const fixture = createDefaultT2Fixture();
  const market = table(
    'market',
    '市场供需',
    '自定义宏观业务表：记录市场供给与价格，为角色与组织行动提供经济条件。',
    'macro',
    'custom',
    [
      title('市场名称', '业务表显示名，稳定 ID 不依赖默认用途枚举。'),
      reference('location', '所在地点', '市场所在地点，读取通行和灾害条件。', ['location']),
      field('unit_price', '粮价', '固定两位精确十进制字符串，避免浮点截断。', 'decimal', {
        defaultValue: '0.00',
        constraints: { precision: 10, scale: 2 },
      }),
      field('open', '是否开放', '明确布尔值，false 与未填写/NULL 不混淆。', 'boolean', { defaultValue: false }),
      labels('goods', '主要货物', '明确列表，空列表不是空字符串或缺失值。'),
      text('summary', '供需说明', '本轮宏观供需条件与限制。'),
    ],
    macroRules('市场供需'),
  );
  market.context.relatedTableIds = ['location', 'environment', 'society'];
  fixture.template.tables.push(market);
  const template = normalizeT2Template(fixture.template);
  fixture.data.tables.market = [
    demoRow(market, 'harbor-market', {
      name: '雾港集市',
      location: ref('location', 'harbor'),
      unit_price: '12.30',
      open: false,
      goods: ['粮食', '燃料'],
      summary: '暴雨期间暂停现场交易，价格为最近已确认单价。',
    }),
  ];
  return { template, data: normalizeT2WorldData(template, fixture.data) };
}
