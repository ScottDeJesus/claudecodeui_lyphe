import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { StateBadge } from '@/modules/carrier-bulletins/StateBadge';
import { PAGE_STATE_LOOK } from '@/modules/carrier-bulletins/utils/bulletinModel';
import { pageWhenWords, verdictParts } from '@/modules/carrier-bulletins/utils/bulletinWords';
import type { BulletinPage } from '@/shared/carrier-bulletins-types';

type PageRowProps = {
  page: BulletinPage;
  /** Whether the row carries its state. False when every page of its part stands the same: the part's heading says it once. */
  showState: boolean;
  onOpen: (page: number) => void;
};

/**
 * ONE PAGE under its part, the whole row its press target: the page's number, its state as a badge ("Settled", "Read,
 * not settled", "Not read", "Waiting") unless its part already says it for every page, what Claude found on it — its
 * requirements, then the rules judged there by verdict, in need order ("3 requirements · 1 unsettled · 1 corrected · 3
 * duplicates · 1 confirmed"), the unsettled count in the tone for act, as the page screen paints it — and when its answer was
 * read: "Read 2h ago", or "Read Oct 21, carried from the Jun 3 file" for a page whose content did not change, so its answer
 * was read on that file and not again. A waiting page says "Tried, no answer"; a page not read says nothing more than its badge.
 *
 * One line once the panel is 720 px wide (its own width, `cqi`, as the Tours screens measure it), so a 78-page file stays
 * scannable; narrower, the number and the badge on one line and the facts under them. Every class is spelt whole:
 * Tailwind generates only what it finds written out.
 *
 * Used by the carrier-bulletins module's `CarrierPages`, one per page in each part.
 */
export function PageRow({ page, showState, onOpen }: PageRowProps) {
  const { t } = useTranslation();
  const answered = page.state === 'settled' || page.state === 'read';
  const look = PAGE_STATE_LOOK[page.state];

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(page.page)}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-left hover:bg-background focus-visible:[outline-offset:-2px] [@container(min-width:720px)]:grid-cols-[4.5rem_11.5rem_minmax(0,1fr)_minmax(0,15rem)_1rem]"
      >
        <span className="col-start-1 row-start-1 text-[14px] font-medium tabular-nums text-foreground">
          {t('cerberus.bulletins.pageRow.page', { page: page.page })}
        </span>
        {showState && (
          <span className="col-start-2 row-start-1 flex min-w-0 justify-end [@container(min-width:720px)]:justify-start">
            <StateBadge tone={look.tone} icon={look.icon} words={t(`cerberus.bulletins.pageState.${page.state}`)} />
          </span>
        )}
        <ChevronRight className="col-start-3 row-start-1 size-4 flex-none text-ink-faint [@container(min-width:720px)]:col-start-5" aria-hidden="true" />
        {answered && (
          <span className="col-span-3 min-w-0 text-[13px] text-foreground [@container(min-width:720px)]:col-span-1 [@container(min-width:720px)]:col-start-3 [@container(min-width:720px)]:row-start-1">
            {page.requirements > 0 ? t('cerberus.bulletins.pageRow.requirements', { count: page.requirements }) : t('cerberus.bulletins.pageRow.noRequirement')}
            {verdictParts(page.verdicts, t).map(({ verdict, words }) => (
              <Fragment key={verdict}>
                {' · '}
                {verdict === 'unsettled' ? <span data-tone="warn" className="text-tone-ink">{words}</span> : words}
              </Fragment>
            ))}
          </span>
        )}
        <span className="col-span-3 min-w-0 text-[12.5px] text-muted-foreground [@container(min-width:720px)]:col-span-1 [@container(min-width:720px)]:col-start-4 [@container(min-width:720px)]:row-start-1">
          {pageWhenWords(page, t)}
        </span>
      </button>
    </li>
  );
}
