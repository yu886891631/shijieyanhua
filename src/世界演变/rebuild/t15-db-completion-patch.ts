/* eslint-disable import-x/no-nodejs-modules -- Node-only, read-only patch generator; never bundled into the plugin. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const T15_DB_REFERENCE_COMMIT = '599e3580c3106fa234ead38fdfe8625080419143';
const registry = 'src/presentation/bootstrap/api-registry.ts';
const trigger = 'src/presentation/triggers/settings-ui-sync/settings-ui-trigger.ts';
const hashes: Record<string, string> = {
  [registry]: '72635F9111994FC04DC6EF4A09E333F0ADA01744BF304B9C9B31E0DA48FEDCDF',
  [trigger]: '1333CDD91F56DC71BC87136487279E63E83E93E19A9CBBF004658F8CCDB38588',
};
function replace(source: string, before: string, after: string) {
  if (source.split(before).length !== 2) throw new Error('数据库源码接线位置不唯一/不匹配；停止生成补丁');
  return source.replace(before, after);
}
const glue = `/** Optional completion observer: never changes the database's model/save/UI behavior. */
import { createT15DbCompletionProducer, type T15DbOutcome } from '../../shared/world-evolution-completion-protocol';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { getChatArray_ACU } from '../chat/chat-service';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU, isAutoUpdatingCard_ACU } from './state-manager';
function current() {
    const c = SillyTavern_API_ACU, chatMessages = getChatArray_ACU(), message = chatMessages[chatMessages.length - 1];
    const card = c?.characters?.[Number(c.characterId)], chat = c?.getCurrentChatId?.();
    if (!c || c.groupId || isAutoUpdatingCard_ACU || !message || message.is_user || message.is_system || message.extra?.type === 'narrator' ||
        !card?.avatar || !chat || card.chat !== chat || typeof message.mes !== 'string') throw new Error('unsupported completion target');
    return {binding:{characterId:card.avatar,hostChatId:chat},message,swipe:message.swipe_id ?? 0,
      text:message.mes,isolation:getCurrentIsolationKey_ACU()};
}
const producer = createT15DbCompletionProducer({
    current, epoch:()=>0, // Consumer also fences all chat/swipe/edit/generation events; no server CAS claim.
    snapshot:()=>{
      const frame = current(), message = frame.message as Record<string, unknown>;
      const all = message.TavernDB_ACU_IsolatedData as Record<string,unknown> | undefined;
      return {data:all && Object.prototype.hasOwnProperty.call(all,frame.isolation) ?
        {TavernDB_ACU_IsolatedData:{[frame.isolation]:all[frame.isolation]}} : {},runtime:currentJsonTableData_ACU ?? {}};
    },
});
export function getWorldEvolutionCompletion_ACU() { return producer.observer; }
export function beginWorldEvolutionCompletion_ACU(keys: string[] | null): object | null {
    try { return producer.begin(keys); } catch { return null; }
}
export function recordWorldEvolutionGroups_ACU(ticket: object | null, keys:string[], result:unknown) {
    if(ticket) { try { producer.groups(ticket,keys,result); } catch { /* Unsupported result cannot authorize evolution. */ } }
}
export function finishWorldEvolutionCompletion_ACU(ticket: object | null, outcome:T15DbOutcome) {
    if(ticket) { try { producer.finish(ticket,outcome,{
      success:'数据库本轮所有计划组与收尾已结束；仍需独立确认保存',failure:'数据库本轮计划失败或未完成',
      cancelled:'数据库本轮停止或还有合并的后续检查',disabled:'数据库自动填表明确停用',
      'frequency-skipped':'本轮按表格计划没有到期任务',unverifiable:'数据库本轮结果无法验证',
    }[outcome]); } catch { /* Notifications must not alter the original database result. */ } }
}
if(typeof window !== 'undefined')window.addEventListener('pagehide',()=>producer.close(),{once:true});
`;

export async function createT15DbPatchSources(reference: string) {
  const files: Record<string, { before: string; after: string }> = {};
  for (const path of [registry, trigger]) {
    const raw = await readFile(resolve(reference, path), 'utf8');
    if (createHash('sha256').update(raw).digest('hex').toUpperCase() !== hashes[path])
      throw new Error('参考数据库文件指纹不匹配；不会对其他版本盲目生成补丁');
    const source = raw.replaceAll('\r\n', '\n');
    files[path] = { before: source, after: source };
  }
  files[registry].after = replace(
    files[registry].after,
    "import { topLevelWindow_ACU } from '../../shared/env';",
    "import { topLevelWindow_ACU } from '../../shared/env';\nimport { getWorldEvolutionCompletion_ACU } from '../../service/runtime/world-evolution-completion';",
  );
  files[registry].after = replace(
    files[registry].after,
    '    createCallbackApi(ctx),',
    '    createCallbackApi(ctx),\n    { getWorldEvolutionCompletion: getWorldEvolutionCompletion_ACU },',
  );
  let s = files[trigger].after;
  s = replace(
    s,
    "import { DEFAULT_CHAR_CARD_PROMPT_ACU } from '../../../shared/defaults-json.js';",
    "import { beginWorldEvolutionCompletion_ACU, recordWorldEvolutionGroups_ACU, finishWorldEvolutionCompletion_ACU } from '../../../service/runtime/world-evolution-completion';\nimport type { T15DbOutcome } from '../../../shared/world-evolution-completion-protocol';\nimport { DEFAULT_CHAR_CARD_PROMPT_ACU } from '../../../shared/defaults-json.js';",
  );
  s = replace(
    s,
    '    autoUpdateTriggerInFlight_ACU = true;',
    `    autoUpdateTriggerInFlight_ACU = true;
    let weRound: object | null = null;
    let weOutcome: T15DbOutcome = 'failure';`,
  );
  s = replace(
    s,
    '    if (!preCheck.canProceed) {',
    `    if (!preCheck.canProceed) {
      if (preCheck.code === 'auto_update_disabled') weOutcome = 'disabled';`,
  );
  s = replace(
    s,
    '    if (plan.tablesToUpdate.length === 0) {',
    `    weRound = beginWorldEvolutionCompletion_ACU(Object.keys(plan.updateGroups));
    if (plan.tablesToUpdate.length === 0) {
      weOutcome = 'frequency-skipped';`,
  );
  s = replace(
    s,
    '                processUpdates: (indices, mode, options) => processUpdates_ACU(indices, mode, options),',
    `                processUpdates: async (indices, mode, options) => {
                    const keys = Object.keys(plan.updateGroups).filter(key => {
                        const group = plan.updateGroups[key], sheets = options?.targetSheetKeys;
                        return Array.isArray(sheets) && group.sheetKeys.length === sheets.length &&
                          group.sheetKeys.every(k => sheets.includes(k)) && JSON.stringify(group.indices) === JSON.stringify(indices);
                    });
                    const value = await processUpdates_ACU(indices, mode, options);
                    recordWorldEvolutionGroups_ACU(weRound, keys.length === 1 ? keys : [], value);
                    return value;
                },`,
  );
  s = replace(
    s,
    '                        processGroupedUpdates: (groups, mode, options) => {',
    '                        processGroupedUpdates: async (groups, mode, options) => {',
  );
  s = replace(
    s,
    '                            return processGroupedRuntimeChunk_ACU(groups, mode, {',
    '                            const value = await processGroupedRuntimeChunk_ACU(groups, mode, {',
  );
  s = replace(
    s,
    '                            });\n                        },',
    `                            });
                            recordWorldEvolutionGroups_ACU(weRound, groups.map(g => g.key), value);
                            return value;
                        },`,
  );
  s = replace(
    s,
    '                processStagingGroupedUpdates: (groups, mode, options) => {',
    '                processStagingGroupedUpdates: async (groups, mode, options) => {',
  );
  s = replace(
    s,
    '                    return executeAutoFillStagingGroups_ACU(groups, mode, {',
    '                    const value = await executeAutoFillStagingGroups_ACU(groups, mode, {',
  );
  s = replace(
    s,
    '                    });\n                },\n                refreshData:',
    `                    });
                    recordWorldEvolutionGroups_ACU(weRound, groups.map(g => g.key), value);
                    return value;
                },
                refreshData:`,
  );
  s = replace(
    s,
    '    // UI：根据返回值显示结果\n',
    `    // The outer result is checked in addition to the actual awaited group runner receipts.
    weOutcome = wasStoppedByUser_ACU ? 'cancelled' :
      result.success === true && result.failedGroups === 0 && result.totalGroups === totalGroups &&
      (!result.autoMergeTriggered || result.autoMergeSuccess === true) ? 'success' : 'failure';
    // UI：根据返回值显示结果
