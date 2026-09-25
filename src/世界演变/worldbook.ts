import type { WorldEvolutionEntity, WorldEvolutionWorld } from './types';

const ENTRY_PREFIX = 'WorldEvolution-';

function escapeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '')
    .trim();
}

function entityEntryName(entity: WorldEvolutionEntity): string {
  const kind = entity.type === 'npc' ? 'NPC' : entity.type === 'organization' ? '组织' : entity.type === 'location' ? '地点' : entity.type;
  return `${ENTRY_PREFIX}${kind}-${entity.name}`;
}

function createEntryContent(entity: WorldEvolutionEntity): string {
  return [
    '<世界演变后台状态>',
    `实体类型：${entity.type}`,
    `实体名称：${entity.name}`,
    `可见性：${entity.visibility}`,
    `最后更新楼层：${entity.sourceMessageId ?? '未知'}`,
    '当前后台状态：',
    JSON.stringify(entity.state, null, 2),
    '</世界演变后台状态>',
  ].join('\n');
}

function createEventContent(event: WorldEvolutionWorld['events'][number]): string {
  return [
    '<世界演变后台事件>',
    `事件编号：${event.id}`,
    `事件类型：${event.type}`,
    `相关对象：${event.actors.join('、') || '未指定'}`,
    `可见性：${event.visibility}`,
    event.time ? `发生时间：${event.time}` : '',
    event.location ? `地点：${event.location}` : '',
    `摘要：${event.summary}`,
    event.details ? `详情：${event.details}` : '',
    '</世界演变后台事件>',
  ]
    .filter(Boolean)
    .join('\n');
}

function createIndexContent(world: WorldEvolutionWorld): string {
  const entities = Object.values(world.entities)
    .filter(entity => entity.visibility !== 'backstage')
    .map(entity => `${entity.name}（${entity.type}）：${summarizeState(entity.state)}`)
    .join('\n');
  const events = world.events
    .filter(event => event.visibility !== 'backstage')
    .slice(-10)
    .map(event => `${event.id}：${event.summary}`)
    .join('\n');
  const scheduledEvents = world.scheduledEvents
    .filter(event => event.visibility !== 'backstage' && event.status === 'pending')
    .slice(-10)
    .map(event => `${event.id}：${event.title}${event.trigger ? `（${event.trigger}）` : ''}`)
    .join('\n');
  return [
    '<世界演变后台索引>',
    `当前世界演变版本：${world.revision}`,
    '活跃对象：',
    entities || '暂无',
    '近期后台事件：',
    events || '暂无',
    '待发生计划：',
    scheduledEvents || '暂无',
    '</世界演变后台索引>',
  ].join('\n');
}

function summarizeState(state: Record<string, unknown>): string {
  const entries = Object.entries(state)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${escapeText(typeof value === 'object' ? JSON.stringify(value) : value)}`);
  return entries.join('；') || '暂无状态摘要';
}

function partialEntry(
  name: string,
  content: string,
  strategy: 'constant' | 'selective',
  keys: string[],
): TypeFest.PartialDeep<WorldbookEntry> {
  return {
    name,
    enabled: true,
    content,
    strategy: {
      type: strategy,
      keys,
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    probability: 100,
    recursion: {
      prevent_incoming: true,
      prevent_outgoing: true,
      delay_until: null,
    },
    effect: {
      sticky: null,
      cooldown: null,
      delay: null,
    },
    position: {
      type: 'at_depth',
      role: 'system',
      depth: 2,
      order: 9800,
    },
    extra: {
      acuWorldEvolution: true,
      managedBy: 'world-evolution-v1',
    },
  };
}

export async function syncWorldEvolutionWorldbook(worldbookName: string, world: WorldEvolutionWorld): Promise<void> {
  const name = worldbookName.trim();
  if (!name) return;

  const managedEntries: TypeFest.PartialDeep<WorldbookEntry>[] = [
    partialEntry(
      `${ENTRY_PREFIX}全局`,
      createIndexContent(world),
      'constant',
      [],
    ),
  ];

  for (const entity of Object.values(world.entities)) {
    if (entity.visibility === 'backstage') continue;
    const keys = [entity.name];
    managedEntries.push(partialEntry(entityEntryName(entity), createEntryContent(entity), 'selective', keys));
  }

  for (const event of world.events.slice(-50)) {
    if (event.visibility === 'backstage') continue;
    const keys = [event.id, ...event.actors].filter(Boolean);
    managedEntries.push(partialEntry(`${ENTRY_PREFIX}事件-${event.id}`, createEventContent(event), 'selective', keys));
  }

  for (const event of world.scheduledEvents) {
    if (event.visibility === 'backstage' || event.status !== 'pending') continue;
    const keys = [event.id, ...event.actors].filter(Boolean);
    const content = [
      '<世界演变待办计划>',
      `计划编号：${event.id}`,
      `相关对象：${event.actors.join('、') || '未指定'}`,
      `计划：${event.title}`,
      event.trigger ? `触发条件：${event.trigger}` : '',
      '</世界演变待办计划>',
    ]
      .filter(Boolean)
      .join('\n');
    managedEntries.push(partialEntry(`${ENTRY_PREFIX}计划-${event.id}`, content, 'selective', keys));
  }

  const current = await getWorldbook(name);
  const retained = current.filter(entry => entry.extra?.acuWorldEvolution !== true);
  await replaceWorldbook(name, [...retained, ...managedEntries], { render: 'debounced' });
}
