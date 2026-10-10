/** Explicit iframe boundary only: copy foreign plain JSON without getters/toJSON or prototype methods. */
import { cloneT2Json, type T2Json } from './t2-template';
export function copyT15NativeJson(input: unknown): T2Json {
  const active = new Set<object>();
  let nodes = 0;
  function local(value: unknown, depth: number): unknown {
    if (++nodes > 100000 || depth > 64) throw new Error('宿主 JSON 过大');
    if (value === null || typeof value !== 'object') return value;
    if (active.has(value) || Object.getOwnPropertySymbols(value).length) throw new Error('宿主 JSON 不是纯数据');
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (!Array.isArray(proto) || Object.getPrototypeOf(Object.getPrototypeOf(proto)) !== null)
        throw new Error('宿主数组原型不支持');
    } else if (proto !== null && Object.getPrototypeOf(proto) !== null) throw new Error('宿主对象原型不支持');
    active.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Array.isArray(value)) {
        if (Object.keys(descriptors).length !== value.length + 1) throw new Error('宿主数组包含额外字段');
        const result = [];
        for (let i = 0; i < value.length; i++) {
          const d = descriptors[i];
          if (!d || !('value' in d) || !d.enumerable) throw new Error('宿主数组不是稠密数据');
          result.push(local(d.value, depth + 1));
        }
        return result;
      }
      const result = Object.create(null) as Record<string, unknown>;
      for (const [key, d] of Object.entries(descriptors)) {
        if (!('value' in d) || !d.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key))
          throw new Error('宿主 JSON 含不支持的字段');
        result[key] = local(d.value, depth + 1);
      }
      return result;
    } finally {
      active.delete(value);
    }
  }
  return cloneT2Json(local(input, 0));
}
