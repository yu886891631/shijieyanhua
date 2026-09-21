import {
  CATEGORY_META,
  type AttrMap,
  type CategorySection,
  type ChronicleBuildInput,
  type ChronicleData,
  type InteractionEvent,
  type NpcCard,
  type NpcCategoryKey,
  type NpcLifeArchive,
  type QuestArchiveEntry,
  type QuestItem,
  type QuestItemStatus,
  type QuestLog,
  type ReputationClass,
  type WealthClass,
} from './types';

/** 去掉 HTML 注释 */
export function stripComments(text: string): string {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

export function softTrim(text: string): string {
  return String(text ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 解析开标签属性。支持中英属性名。 */
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

/** 找出所有成对或自闭合标签实例 */
export function findAllPairs(source: string, tagName: string): TagHit[] {
  const text = String(source ?? '');
  if (!text || !tagName) return [];
  const openRe = new RegExp(`<\\s*${escapeRegExp(tagName)}(?=[\\s/>])([^>]*)>`, 'gi');
  const closeToken = `</${tagName}>`;
  const hits: TagHit[] = [];
  let m: RegExpExecArray | null;

  while ((m = openRe.exec(text)) !== null) {
    const openEnd = openRe.lastIndex;
    const openTag = m[0];
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
    if (closeIdx === -1) continue;
    const inner = text.slice(openEnd, closeIdx);
    const full = text.slice(m.index, closeIdx + closeToken.length);
    hits.push({
      openTag,
      attrs: parseAttrs(openTag),
      inner,
      full,
    });
    openRe.lastIndex = closeIdx + closeToken.length;
  }
  return hits;
}

function fieldLine(text: string, label: string): string {
  const re = new RegExp(`${escapeRegExp(label)}\\s*[:：]\\s*(.+?)(?:\\n|$)`, 'i');
  const m = text.match(re);
  return m ? softTrim(m[1]) : '';
}

function splitPipe(raw: string): string[] {
  return raw
    .split(/\s*[|¦]\s*/)
    .map(s => softTrim(s))
    .filter(Boolean);
}

/**
 * 拆分记忆条目。
 * 支持 `1.a;2.b`，以及无分号的连写 `1.a。2.b。3.c` / `1、a 2、b`。
 */
export function splitMemories(raw: string): string[] {
  const text = softTrim(String(raw ?? ''));
  if (!text) return [];

  /** 下一条序号前拆分：2. / 2、 / 2) ，序号后需空白或中文/引号/字母 */
  const numberedBoundary =
    /(?=\d{1,2}[.、.)．](?:\s|(?=[\u4e00-\u9fff「『“A-Za-z])))/;

  let parts = text
    .split(/[;；]+/)
    .map(s => softTrim(s))
    .filter(Boolean);
  if (!parts.length) parts = [text];

  parts = parts.flatMap(part => {
    const pieces = part
      .split(numberedBoundary)
      .map(s => softTrim(s))
      .filter(Boolean);
    if (pieces.length <= 1) return [part];
    const numbered = pieces.filter(p => /^\d{1,2}[.、.)．]/.test(p));
    return numbered.length >= 2 ? pieces : [part];
  });

  return parts
    .map(s => softTrim(s.replace(/^\d{1,2}[.、.)．]\s*/, '')))
    .filter(Boolean);
}

function parseReputation(raw: string): NpcCard['reputation'] {
  if (!raw) return [];
  const out: NpcCard['reputation'] = [];
  for (const part of splitPipe(raw)) {
    const m = part.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (m) {
      out.push({ label: softTrim(m[1] ?? ''), value: softTrim(m[2] ?? '') });
    } else if (part) {
      out.push({ label: '', value: part });
    }
  }
  return out.filter(r => r.value);
}

/**
 * 分类用 `|` 分隔，分类内关系人用 `;` 分隔。
 * 亦兼容 `;[分类]人名`（漏写 `|` 时仍切换分类）。
 */
