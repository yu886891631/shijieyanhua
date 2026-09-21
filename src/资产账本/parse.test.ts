import assert from 'node:assert/strict';
import {
  findAllPairs,
  parseAttrs,
  parseCashBaseTotal,
  parseCashMetrics,
  parseLedger,
  parseLedgerBody,
  parseProductionSplit,
  parseProgressPct,
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
  const attrs = parseAttrs('<收入 合计金额="120" 周期="月">');
  assert.equal(attrs['合计金额'], '120');
  assert.equal(attrs['周期'], '月');
});

test('parseAttrs supports total attr', () => {
  const attrs = parseAttrs('<收入 total="50" 周期="周">');
  assert.equal(attrs.total, '50');
});

test('parse warehouse and facilities tags', () => {
  const withEnt = parseLedgerBody(
    '<实体 name="商栈"><仓库><物资 name="粮" unit="袋" quality="普通">期初10</物资></仓库><基建><设施 type="锯木房" count="2" quality="良" /></基建></实体>',
  );
  assert.equal(withEnt.entities[0]?.materials[0]?.attrs.name, '粮');
  assert.equal(withEnt.entities[0]?.materials[0]?.attrs.unit, '袋');
  assert.equal(withEnt.entities[0]?.materials[0]?.attrs.quality, '普通');
  assert.equal(withEnt.entities[0]?.facilities[0]?.attrs.type, '锯木房');
  assert.equal(withEnt.entities[0]?.facilities[0]?.attrs.quality, '良');
  assert.equal(withEnt.entities[0]?.facilities[0]?.text, '');
});

test('parse entity nextFixedSettle attr', () => {
  const body = parseLedgerBody(
    '<实体 name="北岸工坊" location="北岸码头" nextFixedSettle="复兴纪元488年6月10日"><基建></基建></实体>',
  );
  const ent = body.entities[0];
  assert.equal(ent?.name, '北岸工坊');
  assert.equal(ent?.location, '北岸码头');
  assert.equal(ent?.nextFixedSettle, '复兴纪元488年6月10日');
});

test('parse facility paired tag with description', () => {
  const body = parseLedgerBody(
    '<实体 name="商栈"><基建><设施 type="锯木房" count="2" quality="良" status="Normal" maintain="3银/周" baseIncome="5银/周">北岸码头旁双联木工棚，专司原木剖板</设施></基建></实体>',
  );
  const f = body.entities[0]?.facilities[0];
  assert.equal(f?.attrs.type, '锯木房');
  assert.equal(f?.attrs.count, '2');
  assert.equal(f?.attrs.maintain, '3银/周');
  assert.equal(f?.attrs.baseIncome, '5银/周');
  assert.equal(f?.text, '北岸码头旁双联木工棚，专司原木剖板');
});

