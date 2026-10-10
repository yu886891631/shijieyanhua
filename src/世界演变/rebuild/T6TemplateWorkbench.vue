<template>
  <section class="we-t6-workbench">
    <header>
      <h2>结构与参数</h2>
      <p>
        {{
          hostMode
            ? '当前聊天的结构与参数：先调整草稿，再校验迁移差异；确认保存后更新当前聊天的模板与资料。'
            : model.notice
        }}
      </p>
      <p>
        当前资料版本 {{ model.revision }} · 模板版本 {{ model.version }} ·
        {{ model.dirty ? '有未保存结构草稿' : '没有结构草稿' }}
      </p>
    </header>
    <p v-if="uiError || model.error" role="alert" class="danger">{{ uiError || model.error }}</p>
    <p v-if="model.message" role="status">{{ model.message }}</p>
    <p v-if="!model.template" class="danger">
      包含非公开结构定义，本工作台不展开。可以取消本次草稿；不会显示隐藏资料。
    </p>
    <div v-else class="layout">
      <aside aria-label="结构表列表">
        <section v-for="group in model.template.groups" :key="group.id">
          <h3>{{ group.name }}</h3>
          <button
            v-for="listedTable in tablesInGroup(group.id)"
            :key="listedTable.id"
            type="button"
            :aria-pressed="model.tableId === listedTable.id"
            :disabled="model.busy"
            @click="act(() => workbench.selectTable(listedTable.id))"
          >
            {{ listedTable.name }} <small>{{ listedTable.id }}</small>
          </button>
        </section>
        <form @submit.prevent="addTable">
          <h3>新增业务表</h3>
          <label
            >新表 ID<input
              :value="tableIdDraft"
              placeholder="如 market；建立后不改"
              @input="tableIdDraft = text($event)"
          /></label>
          <label>新表名称<input :value="tableNameDraft" @input="tableNameDraft = text($event)" /></label>
          <label
            >所属组<select :value="tableGroupDraft" @change="setTableGroupDraft">
              <option value="macro">宏观世界</option>
              <option value="micro">微观世界</option>
            </select></label
          >
          <button :disabled="model.busy || model.pending">添加到结构草稿</button>
        </form>
      </aside>
      <main>
        <fieldset v-if="table" :disabled="model.busy || model.pending">
          <legend>表结构 · {{ table.name }}</legend>
          <p>稳定 ID：{{ table.id }} · SQL 名：{{ table.sqlName }}。显示改名不会变更身份。</p>
          <div class="grid">
            <label
              >表名称<input aria-label="表名称" :value="table.name" @change="tablePatch({ name: text($event) })"
            /></label>
            <label
              >所属组<select :value="table.groupId" @change="tableGroup">
                <option value="macro">宏观世界</option>
                <option value="micro">微观世界</option>
              </select></label
            >
            <label
              >业务用途<select :value="table.purpose" @change="tablePurpose">
                <option v-for="purpose in purposes" :key="purpose.id" :value="purpose.id">{{ purpose.name }}</option>
              </select></label
            >
          </div>
          <label
            >表说明<textarea :value="table.description" @change="tablePatch({ description: text($event) })"></textarea>
          </label>
          <div class="actions">
            <button type="button" @click="act(() => workbench.moveTable(-1))">表上移</button
            ><button type="button" @click="act(() => workbench.moveTable(1))">表下移</button
            ><button type="button" class="danger" @click="act(() => workbench.dropTable())">
              移除这张表（仅草稿）
            </button>
          </div>
          <h3>字段列表</h3>
          <div class="field-list">
            <button
              v-for="listedField in table.fields"
              :key="listedField.id"
              type="button"
              :aria-pressed="model.fieldId === listedField.id"
              @click="act(() => workbench.selectField(listedField.id))"
            >
              {{ listedField.name }} <small>{{ listedField.type }} · {{ listedField.id }}</small>
            </button>
          </div>
          <form class="grid" @submit.prevent="addField">
            <label
              >新字段 ID<input
                aria-label="新字段 ID"
                :value="fieldIdDraft"
                placeholder="如 age"
                @input="fieldIdDraft = text($event)" /></label
            ><label
              >新字段名称<input
                aria-label="新字段名称"
                :value="fieldNameDraft"
                @input="fieldNameDraft = text($event)" /></label
            ><button>添加字段</button>
          </form>
        </fieldset>

        <fieldset v-if="field" :disabled="model.busy || model.pending">
          <legend>字段设置 · {{ field.name }}</legend>
          <p>稳定 ID：{{ field.id }} · SQL 名：{{ field.sqlName }}</p>
          <div class="grid">
            <label>字段名称<input :value="field.name" @change="fieldPatch({ name: text($event) })" /></label>
            <label
              >字段类型<select aria-label="字段类型" :value="field.type" @change="fieldType">
                <option v-for="type in T6_TYPES" :key="type" :value="type">{{ typeNames[type] }}</option>
              </select></label
            >
            <label v-if="field.type === 'text'"
              >输入外观<select :value="field.control" @change="textControl">
                <option value="single-line">单行</option>
                <option value="multiline">多行</option>
              </select></label
            >
          </div>
          <label
            >字段说明<textarea
              :value="field.description"
              @change="fieldPatch({ description: text($event) })"
            ></textarea>
          </label>
          <div class="checks">
            <label v-for="flag in fieldFlags" :key="flag.id"
              ><input type="checkbox" :checked="field?.[flag.id]" @change="fieldFlag(flag.id, $event)" />{{
                flag.name
              }}</label
            >
          </div>
          <div class="checks">
            <label
              ><input
                type="checkbox"
                :checked="field.permissions.manualWrite"
                :disabled="field.readonly"
                @change="fieldPermission('manualWrite', $event)"
              />允许人工填写</label
            ><label
              ><input
                type="checkbox"
                :checked="field.permissions.aiWrite"
                :disabled="field.readonly"
                @change="fieldPermission('aiWrite', $event)"
              />允许演变 AI 修改</label
            ><label
              ><input
                type="checkbox"
                :checked="field.visibility.evolutionAi"
                @change="fieldVisibility('evolutionAi', $event)"
              />演变 AI 可读取</label
            ><label
              ><input
                type="checkbox"
                :checked="field.visibility.mainAi"
                @change="fieldVisibility('mainAi', $event)"
              />主 AI 可读取</label
            >
          </div>
          <p>界面隐藏只影响数据显示；只读、锁定与 AI 读取权限是不同的设置。</p>
          <div class="grid">
            <template v-if="field.type === 'integer' || field.type === 'number'"
              ><label
                >最小值（空白不限制）<input
                  :value="field.constraints.min ?? ''"
                  @change="constraintNumber('min', $event)" /></label
              ><label
                >最大值（空白不限制）<input
                  :value="field.constraints.max ?? ''"
                  @change="constraintNumber('max', $event)" /></label
            ></template>
            <label v-if="field.type === 'text' || field.type === 'string-list'"
              >单项最多字数<input
                :value="field.constraints.maxLength ?? ''"
                @change="constraintNumber('maxLength', $event)"
            /></label>
            <label v-if="field.type === 'string-list' || field.type === 'reference-list'"
              >最多列表项<input
                :value="field.constraints.maxItems ?? ''"
                @change="constraintNumber('maxItems', $event)"
            /></label>
            <template v-if="field.type === 'decimal'"
              ><label
                >总位数（最多 15）<input
                  :value="field.constraints.precision"
                  @change="constraintNumber('precision', $event)" /></label
              ><label
                >小数位数<input :value="field.constraints.scale" @change="constraintNumber('scale', $event)" /></label
            ></template>
          </div>
          <label v-if="field.type === 'enum' || field.type === 'string-list'"
            >枚举候选（每行一项；列表类型可留空）<textarea
              :value="field.constraints.enumValues?.join('\n') ?? ''"
              @change="enumValues"
            ></textarea>
          </label>
          <label v-if="field.type === 'enum'"
            >AI 不可自动离开的终态（每行一项；须属于枚举候选）<textarea
              :value="field.constraints.terminalValues?.join('\n') ?? ''"
              @change="terminalValues"
            ></textarea>
          </label>
          <label v-if="field.type === 'world-time'"
            >时间字段用途<select :value="field.semantic ?? 'none'" @change="timeSemantic">
              <option value="none">普通时间，不推断到期或事实</option>
              <option value="deadline">计划期限：用于到期候选</option>
              <option value="fact-time">已发生时刻：不可晚于本轮时间</option>
            </select></label
          >
          <p v-if="field.type === 'world-time' || field.type === 'enum'">
            这些约束随结构迁移一起保存；人工修正仍允许调整终态。它们不证明任意剧情事实。
          </p>
          <template v-if="field.constraints.reference"
            ><h4>可引用的表</h4>
            <div class="checks">
              <label v-for="target in model.template?.tables" :key="target.id"
                ><input
                  type="checkbox"
                  :checked="field?.constraints.reference?.tableIds.includes(target.id)"
                  @change="referenceTable(target.id, $event)"
                />{{ target.name }}</label
              >
            </div>
            <label
              >删除被引用记录时<select :value="field.constraints.reference.onDelete" @change="onDelete">
                <option value="restrict">阻断，先处理引用</option>
                <option value="clear">明确清除引用（受写入权限约束）</option>
              </select></label
            >
          </template>
          <label v-if="field.type === 'world-time'"
            >世界历法<select :value="field.constraints.calendarId" @change="calendar">
              <option v-for="c in model.template?.calendars" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select></label
          >
          <T6CellSetting
            :field="field"
            :value="field.defaultValue"
            :present="Object.hasOwn(field, 'defaultValue')"
            label="新记录默认值"
            absent-label="不设默认值"
            @change="defaultCell"
            @validity="cellValidity('default', $event)"
          />
          <p>改类型会重置类型专属约束与默认值；旧资料只会在迁移预检通过后采用新结构。</p>
          <div class="actions">
            <button type="button" @click="act(() => workbench.moveField(-1))">字段上移</button
            ><button type="button" @click="act(() => workbench.moveField(1))">字段下移</button
            ><button type="button" class="danger" @click="act(() => workbench.dropField())">移除字段（仅草稿）</button>
          </div>

          <h3>此字段的旧资料迁移</h3>
          <label
            >从哪个旧字段取值<select :value="mappingSourceValue()" @change="mappingSource">
              <option value="">不取旧值，只补未提供的值</option>
              <option v-for="old in originalFields" :key="old.id" :value="old.id">{{ old.name }} · {{ old.id }}</option>
            </select></label
          >
          <label
            >明确转换<select :value="mapping?.conversion ?? 'identity'" @change="mappingConversion">
              <option value="identity">原样保留，不强制转换</option>
              <option value="text-integer">完整十进制文字 → 整数</option>
              <option value="text-number">完整十进制文字 → 数值（15 位有效数字上限）</option>
              <option value="scalar-text">文字/数字/布尔 → 文字</option>
            </select></label
          >
          <T6CellSetting
            :key="`fill-${table?.id}-${field.id}`"
            :field="field"
            :value="mapping?.fill"
            :present="!!mapping && Object.hasOwn(mapping, 'fill')"
            label="未提供值时补充"
            absent-label="不补充，保持未填写"
            @change="fillCell"
            @validity="cellValidity('fill', $event)"
          />
          <button type="button" @click="clearMapping">取消此字段的显式迁移方案</button>
          <p>没有显式方案时按同一字段 ID 保留原值；NULL 不是“未提供”，不会被补充值替换。</p>
        </fieldset>

        <fieldset v-if="table && model.template" :disabled="model.busy || model.pending">
          <legend>表级规则、运行与读取</legend>
          <label v-for="rule in ruleNames" :key="rule.id"
            >{{ rule.name }}<textarea :value="table?.rules[rule.id]" @change="ruleText(rule.id, $event)"></textarea>
          </label>
          <div class="checks">
            <label
              ><input type="checkbox" :checked="table.runtime.enabled" @change="runtimeEnabled" />参与自动演变</label
            ><label
              ><input
                type="checkbox"
                :checked="table.locked"
                @change="tablePatch({ locked: checked($event) })"
              />表级锁定</label
            >
          </div>
          <h4>人工与 AI 操作权限</h4>
          <div v-for="actor in actors" :key="actor.id" class="checks">
            <span>{{ actor.name }}</span
            ><label v-for="action in writeNames" :key="action.id"
              ><input
                type="checkbox"
                :checked="table?.permissions[actor.id][action.id]"
                @change="tablePermission(actor.id, action.id, $event)"
              />{{ action.name }}</label
            >
          </div>
          <div class="checks">
            <label
              ><input
                type="checkbox"
                :checked="table.visibility.evolutionAi"
                @change="tableVisibility('evolutionAi', $event)"
              />演变 AI 可读取此表</label
            ><label
              ><input
                type="checkbox"
                :checked="table.visibility.mainAi"
                @change="tableVisibility('mainAi', $event)"
              />主 AI 可读取此表</label
            >
          </div>
          <T6ParameterForm
            :value="tableParameters"
            :defaults="templateDefaults()"
            scope="table"
            label="表级"
            @change="tableParametersChanged"
          />
          <p v-if="model.resolved">
            最终继承来源：频率 {{ sourceNames[model.resolved.frequency.source] }}；预算
            {{ sourceNames[model.resolved.budget.source] }}；上下文
            {{ sourceNames[model.resolved.context.source] }}；API {{ sourceNames[model.resolved.api.source] }}。
          </p>
          <p>这里保存参数；实际发送上下文与 API 行为在 T7 接入，本页不会发送请求。</p>
          <h4>供演变读取的字段</h4>
          <div class="checks">
            <label v-for="f in table.fields" :key="f.id"
              ><input
                type="checkbox"
                :checked="table?.context.fieldIds.includes(f.id)"
                @change="contextField(f.id, $event)"
              />{{ f.name }}</label
            >
          </div>
          <h4>关联读取的表</h4>
          <div class="checks">
            <label v-for="t in model.template.tables" :key="t.id"
              ><input
                type="checkbox"
                :checked="table?.context.relatedTableIds.includes(t.id)"
                @change="relatedTable(t.id, $event)"
              />{{ t.name }}</label
            >
          </div>
        </fieldset>

        <fieldset v-if="table" :disabled="model.busy || model.pending">
          <legend>世界书导出设置（仅配置，不上传）</legend>
          <label
            ><input
              type="checkbox"
              :checked="table.export.enabled"
              @change="exportPatch({ enabled: checked($event) })"
            />允许导出</label
          >
          <div class="grid">
            <label
              >导出方式<select :value="table.export.mode" @change="exportMode">
                <option value="per-row">每条记录一个条目</option>
                <option value="index">合并索引</option>
                <option value="constant">常驻条目</option>
              </select></label
            ><label
              >标题字段<select
                :value="table.export.titleFieldId ?? ''"
                @change="exportPatch({ titleFieldId: text($event) || null })"
              >
                <option value="">不指定</option>
                <option v-for="f in table.fields" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select></label
            ><label
              >单条最多字数<input
                :value="table.export.maxChars"
                @change="exportPatch({ maxChars: Number(text($event)) })"
            /></label>
          </div>
          <h4>导出字段 / 触发关键词字段</h4>
          <div v-for="f in table.fields" :key="f.id" class="checks">
            <span>{{ f.name }}</span
            ><label
              ><input
                type="checkbox"
                :checked="table?.export.fieldIds.includes(f.id)"
                @change="exportField('fieldIds', f.id, $event)"
              />导出内容</label
            ><label
              ><input
                type="checkbox"
                :checked="table?.export.keyFieldIds.includes(f.id)"
                @change="exportField('keyFieldIds', f.id, $event)"
              />关键词</label
            >
          </div>
          <label
            ><input
              type="checkbox"
              :checked="table.export.includeArchived"
              @change="exportPatch({ includeArchived: checked($event) })"
            />包含归档记录</label
          >
          <p>前缀固定 WorldEvolution-；正式投影仍遵守主 AI 可见性，勾选不等于绕过权限。</p>
        </fieldset>

        <details v-if="model.template">
          <summary>全局默认、阶段与世界历法</summary>
          <fieldset :disabled="model.busy || model.pending">
            <legend>模板信息与表组</legend>
            <label
              >模板名称<input
                :value="model.template.name"
                @change="
                  act(() =>
                    workbench.edit(t => {
                      t.name = text($event);
                    }),
                  )
                " /></label
            ><label
              >模板说明<textarea
                :value="model.template.description"
                @change="
                  act(() =>
                    workbench.edit(t => {
                      t.description = text($event);
                    }),
                  )
                "
              ></textarea>
            </label>
            <label v-for="g in model.template.groups" :key="g.id"
              >{{ g.id === 'macro' ? '宏观组名称' : '微观组名称'
              }}<input :value="g.name" @change="groupName(g.id, $event)"
            /></label>
            <T6ParameterForm
              :value="globalT6Parameters(templateDefaults())"
              :defaults="templateDefaults()"
              scope="global"
              label="全局"
              @change="globalParameters"
            />
            <h4>整轮硬上限</h4>
            <div class="grid">
              <label v-for="b in budgetNames" :key="b.id"
                >{{ b.name
                }}<input
                  type="number"
                  min="0"
                  :value="model.template?.hardLimits[b.id]"
                  @change="hardLimit(b.id, $event)"
              /></label>
            </div>
          </fieldset>
          <fieldset v-for="phase in phases" :key="phase.id" :disabled="model.busy || model.pending">
            <legend>{{ phase.name }}</legend>
            <label
              ><input
                type="checkbox"
                :checked="model.template?.phases[phase.id].enabled"
                @change="phaseEnabled(phase.id, $event)"
              />启用此阶段</label
            ><T6ParameterForm
              :value="phaseValues(phase.id)"
              :defaults="templateDefaults()"
              scope="phase"
              :label="phase.name"
              @change="phaseParameters(phase.id, $event)"
            />
          </fieldset>
          <fieldset :disabled="model.busy || model.pending">
            <legend>世界历法</legend>
            <div v-for="c in model.template.calendars" :key="c.id" class="grid">
              <span>{{ c.id }}</span
              ><label>历法名称<input :value="c.name" @change="calendarPatch(c.id, 'name', $event)" /></label
              ><label>纪元<input :value="c.epoch" @change="calendarPatch(c.id, 'epoch', $event)" /></label
              ><label
                >每日分钟<input :value="c.minutesPerDay" @change="calendarPatch(c.id, 'minutesPerDay', $event)"
              /></label>
            </div>
            <p>已有时间值时，不允许静默修改纪元或每日长度。新增/移除历法可在高级规范模板入口提出，仍须迁移预检。</p>
          </fieldset>
        </details>

        <details>
          <summary>高级：规范模板与受限 DDL</summary>
          <fieldset :disabled="model.busy || model.pending">
            <legend>同一结构草稿的高级表达</legend>
            <p>
              普通 DDL：CREATE TABLE … STRICT / ADD COLUMN / DROP COLUMN / DROP TABLE；只支持 TEXT、INTEGER、REAL 和静态
              DEFAULT。完整导出包含规范模板头与精确派生
              DDL，支持所有类型。未知约束、触发器、表达式明确拒绝，不直接执行输入的 SQL。
            </p>
            <div class="actions">
              <button type="button" @click="exportDdl">显示当前 DDL</button
              ><button type="button" @click="exportJson">显示规范模板 JSON</button>
            </div>
            <textarea aria-label="高级结构文本" :value="advanced" rows="8" @input="advanced = text($event)"></textarea>
            <div class="actions">
              <button type="button" @click="act(() => workbench.importDdl(advanced, table?.groupId ?? 'micro'))">
                作为 DDL 导入草稿</button
              ><button type="button" @click="act(() => workbench.replaceTemplate(JSON.parse(advanced)))">
                作为规范模板导入草稿
              </button>
            </div>
          </fieldset>
        </details>

        <section v-if="model.report" class="report" aria-label="迁移预检报告">
          <h3>迁移预检：{{ model.report.valid ? '通过' : '未通过' }}</h3>
          <p>{{ model.report.recovery }}</p>
          <p>公开受影响记录 {{ model.report.changedRows }} 条；模板与资料一次提交，不覆盖原历史。</p>
          <ul>
            <li v-for="(c, i) in model.report.changes" :key="`c${i}`">{{ c.path }}：{{ c.reason }}</li>
            <li v-for="(m, i) in model.report.mappings" :key="`m${i}`">
              {{ m.path }} ← {{ m.from }}，{{ m.conversion }}，补 {{ m.filled }} 条
            </li>
            <li v-for="(r, i) in model.report.removed" :key="`r${i}`" class="danger">
              移除 {{ r.path }}：{{ r.records }} 条记录 / {{ r.values }} 个已有值
            </li>
            <li v-for="(r, i) in model.report.references" :key="`ref${i}`">关系检查 {{ r }}</li>
            <li v-for="(issue, i) in model.report.issues" :key="`i${i}`" class="danger">
              {{ issue.path }}：{{ issue.message }}
            </li>
          </ul>
        </section>
        <section v-if="model.preview" class="report">
          <h3>{{ model.preview.badge }}</h3>
          <p>{{ model.preview.explanation }}</p>
          <p>{{ model.preview.confirmationReason }}</p>
          <article v-for="change in model.preview.changes" :key="`${change.tableId}/${change.rowId}`">
            <h4>{{ change.tableName }} · {{ change.rowId }} · {{ change.operation }}</h4>
            <p v-for="f in change.fields" :key="f.fieldId">{{ f.name }}：{{ f.before }} → {{ f.after }}</p>
          </article>
        </section>
      </main>
    </div>
    <footer>
      <label class="danger"
        ><input
          type="checkbox"
          :checked="model.options.allowRemoval"
          :disabled="model.busy || model.pending"
          @change="removal"
        />允许本次移除表/字段（先看删除报告，旧版本保留）</label
      >
      <p v-if="invalidCells" role="alert" class="danger">
        有尚未采用的默认值或补充值输入，请修正或取消草稿后再预览/保存。
      </p>
      <div class="actions">
        <button
          type="button"
          :disabled="model.busy || model.pending || !model.dirty || invalidCells"
          @click="act(() => workbench.prepare())"
        >
          校验并预览迁移</button
        ><label
          ><input
            type="checkbox"
            :checked="model.consent"
            :disabled="!model.report?.valid || model.busy"
            @change="workbench.consent(checked($event))"
          />{{ hostMode ? '确认当前聊天的结构变更范围与差异' : '确认当前模拟世界范围与差异' }}</label
        ><button
          type="button"
          class="primary"
          :disabled="!model.canSave || invalidCells"
          @click="act(() => workbench.save())"
        >
          {{ hostMode ? '保存当前聊天的结构与资料' : '保存当前模拟世界' }}</button
        ><button type="button" :disabled="model.busy || model.pending" @click="act(() => workbench.discard())">
          取消结构草稿 / 载入当前</button
        ><button type="button" :disabled="model.busy || !model.pending" @click="act(() => workbench.reconcile())">
          核对保存结果
        </button>
      </div>
      <hr />
      <label
        ><input
          type="checkbox"
          :checked="defaultConsent"
          @change="defaultConsent = checked($event)"
        />另存为新世界默认模板；不覆盖当前或其他已有世界</label
      ><button
        type="button"
        :disabled="!defaultConsent || model.busy || model.pending || !!model.preview || invalidCells"
        @click="saveDefault"
      >
        仅保存新世界默认模板
      </button>
      <button type="button" :disabled="model.busy" @click="act(() => workbench.readDefault())">
        读取默认版本（不套用）
      </button>
      <p v-if="model.defaultRevision !== null">独立默认模板版本 {{ model.defaultRevision }}</p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from 'vue';
