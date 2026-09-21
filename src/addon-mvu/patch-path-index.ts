/**
 * Schema 固定段路径索引（不含动态 record 实体名）。
 * 修改 schema.ts 固定段结构时须同步此文件。
 */

export type PathTreeNode = {
  children?: Record<string, PathTreeNode>;
  /** 动态 record 容器；children 为条目内固定段模板 */
  record?: boolean;
  /** 标量叶节点 */
  scalar?: boolean;
};

const leaf = (): PathTreeNode => ({ scalar: true });

const obj = (children: Record<string, PathTreeNode>): PathTreeNode => ({ children });

const record = (entry?: PathTreeNode): PathTreeNode => ({
  record: true,
  children: entry?.children ?? {},
});

const 叙事指导 = obj({
  宏观层: leaf(),
  发展层: leaf(),
  细节层: leaf(),
});

const 声誉 = obj({
  官方: leaf(),
  民间: leaf(),
  暗域: leaf(),
  业界: leaf(),
});

const 干预态势 = obj({
  推动力: leaf(),
  抑止力: leaf(),
});

const 事件节点 = record(
  obj({
    开始日期: leaf(),
    结束日期: leaf(),
    干预方向: leaf(),
    干预强度: leaf(),
    描述: leaf(),
    影响: leaf(),
  }),
);

const 剧情事件条目 = obj({
  叙事指导,
  参与角色: leaf(),
  牵涉团体: leaf(),
  事件脉络: record(),
  结算条件: leaf(),
});

const 传闻流变节点 = obj({
  流变日期: leaf(),
  预计时效: leaf(),
  真相: leaf(),
  传闻描述: leaf(),
  事实偏差: leaf(),
  流变诱因: leaf(),
});

const 传闻条目 = obj({
  影响力: leaf(),
  流传范围: leaf(),
  流变历程: record(传闻流变节点),
});

const 时局动态 = obj({
  世界背景事件: record(剧情事件条目),
  当前区域事件: record(剧情事件条目),
  传闻: record(传闻条目),
});

const 核心人物 = obj({
  身份职务: leaf(),
  权力支柱: record(),
});

const 团体条目 = obj({
  声誉,
  外交关系: record(),
  权力支柱: record(),
  活跃区域: leaf(),
  内政概况: leaf(),
  发展态势: leaf(),
  当前动态: leaf(),
  核心人物: record(核心人物),
});

const 团体动态 = obj({
  世界背景团体: record(团体条目),
  当前区域团体: record(团体条目),
});

const 世界剧情态势 = obj({
  时局动态,
  团体动态,
});

const 世界时代阶段 = obj({
  时代阶段: leaf(),
  核心社会组织形式: leaf(),
  主流世界观与思潮: leaf(),
  主要经济模式: leaf(),
  技术特征: leaf(),
  主导性能源与动力: leaf(),
  关键材料标志: leaf(),
  社会阶级结构: leaf(),
  生产力与生产关系矛盾: leaf(),
  世界秩序格局: leaf(),
});

const 已完结转折点事件影响条目 = obj({
  起止日期: leaf(),
  最终结局: leaf(),
  事件脉络: leaf(),
  时代影响: leaf(),
});

const 潜在时代演化条目 = obj({
  开始日期: leaf(),
  进度: leaf(),
  状态: leaf(),
  推动因子: leaf(),
  抑止因子: leaf(),
  描述: leaf(),
  已完结转折点事件影响: record(已完结转折点事件影响条目),
});

const 时代关键转折点条目 = obj({
  临界事件: leaf(),
  进度: leaf(),
  干预态势,
  关联潜在时代: leaf(),
  描述: leaf(),
  总体影响: leaf(),
  事件脉络: record(事件节点),
});

const 世界时局演进动态 = obj({
  演进驱动力: leaf(),
  时代差格局: leaf(),
  潜在时代演化: record(潜在时代演化条目),
  时代关键转折点: record(时代关键转折点条目),
});

const 正史演变条目 = obj({
  前时代称谓: leaf(),
  后时代称谓: leaf(),
  演变起止: leaf(),
  描述: leaf(),
  历史影响: leaf(),
  关键转折: leaf(),
});

const 分歧纪段条目 = obj({
  前时代称谓: leaf(),
  后时代称谓: leaf(),
  纪段起止: leaf(),
  描述: leaf(),
  历史影响: leaf(),
  关键转折: leaf(),
});

const 特异点 = obj({
  降临: leaf(),
  分歧源头: leaf(),
  事件记录: record(分歧纪段条目),
});

const 岁月史书 = obj({
  正史: record(正史演变条目),
  特异点: record(特异点),
});

const 传世轶闻条目 = obj({
  原典: leaf(),
  关键要素: leaf(),
  版本流传范围: leaf(),
  版本成型时代: leaf(),
  内容梗概: leaf(),
});

