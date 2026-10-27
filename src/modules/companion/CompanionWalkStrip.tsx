import { ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CompanionWalk } from '@/shared/companion-types';

/**
 * The walkthrough she is taking him through, as one strip: the chat it is about, "Item 2 of 5", and the item's own
 * title — where they are, so a turn to another chat and back never loses the place. A walk set up and not begun (`at`
 * 0) says how many items wait. A title she wrote longer than the strip wraps; nothing is cut, since the title is what he
 * answers.
 *
 * It sits in the info tone, the same blue as her status while she works: a walk is work in progress. The words carry
 * the place; the tone only says "in progress".
 *
 * Used by this module's CompanionPanel, first in the dock above the composer.
 */
export function CompanionWalkStrip({ walk }: { walk: CompanionWalk }) {
  const { t } = useTranslation();
  const total = walk.items.length;
  const begun = walk.at >= 1 && walk.at <= total;
  const title = begun ? walk.items[walk.at - 1] : null;

  return (
    <section
      data-companion-walk=""
      data-tone="info"
      aria-label={t('companion.walk.title')}
      className="flex gap-2.5 rounded-lg border border-tone-ink/25 bg-tone-soft px-3 py-2"
    >
      <ListOrdered aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-ink" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
          <span className="shrink-0 uppercase tracking-[0.14em] text-tone-ink">{t('companion.walk.title')}</span>
          <span className="min-w-0 truncate font-medium text-foreground">{walk.session.name}</span>
          <span className="ml-auto shrink-0 font-medium tabular-nums text-tone-ink">
            {begun ? t('companion.walk.of', { at: walk.at, total }) : t('companion.walk.notBegun', { count: total })}
          </span>
        </div>
        {title !== null && <p className="mt-0.5 break-words text-sm leading-snug text-foreground">{title}</p>}
      </div>
    </section>
  );
}