function parseGroupedPeople(raw: string): NpcCard['socialNetwork'] {
  if (!raw) return [];
  const byCat = new Map<string, NpcCard['socialNetwork'][number]['people']>();
  let currentCategory = '关系';

  function pushPerson(category: string, personRaw: string) {
    const text = softTrim(personRaw);
    if (!text) return;
    const pm = text.match(/^(.+?)\s*[（(]\s*(.*?)\s*[）)]\s*$/);
    const person = pm
      ? { name: softTrim(pm[1] ?? ''), note: softTrim(pm[2] ?? '') }
      : { name: text, note: '' };
    if (!person.name) return;
    const list = byCat.get(category) ?? [];
    list.push(person);
    byCat.set(category, list);
  }

  for (const catChunk of splitPipe(raw)) {
    let rest = catChunk;
    const catMatch = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (catMatch) {
      currentCategory = softTrim(catMatch[1] ?? '') || '关系';
      rest = softTrim(catMatch[2] ?? '');
    }
    if (!rest) continue;

    for (const personRaw of rest
      .split(/[;；]/)
      .map(s => softTrim(s))
      .filter(Boolean)) {
      const nested = personRaw.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (nested) {
        currentCategory = softTrim(nested[1] ?? '') || currentCategory;
        pushPerson(currentCategory, nested[2] ?? '');
      } else {
        pushPerson(currentCategory, personRaw);
      }
    }
  }

  const groups: NpcCard['socialNetwork'] = [];
  for (const [category, people] of byCat) {
    if (people.length) groups.push({ category, people });
  }
  return groups;
}

function parseBackground(raw: string): NpcCard['background'] {
  const bg: NpcCard['background'] = { group: '', circle: '', event: '' };
  if (!raw) return bg;
  const group = raw.match(/\[团体\]\s*([^|\[\]]*)/);
  const circle = raw.match(/\[社交圈\]\s*([^|\[\]]*)/);
  const event = raw.match(/\[事件\]\s*([^|\[\]]*)/);
  if (group) bg.group = softTrim(group[1] ?? '');
  if (circle) bg.circle = softTrim(circle[1] ?? '');
  if (event) bg.event = softTrim(event[1] ?? '');
  return bg;
}

function emptyLifeArchive(): NpcLifeArchive {
  return { birthday: '', race: '', age: '', remainingLife: '' };
}

function parseLifeArchive(raw: string): NpcLifeArchive {
  const life = emptyLifeArchive();
  if (!raw) return life;
  const birthday = raw.match(/\[生日\]\s*([^|\[\]]*)/);
  const race = raw.match(/\[种族\]\s*([^|\[\]]*)/);
  const age = raw.match(/\[年龄\]\s*([^|\[\]]*)/);
  const remaining = raw.match(/\[剩余寿命\]\s*([^|\[\]]*)/);
  if (birthday) life.birthday = softTrim(birthday[1] ?? '');
  if (race) life.race = softTrim(race[1] ?? '');
  if (age) life.age = softTrim(age[1] ?? '');
  if (remaining) life.remainingLife = softTrim(remaining[1] ?? '');
  return life;
}

function emptyBackground(): NpcCard['background'] {
  return { group: '', circle: '', event: '' };
}

function leadingIndent(line: string): number {
  const m = line.match(/^[ \t]*/);
  return m ? m[0]!.length : 0;
}

function stripQuestMarker(line: string): { status: QuestItemStatus | 'climax' | null; text: string } {
  const trimmed = line.replace(/^[ \t]+/, '');
  if (/^☑/.test(trimmed)) return { status: 'done', text: softTrim(trimmed.replace(/^☑\s*/, '')) };
  if (/^▶/.test(trimmed)) return { status: 'active', text: softTrim(trimmed.replace(/^▶\s*/, '')) };
  if (/^☐/.test(trimmed)) return { status: 'todo', text: softTrim(trimmed.replace(/^☐\s*/, '')) };
  if (/^📅/.test(trimmed)) return { status: 'climax', text: softTrim(trimmed.replace(/^📅\s*/, '')) };
  return { status: null, text: softTrim(trimmed) };
}

