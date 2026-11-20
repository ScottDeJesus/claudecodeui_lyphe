import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type RuleProps = {
  /** The heading: a noun or two, set in the mono capitals by its type ("Checklist", "Decided for you · 3"). */
  children: ReactNode;
  /** The heading's id, for the section it heads to be labelled by. */
  id?: string;
  /** Its heading level: 3 for a section, 4 for a group inside one. */
  level?: 3 | 4;
  /** What stands at the line's end: the section's figure (a count, a small ring) or the one press that adds to it. */
  end?: ReactNode;
  /** The figure's tone, when what it counts is owed (warn) or wrong (danger) or finished (positive). */
  endTone?: 'warn' | 'danger' | 'positive';
  className?: string;
};

/**
 * THE DESIGN SYSTEM'S RULE: a heading with its hairline, drawn out of the words when it arrives. It heads a section or a group of
 * readouts inside an Opening, never stands alone as a divider, and carries at its end what its section counts or the one press that
 * adds to it, so a section needs no second line of its own.
 *
 * Used by the kanban module's open bug (each of its sections) and its dashboard (each of its groups).
 */
export function Rule({ children, id, level = 3, end, endTone, className }: RuleProps) {
  const Heading = level === 4 ? 'h4' : 'h3';
  return (
    <div className={cn('ast-hrule', className)}>
      <Heading id={id} className="ast-hrule-label">
        {children}
      </Heading>
      <span className="ast-hrule-line" aria-hidden="true" />
      {end !== undefined && end !== null && end !== false && (
        <span className="ast-hrule-end" data-tone={endTone}>
          {end}
        </span>
      )}
    </div>
  );
}
