import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, type LucideIcon } from 'lucide-react';

import { cn } from '@/shared/utils';
import { Button } from '@/shared/ui/Button';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export type ActionMenuItem = {
  key: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
  isDanger?: boolean;
  showDividerBefore?: boolean;
  closeOnSelect?: boolean;
};

type ActionMenuProps = {
  label: string;
  items: ActionMenuItem[];
  icon?: LucideIcon;
  ariaLabel?: string;
  align?: 'left' | 'right';
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  /**
   * Render the menu into a portal on `document.body` instead of in place beside its trigger.
   *
   * ON by default, because in place is not a neutral choice: the menu is clipped by the first
   * ancestor with `overflow: hidden` and painted inside the first ancestor that makes a stacking
   * context, whether or not the caller knows one is there. Measured on the live app before this
   * default changed: the transcript's Download menu was cut off at the composer form's bottom
   * edge on desktop and drawn UNDER the transcript on a phone, where the header's
   * `backdrop-filter` scopes the menu's `z-50` to the header's own layer
   * (`.verify/export-menu-layer.mjs`). Seven of the nine call sites had already passed the flag by
   * hand for the same reason, and the two that had not were that bug and the case below; the
   * default is what makes the knowledge unnecessary everywhere else.
   *
   * Pass `false` in the two cases the default cannot serve, both measured rather than assumed:
   * when the menu must scroll with its trigger rather than the viewport (the portal path closes
   * on the first scroll), and when the trigger sits inside an overlay whose own layer outranks
   * the portal's `z-[70]` — a menu portalled out of Settings' `fixed z-[9999]` panel is drawn
   * under that panel's content, which is why `McpServers` asks for the in-place menu.
   */
  portal?: boolean;
  header?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
};

