import { toSimplified } from 'chinese-simple2traditional';
import 'chinese-simple2traditional/enhance';
import type {
  AttrMap,
  BusinessData,
  CurrencyBlock,
  DispatchData,
  EntityData,
  LedgerData,
  LedgerTimeData,
  NamedBlock,
  OperationsData,
  OpsLine,
  ProjectData,
} from './types';

/** 繁转简（启用短语库）；帐本→账本，与模板简体键一致 */
function toLedgerSimplified(text: string): string {
  return toSimplified(String(text ?? ''), true).replace(/帐本/g, '账本');
}

/** 繁转简后去掉 HTML 注释；修正标签名与属性粘连 */
function normalizeMarkup(text: string): string {
  return toLedgerSimplified(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(本期结算|外因|内因|产业流动资金|流动资金|实体|经营|运营|外派|基建|基础设施|仓库|人员|收入|支出|产能|订单|履约|在途|本期可交付|可交付|闭环校验|净值|主管|执事|项目|币种|折合基准|物资|装备|产线|条目|季节|治安|市况|事件|工艺|士气|制度|设施|职级|核心人物|配装|装|品项)([\u4e00-\u9fff\w.-]+\s*=)/g,
      '<$1 $2',
    );
}

function softTrim(text: string): string {
  return String(text ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 解析开标签属性。支持中英属性名：name、total、合计金额 等。 */
export function parseAttrs(openTag: string): AttrMap {
  const attrs: AttrMap = {};
  const mTag = openTag.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?>$/);
  if (!mTag) return attrs;
  const rest = mTag[2] ?? '';

  const re = /([\u4e00-\u9fff\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type TagHit = {
  openTag: string;
  attrs: AttrMap;
  inner: string;
  full: string;
};

/** 找出所有成对标签实例（支持开标签带属性） */
export function findAllPairs(source: string, tagName: string): TagHit[] {
  const text = String(source ?? '');
  if (!text || !tagName) return [];
  const openRe = new RegExp(`<\\s*${escapeRegExp(tagName)}(?=[\\s/>])([^>]*)>`, 'gi');
  const closeToken = `</${tagName}>`;
  const hits: TagHit[] = [];
  let m: RegExpExecArray | null;

  while ((m = openRe.exec(text)) !== null) {
    const openStart = m.index;
    const openEnd = openRe.lastIndex;
    const openTag = m[0];
    // 自闭合
    if (/\/\s*>$/.test(openTag)) {
      hits.push({
        openTag,
        attrs: parseAttrs(openTag),
        inner: '',
        full: openTag,
      });
      continue;
    }
    const closeIdx = text.toLowerCase().indexOf(closeToken.toLowerCase(), openEnd);
    if (closeIdx === -1) break;
    const closeEnd = closeIdx + closeToken.length;
    const inner = text.slice(openEnd, closeIdx);
    hits.push({
      openTag,
      attrs: parseAttrs(openTag),
      inner,
      full: text.slice(openStart, closeEnd),
    });
    openRe.lastIndex = closeEnd;
  }
  return hits;
}

export function findFirstPair(source: string, tagName: string): TagHit | null {
  return findAllPairs(source, tagName)[0] ?? null;
}

export function findAllSelfClosing(source: string, tagName: string): AttrMap[] {
  const text = String(source ?? '');
  const re = new RegExp(`<\\s*${escapeRegExp(tagName)}(?=[\\s/>])([^>]*?)\\s*/>`, 'gi');
  const out: AttrMap[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(parseAttrs(m[0]));
  }
  return out;
}

function namedFromHits(hits: TagHit[]): NamedBlock[] {
  return hits.map(h => ({
    attrs: h.attrs,
    text: softTrim(h.inner),
  }));
}

function pickAttr(attrs: AttrMap, ...keys: string[]): string {
  for (const k of keys) {
    if (attrs[k] != null && attrs[k] !== '') return attrs[k];
  }
  // 大小写不敏感回退
  const lowerMap = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lowerMap[k.toLowerCase()];
    if (v != null && v !== '') return v;
  }
  return '';
}

export function parseLedgerTime(inner: string): LedgerTimeData {
  const raw = softTrim(normalizeMarkup(inner));
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const timeLine = lines.find(l => /账目结算时间|结算时间/.test(l)) ?? lines[0] ?? '';
  const gateLines = lines.filter(l => l !== timeLine);
  return {
    raw,
    timeLine,
    gateText: softTrim(gateLines.join('\n')),
  };
}

function parseCash(body: string): { note: string; currencies: CurrencyBlock[]; cashBase: string } {
  const block = findFirstPair(body, '产业流动资金') ?? findFirstPair(body, '流动资金');
  if (!block) return { note: '', currencies: [], cashBase: '' };
  const note = pickAttr(block.attrs, 'note');
  const currencies = findAllPairs(block.inner, '币种').map(h => ({
    code: pickAttr(h.attrs, 'code'),
    symbol: pickAttr(h.attrs, 'symbol'),
    attrs: h.attrs,
    text: softTrim(h.inner),
  }));
  const base = findFirstPair(block.inner, '折合基准');
  return {
    note,
    currencies,
    cashBase: softTrim(base?.inner ?? ''),
  };
}

/** 解析 <配装> 内全部 <装>（成对或自闭合） */
function parseKit(source: string): NamedBlock[] {
  const kit = findFirstPair(source, '配装');
  if (!kit) return [];
  return findAllPairs(kit.inner, '装').map(h => ({
    attrs: h.attrs,
    text: softTrim(h.inner),
  }));
}

function parseStaffBlock(hit: TagHit): NamedBlock {
  const kit = parseKit(hit.inner);
  // 去掉配装后的剩余正文（通常为空）
  let text = softTrim(hit.inner.replace(/<\s*配装[\s\S]*?<\/\s*配装\s*>/gi, ''));
  return {
    attrs: hit.attrs,
    text,
    ...(kit.length ? { children: kit } : {}),
  };
}

function parseEntity(hit: TagHit): EntityData {
  const name = pickAttr(hit.attrs, 'name') || '未命名实体';
  const infra = findFirstPair(hit.inner, '基建') ?? findFirstPair(hit.inner, '基础设施');
  const facilities = infra
    ? namedFromHits(findAllPairs(infra.inner, '设施'))
    : namedFromHits(findAllPairs(hit.inner, '设施'));

  const warehouse = findFirstPair(hit.inner, '仓库');
  const whInner = warehouse?.inner ?? '';
  const materials = namedFromHits(findAllPairs(whInner, '物资'));
  const equipments = namedFromHits(findAllPairs(whInner, '装备'));

  const staff = findFirstPair(hit.inner, '人员');
  const roles = staff ? findAllPairs(staff.inner, '职级').map(parseStaffBlock) : [];
  const keyPersons = staff ? findAllPairs(staff.inner, '核心人物').map(parseStaffBlock) : [];

  return {
    name,
    location: pickAttr(hit.attrs, 'location'),
    nextFixedSettle: pickAttr(hit.attrs, 'nextFixedSettle'),
    attrs: hit.attrs,
    facilities,
    materials,
    equipments,
    staffTotal: staff ? pickAttr(staff.attrs, 'total') : '',
    staffOnDuty: staff ? pickAttr(staff.attrs, '在岗') : '',
    staffDispatched: staff ? pickAttr(staff.attrs, '外派') : '',
    staffNote: staff ? pickAttr(staff.attrs, 'note') : '',
    roles,
    keyPersons,
  };
}

function parseDispatch(hit: TagHit): DispatchData {
  const kit = parseKit(hit.inner);
  const text = softTrim(hit.inner.replace(/<\s*配装[\s\S]*?<\/\s*配装\s*>/gi, ''));
  return {
    id: pickAttr(hit.attrs, 'id'),
    name: pickAttr(hit.attrs, 'name') || '未命名实体',
    who: pickAttr(hit.attrs, 'who'),
    dest: pickAttr(hit.attrs, 'dest'),
    mission: pickAttr(hit.attrs, 'mission'),
    since: pickAttr(hit.attrs, 'since'),
    eta: pickAttr(hit.attrs, 'eta'),
    status: pickAttr(hit.attrs, 'status'),
    attrs: hit.attrs,
    text,
    kit,
  };
}

function parseBusiness(hit: TagHit): BusinessData {
  const name = pickAttr(hit.attrs, 'name') || '未命名经营';
  const period = pickAttr(hit.attrs, '周期');
  const orders = findFirstPair(hit.inner, '订单');
  const fulfilledOrders = orders ? namedFromHits(findAllPairs(orders.inner, '履约')) : [];
  const pendingOrders = orders ? namedFromHits(findAllPairs(orders.inner, '在途')) : [];
  const revenue = findFirstPair(hit.inner, '收入');
  const expense = findFirstPair(hit.inner, '支出');
  const capacity = findFirstPair(hit.inner, '产能');
  const reconcile = findFirstPair(hit.inner, '闭环校验');
  const net = findFirstPair(hit.inner, '净值');

  const lines: OpsLine[] = capacity
    ? findAllPairs(capacity.inner, '产线').map(h => ({
        attrs: h.attrs,
        text: softTrim(h.inner),
      }))
    : [];

  const revenueItems = revenue ? namedFromHits(findAllPairs(revenue.inner, '条目')) : [];
  const revenueNote =
    revenue && revenueItems.length === 0 ? softTrim(revenue.inner) : '';

  return {
    name,
    attrs: hit.attrs,
    period,
    fulfilledOrders,
    pendingOrders,
    revenueTotal: revenue ? pickAttr(revenue.attrs, 'total', '合计金额', '金额') : '',
    revenuePeriod: revenue ? pickAttr(revenue.attrs, '周期') : '',
    revenueItems,
    revenueNote,
    expenseTotal: expense ? pickAttr(expense.attrs, 'total', '合计金额', '金额') : '',
    expensePeriod: expense ? pickAttr(expense.attrs, '周期') : '',
    expenseItems: expense ? namedFromHits(findAllPairs(expense.inner, '条目')) : [],
    lines,
    reconcile: reconcile
      ? { attrs: reconcile.attrs, text: softTrim(reconcile.inner) }
      : { attrs: {}, text: '' },
    netWorth: softTrim(net?.inner ?? ''),
  };
}

function parseOperations(hit: TagHit): OperationsData {
  const name = pickAttr(hit.attrs, 'name') || '未命名运营';
  const managerHit = findFirstPair(hit.inner, '主管') ?? findFirstPair(hit.inner, '执事');
  const managerName = managerHit ? pickAttr(managerHit.attrs, 'name') : '';
  const manager = softTrim(managerHit?.inner ?? '');
  const projects: ProjectData[] = findAllPairs(hit.inner, '项目').map(h => ({
    name: pickAttr(h.attrs, 'name') || '未命名项目',
    attrs: h.attrs,
    text: softTrim(h.inner),
  }));
  return { name, attrs: hit.attrs, managerName, manager, projects };
}

function factorChildren(parentTag: string, body: string, childTags: string[]): NamedBlock[] {
  const parent = findFirstPair(body, parentTag);
  if (!parent) return [];
  const out: NamedBlock[] = [];
  for (const tag of childTags) {
    for (const h of findAllPairs(parent.inner, tag)) {
      out.push({
        attrs: { ...h.attrs, _tag: tag },
        text: softTrim(h.inner),
      });
    }
  }
  return out;
}

function deriveHeadline(periodSummary: string): LedgerData['headline'] {
  const duration = periodSummary.match(/历时\s*[:：]\s*(.+)/)?.[1]?.trim() ?? '';
  const statusFull = periodSummary.match(/损益\s*[:：]\s*(.+)/)?.[1]?.trim() ?? '';
  const delta = statusFull.match(/[（(]?\s*Δ\s*([^)）]+)[)）]?/)?.[1]?.trim() ?? '';
  const status = statusFull.replace(/[（(]\s*Δ[\s\S]*$/, '').trim() || statusFull;
  return { duration, status, delta };
}

/** 解析资产账本内文（通常不含外层 <资产账本> 包装） */
export function parseLedgerBody(inner: string): Omit<LedgerData, 'ledgerTime'> {
  const body = normalizeMarkup(inner);
  // 若偶发完整块，剥掉外层
  const wrapped = findFirstPair(body, '资产账本');
  const content = wrapped ? wrapped.inner : body;
  const rootAttrs = wrapped?.attrs ?? {};

  const period = findFirstPair(content, '本期结算');
  const periodSummary = softTrim(period?.inner ?? '');

  const externalFactors = factorChildren('外因', content, ['季节', '治安', '市况', '事件']);
  const internalFactors = factorChildren('内因', content, ['工艺', '士气', '制度']);

  const cash = parseCash(content);
  const entities = findAllPairs(content, '实体').map(parseEntity);
  const businesses = findAllPairs(content, '经营').map(parseBusiness);
  const operations = findAllPairs(content, '运营').map(parseOperations);
  const dispatches = findAllPairs(content, '外派').map(parseDispatch);

  const headline = deriveHeadline(periodSummary);
  if (!headline.duration && rootAttrs.period) headline.duration = rootAttrs.period;
  if (!headline.status && rootAttrs.status) headline.status = rootAttrs.status;
  if (!headline.delta && rootAttrs.delta) headline.delta = rootAttrs.delta;

  return {
    periodSummary,
    externalFactors,
    internalFactors,
    cashNote: cash.note,
    currencies: cash.currencies,
    cashBase: cash.cashBase,
    cashTotal: parseCashBaseTotal(cash.cashBase),
    entities,
    businesses,
    operations,
    dispatches,
    headline,
  };
}

export function parseLedger(ledgerTimeInner: string, ledgerInner: string): LedgerData {
  const ledgerTime = parseLedgerTime(ledgerTimeInner);
  const body = parseLedgerBody(ledgerInner);
  return {
    ledgerTime,
    ...body,
  };
}

export function isLedgerEmpty(data: LedgerData): boolean {
  return (
    !data.ledgerTime.raw &&
    !data.periodSummary &&
    !data.entities.length &&
    !data.businesses.length &&
    !data.operations.length &&
    !data.dispatches.length &&
    !data.currencies.length
  );
}

export type CashMetrics = {
  total: string;
  change: string;
  changeDir: 'up' | 'down' | 'flat';
};

/**
 * 从折合基准正文提取流动资金总额。
 * 例：`∑(期末货币 × 汇率) = 115 §` → `115 §`
 */
export function parseCashBaseTotal(cashBase: string): string {
  const t = String(cashBase ?? '');
  const m = t.match(/=\s*([+\-]?[\d,.]+(?:\.\d+)?\s*[^\n(Δ→|]*)/);
  return softTrim(m?.[1] ?? '');
}

export type ProductionSplit = {
  sold: string;
  stock: string;
  self: string;
};

/**
 * 从产线正文提取分流摘要。
 * 例：`分流: 已售8→收入; 入库2→仓库; 自用0（已售+入库+自用=产出）`
 */
export function parseProductionSplit(text: string): ProductionSplit | null {
  const t = String(text ?? '');
  const line =
    t
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(l => /^分流\s*[:：]/.test(l)) ?? (/\b分流\s*[:：]/.test(t) ? t : '');
  if (!line) return null;
  const body = line.replace(/^[\s\S]*?分流\s*[:：]\s*/, '');
  const sold = body.match(/已售\s*([^;；→\n]*?)(?=\s*(?:→|;|；|入库|自用|$))/)?.[1]?.trim() ?? '';
  const stock = body.match(/入库\s*([^;；→\n]*?)(?=\s*(?:→|;|；|自用|已售|$))/)?.[1]?.trim() ?? '';
  const self = body.match(/自用\s*([^;；→\n（(]*?)(?=\s*(?:→|;|；|（|\(|已售|入库|$))/)?.[1]?.trim() ?? '';
  if (!sold && !stock && !self) return null;
  return { sold, stock, self };
}

/** 从币种正文提取期末与 Δ */
export function parseCashMetrics(text: string): CashMetrics {
  const t = String(text ?? '');
  const total = t.match(/期末\s*([+\-]?[\d,.]+(?:\.\d+)?)/)?.[1] ?? '';
  const change = t.match(/Δ\s*([+\-]?[\d,.]+(?:\.\d+)?)/)?.[1] ?? '';
  let changeDir: CashMetrics['changeDir'] = 'flat';
  if (change.startsWith('-')) changeDir = 'down';
  else if (change.startsWith('+')) changeDir = 'up';
  else if (change) {
    const n = Number(change.replace(/,/g, ''));
    if (!Number.isNaN(n)) changeDir = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  }
  return { total, change, changeDir };
}

export type ProgressInfo = {
  pct: number;
  tone: '' | 'warn' | 'critical';
};

/** 从 progress / bar / 任意状态文案推进度 */
export function parseProgressPct(attrs: Record<string, string>, extraText = ''): ProgressInfo {
  const progress = String(attrs.progress ?? '');
  const bar = String(attrs.bar ?? '');
  const hay = `${progress} ${bar} ${extraText}`;
  let pct = 0;
  const pctM = progress.match(/(\d+(?:\.\d+)?)\s*%/) || hay.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctM) pct = Math.round(Number(pctM[1]));
  else if (bar) {
    const filled = (bar.match(/█/g) || []).length;
    const empty = (bar.match(/[░▒]/g) || []).length;
    const total = filled + empty;
    if (total > 0) pct = Math.round((filled / total) * 100);
  }
  pct = Math.min(100, Math.max(0, pct));

  let tone: ProgressInfo['tone'] = '';
  if (/critical|临界|危机|告急|崩溃|damaged/i.test(hay)) tone = 'critical';
  else if (/warn|警告|partial|idle|闲置|部分|注意/i.test(hay)) tone = 'warn';
  return { pct, tone };
}
