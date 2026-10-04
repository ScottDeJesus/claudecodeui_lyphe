import { useState } from 'react';
import type { HTMLAttributes } from 'react';
import { Edit2, EyeOff, FolderInput, Loader2, MoreHorizontal, Smile, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { RecentConversationListItem } from '@/shared/types';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';
import { SimpleChatIconGlyph } from '@/modules/sidebar/SidebarSessionIcon';
import { chatMarks } from '@/modules/sidebar/utils/simpleChatMarks';

// File-local: read only by SidebarSimpleList, which renders one of these per row.
type SidebarSimpleListRowProps = {
  row: RecentConversationListItem;
  isSelected: boolean;
  isRunning: boolean;
  /**
   * A question or permission prompt for this chat waits on the user: drawn as a yellow dot in place
   * of the spinner, and on its own when the chat has no run left to spin — a question outlives the
   * turn that asked it.
   */
  isAwaitingInput: boolean;
  /**
   * A subagent from this chat is still running — often after the chat's own turn has ended. Drawn
   * as a purple dot BESIDE whichever mark above applies, never instead of one.
   */
  isSubagentRunning: boolean;
  isRemoveFailed: boolean;
  // One step in, under the folder this chat sits in: indented, and marked `data-nested`.
  isNested: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onChooseIcon: () => void;
  // The "Move to folder…" entry, or null while the list holds no folder to move this chat into.
  onMoveToFolder: (() => void) | null;
  // The pointer handlers that pick this row up; null when the list offers no reorder.
  dragProps: Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'> | null;
  // True while this very row is the one being carried: it fades so the drop line reads.
  isDragging: boolean;
  // Which edge of this row the carried row would land on, or null when it is not the target.
  dropEdge: 'before' | 'after' | null;
  t: TFunction;
};

/** One row of SidebarSimpleList: its icon, title, project, a running spinner or unread dot, and Rename/Change icon/Archive/Delete behind one ActionMenu. */
export default function SidebarSimpleListRow({
  row,
  isSelected,
  isRunning,
  isAwaitingInput,
  isSubagentRunning,
  isRemoveFailed,
  isNested,
  onSelect,
  onArchive,
  onDelete,
  onRename,
  onChooseIcon,
  onMoveToFolder,
  dragProps,
  isDragging,
  dropEdge,
  t,
}: SidebarSimpleListRowProps) {
  const isCompact = useCompactSidebar();
  // Whether the inline rename input is open for this row.
  const [isEditing, setIsEditing] = useState(false);
  // The rename input's live value, seeded from the row's title when editing starts.
  const [draft, setDraft] = useState(row.sessionTitle);
  // Which of the four marks this chat draws, from the row's own facts — the same rule the session
  // picker's rows read, so the two rows cannot disagree. Editing hides all four below.
  const marks = chatMarks({
    unread: row.unread,
    isSelected,
    isRunning,
    isAwaitingInput,
    isSubagentRunning,
  });

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
      {...(dragProps ?? {})}
      data-testid="simple-chat-row"
      data-session-id={row.sessionId}
      data-dragging={isDragging ? 'true' : 'false'}
      data-drop-edge={dropEdge ?? undefined}
      // Present only on a row that sits inside a folder, so `[data-nested]` finds exactly those.
      data-nested={isNested ? 'true' : undefined}
      className={cn(
        'group relative flex min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors',
        // ONE STEP IN, and the step is this row's own icon box plus its gap (`w-6` + `gap-2` = 32px),
        // so a nested row's GLYPH starts in the folder header's chevron column and its title starts
        // 13px past the folder's own name. Measured, not guessed: at 16px the title landed 3px LEFT
        // of the folder's name — a near-miss that reads as a mistake — and the glyph sat between the
        // header's glyph and its chevron, three columns crowded into one 54px band.
        isNested && 'ml-8',
        // No `py-2` in compact mode: the anchor below reaches 44px by stretching to fill this
        // row's own content box, so vertical padding here would eat directly into that box and
        // force the row taller than its own 44px floor to compensate (measured live: 60px).
        // Desktop is unaffected — it never carries the compact height floor at all.
        isCompact ? 'min-h-11' : 'py-2',
        isSelected ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-accent/60',
        isDragging && 'opacity-50',
      )}
    >
      <span
        data-testid="simple-chat-icon"
        data-drag-handle
        data-icon={row.icon ?? 'default'}
        title={t('simpleList.dragHandle')}
        className="flex h-7 w-6 flex-shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground"
      >
        <SimpleChatIconGlyph icon={row.icon} className="h-4 w-4" />
      </span>

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
          // The browser's own link drag would fight the pointer reorder the row carries.
          draggable={false}
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

      {marks.awaitingInput && !isEditing && (
        <Tooltip content={t('simpleList.awaitingInput')} position="top">
          <span
            data-testid="simple-chat-awaiting-input"
            role="status"
            aria-label={t('simpleList.awaitingInput')}
            className="vv-pulse flex h-5 w-5 flex-shrink-0 items-center justify-center"
          >
            {/* The same 8px disc as the unread dot beside it, in the warning ink. */}
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warn-ink" />
          </span>
        </Tooltip>
      )}

      {marks.running && !isEditing && (
        <Tooltip content={t('simpleList.running')} position="top">
          <span
            data-testid="simple-chat-running"
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        </Tooltip>
      )}

      {marks.subagents && !isEditing && (
        <Tooltip content={t('simpleList.subagentsRunning')} position="top">
          <span
            data-testid="simple-chat-subagents-running"
            role="status"
            aria-label={t('simpleList.subagentsRunning')}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center"
          >
            {/* The pinned strip's own running mark, in its own ink. */}
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
          </span>
        </Tooltip>
      )}

      {marks.unread && !isEditing && (
        <span
          data-testid="simple-chat-unread"
          role="img"
          aria-label={t('simpleList.unread')}
          title={t('simpleList.unread')}
          className="mx-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary"
        />
      )}

      {!isEditing && (
        <div data-testid="simple-chat-menu">
          <ActionMenu
            label="Chat options"
            ariaLabel={`Chat options for ${row.sessionTitle}`}
            icon={MoreHorizontal}
            iconOnly
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
              {
                key: 'simple-chat-icon',
                label: t('simpleList.changeIcon'),
                icon: Smile,
                onSelect: onChooseIcon,
              },
              // Only when the list holds a folder to move into: the entry sits between Change icon
              // and Archive, and the divider below stays with Archive.
              ...(onMoveToFolder === null
                ? []
                : [{
                  key: 'simple-chat-move-to-folder',
                  label: t('simpleList.moveToFolder'),
                  icon: FolderInput,
                  onSelect: onMoveToFolder,
                }]),
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

      {/* Where the carried row lands. It ignores the pointer, so the row under it stays the
          target it marks. */}
      {dropEdge && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary',
            dropEdge === 'before' ? 'top-0' : 'bottom-0',
          )}
        />
      )}
    </div>
  );
}
