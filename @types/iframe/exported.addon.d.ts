declare namespace Addon {
  type 叙事指导 = {
    宏观层?: string;
    发展层?: string;
    细节层?: string;
  };

  type 演变纪段基 = {
    前时代称谓?: string;
    后时代称谓?: string;
    描述?: string;
    历史影响?: string;
    关联转折?: string;
  };

  type 正史演变条目 = 演变纪段基 & {
    演变起止?: string;
  };

  type 分歧纪段条目 = 演变纪段基 & {
    纪段起止?: string;
  };

  type 干预态势 = {
    推动力?: string;
    抑止力?: string;
  };

  type 事件节点 = {
    开始日期?: string;
    结束日期?: string;
    干预方向?: string;
    干预强度?: string;
    描述?: string;
    影响?: string;
  };

  type 已完结转折点事件影响条目 = {
    起止日期?: string;
    最终结局?: string;
    事件脉络?: string;
    时代影响?: string;
  };

  type 传世轶闻条目 = {
    原典?: boolean;
    关联要素?: string;
    版本流传范围?: string;
    版本成型时代?: string;
    内容梗概?: string;
  };

  type 史诗传奇条目 = {
    基本类型?: string;
    核心母题关键词?: string;
    史实真相?: string;
    流变历程?: string;
    传世轶闻?: Record<string, 传世轶闻条目>;
  };

  type 特异点条目 = {
    降临?: boolean;
    分歧源头?: string;
    事件记录?: Record<string, 分歧纪段条目>;
  };

  type 潜在时代演化条目 = {
    开始日期?: string;
    进度?: string;
    状态?: string;
    推动因子?: string;
    抑止因子?: string;
    描述?: string;
    已完结转折点事件影响?: Record<string, 已完结转折点事件影响条目>;
  };

  type 时代关键转折点条目 = {
    临界事件?: boolean;
    进度?: string;
    干预态势?: 干预态势;
    关联潜在时代?: string;
    描述?: string;
    总体影响?: string;
    事件脉络?: Record<string, 事件节点>;
  };

  type 世界时代阶段 = {
    时代阶段?: string;
    核心社会组织形式?: string;
    主流世界观与思潮?: string;
    主要经济模式?: string;
    技术特征?: string;
    主导性能源与动力?: string;
    关联材料标志?: string;
    社会阶级结构?: string;
    生产力与生产关系矛盾?: string;
    世界秩序格局?: string;
  };

  type 剧情事件条目 = {
    叙事指导?: 叙事指导;
    参与角色?: string;
    牵涉团体?: string;
    事件脉络?: Record<string, string>;
    结算条件?: string;
  };

  type 传闻流变节点 = {
    流变日期?: string;
    预计时效?: string;
    真相?: string;
    传闻描述?: string;
    事实偏差?: string;
    流变诱因?: string;
  };

  type 传闻条目 = {
    影响力?: string;
    流传范围?: string;
    流变历程?: Record<string, 传闻流变节点>;
  };

  type 声誉 = {
    官方?: string;
    民间?: string;
    暗域?: string;
    业界?: string;
  };

  type 核心人物 = {
    身份职务?: string;
    权力支柱?: Record<string, string>;
  };

  type 团体条目 = {
    声誉?: 声誉;
    外交关系?: Record<string, string>;
    权力支柱?: Record<string, string>;
    活跃区域?: string;
    内政概况?: string;
    发展态势?: string;
    当前动态?: string;
    核心人物?: Record<string, 核心人物>;
  };

  type 贸易区状态 = {
    状态?: string;
    主导产业?: string;
    需求品类?: string;
  };

  type 流通货币条目 = {
    汇率?: { 本期?: string; 上期?: string; 涨跌?: string };
    市场情绪?: string;
    驱动因素?: string;
  };

  type 投机标的条目 = {
    类型?: string;
    当前价格?: string;
    上期价格?: string;
    涨跌?: string;
    交易热度?: string;
    量能?: string;
    驱动事件?: string;
  };

  type 期货合约条目 = {
    近月价格?: string;
    远月价格?: string;
    基差?: string;
  };

  type 商路条目 = {
    状态?: string;
    原因?: string;
  };

  type 经济事件条目 = {
    描述?: string;
    影响维度?: string;
    当前态势?: string;
  };

  type 世界条目 = {
    降临?: boolean;
    平行演化?: boolean;
    刊报日期?: string;
    时代快讯?: {
      世界时代阶段?: 世界时代阶段;
      世界时局演进动态?: {
        演进驱动力?: string;
        时代差格局?: string;
        潜在时代演化?: Record<string, 潜在时代演化条目>;
        时代关键转折点?: Record<string, 时代关键转折点条目>;
      };
      岁月史书?: {
        正史?: Record<string, 正史演变条目>;
        特异点?: Record<string, 特异点条目>;
      };
      史诗传奇?: Record<string, 史诗传奇条目>;
    };
    世界剧情态势?: {
      时局动态?: {
        世界背景事件?: Record<string, 剧情事件条目>;
        当前区域事件?: Record<string, 剧情事件条目>;
        传闻?: Record<string, 传闻条目>;
      };
      团体动态?: {
        世界背景团体?: Record<string, 团体条目>;
        当前区域团体?: Record<string, 团体条目>;
      };
    };
    世界经济简报?: {
      世界经济气候?: {
        整体周期相位?: string;
        主要贸易区状态?: Record<string, 贸易区状态>;
      };
      大宗商品市场?: {
        粮食?: { 供需?: string; 行情要点?: string; 价格趋势?: string; 主要影响因素?: string };
        矿产?: { 供需?: string; 行情要点?: string; 价格趋势?: string; 主要影响因素?: string };
        能源?: { 供需?: string; 行情要点?: string; 价格趋势?: string; 主要影响因素?: string };
      };
      货币与金融?: {
        基准计价单位?: string;
        流通货币?: Record<string, 流通货币条目>;
        汇率波动指数?: { 综合汇率波动率?: string; 主要影响因素?: string };
        信贷环境?: { 状态?: string; 金融机构风险?: string };
      };
      投机市场?: {
        市场整体情绪?: string;
        主要交易标的?: Record<string, 投机标的条目>;
        期货合约?: Record<string, 期货合约条目>;
        投机指数?: { 报?: string; 周涨跌?: string };
      };
      贸易格局?: {
        主要商路?: Record<string, 商路条目>;
        贸易政策?: Record<string, string>;
      };
      经济事件?: Record<string, 经济事件条目>;
    };
  };

  type 社交圈条目 = {
    性质?: string;
    互动频率?: string;
    信息范围?: string;
    社群人脉?: string;
    活跃角色?: string;
    关联团体?: string;
    关联圈交集?: string;
    当前动态?: string;
    描述?: string;
  };

  type AddonData = {
    世界?: Record<string, 世界条目>;
    社交圈?: Record<string, 社交圈条目>;
    位面交汇?: boolean;
  };

  type AddonWrapper = {
    addon_data: AddonData;
  };

  type JsonPatchOp =
    | { op: 'replace'; path: string; value: unknown }
    | { op: 'delta'; path: string; value: number }
    | { op: 'insert'; path: string; value: unknown }
    | { op: 'remove'; path: string }
    | { op: 'move'; from: string; to: string };
}

