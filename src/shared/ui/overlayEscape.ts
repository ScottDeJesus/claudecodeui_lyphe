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
 * `Select`, `Sheet`, the file tree's context menu and the composer's menu surface. A new one claims the key
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
 * The document asked is the caller's host document (`useHostWindow().document`), because a panel open
 * in a picture-in-picture window lives in that window's document, not the opener's.
 *
 * They cannot win this by `stopPropagation`: two listeners on the same `window` capture stage both
 * run, and a panel listening lower never gets the chance — so without asking, one press left
 * fullscreen and left the panel in front of it open (measured by Athena's review).
 */
export function otherOverlayHoldsEscape(doc: Document): boolean {
  return doc.querySelector(
    '[role="dialog"][aria-modal="true"], [data-owns-escape]:not([data-shape-fullscreen]):not([data-fullscreen])',
  ) !== null;
}

/** Whether something matching `selector` is drawn IN FRONT OF `content` — inside it, or after it in document order. */
function drawnInFront(content: HTMLElement, doc: Document, selector: string): boolean {
  // `element !== content` is for a panel that matches its own selector (a Sheet is `role="dialog"`);
  // a panel is never in front of itself.
  return Array.from(doc.querySelectorAll(selector)).some((element) => (
    element !== content
    && (content.contains(element)
      || (content.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  ));
}

/**
 * Whether a panel that OWNS ESCAPE is drawn IN FRONT OF `content` — the one case where the key is
 * not the content's to take. Asked by `Dialog` and `Sheet`, the two panels that listen on their host
 * `window` in the capture phase.
 *
 * TWO WAYS TO BE IN FRONT, and they are the two ways these panels are drawn. *In place*: a Menu or a
 * Select inside the dialog, whose panel is a descendant of it. *Portalled*: a panel appended to
 * `<body>` as it opened, so it comes after the dialog's own portal node in document order — which is
 * also what puts it above, a portalled menu carrying a higher z than the panel it belongs to.
 * Anything earlier is BEHIND — a composer menu left open under a dialog opened after it — and then
 * the key is the asker's again.
 *
 * `doc` is the asker's host document: a panel open in the picture-in-picture window lives in that
 * window's document, and the opener's holds none of them.
 *
 * The candidates are the panels that STATE they own the key (`OWNS_ESCAPE`), not every element
 * carrying some role. Scanning `[role="menu"], [role="listbox"]` here was wrong, and shipped for one
 * pass: cmdk's list carries `role="listbox"` as STATIC content of the dialog it is placed in, so the
 * command palette stood the dialog down on every Escape and nothing else took the key — the
 * palette's only pointerless dismissal, dead.
 *
 * Why a panel has to ask at all: it listens on its host `window` in the CAPTURE phase, which fires
 * before every `document` listener an overlay uses, and it stops the event when it acts on it. An
 * overlay above it would never see the key. Asking first is what lets Escape mean "the menu" and
 * then, on the next press, "the sheet".
 */
export function overlayInFrontHoldsEscape(content: HTMLElement | null, doc: Document): boolean {
  // No panel: the asker is mid-mount, and nothing can be in front of one that is not on screen.
  if (content === null) return false;
  return drawnInFront(content, doc, OWNS_ESCAPE_SELECTOR);
}

/**
 * `overlayInFrontHoldsEscape` for a panel with a MODAL DIALOG that can open over it: the same
 * question, with `[role="dialog"][aria-modal="true"]` among the candidates.
 *
 * Asked by `Sheet`, and only by it. A `Dialog` does not carry `OWNS_ESCAPE` — it IS the thing that
 * takes the key — so the marker rule alone leaves a sheet blind to the dialog its own Mute button
 * opens in front of it; and since both listen on `window` in the capture phase, where
 * `stopPropagation` does not keep the second listener from running, one press would close the dialog
 * AND the sheet. A dialog drawn BEHIND the sheet is no candidate (document order, above), which is
 * right: the sheet is the one in front and the key is its.
 */
export function modalInFrontHoldsEscape(content: HTMLElement | null, doc: Document): boolean {
  if (content === null) return false;
  return drawnInFront(content, doc, `${OWNS_ESCAPE_SELECTOR}, [role="dialog"][aria-modal="true"]`);
}
