<template>
  <div class="ac-changelog">
    <div class="ac-changelog-toolbar">
      <div class="ac-changelog-meta" v-if="log">
        <span v-if="log.messageId != null">楼层 #{{ log.messageId }}</span>
        <span>{{ formatTime(log.timestamp) }}</span>
        <span>{{ log.ops.length }} 条 op</span>
        <span v-if="errorCount" class="ac-changelog-err">{{ errorCount }} 条问题</span>
        <span v-if="log.changed" class="ac-changelog-ok">已写入</span>
        <span v-else class="ac-changelog-muted">无数据变化</span>
      </div>
      <div class="ac-changelog-meta" v-else>暂无变更记录（等待一次 AddonJSONPatch 更新）</div>
      <div class="ac-changelog-actions">
        <button type="button" class="ac-btn ghost" :disabled="!log" @click="$emit('clear')">清空</button>
        <button type="button" class="ac-btn" :disabled="busy" @click="$emit('reprocess')">重新处理本楼</button>
      </div>
    </div>

    <div v-if="actionError" class="ac-warn" style="margin: 0 0 10px">{{ actionError }}</div>

    <template v-if="log">
      <!-- 1. 失败 / 错误 -->
      <section v-if="hasErrorSection" class="ac-changelog-section ac-changelog-section--error">
        <h3 class="ac-changelog-h ac-changelog-h--error">失败 / 错误</h3>

        <details
          v-for="(item, i) in failedOps"
          :key="'fo' + i"
          class="ac-cmd-card apply"
        >
          <summary class="ac-cmd-summary">
            <span class="ac-cmd-badge apply">apply</span>
            <span class="ac-cmd-title">{{ lastPathSegment(opPath(item.op)) }}</span>
            <span class="ac-cmd-chevron" aria-hidden="true" />
          </summary>
          <div class="ac-cmd-detail">
            <code class="ac-cmd-path-full">{{ opPath(item.op) }}</code>
            <div class="ac-cmd-warn">{{ item.message }}</div>
            <textarea v-model="failedOpEditors[i]" class="ac-cmd-textarea" rows="6" spellcheck="false" />
            <button type="button" class="ac-btn" :disabled="busy" @click="applyEdited(failedOpEditors[i])">
              应用此条
            </button>
          </div>
        </details>

        <details
          v-for="(frag, i) in log.failedFragments"
          :key="'f' + i"
          class="ac-cmd-card parse"
        >
          <summary class="ac-cmd-summary">
            <span class="ac-cmd-badge parse">parse</span>
            <span class="ac-cmd-title">第 {{ frag.index }} 条 · {{ fragHint(frag) }}</span>
            <span class="ac-cmd-chevron" aria-hidden="true" />
          </summary>
          <div class="ac-cmd-detail">
            <div class="ac-cmd-warn">{{ frag.message }}</div>
            <textarea v-model="fragEditors[i]" class="ac-cmd-textarea" rows="8" spellcheck="false" />
            <button type="button" class="ac-btn" :disabled="busy" @click="applyEdited(fragEditors[i], { fragmentIndex: frag.index })">
              应用此条
            </button>
          </div>
        </details>

        <details
          v-for="(issue, i) in orphanErrorIssues"
          :key="'oe' + i"
          class="ac-cmd-card"
          :class="issue.kind"
        >
          <summary class="ac-cmd-summary">
            <span class="ac-cmd-badge" :class="issue.kind">{{ issue.kind }}</span>
            <span class="ac-cmd-title">{{ truncate(issue.message, 48) }}</span>
            <span class="ac-cmd-chevron" aria-hidden="true" />
          </summary>
          <div class="ac-cmd-detail">
            <div class="ac-cmd-body">{{ issue.message }}</div>
          </div>
        </details>
      </section>

      <!-- 2. 手动修复 -->
      <section v-if="manualFixedOps.length" class="ac-changelog-section ac-changelog-section--fixed">
        <h3 class="ac-changelog-h ac-changelog-h--fixed">手动修复</h3>
        <details
          v-for="(item, i) in manualFixedOps"
          :key="'mf' + i"
          class="ac-cmd-card"
          :class="opClass(item.op.op)"
        >
          <summary class="ac-cmd-summary">
            <span class="ac-cmd-badge ac-fixed">已修复</span>
            <span class="ac-cmd-badge" :class="item.op.op">{{ item.op.op }}</span>
            <span class="ac-cmd-title">{{ lastPathSegment(opPath(item.op)) }}</span>
            <span class="ac-cmd-chevron" aria-hidden="true" />
          </summary>
          <div class="ac-cmd-detail">
            <code class="ac-cmd-path-full">{{ opPath(item.op) }}</code>
            <pre class="ac-cmd-json">{{ formatOp(item.op) }}</pre>
          </div>
        </details>
      </section>

      <!-- 3. heal / parse 标记 -->
      <section v-if="hasMarkSection" class="ac-changelog-section ac-changelog-section--mark">
        <h3 class="ac-changelog-h ac-changelog-h--mark">自动修正 / 标记</h3>

        <details
          v-for="(item, i) in healedOps"
          :key="'ho' + i"
          class="ac-cmd-card heal"
          :class="opClass(item.op.op)"
        >
          <summary class="ac-cmd-summary">
            <span class="ac-cmd-badge heal">heal</span>
            <span class="ac-cmd-title">{{ truncate(item.message, 40) }} · {{ lastPathSegment(opPath(item.op)) }}</span>
            <span class="ac-cmd-chevron" aria-hidden="true" />
          </summary>
          <div class="ac-cmd-detail">
            <div class="ac-cmd-body">{{ item.message }}</div>
            <code class="ac-cmd-path-full">{{ opPath(item.op) }}</code>
            <textarea v-model="healedOpEditors[i]" class="ac-cmd-textarea" rows="6" spellcheck="false" />
            <button type="button" class="ac-btn" :disabled="busy" @click="applyEdited(healedOpEditors[i])">
              应用此条
            </button>
          </div>
        </details>

        <details
          v-for="(issue, i) in healTextIssues"
          :key="'h' + i"
          class="ac-cmd-card heal"
        >
          <summary class="ac-cmd-summary">
            <span class="ac-cmd-badge heal">heal</span>
            <span class="ac-cmd-title">{{ truncate(issue.message, 56) }}</span>
            <span class="ac-cmd-chevron" aria-hidden="true" />
          </summary>
          <div class="ac-cmd-detail">
            <div class="ac-cmd-body">{{ issue.message }}</div>
          </div>
        </details>

        <details
          v-for="(issue, i) in markParseIssues"
          :key="'mp' + i"
          class="ac-cmd-card parse-mark"
        >
          <summary class="ac-cmd-summary">
            <span class="ac-cmd-badge parse">parse</span>
            <span class="ac-cmd-title">{{ truncate(issue.message, 56) }}</span>
            <span class="ac-cmd-chevron" aria-hidden="true" />
          </summary>
          <div class="ac-cmd-detail">
            <div class="ac-cmd-body">{{ issue.message }}</div>
          </div>
        </details>
      </section>

      <!-- 4. 正常更新（不含手动修复） -->
      <section v-if="successOps.length" class="ac-changelog-section ac-changelog-section--ok">
        <h3 class="ac-changelog-h">正常更新</h3>
        <details
          v-for="(item, i) in successOps"
          :key="'so' + i"
          class="ac-cmd-card"
          :class="opClass(item.op.op)"
        >
          <summary class="ac-cmd-summary">
            <span class="ac-cmd-badge" :class="item.op.op">{{ item.op.op }}</span>
            <span class="ac-cmd-title">{{ lastPathSegment(opPath(item.op)) }}</span>
            <span class="ac-cmd-chevron" aria-hidden="true" />
          </summary>
          <div class="ac-cmd-detail">
            <code class="ac-cmd-path-full">{{ opPath(item.op) }}</code>
            <textarea v-model="successOpEditors[i]" class="ac-cmd-textarea" rows="6" spellcheck="false" />
            <button type="button" class="ac-btn" :disabled="busy" @click="applyEdited(successOpEditors[i])">
              应用此条
            </button>
          </div>
        </details>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
