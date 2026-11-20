import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanCardDetail } from '@/shared/kanban-types';
import { Button } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/**
 * WHAT WAS DECIDED WITHOUT ASKING: the obvious choices a walk took, each with the question it
 * closed, newest first.
 *
 * UNDER THE QUESTIONS, BECAUSE THEY ARE THE SAME KIND OF THING. A question is a choice waiting on
 * the reader; a decision is a choice that was not worth their time. Read together they are every
 * fork this card met, and the one place to look when a card came out other than expected.
 *
 * A RECORD, SO IT IS QUIET. No tone, and no press on a row: the choice in ink, the question it answered above
 * it in the calm ink, and when. It is drawn only when there is one — a card on which nothing was
 * decided has no empty place saying so.
 *
 * THE NEWEST FIVE, THEN A PRESS FOR THE REST. A long walk can note a dozen forks, and the newest are
 * the ones a reader came for; the heading still counts them all, and one press (44 px under a
 * finger) draws every one.
 */

const KEPT_DECISIONS = 5;

type DrawerDecisionsProps = {
  /** The open card, as the shell read it. This block fetches nothing. */
  detail: KanbanCardDetail;
};

/** Rendered by DrawerQuestions, under the questions. Nothing else mounts it. */
export function DrawerDecisions({ detail }: DrawerDecisionsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const [showAll, setShowAll] = useState(false);

  // Only the rows a walk noted for the reader: one with a `questionId` is a question he answered,
  // and that answer already stands in the question's own row above.
  const noted = detail.decisions.filter((decision) => decision.questionId === null);
  const decisions = [...noted].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  if (decisions.length === 0) return null;
  const drawn = showAll ? decisions : decisions.slice(0, KEPT_DECISIONS);
  const hidden = decisions.length - drawn.length;

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={headingId} data-drawer-decisions>
      <h4 id={headingId} className="text-xs font-medium text-muted-foreground">
        {t('kanban.decisions.title', { count: decisions.length })}
      </h4>
      <ul className="flex flex-col gap-3">
        {drawn.map((decision) => (
          <li key={decision.id} className="flex flex-col gap-0.5 border-l border-border pl-3">
            <span className="text-xs leading-snug text-muted-foreground">{decision.question}</span>
            <span className="text-sm leading-snug text-foreground">{decision.choice.join(' · ')}</span>
            <span className="text-xs text-ink-faint">{formatRelativeTime(decision.createdAt)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground finger:min-h-11 finger:min-w-11"
          onClick={() => setShowAll(true)}
        >
          {t('kanban.decisions.showAll', { count: hidden })}
        </Button>
      )}
    </div>
  );
}
