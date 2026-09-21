export type AttrMap = Record<string, string>;

export type NamedBlock = {
  attrs: AttrMap;
  text: string;
  children?: NamedBlock[];
};

export type EntityData = {
  name: string;
  location: string;
  /** 下次固定支出结算日期（薪饷/维护等） */
  nextFixedSettle: string;
  attrs: AttrMap;
  facilities: NamedBlock[];
  materials: NamedBlock[];
  equipments: NamedBlock[];
  staffTotal: string;
  staffOnDuty: string;
  /** <人员 外派> 人数 */
  staffDispatched: string;
  staffNote: string;
  /** 职级；children 为 <配装>/<装> */
  roles: NamedBlock[];
  /** 核心人物；children 为配装；attrs 可含 dispatch */
  keyPersons: NamedBlock[];
};

/** 顶层 <外派> 任务块 */
export type DispatchData = {
  id: string;
  name: string;
  who: string;
  dest: string;
  mission: string;
  since: string;
  eta: string;
  status: string;
  attrs: AttrMap;
  text: string;
  /** <配装>/<装> */
  kit: NamedBlock[];
};

export type OpsLine = NamedBlock & { attrs: AttrMap };

export type BusinessData = {
  name: string;
  attrs: AttrMap;
  /** <经营 周期> */
  period: string;
  /** <订单>/<履约> */
  fulfilledOrders: NamedBlock[];
  /** <订单>/<在途> */
  pendingOrders: NamedBlock[];
  revenueTotal: string;
  revenuePeriod: string;
  revenueItems: NamedBlock[];
  /** 无 <条目> 时的收入正文（如 原因:...） */
  revenueNote: string;
  expenseTotal: string;
  expensePeriod: string;
  expenseItems: NamedBlock[];
  lines: OpsLine[];
  reconcile: NamedBlock;
  netWorth: string;
};

export type ProjectData = {
  name: string;
  attrs: AttrMap;
  text: string;
};

export type OperationsData = {
  name: string;
  attrs: AttrMap;
  /** <主管>/<执事> 的 name 属性 */
  managerName: string;
  /** 标签内文（重点/风险等） */
  manager: string;
  projects: ProjectData[];
};

export type CurrencyBlock = {
  code: string;
  symbol: string;
  attrs: AttrMap;
  text: string;
};

export type LedgerTimeData = {
  raw: string;
  timeLine: string;
  gateText: string;
};

export type LedgerData = {
  ledgerTime: LedgerTimeData;
  periodSummary: string;
  externalFactors: NamedBlock[];
  internalFactors: NamedBlock[];
  cashNote: string;
  currencies: CurrencyBlock[];
  cashBase: string;
  /** 折合基准等号后的流动资金总额展示文案 */
  cashTotal: string;
  entities: EntityData[];
  businesses: BusinessData[];
  operations: OperationsData[];
  /** 与 <运营> 平级的外派任务 */
  dispatches: DispatchData[];
  /** 顶栏摘要：优先本期结算，其次根属性推断 */
  headline: {
    duration: string;
    status: string;
    delta: string;
  };
};
