import type { HTMLAttributes } from 'react';
import type { TFunction } from 'i18next';

import { cn } from '@/shared/utils';
import type {
  RecentConversationListItem,
  SimpleListDropTarget,
  SimpleListFolder,
  SimpleListItem,
  SimpleListItemRef,
} from '@/shared/types';
import { chatMarks, folderDot } from '@/modules/sidebar/utils/simpleChatMarks';
import SidebarSimpleFolderRow from '@/modules/sidebar/SidebarSimpleFolderRow';
import SidebarSimpleListRow from '@/modules/sidebar/SidebarSimpleListRow';

// File-local: read only by SidebarSimpleList, which mounts this tree inside its own rows container
// and owns every handler and every id set below.
type SidebarSimpleListItemsProps = {
  /** The top-level rows in the server's order: a chat in no folder, or a folder holding its chats. */
  items: SimpleListItem[];
  /** The open chat's id, or null: what the selected wash and a folder's `holdsSelected` read. */
  selectedSessionId: string | null;
  /** The chats whose turn is running right now. */
  busySessionIds: ReadonlySet<string>;
  /** The chats with a question or a permission prompt waiting on the reader. */
  awaitingInputSessionIds: ReadonlySet<string>;
  /** The chats with a subagent still running, often after their own turn has ended. */
  subagentRunningSessionIds: ReadonlySet<string>;
  /** The chat whose removal failed, which its row says out loud; null when none has. */
  failedSessionId: string | null;
  /** The folder that has just been made: its header opens its name for typing and scrolls itself in. */
  freshFolderId: string | null;
  /** The fresh folder's header has been seen: the list stops treating it as fresh. */
  onFreshShown: () => void;
  /** What the pointer is carrying at this moment, or null. */
  dragging: SimpleListItemRef | null;
  /** Where the pointer says the carried row would land, or null. */
  dropTarget: SimpleListDropTarget | null;
  /** The carry's pointer handlers for one row: every chat row and every folder header spreads these. */
  dragProps: (item: SimpleListItemRef) => Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'>;
  /** A chat row was pressed: open that chat. */
  onSelectChat: (chat: RecentConversationListItem) => void;
  /** A chat row's Archive: put the chat away, keeping its transcript. */
  onArchiveChat: (chat: RecentConversationListItem) => void;
  /** A chat row's Delete: take the chat off disk. */
  onDeleteChat: (chat: RecentConversationListItem) => void;
  /** A chat row's "Change icon": open the icon picker on that chat. */
  onChooseIcon: (chat: RecentConversationListItem) => void;
  /** A chat row's Rename: save a new title for that chat. */
  onRenameChat: (sessionId: string, title: string) => void;
  /** A chat row's "Move to folder…", or null while the list holds no folder to move into. */
  onMoveToFolder: ((chat: RecentConversationListItem) => void) | null;
  /** A folder header was pressed: fold or unfold that folder. */
  onToggleFolder: (folder: SimpleListFolder) => void;
  /** A folder's Rename: save a new name for it. */
  onRenameFolder: (folderId: string, name: string) => void;
  /** A folder's Delete: delete an empty one at once, or ask about one that holds chats. */
  onDeleteFolder: (folder: SimpleListFolder) => void;
  /** The sidebar's translations, handed to each row. */
  t: TFunction;
};

// FILL: dropMarks — which row, header or block wears which mark, from what is carried and where the
// pointer says it would land. A carried CHAT marks one row: a chat row's own edge, a folder
// header's top edge, or the accent ring on the folder it would land inside. A carried FOLDER marks
// the top or bottom edge of the block it would land beside and nothing else — its own block fades
// instead. Either one, past the last block, wears the single line the list draws after them.

/** The line a chat's row wears: only while a CHAT is carried, and only on the row it would land on. */
function chatDropEdge(
  sessionId: string,
  dragging: SimpleListItemRef | null,
  target: SimpleListDropTarget | null,
): 'before' | 'after' | null {
  if (dragging === null || dragging.kind !== 'chat') return null;
  if (target === null || target.at !== 'row') return null;
  if (target.item.kind !== 'chat' || target.item.id !== sessionId) return null;
  return target.edge;
}