export type PatchLogIssue = { kind: 'parse' | 'apply' | 'heal'; message: string; op?: any };
export type PatchLogFragment = { index: number; snippet: string; message: string };
export type PatchLogEntry = {
  messageId?: number;
  timestamp: number;
  ops: any[];
  issues: PatchLogIssue[];
  failedFragments: PatchLogFragment[];
  manualFixedOps?: any[];
  changed: boolean;
};

const props = defineProps<{
  log: PatchLogEntry | null;
  busy?: boolean;
  actionError?: string;
}>();

const emit = defineEmits<{
  clear: [];
  reprocess: [];
  applyOp: [op: unknown, meta?: { fragmentIndex?: number }];
  applyError: [message: string];
}>();

const successOpEditors = ref<string[]>([]);
const healedOpEditors = ref<string[]>([]);
const failedOpEditors = ref<string[]>([]);
const fragEditors = ref<string[]>([]);

const errorCount = computed(
  () => (props.log?.issues ?? []).filter(i => i.kind === 'parse' || i.kind === 'apply').length,
);

const healIssues = computed(() => (props.log?.issues ?? []).filter(i => i.kind === 'heal'));

const healedOps = computed(() =>
  healIssues.value
    .filter((i): i is PatchLogIssue & { op: any } => !!i.op)
    .map(i => ({ op: i.op, message: i.message })),
);

const healTextIssues = computed(() => healIssues.value.filter(i => !i.op));

function opKey(op: any): string {
  return JSON.stringify(op);
}

function applyIssueFor(op: any): PatchLogIssue | undefined {
  const key = opKey(op);
  return (props.log?.issues ?? []).find(i => i.kind === 'apply' && i.op && opKey(i.op) === key);
}

const failedOps = computed(() => {
  const log = props.log;
  if (!log) return [] as Array<{ op: any; message: string; index: number }>;
  const out: Array<{ op: any; message: string; index: number }> = [];
  log.ops.forEach((op, index) => {
    const issue = applyIssueFor(op);
    if (issue) out.push({ op, message: issue.message, index });
  });
  return out;
});

