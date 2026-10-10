import assert from 'node:assert/strict';
import test from 'node:test';
import { createMinimalT2Fixture } from './t2-defaults';
import { createT3LocalPolicy, T3EngineError } from './t3-engine';
import { describeT3Diagnostic } from './t3-diagnostic';
import { setupT11Test } from './t11-test-fixtures';
import { responseT8Test as response } from './t8-test-fixtures';
test('T11 local diagnostic publishes only trusted category / public field / one-based statement, never raw error text', () => {
  const state = createMinimalT2Fixture(),
    request = {
      ...state,
      sql: 'UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?',
      parameters: [1, 'traveler'],
      batchId: 'safe-batch',
      policy: createT3LocalPolicy(state.template, state.data),
    };
  const error = new T3EngineError('DATA', 'REJECTED-SECRET-AND-API-KEY', 0, 'last_action', 'npc');
  assert.deepEqual(describeT3Diagnostic(error, request), {
    category: 'DATA',
    statement: 1,
    table: 'NPC',
    field: '最近行动',
  });
  assert.doesNotMatch(JSON.stringify(describeT3Diagnostic(error, request)), /SECRET|API-KEY/);
});
test('T11 diagnostics reject arbitrary provider objects and do not guess unknown indices or private field names', () => {
  const state = createMinimalT2Fixture(),
    request = {
      ...state,
      sql: 'SELECT __we_row_id FROM we_npc',
      parameters: [],
      batchId: 'safe-batch',
      policy: createT3LocalPolicy(state.template, state.data),
    };
  assert.equal(describeT3Diagnostic({ code: 'DATA', fieldId: 'goals', message: 'provider secret' }, request), null);
  state.template.tables.find(t => t.id === 'npc')!.fields.find(f => f.id === 'goals')!.visibility.user = false;
  const result = describeT3Diagnostic(new T3EngineError('DATA', 'secret', 99, 'goals', 'npc'), request);
  assert.equal(result!.statement, null);
  assert.equal(result!.field, null);
});
test('T11 real local SQLite macro error reaches the daily view with correct field and statement and no saved version', async () => {
  const f = await setupT11Test(undefined, {
    reply: async r =>
      r.stage === 'macro'
        ? response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', ['bad-number', 'small-valley-weather'])
        : response('SELECT __we_row_id FROM we_npc'),
  });
  await f.controller.start();
  const v = f.controller.view();
  assert.equal(v.run.phase, '宏观阶段');
  assert.equal(v.run.failureField, '风险指数');
  assert.equal(v.run.failureStatement, 1);
  assert.equal(v.revision, f.state.data.revision);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
