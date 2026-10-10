<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, ref } from 'vue';
import type { T5Workbench, T5FieldView, T5View } from './t5-workbench';
import type { T5Input } from './t5-form';

const props = defineProps<{ workbench: T5Workbench; hostMode?: boolean }>();
const model = shallowRef<T5View>(props.workbench.view());
const localError = ref('');
const dangerRow = ref<string | null>(null);
const discard = ref(false);
const sourceText = ref('');
const sourceId = ref('manual-source');
const sheetId = ref('');
const mapping = ref<Record<string, string>>({});
const selectedImports = ref<number[]>([]);
const historyId = ref('');
const nodes = new Map<string, HTMLElement>();
function fieldRef(id: string) {
  return (element: unknown) => {
    if (element) nodes.set(id, element as HTMLElement);
    else nodes.delete(id);
  };
}
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  unsubscribe = props.workbench.subscribe(() => {
    model.value = props.workbench.view();
  });
});
onBeforeUnmount(() => unsubscribe?.());
const readonly = computed(() => model.value.busy || model.value.history !== null);
const sheet = computed(() => model.value.importSheets.find(s => s.id === sheetId.value));
const tableColumns = computed(() => model.value.fields.filter(f => f.shown));
function descriptionFor(item: T5FieldView) {
  return `t5-help-${item.field.id}${item.error ? ` t5-error-${model.value.editor?.tableId}-${item.field.id}` : ''}`;
}
async function act(action: () => unknown | Promise<unknown>) {
  localError.value = '';
  try {
    await action();
  } catch (error) {
    localError.value = error instanceof Error ? error.message : '操作未完成';
  }
  model.value = props.workbench.view();
}
function update(field: T5FieldView, patch: Partial<T5Input>) {
  void act(() => props.workbench.setInput(field.field.id, { ...field.input, mode: 'value', ...patch }));
}
const textValue = (event: Event) => (event.target as HTMLInputElement).value;
const checkedValue = (event: Event) => (event.target as HTMLInputElement).checked;
function readImportText(text: string): unknown {
  if (text.length > 4_000_000) throw new Error('导入文本太大，请先拆分来源。');
  return JSON.parse(text);
}
function chooseReferences(field: T5FieldView, event: Event) {
  const keys = Array.from((event.target as HTMLSelectElement).selectedOptions, option => option.value).filter(Boolean);
  update(field, { references: field.choices.filter(c => keys.includes(c.key)).map(c => c.reference) });
}
async function stage() {
  await act(() => props.workbench.stageEditor());
  await nextTick();
  const firstError = model.value.editor?.fields.find(f => f.error);
  if (firstError) nodes.get(firstError.field.id)?.focus();
}
async function loadFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await act(async () => {
    if (file.size > 4_000_000) throw new Error('导入文件太大，请先拆分来源。');
    sourceText.value = await file.text();
    props.workbench.loadImport(readImportText(sourceText.value));
    sheetId.value = props.workbench.view().importSheets[0]?.id ?? '';
    mapping.value = {};
    selectedImports.value = [];
  });
}
function selectImport(index: number, checked: boolean) {
  selectedImports.value = checked ? [...selectedImports.value, index] : selectedImports.value.filter(i => i !== index);
}
</script>

