export type ExtractTagSpec = {
  tagName: string;
  attrName?: string;
};

export function parseExtractTagSpec(spec: string): ExtractTagSpec | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1) return { tagName: trimmed };
  const tagName = trimmed.slice(0, atIdx).trim();
  const attrName = trimmed.slice(atIdx + 1).trim();
  if (!tagName || !attrName) return null;
  return { tagName, attrName };
}

export function buildCompositeKey(tagName: string, attrName: string, attrValue: string): string {
  return `${tagName}@${attrName}=${attrValue}`;
}

/** 动态属性占位符 {{tag@attr}}（无 =值）；拒绝 total: 等脚本命名空间，避免污染副本族扫描 */
export function parseDynamicAttrPlaceholder(name: string): { tagName: string; attrName: string } | null {
  const trimmed = name.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1) return null;
  const eqIdx = trimmed.indexOf('=', atIdx + 1);
  if (eqIdx !== -1) return null;
  const tagName = trimmed.slice(0, atIdx).trim();
  const attrName = trimmed.slice(atIdx + 1).trim();
  if (!tagName || !attrName) return null;
  // tag/attr 含冒号视为脚本前缀占位符（如 total:item@id），不是动态属性规格
  if (tagName.includes(':') || attrName.includes(':')) return null;
  return { tagName, attrName };
}

export const TOTAL_LAUNCHED_PLACEHOLDER_PREFIX = 'total:launched:';
export const TOTAL_LAST_LAUNCHED_PLACEHOLDER_PREFIX = 'total:last-launched:';

export type TotalLaunchedPlaceholderSpec = {
  tagName: string;
  attrName: string;
  /** 可选任务引用（baseName / 任务名 / id） */
  taskRef?: string;
};

/**
 * 解析 `tag@attr` 或 `tag@attr:任务名`（任务名可含更多冒号）。
 * 在 `@` 之后找第一个 `:` 切开；attr 本身不含 `:`。
 */
export function parseAttrSpecWithOptionalTaskRef(suffix: string): TotalLaunchedPlaceholderSpec | null {
  const trimmed = String(suffix ?? '').trim();
  if (!trimmed) return null;
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1) return null;
  const tagName = trimmed.slice(0, atIdx).trim();
  if (!tagName || tagName.includes(':')) return null;

  const afterAt = trimmed.slice(atIdx + 1);
  const colonIdx = afterAt.indexOf(':');
  let attrName: string;
  let taskRef: string | undefined;
  if (colonIdx === -1) {
    attrName = afterAt.trim();
  } else {
    attrName = afterAt.slice(0, colonIdx).trim();
    const rest = afterAt.slice(colonIdx + 1).trim();
    taskRef = rest || undefined;
  }
  if (!attrName || attrName.includes(':') || attrName.includes('=')) return null;
  return { tagName, attrName, taskRef };
}

/** {{total:last-launched:tag@attr[:任务名]}}：展开楼层快照中上次启动副本的 tag@attr=* 正文 */
export function parseTotalLastLaunchedPlaceholder(name: string): TotalLaunchedPlaceholderSpec | null {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const prefix = TOTAL_LAST_LAUNCHED_PLACEHOLDER_PREFIX.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  return parseAttrSpecWithOptionalTaskRef(trimmed.slice(TOTAL_LAST_LAUNCHED_PLACEHOLDER_PREFIX.length));
}

/** {{total:launched:tag@attr[:任务名]}}：展开副本族本轮可运行（或回退 last）的 tag@attr=* 实例 */
export function parseTotalLaunchedPlaceholder(name: string): TotalLaunchedPlaceholderSpec | null {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  // 避免 total:last-launched: 被误当成 launched
  if (lower.startsWith(TOTAL_LAST_LAUNCHED_PLACEHOLDER_PREFIX.toLowerCase())) return null;
  const prefix = TOTAL_LAUNCHED_PLACEHOLDER_PREFIX.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  return parseAttrSpecWithOptionalTaskRef(trimmed.slice(TOTAL_LAUNCHED_PLACEHOLDER_PREFIX.length));
}