test('parseLedger combines LedgerTime + body (new template)', () => {
  const data = parseLedger(
    '[账目结算时间]: 第三纪元120年3月5日08:00\n门禁：通过',
    `
<本期结算>
  历时: 24h
  损益: 盈利 (Δ +320 银盾)
</本期结算>
<外因>
  <季节 name="初春">初春回暖 | 影响:谷物 ×1.1 | 供需:Loose</季节>
</外因>
<产业流动资金 note="多币种">
  <币种 code="A" symbol="§">
    期初100 +流入20 -流出5 ±重估0 =期末115
    (Δ +15 | 原因:售货)
  </币种>
  <折合基准>
    ∑(期末货币 × 汇率) = 115 §
    (Δ +15) → 存放:北商行账户
  </折合基准>
</产业流动资金>
<实体 name="北岸工坊" location="北岸码头">
  <基建>
    <设施 type="锯木房" count="2" quality="良" status="Normal" maintain="3银/周" />
  </基建>
  <仓库>
    <物资 name="原木" unit="根" quality="普通">
      期初20 +流入5(来源:采购) +自然增0 -流出8(去向:产线) -损耗1 -自然减0 =期末16 (Δ -4)
    </物资>
    <装备 name="锯子" unit="把" quality="良">
      期初4 +新增0 -报废0 -调出0 =期末4
      (完好:90% | 折损:10%)
    </装备>
  </仓库>
  <人员 total="12">
    <职级 role="工匠" count="8" level="熟练"
      cost="2银/周" costType="薪饷"
      变动="0" status="满编" />
  </人员>
</实体>
<经营 name="北岸工坊" 周期="周">
  <订单>
    <履约 order="木板-北商行" party="北商行" item="木板" qty="10" unit="张" quality="良"
      amount="+50" status="已结清">
      单价:5 × 数量:10 = 50 | 交期:本周 | 出库:仓库 | 波动:无
    </履约>
    <在途 order="木箱-南栈" party="南栈" item="木箱" qty="4" unit="只"
      amount="40" status="生产中">
      已交:1/4 | 欠交:3 | 预计结清:下旬
    </在途>
  </订单>
  <收入 total="50" 周期="周">
    <条目 name="木板" amount="+50" order="木板-北商行">单价:5 × 数量:10 | 对方:北商行</条目>
  </收入>
  <支出 total="20" 周期="周">
    <条目 name="薪饷" amount="-20" type="薪饷">计算:10×2</条目>
  </支出>
  <产能>
    <产线 production="锯木" count="2" run="Full">
      投入: 原木 8根/周
      产出: 木板 10张/周
      品质: 良 | 损耗:5% | 瓶颈:人力
      承接:木板-北商行,木箱-南栈
    </产线>
  </产能>
  <闭环校验 result="Pass">期初 +收入 -支出 =期末</闭环校验>
  <净值>+30 银盾/周</净值>
</经营>
<运营 name="北岸工坊">
  <主管 name="老刘">重点:扩仓 | 风险:汛期</主管>
  <项目 name="扩仓" progress="60%">阶段:砌墙</项目>
</运营>
`,
  );

  assert.match(data.ledgerTime.timeLine, /账目结算时间/);
  assert.equal(data.headline.status, '盈利');
  assert.match(data.headline.delta, /\+320/);
  assert.equal(data.externalFactors[0]?.attrs._tag, '季节');
  assert.equal(data.currencies[0]?.symbol, '§');
  assert.match(data.currencies[0]?.text ?? '', /±重估/);
  assert.match(data.currencies[0]?.text ?? '', /原因:售货/);
  assert.equal(data.cashTotal, '115 §');
  assert.equal(data.entities[0]?.name, '北岸工坊');
  assert.equal(data.entities[0]?.location, '北岸码头');
  assert.equal(data.entities[0]?.facilities[0]?.attrs.type, '锯木房');
  assert.equal(data.entities[0]?.facilities[0]?.attrs.quality, '良');
  assert.equal(data.entities[0]?.materials[0]?.attrs.unit, '根');
  assert.equal(data.entities[0]?.equipments[0]?.attrs.quality, '良');
  assert.equal(data.businesses[0]?.period, '周');
  assert.equal(data.businesses[0]?.revenueTotal, '50');
  assert.equal(data.businesses[0]?.expenseTotal, '20');
  assert.equal(data.businesses[0]?.revenueItems[0]?.attrs.name, '木板');
  assert.equal(data.businesses[0]?.revenueItems[0]?.attrs.order, '木板-北商行');
  assert.equal(data.businesses[0]?.lines[0]?.attrs.production, '锯木');
  assert.equal(data.businesses[0]?.lines[0]?.attrs.run, 'Full');
  assert.equal(data.businesses[0]?.fulfilledOrders[0]?.attrs.order, '木板-北商行');
  assert.equal(data.businesses[0]?.fulfilledOrders[0]?.attrs.item, '木板');
  assert.equal(data.businesses[0]?.fulfilledOrders[0]?.attrs.amount, '+50');
  assert.match(data.businesses[0]?.fulfilledOrders[0]?.text ?? '', /单价:5/);
  assert.equal(data.businesses[0]?.pendingOrders[0]?.attrs.order, '木箱-南栈');
  assert.equal(data.businesses[0]?.pendingOrders[0]?.attrs.status, '生产中');
  assert.match(data.businesses[0]?.pendingOrders[0]?.text ?? '', /欠交:3/);
  assert.equal(data.operations[0]?.managerName, '老刘');
  assert.match(data.operations[0]?.manager ?? '', /重点:扩仓/);
  assert.equal(data.operations[0]?.projects[0]?.attrs.progress, '60%');
});

