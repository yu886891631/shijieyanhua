import { z } from 'zod';

import { coerceAddonData, STRICT_BOOLEAN_KEYS } from './coerce';

export { STRICT_BOOLEAN_KEYS };

/** 消息楼层变量中 addon 数据的顶层键名 */
export const ADDON_KEY = 'addon_data';

/** 严格布尔: 仅接受 JSON true/false */
const strictBoolean = z.boolean().prefault(false);

/** 宽松字符串: 占位符选项在变量更新规则中约束, 不在 Zod 层 enum */
const looseString = z.string().prefault('');

const 叙事指导Schema = z
  .object({
    宏观层: looseString,
    发展层: looseString,
    细节层: looseString,
  })
  .prefault({});

const 声誉Schema = z
  .object({
    官方: looseString,
    民间: looseString,
    暗域: looseString,
    业界: looseString,
  })
  .prefault({});

const 正史演变条目Schema = z
  .object({
    前时代称谓: looseString,
    后时代称谓: looseString,
    演变起止: looseString,
    描述: looseString,
    历史影响: looseString,
    关键转折: looseString,
  })
  .prefault({});

const 分歧纪段条目Schema = z
  .object({
    前时代称谓: looseString,
    后时代称谓: looseString,
    纪段起止: looseString,
    描述: looseString,
    历史影响: looseString,
    关键转折: looseString,
  })
  .prefault({});

const 干预态势Schema = z
  .object({
    推动力: looseString,
    抑止力: looseString,
  })
  .prefault({});

const 事件节点Schema = z
  .object({
    开始日期: looseString,
    结束日期: looseString,
    干预方向: looseString,
    干预强度: looseString,
    描述: looseString,
    影响: looseString,
  })
  .prefault({});

const 权力支柱Record = z.record(z.string(), looseString).prefault({});

const 已完结转折点事件影响条目Schema = z
  .object({
    起止日期: looseString,
    最终结局: looseString,
    事件脉络: looseString,
    时代影响: looseString,
  })
  .prefault({});

const 核心人物Schema = z
  .object({
    身份职务: looseString,
    权力支柱: 权力支柱Record,
  })
  .prefault({});

const 特异点Schema = z
  .object({
    降临: strictBoolean,
    分歧源头: looseString,
    事件记录: z.record(z.string(), 分歧纪段条目Schema).prefault({}),
  })
  .prefault({});

const 传世轶闻条目Schema = z
  .object({
    原典: strictBoolean,
    关键要素: looseString,
    版本流传范围: looseString,
    版本成型时代: looseString,
    内容梗概: looseString,
  })
  .prefault({});

const 史诗传奇条目Schema = z
  .object({
    基本类型: looseString,
    核心母题关键词: looseString,
    史实真相: looseString,
    流变历程: looseString,
    传世轶闻: z.record(z.string(), 传世轶闻条目Schema).prefault({}),
  })
  .prefault({});

const 潜在时代演化条目Schema = z
  .object({
    开始日期: looseString,
    进度: looseString,
    状态: looseString,
    推动因子: looseString,
    抑止因子: looseString,
    描述: looseString,
    已完结转折点事件影响: z.record(z.string(), 已完结转折点事件影响条目Schema).prefault({}),
  })
  .prefault({});

const 时代关键转折点条目Schema = z
  .object({
    临界事件: strictBoolean,
    进度: looseString,
    干预态势: 干预态势Schema,
    关联潜在时代: looseString,
    描述: looseString,
    总体影响: looseString,
    事件脉络: z.record(z.string(), 事件节点Schema).prefault({}),
  })
  .prefault({});

const 世界时代阶段Schema = z
  .object({
    时代阶段: looseString,
    核心社会组织形式: looseString,
    主流世界观与思潮: looseString,
    主要经济模式: looseString,
    技术特征: looseString,
    主导性能源与动力: looseString,
    关键材料标志: looseString,
    社会阶级结构: looseString,
    生产力与生产关系矛盾: looseString,
    世界秩序格局: looseString,
  })
  .prefault({});

const 世界时局演进动态Schema = z
  .object({
    演进驱动力: looseString,
    时代差格局: looseString,
    潜在时代演化: z.record(z.string(), 潜在时代演化条目Schema).prefault({}),
    时代关键转折点: z.record(z.string(), 时代关键转折点条目Schema).prefault({}),
  })
  .prefault({});

