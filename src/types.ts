export type OpenTab = {
  id: number;
  url: string;
  title: string;
  windowId: number;
  active: boolean;
  pinned: boolean;
  isZeroTab: boolean;
};

export type DomainGroup = {
  key: string;
  domain: string;
  label?: string;
  tabs: OpenTab[];
};

export type SavedItem = {
  id: string;
  url: string;
  title: string;
  savedAt: string;
  completed: boolean;
  completedAt?: string;
  dismissed: boolean;
};

export type WorkstationLayout = {
  version: 1;
  cards: {
    openTabs: { collapsed: boolean };
    dailyHoroscope: { visible: boolean; collapsed: boolean };
    savedForLater: { visible: boolean; collapsed: boolean };
  };
};

export type ZodiacSign =
  | 'aries'
  | 'taurus'
  | 'gemini'
  | 'cancer'
  | 'leo'
  | 'virgo'
  | 'libra'
  | 'scorpio'
  | 'sagittarius'
  | 'capricorn'
  | 'aquarius'
  | 'pisces';

export type HoroscopePrefs = {
  zodiac: ZodiacSign | null;
};

export type HoroscopeResult = {
  dateKey: string;
  zodiac: ZodiacSign;
  overall: number;
  work: number;
  love: number;
  energy: number;
  luckyColor: { name: string; hex: string };
  luckyNumber: number;
  summary: string;
  advice: string;
};

export type LandingPagePattern = {
  hostname?: string;
  hostnameEndsWith?: string;
  pathExact?: string[];
  pathPrefix?: string;
};

export type CustomGroupRule = {
  hostname?: string;
  hostnameEndsWith?: string;
  pathPrefix?: string;
  groupKey: string;
  groupLabel?: string;
};

export type DigestItem = {
  id: string;
  kind: 'x' | 'blog' | 'podcast';
  source: string;
  title: string;
  excerpt: string;
  url: string;
  publishedAt: string;
  score: number;
};

export type DigestState = {
  enabled: boolean;
  collapsed: boolean;
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  feedGeneratedAt: string | null;
  items: DigestItem[];
  errors: string[];
  dismissedIds: string[];
  readIds: string[];
  translations: Record<
    string,
    Record<string, { title: string; excerpt: string }>
  >;
};

export type BuilderDigestApi = {
  safeHttpsUrl(value: unknown): string;
  selectTimelineItems(items: DigestItem[], limit?: number): DigestItem[];
  isStale(state: DigestState, now?: Date): boolean;
  getState(): Promise<DigestState>;
  enable(): Promise<{ granted: boolean; state: DigestState }>;
  refresh(options?: { force?: boolean }): Promise<DigestState>;
  markRead(itemId: string): Promise<DigestState>;
  saveTranslations(
    language: string,
    translated: Record<string, { title: string; excerpt: string }>,
  ): Promise<DigestState>;
};

declare global {
  var ZeroTabBuilderDigest: BuilderDigestApi | undefined;

  interface Window {
    LOCAL_LANDING_PAGE_PATTERNS?: LandingPagePattern[];
    LOCAL_CUSTOM_GROUPS?: CustomGroupRule[];
  }

  var Translator:
    | {
        create(options: {
          sourceLanguage: string;
          targetLanguage: string;
        }): Promise<{
          translate(text: string): Promise<string>;
          destroy?(): void;
        }>;
      }
    | undefined;
}
