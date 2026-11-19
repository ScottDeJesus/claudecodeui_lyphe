import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { FAKE_DECISIONS } from '@/modules/kanban/utils/walkFixtures';
import type { KanbanCardDetail } from '@/shared/kanban-types';
import { formatRelativeTime } from '@/shared/utils';

/**
 * WHAT WAS DECIDED WITHOUT ASKING: the obvious choices a walk took, each with the question it
 * closed, newest first.
 *
 * UNDER THE QUESTIONS, BECAUSE THEY ARE THE SAME KIND OF THING. A question is a choice waiting on
 * the reader; a decision is a choice that was not worth their time. Read together they are every
 * fork this card met, and the one place to look when a card came out other than expected.
 *
 * A RECORD, SO IT IS QUIET. No tone, no press: the choice in ink, the question it answered above
 * it in the calm ink, and when. It is drawn only when there is one — a card on which nothing was
 * decided has no empty place saying so.
 */

type DrawerDecisionsProps = {
  /** The open card, as the shell read it. This block fetches nothing. */
  detail: KanbanCardDetail;
};

/** Rendered by DrawerQuestions, under the questions. Nothing else mounts it. */
export function DrawerDecisions({ detail }: DrawerDecisionsProps) {
  const { t } = useTranslation();
  const headingId = useId();

  // FILL: decisions — `detail.decisions`, the rows a walk noted for the reader (no `questionId`:
  // a question the reader answered already shows its answer in its own row above).
  const noted = FAKE_DECISIONS[detail.id] ?? [];
  const decisions = [...noted].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  if (decisions.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={headingId} data-drawer-decisions>
      <h4 id={headingId} className="text-xs font-medium text-muted-foreground">
        {t('kanban.decisions.title', { count: decisions.length })}
      </h4>
      <ul className="flex flex-col gap-3">
        {decisions.map((decision) => (
          <li key={decision.id} className="flex flex-col gap-0.5 border-l border-border pl-3">
            <span className="text-xs leading-snug text-muted-foreground">{decision.question}</span>
            <span className="text-sm leading-snug text-foreground">{decision.choice.join(' · ')}</span>
            <span className="text-xs text-ink-faint">{formatRelativeTime(decision.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