test('legacy 基础设施 / building still parse', () => {
  const body = parseLedgerBody(`
<实体 name="旧坊">
  <基础设施>
    <设施 type="织机房" count="1" status="Normal" />
  </基础设施>
</实体>
<经营 name="旧坊">
  <产能>
    <产线 building="织布" count="1" run="Idle">停工因由:缺纱</产线>
  </产能>
</经营>
`);
  assert.equal(body.entities[0]?.facilities[0]?.attrs.type, '织机房');
  assert.equal(body.businesses[0]?.lines[0]?.attrs.building, '织布');
  assert.match(body.businesses[0]?.lines[0]?.text ?? '', /缺纱/);
});

test('legacy short tags 流动资金 still parse; 可交付 ignored', () => {
  const body = parseLedgerBody(`
<流动资金>
  <币种 code="B" symbol="¤">期初10 +流入0 -流出0 =期末10</币种>
  <折合基准>∑(期末货币 × 汇率) = 10 ¤</折合基准>
</流动资金>
<经营 name="旧坊">
  <可交付>
    <品项 name="布" qty="2" unit="匹" per="周" />
  </可交付>
</经营>
`);
  assert.equal(body.currencies[0]?.code, 'B');
  assert.equal(body.cashTotal, '10 ¤');
  assert.equal(body.businesses[0]?.fulfilledOrders.length, 0);
  assert.equal(body.businesses[0]?.pendingOrders.length, 0);
});

test('parse orders fulfilled and pending', () => {
  const body = parseLedgerBody(`
<经营 name="商栈" 周期="旬">
  <订单>
    <履约 order="O1" party="甲" item="粮" qty="5" unit="袋" amount="+20" status="已结清">
      单价:4 × 数量:5 = 20
    </履约>
    <在途 order="O2" party="乙" item="盐" qty="2" unit="袋" amount="8" status="待发">
      已交:0/2 | 欠交:2 | 预计结清:下旬
    </在途>
  </订单>
  <收入 total="20" 周期="旬">
    <条目 name="粮" amount="+20" order="O1">对方:甲</条目>
  </收入>
</经营>
`);
  assert.equal(body.businesses[0]?.period, '旬');
  assert.equal(body.businesses[0]?.fulfilledOrders.length, 1);
  assert.equal(body.businesses[0]?.pendingOrders.length, 1);
  assert.equal(body.businesses[0]?.fulfilledOrders[0]?.attrs.party, '甲');
  assert.equal(body.businesses[0]?.pendingOrders[0]?.attrs.status, '待发');
  assert.equal(body.businesses[0]?.revenueItems[0]?.attrs.order, 'O1');
});

test('legacy 合计金额 and 执事 still parse', () => {
  const body = parseLedgerBody(`
<经营 name="旧坊">
  <收入 合计金额="50" 周期="周">
    <条目 name="木板" amount="+50">单价:5</条目>
  </收入>
  <支出 合计金额="20" 周期="周"></支出>
</经营>
<运营 name="旧坊">
  <执事>老刘 | 重点:扩仓 | 风险:汛期</执事>
</运营>
`);
  assert.equal(body.businesses[0]?.revenueTotal, '50');
  assert.equal(body.businesses[0]?.expenseTotal, '20');
  assert.equal(body.operations[0]?.managerName, '');
  assert.match(body.operations[0]?.manager ?? '', /老刘/);
});

