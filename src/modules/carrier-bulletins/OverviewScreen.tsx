import { FileText } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { BulletinsTrouble } from '@/modules/carrier-bulletins/BulletinsTrouble';
import { CarrierRow } from '@/modules/carrier-bulletins/CarrierRow';
import { RefreshButton } from '@/modules/carrier-bulletins/RefreshButton';
import { carrierGroups, GROUP_TONE } from '@/modules/carrier-bulletins/utils/bulletinModel';
import type { OverviewRow } from '@/shared/carrier-bulletins-types';
import type { AffectedAreasTrouble } from '@/shared/types';
import { Card, EmptyState } from '@/shared/ui';

type OverviewScreenProps = {
  /** Every carrier with a current file, as the overview answered; null while the read is out or when it failed. */
  rows: OverviewRow[] | null;
  trouble: AffectedAreasTrouble | null;
  onOpenCarrier: (bulletinId: string) => void;
  onRefresh: () => void;
};

/** Four rows of Verve's waiting surface in the shape of a carrier row, while the first read is out. */
function ReadingRows() {
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden">
      <ul aria-busy="true" className="m-0 list-none p-0">
        <li className="sr-only" role="status">{t('cerberus.bulletins.overview.reading')}</li>
        {[0, 1, 2, 3].map((row) => (
          <li key={row} aria-hidden="true" className="flex flex-col gap-2 border-t border-border px-4 py-3.5 first:border-t-0">
            <div className="flex items-center justify-between gap-3">
              <div className="vv-skeleton h-[18px] w-2/5" />
              <div className="vv-skeleton h-6 w-24 rounded-full" />
            </div>
            <div className="vv-skeleton h-3.5 w-3/5" />
            <div className="vv-skeleton h-3.5 w-4/5" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * THE OVERVIEW: every carrier's current file, what needs the operator first.
 *
 * Read top to bottom: the answer as a headline ("2 carriers need you", its last words in the tone for act; "Every file is
 * read and settled" calm) in the sans heading the other two screens use — the tab's own serif headline stands right above
 * the view's strip, and one serif headline is the tab's — the count under it, and Refresh at the right; then the carriers in up
 * to three groups — Needs you (a page waiting, a reading stopped), Not settled yet (read in part, or not read at all),
 * Settled — each a card of `CarrierRow`s, need first, then by name. A group with no carrier is left out.
 *
 * States: the first read out (four shimmering rows), the lane's fault (its banner with Try again, the headline held back:
 * a monitor that cannot see must not look calm), no carrier on file, and the groups.
 *
 * Used by the carrier-bulletins module's view root, which holds the read and the presses.
 */
export function OverviewScreen({ rows, trouble, onOpenCarrier, onRefresh }: OverviewScreenProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const groups = rows === null ? [] : carrierGroups(rows);
  // The headline says the first group there is: what needs him, else what is not settled, else that all is. Held back on a
  // fault: a monitor that cannot see must not look calm.
  const lead = groups.length > 0 && trouble === null ? groups[0] : null;

  let body;
  if (trouble !== null) body = <BulletinsTrouble trouble={trouble} subject="overview" onRetry={onRefresh} />;
  else if (rows === null) body = <ReadingRows />;
  else if (rows.length === 0) {
    body = <EmptyState icon={FileText} title={t('cerberus.bulletins.overview.empty')} message={t('cerberus.bulletins.overview.emptyMessage')} />;
  } else {
    body = groups.map(({ group, rows: listed }) => (
      <section key={group} aria-labelledby={`${baseId}-${group}`} className="flex min-w-0 flex-col gap-2">
        <h3 id={`${baseId}-${group}`} className="text-xs uppercase tracking-[0.14em] text-ink-faint">
          {t(`cerberus.bulletins.overview.groups.${group}`)} · {listed.length}
        </h3>
        <Card className="overflow-hidden">
          <ul aria-labelledby={`${baseId}-${group}`} className="m-0 list-none divide-y divide-border p-0">
            {listed.map((row, index) => <CarrierRow key={row.bulletin_id} row={row} index={index} onOpen={onOpenCarrier} />)}
          </ul>
        </Card>
      </section>
    ));
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
          {lead === null ? (
            <h2 className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground">
              {t('cerberus.bulletins.overview.title')}
            </h2>
          ) : (
            <>
              <h2 className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground">
                {t(`cerberus.bulletins.overview.headline.${lead.group}Lead`, { count: lead.rows.length })}{' '}
                <span data-tone={GROUP_TONE[lead.group]} className="text-tone-ink">
                  {t(`cerberus.bulletins.overview.headline.${lead.group}Accent`, { count: lead.rows.length })}
                </span>
              </h2>
              <p className="text-[13.5px] text-muted-foreground">
                {[
                  t('cerberus.bulletins.overview.summary.carriers', { count: rows?.length ?? 0 }),
                  t('cerberus.bulletins.overview.summary.pages', { count: rows?.reduce((sum, row) => sum + row.pages, 0) ?? 0 }),
                  ...groups.map(({ group, rows: listed }) => t(`cerberus.bulletins.overview.summary.${group}`, { count: listed.length })),
                ].join(' · ')}
              </p>
            </>
          )}
        </div>
        <RefreshButton onRefresh={onRefresh} />
      </header>
      {body}
    </div>
  );
}
