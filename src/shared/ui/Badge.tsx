import * as React from 'react';
import { cva } from 'class-variance-authority';

import type { Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * Every badge in the app, on two axes.
 *
 * `tone` is the new one and the one that matters: `.vv-badge` reads `var(--tone-soft)` /
 * `var(--tone-ink)` and the `[data-tone]` blocks in tokens.css decide what those are, so a
 * sixth badge colour is a token block rather than an edit here (doctrine §5).
 *
 * `variant` is the legacy one, kept because 24 call sites pass it and three of them depend on
 * looking DIFFERENT from each other in the same panel. Each variant emits a marker class whose
 * paint lives in controls.css beside the rest — never a colour utility, which is the second
 * paint mechanism D2 forbids.
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
  /** The state this badge reports. Where the two axes disagree, this one wins. */
  tone?: Tone;
};

/** Used by the browser-use, chat, mcp, settings, sidebar and skills modules for short status labels. */
export function Badge({ className, variant = 'default', tone, ...props }: BadgeProps) {
  // `default` is the only variant whose paint is a FILL, so it is the only one that can fight
  // an explicit tone. A caller who names a tone means the tone, so the marker steps aside.
  const variantMarker = variant === 'default' && tone !== undefined ? undefined : `vv-badge--${variant}`;

  return (
    <div
      className={cn(badgeVariants(), variantMarker, className)}
      data-tone={tone ?? VARIANT_TONES[variant]}
      {...props}
    />
  );
}