function manualFixedPathSet(log: PatchLogEntry): Set<string> {
  const set = new Set<string>();
  for (const op of log.manualFixedOps ?? []) {
    const p = op?.op === 'move' ? op.to : op?.path;
    if (typeof p === 'string' && p) set.add(p);
  }
  return set;
}

const manualFixedOps = computed(() => {
  const log = props.log;
  if (!log) return [] as Array<{ op: any; index: number }>;
  return (log.manualFixedOps ?? []).map((op, index) => ({ op, index }));
});

const successOps = computed(() => {
  const log = props.log;
  if (!log) return [] as Array<{ op: any; index: number }>;
  const fixedPaths = manualFixedPathSet(log);
  const healedKeys = new Set(
    healIssues.value.filter(i => i.op).map(i => opKey(i.op)),
  );
  return log.ops
    .map((op, index) => ({ op, index }))
    .filter(({ op }) => {
      if (applyIssueFor(op)) return false;
      if (healedKeys.has(opKey(op))) return false;
      const p = op?.op === 'move' ? op.to : op?.path;
      if (typeof p === 'string' && fixedPaths.has(p)) return false;
      return true;
    });
});

const orphanErrorIssues = computed(() => {
  const log = props.log;
  if (!log) return [] as PatchLogIssue[];
  const fragMsgs = new Set(log.failedFragments.map(f => f.message));
  return log.issues.filter(i => {
    if (i.kind === 'heal') return false;
    if (i.kind === 'apply' && i.op) return false;
    if (i.kind === 'parse' && fragMsgs.has(i.message)) return false;
    // 非致命 parse 标记（如「跳过 N 条」汇总）进 mark 区，不进错误区
    if (i.kind === 'parse' && /跳过\s*\d+\s*条/.test(i.message)) return false;
    if (i.kind === 'parse' && /整段非法，已按单条/.test(i.message)) return false;
    return i.kind === 'parse' || i.kind === 'apply';
  });
});

const markParseIssues = computed(() => {
  const log = props.log;
  if (!log) return [] as PatchLogIssue[];
  const fragMsgs = new Set(log.failedFragments.map(f => f.message));
  return log.issues.filter(i => {
    if (i.kind !== 'parse') return false;
    if (fragMsgs.has(i.message)) return false;
    return /跳过\s*\d+\s*条/.test(i.message) || /整段非法，已按单条/.test(i.message);
  });
});

const hasErrorSection = computed(
  () =>
    failedOps.value.length > 0 ||
    (props.log?.failedFragments.length ?? 0) > 0 ||
    orphanErrorIssues.value.length > 0,
);

const hasMarkSection = computed(() => healIssues.value.length > 0 || markParseIssues.value.length > 0);

watch(
  () => props.log,
  log => {
    fragEditors.value = (log?.failedFragments ?? []).map(f => f.snippet);
    failedOpEditors.value = failedOps.value.map(item => JSON.stringify(item.op, null, 2));
    successOpEditors.value = successOps.value.map(item => JSON.stringify(item.op, null, 2));
    healedOpEditors.value = healedOps.value.map(item => JSON.stringify(item.op, null, 2));
  },
  { immediate: true },
);

watch(failedOps, ops => {
  failedOpEditors.value = ops.map(item => JSON.stringify(item.op, null, 2));
});

watch(successOps, ops => {
  successOpEditors.value = ops.map(item => JSON.stringify(item.op, null, 2));
});

watch(healedOps, ops => {
  healedOpEditors.value = ops.map(item => JSON.stringify(item.op, null, 2));
});

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function opClass(op: string): string {
  return ['replace', 'insert', 'remove', 'delta', 'move'].includes(op) ? op : 'other';
}

function opPath(op: any): string {
  if (op?.op === 'move') return `${op.from ?? ''} → ${op.to ?? ''}`;
  return String(op?.path ?? '');
}

function lastPathSegment(path: string): string {
  if (path.includes(' → ')) {
    const [from, to] = path.split(' → ');
    return `${lastPathSegment(from?.trim() ?? '')} → ${lastPathSegment(to?.trim() ?? '')}`;
  }
  const parts = String(path || '')
    .split('/')
    .filter(Boolean);
  return parts[parts.length - 1] || path || '(无路径)';
}

function truncate(text: string, max: number): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function fragHint(frag: PatchLogFragment): string {
  const pathMatch = frag.snippet.match(/"path"\s*:\s*"([^"]+)"/);
  if (pathMatch?.[1]) return lastPathSegment(pathMatch[1]);
  return truncate(frag.snippet, 28);
}

function formatOp(op: any): string {
  return JSON.stringify(op, null, 2);
}

function applyEdited(raw: string, meta?: { fragmentIndex?: number }) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      emit('applyError', 'op 必须是单个 JSON 对象');
      return;
    }
    emit('applyOp', parsed, meta);
  } catch (e) {
    emit('applyError', e instanceof Error ? e.message : String(e));
  }
}
</script>
