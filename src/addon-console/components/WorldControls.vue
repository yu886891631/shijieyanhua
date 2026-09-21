<template>
  <section class="ac-section">
    <h2 class="ac-section-title">🌐 世界控制</h2>
    <div class="ac-section-body">
      <div class="ac-world-tabs">
        <button
          v-for="name in worldNames"
          :key="name"
          type="button"
          class="ac-chip"
          :class="{ active: name === selected }"
          @click="emit('select', name)"
        >
          {{ name }}
          <span v-if="worlds[name]?.降临"> ·降临</span>
          <span v-else-if="worlds[name]?.平行演化"> ·平行</span>
        </button>
      </div>

      <template v-if="selected && worlds[selected]">
        <div class="ac-row">
          <div class="ac-label">世界降临（互斥）</div>
          <ToggleSwitch
            :model-value="!!worlds[selected].降临"
            @update:model-value="emit('set-descent', selected, $event)"
          />
        </div>
        <div class="ac-row">
          <div class="ac-label">平行演化</div>
          <ToggleSwitch
            :model-value="!!worlds[selected].平行演化"
            @update:model-value="emit('set-parallel', selected, $event)"
          />
        </div>
        <div class="ac-row" style="align-items: flex-start">
          <div style="flex: 1; display: grid; gap: 6px">
            <div class="ac-world-rename-row">
              <input v-model="renameDraft" class="ac-input" :placeholder="`重命名 ${selected}`" />
              <button
                type="button"
                class="ac-icon-btn danger"
                title="删除世界"
                aria-label="删除世界"
                @click="openDeleteConfirm"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </div>
            <div style="display: flex; gap: 6px">
              <button type="button" class="ac-btn primary" @click="doRename">改名</button>
            </div>
          </div>
        </div>
      </template>

      <div class="ac-row" style="margin-top: 8px; align-items: flex-start">
        <div style="flex: 1; display: grid; gap: 6px">
          <input v-model="createDraft" class="ac-input" placeholder="新建世界名称" />
          <button type="button" class="ac-btn primary" style="width: fit-content" @click="doCreate">
            创建世界
          </button>
        </div>
      </div>
    </div>

    <Teleport v-if="teleportTarget" :to="teleportTarget">
      <div
        v-if="pendingDelete"
        class="ac-confirm-mask"
        role="presentation"
        @click.self="closeDeleteConfirm"
      >
        <div class="ac-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ac-delete-world-title">
          <h3 id="ac-delete-world-title" class="ac-confirm-title">删除世界</h3>
          <p class="ac-confirm-body">
            确认删除世界「{{ pendingDelete }}」？将移除对应变量键，且不可从控制台撤销。
          </p>
          <div class="ac-confirm-actions">
            <button type="button" class="ac-btn ghost" :disabled="deleting" @click="closeDeleteConfirm">
              取消
            </button>
            <button type="button" class="ac-btn danger" :disabled="deleting" @click="confirmDelete">
              {{ deleting ? '删除中…' : '确认删除' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import ToggleSwitch from './ToggleSwitch.vue';

const props = defineProps<{
  worlds: Record<string, { 降临?: boolean; 平行演化?: boolean }>;
  selected: string | null;
}>();

const emit = defineEmits<{
  select: [string];
  'set-descent': [string, boolean];
  'set-parallel': [string, boolean];
  create: [string];
  rename: [string, string];
  delete: [string];
}>();

const worldNames = computed(() => Object.keys(props.worlds));
const renameDraft = ref('');
const createDraft = ref('');
const pendingDelete = ref<string | null>(null);
const deleting = ref(false);
const teleportTarget = ref<HTMLElement | null>(null);

/** 控制台挂在父页 DOM，脚本在 iframe：选择器须查 parent.document */
function resolveConsoleRoot(): HTMLElement | null {
  const docs: Document[] = [];
  try {
    if (window.parent?.document) docs.push(window.parent.document);
  } catch {
    /* cross-origin */
  }
  docs.push(document);
  for (const doc of docs) {
    const el = doc.querySelector('.addon-console');
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

function openDeleteConfirm() {
  if (!props.selected) return;
  teleportTarget.value = resolveConsoleRoot();
  pendingDelete.value = props.selected;
  deleting.value = false;
}

watch(pendingDelete, v => {
  if (!v) teleportTarget.value = null;
});

watch(
  () => props.selected,
  name => {
    renameDraft.value = name ?? '';
    if (pendingDelete.value && pendingDelete.value !== name) {
      pendingDelete.value = null;
      deleting.value = false;
    }
  },
  { immediate: true },
);

function doCreate() {
  const name = createDraft.value.trim();
  if (!name) return;
  emit('create', name);
  createDraft.value = '';
}

function doRename() {
  if (!props.selected) return;
  const next = renameDraft.value.trim();
  if (!next || next === props.selected) return;
  emit('rename', props.selected, next);
}

function closeDeleteConfirm() {
  if (deleting.value) return;
  pendingDelete.value = null;
}

function confirmDelete() {
  if (!pendingDelete.value || deleting.value) return;
  deleting.value = true;
  emit('delete', pendingDelete.value);
  pendingDelete.value = null;
  deleting.value = false;
}
</script>
