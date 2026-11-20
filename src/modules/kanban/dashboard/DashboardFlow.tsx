import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanStatsDay } from '@/shared/kanban-types';
import type { DataTableColumn } from '@/shared/types';
import { Button, DataTable, DayBars, FoldChevron, Rule } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

/**
 * OPENED AND FIXED PER DAY: is the board keeping up. Cards opened stand above the rule and cards fixed hang below it,
 * on one scale, so a window where more came in than went out is top-heavy at a glance. The legend says both totals.
 *
 * A BAR'S FIGURES ARE NEVER ONLY ITS TITLE. A title is a pointer's, so every day's two numbers are also a table, one
 * press away under the plot: `Day by day`, newest first. It lists the days something happened on and says it left the
 * quiet ones out, because ninety rows of zeros is a table nobody reads. It is folded on load: the picture is the
 * signal, and the table is the detail.
 *
 * A WINDOW WHERE NOTHING MOVED still draws its baseline of stubs, with the sentence that says so: a quiet month is a
 * reading, and an empty frame would read as a chart that failed to load.
 */

type DashboardFlowProps = {
  /** One entry per day of the window, oldest first, zeros included. */
  byDay: KanbanStatsDay[];
  /** The window, in days. */
  days: number;
};

/** Rendered by BugDashboard, second. Nothing else mounts it. */
export function DashboardFlow({ byDay, days }: DashboardFlowProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const tableId = useId();
  // Whether the day-by-day table is open. The section's own, and closed on every mount: the plot is the answer.
  const [tableOpen, setTableOpen] = useState(false);

  const opened = byDay.reduce((sum, day) => sum + day.opened, 0);
  const fixed = byDay.reduce((sum, day) => sum + day.fixed, 0);
  const busyDays = byDay.filter((day) => day.opened > 0 || day.fixed > 0).reverse();

  const columns: DataTableColumn<KanbanStatsDay>[] = [
    { key: 'day', label: t('kanban.dashboard.flow.columns.day'), render: (day) => formatShortDate(day.day) ?? day.day },
    { key: 'opened', label: t('kanban.dashboard.flow.opened'), align: 'end', render: (day) => day.opened },
    { key: 'fixed', label: t('kanban.dashboard.flow.fixed'), align: 'end', render: (day) => day.fixed },
  ];

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId} data-dashboard-flow>
      <Rule id={headingId}>{t('kanban.dashboard.flow.title')}</Rule>

      <DayBars
        label={t('kanban.dashboard.flow.plot', { days, opened, fixed })}
        series={[
          { label: t('kanban.dashboard.flow.opened'), tone: 'info' },
          { label: t('kanban.dashboard.flow.fixed'), tone: 'positive' },
        ]}
        days={byDay.map((day) => ({
          day: day.day,
          values: [day.opened, day.fixed],
          title: t('kanban.dashboard.flow.barTitle', { date: formatShortDate(day.day) ?? day.day, opened: day.opened, fixed: day.fixed }),
        }))}
        peakLabel={(peak) => t('kanban.dashboard.flow.peak', { peak })}
      />

      {busyDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('kanban.dashboard.flow.quiet', { days })}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 self-start text-muted-foreground finger:h-11"
            aria-expanded={tableOpen}
            aria-controls={tableId}
            onClick={() => setTableOpen((open) => !open)}
          >
            <FoldChevron collapsed={!tableOpen} />
            {t('kanban.dashboard.flow.byDay')}
          </Button>
          <div id={tableId}>
            {tableOpen && (
              <div className="flex flex-col gap-2">
                <DataTable rows={busyDays} columns={columns} rowKey={(day) => day.day} label={t('kanban.dashboard.flow.tableLabel')} />
                <p className="text-xs text-muted-foreground">{t('kanban.dashboard.flow.quietLeftOut')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
