import type { SimpleListDropTarget, SimpleListItemRef } from '@/shared/types';
import { layoutRectOf } from '@/shared/ui/sortable/slotAt';

/**
 * Where a carried chat or folder would land ON THE SESSIONS BOARD, read off the DOM the board draws: its columns
 * (`[data-board-folder]`, a folder's id or `none` for the chats in no folder) and the chat rows in them (`[data-board-row]`). The
 * list's own reading (`simpleChatDropTarget.ts`) takes a single column and a vertical pointer; the board is columns side by side, in
 * rows that wrap, so this one reads the pointer in both directions. What it answers is the list's own vocabulary
 * (`SimpleListDropTarget`), so the same table turns it into a position (`positionForDrop`) and the same write moves the row.
 *
 * EVERY BOX IS READ AS LAID OUT (`layoutRectOf`, the transform taken off): the carried row follows the pointer by a transform, so what
 * is drawn under the pointer is the carried row itself, and its slot and its neighbours are where the board stands.
 *
 * Used by `useBoardCarry`, this file's only consumer.
 */

/** A column of the board: a folder's, or the one of the chats in no folder. */
const COLUMN_SELECTOR = '[data-board-folder]';
/** A chat's row in a column. */
const ROW_SELECTOR = '[data-board-row]';
/** What a column carries as its id when it is the column of the chats in no folder. */
const NO_FOLDER = 'none';
/** A pointer further than this from every column, in px, is over none of them: a release there moves nothing. */
const REACH_PX = 96;

type Box = { left: number; top: number; width: number; height: number };

/** How far a point is from a box, in px: 0 inside it. */
function distanceTo(box: Box, x: number, y: number): number {
  const across = Math.max(box.left - x, 0, x - (box.left + box.width));
  const down = Math.max(box.top - y, 0, y - (box.top + box.height));
  return Math.hypot(across, down);
}

/** The column nearest the pointer among `columns`, with its box; null when the pointer is out of reach of them all. */
function nearestColumn(columns: HTMLElement[], x: number, y: number): { column: HTMLElement; box: Box } | null {
  let nearest: { column: HTMLElement; box: Box; distance: number } | null = null;
  for (const column of columns) {
    const box = layoutRectOf(column);
    const distance = distanceTo(box, x, y);
    if (nearest === null || distance < nearest.distance) nearest = { column, box, distance };
  }
  return nearest === null || nearest.distance > REACH_PX ? null : nearest;
}

/**
 * What a carried CHAT is over: the column nearest the pointer, and in it the row the pointer stands before. Above a row's middle is
 * before that row; below the last row's middle is after it. A folder's column with no other chat in it takes the chat in
 * (`into`); the column of the chats in no folder with none in it takes it to the end of the list (`end`), which is where a chat
 * in no folder is drawn.
 */
export function boardChatTargetAt(board: Element, x: number, y: number, carriedId: string): SimpleListDropTarget | null {
  const found = nearestColumn([...board.querySelectorAll<HTMLElement>(COLUMN_SELECTOR)], x, y);
  if (found === null) return null;
  const folderId = found.column.dataset.boardFolder ?? NO_FOLDER;
  const rows = [...found.column.querySelectorAll<HTMLElement>(ROW_SELECTOR)].filter((row) => row.dataset.boardRow !== carriedId);
  if (rows.length === 0) return folderId === NO_FOLDER ? { at: 'end' } : { at: 'into', folderId };
  for (const row of rows) {
    const { top, height } = layoutRectOf(row);
    if (y < top + height / 2) return { at: 'row', item: { kind: 'chat', id: row.dataset.boardRow ?? '' }, edge: 'before' };
  }
  return { at: 'row', item: { kind: 'chat', id: rows[rows.length - 1].dataset.boardRow ?? '' }, edge: 'after' };
}

/**
 * What a carried FOLDER is over: the other folder's column nearest the pointer, before it when the pointer is left of its middle and
 * after it otherwise. A folder lands beside another folder and nowhere else: the column of the chats in no folder is no place
 * for it, and neither is its own.
 */
export function boardFolderTargetAt(board: Element, x: number, y: number, carried: SimpleListItemRef): SimpleListDropTarget | null {
  const columns = [...board.querySelectorAll<HTMLElement>(COLUMN_SELECTOR)].filter((column) => {
    const id = column.dataset.boardFolder;
    return id !== undefined && id !== NO_FOLDER && id !== carried.id;
  });
  const found = nearestColumn(columns, x, y);
  if (found === null) return null;
  return { at: 'row', item: { kind: 'folder', id: found.column.dataset.boardFolder ?? '' }, edge: x < found.box.left + found.box.width / 2 ? 'before' : 'after' };
}
