<script setup lang="ts">
import { computed, ref } from 'vue';
import { createDefaultT2Template } from './t2-defaults';
import { resolveT2TableSettings } from './t2-template';
import type { T4State } from './t4-protocol';
import type { T2Template, T2Table, T2Field, T2Row } from './t2-template';
const props = defineProps<{ state: T4State | null; canEdit: boolean }>();
const emit = defineEmits<{ edit: [] }>();
const template = computed<T2Template>(() => props.state?.template ?? createDefaultT2Template());
const tables = computed<T2Table[]>(() => template.value.tables.filter(t => t.visibility.user));
const selection = ref('');
const selected = computed(() => tables.value.find(t => t.id === selection.value) ?? tables.value[0]);
const fields = computed<T2Field[]>(() => selected.value?.fields.filter(f => f.visibility.user && !f.hiddenUi) ?? []);
const rows = computed<T2Row[]>(() =>
  selected.value
    ? (props.state?.data.tables[selected.value.id] ?? []).filter((r: T2Row) => r.meta.visibility.user)
    : [],
);
const settings = computed(() => (selected.value ? resolveT2TableSettings(template.value, selected.value.id) : null));
const display = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const rowCount = (tableId: string) =>
  (props.state?.data.tables[tableId] ?? []).filter((r: T2Row) => r.meta.visibility.user).length;
</script>
<template>
  <section class="read-tables">
    <nav aria-label="宏观与微观世界表">
      <section v-for="group in template.groups" :key="group.id">
        <h3>{{ group.name }}</h3>
        <p>{{ group.description }}</p>
        <button
          v-for="table in tables.filter(t => t.groupId === group.id)"
          :key="table.id"
          :aria-current="selected?.id === table.id ? 'page' : undefined"
          @click="selection = table.id"
        >
          {{ table.name }}
          <small>{{ rowCount(table.id) }} 条</small>
        </button>
      </section>
    </nav>
    <main v-if="selected">
      <section class="card">
        <h3>{{ selected.name }}</h3>
        <p>{{ selected.description }}</p>
        <p>{{ state ? '这里展示当前聊天已保存的资料。' : '默认表结构已准备好；尚未创建聊天存档，没有演示角色。' }}</p>
        <button :disabled="!canEdit" @click="emit('edit')">
          {{ state ? '编辑当前聊天的资料' : '创建并保存空白默认表' }}
        </button>
      </section>
      <div class="scroll" tabindex="0" aria-label="已保存世界资料">
        <table>
          <thead>
            <tr>
              <th v-for="field in fields" :key="field.id">{{ field.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.meta.id">
              <td v-for="field in fields" :key="field.id">{{ display(row.values[field.id]) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!rows.length" class="empty">当前表没有资料。</p>
      </div>
      <details class="card">
        <summary>字段与结构参数</summary>
        <dl v-for="field in fields" :key="field.id">
          <dt>{{ field.name }}</dt>
          <dd>{{ field.description || '无额外说明' }} · {{ field.type }}</dd>
        </dl>
        <p v-if="settings">
          频率：每 {{ settings.frequency.value?.every ?? '未设置' }} 轮；最大处理记录：{{
            settings.budget.value?.maxRows ?? '未设置'
          }}
          条。
        </p>
        <p>字段与规则的 DIY 编辑沿用原表格工作台，在启用资料编辑后使用。</p>
      </details>
    </main>
  </section>
</template>
<style scoped>
.read-tables {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 16px;
  color: var(--we14-text);
}
nav,
main {
  min-width: 0;
}
nav {
  background: var(--we14-soft);
  border: 1px solid var(--we14-border);
  border-radius: 12px;
  padding: 12px;
}
nav button {
  display: flex;
  justify-content: space-between;
  width: 100%;
  text-align: left;
  margin: 6px 0;
}
nav p,
small {
  color: var(--we14-muted);
  font-size: 0.85em;
}
button {
  font: inherit;
  color: var(--we14-text);
  background: var(--we14-control);
  border: 1px solid var(--we14-border);
  border-radius: 8px;
  padding: 9px 12px;
  white-space: normal;
  cursor: pointer;
}
button[aria-current='page'] {
  background: var(--we14-soft);
  border-color: var(--we14-accent);
  font-weight: 700;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.card {
  padding: 16px;
  border: 1px solid var(--we14-border);
  border-radius: 12px;
  background: var(--we14-card);
  margin-bottom: 14px;
}
.scroll {
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--we14-border);
  border-radius: 10px;
  margin-bottom: 14px;
}
table {
  border-collapse: collapse;
  min-width: 100%;
}
th,
td {
  padding: 12px;
  border-bottom: 1px solid var(--we14-border);
  text-align: left;
  min-width: 110px;
  max-width: 350px;
  overflow-wrap: anywhere;
}
th {
  background: var(--we14-soft);
}
td {
  white-space: pre-wrap;
}
.empty {
  padding: 20px;
  color: var(--we14-muted);
}
dd {
  margin-left: 0;
  color: var(--we14-muted);
}
summary {
  cursor: pointer;
  font-weight: 700;
}
h3 {
  margin-top: 0;
}
:focus-visible {
  outline: 3px solid var(--we14-focus);
  outline-offset: 2px;
}
@container we14 (max-width: 950px) {
  .read-tables {
    grid-template-columns: minmax(0, 1fr);
  }
  nav {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  nav section {
    flex: 1 1 180px;
  }
}
</style>
