import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usdWords } from '@/modules/gemini-spend/geminiFigures';
import type { GeminiDay } from '@/modules/gemini-spend/geminiFigures';
import type { DataTableColumn } from '@/shared/types';
import { Button, DataTable, DayBars, FoldChevron, Rule } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

type GeminiDaysProps = {
  /** Every UTC day of the window, oldest first, a series null where its door did not answer. */
  days: GeminiDay[];
  connectorAnswered: boolean;
  meterAnswered: boolean;
};

/**
 * The window's days, one column a day, all three series as bars: each door's days in a plot of its own. The connector's
 * plot stands the product's features above the rule and builds and sessions below it, on one scale: what the product
 * spent against what building spent. CloudCLI's plot is its one series on a scale of its own, said beside its legend,
 * because its cents stacked on the connector's dollars would be a line nobody can read. A door that did not answer
 * draws no plot here; its sentence stands in its own place lower down.
 *
 * A bar's figures are never only its title: every day's three numbers are also a table one press away under the plots,
 * newest first, the days with no spend left out.
 *
 * A window of one day (Today) draws no plot: one bar says nothing the total above it has not said.
 * A window nothing was counted in still draws its baselines of stubs, with the sentence that says so.
 * The fold is the section's own, closed on every mount: the plots are the signal and the table the detail.
 */
export function GeminiDays({ days, connectorAnswered, meterAnswered }: GeminiDaysProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const tableId = useId();
  const [tableOpen, setTableOpen] = useState(false);

  if (days.length < 2) return null;

  const dateOf = (day: string) => formatShortDate(day) ?? day;
  const cents = (usd: number) => Math.round(usd * 100) / 100;
  const sumOf = (day: GeminiDay) => (day.features ?? 0) + (day.budgets ?? 0) + (day.cloudcli ?? 0);
  const titleOf = (day: GeminiDay) =>
    t('api.gemini.days.barTitle', {
      date: dateOf(day.day),
      parts: [
        day.features === null ? null : t('api.gemini.days.part.features', { usd: usdWords(day.features) }),
        day.cloudcli === null ? null : t('api.gemini.days.part.cloudcli', { usd: usdWords(day.cloudcli) }),
        day.budgets === null ? null : t('api.gemini.days.part.budgets', { usd: usdWords(day.budgets) }),
      ]
        .filter((part): part is string => part !== null)
        .join(' · '),
    });
  const totalOf = (pick: (day: GeminiDay) => number) => usdWords(days.reduce((sum, day) => sum + pick(day), 0));
  const peakLabel = (peak: number) => (peak > 0 ? t('api.gemini.days.peak', { usd: usdWords(peak) }) : '');
  // Under the connector's plot, CloudCLI's says in words that its bars are not on that plot's scale.
  const ownPeakLabel = (peak: number) => (peak > 0 ? t('api.gemini.days.peakOwn', { usd: usdWords(peak) }) : '');
  const busyDays = days.filter((day) => sumOf(day) > 0).reverse();

  const dayColumn: DataTableColumn<GeminiDay> = { key: 'day', label: t('api.gemini.days.columns.day'), render: (day) => <span className="whitespace-nowrap">{dateOf(day.day)}</span> };
  const featuresColumn: DataTableColumn<GeminiDay> = { key: 'features', label: t('api.gemini.days.columns.features'), align: 'end', render: (day) => usdWords(day.features) };
  const cloudcliColumn: DataTableColumn<GeminiDay> = { key: 'cloudcli', label: t('api.gemini.days.columns.cloudcli'), align: 'end', render: (day) => usdWords(day.cloudcli) };
  const budgetsColumn: DataTableColumn<GeminiDay> = { key: 'budgets', label: t('api.gemini.days.columns.budgets'), align: 'end', render: (day) => usdWords(day.budgets) };
  const columns = [dayColumn, ...(connectorAnswered ? [featuresColumn] : []), ...(meterAnswered ? [cloudcliColumn] : []), ...(connectorAnswered ? [budgetsColumn] : [])];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-gemini-section="days">
      <Rule id={headingId}>{t('api.gemini.days.title')}</Rule>

      <div className="flex min-w-0 flex-col gap-6">
        {connectorAnswered && (
          <div className="min-w-0" data-gemini-plot="connector">
            <DayBars
              label={t('api.gemini.days.plotConnector', { days: days.length })}
              series={[
                { label: t('api.gemini.days.features'), total: totalOf((day) => day.features ?? 0) },
                { label: t('api.gemini.days.budgets'), tone: 'info', total: totalOf((day) => day.budgets ?? 0) },
              ]}
              days={days.map((day) => ({ day: day.day, values: [cents(day.features ?? 0), cents(day.budgets ?? 0)], title: titleOf(day) }))}
              peakLabel={peakLabel}
            />
          </div>
        )}
        {meterAnswered && (
          <div className="min-w-0" data-gemini-plot="cloudcli">
            <DayBars
              label={t('api.gemini.days.plotMeter', { days: days.length })}
              series={[{ label: t('api.gemini.days.cloudcli'), total: totalOf((day) => day.cloudcli ?? 0) }]}
              days={days.map((day) => ({ day: day.day, values: [cents(day.cloudcli ?? 0)], title: titleOf(day) }))}
              peakLabel={connectorAnswered ? ownPeakLabel : peakLabel}
            />
          </div>
        )}
      </div>

      {busyDays.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-gemini-days-quiet>
          {t('api.gemini.days.quiet')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 self-start text-muted-foreground finger:h-11"
            aria-expanded={tableOpen}
            aria-controls={tableId}
            onClick={() => setTableOpen((open) => !open)}
            data-gemini-days-fold
          >
            <FoldChevron collapsed={!tableOpen} />
            {t('api.gemini.days.byDay')}
          </Button>
          <div id={tableId}>
            {tableOpen && (
              <div className="flex flex-col gap-2">
                <DataTable rows={busyDays} columns={columns} rowKey={(day) => day.day} label={t('api.gemini.days.tableLabel')} />
                <p className="text-xs text-muted-foreground">{t('api.gemini.days.tableNote')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
