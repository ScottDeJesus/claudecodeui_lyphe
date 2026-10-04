/**
 * Which presses on an item may begin a carry: the ones that land on nothing the page already gave a
 * meaning to.
 *
 * AN ITEM IS A WHOLE CARD, and a card is mostly controls. A press that began on a button, a menu, a
 * field, a link or a toggle belongs to that control (it is about to be a click, a caret, a choice),
 * and so does a press on a track the reader scrolls sideways by hand — the phase track, a deck's
 * strip of plans: a carry that started there would fight the very gesture the region exists for. What
 * is left is the card itself: its title, its words, its badges, its pills, its padding.
 *
 * THE TEST IS ON THE ELEMENT THE PRESS LANDED ON, read from the DOM and not from the card's own
 * code, so a control added to a card tomorrow is a control here without anyone remembering to say so:
 * the interactive elements (by tag, and by the ARIA roles a widget made of divs wears) and any
 * ancestor, up to the item, that scrolls sideways right now. A region that scrolls sideways only
 * while its content overflows is read as it is at the press — a strip of one plan has nothing to swipe.
 *
 * A press whose element is not INSIDE the item is refused too. React bubbles an event along the
 * component tree, portals included, so a press inside a dialog or a menu that a card opened arrives at
 * the card's own handler with a target that is somewhere else in the document.
 *
 * A NESTED LIST'S PRESS IS ITS OWN LIST'S. An item may hold a sortable list of its own (a card of rows),
 * and `usePointerDrag` never stops a press it accepted, so one press on a row reaches the row's handler
 * and then the card's. Each item carries `SORTABLE_ITEM_ATTRIBUTE`, and a press whose nearest marked
 * ancestor is not this item belongs to the list inside it: the outer list refuses it. The test is on the
 * DOM, like the rest, so any nesting works with no code in the screens that nest.
 */

/** Everything a press on which is the control's own, never a carry's. */
const INTERACTIVE = [
  'a[href]', 'button', 'input', 'textarea', 'select', 'summary', 'label', '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]', '[role="link"]', '[role="menu"]', '[role="menuitem"]', '[role="tab"]', '[role="toolbar"]',
  '[role="slider"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]', '[role="combobox"]',
  '[role="textbox"]', '[role="listbox"]', '[role="option"]',
].join(',');

/** Whether `node` scrolls along its row right now: a sideways overflow the reader can swipe. */
function scrollsSideways(node: Element): boolean {
  const { overflowX } = getComputedStyle(node);
  return (overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;
}

/** The attribute `useSortable` puts on every item it carries, which `isFreePress` reads to tell a nested list's item from this one. Used by `useSortable`. */
export const SORTABLE_ITEM_ATTRIBUTE = 'data-sortable-item';

/** Used by `useSortable` as the press filter of every item it carries. */
export function isFreePress(target: EventTarget | null, item: Element): boolean {
  if (!(target instanceof Element) || !item.contains(target)) return false;
  if (target.closest(`[${SORTABLE_ITEM_ATTRIBUTE}]`) !== item) return false;
  const control = target.closest(INTERACTIVE);
  if (control !== null && item.contains(control)) return false;
  for (let node: Element | null = target; node !== null && node !== item; node = node.parentElement) {
    if (scrollsSideways(node)) return false;
  }
  return true;
}
