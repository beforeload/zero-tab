import type { CustomGroupRule, LandingPagePattern } from '../types';
import type { DomainGroup, OpenTab } from '../types';

const BROWSER_NEWTAB_URLS = new Set([
  'chrome://newtab/',
  'edge://newtab/',
  'brave://newtab/',
  'about:newtab',
]);

const FRIENDLY_DOMAINS: Record<string, string> = {
  'github.com': 'GitHub',
  'www.github.com': 'GitHub',
  'youtube.com': 'YouTube',
  'www.youtube.com': 'YouTube',
  'music.youtube.com': 'YouTube Music',
  'x.com': 'X',
  'www.x.com': 'X',
  'twitter.com': 'X',
  'www.twitter.com': 'X',
  'reddit.com': 'Reddit',
  'www.reddit.com': 'Reddit',
  'old.reddit.com': 'Reddit',
  'substack.com': 'Substack',
  'www.substack.com': 'Substack',
  'medium.com': 'Medium',
  'www.medium.com': 'Medium',
  'linkedin.com': 'LinkedIn',
  'www.linkedin.com': 'LinkedIn',
  'stackoverflow.com': 'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com': 'Google',
  'www.google.com': 'Google',
  'mail.google.com': 'Gmail',
  'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive',
  'calendar.google.com': 'Google Calendar',
  'gemini.google.com': 'Gemini',
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'app.slack.com': 'Slack',
  'discord.com': 'Discord',
  'wikipedia.org': 'Wikipedia',
  'en.wikipedia.org': 'Wikipedia',
  'open.spotify.com': 'Spotify',
  'vercel.com': 'Vercel',
  'developer.mozilla.org': 'MDN',
  'huggingface.co': 'Hugging Face',
  'local-files': 'Local Files',
};

const DEFAULT_LANDING_PATTERNS: LandingPagePattern[] = [
  { hostname: 'x.com', pathExact: ['/home'] },
  { hostname: 'www.linkedin.com', pathExact: ['/'] },
  { hostname: 'github.com', pathExact: ['/'] },
  { hostname: 'www.youtube.com', pathExact: ['/'] },
];

function localConfig() {
  const root = globalThis as typeof globalThis & {
    LOCAL_LANDING_PAGE_PATTERNS?: LandingPagePattern[];
    LOCAL_CUSTOM_GROUPS?: CustomGroupRule[];
  };
  return {
    landingPatterns: Array.isArray(root.LOCAL_LANDING_PAGE_PATTERNS)
      ? root.LOCAL_LANDING_PAGE_PATTERNS
      : [],
    customGroups: Array.isArray(root.LOCAL_CUSTOM_GROUPS)
      ? root.LOCAL_CUSTOM_GROUPS
      : [],
  };
}

export async function fetchOpenTabs(): Promise<OpenTab[]> {
  const extensionUrl = chrome.runtime.getURL('index.html');
  const tabs = await chrome.tabs.query({});
  return tabs.flatMap((tab) => {
    if (
      !Number.isInteger(tab.id) ||
      !Number.isInteger(tab.windowId) ||
      typeof tab.url !== 'string'
    ) {
      return [];
    }
    return [{
      id: tab.id as number,
      url: tab.url,
      title: tab.title || tab.url,
      windowId: tab.windowId as number,
      active: Boolean(tab.active),
      pinned: Boolean(tab.pinned),
      isZeroTab: tab.url === extensionUrl || BROWSER_NEWTAB_URLS.has(tab.url),
    }];
  });
}

export function getRealTabs(tabs: OpenTab[]): OpenTab[] {
  return tabs.filter((tab) => {
    const url = tab.url || '';
    return ![
      'chrome://',
      'chrome-extension://',
      'about:',
      'edge://',
      'brave://',
    ].some((prefix) => url.startsWith(prefix));
  });
}

function matchesPattern(url: URL, pattern: LandingPagePattern): boolean {
  const hostnameMatches = pattern.hostname
    ? url.hostname === pattern.hostname
    : pattern.hostnameEndsWith
      ? url.hostname.endsWith(pattern.hostnameEndsWith)
      : false;
  if (!hostnameMatches) return false;
  if (pattern.pathPrefix) return url.pathname.startsWith(pattern.pathPrefix);
  if (pattern.pathExact) return pattern.pathExact.includes(url.pathname);
  return url.pathname === '/';
}

