import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { GeminiRow, GeminiRows } from '@/modules/gemini-spend/GeminiRow';
import type { BudgetRow } from '@/modules/gemini-spend/types';
import { Rule } from '@/shared/ui';

type GeminiBudgetsProps = {
  /** One row a budget, in the door's order. */
  budgets: BudgetRow[];
  /** What every budget spent over the window, at the rule's end. */
  figure: string;
};

/**
 * Builds and sessions: what the house's own plans, chains and chats spent, one row a budget — its name, its calls and
 * its dollars. No switch: a budget is stopped by its own cap, and the line under the list says so.
 */
export function GeminiBudgets({ budgets, figure }: GeminiBudgetsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-gemini-section="budgets">
      <Rule id={headingId} end={figure}>
        {t('api.gemini.budgets.title')}
      </Rule>
      {budgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('api.gemini.budgets.empty')}</p>
      ) : (
        <>
          <GeminiRows>
            {budgets.map((budget) => (
              <GeminiRow key={budget.budget} name={budget.budget} mono calls={budget.calls} costUsd={budget.cost_usd} />
            ))}
          </GeminiRows>
          <p className="text-xs text-muted-foreground">{t('api.gemini.budgets.hint')}</p>
        </>
      )}
    </section>
  );
}
