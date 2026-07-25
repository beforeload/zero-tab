/* ================================================================
   Zero Tab — Dashboard App

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

const BROWSER_NEWTAB_URLS = new Set([
  'chrome://newtab/',
  'edge://newtab/',
  'brave://newtab/',
  'about:newtab',
]);

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Zero Tab's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      pinned:   t.pinned,
      // Flag Zero Tab's own pages so we can detect duplicate new tabs
      isZeroTab: t.url === newtabUrl || BROWSER_NEWTAB_URLS.has(t.url),
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByIds(tabIds)
 *
 * Closes only the exact tabs represented by the dashboard action.
 * Re-querying first prevents a stale dashboard from targeting reused IDs.
 */
async function closeTabsByIds(tabIds) {
  const requestedIds = new Set(
    (tabIds || []).map(Number).filter(Number.isInteger)
  );
  if (requestedIds.size === 0) return 0;

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => requestedIds.has(tab.id) && !tab.pinned)
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
  return toClose.length;
}

/**
 * focusTab(tabId)
 *
 * Switches Chrome to the exact tab represented by a dashboard chip.
 * Also brings that tab's window to the front.
 */
async function focusTab(tabId) {
  const id = Number(tabId);
  if (!Number.isInteger(id)) return;

  const allTabs = await chrome.tabs.query({});
  const match = allTabs.find(tab => tab.id === id);
  if (!match) return;

  await chrome.tabs.update(id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep =
        matching.find(t => t.pinned) ||
        matching.find(t => t.active) ||
        matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id && !tab.pinned) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) {
        if (!tab.pinned) toClose.push(tab.id);
      }
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

function getRemovableDuplicates(tabs) {
  const byUrl = new Map();
  for (const tab of tabs || []) {
    if (!tab.url) continue;
    const matching = byUrl.get(tab.url) || [];
    matching.push(tab);
    byUrl.set(tab.url, matching);
  }

  const urls = [];
  let count = 0;
  for (const [url, matching] of byUrl) {
    if (matching.length <= 1) continue;
    const unpinnedCount = matching.filter(tab => !tab.pinned).length;
    const removable = matching.some(tab => tab.pinned)
      ? unpinnedCount
      : Math.max(0, unpinnedCount - 1);
    if (removable > 0) {
      urls.push(url);
      count += removable;
    }
  }
  return { urls, count };
}

/**
 * closeZeroTabDupes()
 *
 * Closes all duplicate Zero Tab new-tab pages except the current one.
 */
