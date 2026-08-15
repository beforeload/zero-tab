const test = require('node:test');
const assert = require('node:assert/strict');

const digest = require('../extension/builder-digest.js');

const NOW = new Date('2026-07-25T08:00:00.000Z');

test('normalizes and ranks all supported feed types', () => {
  const items = digest.normalizeFeeds({
    x: {
      generatedAt: NOW.toISOString(),
      x: [{
        name: 'Builder',
        handle: 'builder',
        tweets: [{
          id: '1',
          text: 'We launched a new open-source agent framework today.',
          createdAt: '2026-07-25T07:00:00.000Z',
          url: 'https://x.com/builder/status/1',
          likes: 200,
          retweets: 30,
          replies: 12,
        }],
      }],
    },
    blogs: {
      generatedAt: NOW.toISOString(),
      blogs: [{
        name: 'Engineering Blog',
        title: 'Containing autonomous agents',
        url: 'https://example.com/agent-security',
        content: 'A practical engineering guide to safer autonomous systems.',
      }],
    },
    podcasts: {
      generatedAt: NOW.toISOString(),
      podcasts: [{
        name: 'Builders Podcast',
        title: 'How products get shipped',
        guid: 'episode-1',
        url: 'https://youtube.com/watch?v=episode1',
        transcript: 'Today we discuss product iteration and shipping reliable AI tools.',
      }],
    },
    videos: {
      generatedAt: NOW.toISOString(),
      videos: [{
        name: 'Cursor Compile',
        title: 'Opening Keynote, Michael Truell | Compile 26',
        guid: 'yt:video:compile1',
        url: 'https://www.youtube.com/watch?v=compile1',
        transcript: 'Cursor Compile conference keynote about shipping agent coding tools.',
        publishedAt: '2026-06-20T17:00:00.000Z',
      }],
    },
  }, NOW);

  assert.equal(items.length, 4);
  assert.deepEqual(new Set(items.map(item => item.kind)), new Set(['x', 'blog', 'podcast', 'video']));
  const xItem = items.find(item => item.kind === 'x');
  assert.equal(xItem.title, 'We launched a new open-source agent framework today.');
  assert.equal(xItem.source, 'Builder (@builder)');
  assert.equal(xItem.excerpt, '');
  assert.ok(items.every(item => item.url.startsWith('https://')));
  assert.ok(items.every(item => Number.isFinite(item.score)));
});

test('drops junk X markdown profile chrome from feed normalization', () => {
  const items = digest.normalizeFeeds({
    x: {
      generatedAt: NOW.toISOString(),
      x: [{
        name: 'Swyx',
        handle: 'swyx',
        tweets: [
          {
            id: 'good',
            text: 'Shipping agents that actually stay useful for a week',
            createdAt: '2026-07-25T07:00:00.000Z',
            url: 'https://x.com/swyx/status/good',
          },
          {
            id: 'bad-avatar',
            text: '* [![Image 8: user avatar](https://pbs.twimg.com/profile_images/x.jpg)](https://x.com/swyx)',
            createdAt: '2026-07-25T07:00:00.000Z',
            url: 'https://x.com/swyx/status/bad-avatar',
          },
          {
            id: 'bad-login',
            text: '## Log in or sign up for X',
            createdAt: '2026-07-25T07:00:00.000Z',
            url: 'https://x.com/swyx/status/bad-login',
          },
        ],
      }],
    },
  }, NOW);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'x:good');
  assert.equal(items[0].title, 'Shipping agents that actually stay useful for a week');
});

test('rejects unsafe links and control characters', () => {
  assert.equal(digest.safeHttpsUrl('javascript:alert(1)'), '');
  assert.equal(digest.safeHttpsUrl('http://example.com'), '');
  assert.equal(digest.safeHttpsUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(digest.normalizeText('hello\u0000   world'), 'hello world');
});

test('keeps a balanced top selection when sources exist', () => {
  const items = [
    { id: 'x:1', kind: 'x', score: 100 },
    { id: 'x:2', kind: 'x', score: 90 },
    { id: 'blog:1', kind: 'blog', score: 50 },
    { id: 'podcast:1', kind: 'podcast', score: 40 },
    { id: 'video:1', kind: 'video', score: 35 },
  ];

  const selected = digest.selectTopItems(items, 4);
  assert.deepEqual(new Set(selected.map(item => item.kind)), new Set(['x', 'blog', 'podcast', 'video']));
});

test('orders report items by published time descending', () => {
  const items = [
    { id: 'older', publishedAt: '2026-07-24T08:00:00.000Z', score: 100 },
    { id: 'newest', publishedAt: '2026-07-25T08:00:00.000Z', score: 1 },
    { id: 'middle', publishedAt: '2026-07-25T02:00:00.000Z', score: 50 },
  ];

  assert.deepEqual(
    digest.selectTimelineItems(items).map(item => item.id),
    ['newest', 'middle', 'older'],
  );
});

test('merges duplicate items and drops entries older than 48 hours', () => {
  const recent = {
    id: 'x:recent',
    kind: 'x',
    url: 'https://x.com/example/status/recent',
    publishedAt: '2026-07-25T07:00:00.000Z',
    score: 10,
  };
  const updated = { ...recent, score: 30 };
  const old = {
    id: 'x:old',
    kind: 'x',
    url: 'https://x.com/example/status/old',
    publishedAt: '2026-07-20T07:00:00.000Z',
    score: 100,
  };

  const merged = digest.mergeItems([recent, old], [updated], NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].score, 30);
});

