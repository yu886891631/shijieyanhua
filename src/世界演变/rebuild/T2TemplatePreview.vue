<script setup lang="ts">
import { computed, ref } from 'vue';
import { createDefaultT2Template } from './t2-defaults';
import { normalizeT2Template, resolveT2TableSettings } from './t2-template';
import { describeT2FieldControl } from './t2-values';

const props = defineProps<{ template?: unknown; initialTableId?: string }>();
// No production entry imports this component. Only validated template metadata is shown.
const preview = computed(() => {
  try {
    return {
      template: normalizeT2Template(props.template === undefined ? createDefaultT2Template() : props.template),
      error: null,
    };
  } catch (error) {
    return { template: null, error: error instanceof Error ? error.message : '模板未通过校验' };
  }
});
const validatedTemplate = computed(() => preview.value.template);
const groups = computed(() => {
  const model = validatedTemplate.value;
  return (
    model?.groups.map(group => ({ ...group, tables: model.tables.filter(table => table.groupId === group.id) })) ?? []
  );
});
const selectedTableId = ref(props.initialTableId ?? '');
const selected = computed(
  () =>
    validatedTemplate.value?.tables.find(table => table.id === selectedTableId.value) ??
    validatedTemplate.value?.tables[0],
);
const fields = computed(() => {
  const table = selected.value;
  return (
    table?.fields.map(field => ({
      ...describeT2FieldControl(field, { rowLocked: table.locked || !table.permissions.manual.update }),
      visibility: field.visibility,
      permissions: field.permissions,
    })) ?? []
  );
});
const settings = computed(() => {
  const spec = validatedTemplate.value;
  const table = selected.value;
  return spec && table ? resolveT2TableSettings(spec, table.id) : null;
});
const controlLabels: Record<string, string> = {
  text: '文本输入',
  number: '数值输入',
  checkbox: '布尔开关',
  select: '枚举选择',
  textarea: '多行文本',
  reference: '稳定引用选择',
  list: '列表输入',
  'world-time': '世界时间输入',
};
const ruleLabels: Record<string, string> = {
  initialize: '初始化',
  insert: '新增',
  update: '更新',
  archive: '归档',
  delete: '删除',
};
const settingLabels: Record<string, string> = {
  frequency: '演算频率',
  budget: '数量与请求预算',
  context: '上下文范围',
  api: 'API 来源',
};
const sourceLabels: Record<string, string> = {
  global: '全局设置',
  phase: '阶段设置',
  table: '本表设置',
  disabled: '明确关闭',
};
const settingRows = computed(() => {
  const resolved = settings.value;
  return resolved
    ? (['frequency', 'budget', 'context', 'api'] as const).map(key => ({
        key,
        label: settingLabels[key],
        ...resolved[key],
      }))
    : [];
});

function display(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '未提供');
}
</script>

<template>
  <section class="we-t2" aria-label="世界演变 T2 模板只读预览">
    <header class="we-t2-header">
      <p class="we-t2-eyebrow">T2 · 独立内存预览</p>
      <h1>{{ validatedTemplate?.name ?? '模板预览' }}</h1>
      <p>只查看表结构与规则。没有世界资料行，不保存当前聊天，不调用 API 或世界书。</p>
      <p>采用模板只建立空表；固定虚构资料另行提供，不会自动补种。</p>
    </header>
    <section v-if="preview.error" class="we-t2-error" role="alert">
      <h2>模板未通过校验</h2>
      <p>{{ preview.error }}</p>
      <p>没有采用这份模板，也没有修改世界资料。请核对标出的字段或版本。</p>
    </section>
    <div v-else-if="validatedTemplate" class="we-t2-layout">
      <nav class="we-t2-navigation" aria-label="宏观与微观默认表">
        <section v-for="group in groups" :key="group.id">
          <h2>{{ group.name }}</h2>
          <button
            v-for="table in group.tables"
            :key="table.id"
            type="button"
            :aria-current="selected?.id === table.id ? 'page' : undefined"
            @click="selectedTableId = table.id"
          >
            {{ table.name }}
          </button>
        </section>
      </nav>
      <main v-if="selected" class="we-t2-main">
        <section class="we-t2-card">
          <h2>{{ selected.name }} · 结构与参数</h2>
          <p>{{ selected.description }}</p>
          <p class="we-t2-note">字段及规则来自同一份规范模板。修改和迁移入口在后续阶段接入。</p>
        </section>
        <section class="we-t2-card" aria-label="字段与输入控件映射">
          <h2>字段与输入方式</h2>
          <article v-for="field in fields" :key="field.fieldId" class="we-t2-field">
            <h3>{{ field.label }}</h3>
            <p>{{ field.description }}</p>
            <p>
              {{ controlLabels[field.inputType] ?? field.inputType }} ·
              {{ field.required ? '必须提供' : '允许未提供' }} · {{ field.nullable ? '允许 NULL' : '不允许 NULL' }}
            </p>
            <p>
              {{ field.readonly ? '禁止普通修改' : '可按权限编辑' }} ·
              {{ field.hiddenUi ? '数据页默认隐藏；不是保密权限' : '数据页默认显示' }}
            </p>
            <p>
              允许读取：用户 {{ field.visibility.user ? '是' : '否' }} / 演变 AI
              {{ field.visibility.evolutionAi ? '是' : '否' }} / 主 AI
              {{ field.visibility.mainAi ? '是' : '否' }}。允许修改：人工
              {{ field.permissions.manualWrite ? '是' : '否' }} / AI {{ field.permissions.aiWrite ? '是' : '否' }}。
            </p>
            <p>默认值：{{ field.hasDefault ? display(field.defaultValue) : '未设置；恢复时不补值' }}</p>
            <p v-if="field.constraintText">{{ field.constraintText }}</p>
            <p v-if="field.options">可选值：{{ field.options.join('、') }}</p>
          </article>
        </section>
        <section class="we-t2-card" aria-label="生命周期规则">
          <h2>初始化与生命周期</h2>
          <dl>
            <template v-for="(value, key) in selected.rules" :key="key">
              <dt>{{ ruleLabels[key] ?? key }}</dt>
              <dd>{{ display(value) }}</dd>
            </template>
          </dl>
        </section>
        <section class="we-t2-card" aria-label="继承配置预览">
          <h2>继承与关闭状态</h2>
          <p>“继承”使用上级设置；“关闭”停用对应能力；具体值仍受整轮硬上限约束。</p>
          <p class="we-t2-note">仅解释模板配置，不解析旧 API Key、不发请求、不生成运行计划。</p>
          <p v-if="settings">
            自动更新：{{ settings.enabled ? '启用；仍需频率与权限检查' : '关闭；允许读取的世界条件仍保留' }}
          </p>
          <dl v-if="settings">
            <template v-for="setting in settingRows" :key="setting.key">
              <dt>{{ setting.label }}</dt>
              <dd>
                {{ setting.state === 'disabled' ? '关闭' : '使用具体值' }} · 来源：{{
                  sourceLabels[setting.source] ?? setting.source
                }}
              </dd>
            </template>
          </dl>
          <details v-if="settings">
            <summary>查看解析后的配置与来源</summary>
            <pre>{{ display(settings) }}</pre>
          </details>
        </section>
        <section class="we-t2-card" aria-label="独立读取与操作权限">
          <h2>读取与修改分开</h2>
          <p>用户、演变 AI、主 AI 的可见性各自设置。列隐藏不改变读取权限，关闭 AI 更新不删除可读条件。</p>
          <details>
            <summary>查看表级权限</summary>
            <pre>{{
              display({ visibility: selected.visibility, permissions: selected.permissions, locked: selected.locked })
            }}</pre>
          </details>
        </section>
        <section class="we-t2-card" aria-label="世界书导出配置预览">
          <h2>世界书导出规则</h2>
          <p>仅展示模板设置，不写入世界书。实际导出还必须过滤表、行、字段的主 AI 读取权限。</p>
          <details>
            <summary>查看本表导出配置</summary>
            <pre>{{ display(selected.export) }}</pre>
          </details>
        </section>
      </main>
      <p v-else class="we-t2-note">模板没有可预览的业务表。</p>
    </div>
  </section>
