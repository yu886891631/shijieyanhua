<template>
  <section class="we-t10-recovery" aria-label="酒馆存档与恢复">
    <header>
      <h2>存档与恢复</h2>
      <button type="button" :disabled="view.busy" @click="controller.refresh()">
        {{ view.busy ? '正在校验存档…' : '检查已保存存档' }}
      </button>
    </header>
    <p>这里只查看保存结果。不会生成剧情、调用 AI、重算失效楼层或更新世界书。</p>
    <p v-if="!view.recovery" class="notice">
      尚未检查，或聊天/楼层已经变化。请重新检查；没有确认的结果不会显示为已保存。
    </p>
    <template v-else>
      <p :class="view.recovery.writable ? 'success' : 'notice'" role="status">
        {{ statusLabel(view.recovery.status) }} · {{ view.recovery.writable ? '可进入显式编辑/演算' : '当前只读' }}
      </p>
      <dl>
        <dt>存档来源</dt>
        <dd>{{ sourceLabel(view.recovery.source) }}</dd>
        <dt>当前聊天</dt>
        <dd>{{ view.recovery.binding?.hostChatId ?? '无法读取' }}</dd>
        <dt>世界 / 分支</dt>
        <dd>{{ view.recovery.scope?.worldId ?? '无' }} / {{ view.recovery.scope?.branchId ?? '无' }}</dd>
        <dt>有效提交</dt>
        <dd>
          {{ view.recovery.head?.commitId ?? '初始快照或无有效存档' }}（序号 {{ view.recovery.head?.seq ?? '—' }}）
        </dd>
        <dt>缓存校验</dt>
        <dd>{{ cacheLabel(view.recovery.cache) }}</dd>
        <dt>存档大小</dt>
        <dd>{{ view.recovery.bytes }} 字节；未自动压缩或清理历史</dd>
      </dl>
      <section v-if="view.recovery.pending.length" class="danger">
        <h3>待处理的历史范围</h3>
        <p>已读取有效祖先，下面的旧结果暂时无效，原档仍保留。此页面不会自动删除或收费追平。</p>
        <ul>
          <li v-for="item in view.recovery.pending" :key="item.seq">
            #{{ item.seq }} {{ item.commitId }}：{{
              item.reason === 'dependency' ? '剧情 / 回复页依赖已变化' : '提交链、模板或指纹校验失败'
            }}
          </li>
        </ul>
      </section>
      <section v-if="view.recovery.runs.length">
        <h3>已记录的请求</h3>
        <ul>
          <li v-for="run in view.recovery.runs" :key="run.runId">
            {{ run.runId }}：{{ runLabel(run.status) }}；发送预留 {{ run.sent }}/{{ run.maxRequests }}
          </li>
        </ul>
        <p>预留次数是安全上限，不是服务商账单。未完成请求不自动续发；跨刷新未保存暂存不保留。</p>
      </section>
      <ul class="notice">
        <li v-for="notice in view.recovery.notices" :key="notice">{{ notice }}</li>
      </ul>
      <p v-if="view.recovery.status === 'empty'">
        没有新格式存档。旧 MVU / 数据库资料不会在这里被自动搬入或覆盖；无有效助手楼层时只能保留草稿。
      </p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { shallowRef, onUnmounted } from 'vue';
import type { T10RecoveryController } from './t10-recovery-controller';
const props = defineProps<{ controller: T10RecoveryController }>();
const view = shallowRef(props.controller.view());
const stop = props.controller.subscribe(() => {
  view.value = props.controller.view();
});
onUnmounted(stop);
const labels = {
  empty: '未建立新格式存档',
  ready: '完整快照已确认',
  'restored-ancestor': '已退回有效祖先',
  damaged: '存档损坏，未启用',
  'identity-mismatch': '聊天身份不匹配，未启用',
  'read-failed': '持久读回失败，未确认',
};
const sources = {
  'simulated-host': '模拟宿主（不是实际酒馆）',
  'verified-host': '经验证的宿主 JSON',
  'unverified-host': '未验证宿主，只读',
};
const caches = { absent: '没有缓存，已从 JSON 恢复', match: '与存档一致', discarded: '缓存不一致，已忽略' };
const runs = {
  committed: '整轮已保存',
  interrupted: '未完成，结果 / 费用可能未知',
  stale: '输入或基准已变化，不可续跑',
  abandoned: '已明确放弃，保留记录',
};
const statusLabel = (key: keyof typeof labels) => labels[key];
const sourceLabel = (key: keyof typeof sources) => sources[key];
const cacheLabel = (key: keyof typeof caches) => caches[key];
const runLabel = (key: keyof typeof runs) => runs[key];
</script>
<style scoped>
.we-t10-recovery {
  padding: 16px;
  border-radius: 12px;
  background: var(--we14-surface, #f1f7ed);
  color: var(--we14-text, #294f3c);
  min-width: 0;
  overflow-wrap: anywhere;
}
header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}
h2,
h3 {
  margin: 0 0 8px;
}
button {
  background: var(--we14-soft, #e0efe3);
  color: var(--we14-text, #294f3c);
  border: 1px solid var(--we14-border, #a9c5b4);
  border-radius: 8px;
  padding: 8px 12px;
}
button:disabled {
  opacity: 0.6;
}
button:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 3px;
}
dl {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(0, 3fr);
  gap: 8px 12px;
}
dd {
  margin: 0;
}
.notice,
.success,
.danger {
  padding: 12px;
  border-radius: 8px;
  background: var(--we14-soft, #e4eee2);
}
.danger {
  background: var(--we14-danger-bg, #f9e5e8);
  color: var(--we14-danger-text, #823b4d);
  border: 1px solid var(--we14-danger-border, #dea9b4);
}
ul {
  padding-inline-start: 28px;
}
li + li {
  margin-top: 6px;
}
@media (max-width: 540px) {
  dl {
    grid-template-columns: minmax(0, 1fr);
  }
  dt {
    font-weight: 600;
  }
}
</style>