/** The line a folder header wears on its top edge: a carried chat landing BESIDE the folder, not in it. */
function folderDropEdge(
  folderId: string,
  dragging: SimpleListItemRef | null,
  target: SimpleListDropTarget | null,
): 'before' | null {
  if (dragging === null || dragging.kind !== 'chat') return null;
  if (target === null || target.at !== 'row') return null;
  if (target.item.kind !== 'folder' || target.item.id !== folderId) return null;
  return target.edge === 'before' ? 'before' : null;
}

/** The ring a folder header wears: a carried chat landing INSIDE the folder. */
function folderDropInto(
  folderId: string,
  dragging: SimpleListItemRef | null,
  target: SimpleListDropTarget | null,
): boolean {
  return dragging !== null
    && dragging.kind === 'chat'
    && target !== null
    && target.at === 'into'
    && target.folderId === folderId;
}

/** The line a top-level block wears on its own edge: a carried FOLDER landing beside it. */
function blockDropEdge(
  item: SimpleListItem,
  dragging: SimpleListItemRef | null,
  target: SimpleListDropTarget | null,
): 'before' | 'after' | null {
  if (dragging === null || dragging.kind !== 'folder') return null;
  if (target === null || target.at !== 'row' || target.item.kind !== item.kind) return null;
  const id = item.kind === 'chat' ? item.chat.sessionId : item.folder.folderId;
  return target.item.id === id ? target.edge : null;
}

/**
 * The simple list's tree: one block per top-level row, drawn inside SidebarSimpleList's own rows
 * container. A loose chat's block is its row; a folder's block is the folder's header and, only
 * while the folder is open, its chats' rows one step in under it.
 *
 * THE BLOCK IS WHAT A CARRIED FOLDER LANDS BESIDE, so the block — not the row — is what carries
 * `data-item-kind` and `data-item-id`, and the carry finds its targets by exactly those. A chat
 * inside an open folder is a candidate too (a chat can move between folders by the same gesture),
 * which is why every chat row, nested or loose, asks for its own edge.
 *
 * THE MARKS ARE DRAWN FROM THE PROPS ALONE: what is carried, where the pointer says it lands, the
 * three id sets, the open chat's id. Nothing here reads the DOM or the server; the tree is a
 * function of what the list hands it, so every state can be drawn without a drag ever running.
 *
 * THE RHYTHM IS THE LIST'S OWN, UNIFORM ON PURPOSE. A folder's chats sit at the container's 4px from
 * their header — the same air every top-level row has — and what says they belong to the folder is
 * the indent: a nested row's glyph starts in the folder's chevron column, one step in. A tighter gap
 * inside the block was considered and set aside, because a folder's chats are the same rows the loose
 * list draws, and a group that hugged its header would read as a different kind of thing. If the
 * operator ever wants a folder's chats to read as one mass, this block's own `gap-1` is the one knob.
 *
 * Used by SidebarSimpleList.
 */
