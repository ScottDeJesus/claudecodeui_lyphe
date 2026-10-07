import * as React from 'react';
import { createPortal } from 'react-dom';

import { FOCUSABLE_SELECTOR } from '@/shared/constants';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { overlayInFrontHoldsEscape } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';

type DialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

export function useDialog() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error('Dialog components must be used within <Dialog>');
  return ctx;
}

type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

/** The modal container, used by the app-switcher, cerberus, chat, command-palette, heal, kanban, roadmap, settings, sidebar, skills and universe modules, and by the kit's own ConfirmDialog. */
export const Dialog: React.FC<DialogProps> = ({ open: controlledOpen, onOpenChange: controlledOnOpenChange, defaultOpen = false, children }) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const triggerRef = React.useRef<HTMLElement | null>(null) as React.MutableRefObject<HTMLElement | null>;
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const onOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      controlledOnOpenChange?.(next);
    },
    [isControlled, controlledOnOpenChange]
  );

  const value = React.useMemo(() => ({ open, onOpenChange, triggerRef }), [open, onOpenChange]);

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
};

/** Opens a Dialog from an arbitrary child element; used by the settings and universe modules. */
export const DialogTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>(
  ({ onClick, children, asChild, ...props }, ref) => {
    const { onOpenChange, triggerRef } = useDialog();

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        onOpenChange(true);
        onClick?.(e);
      },
      [onOpenChange, onClick]
    );

    // asChild: clone child element and compose onClick + capture ref
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<any>;
      return React.cloneElement(child, {
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          onOpenChange(true);
          child.props.onClick?.(e);
        },
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
          // Forward the outer ref
          if (typeof ref === 'function') ref(node as any);
          else if (ref) (ref as React.MutableRefObject<any>).current = node;
        },
      });
    }

    return (
      <button
        ref={(node) => {
          triggerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="button"
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    );
  }
);
DialogTrigger.displayName = 'DialogTrigger';

type DialogContentProps = {
  onEscapeKeyDown?: () => void;
  onPointerDownOutside?: () => void;
  wrapperClassName?: string;
  animationClassName?: string;
} & React.HTMLAttributes<HTMLDivElement>;