function isLandingPage(value: string, patterns: LandingPagePattern[]): boolean {
  try {
    const url = new URL(value);
    if (url.hostname === 'mail.google.com') {
      return !['#inbox/', '#sent/', '#search/'].some((part) =>
        value.includes(part),
      );
    }
    return patterns.some((pattern) => matchesPattern(url, pattern));
  } catch {
    return false;
  }
}

function matchCustomGroup(
  value: string,
  rules: CustomGroupRule[],
): CustomGroupRule | undefined {
  try {
    const url = new URL(value);
    return rules.find((rule) => {
      const hostnameMatches = rule.hostname
        ? url.hostname === rule.hostname
        : rule.hostnameEndsWith
          ? url.hostname.endsWith(rule.hostnameEndsWith)
          : false;
      return hostnameMatches &&
        (!rule.pathPrefix || url.pathname.startsWith(rule.pathPrefix));
    });
  } catch {
    return undefined;
  }
}

export function groupTabs(tabs: OpenTab[]): DomainGroup[] {
  const { landingPatterns, customGroups } = localConfig();
  const patterns = [...DEFAULT_LANDING_PATTERNS, ...landingPatterns];
  const groups = new Map<string, DomainGroup>();
  const landingTabs: OpenTab[] = [];

  for (const tab of tabs) {
    if (isLandingPage(tab.url, patterns)) {
      landingTabs.push(tab);
      continue;
    }

    const custom = matchCustomGroup(tab.url, customGroups);
    if (custom) {
      const existing = groups.get(custom.groupKey);
      if (existing) existing.tabs.push(tab);
      else {
        groups.set(custom.groupKey, {
          key: `custom:${custom.groupKey}`,
          domain: custom.groupKey,
          label: custom.groupLabel,
          tabs: [tab],
        });
      }
      continue;
    }

    try {
      const domain = tab.url.startsWith('file://')
        ? 'local-files'
        : new URL(tab.url).hostname;
      if (!domain) continue;
      const existing = groups.get(domain);
      if (existing) existing.tabs.push(tab);
      else groups.set(domain, { key: `domain:${domain}`, domain, tabs: [tab] });
    } catch {
      // Ignore malformed URLs.
    }
  }

  if (landingTabs.length) {
    groups.set('__landing-pages__', {
      key: 'special:landing-pages',
      domain: '__landing-pages__',
      label: 'Homepages',
      tabs: landingTabs,
    });
  }

  const priorityHosts = new Set(patterns.map((item) => item.hostname).filter(Boolean));
  const prioritySuffixes = patterns
    .map((item) => item.hostnameEndsWith)
    .filter((item): item is string => Boolean(item));

  return [...groups.values()].sort((left, right) => {
    const leftLanding = left.domain === '__landing-pages__';
    const rightLanding = right.domain === '__landing-pages__';
    if (leftLanding !== rightLanding) return leftLanding ? -1 : 1;
    const leftPriority =
      priorityHosts.has(left.domain) ||
      prioritySuffixes.some((suffix) => left.domain.endsWith(suffix));
    const rightPriority =
      priorityHosts.has(right.domain) ||
      prioritySuffixes.some((suffix) => right.domain.endsWith(suffix));
    if (leftPriority !== rightPriority) return leftPriority ? -1 : 1;
    return right.tabs.length - left.tabs.length;
  });
}

export function getRemovableDuplicates(tabs: OpenTab[]) {
  const byUrl = new Map<string, OpenTab[]>();
  for (const tab of tabs) {
    const matching = byUrl.get(tab.url) || [];
    matching.push(tab);
    byUrl.set(tab.url, matching);
  }

  const urls: string[] = [];
  let count = 0;
  for (const [url, matching] of byUrl) {
    if (matching.length <= 1) continue;
    const unpinnedCount = matching.filter((tab) => !tab.pinned).length;
    const removable = matching.some((tab) => tab.pinned)
      ? unpinnedCount
      : Math.max(0, unpinnedCount - 1);
    if (removable > 0) {
      urls.push(url);
      count += removable;
    }
  }
  return { urls, count };
}