import type { T2Budget, T2Cell, T2Field, T2Table, T2Template, T2WritePermissions } from './t2-template';
import { T6_TYPES, typeT6Field } from './t6-editor';
import { globalT6Parameters, type T6Parameters } from './t6-parameters';
import type { T6Conversion, T6Mapping } from './t6-migration';
import type { T6View, T6Workbench } from './t6-workbench';
import T6ParameterForm from './T6ParameterForm.vue';
import T6CellSetting from './T6CellSetting.vue';
const props: { workbench: T6Workbench; hostMode?: boolean } = defineProps<{
  workbench: T6Workbench;
  hostMode?: boolean;
}>();
const workbench: T6Workbench = props.workbench;
const model = shallowRef<T6View>(props.workbench.view());
const unsubscribe = props.workbench.subscribe(() => {
  model.value = props.workbench.view();
});
onUnmounted(unsubscribe);
function tablesInGroup(id: 'macro' | 'micro') {
  return model.value.template?.tables.filter(t => t.groupId === id) ?? [];
}
function templateDefaults(): T2Template['defaults'] {
  if (!model.value.template) throw new Error('结构不可读');
  return model.value.template.defaults;
}
function phaseValues(id: 'macro' | 'micro') {
  if (!model.value.template) throw new Error('结构不可读');
  return model.value.template.phases[id];
}
function runtimeEnabled(e: Event) {
  if (table.value) tablePatch({ runtime: { ...table.value.runtime, enabled: checked(e) } });
}
const table = computed(() => model.value.template?.tables.find(t => t.id === model.value.tableId));
const field = computed(() => table.value?.fields.find(f => f.id === model.value.fieldId));
const mapping = computed(() =>
  model.value.options.mappings.find(m => m.tableId === table.value?.id && m.fieldId === field.value?.id),
);
const originalFields = computed(() => model.value.sourceFields);
const cellErrors = shallowRef<Record<string, boolean>>({});
const invalidCells = computed(() => Object.values(cellErrors.value).some(Boolean));
function cellValidity(kind: string, valid: boolean) {
  cellErrors.value = { ...cellErrors.value, [`${model.value.tableId}/${model.value.fieldId}/${kind}`]: !valid };
}
const uiError = ref(''),
  advanced = ref(''),
  defaultConsent = ref(false);
