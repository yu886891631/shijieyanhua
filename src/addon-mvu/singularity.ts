import type { AddonData } from './schema';
import { getWorldMap } from './schema';

export type SingularityRef = {
  world: string;
  name: string;
  降临: boolean;
};

/** 扫描全部世界下的特异点.降临 */
export function listSingularities(data: AddonData): SingularityRef[] {
  const out: SingularityRef[] = [];
  for (const [world, entry] of Object.entries(getWorldMap(data))) {
    const map = _.get(entry, '时代快讯.岁月史书.特异点') as Record<string, { 降临?: boolean }> | undefined;
    if (!map || typeof map !== 'object') continue;
    for (const [name, item] of Object.entries(map)) {
      out.push({ world, name, 降临: item?.降临 === true });
    }
  }
  return out;
}

export function setSingularityFlag(data: AddonData, world: string, name: string, value: boolean): void {
  const path = `世界.${world}.时代快讯.岁月史书.特异点.${name}.降临`;
  _.set(data, path, value);
}

/** 将全局所有特异点.降临设为 false，可选保留某一个为 true */
export function clearAllSingularityDescents(data: AddonData, except?: { world: string; name: string }): void {
  for (const ref of listSingularities(data)) {
    const keep = except && ref.world === except.world && ref.name === except.name;
    setSingularityFlag(data, ref.world, ref.name, keep === true);
  }
}

export function findNewlyActivatedSingularity(
  oldData: AddonData,
  newData: AddonData,
): SingularityRef | null {
  const oldMap = new Map(listSingularities(oldData).map(s => [`${s.world}/${s.name}`, s.降临]));
  for (const s of listSingularities(newData)) {
    const was = oldMap.get(`${s.world}/${s.name}`) === true;
    if (!was && s.降临) return s;
  }
  return null;
}

export function findDeactivatedActiveSingularity(
  oldData: AddonData,
  newData: AddonData,
  activeKey: string | null,
): SingularityRef | null {
  if (!activeKey) return null;
  const [world, ...rest] = activeKey.split('/');
  const name = rest.join('/');
  if (!world || !name) return null;
  const oldOn = _.get(oldData, `世界.${world}.时代快讯.岁月史书.特异点.${name}.降临`) === true;
  const newOn = _.get(newData, `世界.${world}.时代快讯.岁月史书.特异点.${name}.降临`) === true;
  if (oldOn && !newOn) return { world, name, 降临: false };
  return null;
}
