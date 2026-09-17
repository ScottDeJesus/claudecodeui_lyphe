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