async function closeZeroTabDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const zeroTabPages = allTabs.filter(t =>
    t.url === newtabUrl || BROWSER_NEWTAB_URLS.has(t.url)
  );

  if (zeroTabPages.length <= 1) {
    return { closed: 0, remaining: zeroTabPages.length };
  }

  // Keep the active Zero Tab page in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    zeroTabPages.find(t => t.active && t.windowId === currentWindow.id) ||
    zeroTabPages.find(t => t.active) ||
    zeroTabPages[0];
  const toClose = zeroTabPages.filter(t => t.id !== keep.id).map(t => t.id);
  const closed = await closeTabsByIds(toClose);
  const remaining = openTabs.filter(tab => tab.isZeroTab).length;
  return { closed, remaining };
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function safeNavigationUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'file:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function getFaviconUrl(pageUrl) {
  const safeUrl = safeNavigationUrl(pageUrl);
  if (!safeUrl) return '';

  const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
  faviconUrl.searchParams.set('pageUrl', safeUrl);
  faviconUrl.searchParams.set('size', '16');
  return faviconUrl.href;
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkZeroTabDupes()
 *
 * Counts how many Zero Tab pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkZeroTabDupes() {
  const zeroTabPages = openTabs.filter(t => t.isZeroTab);
  const banner  = document.getElementById('zeroTabDupeBanner');
  const countEl = document.getElementById('zeroTabDupeCount');
  if (!banner) return;

  if (zeroTabPages.length > 1) {
    if (countEl) countEl.textContent = zeroTabPages.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    const safeTabId = escapeHtml(tab.id);
    const faviconUrl = escapeHtml(getFaviconUrl(tab.url));
    const chipActions = tab.pinned
      ? '<span class="chip-dupe-badge">Pinned</span>'
      : `<div class="chip-actions">
          <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later" aria-label="Save ${safeTitle} for later">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
          </button>
          <button class="chip-action chip-close" data-action="close-single-tab" data-tab-id="${safeTabId}" title="Close this tab" aria-label="Close ${safeTitle}">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>`;
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" title="${safeTitle}" role="button" tabindex="0">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${safeTitle}</span>${dupeTag}
      ${chipActions}
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group, groupIndex) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const closableCount = tabs.filter(tab => !tab.pinned).length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = `group-${groupIndex}`;

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);
  const removableDupeUrls = [];
  let removableExtras = 0;
  for (const [url] of dupeUrls) {
    const matching = tabs.filter(tab => tab.url === url);
    const unpinnedCount = matching.filter(tab => !tab.pinned).length;
    const removable = matching.some(tab => tab.pinned)
      ? unpinnedCount
      : Math.max(0, unpinnedCount - 1);
    if (removable > 0) {
      removableDupeUrls.push(url);
      removableExtras += removable;
    }
  }

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge is-duplicate">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    const safeTabId = escapeHtml(tab.id);
    const faviconUrl = escapeHtml(getFaviconUrl(tab.url));
    const chipActions = tab.pinned
      ? '<span class="chip-dupe-badge">Pinned</span>'
      : `<div class="chip-actions">
          <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later" aria-label="Save ${safeTitle} for later">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
          </button>
          <button class="chip-action chip-close" data-action="close-single-tab" data-tab-id="${safeTabId}" title="Close this tab" aria-label="Close ${safeTitle}">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>`;
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" title="${safeTitle}" role="button" tabindex="0">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${safeTitle}</span>${dupeTag}
      ${chipActions}
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  const groupName = escapeHtml(
    isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))
  );
  const closeCardButton = closableCount > 0
    ? `<button class="card-close-button" data-action="close-domain-tabs" data-domain-id="${stableId}" title="Close ${closableCount} unpinned tab${closableCount !== 1 ? 's' : ''}" aria-label="Close ${closableCount} unpinned tab${closableCount !== 1 ? 's' : ''} from ${groupName}">
        ${ICONS.close}
      </button>`
    : '';

  let actionsHtml = closableCount === 0
    ? '<span class="open-tabs-badge">Pinned tabs are protected</span>'
    : '';

  if (removableDupeUrls.length > 0) {
    const dupeUrlsEncoded = removableDupeUrls.map(url => encodeURIComponent(url)).join(',');
    actionsHtml += `${actionsHtml ? ' ' : ''}
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${removableExtras} duplicate${removableExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}" data-masonry-order="${groupIndex}">
      <div class="mission-content">
        <div class="mission-top">
          <div class="mission-heading">
            <span class="mission-name">${groupName}</span>
            ${tabBadge}
            ${dupeBadge}
          </div>
          ${closeCardButton}
        </div>
        <div class="mission-pages">${pageChips}</div>
        ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ''}
      </div>
    </div>`;
}

function getMasonryColumnCount(container) {
  const width = container.clientWidth;
  if (width < 560) return 1;
  if (width < 760) return 2;
  if (width < 940) return 3;
  return 4;
}

/**
 * Distributes complete cards into the currently shortest column.
 * CSS multi-column layout balances text fragments, not variable-height cards,
 * so it can leave whole columns empty when cards cannot be split.
 */
