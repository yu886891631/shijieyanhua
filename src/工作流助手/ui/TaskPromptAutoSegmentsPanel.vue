<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PostProcessTask } from '../tasks/schema';
import {
  appendPromptAutoSegment,
  appendPromptAutoSlot,
  countInsertedPromptAutoSegments,
  removePromptAutoSegmentAt,
  removePromptAutoSlotAt,
  sortSegmentsInSlot,
} from '../tasks/prompt-auto-segment-ops';
import { cloneAutoSegmentsFromRoot, patchPromptAutoSegmentInsertedOverride } from '../tasks/replica-family';
import { acuConfirm } from './composables/useAcuConfirm';

const props = defineProps<{
  task: PostProcessTask;
  readonly?: boolean;
  /** 副本视图：仅可切换 inserted，结构/正文只读 */
  insertedOnly?: boolean;
  /** insertedOnly 时用于「恢复跟随原本」的对照根任务 */
  rootTask?: PostProcessTask | null;
}>();

const panelExpanded = ref(false);
const editingSegmentId = ref<string | null>(null);
const selectedSegmentBySlot = ref<Record<string, string>>({});

const slots = computed(() => props.task.promptAutoSlots ?? []);
const segments = computed(() => props.task.promptAutoSegments ?? []);

const insertedCount = computed(() => countInsertedPromptAutoSegments(segments.value));

const sortedSlots = computed(() =>
  [...slots.value].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
);

const structureReadonly = computed(() => props.readonly || props.insertedOnly);

const hasInsertedOverrides = computed(
  () => Object.keys(props.task.promptAutoSegmentInsertedOverrides ?? {}).length > 0,
);

function ensureArrays() {
  if (!props.task.promptAutoSlots) props.task.promptAutoSlots = [];
  if (!props.task.promptAutoSegments) props.task.promptAutoSegments = [];
}

watch(
  () => props.task.id,
  () => {
    editingSegmentId.value = null;
    selectedSegmentBySlot.value = {};
  },
);

function togglePanel() {
  panelExpanded.value = !panelExpanded.value;
}

function segmentsForSlot(slotId: string) {
  return sortSegmentsInSlot(segments.value, slotId);
}

function segmentIndex(segId: string) {
  return segments.value.findIndex(s => s.id === segId);
}

function addSlot() {
  if (structureReadonly.value) return;
  ensureArrays();
  props.task.promptAutoSlots = appendPromptAutoSlot(props.task.promptAutoSlots);
}

async function removeSlot(slotIndex: number) {
  if (structureReadonly.value) return;
  ensureArrays();
  const slot = slots.value[slotIndex];
  if (!slot) return;
  const label = slot.name?.trim() || '未命名插入位';
  if (!(await acuConfirm({ message: `删除插入位「${label}」及其下全部自动段？` }))) return;
  const result = removePromptAutoSlotAt(props.task.promptAutoSlots, props.task.promptAutoSegments, slotIndex);
  props.task.promptAutoSlots = result.slots;
  props.task.promptAutoSegments = result.segments;
  const { [slot.id]: _removed, ...restSelected } = selectedSegmentBySlot.value;
  selectedSegmentBySlot.value = restSelected;
  if (editingSegmentId.value && !props.task.promptAutoSegments.some(s => s.id === editingSegmentId.value)) {
    editingSegmentId.value = null;
  }
}

function addSegment(slotId: string) {
  if (structureReadonly.value) return;
  ensureArrays();
  const before = props.task.promptAutoSegments?.length ?? 0;
  props.task.promptAutoSegments = appendPromptAutoSegment(props.task.promptAutoSegments, slotId);
  const created = props.task.promptAutoSegments[before];
  if (created) {
    selectedSegmentBySlot.value = { ...selectedSegmentBySlot.value, [slotId]: created.id };
  }
}

async function removeSegment(segId: string) {
  if (structureReadonly.value) return;
  ensureArrays();
  const idx = segmentIndex(segId);
  if (idx < 0) return;
  const seg = segments.value[idx];
  const label = seg?.name?.trim() || '未命名段';
  if (!(await acuConfirm({ message: `删除自动段「${label}」？` }))) return;
  props.task.promptAutoSegments = removePromptAutoSegmentAt(props.task.promptAutoSegments, idx);
  if (seg?.slotId && selectedSegmentBySlot.value[seg.slotId] === segId) {
    const next = { ...selectedSegmentBySlot.value };
    delete next[seg.slotId];
    selectedSegmentBySlot.value = next;
  }
  if (editingSegmentId.value === segId) editingSegmentId.value = null;
}

