import fs from 'fs';
import path from 'path';

const dir = path.resolve('src/addon-console/assets/tarot');
const digitMap = { 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' };
const majorMap = {
  '0愚者': '愚者',
  '1魔术师': '魔术师',
  '2女祭司': '女祭司',
  '3皇后': '女皇',
  '4皇帝': '皇帝',
  '5教皇': '教皇',
  '6恋人': '恋人',
  '7战车': '战车',
  '8力量': '力量',
  '9隐士': '隐者',
  '10命运之轮': '命运之轮',
  '11正义': '正义',
  '12吊人': '倒吊人',
  '13死神': '死神',
  '14节制': '节制',
  '15恶魔': '恶魔',
  '16高塔': '高塔',
  '17星星': '星星',
  '18月亮': '月亮',
  '19太阳': '太阳',
  '20审判': '审判',
  '21世界': '世界',
};

function targetName(base) {
  if (majorMap[base]) return majorMap[base];
  const m = base.match(/^(权杖|圣杯|宝剑|星币)(.+)$/);
  if (!m) return null;
  const [, suit, rest] = m;
  if (rest === 'Ace') return suit + '王牌';
  if (rest === '皇后') return suit + '王后';
  if (digitMap[rest]) return suit + digitMap[rest];
  if (['侍从', '骑士', '国王'].includes(rest)) return suit + rest;
  return null;
}

const expected = [
  ...'愚者 魔术师 女祭司 女皇 皇帝 教皇 恋人 战车 力量 隐者 命运之轮 正义 倒吊人 死神 节制 恶魔 高塔 星星 月亮 太阳 审判 世界'.split(
    ' ',
  ),
];
for (const suit of ['权杖', '圣杯', '宝剑', '星币']) {
  for (const r of ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍从', '骑士', '王后', '国王']) {
    expected.push(suit + r);
  }
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
const renames = [];
for (const f of files) {
  const base = f.slice(0, -4);
  const t = targetName(base);
  if (!t) {
    console.error('UNMAPPED', f);
    process.exitCode = 1;
    continue;
  }
  if (t + '.png' === f) continue;
  renames.push([f, t + '.png']);
}

const tmp = [];
for (const [from, to] of renames) {
  const mid = '__tmp__' + from;
  fs.renameSync(path.join(dir, from), path.join(dir, mid));
  tmp.push([mid, to]);
}
for (const [mid, to] of tmp) {
  fs.renameSync(path.join(dir, mid), path.join(dir, to));
  console.log(mid.replace(/^__tmp__/, '') + ' -> ' + to);
}

const after = fs
  .readdirSync(dir)
  .filter(f => f.endsWith('.png'))
  .map(f => f.slice(0, -4))
  .sort();
const exp = [...expected].sort();
console.log('COUNT', after.length);
console.log('MISSING', exp.filter(n => !after.includes(n)));
console.log('EXTRA', after.filter(n => !exp.includes(n)));
