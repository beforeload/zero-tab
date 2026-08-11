import { describe, expect, it } from 'vitest';
import type { WorkstationLayout } from '../types';
import { DEFAULT_LAYOUT, normalizeLayout } from './layout';

describe('workstation layout', () => {
  it('returns the default layout when nothing is stored', () => {
    expect(normalizeLayout()).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps known card preferences and fills missing cards', () => {
    const layout = normalizeLayout({
      version: 1,
      cards: {
        openTabs: { collapsed: true },
        savedForLater: { visible: false, collapsed: true },
      } as Partial<WorkstationLayout>['cards'],
    });

    expect(layout.cards.openTabs).toEqual({ collapsed: true });
    expect(layout.cards.savedForLater).toEqual({
      visible: false,
      collapsed: true,
    });
    expect(layout.cards.dailyHoroscope).toEqual(
      DEFAULT_LAYOUT.cards.dailyHoroscope,
    );
  });

  it('forces layout version 1 even if storage has another value', () => {
    expect(
      normalizeLayout({
        version: 9 as WorkstationLayout['version'],
        cards: DEFAULT_LAYOUT.cards,
      }).version,
    ).toBe(1);
  });
});
