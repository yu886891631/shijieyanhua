import assert from 'node:assert/strict';
import {
  isAddonApiShape,
  invokeClearAddonPatchLog,
  resolveAddonApiFromScopes,
  type ResolvedAddonApi,
} from './resolve-addon-api';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function makeMockAddon(overrides: Partial<ResolvedAddonApi> = {}): ResolvedAddonApi {
  return {
    getAddonData: () => ({ addon_data: {} as Addon.AddonData }),
    replaceAddonData: () => undefined,
    applyAddonUpdateFromMessage: async () => undefined,
    clearPatchLog: () => undefined,
    ...overrides,
  };
}

test('isAddonApiShape requires core methods', () => {
  assert.equal(isAddonApiShape(null), false);
  assert.equal(isAddonApiShape({}), false);
  assert.equal(isAddonApiShape(makeMockAddon()), true);
  assert.equal(
    isAddonApiShape({
      getAddonData: () => ({ addon_data: {} }),
      replaceAddonData: () => undefined,
    }),
    false,
  );
});

test('resolveAddonApiFromScopes prefers local over parent', () => {
  const local = makeMockAddon();
  const parent = makeMockAddon();
  assert.equal(resolveAddonApiFromScopes(local, parent), local);
  assert.equal(resolveAddonApiFromScopes(undefined, parent), parent);
  assert.equal(resolveAddonApiFromScopes(undefined, undefined), null);
  assert.equal(resolveAddonApiFromScopes({ foo: 1 }, { bar: 2 }), null);
});

test('invokeClearAddonPatchLog no-ops immediately when Addon absent', () => {
  const started = Date.now();
  assert.equal(invokeClearAddonPatchLog(null), false);
  assert.ok(Date.now() - started < 50, 'must not wait');
});

test('invokeClearAddonPatchLog calls clearPatchLog when API present', () => {
  let cleared = 0;
  const mock = makeMockAddon({
    clearPatchLog: () => {
      cleared += 1;
    },
  });
  assert.equal(invokeClearAddonPatchLog(mock), true);
  assert.equal(cleared, 1);
});
