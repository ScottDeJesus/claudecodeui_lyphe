import { useTranslation } from 'react-i18next';

import { callsKey, countWords, readWords, usdWords } from '@/modules/gemini-spend/geminiFigures';
import type { ConnectorUsage, GeminiRange, MeterUsage } from '@/modules/gemini-spend/types';
import { Readout } from '@/shared/ui';

type GeminiTotalProps = {
  /** The window the figures are for: the answer's own, so a figure is never named for a window it was not read in. */
  range: GeminiRange;
  /** The connector's answer, or null when that door did not answer. */
  connector: ConnectorUsage | null;
  /** CloudCLI's meter's answer, or null when that door did not answer. */
  meter: MeterUsage | null;
  /** When the figures were read: the older of the answers drawn. Null while no door has answered. */
  readAt: string | null;
};

/**
 * The view's one answer: what Gemini cost in the window, the sum of the totals the doors that answered gave, with the
 * cost basis under it and, under that, when it was read: the view reads on the page's events and never on a clock, so a
 * page left open says how old its money is. A door that did not answer is said beside the figure, in the watch tone, so a short total is
 * never read as the whole one.
 *
 * Beside it, the three series the total is made of — features (Restorly and shadow-connector), builds and sessions,
 * CloudCLI — each with its calls. A series whose door did not answer is the unknown dash, never $0.00.
 *
 * Under them, only when a row carries the mark, one line each for what unmeasured and unpriced do to these dollars.
 */
export function GeminiTotal({ range, connector, meter, readAt }: GeminiTotalProps) {
  const { t } = useTranslation();
  const unknownLabel = t('api.gemini.unknown');
  const callsWords = (calls: number) => t(callsKey(calls), { calls: countWords(calls) });

  const total = (connector?.total_usd ?? 0) + (meter?.cost_usd ?? 0);
  const missing = connector === null ? 'connector' : meter === null ? 'meter' : null;
  const basis = Array.from(new Set([connector?.cost_basis, meter?.cost_basis].filter((words): words is string => Boolean(words)))).join(' ');
  const featureCalls = connector ? connector.projects.reduce((sum, project) => sum + project.calls, 0) : 0;
  const budgetCalls = connector ? connector.budgets.reduce((sum, budget) => sum + budget.calls, 0) : 0;
  const rows = [...(connector ? connector.projects.flatMap((project) => project.features) : []), ...(meter ? meter.features : [])];
  const unmeasured = rows.reduce((sum, row) => sum + row.unmeasured_calls, 0);
  const unpriced = Array.from(new Set([...(connector?.unpriced_models ?? []), ...(meter?.unpriced_models ?? [])]));
  const noAnswer = t('api.gemini.total.noAnswer');
  const read = readAt === null ? null : readWords(readAt);
  const note =
    basis === '' && read === null ? undefined : (
      <>
        {basis}
        {read !== null && (
          <span className="block" data-gemini-read-at>
            {t('api.gemini.total.readAt', { when: read })}
          </span>
        )}
      </>
    );

  return (
    <section className="flex min-w-0 flex-col gap-4" data-gemini-section="total">
      <div className="grid min-w-0 grid-cols-2 items-start gap-x-6 gap-y-6 [@container(min-width:48rem)]:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="col-span-2 min-w-0 [@container(min-width:48rem)]:col-span-1" data-gemini-total>
          <Readout
            size="lg"
            label={t('api.gemini.total.label.' + range)}
            value={usdWords(total)}
            note={note}
            change={missing === null ? undefined : { words: t('api.gemini.total.missing.' + missing), tone: 'warn' }}
            unknownLabel={unknownLabel}
          />
        </div>
        <Readout
          label={t('api.gemini.total.features')}
          value={connector ? usdWords(connector.production_usd) : null}
          note={connector ? callsWords(featureCalls) : noAnswer}
          unknownLabel={unknownLabel}
        />
        <Readout
          label={t('api.gemini.total.budgets')}
          value={connector ? usdWords(connector.budgets_usd) : null}
          note={connector ? callsWords(budgetCalls) : noAnswer}
          unknownLabel={unknownLabel}
        />
        <Readout
          label={t('api.gemini.total.cloudcli')}
          value={meter ? usdWords(meter.cost_usd) : null}
          note={meter ? callsWords(meter.calls) : noAnswer}
          unknownLabel={unknownLabel}
        />
      </div>
      {(unmeasured > 0 || unpriced.length > 0) && (
        <p className="text-xs text-muted-foreground" data-gemini-marks-note>
          {unmeasured > 0 && t('api.gemini.total.unmeasured', { calls: callsWords(unmeasured) })}
          {unmeasured > 0 && unpriced.length > 0 && ' '}
          {unpriced.length > 0 && t('api.gemini.total.unpriced', { models: unpriced.join(', ') })}
        </p>
      )}
    </section>
  );
}