function layoutMasonry(container) {
  if (!container) return;

  const cards = Array.from(container.querySelectorAll('.mission-card'))
    .sort((a, b) => Number(a.dataset.masonryOrder) - Number(b.dataset.masonryOrder));
  if (cards.length === 0) return;

  const columnCount = Math.min(getMasonryColumnCount(container), cards.length);
  container.style.setProperty('--masonry-columns', columnCount);

  // Measure every card at its final column width before redistributing.
  container.replaceChildren(...cards);
  container.classList.add('is-measuring');
  const measuredCards = cards.map(card => ({
    card,
    height: card.getBoundingClientRect().height,
  }));
  container.classList.remove('is-measuring');

  const columns = Array.from({ length: columnCount }, () => {
    const column = document.createElement('div');
    column.className = 'masonry-column';
    return column;
  });
  const heights = Array(columnCount).fill(0);

  for (const { card, height } of measuredCards) {
    const shortestIndex = heights.indexOf(Math.min(...heights));
    columns[shortestIndex].appendChild(card);
    heights[shortestIndex] += height + 14;
  }

  container.replaceChildren(...columns);
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const dashboard      = document.getElementById('dashboardColumns');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      if (dashboard) dashboard.classList.remove('has-deferred');
      return;
    }

    column.style.display = 'block';
    if (dashboard) dashboard.classList.add('has-deferred');

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[zero-tab] Could not load saved tabs:', err);
    column.style.display = 'none';
    if (dashboard) dashboard.classList.remove('has-deferred');
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const ago = timeAgo(item.savedAt);
  const safeId = escapeHtml(item.id);
  const safeUrl = safeNavigationUrl(item.url);
  const escapedUrl = escapeHtml(safeUrl);
  const safeTitle = escapeHtml(item.title || item.url);
  const safeDomain = escapeHtml(domain);
  const safeAgo = escapeHtml(ago);
  const faviconUrl = escapeHtml(getFaviconUrl(safeUrl));
  const titleContent = `
    ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
    ${safeTitle}`;
  const titleElement = safeUrl
    ? `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="deferred-title" title="${safeTitle}">${titleContent}</a>`
    : `<span class="deferred-title" title="${safeTitle}">${titleContent}</span>`;

  return `
    <div class="deferred-item" data-deferred-id="${safeId}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${safeId}" aria-label="Mark ${safeTitle} complete">
      <div class="deferred-info">
        ${titleElement}
        <div class="deferred-meta">
          <span>${safeDomain}</span>
          <span>${safeAgo}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${safeId}" title="Dismiss" aria-label="Dismiss ${safeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  const safeUrl = safeNavigationUrl(item.url);
  const safeTitle = escapeHtml(item.title || item.url);
  const titleElement = safeUrl
    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="archive-item-title" title="${safeTitle}">${safeTitle}</a>`
    : `<span class="archive-item-title" title="${safeTitle}">${safeTitle}</span>`;

  return `
    <div class="archive-item">
      ${titleElement}
      <span class="archive-item-date">${escapeHtml(ago)}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates header stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  const closableTabs = realTabs.filter(tab => !tab.pinned);
  const globalDuplicates = getRemovableDuplicates(realTabs);

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    const duplicateButton = `<button class="action-btn compact-action duplicate-tabs" data-action="dedup-all-tabs" ${globalDuplicates.count === 0 ? 'disabled' : ''}>Close duplicate tabs</button>`;
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn compact-action close-tabs" data-action="close-all-open-tabs" ${closableTabs.length === 0 ? 'disabled' : ''}>${ICONS.close} Close ${closableTabs.length} unpinned tabs</button> ${duplicateButton}`;
    openTabsMissionsEl.innerHTML = domainGroups.map((g, index) => renderDomainCard(g, index)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Header stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = realTabs.length;

  // --- Check for duplicate Zero Tab pages ---
  checkZeroTabDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // The sidebar changes the available width, so balance cards afterwards.
  if (openTabsMissionsEl) layoutMasonry(openTabsMissionsEl);
}

async function renderDashboard() {
  await renderStaticDashboard();
}

/* ----------------------------------------------------------------
   AI BUILDER DAILY BRIEF
   ---------------------------------------------------------------- */

function formatDigestDate(dateStr) {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return '';

  const now = new Date();
  const locale = navigator.language || 'en';
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (sameDay) return `${relative.format(0, 'day')} ${time}`;
  if (isYesterday) return `${relative.format(-1, 'day')} ${time}`;
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function digestKindLabel(kind) {
  if (kind === 'blog') return '官方博客';
  if (kind === 'podcast') return '播客';
  return 'X 动态';
}

function getDigestTargetLanguage() {
  const locale = (navigator.language || 'en').toLowerCase();
  if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-mo')) {
    return 'zh-Hant';
  }
  if (locale.startsWith('zh')) return 'zh-Hans';
  return locale.split('-')[0];
}

function hasMostlyCjk(text) {
  const characters = String(text || '').replace(/\s/g, '');
  if (!characters) return false;
  const cjk = (characters.match(/[\u3400-\u9fff]/g) || []).length;
  return cjk / characters.length > 0.35;
}