const 岁月史书Schema = z
  .object({
    正史: z.record(z.string(), 正史演变条目Schema).prefault({}),
    特异点: z.record(z.string(), 特异点Schema).prefault({}),
  })
  .prefault({});

const 时代快讯Schema = z
  .object({
    世界时代阶段: 世界时代阶段Schema,
    世界时局演进动态: 世界时局演进动态Schema,
    岁月史书: 岁月史书Schema,
    史诗传奇: z.record(z.string(), 史诗传奇条目Schema).prefault({}),
  })
  .prefault({});

const 剧情事件条目Schema = z
  .object({
    叙事指导: 叙事指导Schema,
    参与角色: looseString,
    牵涉团体: looseString,
    事件脉络: z.record(z.string(), looseString).prefault({}),
    结算条件: looseString,
  })
  .prefault({});

const 传闻流变节点Schema = z
  .object({
    流变日期: looseString,
    预计时效: looseString,
    真相: looseString,
    传闻描述: looseString,
    事实偏差: looseString,
    流变诱因: looseString,
  })
  .prefault({});

const 传闻条目Schema = z
  .object({
    影响力: looseString,
    流传范围: looseString,
    流变历程: z.record(z.string(), 传闻流变节点Schema).prefault({}),
  })
  .prefault({});

const 时局动态Schema = z
  .object({
    世界背景事件: z.record(z.string(), 剧情事件条目Schema).prefault({}),
    当前区域事件: z.record(z.string(), 剧情事件条目Schema).prefault({}),
    传闻: z.record(z.string(), 传闻条目Schema).prefault({}),
  })
  .prefault({});

const 团体条目Schema = z
  .object({
    声誉: 声誉Schema,
    外交关系: z.record(z.string(), looseString).prefault({}),
    权力支柱: 权力支柱Record,
    活跃区域: looseString,
    内政概况: looseString,
    发展态势: looseString,
    当前动态: looseString,
    核心人物: z.record(z.string(), 核心人物Schema).prefault({}),
  })
  .prefault({});

const 团体动态Schema = z
  .object({
    世界背景团体: z.record(z.string(), 团体条目Schema).prefault({}),
    当前区域团体: z.record(z.string(), 团体条目Schema).prefault({}),
  })
  .prefault({});

const 世界剧情态势Schema = z
  .object({
    时局动态: 时局动态Schema,
    团体动态: 团体动态Schema,
  })
  .prefault({});

const 贸易区状态Schema = z
  .object({
    状态: looseString,
    主导产业: looseString,
    需求品类: looseString,
  })
  .prefault({});

const 世界经济气候Schema = z
  .object({
    整体周期相位: looseString,
    主要贸易区状态: z.record(z.string(), 贸易区状态Schema).prefault({}),
  })
  .prefault({});

const 大宗商品品类Schema = z
  .object({
    供需: looseString,
    行情要点: looseString,
    价格趋势: looseString,
    主要影响因素: looseString,
  })
  .prefault({});

const 大宗商品市场Schema = z
  .object({
    粮食: 大宗商品品类Schema,
    矿产: 大宗商品品类Schema,
    能源: 大宗商品品类Schema,
  })
  .prefault({});

const 汇率Schema = z
  .object({
    本期: looseString,
    上期: looseString,
    涨跌: looseString,
  })
  .prefault({});

const 流通货币条目Schema = z
  .object({
    汇率: 汇率Schema,
    市场情绪: looseString,
    驱动因素: looseString,
  })
  .prefault({});

const 汇率波动指数Schema = z
  .object({
    综合汇率波动率: looseString,
    主要影响因素: looseString,
  })
  .prefault({});

const 信贷环境Schema = z
  .object({
    状态: looseString,
    金融机构风险: looseString,
  })
  .prefault({});

const 货币与金融Schema = z
  .object({
    基准计价单位: looseString,
    流通货币: z.record(z.string(), 流通货币条目Schema).prefault({}),
    汇率波动指数: 汇率波动指数Schema,
    信贷环境: 信贷环境Schema,
  })
  .prefault({});

const 投机标的条目Schema = z
  .object({
    类型: looseString,
    当前价格: looseString,
    上期价格: looseString,
    涨跌: looseString,
    交易热度: looseString,
    量能: looseString,
    驱动事件: looseString,
  })
  .prefault({});

const 期货合约条目Schema = z
  .object({
    近月价格: looseString,
    远月价格: looseString,
    基差: looseString,
  })
  .prefault({});

const 投机指数Schema = z
  .object({
    报: looseString,
    周涨跌: looseString,
  })
  .prefault({});

