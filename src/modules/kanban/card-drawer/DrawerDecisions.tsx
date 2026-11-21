import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanCardDetail } from '@/shared/kanban-types';
import { Button, Rule } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/**
 * WHAT WAS DECIDED WITHOUT ASKING: the obvious choices a walk took, each with the question it
 * closed, newest first.
 *
 * UNDER THE QUESTIONS, BECAUSE THEY ARE THE SAME KIND OF THING. A question is a choice waiting on
 * the reader; a decision is a choice that was not worth their time. Read together they are every
 * fork this card met, and the one place to look when a card came out other than expected.
 *
 * A RECORD, SO IT IS QUIET: the design system's Trace, a bead each on one hairline, the newest filled. No tone, and no press
 * on a row: when, the question it answered in the calm ink, and the choice in ink under it. It is drawn only when there is one — a card on which nothing was
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
    <div className="flex flex-col gap-3 pt-1" role="group" aria-labelledby={headingId} data-drawer-decisions>
      <Rule id={headingId} level={4}>
        {t('kanban.decisions.title', { count: decisions.length })}
      </Rule>
      {/* The design system's Trace: what was decided, newest first, a bead each on one hairline, the newest filled. */}
      <ol className="ast-trace">
        {drawn.map((decision, index) => (
          <li key={decision.id} className="ast-trace-item" data-latest={index === 0 ? 'true' : 'false'}>
            <span className="ast-trace-bead" aria-hidden="true" />
            <span className="ast-trace-head">{formatRelativeTime(decision.createdAt)}</span>
            <p className="ast-trace-quiet">{decision.question}</p>
            <p className="ast-trace-text">{decision.choice.join(' · ')}</p>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <Button variant="outline" size="sm" className="h-7 self-start px-2 finger:h-11" onClick={() => setShowAll(true)}>
          {t('kanban.decisions.showAll', { count: hidden })}
        </Button>
      )}
    </div>
  );
}
