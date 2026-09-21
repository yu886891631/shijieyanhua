<template>
  <div class="ledger">
    <header
      class="ledger-global-header"
      role="button"
      :aria-expanded="bodyOpen"
      :aria-label="bodyOpen ? '收起资产账簿' : '展开资产账簿'"
      @click="bodyOpen = !bodyOpen"
    >
      <div class="gh-body">
        <div class="gh-row gh-row--title">
          <span class="gh-icon" aria-hidden="true">📒</span>
          <span class="gh-main-title">资产账簿</span>
          <span v-if="data.ledgerTime.timeLine" class="gh-subtitle">{{
            formatHeaderTimeLine(data.ledgerTime.timeLine)
          }}</span>
          <div class="gh-actions">
            <button
              type="button"
              class="gh-theme-btn"
              title="切换主题"
              @click.stop="emit('toggle-theme')"
            >
              {{ themeDark ? '☀️' : '🌓' }}
            </button>
            <span class="gh-arrow" :class="{ open: bodyOpen }" aria-hidden="true">▾</span>
          </div>
        </div>
        <div
          v-if="data.headline.duration || data.headline.status || data.headline.delta || data.cashTotal"
          class="gh-row gh-row--meta"
        >
          <div
            v-if="data.headline.duration || data.headline.status || data.headline.delta"
            class="gh-meta-group gh-meta-group--left"
          >
            <span v-if="data.headline.duration" class="gh-pill">{{ data.headline.duration }}</span>
            <span v-if="data.headline.status" class="gh-pill">{{ data.headline.status }}</span>
            <span v-if="data.headline.delta" class="gh-delta">Δ {{ data.headline.delta }}</span>
          </div>
          <div v-if="data.cashTotal" class="gh-meta-group gh-meta-group--right">
            <span class="gh-cash">流动 {{ data.cashTotal }}</span>
          </div>
        </div>
      </div>
    </header>

    <div v-show="bodyOpen" class="ledger-body">
      <div class="ledger-toolbar">
        <button type="button" class="tb-btn" @click.stop="emit('expand-all')">全部展开</button>
        <button type="button" class="tb-btn" @click.stop="emit('collapse-all')">全部收起</button>
      </div>

      <!-- 1 宏观概览 -->
      <FoldPanel
        variant="section"
        title="宏观概览"
        emoji="📋"
        badge="OVERVIEW"
        :default-open="false"
        :forced-open="forcedOpen"
      >
        <div v-if="data.ledgerTime.gateText" class="highlight-block">
          <StatRow :text="data.ledgerTime.raw" />
        </div>
        <div v-else-if="data.ledgerTime.raw" class="highlight-block">
          <PreLine :text="data.ledgerTime.raw" />
        </div>

        <div v-if="data.periodSummary" class="highlight-block">
          <div class="hl-label">本期结算</div>
          <StatRow :text="data.periodSummary" />
        </div>

        <FoldPanel
          v-if="data.externalFactors.length"
          variant="sub"
          title="外因"
          emoji="🌊"
          :summary="`${data.externalFactors.length} 项`"
          :default-open="false"
          :forced-open="forcedOpen"
        >
          <div v-for="(f, i) in data.externalFactors" :key="'ext-' + i" class="factor-row">
            <div class="factor-head">
              <span class="tag tag-primary">{{ f.attrs._tag || '因子' }}</span>
              <strong v-if="factorName(f)" class="factor-title">{{ factorName(f) }}</strong>
              <span v-if="f.text" class="factor-summary">{{ oneLine(f.text) }}</span>
            </div>
            <AttrChips :attrs="f.attrs" :hide="['name', '_tag']" />
            <StatRow :text="f.text" />
          </div>
        </FoldPanel>

        <FoldPanel
          v-if="data.internalFactors.length"
          variant="sub"
          title="内因"
          emoji="🔬"
          :summary="`${data.internalFactors.length} 项`"
          :default-open="false"
          :forced-open="forcedOpen"
        >
          <div v-for="(f, i) in data.internalFactors" :key="'int-' + i" class="factor-row">
            <div class="factor-head">
              <span class="tag tag-warm">{{ f.attrs._tag || '因子' }}</span>
              <strong v-if="factorName(f)" class="factor-title">{{ factorName(f) }}</strong>
              <span v-if="f.text" class="factor-summary">{{ oneLine(f.text) }}</span>
            </div>
            <AttrChips :attrs="f.attrs" :hide="['name', '_tag']" />
            <StatRow :text="f.text" />
          </div>
        </FoldPanel>

        <FoldPanel
          v-if="data.currencies.length || data.cashBase"
          variant="sub"
          title="产业流动资金"
          emoji="💎"
          :summary="data.cashNote || `${data.currencies.length} 币种`"
          :default-open="false"
          :forced-open="forcedOpen"
        >
          <CurrencyCards v-if="data.currencies.length" :currencies="data.currencies" />
          <div v-if="data.cashBase" class="highlight-block">
            <div class="hl-label">折合基准</div>
            <StatRow :text="data.cashBase" :split-pipes="false" />
          </div>
        </FoldPanel>
      </FoldPanel>

      <!-- 2 资产分布 -->
      <FoldPanel
        v-if="data.entities.length"
        variant="section"
        title="资产分布"
        emoji="🏗️"
        badge="ASSET"
        :summary="`${data.entities.length} 实体`"
        :default-open="false"
        :forced-open="forcedOpen"
      >
        <FoldPanel
          v-for="(ent, ei) in data.entities"
          :key="'ent-' + ei"
          variant="entity"
          :title="ent.name"
          emoji="🏘️"
          :summary="entitySummary(ent)"
          :default-open="false"
          :forced-open="forcedOpen"
        >
          <div v-if="ent.location || ent.nextFixedSettle" class="entity-meta">
            <span v-if="ent.location" class="entity-meta__loc">{{ ent.location }}</span>
            <span
              v-if="ent.nextFixedSettle"
              class="settle-chip"
              title="下次固定支出结算（薪饷/维护等）"
            >
              <span class="settle-chip__label">下次固定结算</span>
              <span class="settle-chip__value">{{ ent.nextFixedSettle }}</span>
            </span>
          </div>
          <FoldPanel
            v-if="ent.facilities.length"
            variant="sub"
            title="基建"
            :summary="`${ent.facilities.length} 类`"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <div v-for="(b, bi) in ent.facilities" :key="'f-' + bi" class="item-row">
              <strong>{{ b.attrs.type || '设施' }}</strong>
              <span v-if="b.attrs.count" class="muted"> ×{{ b.attrs.count }}</span>
              <span v-if="b.attrs.quality" class="muted"> · 品质:{{ b.attrs.quality }}</span>
              <span v-if="b.attrs.status" class="tag" :class="statusTagClass(b.attrs.status)">{{
                b.attrs.status
              }}</span>
              <span v-if="b.attrs.maintain" class="muted"> · 维护:{{ b.attrs.maintain }}</span>
              <span v-if="b.attrs.baseIncome" class="muted"> · 基线收入:{{ b.attrs.baseIncome }}</span>
              <AttrChips
                :attrs="b.attrs"
                :hide="['type', 'count', 'status', 'quality', 'maintain', 'baseIncome']"
              />
              <p v-if="b.text" class="muted staff-note">{{ b.text }}</p>
            </div>
          </FoldPanel>

          <FoldPanel
            v-if="ent.materials.length || ent.equipments.length"
            variant="sub"
            title="仓库"
            :summary="`${ent.materials.length + ent.equipments.length} 项`"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <FoldPanel
              v-for="(m, mi) in ent.materials"
              :key="'m-' + mi"
              variant="sub"
              :title="whItemTitle(m.attrs, '物资')"
              :summary="warehouseSummary(m.text)"
              :default-open="false"
              :forced-open="forcedOpen"
            >
              <AttrChips :attrs="m.attrs" :hide="['name', 'unit', 'quality']" />
              <StatRow :text="m.text" />
            </FoldPanel>
            <FoldPanel
              v-for="(e, eqi) in ent.equipments"
              :key="'eq-' + eqi"
              variant="sub"
              :title="whItemTitle(e.attrs, '装备')"
              :summary="warehouseSummary(e.text)"
              :default-open="false"
              :forced-open="forcedOpen"
            >
              <AttrChips :attrs="e.attrs" :hide="['name', 'unit', 'quality']" />
              <StatRow :text="e.text" />
            </FoldPanel>
          </FoldPanel>

          <FoldPanel
            v-if="ent.roles.length || ent.keyPersons.length || ent.staffTotal"
            variant="sub"
            title="人员"
            :summary="staffSummary(ent)"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <p v-if="ent.staffNote" class="muted staff-note">{{ ent.staffNote }}</p>
            <div v-for="(r, ri) in ent.roles" :key="'r-' + ri" class="item-row">
              <strong>{{ pick(r.attrs, 'role') || '职级' }}</strong>
              <span v-if="pick(r.attrs, 'count')" class="muted"> ×{{ pick(r.attrs, 'count') }}</span>
              <span v-if="pick(r.attrs, 'level')" class="muted"> · {{ pick(r.attrs, 'level') }}</span>
              <span v-if="pick(r.attrs, '变动')" class="muted"> · 变动:{{ pick(r.attrs, '变动') }}</span>
              <span
                v-if="pick(r.attrs, 'status')"
                class="tag"
                :class="statusTagClass(pick(r.attrs, 'status'))"
              >
                {{ pick(r.attrs, 'status') }}
              </span>
              <AttrChips
                :attrs="r.attrs"
                :hide="['role', 'count', 'level', '变动', 'status']"
              />
              <div v-if="r.children?.length" class="kit-list">
                <div v-for="(k, ki) in r.children" :key="'rk-' + ki" class="kit-item muted">
                  {{ kitLine(k) }}
                </div>
              </div>
            </div>
            <div v-for="(kp, ki) in ent.keyPersons" :key="'kp-' + ki" class="item-row">
              <strong>{{ pick(kp.attrs, 'name') || '核心人物' }}</strong>
              <span v-if="pick(kp.attrs, 'role')" class="muted"> · {{ pick(kp.attrs, 'role') }}</span>
              <span v-if="pick(kp.attrs, 'level')" class="muted"> · {{ pick(kp.attrs, 'level') }}</span>
              <span v-if="pick(kp.attrs, 'loyalty')" class="muted">
                · 忠诚:{{ pick(kp.attrs, 'loyalty') }}</span
              >
              <span
                v-if="pick(kp.attrs, 'status')"
                class="tag"
                :class="statusTagClass(pick(kp.attrs, 'status'))"
              >
                {{ pick(kp.attrs, 'status') }}
              </span>
              <span v-if="pick(kp.attrs, 'dispatch')" class="muted">
                · 任务:{{ pick(kp.attrs, 'dispatch') }}</span
              >
              <AttrChips
                :attrs="kp.attrs"
                :hide="['name', 'role', 'level', 'loyalty', 'status', 'dispatch']"
              />
              <div v-if="kp.children?.length" class="kit-list">
                <div v-for="(k, kki) in kp.children" :key="'kk-' + kki" class="kit-item muted">
                  {{ kitLine(k) }}
                </div>
              </div>
            </div>
          </FoldPanel>
        </FoldPanel>
      </FoldPanel>

      <!-- 3 经营效率 -->
      <FoldPanel
        v-if="data.businesses.length"
        variant="section"
        title="经营效率"
        emoji="📈"
        badge="OPS"
        :summary="`${data.businesses.length} 实体`"
        :default-open="false"
        :forced-open="forcedOpen"
      >
        <FoldPanel
          v-for="(biz, bi) in data.businesses"
          :key="'biz-' + bi"
          variant="entity"
          :title="biz.name"
          emoji="📊"
          :summary="bizSummary(biz)"
          :default-open="false"
          :forced-open="forcedOpen"
        >
          <FoldPanel
            v-if="biz.fulfilledOrders.length || biz.pendingOrders.length"
            variant="sub"
            title="订单"
            emoji="🧾"
            :summary="orderSummary(biz)"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <FoldPanel
              v-for="(o, oi) in biz.fulfilledOrders"
              :key="'fo-' + oi"
              variant="sub"
              :title="orderTitle(o, '履约')"
              :summary="pick(o.attrs, 'amount') || pick(o.attrs, 'party')"
              :badge="pick(o.attrs, 'status') || '已结清'"
              badge-class="is-plus"
              :default-open="false"
              :forced-open="forcedOpen"
            >
              <AttrChips
                :attrs="o.attrs"
                :hide="['order', 'item', 'amount', 'status', 'party', 'qty', 'unit', 'quality']"
              />
              <div v-if="orderMeta(o)" class="muted staff-note">{{ orderMeta(o) }}</div>
              <StatRow :text="o.text" />
            </FoldPanel>
            <FoldPanel
              v-for="(o, oi) in biz.pendingOrders"
              :key="'po-' + oi"
              variant="sub"
              :title="orderTitle(o, '在途')"
              :summary="pick(o.attrs, 'amount') || pick(o.attrs, 'party')"
              :badge="pick(o.attrs, 'status') || '在途'"
              badge-class="is-minus"
              :default-open="false"
              :forced-open="forcedOpen"
            >
              <AttrChips
                :attrs="o.attrs"
                :hide="['order', 'item', 'amount', 'status', 'party', 'qty', 'unit', 'quality']"
              />
              <div v-if="orderMeta(o)" class="muted staff-note">{{ orderMeta(o) }}</div>
              <StatRow :text="o.text" />
            </FoldPanel>
          </FoldPanel>

          <FoldPanel
            variant="sub"
            title="收入"
            emoji="📈"
            :summary="moneySummary(biz.revenueTotal, biz.revenuePeriod)"
            badge="+"
            badge-class="is-plus"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <StatRow v-if="biz.revenueNote" :text="biz.revenueNote" />
            <FoldPanel
              v-for="(item, ii) in biz.revenueItems"
              :key="'ri-' + ii"
              variant="sub"
              :title="pick(item.attrs, 'name') || '条目'"
              :summary="moneyItemSummary(item)"
              :badge="pick(item.attrs, 'amount')"
              badge-class="is-plus"
              :default-open="false"
              :forced-open="forcedOpen"
            >
              <div v-if="moneyItemMeta(item)" class="item-meta">
                <span v-if="isRecurring(item.attrs)" class="tag tag-warm">常备</span>
                <span v-if="pick(item.attrs, 'type')" class="tag tag-primary">{{
                  pick(item.attrs, 'type')
                }}</span>
                <span v-if="pick(item.attrs, 'order')" class="muted"
                  >订单:{{ pick(item.attrs, 'order') }}</span
                >
              </div>
              <AttrChips
                :attrs="item.attrs"
                :hide="['name', 'amount', 'type', 'recurring', 'order']"
              />
              <StatRow :text="item.text" />
            </FoldPanel>
          </FoldPanel>

          <FoldPanel
            variant="sub"
            title="支出"
            emoji="📉"
            :summary="moneySummary(biz.expenseTotal, biz.expensePeriod)"
            badge="−"
            badge-class="is-minus"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <FoldPanel
              v-for="(item, ii) in biz.expenseItems"
              :key="'ei-' + ii"
              variant="sub"
              :title="pick(item.attrs, 'name') || '条目'"
              :summary="moneyItemSummary(item)"
              :badge="pick(item.attrs, 'amount')"
              badge-class="is-minus"
              :default-open="false"
              :forced-open="forcedOpen"
            >
              <div v-if="moneyItemMeta(item)" class="item-meta">
                <span v-if="isRecurring(item.attrs)" class="tag tag-warm">常备</span>
                <span v-if="pick(item.attrs, 'type')" class="tag tag-primary">{{
                  pick(item.attrs, 'type')
                }}</span>
                <span v-if="pick(item.attrs, 'order')" class="muted"
                  >订单:{{ pick(item.attrs, 'order') }}</span
                >
              </div>
              <AttrChips
                :attrs="item.attrs"
                :hide="['name', 'amount', 'type', 'recurring', 'order']"
              />
              <StatRow :text="item.text" />
            </FoldPanel>
          </FoldPanel>

          <FoldPanel
            v-if="biz.lines.length"
            variant="sub"
            title="产能"
            emoji="🏗️"
            :summary="`${biz.lines.length} 产线`"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <FoldPanel
              v-for="(line, li) in biz.lines"
              :key="'ln-' + li"
              variant="sub"
              :title="lineTitle(line.attrs)"
              :badge="pick(line.attrs, 'run')"
              :badge-class="runBadgeClass(line.attrs.run)"
              :default-open="false"
              :forced-open="forcedOpen"
            >
              <AttrChips :attrs="line.attrs" :hide="['production', 'building', 'count', 'run']" />
              <div
                v-for="split in [lineSplit(line.text)].filter(Boolean)"
                :key="'split-' + li"
                class="split-row"
              >
                <span class="split-label">分流</span>
                <span v-if="split!.sold" class="split-chip split-chip--sold">已售 {{ split!.sold }}</span>
                <span v-if="split!.stock" class="split-chip split-chip--stock"
                  >入库 {{ split!.stock }}</span
                >
                <span v-if="split!.self" class="split-chip split-chip--self">自用 {{ split!.self }}</span>
              </div>
              <StatRow :text="line.text" />
            </FoldPanel>
          </FoldPanel>

          <FoldPanel
            v-if="biz.reconcile.text"
            variant="sub"
            title="闭环校验"
            emoji="🧾"
            :badge="pick(biz.reconcile.attrs, 'result')"
            :badge-class="reconcileClass(biz.reconcile.attrs)"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <StatRow :text="biz.reconcile.text" />
          </FoldPanel>

          <div v-if="biz.netWorth" class="highlight-block">
            <div class="stat-inline">
              <span class="stat-inline__icon">💎</span>
              <strong>净值</strong>
              <span>{{ biz.netWorth }}</span>
            </div>
          </div>
        </FoldPanel>
      </FoldPanel>

      <!-- 4 运营监控 -->
      <FoldPanel
        v-if="data.operations.length"
        variant="section"
        title="运营监控"
        emoji="🧭"
        badge="MONITOR"
        :summary="`${data.operations.length} 实体`"
        :default-open="false"
        :forced-open="forcedOpen"
      >
        <FoldPanel
          v-for="(op, oi) in data.operations"
          :key="'op-' + oi"
          variant="entity"
          :title="op.name"
          emoji="🧭"
          :summary="opSummary(op)"
          :default-open="false"
          :forced-open="forcedOpen"
        >
          <div v-if="op.managerName || op.manager" class="highlight-block">
            <div class="hl-label">主管</div>
            <p v-if="op.managerName" class="manager-name">{{ op.managerName }}</p>
            <StatRow v-if="op.manager" :text="op.manager" />
          </div>

          <FoldPanel
            v-for="(p, pi) in op.projects"
            :key="'p-' + pi"
            variant="sub"
            :title="p.name"
            emoji="🏗️"
            :summary="p.attrs.progress || ''"
            :default-open="false"
            :forced-open="forcedOpen"
          >
            <ProgressBar :attrs="p.attrs" :extra-text="p.text" />
            <AttrChips :attrs="p.attrs" :hide="['name', 'bar', 'progress']" />
            <StatRow :text="p.text" />
          </FoldPanel>
        </FoldPanel>
      </FoldPanel>

      <!-- 5 外派任务 -->
      <FoldPanel
        v-if="data.dispatches.length"
        variant="section"
        title="外派任务"
        emoji="🚩"
        badge="DISPATCH"
        :summary="`${data.dispatches.length} 项`"
        :default-open="false"
        :forced-open="forcedOpen"
      >
        <FoldPanel
          v-for="(d, di) in data.dispatches"
          :key="'d-' + di"
          variant="entity"
          :title="dispatchTitle(d)"
          emoji="🚩"
          :summary="dispatchSummary(d)"
          :badge="d.status || undefined"
          :badge-class="dispatchBadgeClass(d.status)"
          :default-open="false"
          :forced-open="forcedOpen"
        >
          <div class="entity-meta">
            <span v-if="d.name" class="entity-meta__loc">实体:{{ d.name }}</span>
            <span v-if="d.who" class="muted"> · 人员:{{ d.who }}</span>
            <span v-if="d.dest" class="muted"> · 目的地:{{ d.dest }}</span>
            <span v-if="d.mission" class="muted"> · 任务:{{ d.mission }}</span>
          </div>
          <div v-if="d.since || d.eta" class="muted staff-note">
            <span v-if="d.since">出发:{{ d.since }}</span>
            <span v-if="d.since && d.eta"> · </span>
            <span v-if="d.eta">预计归期:{{ d.eta }}</span>
          </div>
          <AttrChips
            :attrs="d.attrs"
            :hide="['id', 'name', 'who', 'dest', 'mission', 'since', 'eta', 'status']"
          />
          <div v-if="d.kit.length" class="kit-list">
            <div v-for="(k, kdi) in d.kit" :key="'dk-' + kdi" class="kit-item muted">
              {{ kitLine(k) }}
            </div>
          </div>
          <StatRow v-if="d.text" :text="d.text" />
        </FoldPanel>
      </FoldPanel>

      <div class="footer-note">✧ 通用资产账簿 · 自动生成 ✧</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AttrChips from './AttrChips.vue';
