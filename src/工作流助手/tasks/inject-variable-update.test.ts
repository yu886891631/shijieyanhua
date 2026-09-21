import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectStageVariableUpdateSources,
  hasUpdateVariableTag,
} from './inject-variable-update-logic';

test('hasUpdateVariableTag detects tag case-insensitively', () => {
  assert.equal(hasUpdateVariableTag('<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>'), true);
  assert.equal(hasUpdateVariableTag('<updatevariable>x</updatevariable>'), true);
  assert.equal(hasUpdateVariableTag('<JSONPatch>[]</JSONPatch>'), false);
  assert.equal(hasUpdateVariableTag(''), false);
});

test('collectStageVariableUpdateSources keeps success order and skips failures', () => {
  const sources = collectStageVariableUpdateSources([
    {
      success: true,
      variableUpdateSource: '<UpdateVariable><JSONPatch>[{"op":"replace"}]</JSONPatch></UpdateVariable>',
    },
    {
      success: false,
      variableUpdateSource: '<UpdateVariable>fail</UpdateVariable>',
    },
    {
      success: true,
      skipped: true,
      variableUpdateSource: '<UpdateVariable>skipped</UpdateVariable>',
    },
    {
      success: true,
      variableUpdateSource: 'no variable tag here',
    },
    {
      success: true,
      variableUpdateSource:
        'prefix\n<UpdateVariable><AddonJSONPatch>[]</AddonJSONPatch></UpdateVariable>\nsuffix',
    },
  ]);

  assert.equal(sources.length, 2);
  assert.match(sources[0]!, /JSONPatch/);
  assert.match(sources[1]!, /AddonJSONPatch/);
});

test('collectStageVariableUpdateSources ignores empty source even if success', () => {
  assert.deepEqual(
    collectStageVariableUpdateSources([
      { success: true, variableUpdateSource: '' },
      { success: true, variableUpdateSource: '   ' },
      { success: true },
    ]),
    [],
  );
});
