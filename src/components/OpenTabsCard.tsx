import { useEffect, useMemo, useRef, useState } from 'react';
import type { DomainGroup, OpenTab } from '../types';
import {
  faviconUrl,
  friendlyDomain,
  getRemovableDuplicates,
  smartTitle,
} from '../services/tabs';
import { BookmarkIcon, CloseIcon } from './Icons';
import { CardFrame } from './CardFrame';

type Props = {
  groups: DomainGroup[];
  tabs: OpenTab[];
  zeroTabCount: number;
  collapsed: boolean;
  onToggle(): void;
  onFocus(tab: OpenTab): void;
  onCloseTab(tab: OpenTab, origin: DOMRect): void;
  onSaveTab(tab: OpenTab): void;
  onCloseGroup(group: DomainGroup, origin: DOMRect): void;
  onDeduplicate(urls: string[]): void;
  onCloseZeroTabDupes(): void;
  onCloseAll(): void;
};

function useColumnCount() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(1);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      setCount(width < 560 ? 1 : width < 760 ? 2 : width < 940 ? 3 : 4);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, count };
}

function Masonry({
  groups,
  children,
}: {
  groups: DomainGroup[];
  children(group: DomainGroup): React.ReactNode;
}) {
  const { ref, count } = useColumnCount();
  const columns = useMemo(() => {
    const result = Array.from(
      { length: Math.min(count, Math.max(groups.length, 1)) },
      () => ({ weight: 0, groups: [] as DomainGroup[] }),
    );
    for (const group of groups) {
      const target = result.reduce((shortest, column) =>
        column.weight < shortest.weight ? column : shortest,
      );
      target.groups.push(group);
      target.weight += Math.min(new Set(group.tabs.map((tab) => tab.url)).size, 8) + 3;
    }
    return result;
  }, [count, groups]);

  return (
    <div className="missions react-masonry" ref={ref}>
      {columns.map((column, index) => (
        <div className="masonry-column" key={index}>
          {column.groups.map(children)}
        </div>
      ))}
    </div>
  );
}

