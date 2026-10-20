import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';

/**
 * `hint` is secondary text drawn beside the label in a muted ink, for a choice whose label alone
 * does not name it (two projects both called `app`). It is never part of `label`, so what a caller
 * reads back as the label stays the name.
 */
type SelectOption = { value: string; label: string; hint?: string };

/**
 * The one row in the panel that is not a choice — it MAKES something to choose, and closes the
 * panel on the way. A picker whose list is empty or missing the thing you came for is a dead end
 * otherwise, and the way out of that dead end belongs where the reader already is.
 */
type SelectAction = { label: string; onSelect: () => void };

type SelectProps = {
  options: SelectOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** The accessible name. A select whose label is a heading two rows up needs its own. */
  ariaLabel: string;
  /** `sm` is the dense form for narrow chrome (the sidebar), sized to the `sm` Button. */
  size?: 'md' | 'sm';
  /** The trigger is dimmed and refuses the press: a picker that shows a value the reader cannot change now. */
  disabled?: boolean;
  /** Optional. Drawn under the list, behind a hairline, outside the listbox. */
  action?: SelectAction;
};

/** The gap between a trigger and its panel, and how near the screen's edge a panel may stand, in px. */
const PANEL_GAP = 6;
const PANEL_MARGIN = 8;

/**
 * Put `panel` — fixed on `body` — against `trigger`: below it when the whole panel fits there, above it when that is
 * the roomier side, held `PANEL_MARGIN` in from the screen's edges, and capped to the room it has when neither side
 * holds it whole (the list then scrolls inside the panel). Returns whether the trigger is still on screen at all.
 *
 * The panel's size is its LAYOUT box (`offsetWidth` / `offsetHeight`), never `getBoundingClientRect`: it enters on a
 * `vv-pop` animation whose first frame is already scaled and shifted, and that is not the room the panel will take.
 * Its width is the trigger's, set before it is measured; the CSS floor (`min-width`) widens a narrow trigger's panel.
 */
function placePanel(trigger: HTMLElement, panel: HTMLElement, view: Window): boolean {
  const at = trigger.getBoundingClientRect();
  panel.style.setProperty('--vv-select-trigger-width', `${at.width}px`);
  panel.style.maxHeight = '';
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const roomBelow = view.innerHeight - PANEL_MARGIN - (at.bottom + PANEL_GAP);
  const roomAbove = at.top - PANEL_GAP - PANEL_MARGIN;
  const opensUp = height > roomBelow && roomAbove > roomBelow;
  const room = opensUp ? roomAbove : roomBelow;
  if (height > room) panel.style.maxHeight = `${Math.max(room, 96)}px`;
  const shown = Math.min(height, Math.max(room, 96));
  panel.style.left = `${Math.max(PANEL_MARGIN, Math.min(at.left, view.innerWidth - width - PANEL_MARGIN))}px`;
  panel.style.top = `${opensUp ? at.top - PANEL_GAP - shown : at.bottom + PANEL_GAP}px`;
  return at.bottom > 0 && at.top < view.innerHeight && at.right > 0 && at.left < view.innerWidth;
}

/** An option's label, then its muted hint when it has one; the trigger and every row draw it the same way. */
function OptionText({ option }: { option: SelectOption }) {
  return (
    <>
      {option.label}
      {/* A real space before the hint: the gap CSS draws is not text, so the accessible name and a copied label would run the two words together. */}
      {option.hint && <>{' '}<span className="vv-select__hint">{option.hint}</span></>}
    </>
  );
}

/**
 * A single-choice picker with a chevron trigger and an overlay list.
 * Used by settings (Phase 4) for the language, theme and provider choices, by the file
 * manager (Phase 8) for its sort order, and by the cerberus module for History's check — the
 * native `<select>` cannot be painted in Verve's shape, so this is the one place the app spells a
 * styled one.
 *
 * An optional `action` draws ONE row under the list, behind a hairline and outside the listbox —
 * the kanban board switcher's "New board". It is a button and not an option, because choosing it
 * makes a thing rather than picking one, and a listbox that held a button would announce the
 * button as a choice.
 *
 * Dismissal is deliberately two-way: a pointer anywhere outside closes it, and Escape closes
 * it without moving the pointer at all. A panel that only closes on a click is a panel a
 * keyboard user is stuck inside — and Escape returns focus to the trigger, because the list
 * unmounts under the focused option and focus would otherwise fall to <body>, sending the
 * reader back to the top of the page. An outside pointerdown does NOT take focus: the pointer
 * has already chosen where to go.
 *
 * A list that scrolls opens on its chosen row, centred, not at its top. History's picker of every
 * Cerberus check holds dozens, and a list opened at its top hid the very choice being reconsidered.
 *
 * THE PANEL IS DRAWN ON THE HOST WINDOW'S `body`, FIXED AGAINST ITS TRIGGER, never beside it in the DOM: drawn in place
 * it was cut off by the first ancestor with an overflow — a card's fold, a scrolling widget, a swipe strip — and the
 * options past that edge could not be reached. On `body` nothing clips it (`placePanel`: below the trigger or above it,
 * whichever has the room, held in from the screen's edges). It FOLLOWS the trigger on every scroll and resize
 * (the trigger leaving the screen closes it). Because the panel is no longer after the trigger in the tab order, opening
 * moves focus to the chosen row, the arrow keys, Home and End move between rows, and Tab closes the panel and hands
 * focus back to the trigger — what Tab did before, when the rows stood beside it.
 */
