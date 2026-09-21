import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeReplicaAttrValue,
  pickReplicaByAttrIdentity,
  replicaAttrIdentityEquals,
} from './replica-attr-identity';

test('normalizeReplicaAttrValue unifies middle-dot variants', () => {
  const expected = '波尔特·瓦伦';
  assert.equal(normalizeReplicaAttrValue('波尔特·瓦伦'), expected);
  assert.equal(normalizeReplicaAttrValue('波尔特・瓦伦'), expected);
  assert.equal(normalizeReplicaAttrValue('波尔特･瓦伦'), expected);
  assert.equal(normalizeReplicaAttrValue('波尔特•瓦伦'), expected);
});

test('normalizeReplicaAttrValue folds whitespace and trims', () => {
  assert.equal(normalizeReplicaAttrValue('  波尔特·瓦伦  '), '波尔特·瓦伦');
  assert.equal(normalizeReplicaAttrValue('波尔特　·　瓦伦'), '波尔特·瓦伦');
  assert.equal(normalizeReplicaAttrValue('波尔特 · 瓦伦'), '波尔特·瓦伦');
});

test('normalizeReplicaAttrValue does not treat ASCII period as a name separator', () => {
  assert.equal(normalizeReplicaAttrValue('A.B'), 'A.B');
  assert.equal(replicaAttrIdentityEquals('A.B', 'A·B'), false);
});

test('replicaAttrIdentityEquals treats dot and space variants as the same person', () => {
  assert.equal(replicaAttrIdentityEquals('波尔特・瓦伦', '波尔特·瓦伦'), true);
  assert.equal(replicaAttrIdentityEquals('波尔特 · 瓦伦', '波尔特·瓦伦'), true);
  assert.equal(replicaAttrIdentityEquals('波尔特·瓦伦', '波尔特·瓦伦二'), false);
  assert.equal(replicaAttrIdentityEquals('   ', ''), false);
});

test('pickReplicaByAttrIdentity prefers exact literal then launched then first', () => {
  const members = [
    { id: 'a', replicaFamilyAttrValue: '波尔特・瓦伦', replicaFamilyLaunched: false },
    { id: 'b', replicaFamilyAttrValue: '波尔特·瓦伦', replicaFamilyLaunched: false },
    { id: 'c', replicaFamilyAttrValue: '波尔特･瓦伦', replicaFamilyLaunched: true },
  ];
  assert.equal(pickReplicaByAttrIdentity(members, '波尔特·瓦伦')?.id, 'b');
  assert.equal(pickReplicaByAttrIdentity(members.slice(0, 1).concat(members.slice(2)), '波尔特·瓦伦')?.id, 'c');
  assert.equal(pickReplicaByAttrIdentity([members[0]!], '波尔特·瓦伦')?.id, 'a');
  assert.equal(pickReplicaByAttrIdentity(members, '其他人'), undefined);
});