test('keeps conference videos for 90 days while dropping older tweets', () => {
  const recentTweet = {
    id: 'x:recent',
    kind: 'x',
    url: 'https://x.com/example/status/recent',
    publishedAt: '2026-07-25T07:00:00.000Z',
    score: 10,
  };
  const oldTweet = {
    id: 'x:old',
    kind: 'x',
    url: 'https://x.com/example/status/old',
    publishedAt: '2026-07-20T07:00:00.000Z',
    score: 100,
  };
  const conferenceVideo = {
    id: 'video:compile',
    kind: 'video',
    url: 'https://www.youtube.com/watch?v=compile1',
    publishedAt: '2026-06-20T17:00:00.000Z',
    score: 64,
  };

  const merged = digest.mergeItems([recentTweet, oldTweet, conferenceVideo], [], NOW);
  assert.deepEqual(
    merged.map((item) => item.id).sort(),
    ['video:compile', 'x:recent'],
  );
});

test('detects local-day cache hits and stale feeds', () => {
  // Use explicit UTC instants so the local-day check is stable across CI timezones.
  assert.equal(
    digest.isSameLocalDay('2026-07-25T01:00:00.000Z', new Date('2026-07-25T20:00:00.000Z')),
    true,
  );
  assert.equal(
    digest.isSameLocalDay('2026-07-24T23:00:00.000Z', new Date('2026-07-25T01:00:00.000Z')),
    false,
  );
  assert.equal(
    digest.isStale({ feedGeneratedAt: '2026-07-22T00:00:00.000Z' }, NOW),
    true,
  );
  assert.equal(
    digest.isStale({ feedGeneratedAt: '2026-07-25T07:00:00.000Z' }, NOW),
    false,
  );
});

test('returns partial feed results when one source fails', async () => {
  const fetchImpl = async url => {
    if (url.includes('feed-podcasts')) throw new Error('offline');
    const payload = url.includes('feed-x')
      ? { generatedAt: NOW.toISOString(), x: [] }
      : { generatedAt: NOW.toISOString(), blogs: [] };
    return {
      ok: true,
      text: async () => JSON.stringify(payload),
    };
  };

  const result = await digest.fetchFeeds({ fetchImpl, timeoutMs: 100 });
  assert.deepEqual(Object.keys(result.feeds).sort(), ['blogs', 'videos', 'x']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /podcasts/);
});

test('points AI Builder feeds at this repository feeds branch', () => {
  assert.equal(digest.OPTIONAL_ORIGIN, 'https://raw.githubusercontent.com/');
  assert.equal(
    digest.FEED_URLS.x,
    'https://raw.githubusercontent.com/beforeload/zero-tab/feeds/feed-x.json',
  );
  assert.equal(
    digest.FEED_URLS.blogs,
    'https://raw.githubusercontent.com/beforeload/zero-tab/feeds/feed-blogs.json',
  );
  assert.equal(
    digest.FEED_URLS.podcasts,
    'https://raw.githubusercontent.com/beforeload/zero-tab/feeds/feed-podcasts.json',
  );
  assert.equal(
    digest.FEED_URLS.videos,
    'https://raw.githubusercontent.com/beforeload/zero-tab/feeds/feed-videos.json',
  );
});

test('requests the declared raw GitHub origin without a wildcard path', async () => {
  const storage = {};
  let requestedOrigins;
  global.chrome = {
    storage: {
      local: {
        get: async key => ({ [key]: storage[key] }),
        set: async values => Object.assign(storage, values),
      },
    },
    permissions: {
      contains: async () => false,
      request: async request => {
        requestedOrigins = request.origins;
        return true;
      },
    },
  };

  try {
    const result = await digest.enable();
    assert.equal(result.granted, true);
    assert.deepEqual(requestedOrigins, ['https://raw.githubusercontent.com/']);
  } finally {
    delete global.chrome;
  }
});

