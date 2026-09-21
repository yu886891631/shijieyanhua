export function textOf(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export function isNonEmptyText(v: unknown): boolean {
  return textOf(v).trim().length > 0;
}

export function entriesOf(map: unknown): [string, any][] {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.entries(map as Record<string, any>);
}

export function hasAnyText(obj: unknown, keys: string[]): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return keys.some(k => isNonEmptyText(o[k]));
}

export function parseProgressPct(raw: unknown): number {
  const s = textOf(raw).trim();
  if (!s) return 0;
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*%?/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export type ChangeTone = 'up' | 'down' | 'flat' | 'unknown';

export function parseChangeTone(raw: unknown): ChangeTone {
  const s = textOf(raw).trim();
  if (!s) return 'unknown';
  if (/[+\u2191\u2197]|涨|升|上/.test(s) && !/跌|降|下|-\d/.test(s.replace(/^\s*[-−]/, ''))) return 'up';
  if (/[-−\u2193\u2198]|跌|降|下/.test(s)) return 'down';
  if (/平|持平|0%|\+0|\u2192|→/.test(s)) return 'flat';
  if (/^\s*\+/.test(s)) return 'up';
  if (/^\s*-/.test(s)) return 'down';
  return 'unknown';
}

export function kvPairs(obj: unknown, labels?: string[]): { key: string; value: string }[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as Record<string, unknown>;
  const keys = labels ?? Object.keys(o);
  return keys
    .filter(k => isNonEmptyText(o[k]) && typeof o[k] !== 'object')
    .map(k => ({ key: k, value: textOf(o[k]) }));
}

/** 时代阶段字段 → 正则同款图标 */
export const ERA_FIELD_ICONS: Record<string, string> = {
  核心社会组织形式: '🏛️',
  主流世界观与思潮: '💭',
  '主流世界观/思潮': '💭',
  主要经济模式: '⚙️',
  技术特征: '🔧',
  主导性能源与动力: '⚡',
  '主导性能源/动力': '⚡',
  关键材料标志: '🔩',
  社会阶级结构: '👥',
  生产力与生产关系矛盾: '⚖️',
  '生产力-生产关系矛盾': '⚖️',
  世界秩序格局: '🗺️',
};

export function eraFieldIcon(label: string): string {
  return ERA_FIELD_ICONS[label] || '📌';
}

export type StatusClass =
  | ''
  | 'status-embryo'
  | 'status-developing'
  | 'status-stable'
  | 'status-critical';

/** 与正则 getStatusClass 对齐（含经济事件中性态势词） */
export function getStatusClass(status: unknown): StatusClass {
  const s = textOf(status).trim();
  if (!s) return '';
  if (/萌芽|胚胎|酝酿|embryo/i.test(s)) return 'status-embryo';
  if (/趋稳|消退|受控/i.test(s)) return 'status-stable';
  if (/恶化|危机|崩溃|临界|critical|变革|前夜/i.test(s)) return 'status-critical';
  if (/发展|developing|推进|进行|转折|恢复|改善|好转/i.test(s)) return 'status-developing';
  return '';
}

export function isCriticalStatus(status: unknown): boolean {
  return getStatusClass(status) === 'status-critical';
}

export function isCompletedOutcome(outcome: unknown): boolean {
  return /成功|定鼎/i.test(textOf(outcome));
}

/** 传闻影响力 → tag class */
export function getInfluenceClass(influence: unknown): StatusClass {
  const s = textOf(influence).trim();
  if (!s) return '';
  if (/文化烙印|全民热议/i.test(s)) return 'status-critical';
  if (/局部焦点|圈内谈资/i.test(s)) return 'status-developing';
  if (/零星耳闻/i.test(s)) return 'status-embryo';
  return '';
}

export type HeatTone = 'heat-high' | 'heat-mid' | 'heat-low' | '';

/** 投机标的交易热度：高 | 中 | 低（及展示文案 抢手/平稳/冷门） */
export function parseHeatTone(value: unknown): HeatTone {
  const s = textOf(value).trim();
  if (!s) return '';
  if (/^高$|^抢手$|沸腾|火热|极高|很热/i.test(s)) return 'heat-high';
  if (/^低$|^冷门$|冷清|冰点|极低|清淡/i.test(s)) return 'heat-low';
  if (/^中$|^平稳$|一般|正常/i.test(s)) return 'heat-mid';
  if (/高|抢手/.test(s)) return 'heat-high';
  if (/低|冷门/.test(s)) return 'heat-low';
  if (/中|平稳/.test(s)) return 'heat-mid';
  return '';
}

/** 交易热度展示：高→抢手，中→平稳，低→冷门 */
export function formatHeatLabel(value: unknown): string {
  const raw = textOf(value).trim();
  if (!raw) return '';
  const tone = parseHeatTone(raw);
  if (tone === 'heat-high') return '抢手';
  if (tone === 'heat-mid') return '平稳';
  if (tone === 'heat-low') return '冷门';
  return raw;
}

export type SupplyTone = 'supply-tight' | 'supply-surplus' | 'supply-steady' | '';

/** 大宗商品供需：紧缺 | 过剩 | 平稳 */
export function parseSupplyTone(value: unknown): SupplyTone {
  const s = textOf(value).trim();
  if (!s) return '';
  if (/紧缺|短缺|供不应求|紧张/i.test(s)) return 'supply-tight';
  if (/过剩|充裕|供过于求|宽松/i.test(s)) return 'supply-surplus';
  if (/平稳|平衡|正常|均衡/i.test(s)) return 'supply-steady';
  return '';
}

/** 事件脉络 entries 按键名粗排序（保持插入序兜底） */
export function timelineEntries(map: unknown): [string, any][] {
  return entriesOf(map);
}
