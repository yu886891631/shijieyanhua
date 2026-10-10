<script setup lang="ts">
import { computed, ref } from 'vue';
import { createT3PreviewModel } from './t3-preview';

const props = defineProps<{
  template?: unknown;
  result?: unknown;
  baseData?: unknown;
  error?: unknown;
  limits?: unknown;
  initialTableId?: string;
}>();
const selectedTableId = ref(props.initialTableId ?? '');
const model = computed(() =>
  createT3PreviewModel({
    ...(props.template === undefined ? {} : { template: props.template }),
    ...(props.result === undefined ? {} : { result: props.result }),
    ...(props.baseData === undefined ? {} : { baseData: props.baseData }),
    ...(props.error === undefined ? {} : { error: props.error }),
    ...(props.limits === undefined ? {} : { limits: props.limits }),
  }),
);
const selected = computed(
  () => model.value.tables.find(table => table.id === selectedTableId.value) ?? model.value.tables[0],
);
</script>

<template>
  <section class="we-t3-preview" aria-label="T3 SQL只读预览">
    <header>
      <p class="we-t3-eyebrow">T3 · 隔离只读预览</p>
      <h2>表格与SQL校验结果</h2>
      <p>这里只展示私有草稿；不会保存当前聊天、调用API或写入世界书。</p>
      <p class="we-t3-note">只显示用户可见的表、行、字段和计数；原始SQL、参数及错误原文不在此公开。</p>
    </header>
    <div v-if="model.error" class="we-t3-error" role="alert">
      <strong>{{ model.error.label }}</strong>
      <p v-if="model.error.statement !== null">出错语句：第{{ model.error.statement }}条</p>
      <p v-if="model.error.field">相关字段：{{ model.error.field }}</p>
      <p>本批未被接受；错误细节仅在能确认用户可见时显示。</p>
    </div>
    <template v-if="model.status !== 'invalid'">
      <div class="we-t3-summary">
        <div>
          <span>可见修改记录</span><strong>{{ model.summary.changedRows }}</strong>
        </div>
        <div>
          <span>可见新增记录</span><strong>{{ model.summary.newRows }}</strong>
        </div>
        <div>
          <span>可见查询行</span><strong>{{ model.summary.queryRows }}</strong>
        </div>
        <div>
          <span>可见语句摘要</span><strong>{{ model.summary.statements }}</strong>
        </div>
      </div>
      <p v-if="model.status === 'empty'" class="we-t3-note">
        尚未提供SQL执行结果；这里只读展示模板或明确传入的基线。默认模板只建立空表，不加载示例角色。
      </p>
      <p v-if="model.status === 'success'" class="we-t3-note">隔离批次校验通过，结果仍未提交到聊天存档。</p>
      <section class="we-t3-card">
        <h3>基础表预览 · {{ model.templateName }}</h3>
        <nav aria-label="切换用户可见表">
          <button
            v-for="table in model.tables"
            :key="table.id"
            type="button"
            :aria-current="selected?.id === table.id ? 'page' : undefined"
            @click="selectedTableId = table.id"
          >
            {{ table.groupId === 'macro' ? '宏观' : '微观' }} · {{ table.name }}
          </button>
        </nav>
        <template v-if="selected">
          <h4>{{ selected.name }}</h4>
          <div class="we-t3-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">稳定ID</th>
                  <th v-for="field in selected.fields" :key="field.id" scope="col">{{ field.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in selected.rows" :key="row.id">
                  <th scope="row">{{ row.id }}</th>
                  <td v-for="cell in row.cells" :key="cell.fieldId">{{ cell.text }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!selected.rows.length" class="we-t3-note">
            当前可见范围没有记录。未填写、NULL、空串和零值会分别保留。
          </p>
        </template>
        <p v-else class="we-t3-note">没有可以公开展示的表。</p>
      </section>
      <section class="we-t3-card">
        <h3>预算与校验摘要</h3>
        <p class="we-t3-note">以下是展示用预算，不授予执行或保存权限。</p>
        <dl>
          <div v-for="limit in model.limits" :key="limit.label">
            <dt>{{ limit.label }}</dt>
            <dd>{{ limit.value }}</dd>
          </div>
        </dl>
        <ul v-if="model.statements.length">
          <li v-for="statement in model.statements" :key="statement.index">
            {{ statement.operation }} · {{ statement.tableName }} · {{ statement.rowCount }}条可见记录
            <span v-if="statement.fields.length"> · 字段：{{ statement.fields.join('、') }}</span>
          </li>
        </ul>
        <p v-else class="we-t3-note">没有可公开显示的语句摘要。</p>
      </section>
      <section class="we-t3-card">
        <h3>用户可见的查询结果</h3>
        <article v-for="query in model.queries" :key="query.index">
          <h4>{{ query.tableName }} · 查询{{ query.index }}</h4>
          <div class="we-t3-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">稳定ID</th>
                  <th v-for="field in query.fields" :key="field" scope="col">{{ field }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in query.rows" :key="row.id">
                  <th scope="row">{{ row.id }}</th>
                  <td v-for="(cell, index) in row.cells" :key="index">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
        <p v-if="!model.queries.length" class="we-t3-note">没有可公开展示的查询结果。</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.we-t3-preview {
  color: #29443a;
  background: #f5f7ed;
  border: 1px solid #d3e1cd;
  border-radius: 16px;
  padding: 20px;
  overflow-wrap: anywhere;
  font:
    14px/1.65 system-ui,
    sans-serif;
}
.we-t3-preview h2,
.we-t3-preview h3,
.we-t3-preview h4,
.we-t3-preview p {
  margin: 0 0 10px;
}
.we-t3-eyebrow {
  color: #477b60;
  font-weight: 700;
}
.we-t3-note {
  color: #617166;
  font-size: 13px;
}
.we-t3-card {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid #dae4d4;
  border-radius: 12px;
  background: #fffef9;
}
.we-t3-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.we-t3-summary div {
  background: #e8f0df;
  border-radius: 10px;
  padding: 12px;
}
.we-t3-summary span,
.we-t3-summary strong {
  display: block;
}
.we-t3-summary strong {
  font-size: 22px;
}
.we-t3-error {
  margin-top: 16px;
  padding: 14px;
  background: #fce9ec;
  color: #803d50;
  border: 1px solid #edc1cd;
  border-radius: 12px;
}
.we-t3-preview nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.we-t3-preview button {
  padding: 7px 10px;
  border: 1px solid #c9d9bf;
  border-radius: 8px;
  color: inherit;
  background: #f5f7ed;
  cursor: pointer;
}
.we-t3-preview button[aria-current] {
  background: #dbeccf;
  border-color: #6f986a;
}
.we-t3-preview button:focus-visible {
  outline: 2px solid #507e58;
  outline-offset: 3px;
}
.we-t3-table-wrap {
  max-width: 100%;
  overflow-x: auto;
}
.we-t3-preview table {
  border-collapse: collapse;
  width: 100%;
}
.we-t3-preview th,
.we-t3-preview td {
  padding: 8px;
  border: 1px solid #dce5d4;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
}
.we-t3-preview thead th {
  background: #e8f0df;
}
.we-t3-preview dl {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 24px;
  margin: 0 0 10px;
}
.we-t3-preview dl div {
  display: flex;
  gap: 8px;
}
.we-t3-preview dd {
  margin: 0;
  font-weight: 700;
}
.we-t3-preview ul {
  margin: 8px 0 0;
  padding-left: 20px;
}
@media (max-width: 680px) {
  .we-t3-preview {
    padding: 12px;
  }
  .we-t3-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .we-t3-card {
    padding: 12px;
  }
}
</style>
