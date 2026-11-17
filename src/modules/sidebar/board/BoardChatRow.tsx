import { useState } from 'react';
import { DoorClosed, Edit2, FolderInput, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { SessionTile } from '@/modules/sidebar/board/SessionTile';
import { chatMarks } from '@/modules/sidebar/utils/simpleChatMarks';
import type { RecentConversationListItem } from '@/shared/types';
import { ActionMenu } from '@/shared/ui';
import { cn } from '@/shared/utils';

type BoardChatRowProps = {
  row: RecentConversationListItem;
  isRunning: boolean;
  /** A question or permission prompt for this chat waits on the reader. */
  isAwaitingInput: boolean;
  /** A subagent from this chat is still running, often after the chat's own turn has ended. */
  isSubagentRunning: boolean;
  /** The chat has no live session host. It stays fully usable: the next message starts a host. */
  isAsleep: boolean;
  isRemoveFailed: boolean;
  /** What sets the chat's project apart from another of the same name; null when its name is its own. */
  projectNameHint: string | null;
  onSelect: () => void;
  /** Close: the chat leaves the board but nothing is deleted. */
  onClose: () => void;
  /** Pin when the chat is not pinned, Unpin when it is. */
  onTogglePin: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  /** The "Move to folder…" entry, or null while the board holds no folder to move this chat into. */
  onMoveToFolder: (() => void) | null;
  t: TFunction;
};

/**
 * ONE CHAT ON THE SESSIONS BOARD: its pin on the folder's thread, its tile (`SessionTile`), its title over its state in words, and its verbs behind one menu.
 * It is the simple list's own row redrawn, with the row's own rules and nothing added: the marks are `chatMarks`'; the press opens the chat (an anchor, so a
 * middle press opens it in a tab of its own); Rename opens the title for typing in place; Pin, Move to folder, Close and Delete permanently are the list's
 * (`SidebarSimpleListRow`). Change icon is not offered: the board draws the tile where the list draws the icon.
 *
 * THE PIN IS A PRESS OF ITS OWN, on the thread: filled, the chat is pinned and stays; hollow, it is not, and closes itself when it falls asleep with
 * nothing for him.
 *
 * QUIET UNTIL POINTED AT. With a pointer that hovers, the state's words and the menu wait for the pointer or the keyboard to reach the row: the tile has
 * already said the state. Under a finger both are always drawn.
 *
 * Used by `BoardFolder`, once per chat of a column.
 */
export function BoardChatRow({
  row, isRunning, isAwaitingInput, isSubagentRunning, isAsleep, isRemoveFailed, projectNameHint,
  onSelect, onClose, onTogglePin, onDelete, onRename, onMoveToFolder, t,
}: BoardChatRowProps) {
  // Whether the title is open for typing: the menu's Rename opens it, Enter or a blur saves, Escape leaves it as it was.
  const [isEditing, setIsEditing] = useState(false);
  // The rename input's live value, seeded from the row's title when editing starts.
  const [draft, setDraft] = useState(row.sessionTitle);
  // The board holds no open chat: every chat on it is out of sight, so a reply not read is always drawn.
  const marks = chatMarks({ unread: row.unread, isSelected: false, isRunning, isAwaitingInput, isSubagentRunning });
  const awake = !isAsleep || marks.running || marks.awaitingInput;

  const startRename = () => {
    setDraft(row.sessionTitle);
    setIsEditing(true);
  };
  const saveRename = () => {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== row.sessionTitle) onRename(trimmed);
  };

  // The state in words, the tile's own order: what it is doing, then what waits beside that.
  const words = [
    marks.awaitingInput ? t('simpleList.awaitingInput') : marks.running ? t('simpleList.running') : awake ? t('board.idle') : t('board.asleep'),
    marks.unread ? t('simpleList.unread') : null,
    marks.subagents ? t('simpleList.subagentsRunning') : null,
  ].filter(Boolean).join(' · ');
  const project = projectNameHint ? `${row.projectDisplayName} · ${projectNameHint}` : row.projectDisplayName;

  return (
    <li
      data-board-row={row.sessionId}
      data-asleep={awake ? undefined : 'true'}
      data-pinned={row.pinned ? 'true' : undefined}
      className="group/row relative flex min-w-0 items-center pl-3.5"
    >
      <button
        type="button"
        data-board-pin
        aria-pressed={row.pinned}
        aria-label={`${row.sessionTitle}: ${row.pinned ? t('simpleList.unpin') : t('simpleList.pin')}`}
        title={row.pinned ? t('simpleList.pinned') : t('simpleList.pin')}
        onClick={onTogglePin}
        className="group/pin absolute -left-[13px] top-1/2 grid h-11 w-[26px] -translate-y-1/2 place-items-center"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-[7px] rounded-full border-[1.25px] border-muted-foreground transition-transform group-hover/pin:scale-150 group-hover/pin:border-foreground',
            row.pinned ? 'bg-muted-foreground group-hover/pin:bg-foreground' : 'bg-background',
          )}
        />
      </button>

      {isEditing ? (
        <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-1 pr-1.5">
          <SessionTile marks={marks} isAsleep={isAsleep} />
          <input
            type="text"
            value={draft}
            data-board-rename
            placeholder={t('simpleList.renamePlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={saveRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveRename();
              else if (event.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      ) : (
        <a
          href={`/session/${row.sessionId}`}
          draggable={false}
          title={project}
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-1 pr-1.5 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring"
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSelect();
          }}
        >
          <SessionTile marks={marks} isAsleep={isAsleep} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                'truncate text-sm leading-[18px] transition-transform [@media(hover:hover)]:translate-y-2 [@media(hover:hover)]:group-focus-within/row:translate-y-0 [@media(hover:hover)]:group-hover/row:translate-y-0',
                marks.awaitingInput ? 'text-accent-ink' : marks.unread ? 'text-foreground' : awake ? 'text-secondary-foreground' : 'text-muted-foreground',
              )}
            >
              {row.sessionTitle}
            </span>
            <span
              data-board-words
              className={cn(
                'truncate font-mono text-[10px] uppercase leading-[14px] tracking-[0.04em] text-muted-foreground transition-opacity',
                '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:group-hover/row:opacity-100',
                isRemoveFailed && 'text-destructive !opacity-100',
              )}
            >
              {isRemoveFailed ? t('simpleList.removeFailed') : words}
            </span>
          </span>
        </a>
      )}

      {!isEditing && (
        <div className="flex-none transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 [&:has([aria-expanded=true])]:opacity-100 [@media(hover:hover)]:opacity-0">
          <ActionMenu
            label="Chat options"
            ariaLabel={`Chat options for ${row.sessionTitle}`}
            icon={MoreHorizontal}
            iconOnly
            variant="ghost"
            size="icon"
            triggerClassName="h-7 w-7 flex-shrink-0 text-muted-foreground finger:h-11 finger:w-11"
            items={[
              { key: 'board-chat-rename', label: t('simpleList.rename'), icon: Edit2, onSelect: startRename },
              { key: 'board-chat-pin', label: row.pinned ? t('simpleList.unpin') : t('simpleList.pin'), icon: row.pinned ? PinOff : Pin, onSelect: onTogglePin },
              ...(onMoveToFolder === null ? [] : [{ key: 'board-chat-move', label: t('simpleList.moveToFolder'), icon: FolderInput, onSelect: onMoveToFolder }]),
              // Two entries, as on the list: Close keeps the transcript and can be undone from the Closed list, Delete takes it off disk.
              { key: 'board-chat-close', label: t('simpleList.close', { defaultValue: 'Close' }), icon: DoorClosed, showDividerBefore: true, onSelect: onClose },
              { key: 'board-chat-delete', label: t('simpleList.delete', { defaultValue: 'Delete permanently' }), icon: Trash2, isDanger: true, onSelect: onDelete },
            ]}
          />
        </div>
      )}
    </li>
  );
}
