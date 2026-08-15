import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  generateBuilderFeeds,
  parseBlogHtml,
  parseRssOrAtom,
  parseXSyndicationHtml,
} from '../scripts/lib/feed-generator.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('feed generator parsers', () => {
  it('parses RSS blog entries', () => {
    const xml = readFileSync(join(fixtures, 'blog.rss.xml'), 'utf8');
    const items = parseRssOrAtom(xml, {
      sourceName: 'Example Blog',
      baseUrl: 'https://example.com/feed.xml',
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'Shipping smaller context windows');
    assert.equal(items[0].url, 'https://example.com/posts/context-windows');
    assert.match(items[0].description, /prompts/i);
    assert.equal(items[0].description.includes('<'), false);
    assert.equal(items[0].description.includes('&lt;'), false);
    assert.equal(items[0].description.includes('</'), false);
  });

  it('parses Atom podcast entries', () => {
    const xml = readFileSync(join(fixtures, 'podcast.atom.xml'), 'utf8');
    const items = parseRssOrAtom(xml, {
      sourceName: 'Builders Podcast',
      baseUrl: 'https://example.com/podcast/atom.xml',
      limit: 1,
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Evaluating coding agents');
    assert.equal(items[0].url, 'https://example.com/episodes/agents');
  });

  it('parses blog HTML article links and ignores skip/nav junk', () => {
    const html = readFileSync(join(fixtures, 'blog.html'), 'utf8');
    const items = parseBlogHtml(html, {
      sourceName: 'Cursor Blog',
      baseUrl: 'https://cursor.com/blog',
    });
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((item) => [item.url, item.title]),
      [
        ['https://cursor.com/blog/agent-harness', 'Building a reliable agent harness'],
        ['https://cursor.com/blog/tab-workstation', 'Designing a personal tab workstation'],
        ['https://cursor.com/blog/ios-mobile-app', 'Build from anywhere with Cursor for iOS'],
      ],
    );
    assert.equal(
      items.every((item) => !/跳到|Skip to|如何获得支持/i.test(item.title)),
      true,
    );
  });

  it('parses YouTube Atom video entries and keeps watch IDs', () => {
    const xml = readFileSync(join(fixtures, 'youtube.atom.xml'), 'utf8');
    const items = parseRssOrAtom(xml, {
      sourceName: 'Cursor Compile',
      baseUrl: 'https://www.youtube.com/feeds/videos.xml?playlist_id=example',
      limit: 1,
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Opening Keynote, Michael Truell | Compile 26');
    assert.equal(items[0].url, 'https://www.youtube.com/watch?v=abc123Compile');
    assert.match(items[0].description, /Compile keynote/i);
  });

  it('parses X syndication markup into tweets', () => {
    const html = readFileSync(join(fixtures, 'x-syndication.html'), 'utf8');
    const builder = parseXSyndicationHtml(html, {
      name: 'Simon Willison',
      handle: 'simonw',
    });
    assert.equal(builder.handle, 'simonw');
    assert.equal(builder.tweets.length, 1);
    assert.equal(builder.tweets[0].id, '1234567890');
    assert.match(builder.tweets[0].text, /Translator API/i);
    assert.equal(builder.tweets[0].url, 'https://x.com/simonw/status/1234567890');
  });

  it('parses jina markdown timelines and ignores profile chrome', () => {
    const markdown = readFileSync(join(fixtures, 'x-jina.md'), 'utf8');
    const builder = parseXSyndicationHtml(markdown, {
      name: 'Swyx',
      handle: 'swyx',
    });
    assert.equal(builder.tweets.length, 1);
    assert.equal(builder.tweets[0].id, '2088381680478540096');
    assert.equal(builder.tweets[0].text, 'Shipping agents that actually stay useful for a week');
    assert.equal(builder.tweets.every((tweet) => !/avatar|Log in|Joined|Following/i.test(tweet.text)), true);
  });

  it('writes feed JSON through a mocked fetch layer', async () => {
    const fixturesByUrl = {
      'https://cdn.syndication.twimg.com/timeline/profile?screen_name=simonw':
        readFileSync(join(fixtures, 'x-syndication.html'), 'utf8'),
      'https://example.com/feed.xml': readFileSync(join(fixtures, 'blog.rss.xml'), 'utf8'),
      'https://example.com/podcast.xml': readFileSync(join(fixtures, 'podcast.atom.xml'), 'utf8'),
      'https://example.com/youtube.xml': readFileSync(join(fixtures, 'youtube.atom.xml'), 'utf8'),
    };
    const fetchImpl = async (url) => {
      const body = fixturesByUrl[url];
      if (!body) throw new Error(`unexpected url ${url}`);
      return {
        ok: true,
        status: 200,
        text: async () => body,
      };
    };

    const sourcesPath = join(fixtures, 'sources.json');
    const outDir = join(fixtures, 'out');
    const result = await generateBuilderFeeds({
      sourcesPath,
      outDir,
      now: new Date('2026-08-11T12:00:00.000Z'),
      fetchImpl,
    });

    assert.equal(result.hasData, true);
    assert.equal(result.feedX.x[0].tweets.length, 1);
    assert.ok(result.feedBlogs.blogs.length >= 1);
    assert.ok(result.feedPodcasts.podcasts.length >= 1);
    assert.ok(result.feedVideos.videos.length >= 1);
    assert.equal(result.feedVideos.videos[0].url, 'https://www.youtube.com/watch?v=abc123Compile');

    const writtenX = JSON.parse(readFileSync(join(outDir, 'feed-x.json'), 'utf8'));
    assert.equal(writtenX.generatedAt, '2026-08-11T12:00:00.000Z');
  });
});
