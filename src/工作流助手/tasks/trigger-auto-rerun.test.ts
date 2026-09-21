import assert from 'node:assert/strict';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('round interval 0 and 1 always pass schedule gate', async () => {
  const { shouldRunTask } = await import('./schedule');
  const task = {
    id: 't',
    name: 't',
    enabled: true,
    stage: 1,
    extractInjectTags: ['result'],
    promptGroups: [],
    schedule: { mode: 'round' as const, roundInterval: 1 },
  };
  const ctx = {
    currentRound: 10,
    currentAiText: '',
    currentPairText: '',
    settings: { scheduleState: { t: { lastRunRound: 10 } } },
    bypassSchedule: false,
  };
  assert.equal(shouldRunTask(task, ctx.settings.scheduleState.t, ctx).run, true);
  task.schedule!.roundInterval = 0;
  assert.equal(shouldRunTask(task, undefined, ctx).run, true);
});

if (process.exitCode) process.exit(process.exitCode);
