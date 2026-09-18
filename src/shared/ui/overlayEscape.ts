/**
 * The one fact a panel states about itself: IT OWNS ESCAPE while it is on screen.
 *
 * A STATEMENT BY THE PRODUCER, not a reading of the DOM. A dialog has to ask who is in front of it
 * before it takes the key, because it listens on `window` capture and stops the event there; asking
 * by scanning for `[role="menu"], [role="listbox"]` was wrong, and shipped that way for one pass. A
 * role is a promise about MARKUP and several components share it: cmdk's list carries
 * `role="listbox"` as STATIC content of whatever dialog it is placed in, so the command palette
 * stood the dialog down on every Escape, and Escape is the palette's only pointerless dismissal.
 *
 * This attribute is a promise about BEHAVIOUR, and it is only honest on a panel that is RENDERED
 * SOLELY WHILE IT IS OPEN: then the marker's presence in the document is the fact itself, and a
 * panel that is always mounted cannot lie about it.
 *
 * Carried by every panel that closes itself on Escape while it is open — `ActionMenu`, `Menu`,
 * `Select`, the file tree's context menu and the composer's menu surface. A new one claims the key
 * the same way, and until it does the dialog above it keeps the key, which is the old behaviour
 * rather than a broken one.
 */
export const OWNS_ESCAPE = { 'data-owns-escape': '' } as const;

/** The same fact as the selector the dialog reads it with. */
export const OWNS_ESCAPE_SELECTOR = '[data-owns-escape]';

/**
 * Whether something in FRONT of a fullscreen surface holds Escape right now.
 *
 * Asked by the two fullscreen surfaces — a transcript embed card (`WidgetFrame`) and a chat gutter
 * widget (`ChatGutterLayout`) — before they take the key. Two kinds of thing are in front of them:
 *  - a modal DIALOG: both surfaces sit under the dialog layer (`z-[45]` under `Dialog`'s z-50), so a
 *    dialog opened from fullscreen is in front and the press is its;
 *  - any panel that states it owns the key (`OWNS_ESCAPE`) — a Select opened INSIDE the fullscreen
 *    widget, the composer's menu — which is the contract every other Escape listener in this app
 *    already honours ("a new one claims the key the same way", above).
 * A fullscreen surface carries the marker itself while it is up, so the surfaces are excluded by
 * their own attribute: one fullscreen card must not stand down for itself, or for the other.
 *
 * They cannot win this by `stopPropagation`: two listeners on the same `window` capture stage both
 * run, and a panel listening lower never gets the chance — so without asking, one press left
 * fullscreen and left the panel in front of it open (measured by Athena's review).
 */
export function otherOverlayHoldsEscape(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector(
    '[role="dialog"][aria-modal="true"], [data-owns-escape]:not([data-shape-fullscreen]):not([data-fullscreen])',
  ) !== null;
}