test('revenueNote when no 条目', () => {
  const body = parseLedgerBody(`
<经营 name="停工坊">
  <收入 total="0" 周期="周">
    原因:本周停工无销售
  </收入>
</经营>
`);
  assert.equal(body.businesses[0]?.revenueTotal, '0');
  assert.equal(body.businesses[0]?.revenueItems.length, 0);
  assert.match(body.businesses[0]?.revenueNote ?? '', /原因:本周停工无销售/);
});

test('parse staff meta, roles and key persons', () => {
  const body = parseLedgerBody(`
<实体 name="北岸工坊" location="北岸码头">
  <人员 total="12" 在岗="11" note="1人外派押运">
    <职级 role="工匠" count="8" level="熟练"
      cost="2银/人/周" costType="薪饷"
      变动="0" status="满编" />
    <核心人物 name="老刘" role="主管" level="老练" loyalty="高"
      cost="5银/周" costType="薪饷" status="在岗" />
  </人员>
</实体>
`);
  const ent = body.entities[0];
  assert.equal(ent?.location, '北岸码头');
  assert.equal(ent?.staffTotal, '12');
  assert.equal(ent?.staffOnDuty, '11');
  assert.equal(ent?.staffDispatched, '');
  assert.equal(ent?.staffNote, '1人外派押运');
  assert.equal(ent?.roles[0]?.attrs.role, '工匠');
  assert.equal(ent?.roles[0]?.attrs.count, '8');
  assert.equal(ent?.roles[0]?.attrs.level, '熟练');
  assert.equal(ent?.roles[0]?.attrs.cost, '2银/人/周');
  assert.equal(ent?.roles[0]?.attrs.costType, '薪饷');
  assert.equal(ent?.roles[0]?.attrs['变动'], '0');
  assert.equal(ent?.roles[0]?.attrs.status, '满编');
  assert.equal(ent?.roles[0]?.children, undefined);
  assert.equal(ent?.keyPersons[0]?.attrs.name, '老刘');
  assert.equal(ent?.keyPersons[0]?.attrs.role, '主管');
  assert.equal(ent?.keyPersons[0]?.attrs.loyalty, '高');
  assert.equal(ent?.keyPersons[0]?.attrs.level, '老练');
  assert.equal(ent?.keyPersons[0]?.attrs.status, '在岗');
  assert.equal(ent?.keyPersons[0]?.text, '');
});

