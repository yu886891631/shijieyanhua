import assert from 'node:assert/strict';
import { PostProcessTaskSchema } from './schema';
import {
  buildReplicaEnumPromptGroupContent,
  REPLICA_ENUM_PROMPT_GROUP_NAME,
} from './replica-enum-prompt-rules';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('buildReplicaEnumPromptGroupContent is non-empty and titled', () => {
  const content = buildReplicaEnumPromptGroupContent();
  assert.ok(content.length > 200);
  assert.match(content, /\[ReplicaEnum 输出规则\]/);
});

test('rules cover spec values task renames enums and registry semantics', () => {
  const content = buildReplicaEnumPromptGroupContent();
  assert.match(content, /<ReplicaEnum>/);
  assert.match(content, /"spec":"item@name"/);
  assert.match(content, /"values"/);
  assert.match(content, /"task":"副本族处理"/);
  assert.match(content, /"task":"副本族旁注"/);
  assert.match(content, /"renames"/);
  assert.match(content, /"enums"/);
  assert.match(content, /renames\.to/);
  assert.match(content, /整包跳过/);
  assert.match(content, /最后一个开标签/);
  assert.match(content, /仅最后一块生效/);
});

test('rules group attaches to PostProcessTask schema', () => {
  const task = PostProcessTaskSchema.parse({
    id: 't1',
    name: 'enum',
    promptGroups: [
      { name: '', role: 'system', content: 'role', enabled: true },
      {
        name: REPLICA_ENUM_PROMPT_GROUP_NAME,
        role: 'system',
        content: buildReplicaEnumPromptGroupContent(),
        enabled: true,
      },
      { name: '', role: 'user', content: 'go', enabled: true },
    ],
  });
  assert.equal(task.promptGroups.length, 3);
  assert.equal(task.promptGroups[1]!.name, REPLICA_ENUM_PROMPT_GROUP_NAME);
});

if (process.exitCode) process.exit(process.exitCode);
