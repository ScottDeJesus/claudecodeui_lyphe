import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Card } from '@/shared/ui';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';

// File-local: the panel's stance, measured at the press.
type PopoverPlacement = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/** The panel's width where the window has room; a 420px window still leaves it 8px off each edge. */
const PANEL_WIDTH = 360;
/** The tallest the panel grows before its list scrolls. */
const PANEL_MAX_HEIGHT = 440;
/** Room the panel keeps from the trigger and from the window's edges, in px. */
const GAP = 6;
const MARGIN = 8;
/** Below this much room under the trigger the panel opens ABOVE it, when there is more room there. */
const MIN_ROOM_BELOW = 260;
/** What the arrows walk and a press closes on: New chat, every conversation row, Show more. */
const ITEM_SELECTOR = '[data-picker-item]';

/** Where the panel stands: under the trigger from its left edge, clamped into the window; above it when the room below is short. */
function placePanel(trigger: DOMRect, viewport: { width: number; height: number }): PopoverPlacement {
  const width = Math.min(PANEL_WIDTH, viewport.width - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(trigger.left, viewport.width - width - MARGIN));
  const below = viewport.height - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  if (below >= MIN_ROOM_BELOW || below >= above) {
    return { left, width, top: trigger.bottom + GAP, maxHeight: Math.min(PANEL_MAX_HEIGHT, below) };
  }
  // Anchored by its bottom edge, so a panel shorter than its maxHeight still stands against the trigger.
  return { left, width, bottom: viewport.height - trigger.top + GAP, maxHeight: Math.min(PANEL_MAX_HEIGHT, above) };
}

type SidebarSessionPickerPopoverProps = {
  /** What the trigger holds: the open conversation's name and its project. It truncates itself. */
  trigger: ReactNode;
  /** The trigger's hover title. */
  triggerTitle: string;
  /** The panel's accessible name. */
  label: string;
  /** Held above the scrolling list, always in reach: New chat. */
  pinned: ReactNode;
  /** The list. It scrolls inside the panel when it outgrows it. */
  children: ReactNode;
};

/**
 * Used by SidebarSessionPickerMenu: the session picker's trigger button and the panel it opens.
 *
 * WHY NOT THE KIT'S MENU, ACTIONMENU OR SELECT. Each answers one of the three things this picker
 * needs and fails another. `Menu` takes any trigger but draws single-shape label rows, cannot
 * scroll, and hangs its panel IN PLACE, where the header slot's clip and the floating panel's
 * `overflow-hidden` cut it off. `ActionMenu` portals correctly but owns a one-line trigger. `Select`
 * owns its trigger too. The picker needs a two-line trigger, two row shapes with headings, and a
 * list that scrolls — the same call `AccountPopover` made, composing `Card` rather than adopting a
 * Menu. What it borrows from the kit's overlays is their rules: the panel is portalled to the HOST
 * window's body (so it opens in the picture-in-picture window when the chat is there), it carries
 * `OWNS_ESCAPE`, and it dismisses on an outside press and on Escape.
 *
 * ESCAPE is taken on a WINDOW capture listener with `preventDefault()`, not on the document as the
 * kit's menus do: the chat stops its running turn on an Escape from a document capture listener
 * unless the event is already marked, and window capture runs first. A picker opened over a working
 * chat must close on Escape and leave the turn alone.
 *
 * NOT ARIA'S MENU. The panel holds links and a button, and in its loading, empty and error states plain
 * text and a banner; a `menu` may own only menu items, so it is a labelled group the trigger discloses
 * (`aria-expanded`, `aria-controls`) and the items are marked `data-picker-item`. A press on an item
 * closes the panel unless the item also carries `data-keeps-open` (Show more).
 *
 * It also closes when the window blurs (a press inside the framed application, whose pointer stream
 * this document never hears) and when the window resizes; it stands at the trigger and would be
 * left behind by either. The panel opens ABOVE the trigger when the room below is short.
 */
