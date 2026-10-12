import type { SimpleListDropTarget, SimpleListItemRef } from '@/shared/types';
import { layoutRectOf } from '@/shared/ui/sortable/slotAt';

/**
 * Where a carried row would land, read off the DOM the list draws: the drawn chat rows, folder
 * headers and top-level blocks, never the tree, whose drawn order is exactly what the reader sees.
 * Pure readings of a vertical pointer position against those boxes; the carry that asks is
 * `useSimpleChatDrag`, this file's only consumer.
 *
 * EVERY ROW AND BLOCK IS READ AS LAID OUT (`layoutRectOf`, the transform taken off). The carried row follows the
 * pointer by a transform for the whole carry, so what is drawn under the pointer is the carried row
 * itself; its slot, and the rows around it, are where the list stands.
 */

/** The list root, as SidebarSimpleList draws it. */
const LIST_SELECTOR = '[data-testid="simple-chat-list"]';
/** A chat row and a folder's header row: what a carried chat may land on. */
const ROW_OR_HEADER_SELECTOR = '[data-testid="simple-chat-row"], [data-testid="simple-chat-folder"]';
/** One top-level row's block: what a carried folder may land beside. */
const BLOCK_SELECTOR = '[data-testid="simple-chat-block"]';

/** A drawn row or folder header, and the box it stands in: what a carry reads under the pointer. */
type DrawnRow = { ref: SimpleListItemRef; top: number; bottom: number; height: number };

/** Whether two refs name the same row. */
export const refsEqual = (a: SimpleListItemRef, b: SimpleListItemRef): boolean => a.kind === b.kind && a.id === b.id;

/** Whether two targets ask for the same place, so a pointer that has not moved on re-renders nothing. */
export function targetsEqual(a: SimpleListDropTarget | null, b: SimpleListDropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.at !== b.at) return false;
  if (a.at === 'end') return true;
  if (a.at === 'into') return b.at === 'into' && a.folderId === b.folderId;
  if (b.at !== 'row') return false;
  return a.edge === b.edge && refsEqual(a.item, b.item);
}

/**
 * The drawn element a carry lifts and moves, from the row or header that was pressed: a chat's own row, a
 * folder's whole block (its header and the open chats under it travel together). Null once the pressed
 * row has left the page.
 */
export function carriedElementOf(pressed: HTMLElement, carried: SimpleListItemRef): HTMLElement | null {
  if (!pressed.isConnected) return null;
  return carried.kind === 'folder' ? pressed.closest<HTMLElement>(BLOCK_SELECTOR) : pressed;
}

/** The ref a drawn chat row or folder header names, from the id it carries; null for an element that carries neither. */
export function refOfRow(element: HTMLElement): SimpleListItemRef | null {
  const sessionId = element.dataset.sessionId;
  if (sessionId) return { kind: 'chat', id: sessionId };
  const folderId = element.dataset.folderId;
  return folderId ? { kind: 'folder', id: folderId } : null;
}

/** The top-level row a block names, from its `data-item-kind` and `data-item-id`; null for a block that carries neither. */
function refOfBlock(block: HTMLElement): SimpleListItemRef | null {
  const id = block.dataset.itemId;
  const kind = block.dataset.itemKind;
  if (!id || (kind !== 'chat' && kind !== 'folder')) return null;
  return { kind, id };
}

/**
 * What a carried CHAT is over: the drawn chat row or folder header the pointer has entered last —
 * the one whose top edge is at or above the pointer while the next one's is not. Inside a row that
 * is the row itself; in the gap between two rows it is the row above, where a pointer in that gap
 * belongs: the row drawn below a folder's last chat is a top-level one, and answering "before it"
 * reads as a move out of the folder the row still stands in. A chat row splits at its middle; a
 * folder header's top quarter is `before` and the rest is `into`, so a slight aim above a header
 * drops beside the folder and every other aim drops inside it. Above the first drawn row is the
 * top of the list; past the last one is `{ at: 'end' }`, except under the carried row: its own
 * place reaches to the bottom of the list's box, so a press and release there moves nothing.
 */
export function chatTargetAt(clientY: number, carriedId: string): SimpleListDropTarget | null {
  const list = document.querySelector(LIST_SELECTOR);
  if (!list) return null;
  const listBottom = list.getBoundingClientRect().bottom;
  let first: SimpleListItemRef | null = null;
  let over: DrawnRow | null = null;
  // Whether any drawn row begins below the pointer: the pointer is among the rows, not past them.
  let drawnBelow = false;
  for (const element of list.querySelectorAll<HTMLElement>(ROW_OR_HEADER_SELECTOR)) {
    const ref = refOfRow(element);
    if (ref === null) continue;
    first ??= ref;
    const { top, height } = layoutRectOf(element);
    const bottom = top + height;
    // The rows are drawn in the order they stand, so the first the pointer has not reached is below
    // it, and the last it has reached is the one it is over.
    if (clientY < top) {
      drawnBelow = true;
      break;
    }
    over = { ref, top, bottom, height };
  }
  if (over === null) {
    // Above every drawn row: the first row's own top edge, the top of the list.
    return first === null ? null : { at: 'row', item: first, edge: 'before' };
  }
  if (over.ref.kind === 'chat' && over.ref.id === carriedId) {
    // The place the carried row already stands in, named by its own top edge: `refAbove` skips the
    // carried row and answers the row above it in its own container, so this is exactly the
    // position the row holds today. Hand the pointer to the next row instead — as dropping the
    // carried row from the candidates does — and the first row below a folder's last chat, a
    // top-level one, takes the anchor: a press and release inside the row lifts it out of the
    // folder.
    //
    // No row below means this one is the last drawn, and the rule's `{ at: 'end' }` is the answer
    // only past the list's own box: the tail under the row is still the list, so it stays its own
    // place, and the last chat of the last folder can still be carried to the end.
    if (!drawnBelow && clientY > listBottom) return { at: 'end' };
    return { at: 'row', item: over.ref, edge: 'before' };
  }
  if (!drawnBelow && clientY > over.bottom) {
    // Past the last drawn row: the end of the list rather than a row.
    return { at: 'end' };
  }
  if (over.ref.kind === 'chat') {
    return { at: 'row', item: over.ref, edge: clientY < over.top + over.height / 2 ? 'before' : 'after' };
  }
  return clientY < over.top + over.height / 4
    ? { at: 'row', item: over.ref, edge: 'before' }
    : { at: 'into', folderId: over.ref.id };
}

/**
 * What a carried FOLDER is over: the first block whose bottom edge is at or below the pointer, and
 * the last one when the pointer is past them all. Above a block's middle is `before` and the rest
 * is `after` — a folder lives at the top level, so those are the only two places it can land.
 * A folder cannot land inside itself or another folder, and its own block is skipped for that.
 */
export function folderTargetAt(clientY: number, carried: SimpleListItemRef): SimpleListDropTarget | null {
  const list = document.querySelector(LIST_SELECTOR);
  if (!list) return null;
  const blocks = [...list.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)].filter((block) => {
    const item = refOfBlock(block);
    return item !== null && !refsEqual(item, carried);
  });
  if (blocks.length === 0) return null;
  let chosen = blocks[blocks.length - 1];
  for (const block of blocks) {
    const { top, height } = layoutRectOf(block);
    if (clientY <= top + height) {
      chosen = block;
      break;
    }
  }
  const item = refOfBlock(chosen);
  if (item === null) return null;
  const { top, height } = layoutRectOf(chosen);
  return { at: 'row', item, edge: clientY < top + height / 2 ? 'before' : 'after' };
}