test('parse staff kit, dispatched count and top-level dispatches', () => {
  const body = parseLedgerBody(`
<实体 name="北岸商栈" location="北岸">
  <仓库>
    <物资 name="干粮" unit="人日" quality="普通">
      期初100 +流入0 -流出20 =期末80 (Δ-20)
      (配装占用:10 | 可用库存:70)
    </物资>
    <装备 name="制式矛" unit="柄" quality="普通">
      期初30 +新增0 -报废0 -调出20 =期末30
      (完好:100% | 折损:0 | 配装占用:20 | 可用库存:10)
    </装备>
  </仓库>
  <人员 total="20" 在岗="15" 外派="5" note="">
    <职级 role="护卫" count="12" level="精锐" status="满编">
      <配装>
        <装 kind="equip" name="制式矛" qty="12" unit="柄" quality="普通"
          bind="编制总数" from="仓库调出" />
        <装 kind="supply" name="干粮" qty="24" unit="人日" quality="普通"
          bind="人均" from="仓库调出" use="本期消耗" />
      </配装>
    </职级>
    <核心人物 name="阿强" role="押运长" status="外派" dispatch="D-01">
      <配装>
        <装 kind="equip" name="制式矛" qty="1" unit="柄" from="沿用编制" />
        <装 kind="supply" name="外伤药" qty="2" unit="份" from="仓库调出" use="携行占用" />
      </配装>
    </核心人物>
  </人员>
</实体>
<外派 id="D-01" name="北岸商栈"
  who="阿强 + 护卫×4" dest="东路驿站" mission="护送"
  since="3年2月1日" eta="3年2月5日" status="途中">
  <配装>
    <装 kind="equip" name="制式矛" qty="5" unit="柄" from="沿用编制" />
    <装 kind="supply" name="干粮" qty="20" unit="人日" from="仓库调出" use="本期消耗" />
  </配装>
  进展:按期推进 | 风险:低 | 费用口径:差旅
</外派>
`);
  const ent = body.entities[0];
  assert.equal(ent?.staffDispatched, '5');
  assert.equal(ent?.staffOnDuty, '15');
  assert.equal(ent?.materials[0]?.attrs.name, '干粮');
  assert.match(ent?.materials[0]?.text ?? '', /配装占用:10/);
  assert.match(ent?.equipments[0]?.text ?? '', /可用库存:10/);

  const role = ent?.roles[0];
  assert.equal(role?.attrs.role, '护卫');
  assert.equal(role?.children?.length, 2);
  assert.equal(role?.children?.[0]?.attrs.kind, 'equip');
  assert.equal(role?.children?.[0]?.attrs.name, '制式矛');
  assert.equal(role?.children?.[1]?.attrs.kind, 'supply');
  assert.equal(role?.children?.[1]?.attrs.use, '本期消耗');

  const kp = ent?.keyPersons[0];
  assert.equal(kp?.attrs.dispatch, 'D-01');
  assert.equal(kp?.attrs.status, '外派');
  assert.equal(kp?.children?.length, 2);
  assert.equal(kp?.children?.[1]?.attrs.name, '外伤药');

  assert.equal(body.dispatches.length, 1);
  const d = body.dispatches[0];
  assert.equal(d?.id, 'D-01');
  assert.equal(d?.name, '北岸商栈');
  assert.equal(d?.who, '阿强 + 护卫×4');
  assert.equal(d?.dest, '东路驿站');
  assert.equal(d?.mission, '护送');
  assert.equal(d?.status, '途中');
  assert.equal(d?.kit.length, 2);
  assert.equal(d?.kit[0]?.attrs.kind, 'equip');
  assert.equal(d?.kit[1]?.attrs.use, '本期消耗');
  assert.match(d?.text ?? '', /进展:按期推进/);
});

test('parse revenue type and recurring attrs', () => {
  const body = parseLedgerBody(`
<经营 name="商栈" 周期="周">
  <收入 total="30" 周期="周">
    <条目 name="铺租基线" amount="+20" type="租金" recurring="true">
      计算:10×2=20 | 来源:设施baseIncome | 波动:无
    </条目>
    <条目 name="木板加价" amount="+10" type="现货" order="O9">
      单价:1 × 数量:10 = 10 | 对方:北商行
    </条目>
  </收入>
  <支出 total="8" 周期="周">
    <条目 name="维护" amount="-8" type="维护" recurring="true">计算:4×2</条目>
  </支出>
</经营>
`);
  const rev = body.businesses[0]?.revenueItems ?? [];
  assert.equal(rev[0]?.attrs.type, '租金');
  assert.equal(rev[0]?.attrs.recurring, 'true');
  assert.equal(rev[1]?.attrs.type, '现货');
  assert.equal(rev[1]?.attrs.order, 'O9');
  assert.equal(body.businesses[0]?.expenseItems[0]?.attrs.recurring, 'true');
  assert.equal(body.businesses[0]?.expenseItems[0]?.attrs.type, '维护');
});

test('parseProductionSplit extracts sold/stock/self', () => {
  const split = parseProductionSplit(`
投入: 原木 8根/周
产出: 木板 10张/周
分流: 已售8→收入; 入库2→仓库; 自用0（已售+入库+自用=产出）
品质: 良 | 损耗:5% | 瓶颈:人力
`);
  assert.ok(split);
  assert.equal(split?.sold, '8');
  assert.equal(split?.stock, '2');
  assert.equal(split?.self, '0');

  const qty = parseProductionSplit('分流: 已售木板10张→收入; 入库0→仓库; 自用2张');
  assert.equal(qty?.sold, '木板10张');
  assert.equal(qty?.stock, '0');
  assert.equal(qty?.self, '2张');

  assert.equal(parseProductionSplit('投入: 原木\n产出: 木板'), null);
  assert.equal(parseProductionSplit('分流: 无明细'), null);
});