const 投机市场Schema = z
  .object({
    市场整体情绪: looseString,
    主要交易标的: z.record(z.string(), 投机标的条目Schema).prefault({}),
    期货合约: z.record(z.string(), 期货合约条目Schema).prefault({}),
    投机指数: 投机指数Schema,
  })
  .prefault({});

const 商路条目Schema = z
  .object({
    状态: looseString,
    原因: looseString,
  })
  .prefault({});

const 贸易格局Schema = z
  .object({
    主要商路: z.record(z.string(), 商路条目Schema).prefault({}),
    贸易政策: z.record(z.string(), looseString).prefault({}),
  })
  .prefault({});

const 经济事件条目Schema = z
  .object({
    描述: looseString,
    影响维度: looseString,
    当前态势: looseString,
  })
  .prefault({});

const 世界经济简报Schema = z
  .object({
    世界经济气候: 世界经济气候Schema,
    大宗商品市场: 大宗商品市场Schema,
    货币与金融: 货币与金融Schema,
    投机市场: 投机市场Schema,
    贸易格局: 贸易格局Schema,
    经济事件: z.record(z.string(), 经济事件条目Schema).prefault({}),
  })
  .prefault({});

const 世界条目Schema = z
  .object({
    降临: strictBoolean,
    平行演化: strictBoolean,
    刊报日期: looseString,
    时代快讯: 时代快讯Schema,
    世界剧情态势: 世界剧情态势Schema,
    世界经济简报: 世界经济简报Schema,
  })
  .prefault({});

/** 深度剔除非法布尔值, 避免整对象 parse 失败 */
export function stripInvalidStrictBooleans(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripInvalidStrictBooleans);
  }
  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj)) {
    if (STRICT_BOOLEAN_KEYS.has(key)) {
      if (typeof child === 'boolean') {
        next[key] = child;
      }
      continue;
    }
    next[key] = stripInvalidStrictBooleans(child);
  }
  return next;
}

/**
 * addon 变量结构 (对齐 MVU stat_data 的 zod 用法).
 * 修改固定段结构时须同步 patch-path-index.ts
 *
 * - 根形: { 世界: { [世界名]: 世界条目 }, 社交圈: { [圈子名]: 社交圈条目 }, 位面交汇: boolean }
 * - AI patch 仍写 /世界名/...，运行时补 /世界 前缀
 * - AI patch 仍写 /社交圈/圈子名/...，运行时不补 /世界 前缀
 * - 字符串占位选项: 宽松 z.string().prefault(''), 约束写在世界书变量更新规则
 * - 布尔字段: 严格 z.boolean().prefault(false)
 * - 构建时自动生成 `schema.json` (export 名 `Schema` 供 dump_schema 使用)
 */

const 社交圈条目Schema = z
  .object({
    性质: looseString,
    互动频率: looseString,
    信息范围: looseString,
    社群人脉: looseString,
    活跃角色: looseString,
    关联团体: looseString,
    关联圈交集: looseString,
    当前动态: looseString,
    描述: looseString,
  })
  .prefault({});

export const AddonSchema = z
  .object({
    世界: z.record(z.string(), 世界条目Schema).prefault({}),
    社交圈: z.record(z.string(), 社交圈条目Schema).prefault({}),
    位面交汇: strictBoolean,
  })
  .prefault({});

/** 与 MVU 角色卡一致, 供 dump_schema 生成 schema.json */
export const Schema = AddonSchema;

export type AddonData = z.infer<typeof AddonSchema>;
export type WorldEntry = z.infer<typeof 世界条目Schema>;
export type SocialCircleEntry = z.infer<typeof 社交圈条目Schema>;

export const DEFAULT_ADDON_DATA: AddonData = AddonSchema.parse({});

/** 取世界 map（永不返回 undefined） */
export function getWorldMap(data: AddonData | null | undefined): Record<string, WorldEntry> {
  return data?.世界 ?? {};
}

/** 取社交圈 map（永不返回 undefined） */
export function getSocialCircleMap(
  data: AddonData | null | undefined,
): Record<string, SocialCircleEntry> {
  return data?.社交圈 ?? {};
}

/** 预处理非法布尔 + 字段 coerce + prefault 补全完整结构 */
export function normalizeAddonData(raw?: unknown): AddonData {
  const coerced = coerceAddonData(raw ?? {});
  const cleaned = stripInvalidStrictBooleans(coerced);
  return AddonSchema.parse(cleaned);
}