export async function closeTabsByIds(tabIds: number[]): Promise<number> {
  const requested = new Set(tabIds.filter(Number.isInteger));
  if (!requested.size) return 0;
  const current = await chrome.tabs.query({});
  const toClose = current.flatMap((tab) =>
    Number.isInteger(tab.id) && requested.has(tab.id as number) && !tab.pinned
      ? [tab.id as number]
      : [],
  );
  if (toClose.length) await chrome.tabs.remove(toClose);
  return toClose.length;
}

export async function focusTab(tabId: number): Promise<void> {
  const current = await chrome.tabs.query({});
  const tab = current.find((candidate) => candidate.id === tabId);
  if (!tab || !Number.isInteger(tab.windowId)) return;
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

export async function closeDuplicateTabs(urls: string[]): Promise<number> {
  const current = await chrome.tabs.query({});
  const toClose: number[] = [];
  for (const url of urls) {
    const matching = current.filter((tab) => tab.url === url);
    const keep =
      matching.find((tab) => tab.pinned) ||
      matching.find((tab) => tab.active) ||
      matching[0];
    for (const tab of matching) {
      if (tab.id !== keep?.id && Number.isInteger(tab.id) && !tab.pinned) {
        toClose.push(tab.id as number);
      }
    }
  }
  if (toClose.length) await chrome.tabs.remove(toClose);
  return toClose.length;
}

export async function closeZeroTabDupes(): Promise<number> {
  const current = await chrome.tabs.query({});
  const window = await chrome.windows.getCurrent();
  const extensionUrl = chrome.runtime.getURL('index.html');
  const matches = current.filter(
    (tab) =>
      tab.url === extensionUrl ||
      (typeof tab.url === 'string' && BROWSER_NEWTAB_URLS.has(tab.url)),
  );
  const keep =
    matches.find((tab) => tab.active && tab.windowId === window.id) ||
    matches.find((tab) => tab.active) ||
    matches[0];
  const ids = matches.flatMap((tab) =>
    tab.id !== keep?.id && Number.isInteger(tab.id) && !tab.pinned
      ? [tab.id as number]
      : [],
  );
  if (ids.length) await chrome.tabs.remove(ids);
  return ids.length;
}

export function friendlyDomain(hostname: string): string {
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];
  if (hostname.endsWith('.substack.com')) {
    return `${capitalize(hostname.replace('.substack.com', ''))}'s Substack`;
  }
  if (hostname.endsWith('.github.io')) {
    return `${capitalize(hostname.replace('.github.io', ''))} (GitHub Pages)`;
  }
  return hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk)$/, '')
    .split('.')
    .map(capitalize)
    .join(' ');
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : '';
}

export function smartTitle(tab: OpenTab, domain = ''): string {
  let title = (tab.title || tab.url)
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s*\([\d,]+\+?\)\s*/g, ' ')
    .replace(/\s+on X:\s*/, ': ')
    .replace(/\s*\/\s*X\s*$/, '')
    .trim();
  try {
    const url = new URL(tab.url);
    const isUrl = !title || title === tab.url || title.startsWith(url.hostname);
    if (url.hostname === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && isUrl) title = `${parts[0]}/${parts[1]}`;
    }
    if (url.hostname === 'localhost' && url.port) title = `${url.port} ${title}`;
    const friendly = friendlyDomain(domain);
    for (const separator of [' - ', ' | ', ' — ', ' · ', ' – ']) {
      const index = title.lastIndexOf(separator);
      if (index < 0) continue;
      const suffix = title.slice(index + separator.length).toLowerCase();
      if (
        suffix === domain.toLowerCase() ||
        suffix === friendly.toLowerCase()
      ) {
        const cleaned = title.slice(0, index).trim();
        if (cleaned.length >= 5) title = cleaned;
      }
    }
  } catch {
    // Keep the original title.
  }
  return title || tab.url;
}

export function faviconUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return '';
    const favicon = new URL(chrome.runtime.getURL('/_favicon/'));
    favicon.searchParams.set('pageUrl', url.href);
    favicon.searchParams.set('size', '16');
    return favicon.href;
  } catch {
    return '';
  }
}
