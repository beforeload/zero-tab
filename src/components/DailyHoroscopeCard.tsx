import { useEffect, useMemo, useState } from 'react';
import type { ZodiacSign } from '../types';
import {
  generateDailyHoroscope,
  getHoroscopePrefs,
  localDateKey,
  saveHoroscopePrefs,
  ZODIAC_SIGNS,
} from '../services/horoscope';
import { CardFrame } from './CardFrame';

type Props = {
  collapsed: boolean;
  onToggle(): void;
  onHide(): void;
};

function Rating({ value }: { value: number }) {
  return (
    <span className="horoscope-rating" aria-label={`${value} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span className={index < value ? 'is-active' : ''} key={index}>
          ●
        </span>
      ))}
    </span>
  );
}

export function DailyHoroscopeCard({
  collapsed,
  onToggle,
  onHide,
}: Props) {
  const [zodiac, setZodiac] = useState<ZodiacSign | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getHoroscopePrefs()
      .then((prefs) => {
        if (!cancelled) setZodiac(prefs.zodiac);
      })
      .catch((error: unknown) => {
        console.warn('[zero-tab] Could not load horoscope preferences:', error);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const result = useMemo(
    () => (zodiac ? generateDailyHoroscope(zodiac, localDateKey()) : null),
    [zodiac],
  );
  const selected = ZODIAC_SIGNS.find((sign) => sign.id === zodiac);

  const updateZodiac = (value: ZodiacSign | null) => {
    setZodiac(value);
    void saveHoroscopePrefs({ zodiac: value }).catch((error: unknown) => {
      console.warn('[zero-tab] Could not save horoscope preferences:', error);
    });
  };

  return (
    <CardFrame
      title="今日运势"
      count={selected?.name}
      collapsed={collapsed}
      onToggle={onToggle}
      onHide={onHide}
      className="horoscope-card"
    >
      {!loaded && <div className="horoscope-loading">正在读取今日星象…</div>}

      {loaded && !result && (
        <div className="horoscope-onboarding">
          <span className="horoscope-mark">✦</span>
          <strong>选择你的星座</strong>
          <p>运势由日期和星座在本地生成，不会上传任何信息。</p>
          <select
            value=""
            onChange={(event) =>
              updateZodiac(event.target.value as ZodiacSign)
            }
            aria-label="选择星座"
          >
            <option value="" disabled>
              请选择
            </option>
            {ZODIAC_SIGNS.map((sign) => (
              <option value={sign.id} key={sign.id}>
                {sign.symbol} {sign.name} · {sign.dates}
              </option>
            ))}
          </select>
        </div>
      )}

      {result && selected && (
        <>
          <div className="horoscope-hero">
            <div className="horoscope-sign">
              <span>{selected.symbol}</span>
              <div>
                <strong>{selected.name}</strong>
                <small>{selected.dates}</small>
              </div>
            </div>
            <div className="horoscope-score">
              <strong>{result.overall}</strong>
              <small>综合指数</small>
            </div>
          </div>

          <p className="horoscope-summary">{result.summary}</p>

          <div className="horoscope-metrics">
            <div>
              <span>事业</span>
              <Rating value={result.work} />
            </div>
            <div>
              <span>感情</span>
              <Rating value={result.love} />
            </div>
            <div>
              <span>能量</span>
              <Rating value={result.energy} />
            </div>
          </div>

          <div className="horoscope-lucky">
            <div>
              <span
                className="horoscope-color"
                style={{ backgroundColor: result.luckyColor.hex }}
              />
              <span>{result.luckyColor.name}</span>
            </div>
            <div>
              <span className="horoscope-number">{result.luckyNumber}</span>
              <span>幸运数字</span>
            </div>
          </div>

          <blockquote>{result.advice}</blockquote>

          <div className="horoscope-settings">
            <span>仅供娱乐 · 每日零点更新</span>
            <select
              value={zodiac || ''}
              onChange={(event) =>
                updateZodiac(event.target.value as ZodiacSign)
              }
              aria-label="更换星座"
            >
              {ZODIAC_SIGNS.map((sign) => (
                <option value={sign.id} key={sign.id}>
                  {sign.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </CardFrame>
  );
}
