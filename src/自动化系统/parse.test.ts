import assert from 'node:assert/strict';
import {
  buildChronicle,
  getReputationClass,
  getWealthClass,
  isChronicleEmpty,
  parseAttrs,
  parseInteractions,
  parseNpcBlock,
  parseQuestArchive,
  parseQuestLog,
  splitMemories,
  splitNameList,
} from './parse';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('parseAttrs supports Chinese attr names', () => {
  const attrs = parseAttrs('<交互 编号="E01" 角色="甲,乙" />');
  assert.equal(attrs['编号'], 'E01');
  assert.equal(attrs['角色'], '甲,乙');
});

test('splitNameList handles comma and顿号', () => {
  assert.deepEqual(splitNameList('甲,乙、丙；丁'), ['甲', '乙', '丙', '丁']);
});

test('splitMemories supports semicolon and numbered run-on', () => {
  assert.deepEqual(splitMemories('1.昨夜见黑影;2.收到密信'), ['昨夜见黑影', '收到密信']);
  assert.deepEqual(
    splitMemories(
      '1.今晚在怒涛海峡确认了袭击路径。2.亚瑟要求三日内提交评估。3.处理了两份紧急公文。',
    ),
    ['今晚在怒涛海峡确认了袭击路径。', '亚瑟要求三日内提交评估。', '处理了两份紧急公文。'],
  );
  assert.deepEqual(splitMemories('1、二十岁继承商会；2、父亲临终托付金狮印'), [
    '二十岁继承商会',
    '父亲临终托付金狮印',
  ]);
  assert.deepEqual(splitMemories('只有一条无序号记忆'), ['只有一条无序号记忆']);
});

test('parseNpcBlock new format with file/dynamic fields', () => {
  const block = `<npc act="李明">
<file>
最后更新时间: 大明-1520年-3月-1日-周一-08:00
生命档案: [生日]大明-1490年-1月-1日|[种族]人族|[年龄]30岁(青年)|[剩余寿命]50年
资金状况: 手头宽裕
声誉: [官方]小有名气|[民间]受人尊敬
社会身份: 巡城司百户;城西商会理事
社交网络: [职场]王芳(同僚/互助);赵铁(上司/敬畏)|[恩怨]周监(宿怨/对峙)
背景关联: [团体]巡城司|[社交圈]城西巷邻里|[事件]走私案
</file>
<dynamic>
行为链: 巡街→查账→后续预测: 明日回府 **[准备登场]**
当前状态: 行走|青衫|盘问路人|大明京城|城西巷|细雨巷口
身边人物: [同行]王芳(探路/警惕)|[随从]小厮二人(提灯/待命)
长期目标: 光复家业
近期打算: 调查走私|暗访|2026年7月1日8时—2026年7月3日18时
近期记忆: 1.昨夜见黑影;2.收到密信
沉淀记忆: 1.三年前出走
核心记忆: 1.父亲托付玉佩
</dynamic>
</npc>`;
  const npc = parseNpcBlock(block);
  assert.equal(npc.name, '李明');
  assert.deepEqual(npc.actionChain, ['巡街', '查账']);
  assert.equal(npc.predict, '明日回府');
  assert.equal(npc.debutReady, true);
  assert.deepEqual(npc.statusParts, ['行走', '青衫', '盘问路人', '大明京城', '城西巷', '细雨巷口']);
  assert.equal(npc.lifeArchive.birthday, '大明-1490年-1月-1日');
  assert.equal(npc.lifeArchive.race, '人族');
  assert.equal(npc.lifeArchive.age, '30岁(青年)');
  assert.equal(npc.lifeArchive.remainingLife, '50年');
  assert.equal(npc.wealth, '手头宽裕');
  assert.deepEqual(npc.socialIdentity, ['巡城司百户', '城西商会理事']);
  assert.equal(npc.longGoal, '光复家业');
  assert.equal(npc.nearPlan.length, 3);
  assert.equal(npc.background.event, '走私案');
  assert.equal(npc.socialNetwork.length, 2);
  assert.equal(npc.socialNetwork[0]!.category, '职场');
  assert.equal(npc.socialNetwork[0]!.people.length, 2);
  assert.equal(npc.socialNetwork[0]!.people[0]!.name, '王芳');
  assert.equal(npc.socialNetwork[1]!.category, '恩怨');
  assert.equal(npc.companions.length, 2);
  assert.equal(npc.companions[0]!.category, '同行');
  assert.equal(npc.companions[0]!.people[0]!.name, '王芳');
  assert.equal(npc.companions[1]!.category, '随从');
  assert.deepEqual(npc.recentMemories, ['昨夜见黑影', '收到密信']);
  assert.deepEqual(npc.settledMemories, ['三年前出走']);
  assert.deepEqual(npc.coreMemories, ['父亲托付玉佩']);
  assert.deepEqual(npc.questLogs, []);
  assert.deepEqual(npc.questArchive, []);
  assert.equal(npc.empty, false);
});

