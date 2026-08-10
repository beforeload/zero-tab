import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  isThemeId,
  normalizeTheme,
  THEMES,
} from './theme';

describe('theme preferences', () => {
  it('accepts every registered theme id', () => {
    expect(THEMES.every((theme) => isThemeId(theme.id))).toBe(true);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
  });

  it('falls back to terracotta for invalid stored values', () => {
    expect(normalizeTheme('unknown')).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe('terracotta');
  });
});
