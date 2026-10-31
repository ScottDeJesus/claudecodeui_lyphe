import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { OWNS_ESCAPE, overlayInFrontHoldsEscape } from '@/shared/ui/overlayEscape';
import { useEdgeShift } from '@/shared/ui/useEdgeShift';

type MenuItem = {
  id: string;
  label: string;
  description?: string;
  /** Marks the row as the current choice — filled and ticked, so it survives greyscale. */
  selected?: boolean;
};

type MenuProps = {
  trigger: ReactNode;
  /** Panel width in px. The panel hangs from the trigger's left edge, so a width sizes what hangs there. */
  width?: number;
} & (
  | { items: MenuItem[]; onSelect: (id: string) => void }
  | {
      /**
       * A PANEL OF THE CALLER'S OWN CONTROLS in place of a choice list (a picker, switches, buttons), hung under the trigger
       * with the same dismissal and the same width rule. Named by `label` and announced as a dialog: it holds controls, not
       * menu items, so it is no `role="menu"`. The station's compact head is the site: her controls behind "Her controls".
       */
      panel: ReactNode;
      /** The panel's name for a screen reader ("Her controls"). */
      label: string;
    }
);

/**
 * A choice list hung under whatever the caller hands in as its trigger.
 *
 * Used by the affected-areas module: `MarkPresses`' Rename to… and `FacePhoto`'s kind menu for a
 * missed area; and, as a panel of controls (`panel`), by the station module's compact head: her
 * controls behind "Her controls". A Select owns ONE value and shows it in its own trigger; a Menu
 * decorates a trigger the caller already drew.
 *
 * Dismissal is two-way for the same reason Select's is: a pointer outside closes it, and
 * Escape closes it without moving the pointer, handing focus back to the trigger rather than
 * dropping it on <body> when the panel unmounts underneath it. There is deliberately NO focus
 * trap and no arrow-key roving — every item is a tab stop, and no site asks for more.
 *
 * THE PANEL STAYS INSIDE THE WINDOW'S WIDTH (`useEdgeShift`): it hangs from a trigger that can stand anywhere
 * in a row, and the Mark screen's 248 px Rename panel ran 10 px off a 390 window from a trigger at x=152.
 *
 * A FINGER DISMISSES ON LIFT, NOT ON LANDING. A panel with a long list (the Rename menu: 14 kinds, 842 px) is taller
 * than a phone, so the page has to scroll to reach its foot, and a scroll begins as a `pointerdown` outside the
 * panel. The browser tells a scroll from a tap afterwards — `pointerup` for a tap, `pointercancel` for a scroll,
 * measured at 390 × 664 with CDP touch — so a touch (or pen) outside waits for it. A mouse has no such ambiguity
 * and still closes on the press.
 *
 * A PANEL OF CONTROLS (`panel`) holds overlays of its own that are drawn on `body`: a `Select`'s list, a `ConfirmDialog`.
 * A press inside one is outside the panel in the document but inside it in the React tree, and closing on it would unmount
 * the picker under the press and lose the choice; so a press is "inside" by the tree (`onPointerDownCapture`, which React
 * delivers through portals), never by the document alone. Escape stands down while a panel drawn in front of this one
 * owns the key (a picker's list open inside it), so one press closes the list and the next the menu.
 */
