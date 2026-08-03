(function initBuilderDigest(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZeroTabBuilderDigest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBuilderDigest() {
  'use strict';

  const CACHE_KEY = 'builderDigestState';
  const OPTIONAL_ORIGIN = 'https://raw.githubusercontent.com/';
  const FEED_URLS = {
    x: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json',
    podcasts: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json',
    blogs: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json',
  };
  const MAX_RESPONSE_CHARS = 1_500_000;
  const CACHE_RETENTION_MS = 48 * 60 * 60 * 1000;
  const RETRY_COOLDOWN_MS = 15 * 60 * 1000;
  const KEYWORDS = /\b(launch|launched|release|released|ship|shipped|announce|model|agent|coding|code|api|open[\s-]?source|research|benchmark|security|product|tool|framework|developer|build|robot|autonom)/i;

  const DEFAULT_STATE = Object.freeze({
    enabled: false,
    collapsed: false,
    fetchedAt: null,
    lastAttemptAt: null,
    feedGeneratedAt: null,
    items: [],
    errors: [],
    dismissedIds: [],
    readIds: [],
    translations: {},
  });

  function normalizeText(value) {
    return String(value || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncate(value, maxLength) {
    const text = normalizeText(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function timestamp(value, fallback) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function recencyScore(publishedAt, nowMs) {
    const ageHours = Math.max(0, (nowMs - timestamp(publishedAt, nowMs)) / 3_600_000);
    return Math.max(0, 36 - ageHours) * 0.8;
  }

  function keywordScore(text) {
    return KEYWORDS.test(text || '') ? 16 : 0;
  }

  function engagementScore(tweet) {
    const likes = Math.max(0, Number(tweet.likes) || 0);
    const retweets = Math.max(0, Number(tweet.retweets) || 0);
    const replies = Math.max(0, Number(tweet.replies) || 0);
    return Math.log10(1 + likes + retweets * 2 + replies * 0.35) * 14;
  }

  function normalizeFeeds(feeds, now = new Date()) {
    const nowMs = now.getTime();
    const items = [];
    const xFeed = feeds?.x;
    const podcastFeed = feeds?.podcasts;
    const blogFeed = feeds?.blogs;

    for (const builder of Array.isArray(xFeed?.x) ? xFeed.x : []) {
      for (const tweet of Array.isArray(builder?.tweets) ? builder.tweets : []) {
        const url = safeHttpsUrl(tweet?.url);
        const id = normalizeText(tweet?.id);
        const excerpt = truncate(tweet?.text, 300);
        if (!id || !url || !excerpt) continue;

        const name = truncate(builder?.name || builder?.handle || 'AI Builder', 80);
        const handle = truncate(builder?.handle, 40);
        const publishedAt = new Date(timestamp(tweet?.createdAt, nowMs)).toISOString();
        items.push({
          id: `x:${id}`,
          kind: 'x',
          source: name,
          title: handle ? `${name} (@${handle})` : name,
          excerpt,
          url,
          publishedAt,
          score: 40 + engagementScore(tweet) + keywordScore(excerpt) + recencyScore(publishedAt, nowMs),
        });
      }
    }

    for (const article of Array.isArray(blogFeed?.blogs) ? blogFeed.blogs : []) {
      const url = safeHttpsUrl(article?.url);
      const title = truncate(article?.title, 180);
      if (!url || !title) continue;

      const fallbackTime = timestamp(blogFeed?.generatedAt, nowMs);
      const publishedAt = new Date(timestamp(article?.publishedAt, fallbackTime)).toISOString();
      const excerpt = truncate(article?.description || article?.content, 320);
      items.push({
        id: `blog:${url}`,
        kind: 'blog',
        source: truncate(article?.name || 'Official blog', 80),
        title,
        excerpt,
        url,
        publishedAt,
        score: 68 + keywordScore(`${title} ${excerpt}`) + recencyScore(publishedAt, nowMs),
      });
    }

    for (const episode of Array.isArray(podcastFeed?.podcasts) ? podcastFeed.podcasts : []) {
      const url = safeHttpsUrl(episode?.url);
      const title = truncate(episode?.title, 180);
      if (!url || !title) continue;

      const fallbackTime = timestamp(podcastFeed?.generatedAt, nowMs);
      const publishedAt = new Date(timestamp(episode?.publishedAt, fallbackTime)).toISOString();
      const excerpt = truncate(episode?.transcript, 340);
      const guid = normalizeText(episode?.guid) || url;
      items.push({
        id: `podcast:${guid}`,
        kind: 'podcast',
        source: truncate(episode?.name || 'AI podcast', 80),
        title,
        excerpt,
        url,
        publishedAt,
        score: 62 + keywordScore(`${title} ${excerpt}`) + recencyScore(publishedAt, nowMs),
      });
    }

    return items.sort((a, b) => b.score - a.score || b.publishedAt.localeCompare(a.publishedAt));
  }

  function mergeItems(previous, incoming, now = new Date(), limit = Infinity) {
    const cutoff = now.getTime() - CACHE_RETENTION_MS;
    const merged = new Map();

    for (const item of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
      if (!item?.id || !safeHttpsUrl(item.url)) continue;
      if (timestamp(item.publishedAt, now.getTime()) < cutoff) continue;
      merged.set(item.id, item);
    }

    const sorted = [...merged.values()]
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    return Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
  }

  function selectTopItems(items, limit = 6) {
    const sorted = [...(Array.isArray(items) ? items : [])]
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const selected = [];
    const selectedIds = new Set();

    for (const kind of ['x', 'blog', 'podcast']) {
      const item = sorted.find(candidate => candidate.kind === kind);
      if (item && !selectedIds.has(item.id)) {
        selected.push(item);
        selectedIds.add(item.id);
      }
    }

    for (const item of sorted) {
      if (selected.length >= limit) break;
      if (selectedIds.has(item.id)) continue;
      selected.push(item);
      selectedIds.add(item.id);
    }

    return selected
      .slice(0, limit)
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  }

  function selectTimelineItems(items, limit = Infinity) {
    const sorted = [...(Array.isArray(items) ? items : [])]
      .sort((a, b) => {
        const dateDifference = timestamp(b.publishedAt, 0) - timestamp(a.publishedAt, 0);
        return dateDifference || (Number(b.score) || 0) - (Number(a.score) || 0);
      });
    return Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
  }

  function isSameLocalDay(left, right) {
    if (!left || !right) return false;
    const a = new Date(left);
    const b = new Date(right);
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return false;
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function isStale(state, now = new Date()) {
    const generated = timestamp(state?.feedGeneratedAt || state?.fetchedAt, 0);
    return !generated || now.getTime() - generated > CACHE_RETENTION_MS;
  }

  function latestGeneratedAt(feeds) {
    const dates = Object.values(feeds || {})
      .map(feed => timestamp(feed?.generatedAt, 0))
      .filter(Boolean);
    return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  }

  async function fetchJson(url, options = {}) {
    const fetchImpl = options.fetchImpl || rootFetch();
    const timeoutMs = options.timeoutMs || 8_000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(url, {
        cache: 'no-store',
        signal: controller?.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS) throw new Error('Feed is larger than expected');
      return JSON.parse(text);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function rootFetch() {
    if (typeof fetch !== 'function') throw new Error('Fetch is unavailable');
    return fetch.bind(globalThis);
  }

  async function fetchFeeds(options = {}) {
    const entries = Object.entries(FEED_URLS);
    const settled = await Promise.allSettled(
      entries.map(([, url]) => fetchJson(url, options))
    );
    const feeds = {};
    const errors = [];

    settled.forEach((result, index) => {
      const key = entries[index][0];
      if (result.status === 'fulfilled') {
        feeds[key] = result.value;
      } else {
        errors.push(`${key}: ${result.reason?.message || 'fetch failed'}`);
      }
    });

    return { feeds, errors };
  }

  function storageApi() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      throw new Error('Chrome extension storage is unavailable');
    }
    return chrome.storage.local;
  }

  async function getState() {
    const result = await storageApi().get(CACHE_KEY);
    const stored = result[CACHE_KEY] || {};
    return {
      ...DEFAULT_STATE,
      ...stored,
      items: Array.isArray(stored.items) ? stored.items : [],
      errors: Array.isArray(stored.errors) ? stored.errors : [],
      dismissedIds: Array.isArray(stored.dismissedIds) ? stored.dismissedIds : [],
      readIds: Array.isArray(stored.readIds) ? stored.readIds : [],
      translations: stored.translations && typeof stored.translations === 'object'
        ? stored.translations
        : {},
    };
  }

  async function setState(patch) {
    const current = await getState();
    const next = { ...current, ...patch };
    await storageApi().set({ [CACHE_KEY]: next });
    return next;
  }

  async function hasPermission() {
    if (typeof chrome === 'undefined' || !chrome.permissions) return false;
    return chrome.permissions.contains({ origins: [OPTIONAL_ORIGIN] });
  }

  async function enable() {
    if (typeof chrome === 'undefined' || !chrome.permissions) {
      throw new Error('Chrome permissions API is unavailable');
    }
    const granted = await hasPermission()
      || await chrome.permissions.request({ origins: [OPTIONAL_ORIGIN] });
    if (!granted) return { granted: false, state: await getState() };
    const state = await setState({ enabled: true, errors: [] });
    return { granted: true, state };
  }

  async function setCollapsed(collapsed) {
    return setState({ collapsed: Boolean(collapsed) });
  }

  async function dismissItem(itemId) {
    const state = await getState();
    const dismissedIds = [...new Set([...state.dismissedIds, itemId])].slice(-200);
    return setState({
      dismissedIds,
      items: state.items.filter(item => item.id !== itemId),
    });
  }

  async function markRead(itemId) {
    const state = await getState();
    return setState({
      readIds: [...new Set([...state.readIds, itemId])],
    });
  }

  async function saveTranslations(language, translatedItems) {
    const state = await getState();
    return setState({
      translations: {
        ...state.translations,
        [language]: {
          ...(state.translations[language] || {}),
          ...translatedItems,
        },
      },
    });
  }

  async function refreshUnlocked(options = {}) {
    const now = options.now || new Date();
    const state = await getState();
    if (!state.enabled) return state;
    if (!(await hasPermission())) {
      return setState({
        enabled: false,
        errors: ['Read permission was removed. Enable the daily report again.'],
      });
    }

    const lastAttemptMs = timestamp(state.lastAttemptAt, 0);
    const inCooldown = now.getTime() - lastAttemptMs < RETRY_COOLDOWN_MS;
    if (!options.force && (isSameLocalDay(state.fetchedAt, now) || inCooldown)) {
      return state;
    }

    await setState({ lastAttemptAt: now.toISOString() });
    const { feeds, errors } = await fetchFeeds(options);
    if (Object.keys(feeds).length === 0) {
      return setState({
        lastAttemptAt: now.toISOString(),
        errors: errors.length ? errors : ['Could not fetch the public feed'],
      });
    }

    const incoming = normalizeFeeds(feeds, now);
    const dismissedIds = new Set(state.dismissedIds);
    const items = mergeItems(state.items, incoming, now)
      .filter(item => !dismissedIds.has(item.id));
    return setState({
      fetchedAt: now.toISOString(),
      lastAttemptAt: now.toISOString(),
      feedGeneratedAt: latestGeneratedAt(feeds) || state.feedGeneratedAt,
      items,
      errors,
    });
  }

  async function refresh(options = {}) {
    const locks = globalThis.navigator?.locks;
    if (locks?.request) {
      return locks.request('zero-tab-builder-digest-refresh', () => refreshUnlocked(options));
    }
    return refreshUnlocked(options);
  }

  return {
    CACHE_KEY,
    OPTIONAL_ORIGIN,
    FEED_URLS,
    DEFAULT_STATE,
    normalizeText,
    truncate,
    safeHttpsUrl,
    normalizeFeeds,
    mergeItems,
    selectTopItems,
    selectTimelineItems,
    isSameLocalDay,
    isStale,
    fetchFeeds,
    getState,
    setState,
    hasPermission,
    enable,
    setCollapsed,
    dismissItem,
    markRead,
    saveTranslations,
    refresh,
  };
});
