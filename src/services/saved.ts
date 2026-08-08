import type { SavedItem } from '../types';

const STORAGE_KEY = 'deferred';

async function getAll(): Promise<SavedItem[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(result[STORAGE_KEY])
    ? (result[STORAGE_KEY] as SavedItem[])
    : [];
}

async function setAll(items: SavedItem[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

export async function getSavedTabs() {
  const visible = (await getAll()).filter((item) => !item.dismissed);
  return {
    active: visible.filter((item) => !item.completed),
    archived: visible.filter((item) => item.completed),
  };
}

export async function saveTabForLater(tab: {
  url: string;
  title: string;
}): Promise<void> {
  const items = await getAll();
  items.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    url: tab.url,
    title: tab.title,
    savedAt: new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await setAll(items);
}

export async function completeSavedTab(id: string): Promise<void> {
  const items = await getAll();
  const match = items.find((item) => item.id === id);
  if (!match) return;
  match.completed = true;
  match.completedAt = new Date().toISOString();
  await setAll(items);
}

export async function dismissSavedTab(id: string): Promise<void> {
  const items = await getAll();
  const match = items.find((item) => item.id === id);
  if (!match) return;
  match.dismissed = true;
  await setAll(items);
}