/** {{total:tag@attr}}：展开全部 tag@attr=* 实例 */
export function parseTotalPlaceholder(name: string): { tagName: string; attrName: string } | null {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith('total:')) return null;
  // total:launched:… / total:last-launched:… 由专用解析处理
  if (lower.startsWith(TOTAL_LAST_LAUNCHED_PLACEHOLDER_PREFIX.toLowerCase())) return null;
  if (lower.startsWith(TOTAL_LAUNCHED_PLACEHOLDER_PREFIX.toLowerCase())) return null;
  return parseDynamicAttrPlaceholder(trimmed.slice('total:'.length).trim());
}

export function buildAttrGroupKey(tagName: string, attrName: string): string {
  return `${tagName}_${attrName}`;
}

export function buildExtractSpecKey(tagName: string, attrName: string): string {
  return `${tagName}@${attrName}`;
}

export function sortAttrValues(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

export function parseCompositeKey(key: string): { tagName: string; attrName: string; attrValue: string } | null {
  const atIdx = key.indexOf('@');
  if (atIdx === -1) return null;
  const eqIdx = key.indexOf('=', atIdx + 1);
  if (eqIdx === -1) return null;
  const tagName = key.slice(0, atIdx);
  const attrName = key.slice(atIdx + 1, eqIdx);
  const attrValue = key.slice(eqIdx + 1);
  if (!tagName || !attrName) return null;
  return { tagName, attrName, attrValue };
}

function isValidOpenTagPrefixMatch(source: string, startIdx: number, prefixLen: number): boolean {
  if (startIdx > 0 && source[startIdx - 1] === '/') return false;
  const ch = source[startIdx + prefixLen];
  if (ch === undefined) return true;
  if (ch === '>' || ch === '=') return true;
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return true;
  if (/[A-Za-z0-9_-]/.test(ch)) return false;
  return true;
}

function findOpenTagAt(source: string, tagName: string, fromIndex: number): number {
  const prefix = `<${tagName}`;
  const lowerSource = source.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  let idx = fromIndex;
  while (idx < source.length) {
    const found = lowerSource.indexOf(lowerPrefix, idx);
    if (found === -1) return -1;
    if (isValidOpenTagPrefixMatch(source, found, prefix.length)) return found;
    idx = found + 1;
  }
  return -1;
}

function findOpenTagEnd(source: string, openStart: number): number {
  return source.indexOf('>', openStart);
}

function findCloseTag(source: string, tagName: string, afterOpenEnd: number): number {
  const close = `</${tagName}>`;
  return source.toLowerCase().indexOf(close.toLowerCase(), afterOpenEnd);
}

export function parseOpenTagAttributes(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const inner = openTag.replace(/^<[\w-]+/i, '').replace(/>$/, '').trim();
  if (!inner) return attrs;
  const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name.toLowerCase()] = value;
  }
  return attrs;
}

export type TagInstance = {
  fullBlock: string;
  inner: string;
  attrs: Record<string, string>;
};

export function findAllTagInstances(
  text: string,
  tagName: string,
  options?: { requiredAttr?: string },
): TagInstance[] {
  const source = String(text ?? '');
  if (!source || !tagName) return [];
  const instances: TagInstance[] = [];
  let searchFrom = 0;
  const closeTagLen = `</${tagName}>`.length;
  const requiredAttr = options?.requiredAttr?.trim().toLowerCase();

  while (searchFrom < source.length) {
    const openStart = findOpenTagAt(source, tagName, searchFrom);
    if (openStart === -1) break;
    const openEnd = findOpenTagEnd(source, openStart);
    if (openEnd === -1) break;
    const openTag = source.slice(openStart, openEnd + 1);
    const attrs = parseOpenTagAttributes(openTag);
    if (requiredAttr) {
      const attrValue = attrs[requiredAttr];
      if (attrValue === undefined || attrValue === '') {
        // 跳过缺少目标属性的开标签，避免与后续闭标签错配吞掉带属性块
        searchFrom = openEnd + 1;
        continue;
      }
    }
    const closeStart = findCloseTag(source, tagName, openEnd + 1);
    if (closeStart === -1) break;
    // 带属性摘取：若开→闭之间还有同标签且带目标属性的开标签，则当前开标签为孤儿，跳过以免吞掉最后一对
    if (requiredAttr) {
      let scan = openEnd + 1;
      let hasIntervening = false;
      while (scan < closeStart) {
        const nextOpen = findOpenTagAt(source, tagName, scan);
        if (nextOpen === -1 || nextOpen >= closeStart) break;
        const nextOpenEnd = findOpenTagEnd(source, nextOpen);
        if (nextOpenEnd === -1 || nextOpenEnd >= closeStart) break;
        const nextAttrs = parseOpenTagAttributes(source.slice(nextOpen, nextOpenEnd + 1));
        const nextVal = nextAttrs[requiredAttr];
        if (nextVal !== undefined && nextVal !== '') {
          hasIntervening = true;
          break;
        }
        scan = nextOpenEnd + 1;
      }
      if (hasIntervening) {
        searchFrom = openEnd + 1;
        continue;
      }
    }
    const closeEnd = closeStart + closeTagLen;
    const inner = source.slice(openEnd + 1, closeStart);
    instances.push({
      fullBlock: source.slice(openStart, closeEnd),
      inner,
      attrs,
    });
    searchFrom = closeEnd;
  }
  return instances;
}

