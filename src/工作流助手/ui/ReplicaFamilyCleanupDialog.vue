<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ReplicaCleanupCandidateGroup } from '../tasks/replica-family-cleanup';

const props = defineProps<{
  groups: ReplicaCleanupCandidateGroup[];
}>();

const emit = defineEmits<{
  confirm: [keepBySpec: Record<string, string[]>];
  cancel: [];
}>();

const selected = ref<Record<string, Set<string>>>({});

function initSelection(): void {
  const next: Record<string, Set<string>> = {};
  for (const group of props.groups) {
    const set = new Set<string>();
    for (const m of group.members) {
      if (m.defaultSelected) set.add(m.attrValue);
    }
    next[group.spec] = set;
  }
  selected.value = next;
}

initSelection();

const hasGroups = computed(() => props.groups.length > 0);

function isSelected(spec: string, attrValue: string): boolean {
  return selected.value[spec]?.has(attrValue) ?? false;
}

function toggleMember(spec: string, attrValue: string): void {
  const set = new Set(selected.value[spec] ?? []);
  if (set.has(attrValue)) set.delete(attrValue);
  else set.add(attrValue);
  selected.value = { ...selected.value, [spec]: set };
}

function onConfirm(): void {
  const keepBySpec: Record<string, string[]> = {};
  for (const group of props.groups) {
    keepBySpec[group.spec] = [...(selected.value[group.spec] ?? [])];
  }
  emit('confirm', keepBySpec);
}

function onCancel(): void {
  emit('cancel');
}
</script>

<template>
  <div class="acu-overlay acu-pp-root replica-cleanup-dialog">
    <div class="acu-window replica-cleanup-dialog__window">
      <div class="acu-window-header">
        <div class="acu-window-title">
          <span class="acu-window-title-mark">清</span>
          <span>副本族清理</span>
        </div>
        <div class="acu-window-header-end">
          <button class="acu-btn acu-window-close" type="button" title="跳过本次" @click="onCancel">×</button>
        </div>
      </div>
      <div class="acu-window-body replica-cleanup-dialog__body">
        <p class="acu-notes acu-notes--sm replica-cleanup-dialog__intro">
          按动态属性规格（同
          spec）统一选择需保留的属性值。未选中的属性值将从所有声明该 spec
          的副本族中移除，并清除对应楼层变量 key。
        </p>
        <div v-if="hasGroups" class="replica-cleanup-dialog__groups">
          <div v-for="group in groups" :key="group.spec" class="replica-cleanup-dialog__group">
            <h5 class="replica-cleanup-dialog__group-title">{{ group.spec }}</h5>
            <div class="replica-scheduler__chip-list">
              <button
                v-for="member in group.members"
                :key="member.attrValue"
                type="button"
                class="acu-auto-segment-chip"
                :class="{
                  'acu-auto-segment-chip--on': isSelected(group.spec, member.attrValue),
                  'acu-auto-segment-chip--off': !isSelected(group.spec, member.attrValue),
                }"
                :title="`调度尝试 ${member.opportunityCount} 次，等待 ${member.scheduleWaitCount} 次，成功 ${member.runCount} 次`"
                @click="toggleMember(group.spec, member.attrValue)"
              >
                {{ member.attrValue }}
              </button>
            </div>
          </div>
        </div>
        <p v-else class="acu-notes">当前没有可清理的副本族成员。</p>
      </div>
      <div class="acu-window-footer">
        <div class="acu-footer-actions">
          <button class="acu-btn" type="button" @click="onCancel">跳过本次</button>
          <button class="acu-btn primary" type="button" @click="onConfirm">确认保留</button>
        </div>
      </div>
    </div>
  </div>
</template>