/** Focus-trapped panel of Dialog, used by the app-switcher, cerberus, chat, command-palette, heal, kanban, roadmap, settings, sidebar, skills and universe modules, and by the kit's own ConfirmDialog. */
export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onEscapeKeyDown, onPointerDownOutside, wrapperClassName, animationClassName, ...props }, ref) => {
    const { open, onOpenChange, triggerRef } = useDialog();
    const hostWindow = useHostWindow();
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const previousFocusRef = React.useRef<HTMLElement | null>(null);

    // Save the element that had focus before opening, restore on close. Saved only once per opening
    // (`??=`): this effect re-runs when the chat moves to another window while the dialog is open,
    // and by then the focus is the dialog's own, which must not replace the element to return to.
    React.useEffect(() => {
      if (open) {
        previousFocusRef.current ??= hostWindow.document.activeElement as HTMLElement | null;
      } else if (previousFocusRef.current) {
        // Focus that already sits on a live element is a choice made in this same commit — the
        // command palette's Chat row closes it and floats the chat, whose composer takes focus in a
        // layout effect that runs BEFORE this passive one — and restoring over it undoes that. The
        // dialog's own removal drops focus to `body`, which is the one case that still restores.
        const active = hostWindow.document.activeElement;
        const focusMovedOn = active !== null && active !== hostWindow.document.body;
        if (!focusMovedOn) {
          // Prefer the trigger, fall back to whatever was focused before
          const restoreTarget = triggerRef.current || previousFocusRef.current;
          restoreTarget?.focus();
        }
        previousFocusRef.current = null;
      }
    }, [open, triggerRef, hostWindow]);

    React.useEffect(() => {
      if (!open) return;

      const hostDocument = hostWindow.document;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          // Marked, from a WINDOW capture listener: ChatInterface stops the running turn on an
          // Escape from a document capture listener unless the event is already marked, and window
          // capture runs first — so closing a dialog never also stops the run. Marked in BOTH
          // branches below: an Escape that closes a menu is no more the chat's to act on than one
          // that closes a dialog.
          e.preventDefault();
          // An overlay drawn in front of the dialog takes the key, and this handler stands down for
          // it — no close, and no stopPropagation, so the overlay's own `document` listener gets the
          // event. Without this the window listener kills the overlay's Escape before it runs: the
          // switcher's sheet is a Dialog, its rows' kebab menus are portalled in front of it, and one
          // Escape took the sheet (and the row) instead of the menu. See
          // `overlayInFrontHoldsEscape` for what "in front" is measured as.
          if (overlayInFrontHoldsEscape(contentRef.current, hostDocument)) return;
          e.stopPropagation();
          onEscapeKeyDown?.();
          onOpenChange(false);
          return;
        }

        // Focus trap: Tab / Shift+Tab cycle within the dialog
        if (e.key === 'Tab' && contentRef.current) {
          const focusable = Array.from(
            contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
          );
          if (focusable.length === 0) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && hostDocument.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && hostDocument.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      // The host window's capture phase, which runs before the chat's own document capture listener
      // (ChatInterface's Escape-stops-the-turn) in that same window — the order the comment above
      // depends on holds in a picture-in-picture window exactly as it does at home.
      hostWindow.addEventListener('keydown', handleKeyDown, true);

      // Prevent body scroll — of the body the dialog is drawn over.
      const body = hostDocument.body;
      const prev = body.style.overflow;
      body.style.setProperty('overflow', 'hidden');

      return () => {
        hostWindow.removeEventListener('keydown', handleKeyDown, true);
        body.style.setProperty('overflow', prev);
      };
    }, [open, onOpenChange, onEscapeKeyDown, hostWindow]);

    // Auto-focus first focusable element on open
    React.useEffect(() => {
      if (open && contentRef.current) {
        // Small delay to let the portal render. A frame of the window the reader is looking at: a
        // hidden opener runs none, so a dialog raised from the floating window would wait for a
        // frame that never comes. Cancelled on the window that armed it.
        const frame = hostWindow.requestAnimationFrame(() => {
          const first = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          first?.focus();
        });
        return () => hostWindow.cancelAnimationFrame(frame);
      }
      return undefined;
    }, [open, hostWindow]);

    if (!open) return null;

    return createPortal(
      <div className={cn('fixed inset-0 z-50', wrapperClassName)}>
        {/* Overlay */}
        <div
          className="vv-dialog__backdrop fixed inset-0 animate-dialog-overlay-show"
          onClick={() => {
            onPointerDownOutside?.();
            onOpenChange(false);
          }}
          aria-hidden
        />
        {/* Content */}
        <div
          ref={(node) => {
            contentRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          role="dialog"
          aria-modal="true"
          className={cn(
            'vv-dialog__panel fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            // Verve's own panel motion is `vv-pop .45s var(--ease-enter)`, and this keyframe is
            // that motion adapted to a centred box: vv-pop animates `transform` outright, which
            // would overwrite the two translate utilities above and drop the dialog into the
            // top-left corner for the length of the animation. `dialog-content-show` carries the
            // same rise and the same 96% scale-in with the centring folded in, and Phase 3
            // retuned its easing and duration to match (tailwind.config.js).
            animationClassName ?? 'animate-dialog-content-show',
            className
          )}
          {...props}
        >
          {children}
        </div>
      </div>,
      hostWindow.document.body
    );
  }
);
DialogContent.displayName = 'DialogContent';

/** Accessible title of Dialog, used by the app-switcher, cerberus, chat, command-palette, heal, kanban, roadmap, sidebar, skills and universe modules, and by the kit's own ConfirmDialog. */
export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('sr-only', className)} {...props} />
  )
);
DialogTitle.displayName = 'DialogTitle';