const 史诗传奇条目 = obj({
  基本类型: leaf(),
  核心母题关键词: leaf(),
  史实真相: leaf(),
  流变历程: leaf(),
  传世轶闻: record(传世轶闻条目),
});

const 时代快讯 = obj({
  世界时代阶段,
  世界时局演进动态,
  岁月史书,
  史诗传奇: record(史诗传奇条目),
});

const 贸易区状态 = obj({
  状态: leaf(),
  主导产业: leaf(),
  需求品类: leaf(),
});

const 世界经济气候 = obj({
  整体周期相位: leaf(),
  主要贸易区状态: record(贸易区状态),
});

const 大宗商品品类 = obj({
  供需: leaf(),
  行情要点: leaf(),
  价格趋势: leaf(),
  主要影响因素: leaf(),
});

const 大宗商品市场 = obj({
  粮食: 大宗商品品类,
  矿产: 大宗商品品类,
  能源: 大宗商品品类,
});

const 汇率 = obj({
  本期: leaf(),
  上期: leaf(),
  涨跌: leaf(),
});

const 流通货币条目 = obj({
  汇率,
  市场情绪: leaf(),
  驱动因素: leaf(),
});

const 汇率波动指数 = obj({
  综合汇率波动率: leaf(),
  主要影响因素: leaf(),
});

const 信贷环境 = obj({
  状态: leaf(),
  金融机构风险: leaf(),
});

const 货币与金融 = obj({
  基准计价单位: leaf(),
  流通货币: record(流通货币条目),
  汇率波动指数,
  信贷环境,
});

const 投机标的条目 = obj({
  类型: leaf(),
  当前价格: leaf(),
  上期价格: leaf(),
  涨跌: leaf(),
  交易热度: leaf(),
  量能: leaf(),
  驱动事件: leaf(),
});

const 期货合约条目 = obj({
  近月价格: leaf(),
  远月价格: leaf(),
  基差: leaf(),
});

const 投机指数 = obj({
  报: leaf(),
  周涨跌: leaf(),
});

const 投机市场 = obj({
  市场整体情绪: leaf(),
  主要交易标的: record(投机标的条目),
  期货合约: record(期货合约条目),
  投机指数,
});

const 商路条目 = obj({
  状态: leaf(),
  原因: leaf(),
});

const 贸易格局 = obj({
  主要商路: record(商路条目),
  贸易政策: record(),
});

const 经济事件条目 = obj({
  描述: leaf(),
  影响维度: leaf(),
  当前态势: leaf(),
});

const 世界经济简报 = obj({
  世界经济气候,
  大宗商品市场,
  货币与金融,
  投机市场,
  贸易格局,
  经济事件: record(经济事件条目),
});

/** 世界条目根（/{世界名}/ 之下） */
export const WORLD_ENTRY_TREE: PathTreeNode = obj({
  降临: leaf(),
  平行演化: leaf(),
  刊报日期: leaf(),
  时代快讯,
  世界剧情态势,
  世界经济简报,
});

/** 社交圈条目根（/社交圈/{圈子名}/ 之下） */
export const SOCIAL_CIRCLE_ENTRY_TREE: PathTreeNode = obj({
  性质: leaf(),
  互动频率: leaf(),
  信息范围: leaf(),
  社群人脉: leaf(),
  活跃角色: leaf(),
  关联团体: leaf(),
  关联圈交集: leaf(),
  当前动态: leaf(),
  描述: leaf(),
});

function collectFixedKeysFromNode(node: PathTreeNode, keys: Set<string>): void {
  if (!node.children) {
    return;
  }
  for (const [key, child] of Object.entries(node.children)) {
    keys.add(key);
    collectFixedKeysFromNode(child, keys);
  }
}

/** 全部 schema 固定段名（不含动态实体名） */
export const ALL_FIXED_SEGMENT_KEYS = (() => {
  const keys = new Set<string>();
  collectFixedKeysFromNode(WORLD_ENTRY_TREE, keys);
  return keys;
})();

/** 社交圈固定段名集合（用于 canonicalize） */
export const ALL_SOCIAL_FIXED_SEGMENT_KEYS = (() => {
  const keys = new Set<string>();
  collectFixedKeysFromNode(SOCIAL_CIRCLE_ENTRY_TREE, keys);
  return keys;
})();

/**
 * 在当前 schema 节点子树中查找 targetSegment 作为固定键的唯一祖先链。
 * 返回需插入的祖先段（不含已对齐前缀）；零或多匹配时返回 null。
 */
export function findUniqueAncestorChain(startNode: PathTreeNode, targetSegment: string): string[] | null {
  const matches: string[][] = [];

  function search(node: PathTreeNode, ancestors: string[]): void {
    if (!node.children) {
      return;
    }
    for (const [key, child] of Object.entries(node.children)) {
      if (key === targetSegment) {
        matches.push(ancestors);
      }
      search(child, [...ancestors, key]);
    }
  }

  search(startNode, []);

  if (matches.length === 1) {
    return matches[0]!;
  }
  return null;
}
