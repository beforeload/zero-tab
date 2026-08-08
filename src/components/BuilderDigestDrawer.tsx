import { useEffect, useRef, useState } from 'react';
import type { DigestItem, DigestState } from '../types';
import { CloseIcon, SparklesIcon } from './Icons';

type Props = {
  open: boolean;
  onClose(): void;
  onToast(message: string): void;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(navigator.language, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString(navigator.language, {
    month: 'short',
    day: 'numeric',
  });
}

function targetLanguage(): string {
  const locale = (navigator.language || 'en').toLowerCase();
  if (/^zh-(tw|hk|mo)/.test(locale)) return 'zh-Hant';
  if (locale.startsWith('zh')) return 'zh-Hans';
  return locale.split('-')[0] || 'en';
}

function kindLabel(kind: DigestItem['kind']): string {
  if (kind === 'blog') return 'Blog';
  if (kind === 'podcast') return 'Podcast';
  return 'X';
}

export function BuilderDigestDrawer({ open, onClose, onToast }: Props) {
  const [state, setState] = useState<DigestState | null>(null);
  const [loading, setLoading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const initialized = useRef(false);
  const api = globalThis.ZeroTabBuilderDigest;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !api) return;
    let cancelled = false;
    setLoading(true);
    void api
      .getState()
      .then(async (cached) => {
        if (!cancelled) setState(cached);
        if (!cached.enabled || initialized.current) return cached;
        initialized.current = true;
        return api.refresh();
      })
      .then((next) => {
        if (!cancelled && next) setState(next);
      })
      .catch((error: unknown) => {
        console.warn('[zero-tab] Could not initialize Builder Digest:', error);
        onToast('The daily report is temporarily unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, onToast, open]);

  const enable = async () => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await api.enable();
      if (!result.granted) {
        setState(result.state);
        onToast('Permission to read the public feed was not granted');
        return;
      }
      const next = await api.refresh({ force: true });
      setState(next);
      onToast('AI Builder Daily Report enabled');
    } catch (error) {
      console.warn('[zero-tab] Could not enable Builder Digest:', error);
      onToast('Could not enable the daily report');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!api) return;
    setLoading(true);
    try {
      const next = await api.refresh({ force: true });
      setState(next);
      onToast(next.errors.length ? 'Showing the last available content' : 'Daily report updated');
    } catch (error) {
      console.warn('[zero-tab] Could not refresh Builder Digest:', error);
      onToast('Could not refresh the daily report');
    } finally {
      setLoading(false);
    }
  };

  const openItem = async (item: DigestItem) => {
    if (!api) return;
    const url = api.safeHttpsUrl(item.url);
    if (!url) return;
    setState(await api.markRead(item.id));
    await chrome.tabs.create({ url });
  };

  const translate = async () => {
    if (!api || !state || typeof Translator === 'undefined') return;
    const language = targetLanguage();
    setLoading(true);
    try {
      const translator = await Translator.create({
        sourceLanguage: 'en',
        targetLanguage: language,
      });
      const translated: Record<string, { title: string; excerpt: string }> = {};
      try {
        for (const item of api.selectTimelineItems(state.items)) {
          translated[item.id] = {
            title: await translator.translate(item.title),
            excerpt: item.excerpt
              ? await translator.translate(item.excerpt)
              : '',
          };
        }
      } finally {
        translator.destroy?.();
      }
      setState(await api.saveTranslations(language, translated));
      onToast(`Translated to ${language}`);
    } catch (error) {
      console.warn('[zero-tab] Could not translate Builder Digest:', error);
      onToast('On-device translation is not supported on this device');
    } finally {
      setLoading(false);
    }
  };

  const language = targetLanguage();
  const items = state && api ? api.selectTimelineItems(state.items) : [];
  const updated = state?.feedGeneratedAt || state?.fetchedAt;

  return (
    <div
      className={`digest-drawer-layer${open ? ' is-open' : ''}`}
      aria-hidden={!open}
    >
      <button
        className="digest-drawer-backdrop"
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label="Close AI Builder Daily Report"
        onClick={onClose}
      />
      <aside
        className="digest-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="digest-drawer-title"
      >
        <header className="digest-drawer-header">
          <div className="digest-drawer-title">
            <span className="digest-drawer-icon">
              <SparklesIcon />
            </span>
            <div>
              <span className="eyebrow">Independent module</span>
              <h2 id="digest-drawer-title">AI Builder Daily Report</h2>
            </div>
          </div>
          <button
            ref={closeRef}
            className="digest-drawer-close"
            type="button"
            aria-label="Close report"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="digest-drawer-toolbar">
          <p>
            {updated
              ? `Latest public feed · ${formatDate(updated)}`
              : 'Useful updates from builders, podcasts, and engineering blogs'}
          </p>
          {state?.enabled && (
            <div>
              {language !== 'en' && typeof Translator !== 'undefined' && (
                <button type="button" disabled={loading} onClick={translate}>
                  Translate
                </button>
              )}
              <button type="button" disabled={loading} onClick={refresh}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          )}
        </div>

        <div className="digest-drawer-content">
          {!api && (
            <div className="digest-drawer-empty">
              The report module could not be loaded.
            </div>
          )}

          {api && state && !state.enabled && (
            <div className="digest-permission digest-drawer-permission">
              <div className="digest-permission-copy">
                <strong>Follow the people actually building AI products</strong>
                <p>
                  Downloads public Follow Builders updates from GitHub at most
                  once per day. Your tabs and saved links never leave Chrome.
                </p>
              </div>
              <button
                className="digest-enable-button"
                type="button"
                disabled={loading}
                onClick={enable}
              >
                {loading ? 'Enabling…' : 'Enable daily report'}
              </button>
            </div>
          )}

          {state?.enabled && state.errors.length > 0 && (
            <div className="digest-drawer-notice">
              Some sources are unavailable. Showing the latest local cache.
            </div>
          )}

          {state?.enabled && !loading && !items.length && (
            <div className="digest-drawer-empty">
              No new builder updates today.
            </div>
          )}

          <div className="digest-changelog-list">
            {items.map((item) => {
              const translated = state?.translations?.[language]?.[item.id];
              const read = state?.readIds.includes(item.id);
              return (
                <article
                  className={`digest-changelog-item${read ? ' is-read' : ''}`}
                  key={item.id}
                >
                  <button
                    className="digest-changelog-link"
                    type="button"
                    onClick={() => void openItem(item)}
                  >
                    <span className="digest-changelog-meta">
                      <span className="digest-kind" data-kind={item.kind}>
                        {kindLabel(item.kind)}
                      </span>
                      <span>{formatDate(item.publishedAt)}</span>
                      <span>{item.source}</span>
                    </span>
                    <span className="digest-changelog-title">
                      {translated?.title || item.title}
                    </span>
                    {(translated?.excerpt || item.excerpt) && (
                      <span className="digest-changelog-excerpt">
                        {translated?.excerpt || item.excerpt}
                      </span>
                    )}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
