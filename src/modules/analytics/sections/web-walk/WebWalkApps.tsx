import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebWalkApp, WebWalkScreen } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { DataTable, Rule } from '@/shared/ui';
import { cn } from '@/shared/utils';
// FILL: fake — this import goes with the fake open row below.
import { FAKE_STATE, fakeOpen } from '@/modules/analytics/sections/web-walk/webWalkFake';
import { appRows } from '@/modules/analytics/sections/web-walk/webWalkFigures';
import type { AppRow } from '@/modules/analytics/sections/web-walk/webWalkFigures';

type WebWalkAppsProps = {
  /** One row per app the walks opened, with its screens. */
  apps: WebWalkApp[];
  /** The window, for the table's name and the quiet line. */
  days: number;
};

/**
 * WHERE THE WALKS WENT: one row per app, the most walked first. Unreached is the column to act on: the times a screen's
 * landmark never showed, which is a dictionary entry gone stale. A zero there is drawn quiet, so a count stands out.
 *
 * THREE COLUMNS, SO A PHONE SHOWS THEM ALL: how many of the app's screens were opened is said under its name rather than
 * in a fourth column, which would push Unreached off a narrow screen.
 *
 * A PRESSED APP OPENS ITS SCREENS UNDER ITSELF, the unreached ones first, each with how often it was opened and, only
 * where it happened, how often it was not reached. Under them, only when one was not reached, stands the command that
 * checks a screen again: the next step, beside the problem. One app is open at a time, none on arrival.
 * A window in which no walk opened an app says so in a line, where the table would stand.
 *
 * Rendered by WebWalkSection, last. Nothing else mounts it.
 */
export function WebWalkApps({ apps, days }: WebWalkAppsProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const rows = appRows(apps);
  // FILL: expanded — useState<string | null>(null): the app open under itself; none on arrival.
  const expanded = fakeOpen(FAKE_STATE).app;
  const onExpand = () => {
    // FILL: onExpand — keeps the pressed row's key as the open app, null to close it.
  };

  const columns: DataTableColumn<AppRow>[] = [
    {
      key: 'app',
      label: t('analytics.webWalk.apps.columns.app'),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span>{row.app}</span>
          <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">{t('analytics.webWalk.apps.screensOpened', { count: row.opened })}</span>
        </span>
      ),
    },
    { key: 'walks', label: t('analytics.webWalk.apps.columns.walks'), align: 'end', render: (row) => <span className="tabular-nums">{row.walks.toLocaleString()}</span> },
    {
      key: 'unreached',
      label: t('analytics.webWalk.apps.columns.unreached'),
      align: 'end',
      render: (row) => <span className={cn('tabular-nums', row.unreached === 0 && 'text-muted-foreground')}>{row.unreached.toLocaleString()}</span>,
    },
  ];

  const screenColumns: DataTableColumn<WebWalkScreen>[] = [
    { key: 'screen', label: t('analytics.webWalk.apps.columns.screen'), render: (screen) => <span className="break-all">{screen.screen}</span> },
    {
      key: 'opened',
      label: t('analytics.webWalk.apps.columns.opened'),
      align: 'end',
      render: (screen) => (
        <span className="flex flex-col items-end gap-0.5 tabular-nums">
          <span>{screen.opened.toLocaleString()}</span>
          {screen.unreached > 0 && <span className="whitespace-nowrap text-xs font-medium text-foreground">{t('analytics.webWalk.apps.unreachedNote', { count: screen.unreached })}</span>}
        </span>
      ),
    },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-web-walk-apps>
      <Rule id={headingId}>{t('analytics.webWalk.apps.title')}</Rule>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('analytics.webWalk.apps.quiet', { days })}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t('analytics.webWalk.apps.about')}</p>
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.app}
            label={t('analytics.webWalk.apps.tableLabel', { days })}
            expanded={expanded}
            onExpand={onExpand}
            renderExpanded={(row) =>
              row.screens.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('analytics.webWalk.apps.noScreens')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <DataTable rows={row.screens} columns={screenColumns} rowKey={(screen) => screen.screen} label={t('analytics.webWalk.apps.screensLabel', { app: row.app })} />
                  {row.unreached > 0 && <p className="break-words text-xs text-muted-foreground">{t('analytics.webWalk.apps.reachHint', { app: row.app })}</p>}
                </div>
              )
            }
          />
        </>
      )}
    </section>
  );
}
