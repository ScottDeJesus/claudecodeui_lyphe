import type { ReactNode, Ref } from 'react';
import { Check } from 'lucide-react';

import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';
import type { ComposerMenuAnchor } from '@/shared/types';

/**
 * Shared shell for the composer popovers (model/effort, permissions, send-later) so every
 * menu shares one surface, one heading style and one row style.
 *
 * Used by chat's ComposerModelMenu, ComposerPermissionMenu and ScheduleMessagePopover.
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
      // The popover owns Escape while it is up — see `shared/ui/overlayEscape`.
      {...OWNS_ESCAPE}
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

/** Used by chat's ComposerModelMenu, ComposerPermissionMenu, ScheduleMessagePopover and ComposerToolsetSection to label a section of the popover. */
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

/**
 * A rule across the popover between two of its groups. Used by chat's ScheduleMessagePopover (above
 * its custom time) and ComposerModelMenu (above the tool sets).
 */
export function ComposerMenuSeparator() {
  return <div className="my-1 h-px bg-border" aria-hidden />;
}

/**
 * A checkbox row's box: Verve's forms/Checkbox draw (a `--border-strong` edge on the surface, and the
 * accent fill with its tick when on) at the row's 16px. Drawn here rather than by `Checkbox`, whose real
 * input cannot stand inside the row's button.
 */
function MenuCheckboxBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded-[5px] border-[1.5px]',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-popover',
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

/**
 * Used by chat's ComposerModelMenu, ComposerPermissionMenu, ScheduleMessagePopover and
 * ComposerToolsetSection to render one row of a popover with its checked state.
 *
 * A radio row keeps its state as the tick at its right, where the menu's choices have always kept
 * it. A checkbox row keeps it as a box BESIDE its name. A section of those rows is a list of
 * independent switches, so the boxes read down its left edge as one column. A lone tick there would
 * read as "the one chosen".
 */
export function ComposerMenuItem({
  label,
  description,
  icon,
  isSelected,
  onSelect,
  role = 'menuitemradio',
  busy = false,
  waiting = false,
  trailing,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** A mark before the label. A checkbox row draws its box there instead. */
  icon?: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  role?: 'menuitemradio' | 'menuitemcheckbox' | 'menuitem';
  /**
   * A checkbox row whose own press is still out. This is the `busy` of Chip and Button: the row
   * announces `aria-busy` and `aria-disabled`, keeps its focus and takes no second press. Its box turns
   * into the house spinner's ring until the caller clears the flag. Passed by ComposerToolsetSection
   * to the set that is switching.
   */
  busy?: boolean;
  /**
   * A checkbox row waiting on ANOTHER row's press. It announces `aria-disabled`, keeps its focus and
   * takes no press, and it looks that way: no hover wash, quieted, a not-allowed cursor. The caller
   * clears the flag when the answer lands. Passed by ComposerToolsetSection to every other row while
   * a set switches.
   */
  waiting?: boolean;
  /** What a radio or plain row shows at its right in place of its tick. A checkbox row has no right-hand mark. */
  trailing?: ReactNode;
  className?: string;
}) {
  const isCheckbox = role === 'menuitemcheckbox';
  // A row that takes no press takes no hover wash either: the wash is what says "press me".
  const refused = busy || waiting;
  // The spinner's ring as paint alone. The row's own `aria-busy` says it is switching, and the
  // Spinner component's `role="status"` box is a div, which a button cannot hold.
  const leading = isCheckbox
    ? (busy ? <span aria-hidden className="vv-spinner__ring block h-3.5 w-3.5" /> : <MenuCheckboxBox checked={isSelected} />)
    : icon;
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitem' ? undefined : isSelected}
      aria-busy={busy || undefined}
      aria-disabled={refused || undefined}
      onClick={refused ? undefined : onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        refused ? 'focus-visible:bg-accent focus-visible:outline-none' : 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        isSelected ? 'text-foreground' : 'text-foreground/90',
        busy && 'cursor-progress',
        waiting && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {leading && <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{description}</span>
        )}
      </span>
      {/* A checkbox row's state is its box at the left, so its right holds nothing. */}
      {!isCheckbox && (
        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
          {trailing ?? (isSelected ? <Check className="h-3.5 w-3.5 text-foreground" /> : null)}
        </span>
      )}
    </button>
  );
}