`,
  );
  s = replace(
    s,
    '      autoUpdateTriggerInFlight_ACU = false;',
    `      autoUpdateTriggerInFlight_ACU = false;
      if (wasStoppedByUser_ACU || pendingAutoUpdateTrigger_ACU) weOutcome = 'cancelled';
      if (!weRound) weRound = beginWorldEvolutionCompletion_ACU(null);
      finishWorldEvolutionCompletion_ACU(weRound, weOutcome);`,
  );
  files[trigger].after = s;
  files['src/shared/world-evolution-completion-protocol.ts'] = {
    before: '',
    after: await readFile(new URL('./t15-db-completion-protocol.ts', import.meta.url), 'utf8'),
  };
  files['src/service/runtime/world-evolution-completion.ts'] = { before: '', after: glue };
  return files;
}

/** Full-file, context-checked patch. No source edits or build outputs; caller saves this text using apply_patch. */
export async function createT15DbCompletionPatch(reference: string) {
  const files = await createT15DbPatchSources(reference);
  let patch = `# WorldEvolution database completion compatibility patch\n# Reference: ${T15_DB_REFERENCE_COMMIT}\n# Automatic plan only; no API/save/UI changes, no durable-success claim.\n`;
  for (const [path, { before, after }] of Object.entries(files)) {
    const a = before.replace(/\n$/, '').split('\n'),
      b = after.replace(/\n$/, '').split('\n');
    patch += `diff --git a/${path} b/${path}\n`;
    if (!before) patch += 'new file mode 100644\n';
    patch += `--- ${before ? 'a/' + path : '/dev/null'}\n+++ b/${path}\n`;
    patch += `@@ -${before ? '1,' + a.length : '0,0'} +1,${b.length} @@\n`;
    if (before) patch += a.map(line => '-' + line).join('\n') + '\n';
    patch += b.map(line => '+' + line).join('\n') + '\n';
  }
  return patch;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('需要已核对的参考数据库目录');
  void createT15DbCompletionPatch(resolve(process.argv[2]))
    .then(patch => process.stdout.write(patch))
    .catch(error => {
      process.stderr.write(String(error) + '\n');
      process.exitCode = 1;
    });
}