/** 取正文中最后一次出现的开标签，并配对其后第一个闭标签 */
export function findLastTagInstance(text: string, tagName: string): TagInstance | null {
  const source = String(text ?? '');
  if (!source || !tagName) return null;

  // 跳过自闭合开标签（如 <角色集 …/>），否则同名嵌套时会误取内层导致内文为空
  let lastOpenStart = -1;
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const openStart = findOpenTagAt(source, tagName, searchFrom);
    if (openStart === -1) break;
    const tentativeEnd = findOpenTagEnd(source, openStart);
    if (tentativeEnd === -1) break;
    const tentativeTag = source.slice(openStart, tentativeEnd + 1);
    if (/\/\s*>$/.test(tentativeTag)) {
      searchFrom = tentativeEnd + 1;
      continue;
    }
    lastOpenStart = openStart;
    searchFrom = openStart + 1;
  }
  if (lastOpenStart === -1) return null;

  const openEnd = findOpenTagEnd(source, lastOpenStart);
  if (openEnd === -1) return null;
  const closeStart = findCloseTag(source, tagName, openEnd + 1);
  if (closeStart === -1) return null;

  const closeTagLen = `</${tagName}>`.length;
  const closeEnd = closeStart + closeTagLen;
  const openTag = source.slice(lastOpenStart, openEnd + 1);
  const inner = source.slice(openEnd + 1, closeStart);
  return {
    fullBlock: source.slice(lastOpenStart, closeEnd),
    inner,
    attrs: parseOpenTagAttributes(openTag),
  };
}

function extractLastTagContentLiteral(text: string, tagName: string): string | null {
  if (!text || !tagName) return null;
  const lower = text.toLowerCase();
  const open = `<${tagName.toLowerCase()}>`;
  const close = `</${tagName.toLowerCase()}>`;
  const closeIdx = lower.lastIndexOf(close);
  if (closeIdx === -1) return null;
  const openIdx = lower.lastIndexOf(open, closeIdx);
  if (openIdx === -1) return null;
  return text.slice(openIdx + open.length, closeIdx);
}

function extractBareTagLastInner(text: string, tagName: string): string | null {
  const last = findLastTagInstance(text, tagName);
  if (last) return last.inner.trim();
  return extractLastTagContentLiteral(text, tagName);
}

function extractByAttrSpec(text: string, spec: ExtractTagSpec): Record<string, string> {
  const result: Record<string, string> = {};
  if (!spec.attrName) return result;
  const instances = findAllTagInstances(text, spec.tagName, { requiredAttr: spec.attrName });
  for (const inst of instances) {
    const attrValue = inst.attrs[spec.attrName.toLowerCase()];
    if (attrValue === undefined || attrValue === '') continue;
    const key = buildCompositeKey(spec.tagName, spec.attrName, attrValue);
    result[key] = inst.inner.trim();
  }
  return result;
}

/** 带属性标签块（引用时重建完整开闭标签，开/闭标签与内文分行） */
export function formatBareTagBlock(tagName: string, inner = ''): string {
  return `<${tagName}>\n${String(inner ?? '')}\n</${tagName}>`;
}

