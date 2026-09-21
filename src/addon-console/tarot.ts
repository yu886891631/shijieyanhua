export type TarotParsed = { name: string; reversed: boolean };

const TAROT_SRC: Record<string, string> = {
  '宝剑八': require('./assets/tarot/宝剑八.png?url'),
  '宝剑二': require('./assets/tarot/宝剑二.png?url'),
  '宝剑国王': require('./assets/tarot/宝剑国王.png?url'),
  '宝剑九': require('./assets/tarot/宝剑九.png?url'),
  '宝剑六': require('./assets/tarot/宝剑六.png?url'),
  '宝剑七': require('./assets/tarot/宝剑七.png?url'),
  '宝剑骑士': require('./assets/tarot/宝剑骑士.png?url'),
  '宝剑三': require('./assets/tarot/宝剑三.png?url'),
  '宝剑十': require('./assets/tarot/宝剑十.png?url'),
  '宝剑侍从': require('./assets/tarot/宝剑侍从.png?url'),
  '宝剑四': require('./assets/tarot/宝剑四.png?url'),
  '宝剑王后': require('./assets/tarot/宝剑王后.png?url'),
  '宝剑王牌': require('./assets/tarot/宝剑王牌.png?url'),
  '宝剑五': require('./assets/tarot/宝剑五.png?url'),
  '倒吊人': require('./assets/tarot/倒吊人.png?url'),
  '恶魔': require('./assets/tarot/恶魔.png?url'),
  '高塔': require('./assets/tarot/高塔.png?url'),
  '皇帝': require('./assets/tarot/皇帝.png?url'),
  '教皇': require('./assets/tarot/教皇.png?url'),
  '节制': require('./assets/tarot/节制.png?url'),
  '力量': require('./assets/tarot/力量.png?url'),
  '恋人': require('./assets/tarot/恋人.png?url'),
  '命运之轮': require('./assets/tarot/命运之轮.png?url'),
  '魔术师': require('./assets/tarot/魔术师.png?url'),
  '女皇': require('./assets/tarot/女皇.png?url'),
  '女祭司': require('./assets/tarot/女祭司.png?url'),
  '权杖八': require('./assets/tarot/权杖八.png?url'),
  '权杖二': require('./assets/tarot/权杖二.png?url'),
  '权杖国王': require('./assets/tarot/权杖国王.png?url'),
  '权杖九': require('./assets/tarot/权杖九.png?url'),
  '权杖六': require('./assets/tarot/权杖六.png?url'),
  '权杖七': require('./assets/tarot/权杖七.png?url'),
  '权杖骑士': require('./assets/tarot/权杖骑士.png?url'),
  '权杖三': require('./assets/tarot/权杖三.png?url'),
  '权杖十': require('./assets/tarot/权杖十.png?url'),
  '权杖侍从': require('./assets/tarot/权杖侍从.png?url'),
  '权杖四': require('./assets/tarot/权杖四.png?url'),
  '权杖王后': require('./assets/tarot/权杖王后.png?url'),
  '权杖王牌': require('./assets/tarot/权杖王牌.png?url'),
  '权杖五': require('./assets/tarot/权杖五.png?url'),
  '审判': require('./assets/tarot/审判.png?url'),
  '圣杯八': require('./assets/tarot/圣杯八.png?url'),
  '圣杯二': require('./assets/tarot/圣杯二.png?url'),
  '圣杯国王': require('./assets/tarot/圣杯国王.png?url'),
  '圣杯九': require('./assets/tarot/圣杯九.png?url'),
  '圣杯六': require('./assets/tarot/圣杯六.png?url'),
  '圣杯七': require('./assets/tarot/圣杯七.png?url'),
  '圣杯骑士': require('./assets/tarot/圣杯骑士.png?url'),
  '圣杯三': require('./assets/tarot/圣杯三.png?url'),
  '圣杯十': require('./assets/tarot/圣杯十.png?url'),
  '圣杯侍从': require('./assets/tarot/圣杯侍从.png?url'),
  '圣杯四': require('./assets/tarot/圣杯四.png?url'),
  '圣杯王后': require('./assets/tarot/圣杯王后.png?url'),
  '圣杯王牌': require('./assets/tarot/圣杯王牌.png?url'),
  '圣杯五': require('./assets/tarot/圣杯五.png?url'),
  '世界': require('./assets/tarot/世界.png?url'),
  '死神': require('./assets/tarot/死神.png?url'),
  '太阳': require('./assets/tarot/太阳.png?url'),
  '星币八': require('./assets/tarot/星币八.png?url'),
  '星币二': require('./assets/tarot/星币二.png?url'),
  '星币国王': require('./assets/tarot/星币国王.png?url'),
  '星币九': require('./assets/tarot/星币九.png?url'),
  '星币六': require('./assets/tarot/星币六.png?url'),
  '星币七': require('./assets/tarot/星币七.png?url'),
  '星币骑士': require('./assets/tarot/星币骑士.png?url'),
  '星币三': require('./assets/tarot/星币三.png?url'),
  '星币十': require('./assets/tarot/星币十.png?url'),
  '星币侍从': require('./assets/tarot/星币侍从.png?url'),
  '星币四': require('./assets/tarot/星币四.png?url'),
  '星币王后': require('./assets/tarot/星币王后.png?url'),
  '星币王牌': require('./assets/tarot/星币王牌.png?url'),
  '星币五': require('./assets/tarot/星币五.png?url'),
  '星星': require('./assets/tarot/星星.png?url'),
  '隐者': require('./assets/tarot/隐者.png?url'),
  '愚者': require('./assets/tarot/愚者.png?url'),
  '月亮': require('./assets/tarot/月亮.png?url'),
  '战车': require('./assets/tarot/战车.png?url'),
  '正义': require('./assets/tarot/正义.png?url'),
};

export function tarotSrc(name: string): string | undefined {
  return TAROT_SRC[name];
}

/** 解析发展层/细节层牌名串，如 `魔术师(逆位)、命运之轮、女皇` */
export function parseTarotList(text: string): TarotParsed[] {
  const raw = (text ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[、,，]/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const reversed = /\(逆位\)$/.test(part);
      const name = part.replace(/\(逆位\)$/, '').trim();
      return { name, reversed };
    })
    .filter(c => c.name);
}
