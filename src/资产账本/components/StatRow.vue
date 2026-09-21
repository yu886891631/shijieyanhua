<template>
  <div class="stat-block">
    <div v-for="(row, i) in rows" :key="i" class="stat-row">
      <span v-if="row.label" class="stat-label">{{ row.label }}</span>
      <span class="stat-value">{{ row.value }}</span>
    </div>
    <div v-if="!rows.length && fallback" class="stat-row">
      <span class="stat-value pre">{{ fallback }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    text: string;
    /** 也按 | 拆片段 */
    splitPipes?: boolean;
  }>(),
  { splitPipes: true },
);

type Row = { label: string; value: string };

const fallback = computed(() => soft(props.text));

const rows = computed(() => {
  const raw = String(props.text ?? '').trim();
  if (!raw) return [] as Row[];

  const out: Row[] = [];
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const kv = line.match(/^([^:：|]{1,24})\s*[:：]\s*(.+)$/);
    if (kv) {
      out.push({ label: kv[1].trim(), value: kv[2].trim() });
      continue;
    }
    if (props.splitPipes && line.includes('|')) {
      for (const part of line.split('|').map(p => p.trim()).filter(Boolean)) {
        const pkv = part.match(/^([^:：]{1,20})\s*[:：]\s*(.+)$/);
        if (pkv) out.push({ label: pkv[1].trim(), value: pkv[2].trim() });
        else out.push({ label: '', value: part });
      }
      continue;
    }
    out.push({ label: '', value: line });
  }

  // 若只有一行且没拆出有效结构，交给 fallback pre
  if (out.length <= 1 && !out[0]?.label) return [] as Row[];
  return out;
});

function soft(t: string): string {
  return String(t ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
</script>

<style lang="scss" scoped>
.stat-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-xs);
  font-size: 0.78rem;
  line-height: 1.5;
  transition: background var(--transition-fast);
  min-width: 0;
  max-width: 100%;

  &:hover {
    background: rgba(176, 125, 68, 0.04);
  }
}

.stat-label {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 0.75rem;

  &::after {
    content: ':';
  }
}

.stat-value {
  color: var(--text-secondary);
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 0.72rem;
  min-width: 0;
  flex: 1 1 auto;

  &.pre {
    white-space: pre-line;
    font-size: 0.78rem;
  }
}

@media (max-width: 640px) {
  .stat-label {
    white-space: normal;
    max-width: 40%;
    overflow-wrap: anywhere;
  }

  .stat-value {
    flex: 1 1 55%;
  }
}
</style>
