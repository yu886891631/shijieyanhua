/** 副本属性值身份：间隔号与空白的正规化，避免全角/半角写法被当成不同副本。 */

const CANONICAL_MIDDLE_DOT = '\u00B7';
/** 中文间隔号 / 全角・ / 半角･ / 常见项目符号；不含 ASCII 句点 */
const MIDDLE_DOT_RE = /[\u00B7\u2022\u2027\u2219\u22C5\u30FB\uFF65]/g;
const WHITESPACE_RE = /\s+/g;
const DOT_SIDE_SPACE_RE = new RegExp(`\\s*${CANONICAL_MIDDLE_DOT}\\s*`, 'g');

export type ReplicaAttrIdentityMember = {
  id?: string;
  replicaFamilyAttrValue?: string;
  replicaFamilyLaunched?: boolean;
};

export function normalizeReplicaAttrValue(raw: string): string {
  return String(raw ?? '')
    .replace(MIDDLE_DOT_RE, CANONICAL_MIDDLE_DOT)
    .replace(WHITESPACE_RE, ' ')
    .replace(DOT_SIDE_SPACE_RE, CANONICAL_MIDDLE_DOT)
    .trim();
}

export function replicaAttrIdentityEquals(a: string, b: string): boolean {
  const left = normalizeReplicaAttrValue(a);
  const right = normalizeReplicaAttrValue(b);
  return !!left && left === right;
}

/**
 * 按正规化身份从成员里选一个。
 * 优先字面等于传入值，其次 launched，否则列表中先出现的。
 */
export function pickReplicaByAttrIdentity<T extends ReplicaAttrIdentityMember>(
  members: readonly T[],
  attrValue: string,
): T | undefined {
  const target = normalizeReplicaAttrValue(attrValue);
  if (!target) return undefined;
  const candidates = members.filter(
    m => normalizeReplicaAttrValue(m.replicaFamilyAttrValue ?? '') === target,
  );
  if (!candidates.length) return undefined;
  const exact = candidates.find(m => (m.replicaFamilyAttrValue ?? '') === attrValue);
  if (exact) return exact;
  const launched = candidates.find(m => m.replicaFamilyLaunched === true);
  if (launched) return launched;
  return candidates[0];
}
