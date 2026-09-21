import assert from 'node:assert/strict';
import { coerceAddonData } from './coerce';
import { AddonSchema, normalizeAddonData } from './schema';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('coerce 进度 number to percent string', () => {
  const out = coerceAddonData({
    世界: {
      阿斯塔利亚: {
        时代快讯: {
          世界时局演进动态: {
            潜在时代演化: {
              同业公会时代: { 进度: 5 },
            },
          },
        },
      },
    },
    位面交汇: false,
  }) as Record<string, unknown>;
  const worlds = out['世界'] as Record<string, unknown>;
  const world = worlds['阿斯塔利亚'] as Record<string, unknown>;
  const era = (world['时代快讯'] as Record<string, unknown>)['世界时局演进动态'] as Record<string, unknown>;
  const potential = (era['潜在时代演化'] as Record<string, unknown>)['同业公会时代'] as Record<string, unknown>;
  assert.equal(potential['进度'], '5%');
});

test('coerce 核心母题关键词 empty array to empty string', () => {
  const out = coerceAddonData({
    世界: {
      阿斯塔利亚: {
        时代快讯: {
          史诗传奇: {
            未命名: { 核心母题关键词: [] },
          },
        },
      },
    },
    位面交汇: false,
  }) as Record<string, unknown>;
  const legend = (
    (
      ((out['世界'] as Record<string, unknown>)['阿斯塔利亚'] as Record<string, unknown>)[
        '时代快讯'
      ] as Record<string, unknown>
    )['史诗传奇'] as Record<string, unknown>
  )['未命名'] as Record<string, unknown>;
  assert.equal(legend['核心母题关键词'], '');
});

test('coerce 核心人物权力支柱 string to record', () => {
  const out = coerceAddonData({
    世界: {
      阿斯塔利亚: {
        世界剧情态势: {
          团体动态: {
            世界背景团体: {
              萨尔加斯商会: {
                核心人物: {
                  '会长埃德蒙·洛克': { 权力支柱: '贸易许可审批' },
                },
              },
            },
          },
        },
      },
    },
    位面交汇: false,
  }) as Record<string, unknown>;
  const person = (
    (
      (
        (
          ((out['世界'] as Record<string, unknown>)['阿斯塔利亚'] as Record<string, unknown>)[
            '世界剧情态势'
          ] as Record<string, unknown>
        )['团体动态'] as Record<string, unknown>
      )['世界背景团体'] as Record<string, unknown>
    )['萨尔加斯商会'] as Record<string, unknown>
  )['核心人物'] as Record<string, unknown>;
  const pillar = (person['会长埃德蒙·洛克'] as Record<string, unknown>)['权力支柱'] as Record<string, string>;
  assert.deepEqual(pillar, { 贸易许可审批: '' });
});

test('coerce 关联转折 alias to 关键转折', () => {
  const out = coerceAddonData({
    世界: {
      阿斯塔利亚: {
        时代快讯: {
          岁月史书: {
            正史: {
              自由城邦时代: { 关联转折: '某事件' },
            },
          },
        },
      },
    },
    位面交汇: false,
  }) as Record<string, unknown>;
  const entry = (
    (
      (
        ((out['世界'] as Record<string, unknown>)['阿斯塔利亚'] as Record<string, unknown>)[
          '时代快讯'
        ] as Record<string, unknown>
      )['岁月史书'] as Record<string, unknown>
    )['正史'] as Record<string, unknown>
  )['自由城邦时代'] as Record<string, unknown>;
  assert.equal(entry['关键转折'], '某事件');
  assert.equal(entry['关联转折'], undefined);
});

test('coerce loose numeric string keys', () => {
  const out = coerceAddonData({
    世界: {
      阿斯塔利亚: {
        世界经济简报: {
          投机市场: {
            投机指数: { 报: 100 },
            主要交易标的: {
              蓝矿期货: { 当前价格: 10.55, 上期价格: 10 },
            },
          },
        },
      },
    },
    位面交汇: false,
  }) as Record<string, unknown>;
  const index = (
    (
      ((out['世界'] as Record<string, unknown>)['阿斯塔利亚'] as Record<string, unknown>)[
        '世界经济简报'
      ] as Record<string, unknown>
    )['投机市场'] as Record<string, unknown>
  )['投机指数'] as Record<string, unknown>;
  assert.equal(index['报'], '100');
  const commodity = (
    (
      (
        ((out['世界'] as Record<string, unknown>)['阿斯塔利亚'] as Record<string, unknown>)[
          '世界经济简报'
        ] as Record<string, unknown>
      )['投机市场'] as Record<string, unknown>
    )['主要交易标的'] as Record<string, unknown>
  )['蓝矿期货'] as Record<string, unknown>;
  assert.equal(commodity['当前价格'], '10.55');
  assert.equal(commodity['上期价格'], '10');
});

