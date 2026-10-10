<template>
  <div class="we-t6-cell-setting">
    <label
      >{{ label }}方式<select :aria-label="`${label}方式`" :value="mode" @change="modeChanged">
        <option value="none">{{ absentLabel }}</option>
        <option v-if="field.nullable" value="null">明确空值 NULL</option>
        <option value="value">指定值</option>
      </select></label
    >
    <template v-if="mode === 'value'">
      <label v-if="field.type === 'boolean'"
        ><input type="checkbox" :checked="checked" @change="boolChanged" />是 / 否</label
      >
      <select v-else-if="field.type === 'enum'" :aria-label="`${label}枚举值`" :value="text" @change="textChanged">
        <option value="">选择枚举值</option>
        <option v-for="choice in field.constraints.enumValues" :key="choice" :value="choice">{{ choice }}</option>
      </select>
      <template v-else-if="field.type === 'world-time'">
        <label>纪元分钟<input :value="minute" inputmode="numeric" @input="minuteChanged" /></label
        ><label>显示时间<input :value="display" @input="displayChanged" /></label>
      </template>
      <textarea
        v-else
        :aria-label="`${label}内容`"
        :value="text"
        rows="3"
        :placeholder="hint"
        @input="textChanged"
      ></textarea>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { T2Cell, T2Field, T2Reference } from './t2-template';
import { validateT2Cell } from './t2-values';
const props = defineProps<{ field: T2Field; value?: T2Cell; present: boolean; label: string; absentLabel: string }>();
const emit = defineEmits<{ change: [value: { present: boolean; value: T2Cell | null }]; validity: [valid: boolean] }>();
const mode = ref('none'),
  text = ref(''),
  checked = ref(false),
  minute = ref(''),
  display = ref(''),
  error = ref('');
watch(
  () => [props.field.id, props.field.type, props.present, JSON.stringify(props.value)],
  () => {
    mode.value = !props.present ? 'none' : props.value === null ? 'null' : 'value';
    error.value = '';
    emit('validity', true);
    const value = props.value;
    if (value && (props.field.type === 'reference' || props.field.type === 'reference-list')) {
      const refs = props.field.type === 'reference' ? [value as T2Reference] : (value as T2Reference[]);
      text.value = refs.map(r => `${r.tableId}/${r.rowId}`).join('\n');
    } else if (value && props.field.type === 'world-time') {
      const time = value as { ordinalMinute: number; display: string };
      minute.value = String(time.ordinalMinute);
      display.value = time.display;
    } else {
      text.value = Array.isArray(value) ? value.join('\n') : value === undefined || value === null ? '' : String(value);
      checked.value = value === true;
    }
  },
  { immediate: true },
);
const hint = computed(() =>
  props.field.type === 'string-list'
    ? '每行一项；空内容表示空列表'
    : props.field.type === 'reference' || props.field.type === 'reference-list'
      ? '稳定引用：表ID/记录ID；多引用每行一项。整图预检会检查记录是否存在。'
      : '按字段类型填写，不接受自动截断',
);
function publish() {
  try {
    if (mode.value === 'none') {
      emit('change', { present: false, value: null });
      error.value = '';
      emit('validity', true);
      return;
    }
    let value: unknown = mode.value === 'null' ? null : text.value;
    if (mode.value === 'value') {
      if (props.field.type === 'boolean') value = checked.value;
      if (props.field.type === 'integer' || props.field.type === 'number') {
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text.value)) throw new Error();
        value = Number(text.value);
      }
      if (props.field.type === 'string-list') value = text.value === '' ? [] : text.value.split('\n');
      if (props.field.type === 'reference' || props.field.type === 'reference-list') {
        const refs =
          text.value === ''
            ? []
            : text.value.split('\n').map(line => {
                const parts = line.split('/');
                if (parts.length !== 2) throw new Error();
                return { tableId: parts[0], rowId: parts[1] };
              });
        if (props.field.type === 'reference' && refs.length !== 1) throw new Error();
        value = props.field.type === 'reference' ? refs[0] : refs;
      }
      if (props.field.type === 'world-time') {
        if (!/^\d+$/.test(minute.value)) throw new Error();
        value = {
          calendarId: props.field.constraints.calendarId,
          ordinalMinute: Number(minute.value),
          display: display.value,
        };
      }
    }
    emit('change', { present: true, value: validateT2Cell(props.field, value) });
    error.value = '';
    emit('validity', true);
  } catch {
    error.value = '填写未通过类型校验，尚未采用此值。';
    emit('validity', false);
  }
}
const valueOf = (e: Event) => (e.target as HTMLInputElement).value;
function modeChanged(e: Event) {
  mode.value = valueOf(e);
  publish();
}
function textChanged(e: Event) {
  text.value = valueOf(e);
  publish();
}
function minuteChanged(e: Event) {
  minute.value = valueOf(e);
  publish();
}
function displayChanged(e: Event) {
  display.value = valueOf(e);
  publish();
}
function boolChanged(e: Event) {
  checked.value = (e.target as HTMLInputElement).checked;
  publish();
}
</script>

<style scoped>
.we-t6-cell-setting {
  min-width: 0;
  padding: 10px;
  background: var(--we14-soft, #f2f8f3);
  border-radius: 8px;
}
label {
  display: block;
  margin-bottom: 7px;
}
input:not([type='checkbox']),
select,
textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 7px;
  color: var(--we14-text, #294f3c);
  background: var(--we14-control, #fcfefb);
  border: 1px solid var(--we14-border, #a9c5b4);
  border-radius: 6px;
}
textarea {
  resize: vertical;
}
p {
  color: var(--we14-danger-text, #8d3c55);
  overflow-wrap: anywhere;
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 2px;
}
</style>