/** 解析单个 <quest_log> 内文；无标题则返回 null */
export function parseQuestLog(inner: string): QuestLog | null {
  const text = softTrim(String(inner ?? ''));
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  let kind = '';
  let title = '';
  let summary = '';
  let climax = '';
  const items: QuestItem[] = [];
  let lastTop: QuestItem | null = null;
  let lastTopIndent = 0;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    if (!kind && !title) {
      const head = rawLine.trim().match(/^【([^】]+)】\s*(.*)$/);
      if (head) {
        kind = softTrim(head[1] ?? '');
        title = softTrim(head[2] ?? '');
        continue;
      }
    }

    const summaryMatch = rawLine.match(/^\s*任务简述\s*[:：]\s*(.*)$/i);
    if (summaryMatch) {
      summary = softTrim(summaryMatch[1] ?? '');
      continue;
    }

    const indent = leadingIndent(rawLine);
    const { status, text: itemText } = stripQuestMarker(rawLine);
    if (!status || !itemText) continue;

    if (status === 'climax') {
      climax = itemText;
      continue;
    }

    const node: QuestItem = { status, text: itemText, children: [] };
    if (lastTop && status === 'todo' && indent > lastTopIndent) {
      lastTop.children.push(node);
      continue;
    }

    items.push(node);
    lastTop = node;
    lastTopIndent = indent;
  }

  if (!kind && !title) return null;
  return { kind, title, summary, items, climax };
}

/** 解析 <quest_archive> 内文；最多 5 条 */
export function parseQuestArchive(inner: string): QuestArchiveEntry[] {
  const text = softTrim(String(inner ?? ''));
  if (!text) return [];

  const entries: QuestArchiveEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^【([^】]+)】\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
    if (!m) continue;
    entries.push({
      kind: softTrim(m[1] ?? ''),
      title: softTrim(m[2] ?? ''),
      completedAt: softTrim(m[3] ?? ''),
      ending: softTrim(m[4] ?? ''),
    });
    if (entries.length >= 5) break;
  }
  return entries;
}

function emptyNpc(name: string): NpcCard {
  return {
    name,
    actionChain: [],
    predict: '',
    debutReady: false,
    statusParts: [],
    wealth: '',
    reputation: [],
    socialIdentity: [],
    socialNetwork: [],
    companions: [],
    background: emptyBackground(),
    lifeArchive: emptyLifeArchive(),
    longGoal: '',
    nearPlan: [],
    recentMemories: [],
    settledMemories: [],
    coreMemories: [],
    questLogs: [],
    questArchive: [],
    empty: true,
  };
}

function hasLifeArchive(life: NpcLifeArchive): boolean {
  return !!(life.birthday || life.race || life.age || life.remainingLife);
}

