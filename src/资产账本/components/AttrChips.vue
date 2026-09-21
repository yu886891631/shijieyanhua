<template>
  <div class="attrs">
    <span v-for="(v, k) in visible" :key="k" class="attrs__item">
      <span class="attrs__k">{{ k }}</span>
      <span class="attrs__v">{{ v }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  attrs: Record<string, string>;
  hide?: string[];
}>();

const hidden = computed(() => new Set([...(props.hide ?? []), '_tag']));

const visible = computed(() => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (hidden.value.has(k) || v === '') continue;
    out[k] = v;
  }
  return out;
});
</script>

<style lang="scss" scoped>
.attrs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25em 0.65em;
  margin-bottom: 0.25em;
  max-width: 100%;
  min-width: 0;
}

.attrs__item {
  font-size: 0.72rem;
  color: var(--text-secondary);
  max-width: 100%;
  overflow-wrap: anywhere;
}

.attrs__k {
  opacity: 0.7;
  &::after {
    content: ':';
    margin-right: 0.2em;
  }
}

.attrs__v {
  font-weight: 550;
  overflow-wrap: anywhere;
}
</style>
