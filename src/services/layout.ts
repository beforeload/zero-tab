import type { WorkstationLayout } from '../types';

const STORAGE_KEY = 'workstationLayout';

export const DEFAULT_LAYOUT: WorkstationLayout = {
  version: 1,
  cards: {
    openTabs: { collapsed: false },
    dailyHoroscope: { visible: true, collapsed: false },
    savedForLater: { visible: true, collapsed: false },
  },
};

export async function getLayout(): Promise<WorkstationLayout> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<WorkstationLayout> | undefined;
  return {
    ...DEFAULT_LAYOUT,
    ...stored,
    version: 1,
    cards: {
      openTabs: {
        ...DEFAULT_LAYOUT.cards.openTabs,
        ...stored?.cards?.openTabs,
      },
      dailyHoroscope: {
        ...DEFAULT_LAYOUT.cards.dailyHoroscope,
        ...stored?.cards?.dailyHoroscope,
      },
      savedForLater: {
        ...DEFAULT_LAYOUT.cards.savedForLater,
        ...stored?.cards?.savedForLater,
      },
    },
  };
}

export async function saveLayout(layout: WorkstationLayout): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: layout });
}