function toggleInserted(segId: string) {
  if (props.readonly) return;
  const seg = segments.value.find(s => s.id === segId);
  if (!seg) return;
  const next = !seg.inserted;
  seg.inserted = next;
  if (props.insertedOnly) {
    const rootSegs = props.rootTask?.promptAutoSegments;
    if (rootSegs) {
      props.task.promptAutoSegmentInsertedOverrides = patchPromptAutoSegmentInsertedOverride(
        props.task.promptAutoSegmentInsertedOverrides,
        rootSegs,
        segId,
        next,
      );
    } else {
      const overrides = { ...(props.task.promptAutoSegmentInsertedOverrides ?? {}) };
      overrides[segId] = next;
      props.task.promptAutoSegmentInsertedOverrides = overrides;
    }
  }
}

function restoreFollowRoot() {
  if (!props.insertedOnly || props.readonly) return;
  const root = props.rootTask;
  if (!root) return;
  props.task.promptAutoSegmentInsertedOverrides = undefined;
  const spec = root.replicaFamilySpec ?? '';
  const attrValue = props.task.replicaFamilyAttrValue ?? '';
  props.task.promptAutoSegments = cloneAutoSegmentsFromRoot(root, spec, attrValue, undefined);
}

function selectedSegmentId(slotId: string) {
  return selectedSegmentBySlot.value[slotId];
}

function resolveSelectedSegmentId(slotId: string) {
  const slotSegments = segmentsForSlot(slotId);
  const selected = selectedSegmentBySlot.value[slotId];
  if (selected && slotSegments.some(s => s.id === selected)) return selected;
  return slotSegments[0]?.id;
}

function onChipClick(slotId: string, segId: string) {
  if (props.readonly) return;
  selectedSegmentBySlot.value = { ...selectedSegmentBySlot.value, [slotId]: segId };
  toggleInserted(segId);
}

function startEdit(segId: string) {
  if (structureReadonly.value) return;
  editingSegmentId.value = editingSegmentId.value === segId ? null : segId;
}

function editSelectedSegment(slotId: string) {
  if (structureReadonly.value) return;
  const segId = resolveSelectedSegmentId(slotId);
  if (!segId) return;
  selectedSegmentBySlot.value = { ...selectedSegmentBySlot.value, [slotId]: segId };
  startEdit(segId);
}

function deleteSelectedSegment(slotId: string) {
  if (structureReadonly.value) return;
  const segId = resolveSelectedSegmentId(slotId);
  if (!segId) return;
  void removeSegment(segId);
}

function segmentLabel(name: string) {
  return name?.trim() || '未命名段';
}

function slotIndexById(slotId: string) {
  return slots.value.findIndex(s => s.id === slotId);
}
</script>

