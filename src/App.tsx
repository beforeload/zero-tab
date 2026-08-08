import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DomainGroup,
  OpenTab,
  SavedItem,
  WorkstationLayout,
} from './types';
import {
  closeDuplicateTabs,
  closeTabsByIds,
  closeZeroTabDupes,
  fetchOpenTabs,
  focusTab,
  getRealTabs,
  groupTabs,
} from './services/tabs';
import {
  completeSavedTab,
  dismissSavedTab,
  getSavedTabs,
  saveTabForLater,
} from './services/saved';
import { DEFAULT_LAYOUT, getLayout, saveLayout } from './services/layout';
import { playCloseSound, shootConfetti } from './services/effects';
import { BuilderDigestDrawer } from './components/BuilderDigestDrawer';
import { DailyHoroscopeCard } from './components/DailyHoroscopeCard';
import { OpenTabsCard } from './components/OpenTabsCard';
import { SavedForLaterCard } from './components/SavedForLaterCard';
import { CloseIcon, SettingsIcon, SparklesIcon } from './components/Icons';
import { BUILT_IN_CARDS, type CardId } from './cards/registry';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function dateDisplay(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function App() {
  const [allTabs, setAllTabs] = useState<OpenTab[]>([]);
  const [activeSaved, setActiveSaved] = useState<SavedItem[]>([]);
  const [archivedSaved, setArchivedSaved] = useState<SavedItem[]>([]);
  const [layout, setLayout] = useState<WorkstationLayout>(DEFAULT_LAYOUT);
  const [digestOpen, setDigestOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2500);
  }, []);

  const loadTabs = useCallback(async () => {
    try {
      setAllTabs(await fetchOpenTabs());
    } catch (error) {
      console.warn('[zero-tab] Could not load tabs:', error);
      setAllTabs([]);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const saved = await getSavedTabs();
      setActiveSaved(saved.active);
      setArchivedSaved(saved.archived);
    } catch (error) {
      console.warn('[zero-tab] Could not load saved tabs:', error);
      setActiveSaved([]);
      setArchivedSaved([]);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      loadTabs(),
      loadSaved(),
      getLayout().then(setLayout),
    ]);
    return () => window.clearTimeout(toastTimer.current);
  }, [loadSaved, loadTabs]);

  const updateLayout = useCallback(
    (updater: (current: WorkstationLayout) => WorkstationLayout) => {
      setLayout((current) => {
        const next = updater(current);
        void saveLayout(next);
        return next;
      });
    },
    [],
  );

  const realTabs = useMemo(() => getRealTabs(allTabs), [allTabs]);
  const groups = useMemo<DomainGroup[]>(() => groupTabs(realTabs), [realTabs]);
  const zeroTabCount = allTabs.filter((tab) => tab.isZeroTab).length;
  const hasSavedItems = activeSaved.length > 0 || archivedSaved.length > 0;
  const sidebarVisible =
    layout.cards.dailyHoroscope.visible ||
    (layout.cards.savedForLater.visible && hasSavedItems);

  const handleCloseTab = async (tab: OpenTab, origin: DOMRect) => {
    shootConfetti(origin.left + origin.width / 2, origin.top + origin.height / 2);
    const closed = await closeTabsByIds([tab.id]);
    if (closed) playCloseSound();
    await loadTabs();
    showToast(closed ? 'Tab closed' : 'The pinned tab was kept open');
  };

  const handleSaveTab = async (tab: OpenTab) => {
    try {
      await saveTabForLater({ url: tab.url, title: tab.title || tab.url });
      await closeTabsByIds([tab.id]);
      await Promise.all([loadTabs(), loadSaved()]);
      showToast('Saved for later');
    } catch (error) {
      console.warn('[zero-tab] Could not save tab:', error);
      showToast('Failed to save tab');
    }
  };

  const handleCloseGroup = async (group: DomainGroup, origin: DOMRect) => {
    const ids = group.tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
    const closed = await closeTabsByIds(ids);
    if (closed) {
      playCloseSound();
      shootConfetti(
        origin.left + origin.width / 2,
        origin.top + origin.height / 2,
      );
    }
    await loadTabs();
    showToast(`Closed ${closed} tab${closed === 1 ? '' : 's'}`);
  };

  const handleDeduplicate = async (urls: string[]) => {
    if (!urls.length) {
      showToast('No duplicate tabs to close');
      return;
    }
    const closed = await closeDuplicateTabs(urls);
    if (closed) playCloseSound();
    await loadTabs();
    showToast(`Closed ${closed} duplicate tab${closed === 1 ? '' : 's'}`);
  };

  const handleCloseAll = async () => {
    const closed = await closeTabsByIds(
      realTabs.filter((tab) => !tab.pinned).map((tab) => tab.id),
    );
    if (closed) playCloseSound();
    await loadTabs();
    showToast('All unpinned tabs closed. Fresh start.');
  };

  const handleZeroTabDupes = async () => {
    const closed = await closeZeroTabDupes();
    if (closed) playCloseSound();
    await loadTabs();
    showToast(
      closed
        ? 'Closed extra Zero Tab pages'
        : 'Pinned Zero Tab pages were kept open',
    );
  };

  const resetCards = () => {
    updateLayout(() => DEFAULT_LAYOUT);
    showToast('Card layout restored');
  };
  const closeDigest = useCallback(() => setDigestOpen(false), []);
  const cardVisible = (cardId: CardId) => {
    if (cardId === 'openTabs') return true;
    return layout.cards[cardId].visible;
  };
  const toggleCardVisibility = (cardId: CardId, visible: boolean) => {
    if (cardId === 'openTabs') return;
    updateLayout((current) => ({
      ...current,
      cards: {
        ...current.cards,
        [cardId]: {
          ...current.cards[cardId],
          visible,
        },
      },
    }));
  };

  return (
    <>
      <div className="container workstation">
        <header className="workstation-header">
          <div className="header-left">
            <h1>{greeting()}</h1>
            <div className="date">{dateDisplay()}</div>
          </div>
          <div className="header-controls">
            <div className="header-stats">
              <div className="stat">
                <div className="stat-num">{realTabs.length}</div>
                <div className="stat-label">Open tabs</div>
              </div>
            </div>
            <div className="header-action-wrap">
              <button
                className="header-action"
                type="button"
                aria-expanded={managerOpen}
                onClick={() => setManagerOpen((value) => !value)}
              >
                <SettingsIcon />
                Manage cards
              </button>
              {managerOpen && (
                <div className="card-manager" role="dialog" aria-label="Manage cards">
                  <div className="card-manager-header">
                    <strong>Manage cards</strong>
                    <button
                      type="button"
                      aria-label="Close card manager"
                      onClick={() => setManagerOpen(false)}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  {BUILT_IN_CARDS.map((card) => (
                    <label key={card.id}>
                      <span>
                        <strong>{card.title}</strong>
                        <small>{card.description}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={cardVisible(card.id)}
                        disabled={card.required}
                        onChange={(event) =>
                          toggleCardVisibility(card.id, event.target.checked)
                        }
                      />
                    </label>
                  ))}
                  <button className="card-manager-reset" type="button" onClick={resetCards}>
                    Restore defaults
                  </button>
                </div>
              )}
            </div>
            <button
              className="header-action ai-brief-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={digestOpen}
              onClick={() => setDigestOpen(true)}
            >
              <SparklesIcon />
              AI Brief
            </button>
          </div>
        </header>

        <main
          className={`workstation-grid${
            sidebarVisible ? ' has-sidebar' : ''
          }`}
        >
          <OpenTabsCard
            groups={groups}
            tabs={realTabs}
            zeroTabCount={zeroTabCount}
            collapsed={layout.cards.openTabs.collapsed}
            onToggle={() =>
              updateLayout((current) => ({
                ...current,
                cards: {
                  ...current.cards,
                  openTabs: {
                    collapsed: !current.cards.openTabs.collapsed,
                  },
                },
              }))
            }
            onFocus={(tab) => void focusTab(tab.id)}
            onCloseTab={(tab, origin) => void handleCloseTab(tab, origin)}
            onSaveTab={(tab) => void handleSaveTab(tab)}
            onCloseGroup={(group, origin) =>
              void handleCloseGroup(group, origin)
            }
            onDeduplicate={(urls) => void handleDeduplicate(urls)}
            onCloseZeroTabDupes={() => void handleZeroTabDupes()}
            onCloseAll={() => void handleCloseAll()}
          />

          {sidebarVisible && (
            <aside className="workstation-sidebar">
              {layout.cards.savedForLater.visible && hasSavedItems && (
                <SavedForLaterCard
                  active={activeSaved}
                  archived={archivedSaved}
                  collapsed={layout.cards.savedForLater.collapsed}
                  onToggle={() =>
                    updateLayout((current) => ({
                      ...current,
                      cards: {
                        ...current.cards,
                        savedForLater: {
                          ...current.cards.savedForLater,
                          collapsed: !current.cards.savedForLater.collapsed,
                        },
                      },
                    }))
                  }
                  onHide={() =>
                    updateLayout((current) => ({
                      ...current,
                      cards: {
                        ...current.cards,
                        savedForLater: {
                          ...current.cards.savedForLater,
                          visible: false,
                        },
                      },
                    }))
                  }
                  onComplete={(id) =>
                    void completeSavedTab(id).then(loadSaved)
                  }
                  onDismiss={(id) =>
                    void dismissSavedTab(id).then(loadSaved)
                  }
                />
              )}

              {layout.cards.dailyHoroscope.visible && (
                <DailyHoroscopeCard
                  collapsed={layout.cards.dailyHoroscope.collapsed}
                  onToggle={() =>
                    updateLayout((current) => ({
                      ...current,
                      cards: {
                        ...current.cards,
                        dailyHoroscope: {
                          ...current.cards.dailyHoroscope,
                          collapsed: !current.cards.dailyHoroscope.collapsed,
                        },
                      },
                    }))
                  }
                  onHide={() =>
                    updateLayout((current) => ({
                      ...current,
                      cards: {
                        ...current.cards,
                        dailyHoroscope: {
                          ...current.cards.dailyHoroscope,
                          visible: false,
                        },
                      },
                    }))
                  }
                />
              )}
            </aside>
          )}
        </main>
      </div>

      <BuilderDigestDrawer
        open={digestOpen}
        onClose={closeDigest}
        onToast={showToast}
      />

      <div className={`toast${toast ? ' visible' : ''}`} role="status" aria-live="polite">
        <span>{toast}</span>
      </div>
    </>
  );
}
