export async function injectToAiFloor(
  messageId: number,
  aiBlock: string,
  options?: { isRerun?: boolean },
): Promise<void> {
  if (!aiBlock.trim()) return;

  const msg = getChatMessages(messageId)[0];
  if (!msg) return;

  const data = (msg.data ?? {}) as Record<string, unknown>;
  let original = msg.message ?? '';

  if (options?.isRerun) {
    const prevBlock = data._post_process_inject_block;
    if (typeof prevBlock === 'string' && prevBlock && original.endsWith(prevBlock)) {
      original = original.slice(0, -prevBlock.length).trimEnd();
    }
  }

  const suffix = original.trimEnd() ? `\n${aiBlock}` : aiBlock;

  await setChatMessages(
    [
      {
        message_id: messageId,
        message: `${original}${suffix}`,
        data: {
          ...data,
          _post_process_done: true,
          _post_process_inject_block: aiBlock,
        },
      },
    ],
    { refresh: 'affected' },
  );
}
