import { FolderPlus, PanelLeftClose, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';

import { Button, Chip, Input } from '@/shared/ui';
import { IS_PLATFORM } from '@/shared/utils';
import type { SidebarSearchMode } from '@/shared/types';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  runningSessionsCount: number;
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  /** True while SidebarContent is rendering the simple chat list in place of the tree. */
  simpleMode?: boolean;
  /** The workspace tab strip, rendered under the wordmark. A slot: this file never imports it. */
  tabs?: ReactNode;
  t: TFunction;
};

/** Module-level, not a nested render function, so the wordmark is not remounted on every SidebarHeader render. */
function LogoBlock({ t }: { t: TFunction }) {
  return (
    <div className="flex min-w-0 items-center">
      {/* `text-accent-ink`, not `text-primary`: the accent FILL reads at 2.55:1 as text, and
          the house rule is that a green WORD takes the ink and a green SHAPE takes the fill
          (tailwind.config.js). */}
      <h1 className="truncate font-serif text-[26px] leading-[1.1] text-accent-ink">
        {t('app.title')}
      </h1>
    </div>
  );
}

/**
 * The four things the search box can be pointed at, as one row of chips.
 *
 * Module-private and rendered twice (the desktop and mobile headers are separate blocks with
 * different paddings), so the four labels, their `aria-pressed` state and the running count are
 * spelled once. The Running chip shows a count only when the app has one to show: the sidebar
 * already computes `runningSessionsCount`, and a chip captioned "· 0" claims a fact the row
 * below it contradicts.
 */
function SearchModeChips({
  searchMode,
  onSearchModeChange,
  runningSessionsCount,
  t,
}: Pick<SidebarHeaderProps, 'searchMode' | 'onSearchModeChange' | 'runningSessionsCount' | 't'>) {
  const runningCount = runningSessionsCount > 99 ? '99+' : String(runningSessionsCount);
  const runningLabel = runningSessionsCount > 0
    ? `${t('search.modeRunning')} · ${runningCount}`
    : t('search.modeRunning');

  return (
    // Wraps rather than scrolling sideways: four chips do not fit a 288px rail, and a chip half
    // off the edge with no scrollbar reads as a broken row rather than as more to come.
    <div className="flex flex-wrap gap-1.5">
      <Chip size="sm" selected={searchMode === 'projects'} onClick={() => onSearchModeChange('projects')}>
        {t('search.modeProjects')}
      </Chip>
      <Chip size="sm" selected={searchMode === 'conversations'} onClick={() => onSearchModeChange('conversations')}>
        {t('search.modeConversations')}
      </Chip>
      <Chip size="sm" selected={searchMode === 'running'} onClick={() => onSearchModeChange('running')}>
        {runningLabel}
      </Chip>
      <Chip size="sm" selected={searchMode === 'archived'} onClick={() => onSearchModeChange('archived')}>
        {t('search.modeArchived')}
      </Chip>
    </div>
  );
}

/** Rendered by SidebarContent at the top of the panel for the search box, search-mode chips, refresh and new-project actions. */
export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  runningSessionsCount,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  simpleMode,
  tabs,
  t,
}: SidebarHeaderProps) {
  // This file draws its desktop and mobile headers as two blocks and hides one with CSS, so a
  // slot placed in both would put TWO live tablists on the page — a duplicate accessible name and
  // a second strip for anything that addresses tabs by role. The strip is rendered into whichever
  // block is actually on screen, and once.
  const isCompact = useCompactSidebar();
  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading && !simpleMode;
  const searchPlaceholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder')
      : searchMode === 'running'
        ? t('search.runningPlaceholder')
        : t('projects.searchPlaceholder');

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden px-3 pb-2 pt-3 md:block"
        style={{}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock t={t} />
            </a>
          ) : (
            <LogoBlock t={t} />
          )}

          <div className="flex flex-shrink-0 items-center gap-1">
            <Button
              variant="tonal"
              size="sm"
              className="h-[30px] w-[30px] rounded-lg p-0"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-[30px] w-[30px] rounded-lg p-0 text-muted-foreground hover:text-foreground"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-[30px] w-[30px] rounded-lg p-0 text-muted-foreground hover:text-foreground"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {tabs && !isCompact && <div className="mt-2.5">{tabs}</div>}

        {/* Search bar */}
        {showSearchTools && (
          <div className="mt-2.5 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="h-11 pl-9 pr-14"
              />
              {searchFilter ? (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              ) : (
                <kbd
                  aria-hidden
                  title={t('tooltips.openCommandPalette')}
                  className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-flex"
                >
                  {MOD_KEY}
                  <span>K</span>
                </kbd>
              )}
            </div>
            <SearchModeChips
              searchMode={searchMode}
              onSearchModeChange={onSearchModeChange}
              runningSessionsCount={runningSessionsCount}
              t={t}
            />
          </div>
        )}
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity active:opacity-70"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock t={t} />
            </a>
          ) : (
            <LogoBlock t={t} />
          )}

          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all active:scale-95"
              onClick={onCreateProject}
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {tabs && isCompact && <div className="mt-2.5">{tabs}</div>}

        {/* Mobile search */}
        {showSearchTools && (
          <div className="mt-2.5 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="h-11 pl-10 pr-9"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
            <SearchModeChips
              searchMode={searchMode}
              onSearchModeChange={onSearchModeChange}
              runningSessionsCount={runningSessionsCount}
              t={t}
            />
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