test('enables optional permission, caches a refresh, and skips a second same-day fetch', async () => {
  const storage = {};
  global.chrome = {
    storage: {
      local: {
        get: async key => ({ [key]: storage[key] }),
        set: async values => Object.assign(storage, values),
      },
    },
    permissions: {
      request: async () => true,
      contains: async () => true,
    },
  };

  let fetchCount = 0;
  const fetchImpl = async url => {
    fetchCount += 1;
    const payload = url.includes('feed-x')
      ? {
          generatedAt: NOW.toISOString(),
          x: [{
            name: 'Builder',
            handle: 'builder',
            tweets: [{
              id: 'cached',
              text: 'Shipped a new developer tool.',
              createdAt: NOW.toISOString(),
              url: 'https://x.com/builder/status/cached',
              likes: 10,
            }],
          }],
        }
      : url.includes('feed-podcasts')
        ? { generatedAt: NOW.toISOString(), podcasts: [] }
        : url.includes('feed-videos')
          ? { generatedAt: NOW.toISOString(), videos: [] }
        : { generatedAt: NOW.toISOString(), blogs: [] };
    return { ok: true, text: async () => JSON.stringify(payload) };
  };

  try {
    const enabled = await digest.enable();
    assert.equal(enabled.granted, true);

    const first = await digest.refresh({ force: true, now: NOW, fetchImpl });
    assert.equal(first.items.length, 1);
    assert.equal(fetchCount, 4);

    await digest.refresh({
      now: new Date('2026-07-25T12:00:00.000Z'),
      fetchImpl: async () => {
        throw new Error('same-day refresh should use cache');
      },
    });
    assert.equal(fetchCount, 4);
  } finally {
    delete global.chrome;
  }
});

test('serializes concurrent refreshes and lets the second caller reuse the new cache', async () => {
  const storage = {
    [digest.CACHE_KEY]: {
      ...digest.DEFAULT_STATE,
      enabled: true,
    },
  };
  global.chrome = {
    storage: {
      local: {
        get: async key => ({ [key]: storage[key] }),
        set: async values => Object.assign(storage, values),
      },
    },
    permissions: {
      contains: async () => true,
    },
  };

  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  let lockTail = Promise.resolve();
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name, callback) => {
          const run = lockTail.then(callback);
          lockTail = run.catch(() => {});
          return run;
        },
      },
    },
  });

  let fetchCount = 0;
  const fetchImpl = async url => {
    fetchCount += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    const payload = url.includes('feed-x')
      ? { generatedAt: NOW.toISOString(), x: [] }
      : url.includes('feed-podcasts')
        ? { generatedAt: NOW.toISOString(), podcasts: [] }
        : url.includes('feed-videos')
          ? { generatedAt: NOW.toISOString(), videos: [] }
        : { generatedAt: NOW.toISOString(), blogs: [] };
    return { ok: true, text: async () => JSON.stringify(payload) };
  };

  try {
    await Promise.all([
      digest.refresh({ force: true, now: NOW, fetchImpl }),
      digest.refresh({ now: NOW, fetchImpl }),
    ]);
    assert.equal(fetchCount, 4);
  } finally {
    delete global.chrome;
    if (originalNavigator) {
      Object.defineProperty(global, 'navigator', originalNavigator);
    } else {
      delete global.navigator;
    }
  }
});

test('persists dismissed/read report cards and cached translations', async () => {
  const storage = {
    [digest.CACHE_KEY]: {
      ...digest.DEFAULT_STATE,
      enabled: true,
      items: [
        { id: 'x:keep', url: 'https://x.com/example/status/keep' },
        { id: 'x:close', url: 'https://x.com/example/status/close' },
      ],
    },
  };
  global.chrome = {
    storage: {
      local: {
        get: async key => ({ [key]: storage[key] }),
        set: async values => Object.assign(storage, values),
      },
    },
  };

  try {
    const dismissed = await digest.dismissItem('x:close');
    assert.deepEqual(dismissed.items.map(item => item.id), ['x:keep']);
    assert.deepEqual(dismissed.dismissedIds, ['x:close']);

    const read = await digest.markRead('x:keep');
    assert.deepEqual(read.readIds, ['x:keep']);

    const translated = await digest.saveTranslations('zh-Hans', {
      'x:keep': { title: '保留', excerpt: '翻译后的摘要' },
    });
    assert.equal(translated.translations['zh-Hans']['x:keep'].title, '保留');
  } finally {
    delete global.chrome;
  }
});