function createDigestTranslator(targetLanguage) {
  if (typeof Translator === 'undefined') {
    throw new Error('Chrome on-device Translator API is unavailable');
  }
  return Translator.create({
    sourceLanguage: 'en',
    targetLanguage,
  });
}

async function translateDigestItems(items, targetLanguage, translatorPromise) {
  const translator = await translatorPromise;
  const translated = {};

  try {
    for (const item of items) {
      if (targetLanguage.startsWith('zh') && hasMostlyCjk(`${item.title} ${item.excerpt}`)) {
        continue;
      }
      translated[item.id] = {
        title: await translator.translate(item.title),
        excerpt: item.excerpt ? await translator.translate(item.excerpt) : '',
      };
    }
  } finally {
    translator.destroy?.();
  }

  return translated;
}

function renderDigestItemCard(item, state, stale, targetLanguage) {
  const api = globalThis.ZeroTabBuilderDigest;
  const safeUrl = api.safeHttpsUrl(item.url);
  if (!safeUrl) return '';
  const localized = state.translations?.[targetLanguage]?.[item.id];
  const safeTitle = escapeHtml(localized?.title || item.title);
  const safeExcerpt = escapeHtml(localized?.excerpt || item.excerpt);
  const safeSource = escapeHtml(item.source);
  const safeItemId = escapeHtml(item.id);
  const kind = ['x', 'blog', 'podcast'].includes(item.kind) ? item.kind : 'x';
  const dateLabel = escapeHtml(formatDigestDate(item.publishedAt));
  const isRead = state.readIds?.includes(item.id);

  return `
    <article class="digest-item${isRead ? ' is-read' : ''}">
      <div class="digest-item-top">
        <div class="digest-item-meta">
          <span class="digest-kind" data-kind="${kind}">${digestKindLabel(kind)}</span>
          <span class="digest-freshness${stale ? ' is-stale' : ''}">${dateLabel}</span>
        </div>
      </div>
      <a class="digest-item-title" href="${escapeHtml(safeUrl)}" data-action="open-builder-item" data-item-id="${safeItemId}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>
      ${safeExcerpt ? `<p class="digest-item-excerpt">${safeExcerpt}</p>` : ''}
      <div class="digest-item-source">${safeSource}</div>
    </article>`;
}

function renderBuilderDigestState(state) {
  const api = globalThis.ZeroTabBuilderDigest;
  const root = document.getElementById('builderDigest');
  const body = document.getElementById('builderDigestBody');
  const itemsEl = document.getElementById('builderDigestItems');
  const statusEl = document.getElementById('builderDigestStatus');
  const metaEl = document.getElementById('builderDigestMeta');
  const toolbar = root.querySelector('.builder-digest-toolbar');
  const refreshButton = document.getElementById('builderDigestRefresh');
  const translateButton = document.getElementById('builderDigestTranslate');
  const toggleButton = document.getElementById('builderDigestToggle');
  if (!api || !root || !body || !itemsEl || !statusEl || !metaEl) return;

  root.classList.toggle('is-collapsed', Boolean(state.collapsed));
  body.hidden = Boolean(state.collapsed);
  if (toolbar) toolbar.setAttribute('aria-expanded', String(!state.collapsed));
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', String(!state.collapsed));
    toggleButton.title = state.collapsed ? '展开速报' : '折叠速报';
    toggleButton.setAttribute('aria-label', toggleButton.title);
  }
  if (refreshButton) refreshButton.hidden = !state.enabled;
  const targetLanguage = getDigestTargetLanguage();
  if (translateButton) {
    translateButton.hidden = !state.enabled
      || targetLanguage === 'en'
      || typeof Translator === 'undefined';
    translateButton.title = `翻译为 ${targetLanguage}`;
    translateButton.setAttribute('aria-label', translateButton.title);
  }

  if (!state.enabled) {
    metaEl.textContent = '启用后每天读取一次公开 feed';
    statusEl.innerHTML = `
      <div class="digest-permission">
        <div class="digest-permission-copy">
          <strong>关注真正动手构建 AI 产品的人</strong>
          仅从 GitHub 下载 Follow Builders 的公开动态；不会上传标签页、Saved for later 或浏览数据。
        </div>
        <button class="digest-enable-button" data-action="enable-builder-digest" type="button">启用每日速报</button>
      </div>`;
    itemsEl.innerHTML = '';
    return;
  }

  const stale = api.isStale(state);
  const updatedLabel = state.feedGeneratedAt
    ? `Feed 更新于 ${formatDigestDate(state.feedGeneratedAt)}`
    : state.fetchedAt
      ? `获取于 ${formatDigestDate(state.fetchedAt)}`
      : '等待首次更新';
  metaEl.textContent = `${updatedLabel}${stale ? ' · 缓存可能已过期' : ''}`;

  const reportItems = api.selectTimelineItems(state.items);
  if (state.errors?.length) {
    statusEl.textContent = reportItems.length
      ? '部分来源暂时不可用，当前展示最近一次成功获取的内容。'
      : '暂时无法获取速报，请稍后重试。';
  } else if (reportItems.length === 0) {
    statusEl.textContent = '今天暂时没有新的 Builder 动态。';
  } else {
    statusEl.textContent = 'Ordered newest first from the locally cached feed. Nothing is sent to a cloud AI service.';
  }

  itemsEl.innerHTML = reportItems
    .map(item => renderDigestItemCard(item, state, stale, targetLanguage))
    .join('');
}