export default function SidebarSimpleListItems({
  items,
  selectedSessionId,
  busySessionIds,
  awaitingInputSessionIds,
  subagentRunningSessionIds,
  failedSessionId,
  freshFolderId,
  onFreshShown,
  dragging,
  dropTarget,
  dragProps,
  onSelectChat,
  onArchiveChat,
  onDeleteChat,
  onChooseIcon,
  onRenameChat,
  onMoveToFolder,
  onToggleFolder,
  onRenameFolder,
  onDeleteFolder,
  t,
}: SidebarSimpleListItemsProps) {
  /** One chat's row: a loose chat at the top level, or a folder's chat one step in under its header. */
  const chatRow = (chat: RecentConversationListItem, isNested: boolean) => (
    <SidebarSimpleListRow
      key={chat.sessionId}
      row={chat}
      isNested={isNested}
      isSelected={chat.sessionId === selectedSessionId}
      isRunning={busySessionIds.has(chat.sessionId)}
      isAwaitingInput={awaitingInputSessionIds.has(chat.sessionId)}
      isSubagentRunning={subagentRunningSessionIds.has(chat.sessionId)}
      isRemoveFailed={failedSessionId === chat.sessionId}
      // FILL: onSelectChat
      onSelect={() => onSelectChat(chat)}
      // FILL: onArchiveChat
      onArchive={() => onArchiveChat(chat)}
      // FILL: onDeleteChat
      onDelete={() => onDeleteChat(chat)}
      // FILL: onRenameChat
      onRename={(title) => onRenameChat(chat.sessionId, title)}
      // FILL: onChooseIcon
      onChooseIcon={() => onChooseIcon(chat)}
      // FILL: onMoveToFolder
      onMoveToFolder={onMoveToFolder === null ? null : () => onMoveToFolder(chat)}
      // FILL: dragProps
      dragProps={dragProps({ kind: 'chat', id: chat.sessionId })}
      isDragging={dragging !== null && dragging.kind === 'chat' && dragging.id === chat.sessionId}
      dropEdge={chatDropEdge(chat.sessionId, dragging, dropTarget)}
      t={t}
    />
  );

  return (
    <>
      {items.map((item) => {
        const id = item.kind === 'chat' ? item.chat.sessionId : item.folder.folderId;
        // A carried chat fades as its own row; a carried folder fades as its whole block.
        const isCarried = dragging !== null && dragging.kind === item.kind && dragging.id === id;
        const blockEdge = blockDropEdge(item, dragging, dropTarget);

        // The line a carried folder would land on, at this block's own edge.
        const blockLine = blockEdge === null ? null : (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary',
              blockEdge === 'before' ? 'top-0' : 'bottom-0',
            )}
          />
        );

        if (item.kind === 'folder') {
          const { folder } = item;
          // FILL: dot — the folder's one dot: `folderDot` over the `chatMarks` of each of its chats,
          // from the three id sets, each chat's own `unread` and the open chat's id.
          const dot = folderDot(
            folder.chats.map((chat) => chatMarks({
              unread: chat.unread,
              isSelected: chat.sessionId === selectedSessionId,
              isRunning: busySessionIds.has(chat.sessionId),
              isAwaitingInput: awaitingInputSessionIds.has(chat.sessionId),
              isSubagentRunning: subagentRunningSessionIds.has(chat.sessionId),
            })),
          );
          // FILL: holdsSelected — the open chat is one of this folder's and the folder is folded, so
          // the header wears the selected wash while the chat's own row is out of sight.
          const holdsSelected = folder.collapsed
            && folder.chats.some((chat) => chat.sessionId === selectedSessionId);

          return (
            <div
              key={id}
              data-testid="simple-chat-block"
              data-item-kind="folder"
              data-item-id={id}
              className={cn('relative flex flex-col gap-1', isCarried && 'opacity-50')}
            >
              <SidebarSimpleFolderRow
                folder={folder}
                dot={dot}
                holdsSelected={holdsSelected}
                isFresh={folder.folderId === freshFolderId}
                // FILL: onFreshShown
                onFreshShown={onFreshShown}
                // FILL: onToggleFolder
                onToggle={() => onToggleFolder(folder)}
                // FILL: onRenameFolder
                onRename={(name) => onRenameFolder(folder.folderId, name)}
                // FILL: onDeleteFolder
                onDelete={() => onDeleteFolder(folder)}
                // FILL: dragProps
                dragProps={dragProps({ kind: 'folder', id })}
                isDragging={isCarried}
                dropEdge={folderDropEdge(id, dragging, dropTarget)}
                isDropInto={folderDropInto(id, dragging, dropTarget)}
                t={t}
              />
              {/* Only while the folder is open: a folded folder mounts no chat rows at all. The
                  carry reads drawn boxes, so a clipped row would still be a drop target. */}
              {!folder.collapsed && folder.chats.map((chat) => chatRow(chat, true))}
              {blockLine}
            </div>
          );
        }

        return (
          <div
            key={id}
            data-testid="simple-chat-block"
            data-item-kind="chat"
            data-item-id={id}
            className="relative flex flex-col gap-1"
          >
            {chatRow(item.chat, false)}
            {blockLine}
          </div>
        );
      })}

      {/* The last place a row can land. Drawn only while the pointer is past every block. */}
      {dropTarget?.at === 'end' && (
        <span data-testid="simple-chat-drop-end" aria-hidden className="mx-1 h-0.5 rounded-full bg-primary" />
      )}
    </>
  );
}