export function Select({ options, value, onChange, placeholder = 'Choose…', ariaLabel, size = 'md', disabled = false, action }: SelectProps) {
  const hostWindow = useHostWindow();
  // Whether the overlay list is showing. It cannot be derived: `value` is the choice already
  // made, and the list is open precisely while the reader is reconsidering it.
  const [open, setOpen] = useState(false);
  // A picker that turns disabled with its list open closes it. The panel is only hidden while `disabled`, and the
  // flag left standing would bring the list back, with no press, the moment the picker is enabled again (the master
  // controller's epics dropdown, disabled while a press is out). Set while rendering, which React re-runs at
  // once, so the stale `open` is never committed.
  if (disabled && open) setOpen(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The panel's place, taken before it paints and kept as the page moves: against the trigger, in the viewport
  // (`placePanel`). Written straight onto the panel, not through state — it is a measurement of the page, and a
  // render per scroll frame would only repeat it. Scroll and resize are heard on the host window in the capture
  // phase, so a scroll of ANY ancestor reaches it; a scroll of the panel's own list is the reader moving through the
  // options and moves nothing. The trigger leaving the screen closes the panel. Declared before the effect below, which
  // needs the panel at its final height: a panel capped to short room scrolls its list.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!open || !trigger || !panel) return undefined;
    placePanel(trigger, panel, hostWindow);
    let frame = 0;
    const follow = (event: Event) => {
      if (event.type === 'scroll' && panel.contains(event.target as Node)) return;
      hostWindow.cancelAnimationFrame(frame);
      frame = hostWindow.requestAnimationFrame(() => {
        if (!placePanel(trigger, panel, hostWindow)) setOpen(false);
      });
    };
    hostWindow.addEventListener('scroll', follow, true);
    hostWindow.addEventListener('resize', follow);
    return () => {
      hostWindow.cancelAnimationFrame(frame);
      hostWindow.removeEventListener('scroll', follow, true);
      hostWindow.removeEventListener('resize', follow);
    };
  }, [open, hostWindow]);

  // Before the panel paints, its list scrolls to the chosen row, and focus moves onto it (the first row when none is
  // chosen): the panel stands on `body`, not after the trigger, so a keyboard reader cannot Tab into it. The list's own
  // `scrollTop` is set rather than `scrollIntoView`, which would scroll the page under the panel as well. Both offsets are
  // measured from the panel, the rows' positioned ancestor, so their difference is the row's place in the list. A list that
  // does not scroll is untouched, and the browser clamps the ends. Focus is taken without scrolling.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const chosen = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (chosen) list.scrollTop = chosen.offsetTop - list.offsetTop - (list.clientHeight - chosen.offsetHeight) / 2;
    (chosen ?? list.querySelector<HTMLElement>('[role="option"]'))?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      // The panel is on `body`, not inside the root, so a press on one of its rows is not "outside".
      if (rootRef.current && !rootRef.current.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    // The host window's document: a panel opened in the floating window hears that window's pointer
    // and keys, not the opener's.
    const hostDocument = hostWindow.document;
    hostDocument.addEventListener('pointerdown', closeOnOutsidePointer);
    hostDocument.addEventListener('keydown', closeOnEscape);
    return () => {
      hostDocument.removeEventListener('pointerdown', closeOnOutsidePointer);
      hostDocument.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, hostWindow]);

  const selected = options.find((option) => option.value === value);

  // Tab leaves the panel the way it left the rows when they stood beside the trigger: it closes and focus goes back to
  // the trigger, whence the reader's next Tab moves on. The arrows, Home and End walk the rows.
  const walkRows = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key as 'ArrowDown' | 'ArrowUp'];
    if (step === undefined && event.key !== 'Home' && event.key !== 'End') return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
    const at = rows.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (step ?? 0)));
    event.preventDefault();
    rows[next]?.focus({ preventScroll: false });
  };

  // The panel, drawn on `body` (see the head), fixed against the trigger once it is placed.
  const panel = open && !disabled && (
    // The panel owns Escape while it is up — see `shared/ui/overlayEscape`.
    // A div holding the listbox rather than being it: the action row is a button, and a button
    // is not a thing a listbox may contain. The list is what scrolls, so the action stays put
    // at the bottom of a panel of thirty boards instead of hiding under the thirtieth.
    <div
      ref={panelRef}
      // On `body` the panel is no longer under `.vv-select--sm`, whose rules size its rows: it wears the class itself.
      className={cn('vv-select__panel', size === 'sm' && 'vv-select--sm')}
      onKeyDown={walkRows}
      {...OWNS_ESCAPE}
    >
      <ul ref={listRef} className="vv-select__list" role="listbox" aria-label={ariaLabel}>
        {options.map((option) => (
          <li
            key={option.value}
            className="vv-select__option flex items-center justify-between gap-2"
            role="option"
            aria-selected={option.value === value}
            tabIndex={0}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onChange(option.value);
              setOpen(false);
            }}
          >
            {/* A hinted option truncates like the trigger does: a hint of three long folder names would wrap and clip mid-word. */}
            <span className={cn('min-w-0', option.hint && 'truncate')}>
              <OptionText option={option} />
            </span>
          </li>
        ))}
      </ul>

      {action && (
        <button
          type="button"
          className="vv-select__action flex w-full items-center gap-2"
          onClick={() => {
            setOpen(false);
            action.onSelect();
          }}
        >
          <span aria-hidden="true">+</span>
          {action.label}
        </button>
      )}
    </div>
  );

  return (
    <div className={cn('vv-select', size === 'sm' && 'vv-select--sm')} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="vv-select__trigger flex w-full items-center justify-between gap-2.5"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className={cn('truncate', !selected && 'vv-select__placeholder')}>
          {selected ? <OptionText option={selected} /> : placeholder}
        </span>
        <span className="vv-select__chevron inline-block shrink-0" aria-hidden="true">
          ▼
        </span>
      </button>

      {panel ? createPortal(panel, hostWindow.document.body) : null}
    </div>
  );
}
