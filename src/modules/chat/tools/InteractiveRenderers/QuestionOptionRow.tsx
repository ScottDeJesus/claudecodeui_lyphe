import React from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/shared/utils';

type QuestionOptionRowProps = {
  label: React.ReactNode;
  description?: string;
  selected: boolean;
  /** The key that toggles this row (`1`…`9`, `0`), drawn as a keycap. Pending card only. */
  keyHint?: string;
  /** Present on the pending card, where the row is the control; absent on the answered record. */
  onClick?: () => void;
  /** The "Other" row: a dashed edge says "this one opens a field", not "this is an answer". */
  dashed?: boolean;
  /**
   * What the row is to assistive tech inside its option group: a `radio` (single-select — picking
   * it again does not unpick it) or a `checkbox` (multi-select). Absent, the row is a plain toggle
   * button — the "Other" row, which sits outside the group and really does switch off.
   */
  choice?: 'radio' | 'checkbox';
};

/**
 * One option of an AskUserQuestion question, as a Verve row: the surface's own ground and edge at
 * rest, the accent's soft wash and ring once chosen — the selected chip's language, so the choice
 * reads in greyscale too. Used by chat's AskUserQuestionPanel as the control and by
 * AnsweredQuestion as the record of what was chosen, so the option looks the same before and after.
 */
export const QuestionOptionRow: React.FC<QuestionOptionRowProps> = ({
  label,
  description,
  selected,
  keyHint,
  onClick,
  dashed = false,
  choice,
}) => {
  const body = (
    <>
      {keyHint !== undefined && (
        <kbd
          className={cn(
            'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border font-mono text-xs tabular-nums transition-colors duration-quick',
            selected
              ? 'border-transparent bg-primary font-semibold text-primary-foreground'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          {keyHint}
        </kbd>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm leading-snug', selected ? 'font-medium text-foreground' : 'text-secondary-foreground')}>
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>
        )}
      </span>
      <Check
        aria-hidden
        className={cn('h-4 w-4 flex-shrink-0 text-accent-ink transition-opacity duration-quick', selected ? 'opacity-100' : 'opacity-0')}
        strokeWidth={2.5}
      />
    </>
  );

  const frame = cn(
    'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-quick',
    selected ? 'border-primary/60 bg-primary/10' : 'border-border bg-card',
    dashed && !selected && 'border-dashed',
  );

  if (!onClick) {
    return <div data-question-option-chosen={selected || undefined} data-selected={selected} className={frame}>{body}</div>;
  }
  return (
    <button
      type="button"
      data-question-option
      data-selected={selected}
      role={choice}
      aria-checked={choice ? selected : undefined}
      aria-pressed={choice ? undefined : selected}
      onClick={onClick}
      className={cn(frame, !selected && 'hover:border-input hover:bg-muted/60')}
    >
      {body}
    </button>
  );
};
