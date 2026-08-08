import { useMemo, useState } from 'react';
import type { SavedItem } from '../types';
import { faviconUrl } from '../services/tabs';
import { CardFrame } from './CardFrame';
import { CloseIcon } from './Icons';

type Props = {
  active: SavedItem[];
  archived: SavedItem[];
  collapsed: boolean;
  onToggle(): void;
  onHide(): void;
  onComplete(id: string): void;
  onDismiss(id: string): void;
};

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'file:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function timeAgo(value?: string): string {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function SavedForLaterCard({
  active,
  archived,
  collapsed,
  onToggle,
  onHide,
  onComplete,
  onDismiss,
}: Props) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length < 2) return archived;
    return archived.filter(
      (item) =>
        item.title.toLowerCase().includes(normalized) ||
        item.url.toLowerCase().includes(normalized),
    );
  }, [archived, query]);

  return (
    <CardFrame
      title="Saved for later"
      count={active.length ? `${active.length} item${active.length === 1 ? '' : 's'}` : ''}
      collapsed={collapsed}
      onToggle={onToggle}
      onHide={onHide}
      className="saved-card"
    >
      <div className="deferred-list">
        {active.map((item) => {
          const url = safeUrl(item.url);
          let domain = '';
          try {
            domain = new URL(item.url).hostname.replace(/^www\./, '');
          } catch {
            // Leave the domain empty.
          }
          return (
            <div className="deferred-item" key={item.id}>
              <input
                className="deferred-checkbox"
                type="checkbox"
                aria-label={`Mark ${item.title} complete`}
                onChange={() => onComplete(item.id)}
              />
              <div className="deferred-info">
                {url ? (
                  <a
                    className="deferred-title"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.title}
                  >
                    {faviconUrl(url) && (
                      <img className="chip-favicon" src={faviconUrl(url)} alt="" />
                    )}
                    {item.title || item.url}
                  </a>
                ) : (
                  <span className="deferred-title">{item.title || item.url}</span>
                )}
                <div className="deferred-meta">
                  <span>{domain}</span>
                  <span>{timeAgo(item.savedAt)}</span>
                </div>
              </div>
              <button
                className="deferred-dismiss"
                type="button"
                aria-label={`Dismiss ${item.title}`}
                onClick={() => onDismiss(item.id)}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>

      {!active.length && (
        <div className="deferred-empty">Nothing saved. Living in the moment.</div>
      )}

      {archived.length > 0 && (
        <div className="deferred-archive">
          <button
            className={`archive-toggle${archiveOpen ? ' open' : ''}`}
            type="button"
            onClick={() => setArchiveOpen((value) => !value)}
          >
            Archive <span className="archive-count">({archived.length})</span>
          </button>
          {archiveOpen && (
            <div className="archive-body">
              <input
                type="search"
                className="archive-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search archived tabs..."
              />
              <div className="archive-list">
                {filtered.map((item) => {
                  const url = safeUrl(item.url);
                  return (
                    <div className="archive-item" key={item.id}>
                      {url ? (
                        <a
                          className="archive-item-title"
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.title || item.url}
                        </a>
                      ) : (
                        <span className="archive-item-title">
                          {item.title || item.url}
                        </span>
                      )}
                      <span className="archive-item-date">
                        {timeAgo(item.completedAt || item.savedAt)}
                      </span>
                    </div>
                  );
                })}
                {!filtered.length && <div className="archive-empty">No results</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </CardFrame>
  );
}
