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
  return decodeEntities(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function tagValue(block, tag) {
  const cdata = block.match(
    new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'),
  );
  if (cdata) return decodeEntities(cdata[1]);
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
      safeHttpsUrl(tagValue(block, 'link'), baseUrl) ||
      safeHttpsUrl(tagAttr(block, 'link', 'href'), baseUrl) ||
      safeHttpsUrl(tagValue(block, 'guid'), baseUrl) ||
      safeHttpsUrl(tagValue(block, 'id'), baseUrl);
    if (!title || !link) continue;

    const publishedAt =
      tagValue(block, 'pubDate') ||
      tagValue(block, 'published') ||
      tagValue(block, 'updated') ||
      tagValue(block, 'dc:date') ||
      null;
    const description =
      tagValue(block, 'description') ||
      tagValue(block, 'summary') ||
      tagValue(block, 'content:encoded') ||
      tagValue(block, 'content') ||
      '';
    const guid = tagValue(block, 'guid') || tagValue(block, 'id') || link;

    items.push({
      name: truncate(sourceName || 'Source', 80),
      title,
      url: link,
      guid,
      description: truncate(description, 500),
      content: truncate(description, 500),
      transcript: truncate(description, 500),
      publishedAt: publishedAt ? new Date(Date.parse(publishedAt) || Date.now()).toISOString() : undefined,
    });
    if (items.length >= limit) break;
  }

  return items;
}

export function parseBlogHtml(html, { sourceName, baseUrl, limit = 6 } = {}) {
  const text = String(html || '');
  const found = new Map();

  const patterns = [
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const href = match[1];
      const title = truncate(stripTags(match[2]), 180);
      const url = safeHttpsUrl(href, baseUrl);
      if (!url || !title || title.length < 12) continue;
      if (!/\/(blog|news|engineering|posts|articles|research|changelog)\b/i.test(url) &&
          !/blog|news|engineering|post|article/i.test(href)) {
        // Keep homepage-relative article-looking paths with dates or long slugs.
        if (!/\/\d{4}\/\d{2}\//.test(url) && !/\/[a-z0-9-]{16,}\/?$/i.test(url)) continue;
      }
      if (/#(respond|comments)|\/tag\/|\/category\/|\/author\//i.test(url)) continue;
      if (!found.has(url)) found.set(url, title);
      if (found.size >= limit * 3) break;
    }
  }

  return [...found.entries()].slice(0, limit).map(([url, title]) => ({
    name: truncate(sourceName || 'Official blog', 80),
    title,
    url,
    description: '',
    content: '',
  }));
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

  for (const match of permalinks) {
    const tweetHandle = match[1];
    const id = match[2];
    if (expectedHandle && tweetHandle.toLowerCase() !== expectedHandle) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const around = text.slice(Math.max(0, match.index - 800), match.index + 1200);
    const textMatch =
      around.match(/data-tweet-text=["']([^"']+)["']/i) ||
      around.match(/<p[^>]*class=["'][^"']*tweet-text[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
      around.match(/"full_text"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
      around.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
      around.match(/\n([^\n]{20,280})\n/);
    let body = '';
    if (textMatch) {
      body = textMatch[1]
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      body = stripTags(body);
    }
    if (!body) {
      // jina.ai markdown often has the tweet body on the previous lines.
      const before = text.slice(Math.max(0, match.index - 400), match.index);
      const line = before
        .split('\n')
        .map((part) => normalizeText(part))
        .filter((part) => part.length >= 24 && !/^https?:\/\//i.test(part) && !/^@/.test(part))
        .at(-1);
      body = line || '';
    }
    if (!body) continue;

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
          const body = normalizeText(tweet.full_text || tweet.text || '');
          const tweetHandle = tweet.user?.screen_name || handle;
          if (!id || !body || !tweetHandle) continue;
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

export async function collectPodcastFeed(sources, options = {}) {
  const podcasts = [];
  const errors = [];
  for (const source of sources || []) {
    try {
      if (!source.rssUrl) {
        errors.push(`podcast:${source.name || 'unknown'}: missing rssUrl`);
        continue;
      }
      const xml = await fetchText(source.rssUrl, options);
      const items = parseRssOrAtom(xml, {
        sourceName: source.name,
        baseUrl: source.rssUrl,
        limit: MAX_PODCAST_ITEMS_PER_SOURCE,
      });
      if (!items.length) {
        errors.push(`podcast:${source.name}: empty RSS`);
        continue;
      }
      for (const item of items) {
        podcasts.push({
          name: item.name,
          title: item.title,
          url: item.url,
          guid: item.guid,
          transcript: item.transcript,
          publishedAt: item.publishedAt,
        });
      }
    } catch (error) {
      errors.push(`podcast:${source.name || source.rssUrl}: ${error.message}`);
    }
  }
  return { podcasts, errors };
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

  const [xResult, blogResult, podcastResult] = await Promise.all([
    collectXFeed(sources.x, options),
    collectBlogFeed(sources.blogs, options),
    collectPodcastFeed(sources.podcasts, options),
  ]);

  const feedX = { generatedAt, x: xResult.builders };
  const feedBlogs = { generatedAt, blogs: blogResult.blogs };
  const feedPodcasts = { generatedAt, podcasts: podcastResult.podcasts };
  const errors = [...xResult.errors, ...blogResult.errors, ...podcastResult.errors];

  const hasData =
    feedX.x.some((builder) => builder.tweets?.length) ||
    feedBlogs.blogs.length > 0 ||
    feedPodcasts.podcasts.length > 0;

  mkdirSync(outDir, { recursive: true });
  atomicWriteJson(join(outDir, 'feed-x.json'), feedX);
  atomicWriteJson(join(outDir, 'feed-blogs.json'), feedBlogs);
  atomicWriteJson(join(outDir, 'feed-podcasts.json'), feedPodcasts);
  atomicWriteJson(join(outDir, 'generation-report.json'), {
    generatedAt,
    hasData,
    counts: {
      xBuilders: feedX.x.length,
      xTweets: feedX.x.reduce((sum, builder) => sum + (builder.tweets?.length || 0), 0),
      blogs: feedBlogs.blogs.length,
      podcasts: feedPodcasts.podcasts.length,
    },
    errors,
  });

  return { hasData, errors, feedX, feedBlogs, feedPodcasts };
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
    `Generated feeds: x=${result.feedX.x.length} blogs=${result.feedBlogs.blogs.length} podcasts=${result.feedPodcasts.podcasts.length}`,
  );
  if (result.errors.length) {
    console.warn(`Completed with ${result.errors.length} source warning(s).`);
    for (const error of result.errors) console.warn(`- ${error}`);
  }
}