</template>

<style scoped>
.we-t2 {
  box-sizing: border-box;
  width: 100%;
  max-width: 72rem;
  margin-inline: auto;
  color: #273c32;
  background: #fffdf6;
  border: 1px solid #ccdacf;
  border-radius: 1rem;
  font: inherit;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.we-t2 * {
  box-sizing: border-box;
}
.we-t2 h1,
.we-t2 h2,
.we-t2 h3,
.we-t2 p {
  margin: 0;
}
.we-t2 h1 {
  font-size: 1.5rem;
}
.we-t2 h2 {
  font-size: 1.1rem;
}
.we-t2 h3 {
  font-size: 1rem;
}
.we-t2 p + p {
  margin-top: 0.45rem;
}
.we-t2-header {
  padding: 1rem;
  border-bottom: 1px solid #ccdacf;
  background: #e9f3e8;
  border-radius: 1rem 1rem 0 0;
}
.we-t2-eyebrow,
.we-t2-note {
  color: #596b60;
  font-size: 0.875rem;
}
.we-t2-layout {
  display: grid;
  grid-template-columns: minmax(9rem, 12rem) minmax(0, 1fr);
}
.we-t2-navigation {
  padding: 1rem;
  border-right: 1px solid #ccdacf;
  min-width: 0;
}
.we-t2-navigation section + section {
  margin-top: 1rem;
}
.we-t2 button {
  display: block;
  width: 100%;
  margin-top: 0.45rem;
  padding: 0.55rem 0.75rem;
  color: inherit;
  background: #fffdf6;
  border: 1px solid #ccdacf;
  border-radius: 0.6rem;
  font: inherit;
  text-align: left;
  white-space: normal;
  cursor: pointer;
}
.we-t2 [aria-current='page'] {
  background: #e9f3e8;
  border-color: #427052;
  font-weight: 700;
}
.we-t2 :focus-visible {
  outline: 2px solid #427052;
  outline-offset: 3px;
}
.we-t2-main {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  min-width: 0;
}
.we-t2-card {
  padding: 1rem;
  border: 1px solid #ccdacf;
  border-radius: 0.8rem;
  min-width: 0;
}
.we-t2-error {
  margin: 1rem;
  padding: 1rem;
  border: 1px solid #dca5b6;
  border-radius: 0.8rem;
  background: #fbe7ed;
  color: #8c314e;
}
.we-t2-field {
  padding-block: 0.8rem;
  border-bottom: 1px solid #ccdacf;
}
.we-t2-field:last-child {
  border-bottom: 0;
}
.we-t2 dt {
  font-weight: 700;
}
.we-t2 dd {
  margin: 0.2rem 0 0.65rem;
}
.we-t2 details {
  margin-top: 0.65rem;
}
.we-t2 summary {
  cursor: pointer;
}
.we-t2 pre {
  margin: 0.6rem 0 0;
  padding: 0.75rem;
  background: #e9f3e8;
  border-radius: 0.6rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.8rem;
}
@media (max-width: 42rem) {
  .we-t2-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .we-t2-navigation {
    border-right: 0;
    border-bottom: 1px solid #ccdacf;
  }
}
</style>
