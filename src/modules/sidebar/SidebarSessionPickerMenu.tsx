import { useId } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Banner } from '@/shared/ui';
import type { SessionPickerGroup, SessionPickerRow, SessionPickerStatus } from '@/shared/types';
import SidebarSessionPickerPopover from '@/modules/sidebar/SidebarSessionPickerPopover';
import SidebarSessionPickerRow from '@/modules/sidebar/SidebarSessionPickerRow';

// File-local: this shape is read only here; SidebarSessionPicker is its one caller.
type SidebarSessionPickerMenuProps = {
  /** The open conversation's name, by the sidebar's own rule. */
  name: string;
  /** The open conversation's project; null when none is selected. */
  projectName: string | null;
  groups: SessionPickerGroup[];
  status: SessionPickerStatus;
  currentSessionId: string | null;
  /** The simple list holds more rows than the page drawn; false in the tree, which is listed whole. */
  hasMore: boolean;
  onPick: (row: SessionPickerRow) => void;
  onNewChat: () => void;
  /** Asks the simple list for its next page. */
  onLoadMore: () => void;
};

/**
 * Used by SidebarSessionPicker: the picker as it is drawn, with every fact arriving as a prop — the
 * trigger, the panel, New chat, and the list in whichever of the sidebar's two shapes it was given.
 *
 * THE TRIGGER answers "which conversation is this?" in two lines the sidebar's rows already use:
 * the name at 13px, the project under it at 10px in the muted ink. Both truncate, so it fits a
 * 340px header slot and shrinks to a 326px one; the chevron is the only thing that never gives way.
 *
 * THE PANEL puts New chat first and pins it, so the way to start something is always in reach of a
 * list that scrolls. Then the list: the simple list is one block of rows that each name their
 * project; the tree is one block per project, headed by the project's name (which sticks while its
 * rows scroll under it), each project's conversations newest first. A project with none says so under
 * its heading instead of vanishing, because a project that is missing from a list reads as a
 * project that is not there. Loading is placeholders, a failed list is one amber line (the mark is
 * not decoration: it is what makes it read without the colour), and an empty list points at New chat.
 * A simple list with more than its first page ends in "Show more" (the sidebar's own row and word),
 * which asks for the next page and leaves the panel open. The panel's mechanics are
 * SidebarSessionPickerPopover's.
 */
export default function SidebarSessionPickerMenu({
  name,
  projectName,
  groups,
  status,
  currentSessionId,
  hasMore,
  onPick,
  onNewChat,
  onLoadMore,
}: SidebarSessionPickerMenuProps) {
  const { t } = useTranslation('sidebar');
  const headingIdPrefix = useId();
  const hasRows = groups.some((group) => group.rows.length > 0);
  // No projects at all, or the simple list with nothing in it: there is nothing to list, and no heading to hang an empty line on.
  const isBare = groups.length === 0 || (groups.length === 1 && groups[0].heading === null && !hasRows);

  return (
    <SidebarSessionPickerPopover
      triggerTitle={`${name} — ${t('chatHost.pickerTitle', { ns: 'common' })}`}
      label={t('chatHost.pickerList', { ns: 'common' })}
      trigger={(
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium leading-4 text-foreground">{name}</span>
          {projectName && (
            <span className="block truncate text-[10px] leading-3 text-muted-foreground">{projectName}</span>
          )}
        </span>
      )}
      pinned={(
        <button
          type="button"
          data-picker-item=""
          data-testid="session-picker-new"
          onClick={onNewChat}
          className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-dashed border-border/70 px-2 text-left text-[13px] text-muted-foreground transition-colors hover:border-border hover:bg-accent/60 hover:text-foreground [@media(pointer:coarse)]:min-h-11"
        >
          <Plus aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{t('simpleList.newChat')}</span>
        </button>
      )}
    >
      {status === 'loading' && (
        <div role="status" aria-label={t('chatHost.pickerLoading', { ns: 'common' })} className="flex flex-col gap-1 py-1">
          <div className="vv-skeleton h-8 rounded-lg" />
          <div className="vv-skeleton h-8 rounded-lg" />
          <div className="vv-skeleton h-8 rounded-lg" />
        </div>
      )}

      {status === 'error' && (
        <div className="pt-1">
          <Banner tone="warn">{t('chatHost.pickerError', { ns: 'common' })}</Banner>
        </div>
      )}

      {status === 'ready' && isBare && (
        <p data-testid="session-picker-empty" className="px-2 py-4 text-center text-[13px] text-muted-foreground">
          {t('chatHost.pickerEmpty', { ns: 'common' })}
        </p>
      )}

      {status === 'ready' && !isBare && groups.map((group, index) => {
        const headingId = `${headingIdPrefix}-${index}`;
        return (
          <div
            key={group.key}
            role="group"
            aria-labelledby={group.heading === null ? undefined : headingId}
            data-testid={group.heading === null ? 'session-picker-flat' : 'session-picker-project'}
            className="flex flex-col gap-0.5"
          >
            {group.heading !== null && (
              // Sticks to the top of the scrolling list, so a long block never loses its name; the
              // panel's own ground under it keeps the rows that pass beneath from showing through.
              <div
                id={headingId}
                className="sticky top-0 z-[1] flex items-center gap-1.5 bg-card px-2 pb-1 pt-2.5 text-[11px] font-medium text-muted-foreground"
              >
                <FolderOpen aria-hidden="true" className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{group.heading}</span>
              </div>
            )}
            {group.heading !== null && group.rows.length === 0 && (
              <p data-testid="session-picker-project-empty" className="px-2 pb-1.5 pl-[26px] text-[11px] text-muted-foreground">
                {t('projects.noConversations')}
              </p>
            )}
            {group.rows.map((row) => (
              <SidebarSessionPickerRow
                key={row.sessionId}
                row={row}
                standalone={group.heading === null}
                isCurrent={row.sessionId === currentSessionId}
                onPick={() => onPick(row)}
              />
            ))}
          </div>
        );
      })}

      {status === 'ready' && !isBare && hasMore && (
        <button
          type="button"
          // Asks for more and stays: the panel would otherwise close on the press and lose the reader's place.
          data-picker-item=""
          data-keeps-open=""
          data-testid="session-picker-load-more"
          onClick={onLoadMore}
          className="mt-1 flex h-8 w-full min-w-0 items-center justify-center rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground [@media(pointer:coarse)]:min-h-11"
        >
          <span className="truncate">{t('simpleList.loadMore')}</span>
        </button>
      )}
    </SidebarSessionPickerPopover>
  );
}
