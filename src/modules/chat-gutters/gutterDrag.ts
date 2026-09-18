/**
 * The drag type a gutter widget carries, and the one thing a column will accept.
 *
 * A column's `dragover` must call `preventDefault()` to be droppable at all, so a column that offers
 * itself to anything offers itself to a file from the desktop and a selection from another window
 * too — and its `drop` would then move whichever widget the layout last remembered. The payload is
 * what tells the two apart: only a drag that set THIS type is one of ours.
 */
export const GUTTER_DRAG_TYPE = 'application/x-cloudcli-gutter-widget';

/** Whether a drag in flight is a gutter widget's. Read from `types`, which `dragover` may see. */
export function isGutterDrag(transfer: DataTransfer | null): boolean {
  return transfer !== null && Array.from(transfer.types).includes(GUTTER_DRAG_TYPE);
}
