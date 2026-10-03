import * as React from 'react';
import { cva } from 'class-variance-authority';

import type { Kind, Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * Every badge in the app, on three axes.
 *
 * `tone` is the new one and the one that matters: `.vv-badge` reads `var(--tone-soft)` /
 * `var(--tone-ink)` and the `[data-tone]` blocks in tokens.css decide what those are, so a
 * sixth badge colour is a token block rather than an edit here (doctrine §5).
 *
 * `kind` is tone's twin for IDENTITY — what a card IS rather than how it stands. `.vv-badge[data-kind]`
 * reads `var(--kind-soft)` / `var(--kind-ink)`, which the `[data-kind]` blocks in tokens.css swap in, and
 * a kind badge carries no `data-tone` at all: a kind is never one of the five tones. It is the caller's
 * to give the badge its glyph and its word (a kind is never colour alone, doctrine §6).
 *
 * `variant` is the legacy one, kept because 24 call sites pass it and three of them depend on
 * looking DIFFERENT from each other in the same panel. Each variant emits a marker class whose
 * paint lives in controls.css beside the rest — never a colour utility, which is the second
 * paint mechanism D2 forbids.
 *
 * `badgeVariants` is exported for the one toned fact that has to be a CONTROL — the dispatcher's
 * `StatusFlow` nodes are buttons, which `as` does not draw — so it wears the badge's paint and
 * `data-tone` rather than a second spelling of them.
 */
export const badgeVariants = cva('vv-badge inline-flex items-center');

/** The tone each legacy `variant` stands for, for the call sites not yet given a `tone`. */
const VARIANT_TONES = {
  default: 'neutral',
  secondary: 'neutral',
  destructive: 'danger',
  outline: 'neutral',
} satisfies Record<string, Tone>;

type BadgeVariant = keyof typeof VARIANT_TONES;

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: BadgeVariant;
  /**
   * The element to draw. A badge inside a `<button>` — a count on a header that is itself the
   * control — must be phrasing content, and a `div` there is a content model the parser only
   * tolerates. Paint and tone are identical either way.
   */
  as?: 'div' | 'span';
} & (
  | {
    /** The state this badge reports. Where `tone` and `variant` disagree, this one wins. */
    tone?: Tone;
    kind?: never;
  }
  | {
    /** What this badge says the card IS (an epic, a feature). Never a state, so it excludes `tone`. */
    kind?: Kind;
    tone?: never;
  }
);

/**
 * Used by the browser-use, chat, mcp, settings, sidebar, skills and dispatcher modules for short status
 * labels; the dispatcher's lane-card heads also give it a `kind` for their Epic and Feature tags.
 */
export function Badge({ className, variant = 'default', tone, kind, as: Element = 'div', ...props }: BadgeProps) {
  // `default` is the only variant whose paint is a FILL, so it is the only one that can fight
  // an explicit tone or kind. A caller who names either means it, so the marker steps aside.
  const variantMarker = variant === 'default' && (tone !== undefined || kind !== undefined) ? undefined : `vv-badge--${variant}`;

  return (
    <Element
      className={cn(badgeVariants(), variantMarker, className)}
      // A kind badge states no state, so it draws no tone: an inherited `--tone-*` must not be what it reads.
      data-tone={kind === undefined ? (tone ?? VARIANT_TONES[variant]) : undefined}
      data-kind={kind}
      {...props}
    />
  );
}
