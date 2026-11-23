import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebWalkApp, WebWalkScreen } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { DataTable, Rule } from '@/shared/ui';
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
 * WHERE THE WALKS WENT: one row per app, the most walked first, with how many of its screens were opened and how many
 * times a screen was not reached. Not reached means a screen's landmark never showed, which is a dictionary entry gone
 * stale, so it is the column to act on.
 *
 * A PRESSED APP OPENS ITS SCREENS UNDER ITSELF, the not-reached ones first. One app is open at a time, none on arrival.
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

  const count = (value: number) => <span className="tabular-nums">{value.toLocaleString()}</span>;

  const columns: DataTableColumn<AppRow>[] = [
    { key: 'app', label: t('analytics.webWalk.apps.columns.app'), render: (row) => row.app },
    { key: 'walks', label: t('analytics.webWalk.apps.columns.walks'), align: 'end', render: (row) => count(row.walks) },
    { key: 'opened', label: t('analytics.webWalk.apps.columns.screens'), align: 'end', render: (row) => count(row.opened) },
    { key: 'unreached', label: t('analytics.webWalk.apps.columns.unreached'), align: 'end', render: (row) => count(row.unreached) },
  ];

  const screenColumns: DataTableColumn<WebWalkScreen>[] = [
    { key: 'screen', label: t('analytics.webWalk.apps.columns.screen'), render: (screen) => screen.screen },
    { key: 'opened', label: t('analytics.webWalk.apps.columns.opened'), align: 'end', render: (screen) => count(screen.opened) },
    { key: 'unreached', label: t('analytics.webWalk.apps.columns.unreached'), align: 'end', render: (screen) => count(screen.unreached) },
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
                <DataTable rows={row.screens} columns={screenColumns} rowKey={(screen) => screen.screen} label={t('analytics.webWalk.apps.screensLabel', { app: row.app })} />
              )
            }
          />
        </>
      )}
    </section>
  );
}