import CurrencyCards from './CurrencyCards.vue';
import FoldPanel from './FoldPanel.vue';
import PreLine from './PreLine.vue';
import ProgressBar from './ProgressBar.vue';
import StatRow from './StatRow.vue';
import { parseCashMetrics, parseProductionSplit } from '../parse';
import type {
  BusinessData,
  DispatchData,
  EntityData,
  LedgerData,
  NamedBlock,
  OperationsData,
} from '../types';

defineProps<{
  data: LedgerData;
  forcedOpen: boolean | null;
  themeDark: boolean;
}>();

const emit = defineEmits<{
  (e: 'expand-all'): void;
  (e: 'collapse-all'): void;
  (e: 'toggle-theme'): void;
}>();

const bodyOpen = ref(false);

function oneLine(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
}

function formatHeaderTimeLine(timeLine: string): string {
  return String(timeLine ?? '')
    .replace(/^\[?账目结算时间\]?\s*[:：]\s*/, '')
    .trim();
}

/** 有 name 才返回，避免与类型 tag 重复 */
function factorName(f: NamedBlock): string {
  return (f.attrs.name || '').trim();
}

function pick(attrs: Record<string, string>, key: string): string {
  return attrs?.[key] ?? '';
}

function entitySummary(ent: EntityData): string {
  const staffLabel = ent.staffTotal
    ? `人员${ent.staffTotal}`
    : ent.keyPersons.length
      ? `核心${ent.keyPersons.length}`
      : '';
  const settleMatch = ent.nextFixedSettle.match(/(\d+年\d+月\d+日)/);
  const settleShort = ent.nextFixedSettle
    ? `下次结算 ${settleMatch?.[1] ?? ent.nextFixedSettle}`
    : '';
  const parts = [
    ent.location || '',
    settleShort,
    ent.facilities.length ? `设施${ent.facilities.length}` : '',
    ent.materials.length ? `物资${ent.materials.length}` : '',
    staffLabel,
  ].filter(Boolean);
  return parts.join(' · ');
}

