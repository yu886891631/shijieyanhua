/** JSON Pointer 写路径自愈：自动补全缺失的中间 object 节点 */

function isObjectContainer(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getAtPath(root: unknown, segments: string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      if (segment === '-') {
        return undefined;
      }
      current = current[Number(segment)];
      continue;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

export function pathExists(root: unknown, segments: string[]): boolean {
  return getAtPath(root, segments) !== undefined;
}

/**
 * 写操作前补全路径：
 * - `/世界/{世界名}/...`：世界名必须已存在；中间缺失 map 补 `{}`；标量中间节点不可自愈。
 * - `/社交圈/{圈子名}/...`：圈子键允许静默创建；中间缺失 map 补 `{}`；标量中间节点不可自愈。
 */
export function ensurePathForWrite(root: Record<string, unknown>, segments: string[]): void {
  if (segments.length === 0) {
    throw new Error('不能对根路径执行该操作');
  }

  const top = segments[0]!;
  if (top !== '世界' && top !== '社交圈') {
    throw new Error(`路径不存在: /${segments.join('/')}`);
  }
  if (segments.length < 2) {
    throw new Error(`路径不存在: /${segments.join('/')}`);
  }

  if (top === '世界') {
    const worlds = root['世界'];
    if (!isObjectContainer(worlds)) {
      throw new Error(`路径不存在: /${segments.join('/')}`);
    }
    const worldName = segments[1]!;
    if (!(worldName in worlds)) {
      throw new Error(`路径不存在: /${segments.join('/')}`);
    }

    let current: unknown = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      if (!isObjectContainer(current)) {
        throw new Error(`路径不存在: /${segments.join('/')}`);
      }
      const obj = current;

      // i=0 容器「世界」、i=1 世界名：均不可静默创建
      if (i > 1 && obj[seg] === undefined) {
        obj[seg] = {};
      } else if (obj[seg] !== undefined && i < segments.length - 2 && !isObjectContainer(obj[seg])) {
        throw new Error(`路径不存在: /${segments.join('/')}`);
      }

      current = obj[seg];
      if (current === undefined) {
        throw new Error(`路径不存在: /${segments.join('/')}`);
      }
    }

    if (!isObjectContainer(current) && !Array.isArray(current)) {
      throw new Error(`路径不存在: /${segments.join('/')}`);
    }
    return;
  }

  // top === '社交圈'
  const circles = root['社交圈'];
  if (!isObjectContainer(circles)) {
    throw new Error(`路径不存在: /${segments.join('/')}`);
  }
  const circleName = segments[1]!;
  if (!(circleName in circles)) {
    // 由“额外 AI 管理”允许静默创建圈子键
    circles[circleName] = {};
  }

  let current: unknown = circles[circleName];
  // i 从 2 开始：确保圈子条目下的中间 object map 真实存在
  for (let i = 2; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (!isObjectContainer(current)) {
      throw new Error(`路径不存在: /${segments.join('/')}`);
    }
    const obj = current;
    if (obj[seg] === undefined) {
      obj[seg] = {};
    } else if (!isObjectContainer(obj[seg]) && i < segments.length - 2) {
      throw new Error(`路径不存在: /${segments.join('/')}`);
    }
    current = obj[seg];
  }

  if (!isObjectContainer(current) && !Array.isArray(current)) {
    // 标量中间节点不可自愈：到达父级时必须是容器
    throw new Error(`路径不存在: /${segments.join('/')}`);
  }
}

export function resolveParentStrict(
  root: Record<string, unknown>,
  segments: string[],
): { parent: Record<string, unknown> | unknown[]; key: string } {
  if (segments.length === 0) {
    throw new Error('不能对根路径执行该操作');
  }
  const parentSegments = segments.slice(0, -1);
  const key = segments[segments.length - 1]!;
  let parent: unknown = root;
  for (const segment of parentSegments) {
    if (parent === null || parent === undefined) {
      throw new Error(`路径不存在: /${segments.join('/')}`);
    }
    if (Array.isArray(parent)) {
      if (segment === '-') {
        throw new Error(`路径不存在: /${segments.join('/')}`);
      }
      parent = parent[Number(segment)];
      continue;
    }
    if (typeof parent === 'object') {
      parent = (parent as Record<string, unknown>)[segment];
      continue;
    }
    throw new Error(`路径不存在: /${segments.join('/')}`);
  }
  if (parent === null || parent === undefined || typeof parent !== 'object') {
    throw new Error(`路径不存在: /${segments.join('/')}`);
  }
  return { parent: parent as Record<string, unknown> | unknown[], key };
}

export function resolveParentForWrite(
  root: Record<string, unknown>,
  segments: string[],
): { parent: Record<string, unknown> | unknown[]; key: string } {
  ensurePathForWrite(root, segments);
  return resolveParentStrict(root, segments);
}