export function formatAttrTagBlock(
  tagName: string,
  attrName: string,
  attrValue: string,
  inner = '',
): string {
  const safeValue = String(attrValue ?? '').replace(/"/g, '&quot;');
  return `<${tagName} ${attrName}="${safeValue}">\n${String(inner ?? '')}\n</${tagName}>`;
}

/** 将已存储值剥为内文（兼容旧完整块存档） */
export function storedTagValueToInner(key: string, value: string): string {
  const v = String(value ?? '').trim();
  if (!v.startsWith('<') || !v.includes('>')) return v;
  const parsed = parseCompositeKey(key);
  const tagName = parsed?.tagName ?? key.split('@')[0] ?? key;
  const instances = findAllTagInstances(v, tagName);
  if (!instances.length) return v;
  return instances[0].inner.trim();
}

export function formatExtractedFragmentForKey(key: string, value: string): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const parsed = parseCompositeKey(key);
  if (parsed) return formatAttrTagBlock(parsed.tagName, parsed.attrName, parsed.attrValue, v);
  const bare = key.indexOf('@') === -1 ? key : key.slice(0, key.indexOf('@'));
  return formatBareTagBlock(bare, v);
}

export interface InjectTagExtractionResult {
  extractedTags: Record<string, string>;
  injectedFragments: string[];
  resolvedKeys: string[];
}

export function getChatExtractTagSpecs(
  chatExtractTags: { user?: string[]; assistant?: string[] } | undefined,
  source: 'user' | 'assistant',
): string[] {
  const specs = chatExtractTags?.[source] ?? [];
  return specs.map(t => t.trim()).filter(Boolean);
}

export function extractInjectTagsFromResponse(
  text: string,
  extractInjectTags: string[] = [],
): InjectTagExtractionResult {
  const specs = extractInjectTags.map(t => parseExtractTagSpec(t)).filter((s): s is ExtractTagSpec => !!s);

  const extractedTags: Record<string, string> = {};
  const injectedFragments: string[] = [];
  const resolvedKeys: string[] = [];

  for (const spec of specs) {
    const configKey = spec.attrName ? `${spec.tagName}@${spec.attrName}` : spec.tagName;

    if (!spec.attrName) {
      const inner = extractBareTagLastInner(text, spec.tagName);
      if (inner === null) continue;
      extractedTags[spec.tagName] = inner;
      injectedFragments.push(formatExtractedFragmentForKey(spec.tagName, inner));
      resolvedKeys.push(spec.tagName);
      continue;
    }

    const byKey = extractByAttrSpec(text, spec);
    const keys = Object.keys(byKey).sort();
    if (!keys.length) continue;
    for (const key of keys) {
      extractedTags[key] = byKey[key];
      injectedFragments.push(formatExtractedFragmentForKey(key, byKey[key]));
      resolvedKeys.push(key);
    }
    if (!resolvedKeys.includes(configKey)) {
      resolvedKeys.push(configKey);
    }
  }

  return { extractedTags, injectedFragments, resolvedKeys };
}

export function parseCompositePlaceholder(name: string): { tagName: string; attrName: string; attrValue: string } | null {
  const trimmed = name.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx === -1) return null;
  const eqIdx = trimmed.indexOf('=', atIdx + 1);
  if (eqIdx === -1) return null;
  const tagName = trimmed.slice(0, atIdx).trim();
  const attrName = trimmed.slice(atIdx + 1, eqIdx).trim();
  const attrValue = trimmed.slice(eqIdx + 1).trim();
  if (!tagName || !attrName) return null;
  return { tagName, attrName, attrValue };
}

export function compositePlaceholderToKey(name: string): string | null {
  const p = parseCompositePlaceholder(name);
  if (!p) return null;
  return buildCompositeKey(p.tagName, p.attrName, p.attrValue);
}

/** 属性标签在楼层变量无数据时，输出带属性空内文的完整标签块 */
export function formatEmptyAttrTagBlock(tagName: string, attrName: string, attrValue: string): string {
  return formatAttrTagBlock(tagName, attrName, attrValue, '');
}

export function isCompositeUnderAttrSpec(
  placeholderName: string,
  spec: { tagName: string; attrName: string },
): boolean {
  const parsed = parseCompositePlaceholder(placeholderName);
  if (!parsed) return false;
  return (
    parsed.tagName.toLowerCase() === spec.tagName.toLowerCase() &&
    parsed.attrName.toLowerCase() === spec.attrName.toLowerCase()
  );
}

