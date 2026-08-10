import { useEffect, useRef, useState } from 'react';
import { PaletteIcon } from './Icons';
import {
  applyTheme,
  getThemePreference,
  isThemeId,
  readThemeMirror,
  saveThemePreference,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeId,
} from '../services/theme';

type Props = {
  onChange: (message: string) => void;
};

export function ThemePicker({ onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => readThemeMirror());
  const pickerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getThemePreference().then((stored) => {
      if (!cancelled) setTheme(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const syncTheme = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      const next = changes[THEME_STORAGE_KEY]?.newValue;
      if (areaName !== 'local' || !isThemeId(next)) return;
      setTheme(applyTheme(next));
    };
    chrome.storage.onChanged.addListener(syncTheme);
    return () => chrome.storage.onChanged.removeListener(syncTheme);
  }, []);

  const chooseTheme = async (next: ThemeId) => {
    try {
      const saved = await saveThemePreference(next);
      setTheme(saved);
      onChange(`Theme: ${THEMES.find((candidate) => candidate.id === saved)?.name}`);
      setOpen(false);
    } catch (error) {
      console.warn('[zero-tab] Could not save theme:', error);
      onChange('Could not save theme');
    }
  };

  return (
    <div className="theme-picker workstation-theme-picker" ref={pickerRef}>
      <button
        ref={toggleRef}
        className="header-action theme-toggle workstation-theme-toggle"
        type="button"
        title="Change theme"
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="workstation-theme-menu"
        onClick={() => setOpen((current) => !current)}
      >
        <PaletteIcon />
      </button>
      {open && (
        <div
          className="theme-menu workstation-theme-menu"
          id="workstation-theme-menu"
          role="menu"
          aria-label="Theme"
        >
          <div className="theme-menu-label">Theme</div>
          {THEMES.map((option) => (
            <button
              className={`theme-option${theme === option.id ? ' is-active' : ''}`}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.id}
              key={option.id}
              onClick={() => void chooseTheme(option.id)}
            >
              <span
                className="theme-swatch"
                data-swatch={option.id}
                aria-hidden="true"
              />
              <span className="theme-option-name">{option.name}</span>
              <svg
                className="theme-option-check"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m5 13 4 4 10-11"
                />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