export default function SidebarSessionPickerPopover({
  trigger,
  triggerTitle,
  label,
  pinned,
  children,
}: SidebarSessionPickerPopoverProps) {
  const hostWindow = useHostWindow();
  // Where the panel stands while it is open, and null while it is closed — so it is the open flag
  // too. It is measured at the press because the panel needs a position in its very first paint,
  // and the press is the only moment the trigger's box is known and the panel's does not exist yet.
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // Whether the press that opened the panel came from the keyboard, which is when focus moves in.
  const focusFirstItemRef = useRef(false);
  const isOpen = placement !== null;

  useEffect(() => {
    if (!isOpen) return;

    const close = () => setPlacement(null);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Marked here, from window capture, so the chat's own Escape (document capture) stands down.
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };

    const hostDocument = hostWindow.document;
    hostDocument.addEventListener('pointerdown', closeOnOutsidePointer);
    hostWindow.addEventListener('keydown', closeOnEscape, { capture: true });
    hostWindow.addEventListener('resize', close);
    hostWindow.addEventListener('blur', close);
    return () => {
      hostDocument.removeEventListener('pointerdown', closeOnOutsidePointer);
      hostWindow.removeEventListener('keydown', closeOnEscape, { capture: true });
      hostWindow.removeEventListener('resize', close);
      hostWindow.removeEventListener('blur', close);
    };
  }, [isOpen, hostWindow]);

  useEffect(() => {
    if (!isOpen || !focusFirstItemRef.current) return;
    focusFirstItemRef.current = false;
    panelRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [isOpen]);

  const toggle = (event: { detail: number }) => {
    if (isOpen) {
      setPlacement(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    focusFirstItemRef.current = event.detail === 0;
    setPlacement(placePanel(rect, { width: hostWindow.innerWidth, height: hostWindow.innerHeight }));
  };

  // The panel's own keys: the arrows walk the items (a list of thirty is not thirty tab stops), and
  // Tab leaves the panel for the trigger's neighbour, because the panel is portalled to the end of
  // the body and its natural tab order would land past the whole window.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Tab') {
      setPlacement(null);
      triggerRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(hostWindow.document.activeElement as HTMLElement);
    const last = items.length - 1;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? last
        : event.key === 'ArrowDown' ? (at >= last ? 0 : at + 1)
          : (at <= 0 ? last : at - 1);
    items[next].focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="session-picker-trigger"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        title={triggerTitle}
        onClick={toggle}
        onKeyDown={(event) => {
          // A panel opened by a press leaves focus on the trigger; the arrow walks into it from here.
          if (!isOpen || event.key !== 'ArrowDown') return;
          event.preventDefault();
          panelRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
        }}
        // The 36px trigger carries a transparent catch to the header's full 40px, the collapse control's own trick.
        className="group relative flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2 text-left transition-colors before:absolute before:-inset-y-0.5 before:inset-x-0 before:content-[''] hover:bg-accent/60 aria-expanded:bg-accent/60"
      >
        {trigger}
        <ChevronDown
          aria-hidden="true"
          className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none"
        />
      </button>

      {placement && createPortal(
        <Card
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={label}
          data-testid="session-picker-panel"
          // The panel closes itself on Escape while it is up, so it says so: a dialog it opened over
          // stands its own Escape down for it. See `shared/ui/overlayEscape`.
          {...OWNS_ESCAPE}
          // z-70: the kit's own portalled-menu level, over the floating panel (45) and the FAB (60).
          className="fixed z-[70] flex flex-col overflow-hidden"
          style={{
            left: placement.left,
            width: placement.width,
            top: placement.top,
            bottom: placement.bottom,
            maxHeight: placement.maxHeight,
            boxShadow: 'var(--shadow-overlay)',
            animation: 'vv-pop 0.25s var(--ease-enter) both',
          }}
          onKeyDown={handleKeyDown}
          onClick={(event) => {
            // Choosing New chat or a row closes the panel and hands focus back; Show more keeps it open.
            if (!(event.target as Element).closest(`${ITEM_SELECTOR}:not([data-keeps-open])`)) return;
            setPlacement(null);
            triggerRef.current?.focus();
          }}
        >
          <div className="flex-shrink-0 p-1.5 pb-1">{pinned}</div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5">{children}</div>
        </Card>,
        hostWindow.document.body,
      )}
    </>
  );
}