function TabChip({
  tab,
  domain,
  duplicateCount,
  onFocus,
  onClose,
  onSave,
}: {
  tab: OpenTab;
  domain: string;
  duplicateCount: number;
  onFocus(): void;
  onClose(origin: DOMRect): void;
  onSave(): void;
}) {
  const title = smartTitle(tab, domain);
  const icon = faviconUrl(tab.url);

  return (
    <div
      className={`page-chip clickable${duplicateCount > 1 ? ' chip-has-dupes' : ''}`}
      role="button"
      tabIndex={0}
      title={title}
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onFocus();
        }
      }}
    >
      {icon && (
        <img
          className="chip-favicon"
          src={icon}
          alt=""
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
      <span className="chip-text">{title}</span>
      {duplicateCount > 1 && (
        <span className="chip-dupe-badge">({duplicateCount}x)</span>
      )}
      {tab.pinned ? (
        <span className="chip-dupe-badge">Pinned</span>
      ) : (
        <span className="chip-actions">
          <button
            className="chip-action chip-save"
            type="button"
            title="Save for later"
            aria-label={`Save ${title} for later`}
            onClick={(event) => {
              event.stopPropagation();
              onSave();
            }}
          >
            <BookmarkIcon />
          </button>
          <button
            className="chip-action chip-close"
            type="button"
            title="Close tab"
            aria-label={`Close ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose(event.currentTarget.getBoundingClientRect());
            }}
          >
            <CloseIcon />
          </button>
        </span>
      )}
    </div>
  );
}

function DomainCard({
  group,
  onFocus,
  onCloseTab,
  onSaveTab,
  onCloseGroup,
  onDeduplicate,
}: {
  group: DomainGroup;
  onFocus(tab: OpenTab): void;
  onCloseTab(tab: OpenTab, origin: DOMRect): void;
  onSaveTab(tab: OpenTab): void;
  onCloseGroup(group: DomainGroup, origin: DOMRect): void;
  onDeduplicate(urls: string[]): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const counts = new Map<string, number>();
  for (const tab of group.tabs) counts.set(tab.url, (counts.get(tab.url) || 0) + 1);
  const seen = new Set<string>();
  const unique = group.tabs.filter((tab) => {
    if (seen.has(tab.url)) return false;
    seen.add(tab.url);
    return true;
  });
  const visible = expanded ? unique : unique.slice(0, 8);
  const duplicates = getRemovableDuplicates(group.tabs);
  const closable = group.tabs.filter((tab) => !tab.pinned).length;
  const name =
    group.domain === '__landing-pages__'
      ? 'Homepages'
      : group.label || friendlyDomain(group.domain);

  return (
    <article
      className={`mission-card domain-card ${
        duplicates.count ? 'has-amber-bar' : 'has-neutral-bar'
      }`}
    >
      <div className="mission-content">
        <div className="mission-top">
          <div className="mission-heading">
            <span className="mission-name">{name}</span>
            <span className="open-tabs-badge">
              {group.tabs.length} tab{group.tabs.length === 1 ? '' : 's'} open
            </span>
            {duplicates.count > 0 && (
              <span className="open-tabs-badge is-duplicate">
                {duplicates.count} duplicate{duplicates.count === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {closable > 0 && (
            <button
              className="card-close-button"
              type="button"
              aria-label={`Close ${closable} tabs from ${name}`}
              onClick={(event) =>
                onCloseGroup(group, event.currentTarget.getBoundingClientRect())
              }
            >
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="mission-pages">
          {visible.map((tab) => (
            <TabChip
              key={tab.id}
              tab={tab}
              domain={group.domain}
              duplicateCount={counts.get(tab.url) || 1}
              onFocus={() => onFocus(tab)}
              onClose={(origin) => onCloseTab(tab, origin)}
              onSave={() => onSaveTab(tab)}
            />
          ))}
          {!expanded && unique.length > 8 && (
            <button
              className="page-chip page-chip-overflow clickable"
              type="button"
              onClick={() => setExpanded(true)}
            >
              <span className="chip-text">+{unique.length - 8} more</span>
            </button>
          )}
        </div>

        <div className="actions">
          {closable === 0 && (
            <span className="open-tabs-badge">Pinned tabs are protected</span>
          )}
          {duplicates.count > 0 && (
            <button
              className="action-btn"
              type="button"
              onClick={() => onDeduplicate(duplicates.urls)}
            >
              Close {duplicates.count} duplicate
              {duplicates.count === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function OpenTabsCard({
  groups,
  tabs,
  zeroTabCount,
  collapsed,
  onToggle,
  onFocus,
  onCloseTab,
  onSaveTab,
  onCloseGroup,
  onDeduplicate,
  onCloseZeroTabDupes,
  onCloseAll,
}: Props) {
  const duplicates = getRemovableDuplicates(tabs);
  const closable = tabs.filter((tab) => !tab.pinned).length;

  return (
    <CardFrame
      title="Open tabs"
      count={`${groups.length} domain${groups.length === 1 ? '' : 's'}`}
      collapsed={collapsed}
      required
      onToggle={onToggle}
      className="open-tabs-card"
      actions={
        <>
          <button
            className="action-btn compact-action duplicate-tabs"
            type="button"
            disabled={!duplicates.count}
            onClick={() => onDeduplicate(duplicates.urls)}
          >
            Close duplicates
          </button>
          {zeroTabCount > 1 && (
            <button
              className="action-btn compact-action zero-tab-duplicates"
              type="button"
              onClick={onCloseZeroTabDupes}
            >
              Close {zeroTabCount - 1} extra Zero Tab
              {zeroTabCount === 2 ? '' : 's'}
            </button>
          )}
          <button
            className="action-btn compact-action close-tabs"
            type="button"
            disabled={!closable}
            onClick={onCloseAll}
          >
            Close {closable} unpinned
          </button>
        </>
      }
    >
      {groups.length ? (
        <Masonry groups={groups}>
          {(group) => (
            <DomainCard
              key={group.key}
              group={group}
              onFocus={onFocus}
              onCloseTab={onCloseTab}
              onSaveTab={onSaveTab}
              onCloseGroup={onCloseGroup}
              onDeduplicate={onDeduplicate}
            />
          )}
        </Masonry>
      ) : (
        <div className="missions-empty-state">
          <div className="empty-title">Inbox zero, but for tabs.</div>
          <div className="empty-subtitle">You're free.</div>
        </div>
      )}
    </CardFrame>
  );
}
