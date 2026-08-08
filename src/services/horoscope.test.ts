import { describe, expect, it } from 'vitest';
import {
  generateDailyHoroscope,
  localDateKey,
  ZODIAC_SIGNS,
} from './horoscope';

describe('daily horoscope', () => {
  it('returns the same result for the same local date and zodiac sign', () => {
    const first = generateDailyHoroscope('leo', '2026-08-08');
    const second = generateDailyHoroscope('leo', '2026-08-08');
    expect(second).toEqual(first);
  });

  it('changes when the date or zodiac changes', () => {
    const current = generateDailyHoroscope('leo', '2026-08-08');
    expect(generateDailyHoroscope('leo', '2026-08-09')).not.toEqual(current);
    expect(generateDailyHoroscope('virgo', '2026-08-08')).not.toEqual(current);
  });

  it('formats a date using local calendar fields', () => {
    expect(localDateKey(new Date(2026, 0, 2, 23, 30))).toBe('2026-01-02');
  });

  it('defines all twelve zodiac signs', () => {
    expect(ZODIAC_SIGNS).toHaveLength(12);
    expect(new Set(ZODIAC_SIGNS.map((sign) => sign.id)).size).toBe(12);
  });
});
