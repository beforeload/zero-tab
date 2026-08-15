import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_SOURCES = join(ROOT, 'builder-feeds', 'sources.json');
const DEFAULT_OUT_DIR = join(ROOT, 'builder-feeds', 'generated');
const USER_AGENT =
  'ZeroTabFeedBot/1.4 (+https://github.com/beforeload/zero-tab; public-feed-aggregator)';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TWEETS_PER_HANDLE = 8;
const MAX_BLOG_ITEMS_PER_SOURCE = 6;
const MAX_PODCAST_ITEMS_PER_SOURCE = 4;
const MAX_VIDEO_ITEMS_PER_SOURCE = 6;

export function normalizeText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(value) {
  return normalizeText(value)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

export function truncate(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function safeHttpsUrl(value, base) {
  if (!value || !String(value).trim()) return '';
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function stripTags(value) {
  const decoded = decodeEntities(String(value || ''));
  return normalizeText(
    decodeEntities(
      decoded
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

const SKIP_LINK_TITLE =
  /^(跳到|跳轉到|跳转到)?\s*(主要)?(内容|內容|页脚|頁腳|导航|導航|選單|菜单|footer|main content|content|navigation|menu)\s*$/i;

const NAV_TITLE =
  /^(home|about|careers|pricing|docs|documentation|support|login|sign in|sign up|subscribe|privacy|terms|cookie|contact|research|news|blog|engineering|products?|company|api|claude|how to get support|如何获得支持|如何獲得支持)$/i;

function isJunkTitle(title) {
  const text = normalizeText(title);
  if (!text || text.length < 8 || text.length > 200) return true;
  if (SKIP_LINK_TITLE.test(text)) return true;
  if (NAV_TITLE.test(text)) return true;
  if (/^(skip to|jump to)\b/i.test(text)) return true;
  // Concatenated card blobs usually contain multiple sentences/dates mashed together.
  if ((text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g) || []).length >= 2) {
    return true;
  }
  return false;
}

function canonicalizeArticleUrl(value, baseUrl) {
  const href = safeHttpsUrl(value, baseUrl);
  if (!href) return '';
  try {
    const url = new URL(href);
    if (url.hash && /^#(main|main-content|content|footer|nav|navigation|top)$/i.test(url.hash)) {
      return '';
    }
    // Drop pure in-page skip targets that share the index path.
    if (baseUrl) {
      const base = new URL(baseUrl);
      if (url.origin === base.origin && url.pathname.replace(/\/$/, '') === base.pathname.replace(/\/$/, '') && url.hash) {
        return '';
      }
    }
    url.hash = '';
    // Keep YouTube watch IDs; stripping all search params breaks video links.
    if (/^(www\.)?youtube\.com$/i.test(url.hostname) && url.pathname === '/watch') {
      const videoId = url.searchParams.get('v');
      url.search = '';
      if (videoId) url.searchParams.set('v', videoId);
    } else if (/^(www\.)?youtu\.be$/i.test(url.hostname)) {
      url.search = '';
    } else {
      url.search = '';
    }
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function looksLikeArticleUrl(url, baseUrl) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (/\/(tag|tags|category|categories|author|authors|page|pages|search|login|signup)(\/|$)/i.test(path)) {
      return false;
    }
    if (/\/(blog|news|engineering|posts|articles|research|changelog|index)\b/i.test(path)) {
      // Index pages themselves are not articles.
      if (/\/(blog|news|engineering|posts|articles|research|changelog|index)\/?$/i.test(path)) {
        return false;
      }
      return true;
    }
    if (/\/\d{4}\/\d{2}\//.test(path)) return true;
    if (/\/[a-z0-9-]{16,}\/?$/i.test(path)) return true;
    if (baseUrl) {
      const base = new URL(baseUrl);
      if (
        parsed.origin === base.origin &&
        path.startsWith(base.pathname.replace(/\/$/, '') + '/') &&
        path.replace(/\/$/, '') !== base.pathname.replace(/\/$/, '')
      ) {
        return path.split('/').filter(Boolean).pop()?.length >= 8;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function extractHeadingTitle(anchorHtml) {
  const heading =
    anchorHtml.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) ||
    anchorHtml.match(
      /<(?:span|div|p)[^>]*class=["'][^"']*(?:title|headline|card-title|post-title|featuredTitle)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/i,
    );
  if (heading) return cleanArticleTitle(stripTags(heading[1]));

  // Prefer meaningful image alts (Cursor cards put the headline in alt).
  const imageAlt = [...anchorHtml.matchAll(/<img\b[^>]*\balt=["']([^"']{8,160})["'][^>]*>/gi)]
    .map((match) => match[1].trim())
    .find(Boolean);
  if (imageAlt) return cleanArticleTitle(imageAlt);

  return cleanArticleTitle(stripTags(anchorHtml));
}

function stripAuthorReadTimeCrumbs(title) {
  let text = title;
  for (let i = 0; i < 4; i += 1) {
    const next = text
      .replace(/\s+\d+\s*min(?:ute)?s?\s+read$/i, '')
      // "Maxime Prades · 2m" / "Connor & Yuri · 6m" / "Chris, Rikki & Kevin · 7m"
      .replace(
        /\s+[A-Z][A-Za-z.]+(?:\s*(?:,|&|and)\s*|\s+)[A-Z][A-Za-z.]+(?:(?:\s*(?:,|&|and)\s*|\s+)[A-Z][A-Za-z.]+)*\s+·\s*\d+m$/u,
        '',
      )
      // "Connor & Yuri 6m" / "Chris, Rikki & Kevin 7m"
      .replace(
        /\s+[A-Z][A-Za-z.]+(?:\s*(?:,|&|and)\s*)[A-Z][A-Za-z.]+(?:(?:\s*(?:,|&|and)\s*)[A-Z][A-Za-z.]+)*\s+\d+m$/u,
        '',
      )
      // "Maxime Prades 2m" (exactly first + last before read-time)
      .replace(/\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s+\d+m$/u, '');
    if (next === text) break;
    text = next;
  }
  return text;
}

function cleanArticleTitle(title) {
  let text = normalizeText(decodeEntities(title));
  text = text.replace(
    /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s*[·•\-–|]?\s*(?:Research|Product|Company|company|product|Features|Announcements|News)?\s*/i,
    '',
  );
  text = text.replace(
    /^(?:Featured|Announcements|Features|Product|News|Research|Company)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s*/i,
    '',
  );
  text = text.replace(
    /^(?:Featured|Announcements|Features|Product|News|Research|Company)\s+/i,
    '',
  );
  text = stripAuthorReadTimeCrumbs(text);

  // If a short headline is followed by a description sentence, keep the headline.
  // Avoid bare "Cursor" here — titles like "… with Cursor for iOS" are valid.
  const split = text.match(
    /^(.{16,100}?)(?=\s+(?:We|The|How|This|A|An|Our|Built|I|Cursor is)\b)/,
  );
  if (split?.[1] && !/[.!?]$/.test(split[1])) {
    text = split[1];
  } else if (text.length > 110) {
    const sentence = text.match(/^.{16,110}?(?:[.!?…]|$)/)?.[0];
    if (sentence) text = sentence;
  }
  return truncate(text, 120);
}

function tagValue(block, tag) {
  const cdata = block.match(
    new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'),
  );
  if (cdata) return stripTags(cdata[1]);
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plain ? stripTags(plain[1]) : '';
}

function tagAttr(block, tag, attr) {
  const match = block.match(
    new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*/?>`, 'i'),
  );
  return match ? decodeEntities(match[1]) : '';
}

export function parseRssOrAtom(xml, { sourceName, baseUrl, limit = 6 } = {}) {
  const text = String(xml || '');
  const items = [];
  const itemBlocks = [...text.matchAll(/<item[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entryBlocks = [...text.matchAll(/<entry[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const blocks = itemBlocks.length ? itemBlocks : entryBlocks;

  for (const block of blocks) {
    const title = truncate(tagValue(block, 'title'), 180);
    const link =
      canonicalizeArticleUrl(tagValue(block, 'link'), baseUrl) ||
      canonicalizeArticleUrl(tagAttr(block, 'link', 'href'), baseUrl) ||
      canonicalizeArticleUrl(tagValue(block, 'guid'), baseUrl) ||
      canonicalizeArticleUrl(tagValue(block, 'id'), baseUrl);
    if (!title || !link || isJunkTitle(title)) continue;

    const publishedAt =
      tagValue(block, 'pubDate') ||
      tagValue(block, 'published') ||
      tagValue(block, 'updated') ||
      tagValue(block, 'dc:date') ||
      null;
    const description = truncate(
      tagValue(block, 'description') ||
        tagValue(block, 'summary') ||
        tagValue(block, 'media:description') ||
        tagValue(block, 'content:encoded') ||
        tagValue(block, 'content') ||
        '',
      500,
    );
    const guid = tagValue(block, 'guid') || tagValue(block, 'id') || link;

    items.push({
      name: truncate(sourceName || 'Source', 80),
      title,
      url: link,
      guid,
      description,
      content: description,
      transcript: description,
      publishedAt: publishedAt ? new Date(Date.parse(publishedAt) || Date.now()).toISOString() : undefined,
    });
    if (items.length >= limit) break;
  }

  return items;
}

export function parseBlogHtml(html, { sourceName, baseUrl, limit = 6 } = {}) {
  // Strip site chrome only. Do NOT strip <header> — many blog cards (e.g. Cursor)
  // wrap the title/media inside a card-level <header>.
  const text = String(html || '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  const found = new Map();

  // Document order; extractHeadingTitle already prefers h1–h4 / img[alt] inside the card.
  const candidates = text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);

  for (const match of candidates) {
    const href = match[1];
    const inner = match[2] || '';
    const title = extractHeadingTitle(inner);
    const url = canonicalizeArticleUrl(href, baseUrl);
    if (!url || !title || isJunkTitle(title)) continue;
    if (!looksLikeArticleUrl(url, baseUrl)) continue;
    if (!found.has(url)) found.set(url, title);
    if (found.size >= limit * 2) break;
  }

  return [...found.entries()].slice(0, limit).map(([url, title]) => ({
    name: truncate(sourceName || 'Official blog', 80),
    title,
    url,
    description: '',
    content: '',
  }));
}

export function cleanTweetText(value) {
  let text = String(value || '');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\*\s+/gm, '');
  text = text.replace(/\*\*|__/g, '');
  text = stripTags(text);
  return normalizeText(text);
}

export function isJunkTweetText(value) {
  const text = cleanTweetText(value);
  if (!text || text.length < 16 || text.length > 500) return true;
  if (/^(log in or sign up|sign up for x|create an account)\b/i.test(text)) return true;
  if (/^joined (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) return true;
  if (/\bfollowing\b/i.test(text) && /\bfollowers?\b/i.test(text)) return true;
  if (/pbs\.twimg\.com\/profile_images/i.test(text)) return true;
  if (/\buser avatar\b/i.test(text)) return true;
  if (/^image\s+\d+\b/i.test(text)) return true;
  if (/^(posts?|replies|highlights|media|likes|articles|subscriptions)\b/i.test(text)) return true;
  if (/^(san francisco|singapore|new york|london|seattle|remote)\b/i.test(text) && text.length < 48) {
    return true;
  }
  // Bare domain / vanity URL profile fields.
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(text)) return true;
  // Profile chrome leftovers that still contain the handle after cleaning.
  if (/^@?[A-Za-z0-9_]{2,40}$/.test(text)) return true;
  return false;
}

function extractTweetBodyNearMatch(text, matchIndex, permalink, previousIndex = 0) {
  const around = text.slice(Math.max(0, matchIndex - 900), matchIndex + 1400);
  const textMatch =
    around.match(/data-tweet-text=["']([^"']+)["']/i) ||
    around.match(/<p[^>]*class=["'][^"']*tweet-text[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
    around.match(/"full_text"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
    around.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/);

  if (textMatch) {
    const body = cleanTweetText(
      textMatch[1]
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        ),
    );
    if (body && !isJunkTweetText(body)) return body;
  }

  // jina.ai markdown: only inspect text between the previous permalink and this one.
  const before = text.slice(Math.max(previousIndex, matchIndex - 700), matchIndex);
  const candidates = before
    .split('\n')
    .map((part) => cleanTweetText(part))
    .filter((part) => part.length >= 16)
    .filter((part) => !/^https?:\/\//i.test(part))
    .filter((part) => !isJunkTweetText(part))
    .filter((part) => !part.includes(permalink));

  if (!candidates.length) return '';
  return candidates.sort((a, b) => b.length - a.length)[0];
}

export function parseXSyndicationHtml(html, { name, handle } = {}) {
  const text = String(html || '');
  const tweets = [];
  const seen = new Set();
  const expectedHandle = String(handle || '').replace(/^@/, '').toLowerCase();

  const permalinks = [
    ...text.matchAll(
      /https?:\/\/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)/gi,
    ),
  ];

  let previousIndex = 0;
  for (const match of permalinks) {
    const tweetHandle = match[1];
    const id = match[2];
    const nextIndex = match.index + match[0].length;
    if (expectedHandle && tweetHandle.toLowerCase() !== expectedHandle) {
      previousIndex = nextIndex;
      continue;
    }
    if (seen.has(id)) {
      previousIndex = nextIndex;
      continue;
    }
    seen.add(id);

    const around = text.slice(Math.max(0, match.index - 800), match.index + 1200);
    const body = extractTweetBodyNearMatch(text, match.index, match[0], previousIndex);
    previousIndex = nextIndex;
    if (!body || isJunkTweetText(body)) continue;

    const created =
      around.match(/datetime=["']([^"']+)["']/i)?.[1] ||
      around.match(/"created_at"\s*:\s*"([^"]+)"/)?.[1] ||
      null;

    tweets.push({
      id,
      text: truncate(body, 400),
      createdAt: created
        ? new Date(Date.parse(created) || Date.now()).toISOString()
        : new Date().toISOString(),
      url: `https://x.com/${tweetHandle}/status/${id}`,
      likes: Number(around.match(/"favorite_count"\s*:\s*(\d+)/)?.[1] || 0) || undefined,
      retweets: Number(around.match(/"retweet_count"\s*:\s*(\d+)/)?.[1] || 0) || undefined,
      replies: Number(around.match(/"reply_count"\s*:\s*(\d+)/)?.[1] || 0) || undefined,
    });
    if (tweets.length >= MAX_TWEETS_PER_HANDLE) break;
  }

  if (!tweets.length) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*"tweets"[\s\S]*\}/);
      if (jsonMatch) {
        const payload = JSON.parse(jsonMatch[0]);
        for (const tweet of Array.isArray(payload.tweets) ? payload.tweets : []) {
          const id = String(tweet.id_str || tweet.id || '');
          const body = cleanTweetText(tweet.full_text || tweet.text || '');
          const tweetHandle = tweet.user?.screen_name || handle;
          if (!id || !body || !tweetHandle || isJunkTweetText(body)) continue;
          tweets.push({
            id,
            text: truncate(body, 400),
            createdAt: new Date(Date.parse(tweet.created_at) || Date.now()).toISOString(),
            url: `https://x.com/${tweetHandle}/status/${id}`,
            likes: Number(tweet.favorite_count || 0) || undefined,
            retweets: Number(tweet.retweet_count || 0) || undefined,
            replies: Number(tweet.reply_count || 0) || undefined,
          });
          if (tweets.length >= MAX_TWEETS_PER_HANDLE) break;
        }
      }
    } catch {
      // Ignore malformed JSON blobs.
    }
  }

  return {
    name: truncate(name || handle || 'AI Builder', 80),
    handle: truncate(String(handle || '').replace(/^@/, ''), 40),
    tweets,
  };
}

export async function fetchText(url, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function collectXFeed(sources, options = {}) {
  const builders = [];
  const errors = [];
  for (const source of sources || []) {
    const handle = String(source.handle || '').replace(/^@/, '').trim();
    if (!handle) continue;
    const urls = [
      `https://cdn.syndication.twimg.com/timeline/profile?screen_name=${encodeURIComponent(handle)}`,
      `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}`,
      `https://r.jina.ai/https://x.com/${encodeURIComponent(handle)}`,
    ];
    let parsed = null;
    let lastError = null;
    for (const url of urls) {
      try {
        const html = await fetchText(url, {
          ...options,
          timeoutMs: options.timeoutMs || 45_000,
        });
        parsed = parseXSyndicationHtml(html, { name: source.name, handle });
        if (parsed.tweets.length) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (parsed?.tweets?.length) builders.push(parsed);
    else errors.push(`x:@${handle}: ${lastError?.message || 'no public tweets parsed'}`);
  }
  return { builders, errors };
}

export async function collectBlogFeed(sources, options = {}) {
  const blogs = [];
  const errors = [];
  for (const source of sources || []) {
    try {
      if (source.rssUrl) {
        const xml = await fetchText(source.rssUrl, options);
        const items = parseRssOrAtom(xml, {
          sourceName: source.name,
          baseUrl: source.rssUrl,
          limit: MAX_BLOG_ITEMS_PER_SOURCE,
        });
        for (const item of items) {
          blogs.push({
            name: item.name,
            title: item.title,
            url: item.url,
            description: item.description,
            content: item.content,
            publishedAt: item.publishedAt,
          });
        }
        if (items.length) continue;
      }

      if (!source.url) {
        errors.push(`blog:${source.name || 'unknown'}: missing url/rssUrl`);
        continue;
      }
      const html = await fetchText(source.url, options);
      const items = parseBlogHtml(html, {
        sourceName: source.name,
        baseUrl: source.url,
        limit: MAX_BLOG_ITEMS_PER_SOURCE,
      });
      if (!items.length) {
        errors.push(`blog:${source.name}: no articles parsed from HTML`);
        continue;
      }
      blogs.push(...items);
    } catch (error) {
      errors.push(`blog:${source.name || source.url}: ${error.message}`);
    }
  }
  return { blogs, errors };
}

async function collectRssListFeed(sources, { kind, limit, options = {} } = {}) {
  const items = [];
  const errors = [];
  for (const source of sources || []) {
    try {
      if (!source.rssUrl) {
        errors.push(`${kind}:${source.name || 'unknown'}: missing rssUrl`);
        continue;
      }
      const xml = await fetchText(source.rssUrl, options);
      const parsed = parseRssOrAtom(xml, {
        sourceName: source.name,
        baseUrl: source.rssUrl,
        limit,
      });
      if (!parsed.length) {
        errors.push(`${kind}:${source.name}: empty RSS`);
        continue;
      }
      for (const item of parsed) {
        items.push({
          name: item.name,
          title: item.title,
          url: item.url,
          guid: item.guid,
          transcript: item.transcript,
          publishedAt: item.publishedAt,
        });
      }
    } catch (error) {
      errors.push(`${kind}:${source.name || source.rssUrl}: ${error.message}`);
    }
  }
  return { items, errors };
}

export async function collectPodcastFeed(sources, options = {}) {
  const result = await collectRssListFeed(sources, {
    kind: 'podcast',
    limit: MAX_PODCAST_ITEMS_PER_SOURCE,
    options,
  });
  return { podcasts: result.items, errors: result.errors };
}

export async function collectVideoFeed(sources, options = {}) {
  const result = await collectRssListFeed(sources, {
    kind: 'video',
    limit: MAX_VIDEO_ITEMS_PER_SOURCE,
    options,
  });
  return { videos: result.items, errors: result.errors };
}

export function atomicWriteJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}

export async function generateBuilderFeeds({
  sourcesPath = DEFAULT_SOURCES,
  outDir = DEFAULT_OUT_DIR,
  now = new Date(),
  fetchImpl,
} = {}) {
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  const generatedAt = now.toISOString();
  const options = { fetchImpl };

  const [xResult, blogResult, podcastResult, videoResult] = await Promise.all([
    collectXFeed(sources.x, options),
    collectBlogFeed(sources.blogs, options),
    collectPodcastFeed(sources.podcasts, options),
    collectVideoFeed(sources.videos, options),
  ]);

  const feedX = { generatedAt, x: xResult.builders };
  const feedBlogs = { generatedAt, blogs: blogResult.blogs };
  const feedPodcasts = { generatedAt, podcasts: podcastResult.podcasts };
  const feedVideos = { generatedAt, videos: videoResult.videos };
  const errors = [
    ...xResult.errors,
    ...blogResult.errors,
    ...podcastResult.errors,
    ...videoResult.errors,
  ];

  const hasData =
    feedX.x.some((builder) => builder.tweets?.length) ||
    feedBlogs.blogs.length > 0 ||
    feedPodcasts.podcasts.length > 0 ||
    feedVideos.videos.length > 0;

  mkdirSync(outDir, { recursive: true });
  atomicWriteJson(join(outDir, 'feed-x.json'), feedX);
  atomicWriteJson(join(outDir, 'feed-blogs.json'), feedBlogs);
  atomicWriteJson(join(outDir, 'feed-podcasts.json'), feedPodcasts);
  atomicWriteJson(join(outDir, 'feed-videos.json'), feedVideos);
  atomicWriteJson(join(outDir, 'generation-report.json'), {
    generatedAt,
    hasData,
    counts: {
      xBuilders: feedX.x.length,
      xTweets: feedX.x.reduce((sum, builder) => sum + (builder.tweets?.length || 0), 0),
      blogs: feedBlogs.blogs.length,
      podcasts: feedPodcasts.podcasts.length,
      videos: feedVideos.videos.length,
    },
    errors,
  });

  return { hasData, errors, feedX, feedBlogs, feedPodcasts, feedVideos };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const result = await generateBuilderFeeds();
  if (!result.hasData) {
    console.error('Feed generation produced no items.');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `Generated feeds: x=${result.feedX.x.length} blogs=${result.feedBlogs.blogs.length} podcasts=${result.feedPodcasts.podcasts.length} videos=${result.feedVideos.videos.length}`,
  );
  if (result.errors.length) {
    console.warn(`Completed with ${result.errors.length} source warning(s).`);
    for (const error of result.errors) console.warn(`- ${error}`);
  }
}
