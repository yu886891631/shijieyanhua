<template>
  <div class="we-t6-parameters">
    <section v-for="key in keys" :key="key">
      <label
        >{{ names[key] }}
        <select
          :aria-label="`${label} ${names[key]}方式`"
          :value="value[key].state"
          @change="setMode(key, text($event))"
        >
          <option v-if="scope !== 'global'" value="inherit">继承上级</option>
          <option v-if="scope !== 'global' || key === 'api'" value="disabled">停用此项</option>
          <option value="value">自行设置</option>
        </select>
      </label>
      <template v-if="key === 'frequency' && value.frequency.state === 'value'">
        <label
          >每隔几次合格剧情轮次<input
            type="number"
            min="1"
            :value="value.frequency.value.every"
            @change="frequency('every', $event)"
        /></label>
        <label
          >轮次起点偏移<input
            type="number"
            min="0"
            :value="value.frequency.value.offset"
            @change="frequency('offset', $event)"
        /></label>
      </template>
      <template v-if="key === 'budget' && value.budget.state === 'value'">
        <label v-for="item in budgets" :key="item.key"
          >{{ item.name
          }}<input type="number" min="0" :value="value.budget.value[item.key]" @change="budget(item.key, $event)"
        /></label>
      </template>
      <template v-if="key === 'context' && value.context.state === 'value'">
        <label
          >最多资料行<input
            type="number"
            min="0"
            :value="value.context.value.maxRows"
            @change="contextNumber('maxRows', $event)"
        /></label>
        <label
          >最多上下文字数<input
            type="number"
            min="0"
            :value="value.context.value.maxChars"
            @change="contextNumber('maxChars', $event)"
        /></label>
        <label
          >最近剧情消息数<input
            type="number"
            min="0"
            :value="value.context.value.lastAssistantMessages"
            @change="contextNumber('lastAssistantMessages', $event)"
        /></label>
        <label
          ><input
            type="checkbox"
            :checked="value.context.value.includeArchived"
            @change="contextArchive($event)"
          />允许已归档记录作为条件</label
        >
        <label v-for="source in sources" :key="source.id"
          ><input
            type="checkbox"
            :checked="value.context.value.sources.includes(source.id)"
            @change="contextSource(source.id, $event)"
          />{{ source.name }}</label
        >
      </template>
      <label v-if="key === 'api' && value.api.state === 'value'"
        >API 预设 ID<input :value="value.api.value.presetId" placeholder="只引用预设，不填写 Key" @change="api($event)"
      /></label>
      <p v-if="value[key].state === 'inherit'">表 → 所属阶段 → 全局默认。硬上限始终生效。</p>
      <p v-if="value[key].state === 'disabled'">此项不参与下次演算；不会删除资料。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { T2Budget, T2ContextSettings, T2Template } from './t2-template';
import type { T6ParameterKey, T6Parameters } from './t6-parameters';
interface ParameterProps {
  value: T6Parameters;
  defaults: T2Template['defaults'];
  scope: 'global' | 'phase' | 'table';
  label: string;
}
const props: ParameterProps = defineProps<ParameterProps>();
const emit = defineEmits<{ change: [value: T6Parameters] }>();
const keys: T6ParameterKey[] = ['frequency', 'budget', 'context', 'api'];
const names = { frequency: '更新频率', budget: '演算预算', context: '读取上下文', api: 'API 路由' };
const budgets: { key: keyof T2Budget; name: string }[] = [
  { key: 'maxRows', name: '最多处理对象' },
  { key: 'maxNewRows', name: '最多新增对象' },
  { key: 'maxRequests', name: '最多请求次数' },
  { key: 'maxContextChars', name: '最多上下文字数' },
];
const sources: { id: T2ContextSettings['sources'][number]; name: string }[] = [
  { id: 'story', name: '剧情' },
  { id: 'mvu', name: 'MVU 前置结果' },
  { id: 'database', name: '数据库前置结果' },
  { id: 'worldbook', name: '原始世界书' },
];
const text = (e: Event) => (e.target as HTMLInputElement).value;
const checked = (e: Event) => (e.target as HTMLInputElement).checked;
function setMode(key: T6ParameterKey, state: string) {
  const next: T6Parameters = structuredClone(props.value);
  if (state === 'inherit' || state === 'disabled') {
    if (props.scope === 'global' && (state === 'inherit' || key !== 'api')) return;
    next[key] = { state };
  } else if (state === 'value') {
    switch (key) {
      case 'frequency':
        next.frequency = { state, value: { ...props.defaults.frequency } };
        break;
      case 'budget':
        next.budget = { state, value: { ...props.defaults.budget } };
        break;
      case 'context':
        next.context = { state, value: structuredClone(props.defaults.context) };
        break;
      case 'api':
        next.api = {
          state,
          value: {
            presetId: props.defaults.api.state === 'value' ? props.defaults.api.value.presetId : 'unconfigured',
          },
        };
        break;
    }
  } else return;
  emit('change', next);
}
function frequency(key: 'every' | 'offset', e: Event) {
  if (props.value.frequency.state !== 'value') return;
  emit('change', {
    ...props.value,
    frequency: { state: 'value', value: { ...props.value.frequency.value, [key]: Number(text(e)) } },
  });
}
function budget(key: keyof T2Budget, e: Event) {
  if (props.value.budget.state !== 'value') return;
  emit('change', {
    ...props.value,
    budget: { state: 'value', value: { ...props.value.budget.value, [key]: Number(text(e)) } },
  });
}
function contextNumber(key: 'maxRows' | 'maxChars' | 'lastAssistantMessages', e: Event) {
  if (props.value.context.state !== 'value') return;
  emit('change', {
    ...props.value,
    context: { state: 'value', value: { ...props.value.context.value, [key]: Number(text(e)) } },
  });
}
function contextArchive(e: Event) {
  if (props.value.context.state !== 'value') return;
  emit('change', {
    ...props.value,
    context: { state: 'value', value: { ...props.value.context.value, includeArchived: checked(e) } },
  });
}
function contextSource(source: T2ContextSettings['sources'][number], e: Event) {
  if (props.value.context.state !== 'value') return;
  const current = props.value.context.value;
  emit('change', {
    ...props.value,
    context: {
      state: 'value',
      value: {
        ...current,
        sources: checked(e) ? [...new Set([...current.sources, source])] : current.sources.filter(s => s !== source),
      },
    },
  });
}
function api(e: Event) {
  emit('change', { ...props.value, api: { state: 'value', value: { presetId: text(e) } } });
}
</script>

<style scoped>
.we-t6-parameters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
section {
  min-width: 0;
  padding: 12px;
  background: var(--we14-soft, #f2f8f3);
  border: 1px solid var(--we14-border, #d8e7dc);
  border-radius: 10px;
}
label {
  display: block;
  margin-bottom: 8px;
  color: var(--we14-text, #294f3c);
}
input:not([type='checkbox']),
select {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 7px;
  color: var(--we14-text, #294f3c);
  background: var(--we14-control, #fcfefb);
  border: 1px solid var(--we14-border, #a9c5b4);
  border-radius: 6px;
}
input[type='checkbox'] {
  accent-color: var(--we14-accent, #397957);
}
p {
  margin: 6px 0;
  font-size: 12px;
  color: var(--we14-muted, #536d5d);
  overflow-wrap: anywhere;
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 2px;
}
@media (max-width: 600px) {
  .we-t6-parameters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