<template>
  <section class="we-t5" aria-label="世界演变表格工作台" :aria-busy="model.busy">
    <header class="we-t5__header">
      <div>
        <h2>表格工作台</h2>
        <p>
          先建立宏观条件，再填写微观对象。{{ hostMode ? '这里编辑当前聊天的世界资料。' : '这里是可编辑的独立沙盒。' }}
        </p>
      </div>
      <span class="we-t5__badge">{{ model.history ? '历史只读' : `当前世界 · 版本 ${model.revision}` }}</span>
    </header>
    <p class="we-t5__notice">
      {{ hostMode ? '当前聊天资料：查看和暂存不保存；确认保存才会写入聊天。不调用模型，不写世界书。' : model.notice }}
    </p>
    <p class="we-t5__muted">
      跨表切换会保留填写和暂存草稿；关闭或刷新不会自动保存。{{
        hostMode ? '已确认保存的资料会随当前聊天恢复。' : '模拟存档需由测试宿主持有或导出后才能跨刷新恢复。'
      }}
    </p>
    <p v-if="model.busy" role="status">正在校验或读回存档，搜索和浏览仍可使用；暂时不能编辑。</p>
    <p v-if="localError || model.error" class="we-t5__danger" role="alert">{{ localError || model.error }}</p>
    <p v-if="model.message" role="status" class="we-t5__success">{{ model.message }}</p>
    <div class="we-t5__layout">
      <nav class="we-t5__nav" aria-label="宏观与微观表组">
        <section
          v-for="group in [
            { id: 'macro', name: '宏观世界' },
            { id: 'micro', name: '微观世界' },
          ]"
          :key="group.id"
        >
          <h3>{{ group.name }}</h3>
          <button
            v-for="table in model.tables.filter(t => t.groupId === group.id)"
            :key="table.id"
            type="button"
            :aria-current="model.table.id === table.id ? 'page' : undefined"
            @click="act(() => workbench.selectTable(table.id))"
          >
            {{ table.name }} <span>{{ table.count }}</span>
          </button>
        </section>
      </nav>
      <main class="we-t5__main">
        <section class="we-t5__card">
          <div class="we-t5__toolbar">
            <div>
              <h3>{{ model.table.name }}</h3>
              <p>{{ model.table.description }}</p>
            </div>
            <button
              type="button"
              class="we-t5__primary"
              :disabled="!model.canAdd"
              @click="act(() => workbench.beginNew())"
            >
              新增 {{ model.table.name }}
            </button>
          </div>
          <div class="we-t5__filters">
            <label
              >搜索<input
                :value="model.query"
                type="search"
                placeholder="名称或字段内容"
                @input="workbench.search(textValue($event))"
            /></label>
            <label
              >记录范围<select
                :value="model.filter"
                @change="act(() => workbench.filter(textValue($event) as T5View['filter']))"
              >
                <option value="active">未归档</option>
                <option value="archived">已归档</option>
                <option value="all">全部</option>
                <option value="locked">行锁定</option>
              </select></label
            >
            <details>
              <summary>显示列</summary>
              <label v-for="field in model.fields" :key="field.id" class="we-t5__check"
                ><input
                  type="checkbox"
                  :checked="field.shown"
                  @change="workbench.column(field.id, checkedValue($event))"
                />{{ field.name }}</label
              >
            </details>
          </div>
          <p v-if="!model.total" class="we-t5__empty">
            {{
              model.query
                ? '没有匹配的记录，清空搜索或调整筛选试试。'
                : '这里还没有记录。点击新增，手动填写你的世界；不会自动加入示例 NPC。'
            }}
          </p>
          <div v-else class="we-t5__table-wrap" tabindex="0" aria-label="可横向滚动的资料表">
            <table>
              <caption>
                {{
                  model.table.name
                }}
                ·
                {{
                  model.total
                }}
                条匹配记录
              </caption>
              <thead>
                <tr>
                  <th scope="col">记录 / 操作</th>
                  <th v-for="field in tableColumns" :key="field.id" scope="col">{{ field.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in model.rows" :key="row.id">
                  <th scope="row">
                    <button type="button" :disabled="model.busy" @click="act(() => workbench.beginEdit(row.id))">
                      {{ row.title }}</button
                    ><small>{{ row.locked ? '已锁定' : '可编辑' }} · {{ row.archived ? '已归档' : '使用中' }}</small>
                    <div class="we-t5__row-actions">
                      <button
                        type="button"
                        :disabled="readonly"
                        @click="act(() => workbench.stageControl(row.id, 'row-lock', null, !row.locked))"
                      >
                        {{ row.locked ? '解锁' : '锁定' }}</button
                      ><button
                        type="button"
                        :disabled="readonly"
                        @click="act(() => workbench.stageControl(row.id, 'archive', null, !row.archived))"
                      >
                        {{ row.archived ? '取消归档' : '归档' }}</button
                      ><button
                        type="button"
                        class="we-t5__danger-button"
                        :disabled="readonly"
                        @click="dangerRow = row.id"
                      >
                        删除
                      </button>
                    </div>
                  </th>
                  <td v-for="cell in row.cells" :key="cell.fieldId">
                    <span>{{ cell.text }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="we-t5__pager">
            <button type="button" :disabled="model.page <= 1" @click="workbench.page(model.page - 1)">上一页</button
            ><span>第 {{ model.page }} / {{ model.pages }} 页 · 每页 20 条</span
            ><button type="button" :disabled="model.page >= model.pages" @click="workbench.page(model.page + 1)">
              下一页
            </button>
          </div>
          <section v-if="dangerRow" class="we-t5__danger" aria-label="删除确认">
            <p>将删除记录 {{ dangerRow }}。这不是归档；引用未解除或记录锁定时会被拒绝。尚未保存，历史仍保留。</p>
            <button
              type="button"
              class="we-t5__danger-button"
              :disabled="readonly"
              @click="
                act(() => workbench.stageDelete(dangerRow!, true)).then(() => {
                  dangerRow = null;
                })
              "
            >
              确认暂存删除</button
            ><button type="button" @click="dangerRow = null">取消</button>
          </section>
        </section>
        <section v-if="model.editor" class="we-t5__card" aria-label="类型化资料编辑器">
          <h3>{{ model.editor.title }}</h3>
          <p>所属表：{{ model.editor.tableName }}。输入会自动选择“填写”；保持原值不会清空资料。</p>
          <form @submit.prevent="stage">
            <fieldset :disabled="readonly">
              <legend>记录字段</legend>
              <div class="we-t5__form-grid">
                <div
                  v-for="item in model.editor.fields"
                  :key="item.field.id"
                  class="we-t5__field"
                  :class="{ 'we-t5__field--wide': item.field.control === 'multiline' }"
                >
                  <label :for="`t5-${model.editor?.tableId}-${item.field.id}`"
                    >{{ item.field.name }}{{ item.field.required ? ' *' : '' }}
                    {{ item.locked ? '（字段锁定）' : '' }}</label
                  >
                  <small :id="`t5-help-${item.field.id}`"
                    >{{ item.field.description }}<br />当前 / 默认：{{ item.current }}</small
                  >
                  <select
                    :value="item.input.mode"
                    :disabled="!item.writable"
                    :aria-label="`${item.field.name}填写方式`"
                    @change="update(item, { mode: textValue($event) as T5Input['mode'] })"
                  >
                    <option value="keep">{{ model.editor?.rowId ? '保持原值' : '使用默认值 / 不提供' }}</option>
                    <option value="value">填写</option>
                    <option v-if="item.field.nullable" value="null">明确空值（NULL）</option>
                  </select>
                  <select
                    v-if="item.field.type === 'enum'"
                    :id="`t5-${model.editor?.tableId}-${item.field.id}`"
                    :ref="fieldRef(item.field.id)"
                    :value="item.input.text"
                    :disabled="!item.writable || item.input.mode === 'null'"
                    :aria-invalid="!!item.error"
                    :aria-describedby="descriptionFor(item)"
                    @change="update(item, { text: textValue($event) })"
                  >
                    <option value="" disabled>请选择</option>
                    <option v-for="choice in item.field.constraints.enumValues" :key="choice" :value="choice">
                      {{ choice }}
                    </option>
                  </select>
                  <select
                    v-else-if="['reference', 'reference-list'].includes(item.field.type)"
                    :id="`t5-${model.editor?.tableId}-${item.field.id}`"
                    :ref="fieldRef(item.field.id)"
                    :multiple="item.field.type === 'reference-list'"
                    :value="
                      item.field.type === 'reference'
                        ? item.input.references[0]
                          ? `${item.input.references[0].tableId}/${item.input.references[0].rowId}`
                          : ''
                        : item.input.references.map(r => `${r.tableId}/${r.rowId}`)
                    "
                    :disabled="!item.writable || item.input.mode === 'null'"
                    :aria-invalid="!!item.error"
                    :aria-describedby="descriptionFor(item)"
                    @change="chooseReferences(item, $event)"
                  >
                    <option v-if="item.field.type === 'reference'" value="">请选择引用</option>
                    <option v-for="choice in item.choices" :key="choice.key" :value="choice.key">
                      {{ choice.label }}
                    </option>
                  </select>
                  <label v-else-if="item.field.type === 'boolean'" class="we-t5__check"
                    ><input
                      :id="`t5-${model.editor?.tableId}-${item.field.id}`"
                      :ref="fieldRef(item.field.id)"
                      type="checkbox"
                      :checked="item.input.checked"
                      :disabled="!item.writable || item.input.mode === 'null'"
                      :aria-invalid="!!item.error"
                      :aria-describedby="descriptionFor(item)"
                      @change="update(item, { checked: checkedValue($event) })"
                    />是 / 否</label
                  >
                  <div v-else-if="item.field.type === 'world-time'" class="we-t5__time">
                    <label
                      >纪元分钟序号<input
                        :id="`t5-${model.editor?.tableId}-${item.field.id}`"
                        :ref="fieldRef(item.field.id)"
                        :value="item.input.minute"
                        inputmode="numeric"
                        :disabled="!item.writable || item.input.mode === 'null'"
                        :aria-invalid="!!item.error"
                        :aria-describedby="descriptionFor(item)"
                        @input="update(item, { minute: textValue($event) })" /></label
                    ><label
                      >显示时间<input
                        :value="item.input.display"
                        :disabled="!item.writable || item.input.mode === 'null'"
                        @input="update(item, { display: textValue($event) })"
                    /></label>
                  </div>
                  <textarea
                    v-else-if="item.field.control === 'multiline' || item.field.type === 'string-list'"
                    :id="`t5-${model.editor?.tableId}-${item.field.id}`"
                    :ref="fieldRef(item.field.id)"
                    :value="item.input.text"
                    rows="3"
                    :disabled="!item.writable || item.input.mode === 'null'"
                    :aria-invalid="!!item.error"
                    :aria-describedby="descriptionFor(item)"
                    :placeholder="item.field.type === 'string-list' ? '每行一项；空文本表示空列表' : '填写内容'"
                    @input="update(item, { text: textValue($event) })"
                  />
                  <input
                    v-else
                    :id="`t5-${model.editor?.tableId}-${item.field.id}`"
                    :ref="fieldRef(item.field.id)"
                    :value="item.input.text"
                    :inputmode="['integer', 'number', 'decimal'].includes(item.field.type) ? 'decimal' : 'text'"
                    :disabled="!item.writable || item.input.mode === 'null'"
                    :aria-invalid="!!item.error"
                    :aria-describedby="descriptionFor(item)"
                    @input="update(item, { text: textValue($event) })"
                  />
                  <p
                    v-if="item.error"
                    :id="`t5-error-${model.editor?.tableId}-${item.field.id}`"
                    class="we-t5__danger"
                    role="alert"
                  >
                    {{ item.error }}
                  </p>
                  <button
                    v-if="model.editor?.rowId && !item.field.readonly && item.field.permissions.manualWrite"
                    type="button"
                    :disabled="readonly"
                    @click="
                      act(() =>
                        workbench.stageControl(
                          model.editor!.rowId!,
                          'field-lock',
                          item.field.id,
                          !item.locked,
                          model.editor!.tableId,
                        ),
                      )
                    "
                  >
                    {{ item.locked ? '解锁字段（单独提交）' : '锁定字段（单独提交）' }}
                  </button>
                </div>
              </div>
            </fieldset>
            <div class="we-t5__editor-actions">
              <button type="submit" class="we-t5__primary" :disabled="readonly">加入暂存修改</button
              ><button type="button" :disabled="model.busy" @click="act(() => workbench.cancelEditor())">
                取消这条填写
              </button>
            </div>
          </form>
        </section>
        <section class="we-t5__card" aria-label="首次资料与导入映射">
          <details>
            <summary>首次建立 / 只读导入已有表格</summary>
            <p>
              可以直接新增环境、地点与 NPC，不需要 MVU 或数据库。已有 JSON 导出也可先做映射预览；不读取前置插件，不调用
              AI，不自动覆盖。
            </p>
            <label
              >来源身份<input
                :value="sourceId"
                placeholder="例如 npc-export-one"
                :disabled="readonly"
                @input="sourceId = textValue($event)" /></label
            ><small>同一份来源使用同一身份和稳定行顺序；更换或重排来源不会按姓名自动合并，需人工比较。</small
            ><label
              >选择 SPDB 导出文件<input
                type="file"
                accept=".json,application/json"
                :disabled="readonly"
                @change="loadFile" /></label
            ><label
              >或粘贴来源 JSON<textarea
                :value="sourceText"
                rows="3"
                :disabled="readonly"
                @input="sourceText = textValue($event)"
              /></label
            ><button
              type="button"
              :disabled="readonly"
              @click="
                act(() => {
                  workbench.loadImport(readImportText(sourceText));
                  sheetId = workbench.view().importSheets[0]?.id ?? '';
                  mapping = {};
                  selectedImports = [];
                })
              "
            >
              读取来源表结构</button
            ><template v-if="model.importSheets.length"
              ><label
                >来源表<select
                  :value="sheetId"
                  :disabled="readonly"
                  @change="
                    sheetId = textValue($event);
                    mapping = {};
                    selectedImports = [];
                  "
                >
                  <option v-for="s in model.importSheets" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select></label
              >
              <p>目标表：{{ model.table.name }}。只映射下面明确选择的字段；数值和引用须符合目标类型，不自动猜测。</p>
              <label v-for="(header, i) in sheet?.headers" :key="i"
                >来源列 {{ header
                }}<select
                  :value="mapping[String(i)] || ''"
                  :disabled="readonly"
                  @change="mapping[String(i)] = textValue($event)"
                >
                  <option value="">不导入此列</option>
                  <option v-for="field in model.fields" :key="field.id" :value="field.id">{{ field.name }}</option>
                </select></label
              ><button
                type="button"
                :disabled="readonly"
                @click="
                  act(() =>
                    workbench.previewImport({
                      sourceId,
                      sheetId,
                      tableId: model.table.id,
                      mapping: Object.entries(mapping)
                        .filter(([, id]) => id)
                        .map(([column, fieldId]) => ({ column: Number(column), fieldId })),
                    }),
                  )
                "
              >
                预览映射与冲突
              </button></template
            ><template v-if="model.importPreview"
              ><p>识别 {{ model.importPreview.total }} 行；每次明确选择最多 10 行分批保存。未选中行不会导入。</p>
              <div class="we-t5__import-rows">
                <label v-for="row in model.importPreview.rows" :key="row.index" class="we-t5__check"
                  ><input
                    type="checkbox"
                    :disabled="readonly || !row.allowed"
                    :checked="selectedImports.includes(row.index)"
                    @change="selectImport(row.index, checkedValue($event))"
                  />第 {{ row.index + 1 }} 行 · {{ row.values.name || '未命名' }} ·
                  {{ row.allowed ? '可导入' : row.issues.join('；') }}</label
                >
              </div>
              <button
                type="button"
                :disabled="readonly || !selectedImports.length"
                @click="
                  act(() => workbench.stageImport(selectedImports)).then(() => {
                    selectedImports = [];
                  })
                "
              >
                将选中行加入暂存
              </button></template
            >
          </details>
        </section>
        <section class="we-t5__card" :aria-label="hostMode ? '当前聊天提交与差异预览' : '模拟提交与差异预览'">
          <h3>暂存修改与保存</h3>
          <p>
            {{
              hostMode
                ? '所有改动先暂存、整批校验，确认后保存到当前聊天的世界演变资料；不改剧情正文。'
                : '所有改动先暂存、整批校验，再保存到同一套模拟账本。不会直接改酒馆聊天。'
            }}
          </p>
          <ul v-if="model.staged.length">
            <li v-for="item in model.staged" :key="item.index">
              {{ item.label }}
              <button type="button" :disabled="readonly" @click="act(() => workbench.unstage(item.index))">移除</button>
            </li>
          </ul>
          <p v-else>没有暂存修改。</p>
          <button type="button" :disabled="readonly || !model.staged.length" @click="act(() => workbench.prepare())">
            校验并预览差异</button
          ><template v-if="model.preview"
            ><p :class="{ 'we-t5__danger': model.preview.tone === 'danger' }">
              {{ model.preview.badge }} · {{ model.preview.explanation }}
            </p>
            <p v-if="model.preview.scope">
              保存范围：{{ hostMode ? '当前聊天' : '模拟聊天' }} {{ model.preview.scope.chatId }} · 世界
              {{ model.preview.scope.worldId }} · 分支 {{ model.preview.scope.branchId }} ·
              {{
                model.preview.anchor
                  ? `${hostMode ? '消息' : '模拟消息'} ${model.preview.anchor.messageId} / ${model.preview.anchor.swipeId}`
                  : '无有效消息锚点，只能保留草稿'
              }}
            </p>
            <div v-for="(change, i) in model.preview.changes" :key="i" class="we-t5__diff">
              <h4>{{ change.tableName }} · {{ change.operation }} · {{ change.rowId }}</h4>
              <dl>
                <template v-for="field in change.fields" :key="field.fieldId"
                  ><dt>{{ field.name }}</dt>
                  <dd>
                    <span>之前：{{ field.before }}</span
                    ><span>之后：{{ field.after }}</span>
                  </dd></template
                >
              </dl>
            </div>
            <p v-if="model.preview.summary.truncated">差异展示已截短；保存仍校验完整批次。</p>
            <label class="we-t5__check"
              ><input
                type="checkbox"
                :checked="model.consent"
                :disabled="readonly || !model.preview.confirmationAllowed"
                @change="workbench.consent(checkedValue($event))"
              />{{
                hostMode ? '我已检查这些修改，保存到当前聊天的世界资料' : '我已检查这些修改，只保存到独立模拟存档'
              }}</label
            ></template
          >
          <div class="we-t5__save-actions">
            <button
              type="button"
              class="we-t5__primary"
              :disabled="!model.canSave"
              @click="act(() => workbench.save())"
            >
              {{ hostMode ? '保存到当前聊天' : '保存模拟存档' }}</button
            ><button type="button" :disabled="model.busy" @click="act(() => workbench.reconcile())">
              核对保存结果
            </button>
          </div>
        </section>
        <section class="we-t5__card">
          <details>
            <summary>重新载入 / 历史只读</summary>
            <label class="we-t5__check"
              ><input
                :checked="discard"
                type="checkbox"
                :disabled="model.busy"
                @change="discard = checkedValue($event)"
              />确认放弃未保存填写与暂存修改</label
            ><button type="button" :disabled="model.busy" @click="act(() => workbench.reload(discard))">
              返回当前世界并重新载入</button
            ><label
              >历史提交 ID（留空为起始快照）<input
                :value="historyId"
                :disabled="readonly"
                @input="historyId = textValue($event)" /></label
            ><button type="button" :disabled="readonly" @click="act(() => workbench.history(historyId || null))">
              只读查看历史
            </button>
            <p>查看历史不会回滚当前世界；历史编辑与结构修改不在这个阶段开放。</p>
          </details>
        </section>
      </main>
    </div>
  </section>
</template>

<style scoped>
.we-t5 {
  --bg: var(--we14-surface, #f0f8f1);
  --card: var(--we14-card, #fcfffc);
  --line: var(--we14-border, #c9dccd);
  --text: var(--we14-text, #254530);
  --muted: var(--we14-muted, #526958);
  --accent: var(--we14-accent, #32744c);
  --pink: var(--we14-danger-bg, #fff0f4);
  --pink-text: var(--we14-danger-text, #8d3551);
  background: var(--bg);
  color: var(--text);
  padding: 20px;
  border-radius: 16px;
  font:
    14px/1.6 system-ui,
    sans-serif;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}
.we-t5 *,
.we-t5 *::before,
.we-t5 *::after {
  box-sizing: border-box;
}
.we-t5 h2,
.we-t5 h3,
.we-t5 h4 {
  margin: 0 0 8px;
  color: var(--text);
}
.we-t5 p {
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.we-t5__header,
.we-t5__toolbar,
.we-t5__pager,
.we-t5__save-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.we-t5__badge,
.we-t5__notice {
  border: 1px solid var(--line);
  background: var(--we14-soft, #e2f0e6);
  padding: 8px 12px;
  border-radius: 10px;
}
.we-t5__muted,
.we-t5 small {
  color: var(--muted);
}
.we-t5__layout {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}
.we-t5__nav {
  align-self: start;
  position: sticky;
  top: 8px;
}
.we-t5__nav section {
  margin-bottom: 20px;
}
.we-t5__nav button {
  width: 100%;
  margin: 4px 0;
  display: flex;
  justify-content: space-between;
  text-align: left;
}
.we-t5__nav [aria-current='page'] {
  background: var(--we14-soft, #d9ebdf);
  border-color: var(--accent);
  font-weight: 700;
}
.we-t5__main {
  min-width: 0;
  display: grid;
  gap: 16px;
}
.we-t5__card {
  min-width: 0;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}
.we-t5 label {
  display: grid;
  gap: 4px;
  margin: 8px 0;
  font-weight: 600;
}
.we-t5 input,
.we-t5 textarea,
.we-t5 select,
.we-t5 button {
  color: var(--text);
  background: var(--we14-control, #fff);
  font: inherit;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 0;
  max-width: 100%;
}
.we-t5 input,
.we-t5 textarea,
.we-t5 select {
  width: 100%;
}
.we-t5 textarea {
  resize: vertical;
}
.we-t5 select[multiple] {
  min-height: 120px;
}
.we-t5 button {
  cursor: pointer;
  overflow-wrap: anywhere;
}
.we-t5 button:disabled,
.we-t5 :disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.we-t5 :focus-visible {
  outline: 3px solid var(--we14-focus, #6b987a);
  outline-offset: 2px;
}
.we-t5 [aria-invalid='true'] {
  border-color: var(--pink-text);
}
.we-t5 .we-t5__primary {
  background: var(--accent);
  color: var(--we14-on-accent, #fff);
  border-color: var(--accent);
}
.we-t5 .we-t5__danger-button,
.we-t5__danger {
  background: var(--pink);
  color: var(--pink-text);
  border: 1px solid var(--we14-danger-border, #e3bdca);
  border-radius: 8px;
  padding: 8px;
}
.we-t5__success {
  color: var(--we14-success-text, #285f3c);
  background: var(--we14-success-bg, #e6f3e9);
  border-radius: 8px;
  padding: 8px;
}
.we-t5__check {
  display: flex !important;
  align-items: center;
  gap: 8px;
  font-weight: 400 !important;
}
.we-t5__check input {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.we-t5__filters {
  display: flex;
  align-items: start;
  gap: 12px;
  flex-wrap: wrap;
}
.we-t5__filters > label {
  flex: 1 1 160px;
}
.we-t5 details {
  min-width: 0;
}
.we-t5 summary {
  cursor: pointer;
  font-weight: 600;
  padding: 8px 0;
}
.we-t5__table-wrap {
  overflow: auto;
  max-height: 480px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.we-t5 table {
  border-collapse: collapse;
  font-size: 13px;
  width: max-content;
  min-width: 100%;
}
.we-t5 caption {
  text-align: left;
  padding: 8px;
}
.we-t5 th,
.we-t5 td {
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
  padding: 10px;
  max-width: 280px;
  min-width: 160px;
}
.we-t5 thead th {
  position: sticky;
  top: 0;
  background: var(--we14-soft, #e9f3ec);
  z-index: 1;
}
.we-t5 td span {
  display: block;
  width: 220px;
  max-height: 100px;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.we-t5 th small {
  display: block;
  font-weight: 400;
}
.we-t5__row-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.we-t5__pager {
  justify-content: center;
  margin-top: 12px;
}
.we-t5__empty {
  padding: 24px;
  background: var(--bg);
  border-radius: 8px;
}
.we-t5 fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.we-t5__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.we-t5__field {
  min-width: 0;
}
.we-t5__field small {
  display: block;
  overflow-wrap: anywhere;
  max-height: 140px;
  overflow: auto;
}
.we-t5__field--wide {
  grid-column: 1 / -1;
}
.we-t5__editor-actions {
  position: sticky;
  bottom: 0;
  background: var(--we14-soft, #e6f1e9);
  padding: 12px;
  border-radius: 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.we-t5__diff {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.we-t5 dt {
  font-weight: 600;
}
.we-t5 dd {
  margin: 0 0 12px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  white-space: pre-wrap;
}
.we-t5__import-rows {
  max-height: 300px;
  overflow: auto;
}
@media (max-width: 850px) {
  .we-t5__layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .we-t5__nav {
    position: static;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .we-t5__nav section {
    flex: 1 1 200px;
    margin: 0;
  }
}
@media (max-width: 600px) {
  .we-t5 {
    padding: 10px;
  }
  .we-t5__card {
    padding: 12px;
  }
  .we-t5__form-grid,
  .we-t5 dd {
    grid-template-columns: minmax(0, 1fr);
  }
  .we-t5__field--wide {
    grid-column: auto;
  }
  .we-t5__toolbar > div {
    width: 100%;
  }
}
</style>