function setBuilderDigestLoading(loading) {
  const refreshButton = document.getElementById('builderDigestRefresh');
  if (refreshButton) refreshButton.disabled = loading;
}

async function initializeBuilderDigest() {
  const api = globalThis.ZeroTabBuilderDigest;
  if (!api) return;

  try {
    let state = await api.getState();
    renderBuilderDigestState(state);
    if (!state.enabled) return;

    setBuilderDigestLoading(true);
    state = await api.refresh();
    renderBuilderDigestState(state);
  } catch (err) {
    console.warn('[zero-tab] Could not initialize Builder Digest:', err);
    const statusEl = document.getElementById('builderDigestStatus');
    if (statusEl) statusEl.textContent = '每日速报暂时不可用。';
  } finally {
    setBuilderDigestLoading(false);
  }
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Enable the optional public AI Builder feed ----
  if (action === 'enable-builder-digest') {
    const api = globalThis.ZeroTabBuilderDigest;
    if (!api) return;
    actionEl.disabled = true;
    try {
      const result = await api.enable();
      if (!result.granted) {
        showToast('未授予公开 feed 读取权限');
        renderBuilderDigestState(result.state);
        return;
      }
      setBuilderDigestLoading(true);
      const state = await api.refresh({ force: true });
      renderBuilderDigestState(state);
      showToast('AI Builder Daily Report 已启用');
    } catch (err) {
      console.warn('[zero-tab] Could not enable Builder Digest:', err);
      showToast('启用每日速报失败');
    } finally {
      actionEl.disabled = false;
      setBuilderDigestLoading(false);
    }
    return;
  }

  // ---- Refresh the daily brief on demand ----
  if (action === 'refresh-builder-digest') {
    const api = globalThis.ZeroTabBuilderDigest;
    if (!api) return;
    setBuilderDigestLoading(true);
    try {
      const state = await api.refresh({ force: true });
      renderBuilderDigestState(state);
      showToast(state.errors?.length ? '已显示最近可用内容' : '每日速报已更新');
    } catch (err) {
      console.warn('[zero-tab] Could not refresh Builder Digest:', err);
      showToast('刷新每日速报失败');
    } finally {
      setBuilderDigestLoading(false);
    }
    return;
  }

  // ---- Persist the brief's collapsed state ----
  if (action === 'toggle-builder-digest') {
    const api = globalThis.ZeroTabBuilderDigest;
    const root = document.getElementById('builderDigest');
    if (!api || !root) return;
    const state = await api.setCollapsed(!root.classList.contains('is-collapsed'));
    renderBuilderDigestState(state);
    return;
  }

  // ---- Mark a report card as read, then open its source ----
  if (action === 'open-builder-item') {
    e.preventDefault();
    const api = globalThis.ZeroTabBuilderDigest;
    const itemId = actionEl.dataset.itemId;
    if (!api || !itemId) return;
    const url = api.safeHttpsUrl(actionEl.href);
    if (!url) return;
    const state = await api.markRead(itemId);
    renderBuilderDigestState(state);
    await chrome.tabs.create({ url });
    return;
  }

  // ---- Translate visible cards with Chrome's on-device language pack ----
  if (action === 'translate-builder-digest') {
    const api = globalThis.ZeroTabBuilderDigest;
    if (!api) return;
    const targetLanguage = getDigestTargetLanguage();
    actionEl.disabled = true;

    try {
      // Start model creation before the first await so a required download
      // remains associated with this user gesture.
      const translatorPromise = createDigestTranslator(targetLanguage);
      const state = await api.getState();
      const items = api.selectTimelineItems(state.items);
      const translated = await translateDigestItems(items, targetLanguage, translatorPromise);
      const nextState = await api.saveTranslations(targetLanguage, translated);
      renderBuilderDigestState(nextState);
      showToast(`已翻译为 ${targetLanguage}`);
    } catch (err) {
      console.warn('[zero-tab] Could not translate Builder Digest:', err);
      showToast('当前设备暂不支持本地翻译');
    } finally {
      actionEl.disabled = false;
    }
    return;
  }

  // ---- Close duplicate Zero Tab pages ----
  if (action === 'close-zero-tab-dupes') {
    const result = await closeZeroTabDupes();
    if (result.closed > 0) playCloseSound();
    checkZeroTabDupes();
    const banner = document.getElementById('zeroTabDupeBanner');
    if (result.remaining > 1) {
      showToast('Pinned Zero Tab pages were kept open');
      return;
    }
    if (banner && result.closed > 0) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Zero Tab pages');
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabId = actionEl.dataset.tabId;
    if (tabId) await focusTab(tabId);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabId = actionEl.dataset.tabId;
    if (!tabId) return;

    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    playCloseSound();
    await closeTabsByIds([tabId]);
    await renderDashboard();
    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabId    = actionEl.dataset.tabId;
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabId || !tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[zero-tab] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    await closeTabsByIds([tabId]);
    await renderDashboard();
    showToast('Saved for later');
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const groupIndex = Number(String(domainId || '').replace('group-', ''));
    const group = Number.isInteger(groupIndex) ? domainGroups[groupIndex] : null;
    if (!group) return;

    const tabIds = group.tabs.filter(tab => !tab.pinned).map(tab => tab.id);
    await closeTabsByIds(tabIds);

    if (card) {
      playCloseSound();
      const rect = card.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    await renderDashboard();
    showToast(`Closed ${tabIds.length} tab${tabIds.length !== 1 ? 's' : ''} from ${groupLabel}`);
    return;
  }

  // ---- Close duplicate tabs across every domain ----
  if (action === 'dedup-all-tabs') {
    const duplicates = getRemovableDuplicates(getRealTabs());
    if (duplicates.urls.length === 0) {
      showToast('No duplicate tabs to close');
      return;
    }

    await closeDuplicateTabs(duplicates.urls, true);
    playCloseSound();
    await renderDashboard();
    showToast(`Closed ${duplicates.count} duplicate tab${duplicates.count !== 1 ? 's' : ''}`);
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();
    await renderDashboard();
    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const tabIds = getRealTabs().filter(tab => !tab.pinned).map(tab => tab.id);
    await closeTabsByIds(tabIds);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
    });

    await renderDashboard();
    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// Make custom interactive surfaces operable without a pointer.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const toolbar = e.target.closest('.builder-digest-toolbar[data-action]');
  if (toolbar && e.target === toolbar) {
    e.preventDefault();
    toolbar.click();
    return;
  }
  const chip = e.target.closest('.page-chip[data-action="focus-tab"]');
  if (!chip || e.target !== chip) return;
  e.preventDefault();
  chip.click();
});

// Inline onerror handlers are blocked by Manifest V3 CSP.
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.classList.contains('chip-favicon')) {
    e.target.hidden = true;
  }
}, true);

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div class="archive-empty">No results</div>';
  } catch (err) {
    console.warn('[zero-tab] Archive search failed:', err);
  }
});

let masonryResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(masonryResizeTimer);
  masonryResizeTimer = setTimeout(() => {
    layoutMasonry(document.getElementById('openTabsMissions'));
  }, 120);
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
renderDashboard();
initializeBuilderDigest();
