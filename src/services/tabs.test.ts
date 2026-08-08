import { describe, expect, it } from 'vitest';
import type { OpenTab } from '../types';
import { getRemovableDuplicates, groupTabs } from './tabs';

function tab(
  id: number,
  url: string,
  overrides: Partial<OpenTab> = {},
): OpenTab {
  return {
    id,
    url,
    title: url,
    windowId: 1,
    active: false,
    pinned: false,
    isZeroTab: false,
    ...overrides,
  };
}

describe('groupTabs', () => {
  it('separates homepages and groups the rest by domain', () => {
    const groups = groupTabs([
      tab(1, 'https://github.com/'),
      tab(2, 'https://github.com/example/repo'),
      tab(3, 'https://example.com/one'),
      tab(4, 'https://example.com/two'),
    ]);

    expect(groups[0]?.domain).toBe('__landing-pages__');
    expect(groups.find((group) => group.domain === 'github.com')?.tabs).toHaveLength(1);
    expect(groups.find((group) => group.domain === 'example.com')?.tabs).toHaveLength(2);
  });
});

describe('getRemovableDuplicates', () => {
  it('protects pinned copies while closing every unpinned duplicate', () => {
    const result = getRemovableDuplicates([
      tab(1, 'https://example.com', { pinned: true }),
      tab(2, 'https://example.com'),
      tab(3, 'https://example.com'),
    ]);

    expect(result).toEqual({
      urls: ['https://example.com'],
      count: 2,
    });
  });

  it('keeps one copy when no duplicate is pinned', () => {
    const result = getRemovableDuplicates([
      tab(1, 'https://example.com'),
      tab(2, 'https://example.com'),
    ]);

    expect(result.count).toBe(1);
  });
});
