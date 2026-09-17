import * as React from 'react';
import { createPortal } from 'react-dom';

import { OWNS_ESCAPE_SELECTOR } from '@/shared/ui/overlayEscape';
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

/** Used by the chat, command-palette, sidebar and skills modules as the modal container. */
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

/** Opens a Dialog from an arbitrary child element; used by the chat module. */
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

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether a panel that OWNS ESCAPE is drawn IN FRONT OF this dialog — the one case where the key is
 * not the dialog's to take.
 *
 * TWO WAYS TO BE IN FRONT, and they are the two ways these panels are drawn. *In place*: a Menu or a
 * Select inside the dialog, whose panel is a descendant of it. *Portalled*: a panel appended to
 * `<body>` as it opened, so it comes after the dialog's own portal node in document order — which is
 * also what puts it above, a portalled menu carrying a higher z than the panel it belongs to.
 * Anything earlier is BEHIND — a composer menu left open under a dialog opened after it — and then
 * the key is the dialog's again.
 *
 * The candidates are the panels that STATE they own the key (`shared/ui/overlayEscape`), not every
 * element carrying some role. Scanning `[role="menu"], [role="listbox"]` here was wrong, and
 * shipped for one pass: cmdk's list carries `role="listbox"` as STATIC content of the dialog it is
 * placed in, so the command palette stood this dialog down on every Escape and nothing else took the
 * key — the palette's only pointerless dismissal, dead.
 *
 * Why a dialog has to ask at all: it listens on `window` in the CAPTURE phase, which fires before
 * every `document` listener an overlay uses, and it stops the event when it acts on it. An overlay
 * above it would never see the key. Asking first is what lets Escape mean "the menu" and then, on
 * the next press, "the sheet".
 */
function overlayInFrontHoldsEscape(content: HTMLElement | null): boolean {
  // No panel: this dialog is mid-mount, and nothing can be in front of one that is not on screen.
  if (content === null) return false;
  return Array.from(document.querySelectorAll(OWNS_ESCAPE_SELECTOR)).some((overlay) => (
    content.contains(overlay)
    || (content.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  ));
}

/** Focus-trapped panel of Dialog, used by the chat, command-palette, sidebar and skills modules. */
export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onEscapeKeyDown, onPointerDownOutside, wrapperClassName, animationClassName, ...props }, ref) => {
    const { open, onOpenChange, triggerRef } = useDialog();
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const previousFocusRef = React.useRef<HTMLElement | null>(null);

    // Save the element that had focus before opening, restore on close
    React.useEffect(() => {
      if (open) {
        previousFocusRef.current = document.activeElement as HTMLElement;
      } else if (previousFocusRef.current) {
        // Prefer the trigger, fall back to whatever was focused before
        const restoreTarget = triggerRef.current || previousFocusRef.current;
        restoreTarget?.focus();
        previousFocusRef.current = null;
      }
    }, [open, triggerRef]);

    React.useEffect(() => {
      if (!open) return;

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
          if (overlayInFrontHoldsEscape(contentRef.current)) return;
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

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown, true);

      // Prevent body scroll
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      return () => {
        window.removeEventListener('keydown', handleKeyDown, true);
        document.body.style.overflow = prev;
      };
    }, [open, onOpenChange, onEscapeKeyDown]);

    // Auto-focus first focusable element on open
    React.useEffect(() => {
      if (open && contentRef.current) {
        // Small delay to let the portal render
        requestAnimationFrame(() => {
          const first = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          first?.focus();
        });
      }
    }, [open]);

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
      document.body
    );
  }
);
DialogContent.displayName = 'DialogContent';

/** Accessible title of Dialog, used by the chat, command-palette, sidebar and skills modules. */
export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('sr-only', className)} {...props} />
  )
);
DialogTitle.displayName = 'DialogTitle';

