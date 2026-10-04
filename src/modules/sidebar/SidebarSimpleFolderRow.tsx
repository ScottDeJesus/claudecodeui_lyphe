import { useEffect, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';
import { Edit2, Folder, MoreHorizontal, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, FoldChevron } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { SimpleChatMark, SimpleListFolder } from '@/shared/types';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

// File-local: read only by SidebarSimpleListItems, which draws one of these per folder.
type SidebarSimpleFolderRowProps = {
  folder: SimpleListFolder;
  /** The one dot: the most pressing mark among the folder's chats, or null. */
  dot: SimpleChatMark | null;
  /** The open chat is one of this folder's and the folder is folded. */
  holdsSelected: boolean;
  /** Just made: the name opens for typing and the row scrolls into view, once. */
  isFresh: boolean;
  onFreshShown: () => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  dragProps: Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'> | null;
  isDragging: boolean;
  /** A carried chat would land before this folder, at the top level. */
  dropEdge: 'before' | null;
  /** A carried chat would land inside this folder. */
  isDropInto: boolean;
  t: TFunction;
};

/** The word each mark wears on the folder's one dot, as its label and its title. */
const DOT_WORDS: Record<SimpleChatMark, string> = {
  awaitingInput: 'simpleList.awaitingInput',
  unread: 'simpleList.unread',
  running: 'simpleList.running',
  subagents: 'simpleList.subagentsRunning',
};

/** The ink the dot's disc wears, by mark: the four inks the chat row's own marks wear. */
const DOT_INK: Record<SimpleChatMark, string> = {
  awaitingInput: 'bg-warn-ink',
  unread: 'bg-primary',
  running: 'bg-muted-foreground animate-pulse',
  subagents: 'bg-purple-500 dark:bg-purple-400 animate-pulse',
};

/**
 * One folder's header in the simple list, drawn in the chat rows' own vocabulary: the chat row's
 * height rule, its icon box, its 8px discs and their inks, its menu and its drop line.
 *
 * THE NAME IS THE FOLD, AND IT IS NOT A `<button>`. The carry behind this list turns every press
 * inside a `button` away, so a mouse has to be able to pick the folder up by its name exactly as it
 * picks a chat up by its title: the toggle is a `role="button"` span with `tabIndex`, answering a
 * press, Enter and Space, and on a touch the carry waits for the glyph's `data-drag-handle`.
 *
 * ONE DOT, NEVER A SPINNER AND NEVER TWO: the folder's most pressing chat, in the same disc the
 * chat row would wear for it — a question in the warning ink and the row's pulse, a reply not read
 * in the accent, a run and a subagent as their own pulses. It is drawn folded or open, because it
 * is the mark that says there is something inside to open.
 *
 * THE SELECTED WASH IS THE ROW'S, for a reason that only shows once folded: while the open chat
 * sits inside a shut folder, its row is not on screen, and this header is the only place left that
 * says where the reader is. `isDropInto` answers with a ring in the accent instead, and a carried
 * chat's `dropEdge` draws the chat row's line on the top edge.
 *
 * Used by SidebarSimpleListItems, one per folder block.
 */
export default function SidebarSimpleFolderRow({
  folder,
  dot,
  holdsSelected,
  isFresh,
  onFreshShown,
  onToggle,
  onRename,
  onDelete,
  dragProps,
  isDragging,
  dropEdge,
  isDropInto,
  t,
}: SidebarSimpleFolderRowProps) {
  const isCompact = useCompactSidebar();
  // Whether the name is open for typing: a fresh folder opens it on its own, the menu's Rename by hand.
  const [isEditing, setIsEditing] = useState(false);
  // The rename input's live value, seeded from the folder's name when editing starts.
  const [draft, setDraft] = useState(folder.name);
  // The row itself, so a folder that was just made can bring itself into view.
  const rootRef = useRef<HTMLDivElement>(null);
  // Armed by the fresh effect below and spent by the input's first focus: the name that a folder is
  // born with is a placeholder, and the first keystroke should replace it rather than append to it.
  const selectOnFocusRef = useRef(false);

  // FILL: freshShown — a folder that has just been made opens its name for typing, selected whole,
  // brings itself into view and tells the list it has been seen. The list clears its own fresh id in
  // `onFreshShown`, so this body runs once per fresh turn and the input stays open afterwards.
  useEffect(() => {
    if (!isFresh) return;
    // oxlint-disable-next-line react/set-state-in-effect
    setDraft(folder.name);
    setIsEditing(true);
    selectOnFocusRef.current = true;
    rootRef.current?.scrollIntoView({ block: 'nearest' });
    onFreshShown();
  }, [isFresh, folder.name, onFreshShown]);

  const startRename = () => {
    setDraft(folder.name);
    setIsEditing(true);
  };

  const saveRename = () => {
    const trimmed = draft.trim();
    setIsEditing(false);
    // The chat row's own rule, unchanged: a blank name and an unchanged name both write nothing.
    if (trimmed && trimmed !== folder.name) onRename(trimmed);
  };

  return (
    <div
      {...(dragProps ?? {})}
      ref={rootRef}
      data-testid="simple-chat-folder"
      data-folder-id={folder.folderId}
      data-collapsed={folder.collapsed ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      className={cn(
        'group relative flex min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors',
        // The chat row's height rule, unchanged: the compact sidebar's 44px floor is reached by the
        // content stretching to fill this row's box, so vertical padding here would eat into it.
        isCompact ? 'min-h-11' : 'py-2',
        holdsSelected ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-accent/60',
        isDropInto && 'ring-2 ring-primary',
        // NO FADE OF ITS OWN, unlike the chat row: what is carried is the whole BLOCK — this header
        // and the chats under it — and the block is what fades (`SidebarSimpleListItems`). Fading
        // the header here as well would multiply the two, leaving the name at 25% while its own
        // chats sat at 50%. `isDragging` still says which header is the carried one, through
        // `data-dragging` below.
      )}
    >
      <span
        data-drag-handle
        title={t('simpleList.dragHandle')}
        className="flex h-7 w-6 flex-shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground"
      >
        <Folder className="h-4 w-4" aria-hidden="true" />
      </span>

      {isEditing ? (
        <input
          type="text"
          value={draft}
          data-testid="simple-chat-folder-rename-input"
          placeholder={t('simpleList.folderNamePlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveRename();
            else if (event.key === 'Escape') setIsEditing(false);
          }}
          onFocus={(event) => {
            if (!selectOnFocusRef.current) return;
            selectOnFocusRef.current = false;
            event.currentTarget.select();
          }}
          autoFocus
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      ) : (
        <span
          role="button"
          tabIndex={0}
          data-testid="simple-chat-folder-toggle"
          aria-expanded={!folder.collapsed}
          // The app's one pair of fold words, from `common`: the chevron is a sign, and the words
          // beside it are the same ones every folding card in the app uses.
          title={t(folder.collapsed ? 'runner.expand' : 'runner.collapse', { ns: 'common' })}
          onClick={onToggle}
          onKeyDown={(event) => {
            // A span is not a button: Enter and Space are both a press on it, and Space would
            // otherwise scroll the list under the reader.
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onToggle();
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-[13px] leading-4"
        >
          <FoldChevron collapsed={folder.collapsed} className="text-muted-foreground" />
          <span className="truncate font-medium">{folder.name}</span>
        </span>
      )}

      {dot !== null && (
        <span
          data-testid="simple-chat-folder-dot"
          data-mark={dot}
          role="img"
          aria-label={t(DOT_WORDS[dot])}
          title={t(DOT_WORDS[dot])}
          className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center', dot === 'awaitingInput' && 'vv-pulse')}
        >
          <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', DOT_INK[dot])} />
        </span>
      )}

      {!isEditing && (
        <div data-testid="simple-chat-folder-menu">
          <ActionMenu
            // The folder's own name, because a menu opened from a list of folders has to say which
            // one it belongs to.
            label={t('simpleList.folderOptions', { name: folder.name })}
            ariaLabel={t('simpleList.folderOptions', { name: folder.name })}
            icon={MoreHorizontal}
            iconOnly
            variant="ghost"
            size="icon"
            triggerClassName="h-7 w-7 flex-shrink-0 text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100"
            items={[
              {
                key: 'simple-chat-folder-rename',
                label: t('simpleList.rename'),
                icon: Edit2,
                onSelect: startRename,
              },
              // Delete takes the folder away and leaves its chats, so it is the only irreversible
              // entry here and the only one painted as danger.
              {
                key: 'simple-chat-folder-delete',
                label: t('simpleList.folderDelete'),
                icon: Trash2,
                showDividerBefore: true,
                isDanger: true,
                onSelect: onDelete,
              },
            ]}
          />
        </div>
      )}

      {/* The chat row's own drop line, on this row's top edge: where a carried chat lands when it
          comes down before the folder, at the top level. */}
      {dropEdge === 'before' && (
        <span aria-hidden className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-full bg-primary" />
      )}
    </div>
  );
}
