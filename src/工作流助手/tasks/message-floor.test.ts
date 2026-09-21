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

type MockMsg = { role: string; message?: string };

function withMocks(
  chatLength: number,
  roles: Record<number, MockMsg>,
  fn: () => void,
  options?: { lastMessageId?: number; allowReadAtLength?: boolean },
): void {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    getChatMessages: g.getChatMessages,
    getLastMessageId: g.getLastMessageId,
    getVariables: g.getVariables,
  };
  const lastMessageId = options?.lastMessageId ?? chatLength;
  const allowReadAtLength = options?.allowReadAtLength ?? false;
  g.getChatMessages = (id: number) => {
    if (id === -1) {
      let max = -1;
      for (const key of Object.keys(roles)) {
        const n = Number(key);
        if (n > max) max = n;
      }
      if (max < 0) return [];
      const msg = roles[max];
      return msg ? [{ role: msg.role, message: msg.message ?? (msg.role === 'assistant' ? 'reply' : 'hello'), message_id: max }] : [];
    }
    const upper = allowReadAtLength ? chatLength + 1 : chatLength;
    if (id < 0 || id >= upper) return [];
    const msg = roles[id];
    return msg
      ? [{ role: msg.role, message: msg.message ?? (msg.role === 'assistant' ? 'reply' : 'hello'), message_id: id }]
      : [];
  };
  g.getLastMessageId = () => lastMessageId;
  g.getVariables = (opt: { type: string; message_id?: number }) => {
    if (opt.type !== 'message' || opt.message_id == null) return {};
    const id = opt.message_id;
    if (id < 0) {
      const resolved = lastMessageId + 1 + id;
      if (resolved < 0 || resolved >= chatLength) {
        throw new Error(`提供的消息楼层号 '${id}' 超出了范围`);
      }
      return {};
    }
    if (id >= chatLength) {
      throw new Error(`提供的消息楼层号 '${id}' 超出了范围 [-${chatLength}, ${chatLength})`);
    }
    return {};
  };
  try {
    fn();
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getLastMessageId = prev.getLastMessageId;
    g.getVariables = prev.getVariables;
  }
}

test('normalizeMessageFloorId clamps count-style getLastMessageId off-by-one', async () => {
  const { normalizeMessageFloorId } = await import('./message-floor');
  withMocks(52, { 51: { role: 'assistant' } }, () => {
    assert.equal(normalizeMessageFloorId(52), 51);
  });
});

test('normalizeMessageFloorId keeps inclusive max index when variables allow', async () => {
  const { normalizeMessageFloorId, resolveManualRerunFloorId } = await import('./message-floor');
  withMocks(
    58,
    { 56: { role: 'user' }, 57: { role: 'assistant' } },
    () => {
      assert.equal(normalizeMessageFloorId(57), 57);
      assert.equal(resolveManualRerunFloorId(), 57);
    },
    { lastMessageId: 57, allowReadAtLength: true },
  );
});

test('isAccessibleMessageFloor rejects count upper bound without variables access', async () => {
  const { isAccessibleMessageFloor } = await import('./message-floor');
  withMocks(
    52,
    { 51: { role: 'assistant' }, 52: { role: 'assistant' } },
    () => {
      assert.equal(isAccessibleMessageFloor(52), false);
      assert.equal(isAccessibleMessageFloor(51), true);
    },
    { allowReadAtLength: true },
  );
});

test('resolveAutoTriggerMessageId uses assistant at normalized floor', async () => {
  const { resolveAutoTriggerMessageId } = await import('./message-floor');
  withMocks(52, { 51: { role: 'assistant' } }, () => {
    const resolved = resolveAutoTriggerMessageId(52);
    assert.deepEqual(resolved, { id: 51, role: 'assistant' });
  });
});

test('resolveAutoTriggerMessageId skips when latest floor is user (aborted generation)', async () => {
  const { resolveAutoTriggerMessageId } = await import('./message-floor');
  withMocks(52, { 50: { role: 'assistant' }, 51: { role: 'user' } }, () => {
    assert.equal(resolveAutoTriggerMessageId(51), null);
    assert.equal(resolveAutoTriggerMessageId(52), null);
  });
});

test('resolveAutoTriggerMessageId skips empty assistant placeholder after abort', async () => {
  const { resolveAutoTriggerMessageId } = await import('./message-floor');
  withMocks(52, { 50: { role: 'assistant' }, 51: { role: 'assistant', message: '   ' } }, () => {
    assert.equal(resolveAutoTriggerMessageId(51), null);
  });
});

test('resolveAutoTriggerMessageId remaps user event to latest assistant when reply completed', async () => {
  const { resolveAutoTriggerMessageId } = await import('./message-floor');
  withMocks(52, { 50: { role: 'user' }, 51: { role: 'assistant' } }, () => {
    const resolved = resolveAutoTriggerMessageId(50);
    assert.deepEqual(resolved, { id: 51, role: 'assistant' });
  });
});

if (process.exitCode) process.exit(process.exitCode);
