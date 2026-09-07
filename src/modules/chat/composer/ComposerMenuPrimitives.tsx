import type { ReactNode, Ref } from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/shared/utils';
import type { ComposerMenuAnchor } from '@/shared/types';

/**
 * Shared shell for the composer popovers (model/effort and permissions) so both
 * menus share one surface, one heading style and one row style.
 *
 * Used by chat's ComposerModelMenu and ComposerPermissionMenu.
 */
export function ComposerMenuSurface({
  anchor,
  menuRef,
  ariaLabel,
  children,
}: {
  anchor: ComposerMenuAnchor;
  menuRef: Ref<HTMLDivElement>;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-[100] min-w-48 overflow-y-auto overscroll-contain border border-border bg-popover p-1.5 text-popover-foreground"
      // The anchor is this menu's own business — it is a portalled overlay with
      // no parent box to sit in. The three token reads beside it are the
      // library's overlay surface, the same radius, shadow and entrance
      // `.vv-menu__panel` paints; they are spelled here because that rule also
      // POSITIONS, and a portalled popover cannot take its `position: absolute`.
      style={{
        right: anchor.right,
        bottom: anchor.bottom,
        maxHeight: anchor.maxHeight,
        maxWidth: anchor.maxWidth,
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-overlay)',
        animation: 'vv-pop 0.3s var(--ease-enter) both',
      }}
    >
      {children}
    </div>
  );
}

/** Used by chat's ComposerModelMenu and ComposerPermissionMenu to label a section of the popover. */
export function ComposerMenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1.5 pt-1.5 text-xs uppercase tracking-[0.14em] text-ink-faint">{children}</p>
  );
}

/**
 * A closing sentence under a popover's rows — what choosing one of them will and
 * will not do. Used by chat's ComposerModelMenu.
 *
 * Separate from ComposerMenuHeading because it reads as prose, not as a label:
 * sentence case, no tracking, and it wraps.
 */
export function ComposerMenuNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-1.5 text-xs leading-snug text-ink-faint">{children}</p>
  );
}

/** Used by chat's ComposerModelMenu to divide its model and effort sections. */
export function ComposerMenuSeparator() {
  return <div className="my-1 h-px bg-border" aria-hidden />;
}

/** Used by chat's ComposerModelMenu and ComposerPermissionMenu to render one selectable row with its checked state. */
export function ComposerMenuItem({
  label,
  description,
  icon,
  isSelected,
  onSelect,
  role = 'menuitemradio',
  trailing,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  role?: 'menuitemradio' | 'menuitem';
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitemradio' ? isSelected : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        isSelected ? 'text-foreground' : 'text-foreground/90',
        className,
      )}
    >
      {icon && <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{description}</span>
        )}
      </span>
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {trailing ?? (isSelected ? <Check className="h-3.5 w-3.5 text-foreground" /> : null)}
      </span>
    </button>
  );
}