const tableIdDraft = ref(''),
  tableNameDraft = ref(''),
  tableGroupDraft = ref<'macro' | 'micro'>('macro');
const fieldIdDraft = ref(''),
  fieldNameDraft = ref('');
const sourceNames = { global: '全局默认', phase: '所属阶段', table: '本表自定', disabled: '停用' };
const phases: { id: 'macro' | 'micro'; name: string }[] = [
  { id: 'macro', name: '宏观阶段' },
  { id: 'micro', name: '微观阶段' },
];
const purposes: { id: T2Table['purpose']; name: string }[] = [
  { id: 'society', name: '社会' },
  { id: 'environment', name: '环境' },
  { id: 'location', name: '地点' },
  { id: 'npc', name: 'NPC' },
  { id: 'organization', name: '组织' },
  { id: 'plan', name: '计划' },
  { id: 'event', name: '事件' },
  { id: 'custom', name: '自定义业务' },
];
const typeNames: Record<T2Field['type'], string> = {
  text: '文字',
  integer: '整数',
  number: '数值',
  decimal: '精确小数',
  boolean: '是 / 否',
  enum: '枚举',
  'string-list': '文字列表',
  reference: '单引用',
  'reference-list': '多引用',
  'world-time': '世界时间',
};
const fieldFlags: { id: 'required' | 'nullable' | 'readonly' | 'hiddenUi'; name: string }[] = [
  { id: 'required', name: '必填（必须提供）' },
  { id: 'nullable', name: '允许明确空值' },
  { id: 'readonly', name: '只读' },
  { id: 'hiddenUi', name: '数据页隐藏此列' },
];
const ruleNames: { id: keyof T2Table['rules']; name: string }[] = [
  { id: 'initialize', name: '初始化规则' },
  { id: 'insert', name: '新增规则' },
  { id: 'update', name: '更新规则' },
  { id: 'archive', name: '归档规则' },
  { id: 'delete', name: '删除规则' },
];
const actors: { id: 'manual' | 'ai'; name: string }[] = [
  { id: 'manual', name: '人工' },
  { id: 'ai', name: '演变 AI' },
];
const writeNames: { id: keyof T2WritePermissions; name: string }[] = [
  { id: 'insert', name: '新增' },
  { id: 'update', name: '修改' },
  { id: 'archive', name: '归档' },
  { id: 'delete', name: '删除' },
];
const budgetNames: { id: keyof T2Budget; name: string }[] = [
  { id: 'maxRows', name: '最多处理对象' },
  { id: 'maxNewRows', name: '最多新增对象' },
  { id: 'maxRequests', name: '最多请求次数' },
  { id: 'maxContextChars', name: '最多上下文字数' },
];
const tableParameters = computed<T6Parameters>(() => ({
  frequency: table.value?.runtime.frequency ?? { state: 'inherit' },
  budget: table.value?.runtime.budget ?? { state: 'inherit' },
  api: table.value?.runtime.api ?? { state: 'inherit' },
  context: table.value?.context.settings ?? { state: 'inherit' },
}));
const text = (e: Event) => (e.target as HTMLInputElement).value;
const checked = (e: Event) => (e.target as HTMLInputElement).checked;
async function act(action: () => unknown) {
  uiError.value = '';
  try {
    await action();
    if (!model.value.dirty) {
      cellErrors.value = {};
    }
  } catch {
    uiError.value = '未采用此操作。请检查稳定 ID、草稿占用和设置；原存档保留。';
  }
}
function tablePatch(patch: Partial<T2Table>) {
  void act(() => props.workbench.table(patch));
}
function fieldPatch(patch: Partial<T2Field>) {
  void act(() => props.workbench.field(patch));
}
function addTable() {
  void act(() => props.workbench.addTable(tableIdDraft.value, tableNameDraft.value, tableGroupDraft.value));
}
function addField() {
  void act(() => props.workbench.addField(fieldIdDraft.value, fieldNameDraft.value));
}
function setTableGroupDraft(e: Event) {
  const v = text(e);
  if (v === 'macro' || v === 'micro') tableGroupDraft.value = v;
}
function tableGroup(e: Event) {
  const v = text(e);
  if (v === 'macro' || v === 'micro') tablePatch({ groupId: v });
}
function tablePurpose(e: Event) {
  const p = purposes.find(p => p.id === text(e));
  if (p) tablePatch({ purpose: p.id });
}
function fieldType(e: Event) {
  const type = T6_TYPES.find(t => t === text(e));
  if (type && field.value && model.value.template) {
    const { id: _id, sqlName: _sql, ...patch } = typeT6Field(field.value, type, model.value.template);
    fieldPatch(patch);
  }
}
function textControl(e: Event) {
  const v = text(e);
  if (v === 'single-line' || v === 'multiline') fieldPatch({ control: v });
}
function fieldFlag(key: 'required' | 'nullable' | 'readonly' | 'hiddenUi', e: Event) {
  fieldPatch({
    [key]: checked(e),
    ...(key === 'readonly' && checked(e) ? { permissions: { manualWrite: false, aiWrite: false } } : {}),
  });
}
function fieldPermission(key: 'manualWrite' | 'aiWrite', e: Event) {
  if (field.value) fieldPatch({ permissions: { ...field.value.permissions, [key]: checked(e) } });
}
function fieldVisibility(key: 'evolutionAi' | 'mainAi', e: Event) {
  if (field.value) fieldPatch({ visibility: { ...field.value.visibility, [key]: checked(e) } });
}
function tableVisibility(key: 'evolutionAi' | 'mainAi', e: Event) {
  if (table.value) tablePatch({ visibility: { ...table.value.visibility, [key]: checked(e) } });
}
function constraintNumber(key: 'min' | 'max' | 'maxLength' | 'maxItems' | 'precision' | 'scale', e: Event) {
  if (!field.value) return;
  const c = { ...field.value.constraints };
  if (text(e) === '') delete c[key];
  else c[key] = Number(text(e));
  fieldPatch({ constraints: c });
}
function enumValues(e: Event) {
  if (!field.value) return;
  const c = { ...field.value.constraints };
  if (text(e) === '' && field.value.type === 'string-list') delete c.enumValues;
  else c.enumValues = text(e).split('\n');
  fieldPatch({ constraints: c });
}
function terminalValues(e: Event) {
  if (!field.value) return;
  const c = { ...field.value.constraints };
  if (text(e) === '') delete c.terminalValues;
  else c.terminalValues = text(e).split('\n');
  fieldPatch({ constraints: c });
}
function timeSemantic(e: Event) {
  const value = text(e);
  if (value === 'none' || value === 'deadline' || value === 'fact-time') fieldPatch({ semantic: value });
}
function referenceTable(id: string, e: Event) {
  const r = field.value?.constraints.reference;
  if (r && field.value)
    fieldPatch({
      constraints: { ...field.value.constraints, reference: { ...r, tableIds: list(r.tableIds, id, checked(e)) } },
    });
}
function onDelete(e: Event) {
  const r = field.value?.constraints.reference,
    v = text(e);
  if (r && field.value && (v === 'clear' || v === 'restrict'))
    fieldPatch({ constraints: { ...field.value.constraints, reference: { ...r, onDelete: v } } });
}
function calendar(e: Event) {
  if (field.value) fieldPatch({ constraints: { ...field.value.constraints, calendarId: text(e) } });
}
function defaultCell(cell: { present: boolean; value: T2Cell | null }) {
  void act(() =>
    props.workbench.edit(t => {
      const f = t.tables.find(t => t.id === model.value.tableId)?.fields.find(f => f.id === model.value.fieldId);
      if (!f) return;
      if (cell.present) f.defaultValue = cell.value;
      else delete f.defaultValue;
    }),
  );
}
function mappingPatch(patch: Partial<T6Mapping>, removeFill = false) {
  if (!table.value || !field.value) return;
  const m: T6Mapping = {
    tableId: table.value.id,
    fieldId: field.value.id,
    fromFieldId: field.value.id,
    conversion: 'identity',
    ...mapping.value,
    ...patch,
  };
  if (!originalFields.value.some(f => f.id === m.fromFieldId)) m.fromFieldId = null;
  if (removeFill) delete m.fill;
  void act(() =>
    props.workbench.mappings({
      ...model.value.options,
      mappings: [...model.value.options.mappings.filter(x => x.tableId !== m.tableId || x.fieldId !== m.fieldId), m],
    }),
  );
}
function mappingSource(e: Event) {
  mappingPatch({ fromFieldId: text(e) || null });
}
function mappingSourceValue() {
  return mapping.value
    ? (mapping.value.fromFieldId ?? '')
    : originalFields.value.some(f => f.id === field.value?.id)
      ? (field.value?.id ?? '')
      : '';
}
function mappingConversion(e: Event) {
  const conversion = text(e);
  if (['identity', 'text-integer', 'text-number', 'scalar-text'].includes(conversion))
    mappingPatch({ conversion: conversion as T6Conversion });
}
function fillCell(cell: { present: boolean; value: T2Cell | null }) {
  mappingPatch(cell.present ? { fill: cell.value } : {}, !cell.present);
}
function clearMapping() {
  void act(() =>
    props.workbench.mappings({
      ...model.value.options,
      mappings: model.value.options.mappings.filter(
        m => m.tableId !== table.value?.id || m.fieldId !== field.value?.id,
      ),
    }),
  );
}
function ruleText(key: keyof T2Table['rules'], e: Event) {
  if (table.value) tablePatch({ rules: { ...table.value.rules, [key]: text(e) } });
}
function tablePermission(actor: 'manual' | 'ai', action: keyof T2WritePermissions, e: Event) {
  if (table.value)
    tablePatch({
      permissions: { ...table.value.permissions, [actor]: { ...table.value.permissions[actor], [action]: checked(e) } },
    });
}
function tableParametersChanged(p: T6Parameters) {
  if (table.value)
    tablePatch({
      runtime: { ...table.value.runtime, frequency: p.frequency, budget: p.budget, api: p.api },
      context: { ...table.value.context, settings: p.context },
    });
}
function list(values: string[], id: string, yes: boolean) {
  return yes ? [...new Set([...values, id])] : values.filter(v => v !== id);
}
function contextField(id: string, e: Event) {
  if (table.value)
    tablePatch({ context: { ...table.value.context, fieldIds: list(table.value.context.fieldIds, id, checked(e)) } });
}
function relatedTable(id: string, e: Event) {
  if (table.value)
    tablePatch({
      context: { ...table.value.context, relatedTableIds: list(table.value.context.relatedTableIds, id, checked(e)) },
    });
}
function exportPatch(patch: Partial<T2Table['export']>) {
  if (table.value) tablePatch({ export: { ...table.value.export, ...patch } });
}
function exportMode(e: Event) {
  const v = text(e);
  if (v === 'per-row' || v === 'index' || v === 'constant') exportPatch({ mode: v });
}
function exportField(key: 'fieldIds' | 'keyFieldIds', id: string, e: Event) {
  if (table.value) exportPatch({ [key]: list(table.value.export[key], id, checked(e)) });
}
function globalParameters(p: T6Parameters) {
  void act(() =>
    props.workbench.edit(t => {
      if (
        p.frequency.state === 'value' &&
        p.budget.state === 'value' &&
        p.context.state === 'value' &&
        p.api.state !== 'inherit'
      )
        t.defaults = { frequency: p.frequency.value, budget: p.budget.value, context: p.context.value, api: p.api };
    }),
  );
}
function groupName(id: 'macro' | 'micro', e: Event) {
  const v = text(e);
  void act(() =>
    props.workbench.edit(t => {
      t.groups.find(g => g.id === id)!.name = v;
    }),
  );
}
function hardLimit(key: keyof T2Budget, e: Event) {
  const v = Number(text(e));
  void act(() =>
    props.workbench.edit(t => {
      t.hardLimits[key] = v;
    }),
  );
}
function phaseParameters(id: 'macro' | 'micro', p: T6Parameters) {
  void act(() =>
    props.workbench.edit(t => {
      t.phases[id] = { ...t.phases[id], ...p };
    }),
  );
}
function phaseEnabled(id: 'macro' | 'micro', e: Event) {
  const v = checked(e);
  void act(() =>
    props.workbench.edit(t => {
      t.phases[id].enabled = v;
    }),
  );
}
function calendarPatch(id: string, key: 'name' | 'epoch' | 'minutesPerDay', e: Event) {
  const v = text(e);
  void act(() =>
    props.workbench.edit(t => {
      const c = t.calendars.find(c => c.id === id)!;
      if (key === 'minutesPerDay') c.minutesPerDay = Number(v);
      else c[key] = v;
    }),
  );
}
function exportDdl() {
  void act(() => {
    advanced.value = props.workbench.exportDdl();
  });
}
function exportJson() {
  advanced.value = JSON.stringify(model.value.template, null, 2);
}
function removal(e: Event) {
  void act(() => props.workbench.mappings({ ...model.value.options, allowRemoval: checked(e) }));
}
async function saveDefault() {
  await act(() => props.workbench.saveDefault(defaultConsent.value));
  defaultConsent.value = false;
}
</script>

