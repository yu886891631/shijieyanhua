import { AddonData, getWorldMap, normalizeAddonData } from './schema';

type TarotCard = { name: string };

/** 小阿卡那牌池 (移植自卜卦.txt) */
const minorArcana: TarotCard[] = [
  { name: '权杖王牌' },
  { name: '权杖二' },
  { name: '权杖三' },
  { name: '权杖四' },
  { name: '权杖五' },
  { name: '权杖六' },
  { name: '权杖七' },
  { name: '权杖八' },
  { name: '权杖九' },
  { name: '权杖十' },
  { name: '权杖侍从' },
  { name: '权杖骑士' },
  { name: '权杖王后' },
  { name: '权杖国王' },
  { name: '圣杯王牌' },
  { name: '圣杯二' },
  { name: '圣杯三' },
  { name: '圣杯四' },
  { name: '圣杯五' },
  { name: '圣杯六' },
  { name: '圣杯七' },
  { name: '圣杯八' },
  { name: '圣杯九' },
  { name: '圣杯十' },
  { name: '圣杯侍从' },
  { name: '圣杯骑士' },
  { name: '圣杯王后' },
  { name: '圣杯国王' },
  { name: '宝剑王牌' },
  { name: '宝剑二' },
  { name: '宝剑三' },
  { name: '宝剑四' },
  { name: '宝剑五' },
  { name: '宝剑六' },
  { name: '宝剑七' },
  { name: '宝剑八' },
  { name: '宝剑九' },
  { name: '宝剑十' },
  { name: '宝剑侍从' },
  { name: '宝剑骑士' },
  { name: '宝剑王后' },
  { name: '宝剑国王' },
  { name: '星币王牌' },
  { name: '星币二' },
  { name: '星币三' },
  { name: '星币四' },
  { name: '星币五' },
  { name: '星币六' },
  { name: '星币七' },
  { name: '星币八' },
  { name: '星币九' },
  { name: '星币十' },
  { name: '星币侍从' },
  { name: '星币骑士' },
  { name: '星币王后' },
  { name: '星币国王' },
];

const EVENT_CATEGORIES = ['世界背景事件', '当前区域事件'] as const;

function drawRandom(pool: TarotCard[], count: number): Array<TarotCard & { reversed: boolean }> {
  const picks: Array<TarotCard & { reversed: boolean }> = [];
  const used = new Set<number>();
  while (picks.length < count && used.size < pool.length) {
    const index = Math.floor(Math.random() * pool.length);
    if (used.has(index)) {
      continue;
    }
    used.add(index);
    const card = pool[index]!;
    picks.push({
      name: card.name,
      reversed: Math.random() < 0.35,
    });
  }
  return picks;
}

function tarotTitle(card: TarotCard & { reversed: boolean }): string {
  return `${card.name}${card.reversed ? '(逆位)' : ''}`;
}

/** 抽取 3 张小阿卡那作为细节层叙事指导 */
export function randomMinorTitle(): string {
  return drawRandom(minorArcana, 3)
    .map(card => tarotTitle(card))
    .join('、');
}

/** 为所有现存事件的叙事指导.细节层重抽小阿卡那; 不修改宏观层/发展层 */
export function refreshNarrativeGuidanceDetails(addon: AddonData): AddonData {
  const next = _.cloneDeep(addon);
  let touched = false;

  for (const world of Object.values(getWorldMap(next))) {
    if (!world) {
      continue;
    }
    for (const category of EVENT_CATEGORIES) {
      const events = world.世界剧情态势?.时局动态?.[category];
      if (!events) {
        continue;
      }
      for (const event of Object.values(events)) {
        if (!event) {
          continue;
        }
        if (!event.叙事指导) {
          event.叙事指导 = { 宏观层: '', 发展层: '', 细节层: '' };
        }
        event.叙事指导.细节层 = randomMinorTitle();
        touched = true;
      }
    }
  }

  if (!touched) {
    return addon;
  }
  return normalizeAddonData(next);
}
