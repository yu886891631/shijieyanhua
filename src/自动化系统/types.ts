export type AttrMap = Record<string, string>;

export type NpcCategoryKey = 'front' | 'back';

export type NpcReputationItem = {
  label: string;
  value: string;
};

export type NpcSocialPerson = {
  name: string;
  note: string;
};

export type NpcSocialGroup = {
  category: string;
  people: NpcSocialPerson[];
};

export type NpcBackground = {
  group: string;
  circle: string;
  event: string;
};

export type NpcLifeArchive = {
  birthday: string;
  race: string;
  age: string;
  remainingLife: string;
};

export type QuestItemStatus = 'done' | 'active' | 'todo';

export type QuestItem = {
  status: QuestItemStatus;
  text: string;
  children: QuestItem[];
};

export type QuestLog = {
  kind: string;
  title: string;
  summary: string;
  items: QuestItem[];
  /** 收束场景，可空 */
  climax: string;
};

export type QuestArchiveEntry = {
  kind: string;
  title: string;
  completedAt: string;
  ending: string;
};

export type NpcCard = {
  name: string;
  actionChain: string[];
  predict: string;
  debutReady: boolean;
  statusParts: string[];
  wealth: string;
  reputation: NpcReputationItem[];
  /** 社会身份，可多值（分号分隔） */
  socialIdentity: string[];
  socialNetwork: NpcSocialGroup[];
  companions: NpcSocialGroup[];
  background: NpcBackground;
  lifeArchive: NpcLifeArchive;
  longGoal: string;
  nearPlan: string[];
  recentMemories: string[];
  settledMemories: string[];
  coreMemories: string[];
  /** 可选进行中任务；无标签时为空 */
  questLogs: QuestLog[];
  /** 可选已归档任务；无标签时为空，最多 5 条 */
  questArchive: QuestArchiveEntry[];
  /** 名单内有名但尚无行动落盘 */
  empty?: boolean;
};

export type CategorySection = {
  key: NpcCategoryKey;
  typeLabel: string;
  badge: string;
  icon: string;
  names: string[];
  npcs: NpcCard[];
};

export type InteractionEvent = {
  id: string;
  roles: string[];
  summary: string;
  result: string;
};

export type ChronicleBuildInput = {
  frontNames: string[];
  backNames: string[];
  interactions: InteractionEvent[];
};

export type ChronicleData = {
  sections: CategorySection[];
  interactions: InteractionEvent[];
};

export const CATEGORY_META: Record<
  NpcCategoryKey,
  { typeLabel: string; badge: string; icon: string }
> = {
  front: {
    typeLabel: '前台角色',
    badge: 'FRONT',
    icon: '🎭',
  },
  back: {
    typeLabel: '后台角色',
    badge: 'BACK',
    icon: '🔭',
  },
};

export const STATUS_LABELS = [
  '动作',
  '穿着',
  '正在做的事',
  '所处世界',
  '位置',
  '环境',
] as const;

export const FRONT_TASK_NAME = '前台角色';
export const BACK_TASK_NAME = '后台角色';

export type WealthClass =
  | 'wealth-destitute'
  | 'wealth-poor'
  | 'wealth-tight'
  | 'wealth-balanced'
  | 'wealth-comfortable'
  | 'wealth-welloff'
  | 'wealth-rich'
  | 'wealth-tycoon';

export type ReputationClass =
  | 'rep-hated'
  | 'rep-infamous'
  | 'rep-obscure'
  | 'rep-known'
  | 'rep-respected'
  | 'rep-revered'
  | 'rep-default';
