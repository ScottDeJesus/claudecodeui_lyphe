import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Edit2, MoreHorizontal, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { SimpleListFolder } from '@/shared/types';
import { ActionMenu } from '@/shared/ui';
import { cn } from '@/shared/utils';

type BoardFolderProps = {
  /** The folder this column draws, or null for the column of the chats in no folder: it has a name and no verbs. */
  folder: SimpleListFolder | null;
  /** Just made: the name opens for typing and the column scrolls into view, once. */
  isFresh: boolean;
  onFreshShown: () => void;
  onRename: (name: string) => void;
  /** Delete: an empty folder goes at once, one that holds chats asks first and gives them back to the board. */
  onDelete: () => void;
  /** The column's chats, each a `BoardChatRow`. */
  children: ReactNode;
  t: TFunction;
};

/**
 * ONE FOLDER ON THE SESSIONS BOARD, as a column: its name in small capitals over its chats, which hang on one thread down the column's left edge, each by
 * its pin. The chats in no folder are a column too, named "No folder", with no thread and no verbs of its own.
 *
 * It is the simple list's folder header redrawn (`SidebarSimpleFolderRow`), with its verbs unchanged: Rename opens the name for typing in place, a folder
 * just made opens its name by itself with the placeholder selected, and Delete folder is the list's. The board draws every folder open: a column has no fold.
 *
 * Used by `SessionsBoard`, once per folder and once for the chats in none.
 */
export function BoardFolder({ folder, isFresh, onFreshShown, onRename, onDelete, children, t }: BoardFolderProps) {
  const name = folder?.name ?? t('simpleList.noFolder');
  // Whether the name is open for typing: a fresh folder opens it on its own, the menu's Rename by hand.
  const [isEditing, setIsEditing] = useState(false);
  // The rename input's live value, seeded from the folder's name when editing starts.
  const [draft, setDraft] = useState(name);
  const rootRef = useRef<HTMLElement>(null);
  // Armed for a fresh folder and spent by the input's first focus: the name it is born with is a placeholder, so the first keystroke replaces it.
  const selectOnFocusRef = useRef(false);

  useEffect(() => {
    if (!isFresh) return;
    // oxlint-disable-next-line react/set-state-in-effect
    setDraft(name);
    setIsEditing(true);
    selectOnFocusRef.current = true;
    rootRef.current?.scrollIntoView({ block: 'nearest' });
    onFreshShown();
  }, [isFresh, name, onFreshShown]);

  const startRename = () => {
    setDraft(name);
    setIsEditing(true);
  };
  const saveRename = () => {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== name) onRename(trimmed);
  };

  return (
    <section ref={rootRef} data-board-folder={folder?.folderId ?? 'none'} className="group/folder min-w-0">
      <header className="mb-1.5 ml-[13px] flex min-h-7 items-center justify-between gap-2">
        {isEditing ? (
          <input
            type="text"
            value={draft}
            data-board-folder-rename
            placeholder={t('simpleList.folderNamePlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => {
              if (!selectOnFocusRef.current) return;
              selectOnFocusRef.current = false;
              event.currentTarget.select();
            }}
            onBlur={saveRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveRename();
              else if (event.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        ) : (
          <h2 className="min-w-0 truncate font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground transition-colors group-focus-within/folder:text-foreground group-hover/folder:text-foreground">
            {name}
          </h2>
        )}
        {folder !== null && !isEditing && (
          <div className="flex-none transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100 [&:has([aria-expanded=true])]:opacity-100 [@media(hover:hover)]:opacity-0">
            <ActionMenu
              label={t('simpleList.folderOptions', { name })}
              ariaLabel={t('simpleList.folderOptions', { name })}
              icon={MoreHorizontal}
              iconOnly
              variant="ghost"
              size="icon"
              triggerClassName="h-7 w-7 flex-shrink-0 text-muted-foreground finger:h-11 finger:w-11"
              items={[
                { key: 'board-folder-rename', label: t('simpleList.rename'), icon: Edit2, onSelect: startRename },
                { key: 'board-folder-delete', label: t('simpleList.folderDelete'), icon: Trash2, showDividerBefore: true, isDanger: true, onSelect: onDelete },
              ]}
            />
          </div>
        )}
      </header>
      {/* The thread the folder's chats hang on. The chats in no folder hang on none: each stands by its own pin. */}
      <ul
        className={cn(
          'm-0 min-h-11 list-none border-l-[1.25px] p-0 transition-colors',
          folder === null ? 'border-transparent' : 'border-muted-foreground/50 group-focus-within/folder:border-foreground group-hover/folder:border-foreground',
        )}
      >
        {children}
      </ul>
    </section>
  );
}
