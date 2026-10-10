/** Build-time replacement for the EXISTING API SFC in the isolated visual harness only.
 * No keys, real storage, bridge or transport. Production imports never reference this module. */
import {
  createEmptyWorldEvolutionApiConfiguration as empty,
  upsertWorldEvolutionApiPreset as upsert,
  removeWorldEvolutionApiPreset as remove,
} from '../api-config';
export {
  empty as createEmptyWorldEvolutionApiConfiguration,
  upsert as upsertWorldEvolutionApiPreset,
  remove as removeWorldEvolutionApiPreset,
};
export const WORLD_EVOLUTION_VERSION = 'T14-local-visual-1 · 既有 API 安全夹具';
export const resolveWorldEvolutionApiRouting = () => ({ state: 'unconfigured', effectiveRoutes: [] });
let state = empty(0);
export const loadSettings = () => ({ apiPresetName: '', apiFallbackPresetNames: [] });
export const loadWorldEvolutionApiConfiguration = () => structuredClone(state);
export const saveWorldEvolutionApiConfiguration = (value: typeof state) => {
  state = structuredClone(value);
  return structuredClone(state);
};
export const callWorldEvolutionApiPreset = async () => ({ ok: true as const, text: '仅界面夹具，未测试网络或 Key' });