<template>
  <div class="acu-subsection acu-auto-segments-section">
    <button
      type="button"
      class="acu-auto-segments-section__header"
      :aria-expanded="panelExpanded"
      @click="togglePanel"
    >
      <span class="acu-auto-segments-section__title">任务级提示词自动段</span>
      <span class="acu-auto-segments-section__summary">
        {{ insertedCount > 0 ? `已启用 ${insertedCount} 段` : '未启用自动段' }}
        <template v-if="insertedOnly && hasInsertedOverrides"> · 已覆盖</template>
      </span>
      <i
        class="fa-fw fa-solid acu-auto-segments-section__chevron"
        :class="panelExpanded ? 'fa-chevron-up' : 'fa-chevron-down'"
        aria-hidden="true"
      />
    </button>

    <div v-show="panelExpanded" class="acu-auto-segments-section__body">
      <p class="acu-notes acu-notes--sm acu-auto-segments-section__intro">
        <template v-if="insertedOnly">
          副本视图：插入位与段内容跟随原本；点击芯片可独立启用/停用本副本的自动段。
        </template>
        <template v-else>
          风味块/风格块：按插入位 order 自动插入总提示词。order=0 在首段手动提示词之前，order=N（N=手动段数）在末尾。
        </template>
      </p>

      <div
        v-if="insertedOnly && rootTask && !readonly"
        class="acu-row acu-auto-segments-section__restore-row"
      >
        <button
          class="acu-btn acu-btn--sm"
          type="button"
          :disabled="!hasInsertedOverrides"
          title="清除本副本覆盖，恢复与原本一致的启用状态"
          @click="restoreFollowRoot"
        >
          恢复跟随原本
        </button>
      </div>

      <div v-if="!sortedSlots.length" class="acu-notes acu-notes--sm acu-auto-segments-section__empty">
        {{ insertedOnly ? '原本尚未配置插入位。' : '暂无插入位，请先添加。' }}
      </div>

      <div v-for="slot in sortedSlots" :key="slot.id" class="acu-auto-segment-slot">
        <div class="acu-auto-segment-slot__header">
          <input
            v-model="slot.name"
            class="acu-input acu-auto-segment-slot__name"
            type="text"
            placeholder="插入位名称"
            :readonly="structureReadonly"
            :disabled="structureReadonly"
          />
          <label class="acu-auto-segment-slot__order-label">
            order
            <input
              v-model.number="slot.order"
              class="acu-input acu-auto-segment-slot__order"
              type="number"
              min="0"
              step="1"
              :readonly="structureReadonly"
              :disabled="structureReadonly"
            />
          </label>
          <button
            v-if="!structureReadonly"
            class="acu-btn acu-btn--sm danger acu-auto-segment-slot__delete"
            type="button"
            title="删除插入位"
            @click="removeSlot(slotIndexById(slot.id))"
          >
            删
          </button>
        </div>

        <div class="acu-auto-segment-chip-list">
          <button
            v-for="seg in segmentsForSlot(slot.id)"
            :key="seg.id"
            type="button"
            class="acu-auto-segment-chip"
            :class="{
              'acu-auto-segment-chip--on': seg.inserted,
              'acu-auto-segment-chip--off': !seg.inserted,
              'acu-auto-segment-chip--selected': selectedSegmentId(slot.id) === seg.id,
            }"
            :disabled="readonly"
            :title="seg.inserted ? '点击停用插入' : '点击启用插入'"
            @click="onChipClick(slot.id, seg.id)"
          >
            {{ segmentLabel(seg.name) }}
          </button>
        </div>

        <div
          v-for="seg in segmentsForSlot(slot.id)"
          v-show="!insertedOnly && editingSegmentId === seg.id"
          :key="`edit-${seg.id}`"
          class="acu-auto-segment-editor"
        >
          <div class="acu-row">
            <label class="acu-field-label">段名称</label>
            <input
              v-model="seg.name"
              class="acu-input"
              type="text"
              :readonly="structureReadonly"
              :disabled="structureReadonly"
            />
          </div>
          <div class="acu-row">
            <label class="acu-field-label">role</label>
            <select v-model="seg.role" class="acu-select" :disabled="structureReadonly">
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
          </div>
          <textarea
            v-model="seg.content"
            class="acu-textarea"
            placeholder="提示词正文"
            :readonly="structureReadonly"
            :disabled="structureReadonly"
          />
        </div>

        <div v-if="!structureReadonly" class="acu-auto-segment-slot__actions">
          <button class="acu-btn acu-btn--sm acu-auto-segment-slot__add" type="button" @click="addSegment(slot.id)">
            + 自动段
          </button>
          <button
            class="acu-btn acu-btn--sm acu-icon-btn"
            type="button"
            title="编辑选中的自动段"
            :disabled="!segmentsForSlot(slot.id).length"
            :aria-expanded="editingSegmentId === resolveSelectedSegmentId(slot.id)"
            @click="editSelectedSegment(slot.id)"
          >
            <i class="fa-fw fa-solid fa-pen" aria-hidden="true" />
          </button>
          <button
            class="acu-btn acu-btn--sm acu-icon-btn danger"
            type="button"
            title="删除选中的自动段"
            :disabled="!segmentsForSlot(slot.id).length"
            @click="deleteSelectedSegment(slot.id)"
          >
            <i class="fa-fw fa-solid fa-trash" aria-hidden="true" />
          </button>
        </div>
      </div>

      <button
        v-if="!structureReadonly"
        class="acu-btn acu-btn--sm acu-auto-segments-section__add-slot"
        type="button"
        @click="addSlot"
      >
        + 插入位
      </button>
    </div>
  </div>
</template>