test('normalizeAddonData accepts coerced real-world failure fragment', () => {
  const raw = {
    世界: {
      阿斯塔利亚: {
        降临: true,
        平行演化: false,
        刊报日期: '自由纪元-427年-07月-12日',
        时代快讯: {
          世界时代阶段: { 时代阶段: '自由商业时代' },
          世界时局演进动态: {
            演进驱动力: '蓝矿经济繁荣',
            时代差格局: '沿海与原内陆差异',
            潜在时代演化: {
              同业公会时代: {
                开始日期: '自由纪元-427年-07月-12日',
                进度: 5,
                状态: '萌芽',
                推动因子: '联合',
                抑止因子: '抵制',
                描述: '',
                已完结转折点事件影响: {},
              },
            },
            时代关键转折点: {},
          },
          岁月史书: {
            正史: {
              自由城邦时代: {
                前时代称谓: '分裂时代',
                后时代称谓: '自由商业时代',
                演变起止: '自由纪元-350年-01月-01日 ~ 自由纪元-400年-12月-31日',
                描述: '简述',
                历史影响: '影响',
                关联转折: '',
              },
            },
            特异点: {},
          },
          史诗传奇: {
            未命名: {
              核心母题关键词: [],
              流变历程: '暂无',
              传世轶闻: {},
            },
          },
        },
        世界剧情态势: {
          时局动态: {
            世界背景事件: {},
            当前区域事件: {},
            传闻: {},
          },
          团体动态: {
            世界背景团体: {
              萨尔加斯商会: {
                声誉: { 官方: '受人尊敬', 民间: '默默无闻', 暗域: '声名狼藉', 业界: '受人尊敬' },
                外交关系: {},
                权力支柱: { 贸易许可审批: '控制货物进出权' },
                活跃区域: '萨尔加斯',
                内政概况: '',
                发展态势: '',
                当前动态: '',
                核心人物: {
                  '会长埃德蒙·洛克': { 权力支柱: '贸易许可审批' },
                },
              },
            },
            当前区域团体: {},
          },
        },
        世界经济简报: {
          世界经济气候: { 整体周期相位: '繁荣', 主要贸易区状态: {} },
          大宗商品市场: {
            粮食: { 供需: '平稳', 行情要点: '', 价格趋势: '→', 主要影响因素: '' },
            矿产: { 供需: '紧缺', 行情要点: '蓝矿', 价格趋势: '↑', 主要影响因素: '' },
            能源: { 供需: '平稳', 行情要点: '木材', 价格趋势: '→', 主要影响因素: '' },
          },
          货币与金融: {
            基准计价单位: '金轮 (G)',
            流通货币: {},
            汇率波动指数: { 综合汇率波动率: '低', 主要影响因素: '' },
            信贷环境: { 状态: '宽松', 金融机构风险: '稳定' },
          },
          投机市场: {
            市场整体情绪: '乐观',
            主要交易标的: {
              蓝矿期货: {
                类型: '期货',
                当前价格: 10.55,
                上期价格: 10,
                涨跌: '↑5.50%',
                交易热度: '高',
                量能: '放量',
                驱动事件: '垄断',
              },
            },
            期货合约: {},
            投机指数: { 报: 100, 周涨跌: '↑5.50%' },
          },
          贸易格局: { 主要商路: {}, 贸易政策: {} },
          经济事件: {},
        },
      },
    },
    位面交汇: false,
  };

  const normalized = normalizeAddonData(raw);
  assert.equal(
    normalized.世界['阿斯塔利亚']?.时代快讯.世界时局演进动态.潜在时代演化['同业公会时代']?.进度,
    '5%',
  );
  assert.equal(normalized.世界['阿斯塔利亚']?.时代快讯.史诗传奇['未命名']?.核心母题关键词, '');
  assert.deepEqual(
    normalized.世界['阿斯塔利亚']?.世界剧情态势.团体动态.世界背景团体['萨尔加斯商会']?.核心人物[
      '会长埃德蒙·洛克'
    ]?.权力支柱,
    { 贸易许可审批: '' },
  );
  assert.equal(
    normalized.世界['阿斯塔利亚']?.时代快讯.岁月史书.正史['自由城邦时代']?.关键转折,
    '',
  );
  AddonSchema.parse(normalized);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