function staffSummary(ent: EntityData): string {
  const parts = [
    ent.staffTotal ? `共 ${ent.staffTotal}` : '',
    ent.staffOnDuty ? `在岗 ${ent.staffOnDuty}` : '',
    ent.staffDispatched ? `外派 ${ent.staffDispatched}` : '',
    ent.roles.length ? `职级 ${ent.roles.length}` : '',
    ent.keyPersons.length ? `核心 ${ent.keyPersons.length}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function kitLine(k: NamedBlock): string {
  const kind = pick(k.attrs, 'kind');
  const kindLabel = kind === 'supply' ? '物资' : kind === 'equip' ? '装备' : kind || '装';
  const name = pick(k.attrs, 'name') || '未命名';
  const qty = pick(k.attrs, 'qty');
  const unit = pick(k.attrs, 'unit');
  const quality = pick(k.attrs, 'quality');
  const use = pick(k.attrs, 'use');
  const from = pick(k.attrs, 'from');
  const slot = pick(k.attrs, 'slot');
  const bind = pick(k.attrs, 'bind');
  const qtyPart = qty ? ` ×${qty}${unit || ''}` : unit ? ` (${unit})` : '';
  const extras = [
    quality ? `品质:${quality}` : '',
    slot ? `位:${slot}` : '',
    bind ? `编制:${bind}` : '',
    use || '',
    from ? `来源:${from}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `[${kindLabel}] ${name}${qtyPart}${extras ? ` · ${extras}` : ''}`;
}

function dispatchTitle(d: DispatchData): string {
  const id = d.id ? `${d.id} · ` : '';
  return `${id}${d.mission || d.who || d.name || '外派'}`;
}

function dispatchSummary(d: DispatchData): string {
  const parts = [
    d.who || '',
    d.dest || '',
    d.status || '',
    d.kit.length ? `配装 ${d.kit.length}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function dispatchBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('返程') || s.includes('驻留')) return 'is-plus';
  if (s.includes('逾期') || s.includes('战损')) return 'is-minus';
  return '';
}

function moneySummary(total: string, period: string): string {
  if (!total && !period) return '';
  if (total && period) return `${total} / ${period}`;
  return total || period;
}

function isRecurring(attrs: Record<string, string>): boolean {
  const v = String(attrs?.recurring ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** 折叠标题摘要：常备 · 类型（金额走 badge） */
function moneyItemSummary(item: NamedBlock): string {
  const parts = [
    isRecurring(item.attrs) ? '常备' : '',
    pick(item.attrs, 'type'),
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return oneLine(item.text);
}

function moneyItemMeta(item: NamedBlock): boolean {
  return !!(isRecurring(item.attrs) || pick(item.attrs, 'type') || pick(item.attrs, 'order'));
}

function lineSplit(text: string) {
  return parseProductionSplit(text);
}

function bizSummary(biz: BusinessData): string {
  const orderCount = biz.fulfilledOrders.length + biz.pendingOrders.length;
  const parts = [
    biz.period || biz.revenuePeriod || '',
    orderCount ? `单 ${orderCount}` : '',
    biz.revenueTotal ? `入 ${biz.revenueTotal}` : '',
    biz.expenseTotal ? `支 ${biz.expenseTotal}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function orderSummary(biz: BusinessData): string {
  const parts = [
    biz.fulfilledOrders.length ? `履约 ${biz.fulfilledOrders.length}` : '',
    biz.pendingOrders.length ? `在途 ${biz.pendingOrders.length}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function orderTitle(o: NamedBlock, fallback: string): string {
  const item = pick(o.attrs, 'item');
  const order = pick(o.attrs, 'order');
  if (item && order) return `${item} · ${order}`;
  return item || order || fallback;
}

function orderMeta(o: NamedBlock): string {
  const parts = [
    pick(o.attrs, 'party') ? `对方:${pick(o.attrs, 'party')}` : '',
    pick(o.attrs, 'qty')
      ? `${pick(o.attrs, 'qty')}${pick(o.attrs, 'unit') || ''}`
      : '',
    pick(o.attrs, 'quality') ? `品质:${pick(o.attrs, 'quality')}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function opSummary(op: OperationsData): string {
  if (op.managerName) return op.managerName;
  return oneLine(op.manager);
}

function lineTitle(attrs: Record<string, string>): string {
  const b = attrs.production || attrs.building || '产线';
  const n = attrs.count ? ` ×${attrs.count}` : '';
  return `${b}${n}`;
}

function whItemTitle(attrs: Record<string, string>, fallback: string): string {
  const name = attrs.name || fallback;
  const unit = attrs.unit ? ` (${attrs.unit})` : '';
  const quality = attrs.quality ? ` · 品质:${attrs.quality}` : '';
  return `${name}${unit}${quality}`;
}

/** 仓库折叠标题：期末 / Δ / 配装占用 / 可用库存 */
function warehouseSummary(text: string): string {
  const { total, change } = parseCashMetrics(text);
  const t = String(text ?? '');
  const assigned = t.match(/配装占用\s*[:：]?\s*([+\-]?[\d,.]+(?:\.\d+)?)/)?.[1] ?? '';
  const available = t.match(/可用库存\s*[:：]?\s*([+\-]?[\d,.]+(?:\.\d+)?)/)?.[1] ?? '';
  const parts = [
    total ? `期末 ${total}` : '',
    change ? `Δ ${change}` : '',
    assigned ? `占用 ${assigned}` : '',
    available ? `可用 ${available}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function reconcileClass(attrs: Record<string, string>): string {
  const r = (attrs.result || '').toLowerCase();
  if (r.includes('pass') || r.includes('通过')) return 'is-plus';
  if (r.includes('fail') || r.includes('失败')) return 'is-minus';
  return '';
}

function runBadgeClass(run?: string): string {
  const r = (run || '').toLowerCase();
  if (r.includes('full')) return 'is-plus';
  if (r.includes('idle') || r.includes('damaged') || r.includes('partial')) return 'is-minus';
  return '';
}

function statusTagClass(status: string): string {
  const s = status.toLowerCase();
  if (
    s.includes('normal') ||
    s.includes('正常') ||
    s.includes('满编') ||
    s.includes('在岗') ||
    s.includes('返程')
  ) {
    return 'tag-green';
  }
  if (
    s.includes('damaged') ||
    s.includes('idle') ||
    s.includes('损') ||
    s.includes('闲') ||
    s.includes('缺编') ||
    s.includes('伤病') ||
    s.includes('暂离') ||
    s.includes('逾期')
  ) {
    return 'tag-red';
  }
  return 'tag-primary';
}
</script>

<style lang="scss" scoped>
.ledger {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.ledger-global-header {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 6px 8px 6px 10px;
  min-height: 0;
  line-height: 1.25;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  box-shadow: var(--shadow-xs);
  transition: box-shadow var(--transition-smooth), border-color var(--transition-fast);
  position: sticky;
  top: 2px;
  z-index: 20;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  margin: 0;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;

  &:hover {
    box-shadow: var(--shadow-sm), var(--shadow-glow);
    border-color: var(--border-accent);
  }
}

.gh-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  flex: 1 1 auto;
  min-width: 0;
}

.gh-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
}

.gh-row--title {
  flex-wrap: nowrap;
  gap: 5px;
  overflow: hidden;
}

.gh-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.gh-row--meta {
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  overflow: hidden;
}

.gh-meta-group {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  min-width: 0;
}

.gh-meta-group--left {
  flex-shrink: 0;
}

.gh-meta-group--right {
  margin-left: auto;
  flex-shrink: 1;
  justify-content: flex-end;
  min-width: 0;
}

.gh-icon {
  font-size: 1.05rem;
  flex-shrink: 0;
  line-height: 1;
}

.gh-main-title {
  font-family: var(--font-display);
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--text-primary);
  line-height: 1.2;
  white-space: nowrap;
  flex-shrink: 0;
}

.gh-subtitle {
  margin: 0;
  padding: 0;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--text-tertiary);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1 1 auto;
}

.gh-pill {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
  background: rgba(176, 125, 68, 0.12);
  color: var(--accent-primary);
  border: 1px solid var(--border-accent);
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.4;
}

.gh-delta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--accent-green);
  white-space: nowrap;
  flex-shrink: 0;
}

.gh-cash {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--accent-teal, var(--accent-primary));
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gh-arrow {
  font-size: 10px;
  color: var(--accent-primary);
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(176, 125, 68, 0.1);
  transition: transform 0.35s cubic-bezier(0.33, 1, 0.68, 1);
  flex-shrink: 0;
  line-height: 1;

  &.open {
    transform: rotate(180deg);
  }
}

.gh-theme-btn {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  padding: 0;
  line-height: 1;

  &:hover {
    background: rgba(176, 125, 68, 0.15);
    border-color: var(--border-accent);
    color: var(--accent-primary);
  }
}

.ledger-body {
  padding: 10px 0 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ledger-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tb-btn {
  font: inherit;
  font-size: 0.75rem;
  padding: 0.3em 0.75em;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-xs);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  box-shadow: var(--shadow-xs);

  &:hover {
    border-color: var(--border-accent);
    color: var(--accent-primary);
  }
}

.highlight-block {
  background: linear-gradient(135deg, rgba(176, 125, 68, 0.08) 0%, rgba(176, 125, 68, 0.02) 100%);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin: 8px 0;
}

.hl-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.factor-row {
  margin: 8px 0;
  padding: 6px 0;
  border-bottom: 1px dashed var(--border-subtle);

  &:last-child {
    border-bottom: 0;
  }
}

.factor-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin-bottom: 2px;
}

.factor-title {
  font-size: 0.85rem;
  font-weight: 650;
  color: var(--text-primary);
}

.factor-summary {
  flex: 1 1 8em;
  min-width: 0;
  font-size: 0.68rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding: 6px 4px;
  border-bottom: 1px dashed var(--border-subtle);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.muted {
  color: var(--text-tertiary);
  font-size: 0.85em;
}

.kit-list {
  margin: 4px 0 0;
  padding-left: 0.6em;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kit-item {
  font-size: 0.92em;
  line-height: 1.35;
}

.staff-note {
  margin: 0 0 0.4em;
}

.entity-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: var(--radius-xs);
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
}

.entity-meta__loc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  letter-spacing: 0.02em;

  &::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    vertical-align: 0.1em;
    opacity: 0.85;
  }
}

.settle-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 3px 8px 3px 7px;
  border-radius: 999px;
  border: 1px solid rgba(176, 125, 68, 0.35);
  background: linear-gradient(135deg, rgba(176, 125, 68, 0.12) 0%, rgba(184, 148, 62, 0.06) 100%);
  box-shadow: var(--shadow-xs);
}

.settle-chip__label {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent-primary);
  text-transform: none;
}

.settle-chip__value {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.theme-dark .settle-chip {
  border-color: rgba(126, 168, 224, 0.35);
  background: linear-gradient(135deg, rgba(126, 168, 224, 0.14) 0%, rgba(212, 176, 96, 0.06) 100%);
}

.theme-dark .settle-chip__label {
  color: var(--accent-secondary);
}

.item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 4px 0 6px;
}

.split-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 6px 0 8px;
  padding: 6px 8px;
  border-radius: var(--radius-xs);
  background: rgba(74, 124, 92, 0.08);
  border: 1px solid rgba(74, 124, 92, 0.2);
}

.split-label {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--accent-green);
  letter-spacing: 0.3px;
}

.split-chip {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 8px;
  line-height: 1.4;
}

.split-chip--sold {
  background: rgba(74, 124, 92, 0.15);
  color: var(--accent-green);
  border: 1px solid rgba(74, 124, 92, 0.25);
}

.split-chip--stock {
  background: rgba(176, 125, 68, 0.12);
  color: var(--accent-primary);
  border: 1px solid rgba(176, 125, 68, 0.25);
}

.split-chip--self {
  background: rgba(90, 110, 140, 0.12);
  color: var(--text-secondary);
  border: 1px solid rgba(90, 110, 140, 0.22);
}

.manager-name {
  margin: 0 0 4px;
  font-size: 0.88rem;
  font-weight: 650;
  color: var(--text-primary);
}

.tag {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 8px;
  letter-spacing: 0.3px;
}

.tag-primary {
  background: rgba(176, 125, 68, 0.15);
  color: var(--accent-primary);
  border: 1px solid rgba(176, 125, 68, 0.25);
}

.tag-warm {
  background: rgba(184, 92, 56, 0.15);
  color: var(--accent-warm);
  border: 1px solid rgba(184, 92, 56, 0.25);
}

.tag-green {
  background: rgba(74, 124, 92, 0.15);
  color: var(--accent-green);
  border: 1px solid rgba(74, 124, 92, 0.25);
}

.tag-red {
  background: rgba(184, 72, 58, 0.15);
  color: var(--accent-red);
  border: 1px solid rgba(184, 72, 58, 0.25);
}

.stat-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-primary);
}

.stat-inline__icon {
  opacity: 0.85;
}

.footer-note {
  text-align: center;
  font-size: 0.62rem;
  color: var(--text-muted);
  padding: 8px 0 4px;
  letter-spacing: 1px;
  border-top: 1px solid var(--border-subtle);
}

@media (max-width: 640px) {
  .ledger-global-header {
    padding: 6px 8px 6px 10px;
    gap: 6px;
  }

  .gh-body {
    gap: 2px;
  }

  .gh-main-title {
    font-size: 0.84rem;
  }

  .gh-subtitle {
    font-size: 0.6rem;
  }

  .gh-row--meta {
    gap: 3px 5px;
  }

  .gh-pill {
    font-size: 0.58rem;
    padding: 1px 5px;
  }

  .gh-delta,
  .gh-cash {
    font-size: 0.6rem;
  }

  .gh-theme-btn {
    width: 28px;
    height: 28px;
    font-size: 13px;
  }

  .gh-arrow {
    width: 28px;
    height: 28px;
    font-size: 11px;
  }

  .ledger-body {
    padding-top: 8px;
    gap: 10px;
  }

  .tb-btn {
    font-size: 0.72rem;
    padding: 0.45em 1em;
    min-height: 36px;
  }

  .highlight-block {
    padding: 8px 10px;
    margin: 6px 0;
  }

  .factor-summary {
    flex-basis: 100%;
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
    overflow-wrap: anywhere;
  }
}
</style>