test('findAllPairs self-closing', () => {
  const hits = findAllPairs('<设施 type="A" count="1" />', '设施');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].attrs.type, 'A');
});

test('parseLedgerBody accepts Traditional Chinese tags and attrs', () => {
  const body = parseLedgerBody(`
<資產帳本>
  <本期結算>
    歷時: 24h
    損益: 盈利 (Δ +10 銀盾)
  </本期結算>
  <經營 name="霧晶學院-咸魚同好會" 週期="月">
    <收入 total="0" 週期="月" 合計金額="0">
      <條目 name="愛欲共鳴收益" amount="+0" type="偶發" recurring="false">
        原因:上週結算 | 來源:莉絲互動
      </條目>
    </收入>
    <支出 total="0" 週期="月">
      <條目 name="設施維護費" amount="-0" type="維護" recurring="true">
        計算:0×0=0
      </條目>
    </支出>
    <產能>
      <產線 production="魔晶石精煉" count="1" run="Idle">
        停工因由:历时不足1h
        分流: 已售0→收入; 入庫0→倉庫; 自用0
      </產線>
    </產能>
  </經營>
  <運營 name="霧晶學院-咸魚同好會">
    <主管 name="bAosi">重點:農村自產自銷 | 風險:低</主管>
    <項目 name="農村自產自銷" progress="40%">
      階段:筹备 | 投入:0 | 預計完工:下月
    </項目>
  </運營>
</資產帳本>
`);
  assert.equal(body.businesses.length, 1);
  const biz = body.businesses[0]!;
  assert.equal(biz.name, '雾晶学院-咸鱼同好会');
  assert.equal(biz.period, '月');
  assert.equal(biz.revenuePeriod, '月');
  assert.equal(biz.revenueItems.length, 1);
  assert.equal(biz.revenueItems[0]?.attrs.name, '爱欲共鸣收益');
  assert.equal(biz.expenseItems.length, 1);
  assert.equal(biz.expenseItems[0]?.attrs.name, '设施维护费');
  assert.equal(biz.lines.length, 1);
  assert.equal(biz.lines[0]?.attrs.production, '魔晶石精炼');
  const split = parseProductionSplit(biz.lines[0]!.text);
  assert.ok(split);
  assert.equal(split?.sold, '0');
  assert.equal(split?.stock, '0');
  assert.equal(body.operations.length, 1);
  assert.equal(body.operations[0]?.managerName, 'bAosi');
  assert.equal(body.operations[0]?.projects.length, 1);
  assert.equal(body.operations[0]?.projects[0]?.name, '农村自产自销');
  assert.match(body.headline.duration, /24h/);
});

test('parseCashMetrics extracts total and delta', () => {
  const m = parseCashMetrics(
    '期初100 +流入20 -流出5 ±重估0 =期末115\n(Δ +15 | 原因:售货)',
  );
  assert.equal(m.total, '115');
  assert.equal(m.change, '+15');
  assert.equal(m.changeDir, 'up');

  const down = parseCashMetrics('期末90 (Δ -10)');
  assert.equal(down.changeDir, 'down');
});

test('parseCashBaseTotal extracts amount after equals', () => {
  assert.equal(parseCashBaseTotal('∑(期末货币 × 汇率) = 115 §\n(Δ +15) → 存放:北商行账户'), '115 §');
  assert.equal(parseCashBaseTotal('= -500G 帝冕币'), '-500G 帝冕币');
  assert.equal(parseCashBaseTotal('无等号文案'), '');
});

test('parseProgressPct from progress and bar', () => {
  const a = parseProgressPct({ progress: '60%', bar: '███░░░' });
  assert.equal(a.pct, 60);

  const b = parseProgressPct({ bar: '████░░░░' });
  assert.equal(b.pct, 50);

  const onlyProgress = parseProgressPct({ progress: '60%' });
  assert.equal(onlyProgress.pct, 60);

  const w = parseProgressPct({ progress: '20%', run: 'Idle' }, 'Idle');
  assert.equal(w.tone, 'warn');
});
