import type {
  HoroscopePrefs,
  HoroscopeResult,
  ZodiacSign,
} from '../types';

const STORAGE_KEY = 'horoscopePrefs';

export const ZODIAC_SIGNS: ReadonlyArray<{
  id: ZodiacSign;
  name: string;
  symbol: string;
  dates: string;
}> = [
  { id: 'aries', name: '白羊座', symbol: '♈', dates: '3.21–4.19' },
  { id: 'taurus', name: '金牛座', symbol: '♉', dates: '4.20–5.20' },
  { id: 'gemini', name: '双子座', symbol: '♊', dates: '5.21–6.21' },
  { id: 'cancer', name: '巨蟹座', symbol: '♋', dates: '6.22–7.22' },
  { id: 'leo', name: '狮子座', symbol: '♌', dates: '7.23–8.22' },
  { id: 'virgo', name: '处女座', symbol: '♍', dates: '8.23–9.22' },
  { id: 'libra', name: '天秤座', symbol: '♎', dates: '9.23–10.23' },
  { id: 'scorpio', name: '天蝎座', symbol: '♏', dates: '10.24–11.22' },
  { id: 'sagittarius', name: '射手座', symbol: '♐', dates: '11.23–12.21' },
  { id: 'capricorn', name: '摩羯座', symbol: '♑', dates: '12.22–1.19' },
  { id: 'aquarius', name: '水瓶座', symbol: '♒', dates: '1.20–2.18' },
  { id: 'pisces', name: '双鱼座', symbol: '♓', dates: '2.19–3.20' },
];

const SUMMARIES = [
  '今天适合把注意力收回来，先完成最重要的一件事。',
  '一个不起眼的小进展，会让接下来的节奏变得顺畅。',
  '保持开放，但不必立刻回应所有声音。',
  '清晰的边界，会为你腾出更有创造力的空间。',
  '今天的好运来自耐心，以及对细节多看一眼。',
  '适合整理旧计划，也适合给新想法留一个位置。',
  '行动之前多停一秒，你会看到更简单的路径。',
  '熟悉的事情里藏着新线索，别急着跳过。',
  '与其追求完美，不如先交付一个可以继续迭代的版本。',
  '今天适合主动表达，让重要的人知道你的真实想法。',
  '把复杂问题拆小，答案会在行动中逐渐出现。',
  '留一点空白给意外，它可能比计划更有价值。',
];

const ADVICE = [
  '先处理最消耗注意力的那件小事。',
  '给自己安排一段不被打扰的时间。',
  '重要决定留到信息更完整时再做。',
  '今天适合少开一个会，多完成一件事。',
  '把一个模糊想法写成三行具体步骤。',
  '及时休息不是停下来，而是在校准方向。',
  '主动确认一次，避免让猜测替代沟通。',
  '完成比扩张更重要，先收好手上的线头。',
  '试着拒绝一件并不真正重要的事情。',
  '记录突然出现的灵感，晚些时候再判断。',
  '把今天的期待调低一点，把专注调高一点。',
  '先观察，再回应；先理解，再推进。',
];

const LUCKY_COLORS = [
  { name: '陶土橙', hex: '#D97757' },
  { name: '鼠尾草绿', hex: '#6B8A6F' },
  { name: '雾霾蓝', hex: '#8FA9C7' },
  { name: '暖沙色', hex: '#C8B79D' },
  { name: '梅子红', hex: '#9B5A5A' },
  { name: '深墨色', hex: '#1A1A1A' },
  { name: '燕麦色', hex: '#D8D5CF' },
  { name: '苔藓绿', hex: '#7C876B' },
];

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function mix(seed: number, salt: number): number {
  let value = (seed + Math.imul(salt, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

export function generateDailyHoroscope(
  zodiac: ZodiacSign,
  dateKey = localDateKey(),
): HoroscopeResult {
  const seed = hash(`${dateKey}:${zodiac}`);
  return {
    dateKey,
    zodiac,
    overall: 62 + (mix(seed, 1) % 35),
    work: 1 + (mix(seed, 2) % 5),
    love: 1 + (mix(seed, 3) % 5),
    energy: 1 + (mix(seed, 4) % 5),
    luckyColor: LUCKY_COLORS[mix(seed, 5) % LUCKY_COLORS.length]!,
    luckyNumber: 1 + (mix(seed, 6) % 9),
    summary: SUMMARIES[mix(seed, 7) % SUMMARIES.length]!,
    advice: ADVICE[mix(seed, 8) % ADVICE.length]!,
  };
}

export async function getHoroscopePrefs(): Promise<HoroscopePrefs> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<HoroscopePrefs> | undefined;
  const valid = ZODIAC_SIGNS.some((sign) => sign.id === stored?.zodiac);
  return { zodiac: valid ? (stored?.zodiac as ZodiacSign) : null };
}

export async function saveHoroscopePrefs(
  prefs: HoroscopePrefs,
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: prefs });
}