export const EXTRACT_INJECT_TAGS_HELP = {
  intro: '逗号分隔多个标签名。从本任务 AI 输出中摘取，写入同轮 relay 与楼层 post_process_tags。',
  modes: [
    {
      title: '裸名',
      config: 'result',
      rule: '扫描所有 <result>…</result>，只取最后一次，存内文；引用时包回 <result>…</result>。内文可含子标签（如容器内的 <npc>），引用时会保留外层标签。',
      example: '<result>旧</result><result>新</result> → key result = "新"',
    },
    {
      title: '按属性',
      config: 'item@id',
      rule: '扫描所有 <item …>，按 id 属性分成 item@id=值，存内文；缺少该属性的开标签忽略，不摘取；同 key 后者覆盖。引用时包回带属性的完整标签块。',
      example: '<item id="1">A</item><item id="2">B</item> → item_id.1="A"、item_id.2="B"',
    },
  ],
  dynamicPlaceholders: {
    title: '动态属性占位符',
    intro:
      '配置「标签@属性」（如 item@id）后，AI 须输出带该属性的开标签（如 <item id="1">…</item>）。摘取结果存内文并写入 post_process_tags.item_id.1 等嵌套结构；引用时自动包回完整标签块。',
    tips: [
      {
        code: '{{item@id}}',
        desc: '副本族识别占位符（无 = 值）：仅作副本族原本的任务规格标识；生成任务副本时自动替换为 {{item@id=1}} 等精确形式，在各副本运行时展开对应单实例。',
      },
      {
        code: '{{total:标签@属性}}',
        desc: '在注入模板或提示词中批量展开全部该属性规格的复合实例，例如 {{total:item@id}} 展开全部 item@id=*。亦注册为酒馆助手宏。',
      },
      {
        code: '{{total:launched:标签@属性}}',
        desc: '覆盖该 spec 下全部副本族：优先展开本轮可运行副本正文，空则回退 last-launched。可写 {{total:launched:标签@属性:任务名}} 收窄。例如 {{total:launched:item@id}}。',
      },
      {
        code: '{{total:last-launched:标签@属性}}',
        desc: '覆盖该 spec 下全部副本族的楼层上次启动正文。可写 {{total:last-launched:标签@属性:任务名}} 收窄。例如 {{total:last-launched:item@id}}。',
      },
      {
        code: '{{item@id=1}}',
        desc: '精确（带 = 值）：只展开单个实例，适合固定引用某一属性值。',
      },
      {
        code: '{{item}}',
        desc: '仅展开裸 key item（不含 item@id=* 复合实例）。',
      },
      {
        desc: '引用时输出完整标签块，保留原始属性，避免双重包裹。',
      },
    ],
  },
  replicaFamily: {
    title: '副本族（与动态占位符联动）',
    intro:
      '当某一阶段需要对「上一阶段枚举出的多个属性实例」分别调用 API 时，可将该任务设为副本族：原本为模板，各副本为原本的实时镜像（默认同步 API 配置；可对本副本设独立 API 预设），运行时按 relay 增量新增缺失副本并并行执行。',
    steps: [
      {
        title: '1. 上一阶段枚举',
        desc: '在较早阶段任务输出 <ReplicaEnum> 包裹的 JSON。单条：{"spec":"item@id","values":["1","2"]}；可选 task 定向：{"spec":"item@id","values":["1"],"task":"副本族处理"}；可选改名：{"spec":"item@id","renames":[{"from":"断剑","to":"锈剑"}],"values":["锈剑"]}（纯 renames 亦可，不必带 values）；批量 {"enums":[...]}。无 task 时广播给所有声明该 spec 的副本族；有 task 时仅喂给该副本族（且与广播互斥）。改名在下一阶段开头或本轮 workflow 结束前生效；若目标 to 已存在（成员/tags/世界书）则整包跳过、不覆盖。同轮链式 rename（如 a→b 与 b→c）按依赖顺序逐条应用；当前成员不在某条 from 上时跳过该条、继续后续边。正文可含其它叙述；不再从 XML item@id 摘取枚举。',
      },
      {
        title: '2. 配置副本族任务',
        desc: '本任务提示词中含且仅含一种动态占位符（如 {{item@id}}，不带 = 值）。可与 {{result}}、$7、{{replica:val}}、{{replica:launched:任务名}} 等其它占位符并存，但不能同时出现两种 {{tag@attr}}。{{replica:val}} 在各副本运行时解析为当前实例属性值（如 1）。',
      },
      {
        title: '3. 启用任务',
        desc: '勾选「启用」后任务标记为「副本族」。原本不参与 API 调用，仅作为模板；UI 中自动生成的副本 tab 会隐藏。',
      },
      {
        title: '4. 镜像与运行时同步',
        desc: '编辑原本或应用任务级工作流预设时，全部已有副本（含 relay 外的存量副本）会实时镜像原本的任务字段；API 在「沿用原本」时跟随原本，「本副本自定义」时保留独立路由。提示词中的 {{item@id}} 在副本中保持为 {{item@id=1}} 等精确形式。进入执行阶段前，读取上一阶段 relay 中由 <ReplicaEnum> 注册的名单增量新增缺失副本（广播键 tag@attr=值；定向键 #replica:<原本id>|tag@attr=值）。同一 spec 可供多个副本族共用。registry key 无注入内文；占位符内容仅从当前楼 post_process_tags 读取。',
      },
      {
        title: '5. 调度模式',
        desc: '自动调度（默认）：每轮仅执行上一阶段 relay 枚举列表中的副本。手动调度：点选副本表示已启动；新建副本首轮自动启动并执行，轮末自动变为未启动。',
      },
    ],
    notes: [
      '上一阶段 relay 无可用属性实例时，自动模式跳过整组；手动模式若无已启动副本则跳过（文案区分原因），有已启动存量副本可继续执行。',
      '关闭「启用」会删除已生成的副本并取消副本族标记。',
      '选中副本族原本后，可通过任务 tab 下方的副本族切换条预览各副本提示词（只读镜像）；编辑请切回「原本」。应用任务级工作流预设会级联更新全部副本。',
      '副本保留 id、属性值、启动状态、独立启停，以及可选的独立 API 预设（沿用原本 / 本副本自定义）；不可修改其它任务级工作流配置（提示词、阶段、提取标签等），第 2 页「按任务配置」仅针对原本；删除副本与手动调度除外。',
      '直接编辑副本（除允许字段外）会在下次镜像时被覆盖。',
      '提示词可用 {{replica:val}} 获取当前副本实例的属性值字符串（无需展开完整 XML 标签块）。',
      '提示词可用 {{replica:launched:任务名}} 列出指定副本族已开启副本的后缀名（顿号连接）；本轮名单为空则回退楼层 last-launched 名单。',
      '提示词可用 {{total:launched:标签@属性}} 展开该 spec 下全部副本族的复合实例正文（本轮优先，空则回退 last-launched）；可写 {{total:launched:标签@属性:任务名}} 收窄。',
      '提示词可用 {{total:last-launched:标签@属性}} 展开该 spec 下全部副本族的楼层上次启动正文；可写 {{total:last-launched:标签@属性:任务名}} 收窄。',
      '{{total:…}} / {{total:launched:…}} / {{total:last-launched:…}} / {{replica:launched:…}} 亦注册为酒馆助手宏，可在主聊天提示词等宏管线中使用。',
    ],
    example:
      'S1「枚举」（<ReplicaEnum> 可 values / renames，可无 task 广播或带 task 定向）→ S2 多个副本族可共用同一 spec（如 {{item@id}}）→ 运行时先应用 renames 再按名单增量生成副本并并行执行',
  },
  relay:
    '同轮 relay 优先；提示词与聊天注入在 relay 缺省时从 post_process_tags 回退（不限于提取写入标签白名单）。副本族借 ReplicaEnum 注册的 relay key 增量新增副本（广播或按 task 定向，无内文），占位符内容读楼层变量（旧 key 保留）。同 key 跨任务/跨阶段内文以 \\n\\n 合并为单段（共用一个外层标签）。引用外层标签时内层已配置提取标签会随 relay 刷新。重跑工作流读上一楼。',
} as const;
