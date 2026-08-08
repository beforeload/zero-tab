export type CardId = 'openTabs' | 'dailyHoroscope' | 'savedForLater';

export type CardDefinition = {
  id: CardId;
  title: string;
  description: string;
  region: 'main' | 'sidebar' | 'top';
  required: boolean;
  defaultVisible: boolean;
  collapsible: boolean;
};

export const BUILT_IN_CARDS: readonly CardDefinition[] = [
  {
    id: 'openTabs',
    title: 'Open tabs',
    description: 'Core tab workspace',
    region: 'main',
    required: true,
    defaultVisible: true,
    collapsible: true,
  },
  {
    id: 'dailyHoroscope',
    title: '今日运势',
    description: '按星座本地生成',
    region: 'sidebar',
    required: false,
    defaultVisible: true,
    collapsible: true,
  },
  {
    id: 'savedForLater',
    title: 'Saved for later',
    description: 'Local checklist',
    region: 'sidebar',
    required: false,
    defaultVisible: true,
    collapsible: true,
  },
] as const;
