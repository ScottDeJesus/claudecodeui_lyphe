import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebWalkCheck } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { DataTable, Rule } from '@/shared/ui';
import { rankedChecks, shareWords } from '@/modules/analytics/sections/web-walk/webWalkFigures';

type WebWalkChecksProps = {
  /** One row per premade check a walk ran in the window. */
  checks: WebWalkCheck[];
  /** The window, for the table's name and the quiet line. */
  days: number;
};

/**
 * WHAT THE PREMADE CHECKS FOUND: one row per check, the one that answered false most first, since that is the one to look
 * at. A false count says its share of the check's own runs beside it, so 11 is read against 40 and not against nothing.
 * A window in which no walk ran a check says so in a line, where the table would stand.
 *
 * Rendered by WebWalkSection, third. Nothing else mounts it.
 */
export function WebWalkChecks({ checks, days }: WebWalkChecksProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const rows = rankedChecks(checks);

  const columns: DataTableColumn<WebWalkCheck>[] = [
    { key: 'check', label: t('analytics.webWalk.checks.columns.check'), render: (row) => row.check },
    { key: 'ran', label: t('analytics.webWalk.checks.columns.ran'), align: 'end', render: (row) => <span className="tabular-nums">{row.ran.toLocaleString()}</span> },
    {
      key: 'false',
      label: t('analytics.webWalk.checks.columns.false'),
      align: 'end',
      render: (row) => {
        const share = row.false > 0 ? shareWords(row.false, row.ran) : null;
        return (
          <span className="whitespace-nowrap tabular-nums">
            {row.false.toLocaleString()}
            {share !== null && <span className="ml-2 text-xs text-muted-foreground">{t('analytics.webWalk.checks.falseShare', { share: t(share.key, share.values) })}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-web-walk-checks>
      <Rule id={headingId}>{t('analytics.webWalk.checks.title')}</Rule>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('analytics.webWalk.checks.quiet', { days })}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t('analytics.webWalk.checks.about')}</p>
          <DataTable rows={rows} columns={columns} rowKey={(row) => row.check} label={t('analytics.webWalk.checks.tableLabel', { days })} />
        </>
      )}
    </section>
  );
}