<style scoped>
.we-t6-workbench {
  --t6-text: var(--we14-text, #294f3c);
  --t6-line: var(--we14-border, #d4e4d9);
  color: var(--t6-text);
  background: var(--we14-surface, #edf5ee);
  padding: 16px;
  border-radius: 14px;
  box-sizing: border-box;
  min-width: 0;
}
header p,
p,
small {
  overflow-wrap: anywhere;
}
h2,
h3,
h4 {
  margin: 12px 0 8px;
}
.layout {
  display: grid;
  grid-template-columns: minmax(150px, 220px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
main,
aside,
fieldset {
  min-width: 0;
}
aside {
  background: var(--we14-card, #f7fbf5);
  padding: 12px;
  border: 1px solid var(--t6-line);
  border-radius: 10px;
}
aside button {
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 6px;
}
small {
  display: block;
  font-size: 12px;
}
fieldset,
.report,
details {
  margin: 0 0 14px;
  padding: 14px;
  border: 1px solid var(--t6-line);
  border-radius: 10px;
  background: var(--we14-card, #f9fcf7);
}
legend {
  font-weight: 600;
}
label {
  display: block;
  margin-bottom: 9px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-items: end;
}
input:not([type='checkbox']),
textarea,
select {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  padding: 8px;
  color: var(--t6-text);
  background: var(--we14-control, #fcfefb);
  border: 1px solid var(--we14-border, #a9c5b4);
  border-radius: 6px;
}
textarea {
  resize: vertical;
  min-height: 65px;
}
input[type='checkbox'] {
  accent-color: var(--we14-accent, #397957);
}
button {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  padding: 8px 12px;
  border-radius: 8px;
  color: var(--we14-text, #294f3c);
  background: var(--we14-soft, #e0efe3);
  border: 1px solid var(--we14-border, #a9c5b4);
  cursor: pointer;
}
button[aria-pressed='true'],
.primary {
  background: var(--we14-accent, #397957);
  color: var(--we14-on-accent, #fff);
  border-color: var(--we14-accent, #397957);
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
.danger {
  color: var(--we14-danger-text, #85394e);
  background: var(--we14-danger-bg, #fbeaf0);
  border-color: var(--we14-danger-border, #e8bccc);
  padding: 8px;
  border-radius: 8px;
}
.checks,
.actions,
.field-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin: 10px 0;
}
.checks label,
.actions label {
  margin: 0;
}
.field-list {
  max-height: 240px;
  overflow: auto;
}
footer {
  position: sticky;
  bottom: 0;
  background: var(--we14-surface, #f0f7ee);
  padding: 12px;
  border: 1px solid var(--t6-line);
  border-radius: 10px;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
ul {
  padding-left: 20px;
}
li {
  overflow-wrap: anywhere;
  margin-bottom: 6px;
}
:focus-visible {
  outline: 2px solid var(--we14-accent, #397957);
  outline-offset: 3px;
}
@media (max-width: 850px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  aside {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  aside form {
    grid-column: 1 / -1;
  }
}
@media (max-width: 600px) {
  .we-t6-workbench {
    padding: 10px;
  }
  .grid,
  aside {
    grid-template-columns: minmax(0, 1fr);
  }
  fieldset {
    padding: 10px;
  }
  footer {
    position: static;
  }
}
</style>