test('parseNpcBlock reputation social background companions', () => {
  const block = `<npc act="佐久夜">
行为链: 观测→锁定→后续预测: 继续巡狩
当前状态: 甩干水迹|黑大衣|清洗手帕|索伦蒂斯|黑水巷|雨雾
资金状况: 略有盈余
声誉: [官方]声名狼藉|[民间]天怒人怨|[暗域]小有名气|[业界]声名狼藉
社会身份: 流浪血族猎手
社交网络: [恩怨]已故血族主人(仇恨/已终结);黑衣人(警惕/未明)|[邻里]黑水巷酒鬼(厌恶/潜在猎物)|[职场]女仆公会(无视/潜在关联)
身边人物: [集群]雾中黑影数人(围观/疏远)
背景关联: [团体]无|[社交圈]索伦蒂斯深夜游荡者|[事件]无
长期目标: 寻找到一位完美主人
近期打算: 清理不洁根源|猎杀行动|复兴纪元488年4月15日23:30—4月16日03:00
近期记忆: 1.黑水巷的雨幕;2.今晚的雾气太重
沉淀记忆: 1.上周处理掉的混混
核心记忆: 1.血族主人的头颅;2.月都怀表;3.母亲死去时的臭味
</npc>`;
  const npc = parseNpcBlock(block);
  assert.equal(npc.name, '佐久夜');
  assert.deepEqual(npc.socialIdentity, ['流浪血族猎手']);
  assert.equal(npc.reputation.length, 4);
  assert.deepEqual(npc.reputation[0], { label: '官方', value: '声名狼藉' });
  assert.deepEqual(npc.reputation[2], { label: '暗域', value: '小有名气' });
  assert.equal(npc.socialNetwork.length, 3);
  assert.equal(npc.socialNetwork[0]!.category, '恩怨');
  assert.equal(npc.socialNetwork[0]!.people.length, 2);
  assert.equal(npc.socialNetwork[0]!.people[0]!.name, '已故血族主人');
  assert.equal(npc.socialNetwork[0]!.people[1]!.name, '黑衣人');
  assert.equal(npc.socialNetwork[1]!.category, '邻里');
  assert.equal(npc.socialNetwork[2]!.category, '职场');
  assert.equal(npc.companions[0]!.category, '集群');
  assert.equal(npc.background.group, '无');
  assert.equal(npc.background.circle, '索伦蒂斯深夜游荡者');
  assert.equal(npc.background.event, '无');
  assert.equal(npc.coreMemories.length, 3);
  assert.equal(npc.wealth, '略有盈余');
});

test('parseNpcBlock accepts inner-only text with fallback name', () => {
  const npc = parseNpcBlock(
    `行为链: A→B
资金状况: 一贫如洗`,
    '王芳',
  );
  assert.equal(npc.name, '王芳');
  assert.deepEqual(npc.actionChain, ['A', 'B']);
  assert.equal(getWealthClass(npc.wealth), 'wealth-destitute');
  assert.deepEqual(npc.reputation, []);
  assert.deepEqual(npc.socialNetwork, []);
  assert.deepEqual(npc.companions, []);
});

test('getWealthClass includes 富甲天下', () => {
  assert.equal(getWealthClass('富甲天下'), 'wealth-tycoon');
  assert.equal(getWealthClass('富足有余'), 'wealth-rich');
});

test('getReputationClass maps six reputation tiers', () => {
  assert.equal(getReputationClass('天怒人怨'), 'rep-hated');
  assert.equal(getReputationClass('声名狼藉'), 'rep-infamous');
  assert.equal(getReputationClass('默默无闻'), 'rep-obscure');
  assert.equal(getReputationClass('小有名气'), 'rep-known');
  assert.equal(getReputationClass('受人尊敬'), 'rep-respected');
  assert.equal(getReputationClass('万众敬仰'), 'rep-revered');
  assert.equal(getReputationClass('其它'), 'rep-default');
});

test('parseInteractions extracts only interaction events', () => {
  const xml = `<后台角色交互预演>
  <后台角色行动时间段>
    <起始时间 time="大明-1520年-3月-1日-周一-08:00" />
    <结束时间 time="大明-1520年-3月-1日-周一-18:00" />
  </后台角色行动时间段>
  <角色集 类型="不在场关系列表角色" 列表="李明,王芳" />
  <交互 编号="E01" 角色="李明,王芳">
简述: 街头偶遇
结果: 交换情报
  </交互>
</后台角色交互预演>`;
  const interactions = parseInteractions(xml);
  assert.equal(interactions.length, 1);
  assert.equal(interactions[0]!.id, 'E01');
  assert.deepEqual(interactions[0]!.roles, ['李明', '王芳']);
  assert.equal(interactions[0]!.summary, '街头偶遇');
  assert.equal(interactions[0]!.result, '交换情报');
});