/** 解析单个 npc 内文（可含或不含外层 <npc> 标签） */
export function parseNpcBlock(text: string, fallbackName = ''): NpcCard {
  const raw = stripComments(String(text ?? ''));
  const npc = emptyNpc(fallbackName);
  npc.empty = false;

  const wrapped = findAllPairs(raw, 'npc');
  let body = raw;
  if (wrapped.length) {
    const hit = wrapped[0]!;
    const act = hit.attrs.act?.trim() || fallbackName;
    npc.name = act;
    body = hit.inner;
  } else {
    const nameMatch = raw.match(/<npc\s+act\s*=\s*["']?([^"'>]+)["']?\s*>/i);
    if (nameMatch) npc.name = softTrim(nameMatch[1] ?? '');
    else if (fallbackName) npc.name = fallbackName;
  }

  const chainRaw = fieldLine(body, '行为链');
  if (chainRaw) {
    const predictSplit = chainRaw.split(/→\s*后续预测\s*[:：]\s*/i);
    if (predictSplit.length >= 2) {
      const actionsPart = predictSplit[0] ?? '';
      const predictPart = predictSplit.slice(1).join('后续预测:');
      npc.debutReady = /(?:\*\*)?\[准备登场\](?:\*\*)?/i.test(predictPart);
      npc.predict = softTrim(predictPart.replace(/(?:\*\*)?\[准备登场\](?:\*\*)?/gi, ''));
      npc.actionChain = actionsPart
        .split(/→/)
        .map(s => softTrim(s))
        .filter(Boolean);
    } else {
      npc.actionChain = chainRaw
        .split(/→/)
        .map(s => softTrim(s))
        .filter(Boolean);
    }
  }

  const statusRaw = fieldLine(body, '当前状态');
  if (statusRaw) npc.statusParts = splitPipe(statusRaw);

  npc.lifeArchive = parseLifeArchive(fieldLine(body, '生命档案'));
  npc.wealth = fieldLine(body, '资金状况');
  npc.reputation = parseReputation(fieldLine(body, '声誉'));
  npc.socialIdentity = fieldLine(body, '社会身份')
    .split(/[;；]+/)
    .map(s => softTrim(s))
    .filter(Boolean);
  npc.socialNetwork = parseGroupedPeople(fieldLine(body, '社交网络'));
  npc.companions = parseGroupedPeople(fieldLine(body, '身边人物'));
  npc.background = parseBackground(fieldLine(body, '背景关联'));
  npc.longGoal = fieldLine(body, '长期目标');

  const planRaw = fieldLine(body, '近期打算');
  if (planRaw) npc.nearPlan = splitPipe(planRaw);

  const recent = fieldLine(body, '近期记忆');
  if (recent) npc.recentMemories = splitMemories(recent);
  const settled = fieldLine(body, '沉淀记忆');
  if (settled) npc.settledMemories = splitMemories(settled);
  const core = fieldLine(body, '核心记忆');
  if (core) npc.coreMemories = splitMemories(core);

  const questLogs: QuestLog[] = [];
  for (const hit of findAllPairs(body, 'quest_log')) {
    const log = parseQuestLog(hit.inner);
    if (log) questLogs.push(log);
  }
  npc.questLogs = questLogs;

  const archiveHits = findAllPairs(body, 'quest_archive');
  if (archiveHits.length) {
    npc.questArchive = parseQuestArchive(archiveHits[archiveHits.length - 1]!.inner);
  }

  if (!npc.name) npc.name = fallbackName;
  const hasBg =
    !!npc.background.group || !!npc.background.circle || !!npc.background.event;
  const hasQuest = npc.questLogs.length > 0 || npc.questArchive.length > 0;
  if (
    !npc.name &&
    !npc.actionChain.length &&
    !npc.wealth &&
    !npc.longGoal &&
    !npc.reputation.length &&
    !npc.socialNetwork.length &&
    !npc.companions.length &&
    !hasLifeArchive(npc.lifeArchive) &&
    !hasBg &&
    !hasQuest
  ) {
    npc.empty = true;
  }
  return npc;
}

/** 拆分角色列表字符串（逗号/顿号等） */
export function splitNameList(raw: string): string[] {
  return String(raw ?? '')
    .split(/[,，、;；|/]+/)
    .map(s => softTrim(s))
    .filter(Boolean);
}

/**
 * 从 <后台角色交互预演> 仅抽取 <交互> 列表（可含或不含外层标签）。
 * 不再解析角色集与起止时间。
 */
export function parseInteractions(text: string): InteractionEvent[] {
  const raw = stripComments(String(text ?? ''));
  if (!raw.trim()) return [];

  let body = raw;
  const root = findAllPairs(raw, '后台角色交互预演');
  if (root.length) body = root[0]!.inner;

  const out: InteractionEvent[] = [];
  for (const hit of findAllPairs(body, '交互')) {
    const id = softTrim(hit.attrs['编号'] ?? hit.attrs.id ?? '');
    const roles = splitNameList(hit.attrs['角色'] ?? hit.attrs.roles ?? '');
    const summary = fieldLine(hit.inner, '简述');
    const resultLine = fieldLine(hit.inner, '结果');
    if (!id && !roles.length && !summary && !resultLine) continue;
    out.push({
      id: id || `E${String(out.length + 1).padStart(3, '0')}`,
      roles,
      summary,
      result: resultLine,
    });
  }
  return out;
}

