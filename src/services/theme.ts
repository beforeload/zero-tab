export const THEME_STORAGE_KEY = 'theme';
export const THEME_MIRROR_KEY = 'zerotab:theme';

export const THEMES = [
  { id: 'terracotta', name: 'Terracotta' },
  { id: 'dark', name: 'Charcoal' },
  { id: 'sage', name: 'Sage' },
  { id: 'slate', name: 'Slate' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'terracotta';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function normalizeTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

export function readThemeMirror(): ThemeId {
  try {
    return normalizeTheme(globalThis.localStorage?.getItem(THEME_MIRROR_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function writeThemeMirror(theme: ThemeId): void {
  try {
    globalThis.localStorage?.setItem(THEME_MIRROR_KEY, theme);
  } catch {
    // The extension still works if synchronous storage is unavailable.
  }
}

export function applyTheme(value: unknown): ThemeId {
  const theme = normalizeTheme(value);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  }
  writeThemeMirror(theme);
  return theme;
}

export function initializeTheme(): ThemeId {
  return applyTheme(readThemeMirror());
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function getThemePreference(): Promise<ThemeId> {
  const mirrored = readThemeMirror();
  if (!hasChromeStorage()) return mirrored;

  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    const theme = normalizeTheme(stored[THEME_STORAGE_KEY]);
    if (!isThemeId(stored[THEME_STORAGE_KEY])) {
      await chrome.storage.local.set({ [THEME_STORAGE_KEY]: mirrored });
      return applyTheme(mirrored);
    }
    return applyTheme(theme);
  } catch {
    return applyTheme(mirrored);
  }
}

export async function saveThemePreference(value: unknown): Promise<ThemeId> {
  const theme = applyTheme(value);
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  }
  return theme;
}
