import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StateBadge } from '@/modules/carrier-bulletins/StateBadge';
import { PAGE_STATE_LOOK } from '@/modules/carrier-bulletins/utils/bulletinModel';
import { pageWhenWords, verdictWords } from '@/modules/carrier-bulletins/utils/bulletinWords';
import type { BulletinPage } from '@/shared/carrier-bulletins-types';

type PageRowProps = {
  page: BulletinPage;
  onOpen: (page: number) => void;
};

/**
 * ONE PAGE under its part, the whole row its press target: the page's number, its state as a badge ("Settled", "Read,
 * not settled", "Not read", "Waiting"), what Claude found on it — its requirements, then the rules judged there by
 * verdict, in need order ("3 requirements · 1 unsettled · 1 corrected · 3 duplicates · 1 confirmed") — and where the
 * answer came from: "Read 2h ago", or "Carried from the Jun 3 file" for a page whose content did not change, so its
 * answer was read on that file and not again. A page with no answer says "Not read yet" or "Tried, no answer".
 *
 * One line once the panel is 720 px wide (its own width, `cqi`, as the Tours screens measure it), so a 78-page file stays
 * scannable; narrower, the number and the badge on one line and the facts under them. Every class is spelt whole:
 * Tailwind generates only what it finds written out.
 *
 * Used by the carrier-bulletins module's `CarrierPages`, one per page in each part.
 */
export function PageRow({ page, onOpen }: PageRowProps) {
  const { t } = useTranslation();
  const answered = page.state === 'settled' || page.state === 'read';
  const verdicts = verdictWords(page.verdicts, t);
  const found = [
    page.requirements > 0 ? t('cerberus.bulletins.pageRow.requirements', { count: page.requirements }) : t('cerberus.bulletins.pageRow.noRequirement'),
    ...(verdicts === '' ? [] : [verdicts]),
  ].join(' · ');

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(page.page)}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-left hover:bg-background focus-visible:[outline-offset:-2px] [@container(min-width:720px)]:grid-cols-[4.5rem_11.5rem_minmax(0,1fr)_minmax(0,12rem)_1rem]"
      >
        <span className="col-start-1 row-start-1 text-[14px] font-medium tabular-nums text-foreground">
          {t('cerberus.bulletins.pageRow.page', { page: page.page })}
        </span>
        <span className="col-start-2 row-start-1 flex min-w-0 justify-end [@container(min-width:720px)]:justify-start">
          <StateBadge look={PAGE_STATE_LOOK[page.state]} words={t(`cerberus.bulletins.pageState.${page.state}`)} />
        </span>
        <ChevronRight className="col-start-3 row-start-1 size-4 flex-none text-ink-faint [@container(min-width:720px)]:col-start-5" aria-hidden="true" />
        {answered && (
          <span className="col-span-3 min-w-0 text-[13px] tabular-nums text-foreground [@container(min-width:720px)]:col-span-1 [@container(min-width:720px)]:col-start-3 [@container(min-width:720px)]:row-start-1">
            {found}
          </span>
        )}
        <span className="col-span-3 min-w-0 text-[12.5px] text-muted-foreground [@container(min-width:720px)]:col-span-1 [@container(min-width:720px)]:col-start-4 [@container(min-width:720px)]:row-start-1">
          {pageWhenWords(page, t)}
        </span>
      </button>
    </li>
  );
}
