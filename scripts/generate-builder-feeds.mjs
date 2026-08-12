#!/usr/bin/env node
import { generateBuilderFeeds } from './lib/feed-generator.mjs';

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