/** Used by the mcp and sidebar modules for the "…" overflow menu on a server or session row. */
export function ActionMenu({
  label,
  items,
  icon: TriggerIcon,
  ariaLabel,
  align = 'right',
  variant = 'outline',
  size = 'sm',
  className,
  triggerClassName,
  menuClassName,
  disabled,
  iconOnly = false,
  portal = true,
  header,
  onOpenChange,
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [portalPosition, setPortalPosition] = React.useState<{ top: number; left: number } | null>(null);
  /** Horizontal correction that pulls a non-portal menu back inside the viewport. */
  const [edgeShift, setEdgeShift] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  // Whether closing should move focus back to the trigger. Set for keyboard
  // (Escape) and item selection, but left false for outside pointer clicks so
  // focus is not stolen from wherever the user clicked.
  const restoreFocusRef = React.useRef(false);
  const focusMenuOnOpenRef = React.useRef(false);
  const wasOpenRef = React.useRef(false);
  const menuId = React.useId();

  const setMenuOpen = React.useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setPortalPosition(null);
    }
    onOpenChange?.(open);
  }, [onOpenChange]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current
        && !rootRef.current.contains(target)
        && !menuRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        restoreFocusRef.current = true;
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen, setMenuOpen]);

  React.useEffect(() => {
    if (!isOpen || !portal) {
      return;
    }

    const closeOnViewportChange = () => setMenuOpen(false);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [isOpen, portal, setMenuOpen]);

  // Move focus into the menu on open and back to the trigger on a keyboard or
  // selection close, so keyboard and screen-reader navigation match the menu role.
  React.useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      if (focusMenuOnOpenRef.current) {
        const menu = menuRef.current;
        const firstItem = menu?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
        (firstItem ?? menu)?.focus();
      }
      return;
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      if (restoreFocusRef.current) {
        triggerRef.current?.focus();
      }
      restoreFocusRef.current = false;
    }
  }, [isOpen]);

  const runItem = (item: ActionMenuItem) => {
    if (item.disabled || item.loading) {
      return;
    }

    if (item.closeOnSelect !== false) {
      restoreFocusRef.current = true;
      setMenuOpen(false);
    }
    item.onSelect();
  };

  /**
   * Places the portalled menu against its trigger from the box the menu ACTUALLY has.
   *
   * The flip used to be decided from a hand-written height estimate (58px an item, 40px without a
   * description) and then positioned from that same estimate. Measured on the composer at
   * 1280×900: the estimate said 238px where the menu measures 261 — one description wraps at the
   * pinned 260px width — so a menu placed "above" still covered the trigger's top 17px, and the
   * item hanging over it was the last one. A click aimed at Download, or at the model or permission
   * control beside it, started a JSON export instead; the button could not even close its own menu,
   * because the click landed inside the menu. Re-run against `.verify/export-menu-layer.mjs`.
   *
   * Re-running this is safe: what it returns depends on the trigger's box, the menu's own box and
   * the viewport, never on where the menu currently sits, so it cannot feed on its own output.
   */
  const placePortalledMenu = React.useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!trigger || !menu) {
      return null;
    }
    // Size, from the LAYOUT box rather than from `getBoundingClientRect`: the menu enters on
    // `vv-pop` (`translateY(24px) scale(.96)` → `none`, tokens.css), and `animation-fill-mode:
    // both` puts that start state on the element in the very frame this runs in — so the rect here
    // is 0.96 of the truth and 24px below it. Measured at the composer: 250×251 on this line
    // against the 260×261 the menu settles at, which left the last item over the trigger's top 4px
    // even after the estimate above was gone. `offsetWidth`/`offsetHeight` are the layout box, and
    // a transform — including one on an ancestor — never touches them; no ancestor of a portalled
    // menu has a transform that could, since the portal mounts on `body`.
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const gap = 6;
    const margin = 8;
    // `align` is a horizontal anchor, so the portal path clamps the same two edges the in-place
    // `right-0` / `left-0` do. No mount passes `align` today — `right` is what every caller wants —
    // so this is a guard rather than a cure: without it a portalled menu would answer a future
    // `left` with a right-aligned box and never say so.
    const anchor = align === 'left' ? trigger.left : trigger.right - width;
    return {
      // Below when the whole menu fits there, above when it does not. A menu too tall for either
      // side keeps its bottom inside the viewport instead: overlapping the trigger is survivable,
      // running off the screen is not.
      top: trigger.bottom + gap + height <= window.innerHeight - margin
        ? trigger.bottom + gap
        : Math.max(margin, Math.min(trigger.top - gap - height, window.innerHeight - margin - height)),
      left: Math.max(margin, Math.min(anchor, window.innerWidth - width - margin)),
    };
  }, [align]);

  const toggleMenu = () => {
    if (isOpen) {
      setMenuOpen(false);
      return;
    }

    if (portal && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 260;
      // First paint only, below the trigger: the menu has to exist before it can be measured, and
      // the layout effect below replaces these numbers with the real box before anything is drawn.
      const anchor = align === 'left' ? rect.left : rect.right - menuWidth;
      setPortalPosition({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(anchor, window.innerWidth - menuWidth - 8)),
      });
    }
    setMenuOpen(true);
  };

  // The real placement, and a layout effect because it belongs to the paint that shows the menu:
  // the estimate is on screen for no frame at all, the browser paints the measured position or
  // nothing. It runs once per open — the menu's layout box does not change while it is open, and a
  // viewport resize closes the menu (`closeOnViewportChange` above) rather than re-placing it.
  React.useLayoutEffect(() => {
    if (!isOpen || !portal) {
      return;
    }
    const next = placePortalledMenu();
    // The position is a measurement of a box that does not exist until the menu has committed, so
    // it cannot be derived during render, and there is no earlier event to set it from: the click
    // that opens the menu happens before the menu exists. A layout effect is the only place the
    // real box can be read, and the update is a no-op when the estimate was already right.
    if (next) {
      // eslint-disable-next-line react/set-state-in-effect -- measurement after commit, by design
      setPortalPosition((current) => (
        current && current.top === next.top && current.left === next.left ? current : next
      ));
    }
  }, [isOpen, portal, placePortalledMenu]);

  // `portal={false}` renders the menu in place, absolutely positioned against its trigger, so
  // `right-0` walks it off the LEFT edge whenever the trigger sits near it — measured on a 390px
  // phone, the transcript's export menu opened from x=75 and ran to -185. The portal branch above
  // already clamps; this gives the same guarantee to the in-place branch that cannot, as a
  // constant horizontal nudge. That branch has one caller — `McpServers`, on the note above its
  // trigger — and is kept for it and for a menu that must scroll with its trigger.
  //
  // A constant is enough and a re-measure is not: the shift corrects a HORIZONTAL overflow, and
  // vertical scrolling moves the menu with its trigger without changing that. Measuring with the
  // current shift subtracted keeps the effect from feeding on its own output and oscillating.
  React.useLayoutEffect(() => {
    if (!isOpen || portal || !menuRef.current) {
      setEdgeShift(0);
      return;
    }
    const box = menuRef.current.getBoundingClientRect();
    const left = box.left - edgeShift;
    const right = box.right - edgeShift;
    const margin = 8;
    let next = 0;
    if (right > window.innerWidth - margin) next = window.innerWidth - margin - right;
    if (left + next < margin) next = margin - left;
    if (next !== edgeShift) setEdgeShift(next);
  }, [isOpen, portal, edgeShift, items.length]);

  const menu = isOpen && (!portal || portalPosition) && (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      tabIndex={-1}
      // It closes itself on Escape, so it says so: a dialog it is open over stands its own Escape
      // down for this panel rather than taking the key. See `shared/ui/overlayEscape`.
      {...OWNS_ESCAPE}
      className={cn(
        'vv-action-menu',
        portal ? 'fixed z-[70]' : 'absolute top-full z-50 mt-2',
        'min-w-[220px] max-w-[calc(100vw-1rem)]',
        !portal && (align === 'right' ? 'right-0' : 'left-0'),
        menuClassName,
      )}
      style={portal && portalPosition
        ? portalPosition
        : edgeShift !== 0 ? { transform: `translateX(${edgeShift}px)` } : undefined}
    >
      {header}
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <React.Fragment key={item.key}>
            {item.showDividerBefore && <div className="vv-action-menu__divider mx-2 my-1 h-px" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled || item.loading}
              onClick={() => runItem(item)}
              // `focus:outline-none` is gone with the colour utilities: tokens.css draws the
              // focus ring on every button, and this was suppressing it on the one control in
              // the app a keyboard user reaches ONLY by tabbing.
              className={cn(
                'vv-action-menu__item flex w-full items-start gap-3 px-3 py-2 text-left text-sm',
                item.isDanger && 'vv-action-menu__item--danger',
              )}
            >
              {item.loading ? (
                <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" />
              ) : (
                Icon && <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-5">{item.label}</span>
                {item.description && (
                  <span className="vv-action-menu__description mt-0.5 block text-xs leading-4">
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        className={triggerClassName}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={(event) => {
          focusMenuOnOpenRef.current = event.detail === 0;
          toggleMenu();
        }}
      >
        {TriggerIcon && <TriggerIcon className="h-4 w-4" />}
        {!iconOnly && (
          <>
            <span>{label}</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
          </>
        )}
      </Button>

      {portal && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
}
