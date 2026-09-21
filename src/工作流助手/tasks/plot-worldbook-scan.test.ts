import assert from 'node:assert/strict';
import { buildTaskWorldbookTriggerText, type RelayTagMap } from './utils';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function assemblePlotWorldbookScanText(
  baseScan: string,
  triggerText: string,
  promptContents: string[],
  userInput: string,
): string {
  const needs$8InScan = promptContents.some(c => c.includes('$8'));
  return [baseScan, triggerText, needs$8InScan ? userInput.trim() : ''].filter(Boolean).join('\n');
}

test('buildTaskWorldbookTriggerText expands {{item@id}} with full attr tag blocks', () => {
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = buildTaskWorldbookTriggerText(
    [{ content: 'items:\n{{item@id}}', enabled: true }],
    new Map(),
    history,
    new Set(['item@id']),
    { historyFallback: 'all-tags' },
  );
  assert.ok(out.includes('<item id="1">A</item>'));
  assert.ok(out.includes('<item id="2">B</item>'));
  assert.ok(out.startsWith('items:'));
});

test('buildTaskWorldbookTriggerText expands {{item@id=2}} precisely', () => {
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = buildTaskWorldbookTriggerText(
    [{ content: '{{item@id=2}}', enabled: true }],
    new Map(),
    history,
    new Set(['item@id']),
    { historyFallback: 'all-tags' },
  );
  assert.equal(out, '<item id="2">B</item>');
});

test('buildTaskWorldbookTriggerText expands {{replica:val}} for replica member', () => {
  const out = buildTaskWorldbookTriggerText(
    [{ content: 'id={{replica:val}}', enabled: true }],
    new Map(),
    new Map(),
    new Set(),
    { historyFallback: 'all-tags', replicaAttrValue: '2' },
  );
  assert.equal(out, 'id=2');
});

test('assemblePlotWorldbookScanText includes $8 only when prompt contains $8', () => {
  const base = 'ai context';
  const trigger = '<item id="1">A</item>';
  const user = '用户提到了 magic_sword';

  const with$8 = assemblePlotWorldbookScanText(base, trigger, ['$1', '$8'], user);
  assert.ok(with$8.includes('magic_sword'));
  assert.ok(with$8.includes('ai context'));

  const without$8 = assemblePlotWorldbookScanText(base, trigger, ['$1', '{{item@id}}'], user);
  assert.ok(!without$8.includes('magic_sword'));
  assert.ok(without$8.includes('ai context'));
});