export function getWealthClass(wealth: string): WealthClass {
  const w = String(wealth ?? '');
  if (/一贫如洗|赤贫|destitute/i.test(w)) return 'wealth-destitute';
  if (/勉强糊口|贫困|poor/i.test(w)) return 'wealth-poor';
  if (/手头拮据|拮据|tight/i.test(w)) return 'wealth-tight';
  if (/收支平衡|平衡|balanced/i.test(w)) return 'wealth-balanced';
  if (/略有盈余|盈余|comfortable/i.test(w)) return 'wealth-comfortable';
  if (/手头宽裕|宽裕|well.?off/i.test(w)) return 'wealth-welloff';
  if (/富甲天下|tycoon|magnate/i.test(w)) return 'wealth-tycoon';
  if (/富足有余|富裕|rich|wealthy/i.test(w)) return 'wealth-rich';
  return 'wealth-balanced';
}

export function getWealthEmoji(wealth: string): string {
  const cls = getWealthClass(wealth);
  const map: Record<WealthClass, string> = {
    'wealth-destitute': '💀',
    'wealth-poor': '🪙',
    'wealth-tight': '💰',
    'wealth-balanced': '💵',
    'wealth-comfortable': '💎',
    'wealth-welloff': '🏦',
    'wealth-rich': '🏰',
    'wealth-tycoon': '👑',
  };
  return map[cls];
}

export function getReputationClass(value: string): ReputationClass {
  const v = String(value ?? '');
  if (/天怒人怨/.test(v)) return 'rep-hated';
  if (/声名狼藉/.test(v)) return 'rep-infamous';
  if (/默默无闻/.test(v)) return 'rep-obscure';
  if (/小有名气/.test(v)) return 'rep-known';
  if (/受人尊敬/.test(v)) return 'rep-respected';
  if (/万众敬仰/.test(v)) return 'rep-revered';
  return 'rep-default';
}

/**
 * 按前台/后台名单归类 NPC。同名只出现一次，优先前台。
 * 名单有名但无行动数据时仍出空卡。
 */
export function buildChronicle(
  input: ChronicleBuildInput,
  npcByName: Record<string, NpcCard | string>,
): ChronicleData {
  const used = new Set<string>();

  function resolveCard(name: string): NpcCard {
    const raw = npcByName[name];
    if (raw == null) return emptyNpc(name);
    if (typeof raw === 'string') {
      const card = parseNpcBlock(raw, name);
      if (!card.name) card.name = name;
      return card;
    }
    return { ...raw, name: raw.name || name };
  }

  function buildSection(key: NpcCategoryKey, names: string[]): CategorySection {
    const meta = CATEGORY_META[key];
    const uniqueNames: string[] = [];
    for (const n of names) {
      if (!n || used.has(n)) continue;
      used.add(n);
      uniqueNames.push(n);
    }
    return {
      key,
      typeLabel: meta.typeLabel,
      badge: meta.badge,
      icon: meta.icon,
      names: uniqueNames,
      npcs: uniqueNames.map(resolveCard),
    };
  }

  return {
    sections: [
      buildSection('front', input.frontNames),
      buildSection('back', input.backNames),
    ],
    interactions: input.interactions ?? [],
  };
}

export function isChronicleEmpty(data: ChronicleData | null | undefined): boolean {
  if (!data) return true;
  const hasNpcs = data.sections.some(s => s.npcs.length > 0);
  const hasIx = data.interactions.length > 0;
  return !hasNpcs && !hasIx;
}