export function Menu(props: MenuProps) {
  const { trigger, width } = props;
  const hostWindow = useHostWindow();
  // Whether the panel is showing. Not derivable: `selected` is the choice already made, and
  // the panel is open precisely while the reader is reconsidering it.
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // The last press React delivered to this menu's tree (its trigger, its panel, or an overlay a control in the panel drew on
  // `body`), so the document's listener can tell it from a press outside: the same native event, seen by both.
  const pressInside = useRef<Event | null>(null);
  const panelId = useId();
  const edgeShift = useEdgeShift(panelRef, open, hostWindow);

  useEffect(() => {
    if (!open) return;

    // The finger now down outside the panel, waiting to be told whether it is a tap or a scroll.
    let stopWaitingForLift = () => {};
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current || rootRef.current.contains(event.target as Node) || pressInside.current === event) return;
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
        setOpen(false);
        return;
      }
      stopWaitingForLift();
      const { pointerId } = event;
      const closeOnTap = (lift: PointerEvent) => {
        if (lift.pointerId !== pointerId) return;
        stopWaitingForLift();
        if (lift.type === 'pointerup') setOpen(false);
      };
      hostWindow.document.addEventListener('pointerup', closeOnTap);
      hostWindow.document.addEventListener('pointercancel', closeOnTap);
      stopWaitingForLift = () => {
        hostWindow.document.removeEventListener('pointerup', closeOnTap);
        hostWindow.document.removeEventListener('pointercancel', closeOnTap);
        stopWaitingForLift = () => {};
      };
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayInFrontHoldsEscape(panelRef.current, hostWindow.document)) return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    // The host window's document: a panel opened in the floating window hears that window's pointer
    // and keys, not the opener's.
    const hostDocument = hostWindow.document;
    hostDocument.addEventListener('pointerdown', closeOnOutsidePointer);
    hostDocument.addEventListener('keydown', closeOnEscape);
    return () => {
      // A half-held gesture must not outlive its window (MAN-7451): the pointer state goes with the listeners.
      stopWaitingForLift();
      hostDocument.removeEventListener('pointerdown', closeOnOutsidePointer);
      hostDocument.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, hostWindow]);

  const choose = (id: string) => {
    if ('onSelect' in props) props.onSelect(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // `minWidth` travels with `width`, or the prop does nothing below 200px: feedback.css gives the panel a 200px floor for the
  // callers that pass no width, and a floor beats an inline width. A prop ignored across a third of its range is worse than
  // no prop at all (doctrine §8). A panel of controls takes `width` as a most, never a floor: the window less the edge shift's
  // margins comes first (`.vv-menu__panel--controls`' max-width), so on a phone narrower than the panel its controls wrap.
  const panelStyle = {
    ...(width ? { width, ...('items' in props ? { minWidth: width } : null) } : null),
    translate: edgeShift ? `${edgeShift}px` : undefined,
  };

  return (
    <div className="vv-menu inline-block" ref={rootRef} onPointerDownCapture={(event) => { pressInside.current = event.nativeEvent; }}>
      <button
        ref={triggerRef}
        type="button"
        className="vv-menu__trigger"
        aria-haspopup={'panel' in props ? 'dialog' : 'menu'}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {trigger}
      </button>

      {open && 'panel' in props && (
        <div
          ref={(node) => { panelRef.current = node; }}
          id={panelId}
          role="dialog"
          aria-label={props.label}
          className="vv-menu__panel vv-menu__panel--controls"
          // The panel owns Escape while it is up — see `shared/ui/overlayEscape`.
          {...OWNS_ESCAPE}
          style={panelStyle}
        >
          {props.panel}
        </div>
      )}

      {open && 'items' in props && (
        <ul
          ref={(node) => { panelRef.current = node; }}
          id={panelId}
          className="vv-menu__panel"
          role="menu"
          // The panel owns Escape while it is up — see `shared/ui/overlayEscape`.
          {...OWNS_ESCAPE}
          style={panelStyle}
        >
          {props.items.map((item) => (
            <li
              key={item.id}
              className="vv-menu__item flex items-start justify-between gap-3"
              role="menuitem"
              // `aria-current`, not `aria-selected`: the rows are menu items, and a menuitem
              // that reports selection has to be a menuitemradio — which would announce every
              // other row as an unchecked radio even in a menu that is a list of actions.
              aria-current={item.selected ? 'true' : undefined}
              tabIndex={0}
              onClick={() => choose(item.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                choose(item.id);
              }}
            >
              <span className="min-w-0">
                <span className="block">{item.label}</span>
                {item.description && <span className="vv-menu__description block">{item.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
