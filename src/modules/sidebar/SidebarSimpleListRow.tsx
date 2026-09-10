import { useState } from 'react';
import { Edit2, EyeOff, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { RecentConversationListItem } from '@/shared/types';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

// File-local: read only by SidebarSimpleList, which renders one of these per row.
type SidebarSimpleListRowProps = {
  row: RecentConversationListItem;
  isSelected: boolean;
  isRunning: boolean;
  isRemoveFailed: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  t: TFunction;
};

/** One row of SidebarSimpleList: title, project, a running spinner, and Rename/Archive/Delete behind one ActionMenu. */
export default function SidebarSimpleListRow({
  row,
  isSelected,
  isRunning,
  isRemoveFailed,
  onSelect,
  onArchive,
  onDelete,
  onRename,
  t,
}: SidebarSimpleListRowProps) {
  const isCompact = useCompactSidebar();
  // Whether the inline rename input is open for this row.
  const [isEditing, setIsEditing] = useState(false);
  // The rename input's live value, seeded from the row's title when editing starts.
  const [draft, setDraft] = useState(row.sessionTitle);

  const startRename = () => {
    setDraft(row.sessionTitle);
    setIsEditing(true);
  };

  const saveRename = () => {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== row.sessionTitle) {
      onRename(trimmed);
    }
  };

  return (
    <div
      data-testid="simple-chat-row"
      data-session-id={row.sessionId}
      className={cn(
        'group relative flex min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors',
        // No `py-2` in compact mode: the anchor below reaches 44px by stretching to fill this
        // row's own content box, so vertical padding here would eat directly into that box and
        // force the row taller than its own 44px floor to compensate (measured live: 60px).
        // Desktop is unaffected — it never carries the compact height floor at all.
        isCompact ? 'min-h-11' : 'py-2',
        isSelected ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-accent/60',
      )}
    >
      {isEditing ? (
        <input
          type="text"
          value={draft}
          data-testid="simple-chat-rename-input"
          placeholder={t('simpleList.renamePlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveRename();
            else if (event.key === 'Escape') setIsEditing(false);
          }}
          autoFocus
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      ) : (
        <a
          href={`/session/${row.sessionId}`}
          // `self-stretch` fills the row div's CONTENT box, which in compact mode is now exactly
          // the row's own 44px floor (no padding above to shrink it) — `flex flex-col
          // justify-center` keeps the two text lines centred inside that. Measured against the
          // live DOM, not just grepped for a class name.
          className={cn('min-w-0 flex-1', isCompact && 'self-stretch flex flex-col justify-center')}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSelect();
          }}
        >
          <span className="block truncate text-[13px] font-normal leading-4">{row.sessionTitle}</span>
          <span className="mt-0.5 block truncate text-[10px] leading-3 text-muted-foreground">
            {row.projectDisplayName}
          </span>
          {isRemoveFailed && (
            <span className="mt-0.5 block truncate text-[10px] leading-3 text-destructive">
              {t('simpleList.removeFailed')}
            </span>
          )}
        </a>
      )}

      {isRunning && !isEditing && (
        <Tooltip content={t('simpleList.running')} position="top">
          <span
            data-testid="simple-chat-running"
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        </Tooltip>
      )}

      {!isEditing && (
        <div data-testid="simple-chat-menu">
          <ActionMenu
            label="Chat options"
            ariaLabel={`Chat options for ${row.sessionTitle}`}
            icon={MoreHorizontal}
            iconOnly
            portal
            variant="ghost"
            size="icon"
            triggerClassName="h-7 w-7 flex-shrink-0 text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100"
            items={[
              {
                key: 'simple-chat-rename',
                label: t('simpleList.rename'),
                icon: Edit2,
                onSelect: startRename,
              },
              // Two entries where there was one "Remove", because they are two different
              // outcomes: archive keeps the transcript and can be undone from the archive
              // list, delete takes it off disk. Only the second is painted as danger.
              {
                key: 'simple-chat-archive',
                label: t('simpleList.archive', { defaultValue: 'Archive' }),
                icon: EyeOff,
                showDividerBefore: true,
                onSelect: onArchive,
              },
              {
                key: 'simple-chat-delete',
                label: t('simpleList.delete', { defaultValue: 'Delete permanently' }),
                icon: Trash2,
                isDanger: true,
                onSelect: onDelete,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