test('buildChronicle prefers front over back for same name', () => {
  const chronicle = buildChronicle(
    {
      frontNames: ['李明'],
      backNames: ['李明', '赵铁'],
      interactions: [{ id: 'E01', roles: ['李明'], summary: '偶遇', result: '点头' }],
    },
    {
      李明: `行为链: 巡街→查账
资金状况: 略有盈余`,
      赵铁: `行为链: X`,
    },
  );
  const front = chronicle.sections.find(s => s.key === 'front')!;
  const back = chronicle.sections.find(s => s.key === 'back')!;
  assert.equal(front.npcs.length, 1);
  assert.equal(front.npcs[0]!.name, '李明');
  assert.equal(back.npcs.length, 1);
  assert.equal(back.npcs[0]!.name, '赵铁');
  assert.equal(chronicle.interactions.length, 1);
  assert.equal(isChronicleEmpty(chronicle), false);
});

test('buildChronicle empty names still yield empty card when listed', () => {
  const chronicle = buildChronicle(
    { frontNames: ['幽灵'], backNames: [], interactions: [] },
    {},
  );
  assert.equal(chronicle.sections[0]!.npcs[0]!.name, '幽灵');
  assert.equal(chronicle.sections[0]!.npcs[0]!.empty, true);
});

test('parseQuestLog parses items children and climax', () => {
  const log = parseQuestLog(`【支线】药材调拨
  任务简述:协调炼金公会补缺口
  ☑ 提交隔离方案
  ▶ 催促药剂出库
  ☐ 分发至西境营地
    ☐ 核对名册
    ☐ 押运护卫
  📅 营区交接完成`);
  assert.ok(log);
  assert.equal(log!.kind, '支线');
  assert.equal(log!.title, '药材调拨');
  assert.equal(log!.summary, '协调炼金公会补缺口');
  assert.equal(log!.items.length, 3);
  assert.equal(log!.items[0]!.status, 'done');
  assert.equal(log!.items[1]!.status, 'active');
  assert.equal(log!.items[2]!.status, 'todo');
  assert.equal(log!.items[2]!.children.length, 2);
  assert.equal(log!.items[2]!.children[0]!.text, '核对名册');
  assert.equal(log!.climax, '营区交接完成');
});

test('parseQuestLog empty or headless returns null', () => {
  assert.equal(parseQuestLog(''), null);
  assert.equal(parseQuestLog('  ☑ 只有条目无标题  '), null);
});

test('parseQuestArchive keeps at most five entries', () => {
  const lines = Array.from({ length: 6 }, (_, i) => `【主线】任务${i + 1} | D${i + 1} | 结局${i + 1}`).join(
    '\n',
  );
  const entries = parseQuestArchive(lines);
  assert.equal(entries.length, 5);
  assert.equal(entries[0]!.title, '任务1');
  assert.equal(entries[4]!.title, '任务5');
});

test('parseNpcBlock optional quest_log and quest_archive', () => {
  const block = `<npc act="菲莉亚娜">
行为链: 审阅卷宗→回信→后续预测: 晨祷前小憩
近期打算: 流民安置|协调药剂|复兴纪元488年4月15日23:30—4月16日01:30
<quest>
<quest_log>
【委托】夜巡补给
  任务简述:为哨所送灯油
  ☑ 领取灯油
  ▶ 送往北哨
</quest_log>
<quest_log>
【角色线】给多米娜回信
  任务简述:写完近三千字长信
  ▶ 润色收尾
  ☐ 交驿使
    ☐ 附润肺膏
  📅 驿站发信
</quest_log>
<quest_archive>
【支线】旧日巡诊 | 复兴纪元488年3月 | 贫民窟疫病暂缓
【主线】圣堂扩建募捐 | 复兴纪元488年2月 | 款项到位开工
</quest_archive>
</quest>
</npc>`;
  const npc = parseNpcBlock(block);
  assert.equal(npc.questLogs.length, 2);
  assert.equal(npc.questLogs[0]!.kind, '委托');
  assert.equal(npc.questLogs[0]!.title, '夜巡补给');
  assert.equal(npc.questLogs[1]!.kind, '角色线');
  assert.equal(npc.questLogs[1]!.items[1]!.children[0]!.text, '附润肺膏');
  assert.equal(npc.questLogs[1]!.climax, '驿站发信');
  assert.equal(npc.questArchive.length, 2);
  assert.equal(npc.questArchive[0]!.kind, '支线');
  assert.equal(npc.questArchive[0]!.title, '旧日巡诊');
  assert.equal(npc.questArchive[1]!.ending, '款项到位开工');
});

test('parseNpcBlock empty quest_log tag yields no logs', () => {
  const npc = parseNpcBlock(`<npc act="甲">
行为链: A→B
<quest_log></quest_log>
</npc>`);
  assert.deepEqual(npc.questLogs, []);
  assert.deepEqual(npc.questArchive, []);
});

test('parseNpcBlock uses last quest_archive block only', () => {
  const npc = parseNpcBlock(`<npc act="乙">
行为链: A
<quest_archive>
【支线】旧 | D1 | 旧结局
</quest_archive>
<quest_archive>
【主线】新 | D2 | 新结局
【角色线】另一 | D3 | 另一结局
</quest_archive>
</npc>`);
  assert.equal(npc.questArchive.length, 2);
  assert.equal(npc.questArchive[0]!.title, '新');
  assert.equal(npc.questArchive[1]!.title, '另一');
});
