import * as React from 'react';

import type { Kind, Tone } from '@/shared/types';
import { badgeVariants } from '@/shared/ui/badgeVariants';
import { cn } from '@/shared/utils';

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
 * Used for short status labels by the accounts, agent-launch, browser-use, cerberus, chat,
 * chat-gutters, deepseek-spend, dispatcher, git-panel, heal, jev, kanban, mcp, memory-intake, notes,
 * roadmap, runner-tab, schedules, settings, shell, sidebar, skills, standalone-shell, task-master and
 * universe modules, and by the kit's own `KanbanCard`. The cerberus tab's `StatusPill` draws a
 * status's glyph and word in it. The dispatcher's lane-card heads and the roadmap's path also give it
 * a `kind`, for their Epic and Feature tags.
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