/**
 * addon-mvu 脚本提供的全局接口, 与 MVU 变量框架平行, 作用于 addon_data.
 * **在使用之前, 你应该先通过 `await waitGlobalInitialized('Addon')` 来等待 Addon 初始化完毕**
 */
declare const Addon: {
  events: {
    /** 某轮 addon 变量更新开始时触发 */
    VARIABLE_UPDATE_STARTED: 'addon_variable_update_started';

    /**
     * patch 解析完成、应用前触发; listener 可修改 ops 数组
     *
     * @example
     * eventOn(Addon.events.PATCH_PARSED, (_old, ops) => {
     *   ops.forEach(op => {
     *     if ('path' in op) op.path = op.path.replaceAll('-', '');
     *   });
     * });
     */
    PATCH_PARSED: 'addon_patch_parsed';

    /** addon 变量更新结束、写回前触发; listener 可修改 new_data.addon_data */
    VARIABLE_UPDATE_ENDED: 'addon_variable_update_ended';
  };

  /**
   * 获取指定楼层的 addon 变量包装对象
   *
   * @example
   * const { addon_data } = Addon.getAddonData({ type: 'message', message_id: 'latest' });
   */
  getAddonData: (options: Extract<VariableOption, { type: 'message' }>) => Addon.AddonWrapper;

  /**
   * 获取供提示词/世界书使用的 addon 快照
   *
   * @example
   * const { addon_data } = Addon.getDisplayAddonData({ type: 'message', message_id: 'latest' });
   */
  getDisplayAddonData: (options: Extract<VariableOption, { type: 'message' }>) => Addon.AddonWrapper;

  /**
   * 将 addon 变量写回指定楼层
   *
   * @example
   * Addon.replaceAddonData({ addon_data: { ... } }, { type: 'message', message_id: 'latest' });
   */
  replaceAddonData: (data: Addon.AddonWrapper, options: Extract<VariableOption, { type: 'message' }>) => void;

  /**
   * 解析消息中的 `<AddonJSONPatch>`, 不写回楼层; 无有效更新时返回 undefined
   *
   * @example
   * const old = Addon.getAddonData({ type: 'message', message_id: 'latest' });
   * const next = await Addon.parseMessage(message, old);
   */
  parseMessage: (message: string, old_data: Addon.AddonWrapper) => Promise<Addon.AddonWrapper | undefined>;

  /** 对指定楼层 inherit + parse + patch (含事件钩子) */
  processFloor: (message_id?: number | 'latest') => Promise<void>;

  /** generate 等同层未新建楼层时使用 */
  applyAddonUpdateFromMessage: (message: string, message_id?: number) => Promise<Addon.AddonData>;

  /** 确保楼层存在 addon_data, 缺失时 inherit */
  ensureAddonData: (message_id: number) => Addon.AddonData;

  /** 特异点存档状态 */
  getArchive: (options?: Extract<VariableOption, { type: 'message' }>) => {
    activeKey: string | null;
    snapshots: Record<string, Addon.AddonData>;
  };

  getUiState: (options?: Extract<VariableOption, { type: 'message' }>) => {
    位面交汇: boolean;
    theme?: 'light' | 'dark';
  };

  setUiState: (
    patch: { 位面交汇?: boolean; theme?: 'light' | 'dark' },
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => { 位面交汇: boolean; theme?: 'light' | 'dark' };

  setTheme: (
    theme: 'light' | 'dark',
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => { 位面交汇: boolean; theme?: 'light' | 'dark' };

  setPlaneMerge: (
    value: boolean,
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => { 位面交汇: boolean; theme?: 'light' | 'dark' };

  setSingularityDescent: (
    world: string,
    name: string,
    value: boolean,
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => Promise<{ data: Addon.AddonData; archive: { activeKey: string | null; snapshots: Record<string, Addon.AddonData> }; warnings: string[] }>;

  setWorldDescent: (
    world: string,
    value: boolean,
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => Promise<{ data: Addon.AddonData; archive: { activeKey: string | null; snapshots: Record<string, Addon.AddonData> }; warnings: string[] }>;

  setWorldParallel: (
    world: string,
    value: boolean,
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => Promise<{ data: Addon.AddonData; archive: { activeKey: string | null; snapshots: Record<string, Addon.AddonData> }; warnings: string[] }>;

  createWorld: (
    name: string,
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => Promise<{ data: Addon.AddonData; archive: { activeKey: string | null; snapshots: Record<string, Addon.AddonData> }; warnings: string[] }>;

  renameWorld: (
    oldName: string,
    newName: string,
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => Promise<{ data: Addon.AddonData; archive: { activeKey: string | null; snapshots: Record<string, Addon.AddonData> }; warnings: string[] }>;

  syncReplicaLaunched: (
    options?: Extract<VariableOption, { type: 'message' }>,
  ) => Promise<string[]>;
};

interface ListenerType {
  [Addon.events.VARIABLE_UPDATE_STARTED]: (variables: Addon.AddonWrapper) => void;

  [Addon.events.PATCH_PARSED]: (variables: Addon.AddonWrapper, ops: Addon.JsonPatchOp[], message_content: string) => void;

  [Addon.events.VARIABLE_UPDATE_ENDED]: (variables: Addon.AddonWrapper, variables_before_update: Addon.AddonWrapper) => void;
}
