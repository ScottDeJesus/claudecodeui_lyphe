import { ChevronDownIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CollapsibleContent, CollapsibleTrigger, useCollapsible } from '@/shared/ui/Collapsible';
import { cn } from '@/shared/utils';

/**
 * The sign a fold wears, and the one button that presses it. Every card that folds draws these two,
 * and the chat's shape cards draw the same `FoldChevron` — a card is not allowed its own look-alike,
 * because two chevrons that turn by different rules read as two different things.
 *
 * `FoldChevron` is the glyph alone, sized in `em` so it follows the text size it sits beside (the
 * transcript's reading size, a card's own `text-sm`) rather than a pixel value that would have to be
 * re-chosen per surface. It turns rather than swapping for a second icon: a chevron that points right
 * means the next press opens, and one that points down means it closes — one glyph, two states, and
 * nothing to keep in sync. It is `aria-hidden` on purpose: it is a SIGN, and the accessible name
 * belongs to the button around it.
 *
 * `CardFoldToggle` is that button, for a card whose header is not itself the press — the run card,
 * the v3 plan card, an arc's deck and a dispatch arc's header each carry badges, clocks and verbs of
 * their own, so a header-wide button would swallow them. It must be drawn INSIDE a `Collapsible`,
 * which is where its open state comes from: `aria-expanded` is the primitive's own, and the chevron
 * reads the same context, so the sign and the attribute can never disagree.
 *
 * IT IS NOT 28px ON A PHONE. A thumb needs a real target, so the box is 40px until `sm` and the
 * card's own tight 28px from there up — the desktop header is a row of 20px text and does not want a
 * 40px button in it. The glyph stays small either way; only the pressable box changes.
 *
 * Used by `RunCard`, `PlanCard` and `DeckFrame`, and — for the glyph alone — by
 * the chat's `ShapeFrame`.
 */
export function FoldChevron({ collapsed, className }: { collapsed: boolean; className?: string }) {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn(
        'h-[1em] w-[1em] flex-shrink-0 transition-transform duration-200',
        collapsed && '-rotate-90',
        className
      )}
    />
  );
}

/** The chevron button a foldable card's header wears, in its top-right corner. Inside a `Collapsible`. */
export function CardFoldToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { open } = useCollapsible();
  const label = t(open ? 'runner.collapse' : 'runner.expand');
  return (
    <CollapsibleTrigger
      data-card-fold
      aria-label={label}
      title={label}
      className={cn(
        'grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors',
        'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'forced-colors:text-[CanvasText] sm:h-7 sm:w-7',
        className
      )}
    >
      <FoldChevron collapsed={!open} />
    </CollapsibleTrigger>
  );
}

/**
 * `inert` plus `aria-hidden`, as React 18 can carry them — the attribute's PRESENCE is the whole
 * signal, so the value is the empty string and never `false` (see `CardFoldBody`).
 */
const INERT_WHILE_CLOSED = { inert: '', 'aria-hidden': true } as unknown as HTMLAttributes<HTMLDivElement>;

/**
 * The fold's BODY SLOT, for a card whose fold has to hide and not merely clip.
 *
 * `CollapsibleContent` clips: `grid-rows-[0fr]` over an `overflow-hidden` box — the house's fold
 * everywhere, and the animation is the point (INV-4354: a folded shape's boxes stay in the layout, so
 * `isVisible` lies and a painted height is the honest reading). What a clip does not do is take the
 * folded body out of the TAB ORDER or out of the ACCESSIBILITY TREE. On the chat's shapes that is
 * invisible prose; on a lane card it is the run's VERBS — and because a fold is remembered per card
 * id it survives reloads. Measured on a folded run card, 2026-09-25: 11 focusable controls inside a
 * 0px-tall slot (`Resume`, `Dismiss`, the model switch, five phase rows), and the whole body still
 * read out in the aria snapshot. A keyboard reader met a card whose buttons could be tabbed to but
 * never seen.
 *
 * So this slot puts `inert` and `aria-hidden` on the clip while the card is CLOSED and drops them
 * when it opens. `inert` is exactly this job — the subtree is unfocusable, unclickable and hidden
 * from assistive technology — and neither attribute touches layout, so the fold still animates and
 * the card still paints rather than unmounting.
 *
 * `inert` travels through a typed spread because React 18's JSX types do not carry it (they grew it
 * with React 19) while the DOM has honoured it since 2023; React 18 renders the empty string
 * verbatim, and `inert="false"` would be an inert element all the same, which is why the value is
 * `''` and not a boolean.
 *
 * Used by `RunCard`, `PlanCard` and `DeckFrame` — every card that folds.
 */
export function CardFoldBody({ children, className }: { children: ReactNode; className?: string }) {
  const { open } = useCollapsible();
  return (
    <CollapsibleContent className={className} {...(open ? null : INERT_WHILE_CLOSED)}>
      {children}
    </CollapsibleContent>
  );
}
