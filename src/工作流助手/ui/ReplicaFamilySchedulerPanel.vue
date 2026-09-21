<script setup lang="ts">
import { computed } from 'vue';
import type { PostProcessTask, ReplicaFamilyScheduleMode } from '../tasks/schema';

const props = defineProps<{
  root: PostProcessTask;
  members: PostProcessTask[];
}>();

const emit = defineEmits<{
  updateMode: [mode: ReplicaFamilyScheduleMode];
  updateMember: [memberId: string, patch: { launched?: boolean }];
  createMember: [];
}>();

const scheduleMode = computed({
  get: (): ReplicaFamilyScheduleMode => props.root.replicaFamilyScheduleMode ?? 'auto',
  set: (v: ReplicaFamilyScheduleMode) => emit('updateMode', v),
});

const isManual = computed(() => scheduleMode.value === 'manual');

function memberLabel(member: PostProcessTask): string {
  return member.replicaFamilyAttrValue?.trim() || member.name;
}

function isMemberLaunched(member: PostProcessTask): boolean {
  return member.replicaFamilyLaunched === true;
}

function toggleMemberLaunched(member: PostProcessTask): void {
  if (!isManual.value) return;
  emit('updateMember', member.id, { launched: !isMemberLaunched(member) });
}
</script>

<template>
  <div class="acu-subsection replica-scheduler">
    <div class="replica-scheduler__heading">
      <h5>副本调度</h5>
      <button
        type="button"
        class="acu-btn acu-btn--sm acu-icon-btn"
        title="新建副本"
        aria-label="新建副本"
        @click="emit('createMember')"
      >
        <i class="fa-fw fa-solid fa-plus" aria-hidden="true"></i>
      </button>
    </div>
    <p class="acu-notes acu-notes--sm">
      自动模式：每轮仅执行上一阶段 relay 枚举列表中的副本。手动模式：点选副本表示「已启动」；新建副本首轮自动启动并执行，轮末自动变为未启动。
    </p>
    <div class="replica-scheduler__mode">
      <label class="replica-scheduler__mode-option">
        <input v-model="scheduleMode" type="radio" value="auto" />
        <span>自动调度</span>
      </label>
      <label class="replica-scheduler__mode-option">
        <input v-model="scheduleMode" type="radio" value="manual" />
        <span>手动调度</span>
      </label>
    </div>
    <div class="replica-scheduler__chip-list">
      <div
        v-for="member in members"
        :key="member.id"
        class="replica-scheduler__member"
        :class="{ 'replica-scheduler__member--manual': isManual }"
      >
        <button
          type="button"
          class="acu-auto-segment-chip"
          :class="{
            'acu-auto-segment-chip--on': isManual && isMemberLaunched(member),
            'acu-auto-segment-chip--off': isManual && !isMemberLaunched(member),
            'replica-scheduler__chip--readonly': !isManual,
          }"
          :disabled="!isManual"
          :title="
            isManual
              ? isMemberLaunched(member)
                ? '点击关闭'
                : '点击启动'
              : '自动模式仅执行 relay 列表中的副本'
          "
          :aria-pressed="isManual ? isMemberLaunched(member) : undefined"
          @click="toggleMemberLaunched(member)"
        >
          {{ memberLabel(member) }}
        </button>
      </div>
    </div>
    <p v-if="!members.length" class="acu-notes acu-notes--sm">
      暂无副本；可点右上角加号新建，或启用任务后在运行时按 relay 增量同步。
    </p>
  </div>
</template>
