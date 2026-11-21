import { useTranslation } from 'react-i18next';

import type { CodeModeAnalytics } from '@/shared/analytics-types';
import { Banner, EmptyState } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { AnalyticsSectionFrame } from '@/modules/analytics/AnalyticsSectionFrame';
import { CodeModeCauses } from '@/modules/analytics/sections/code-mode/CodeModeCauses';
import { CodeModeCompare } from '@/modules/analytics/sections/code-mode/CodeModeCompare';
import { CodeModeOutcomes } from '@/modules/analytics/sections/code-mode/CodeModeOutcomes';
import { CodeModeTrend } from '@/modules/analytics/sections/code-mode/CodeModeTrend';
import { daysCovered } from '@/modules/analytics/sections/code-mode/codeModeFigures';
import { fakeSectionRead } from '@/modules/analytics/sections/code-mode/fakeRead';

/**
 * CODE MODE, the Analytics area's first section: is a launch better off with Code Mode than without it.
 *
 * ONE READ, DRAWN IN THE AREA'S FRAME. The frame owns reading, not answering, how old the numbers are and Refresh;
 * this folder owns what the answer says.
 *
 * ONE ANSWER, FOUR PARTS, in the order a reader asks: the comparison (with against without, per kind and per model),
 * how the scripts fared, what went wrong, and the days. Each part stands under its own `Rule`, is handed its slice of
 * the one answer, and fetches nothing.
 *
 * TWO LINES STAND OVER THE PARTS, and only while they are true. A history younger than the window asked for says so
 * first, as a banner, because it changes how every number under it is read. The kinds the house does not count are
 * named under it in the quiet ink.
 *
 * NO LAUNCH IS A SCREEN OF ITS OWN: the window held none, or the history has not begun. Neither draws four empty parts.
 *
 * The kinds' labels are the verb's and are drawn as they came: no list of kinds lives in this folder.
 */
export function CodeModeSection({ days }: { days: number }) {
  // FILL: answer — the section's one read: `useAnalyticsSection<CodeModeAnalytics>('code-mode', days, narrow)` in place of the fake
  // read (`fakeRead.ts` and `codeModeFake.ts` go with it). `narrow` is this file's to write.
  const { reading, refresh } = fakeSectionRead(days);

  return (
    <AnalyticsSectionFrame reading={reading} refresh={refresh} takenAt={(answer) => answer.generated_at}>
      {(answer) => <CodeModeAnswer answer={answer} />}
    </AnalyticsSectionFrame>
  );
}

/** The section as drawn from one answer: the frame's children, spaced by the frame. Rendered by the Body above, and by nothing else. */
function CodeModeAnswer({ answer }: { answer: CodeModeAnalytics }) {
  const { t } = useTranslation('common');
  const { days, kinds, uncounted, groups, rollups, series, faults, causes } = answer;
  const covered = daysCovered({ firstDay: answer.first_day, today: answer.today, days });
  const young = covered !== null && answer.first_day !== null;

  return (
    <>
      {(young || uncounted.length > 0) && (
        <div className="flex flex-col gap-2" data-code-mode-notes>
          {young && (
            <Banner tone="info">
              {t('analytics.codeMode.historyStarts', { date: formatShortDate(answer.first_day) ?? answer.first_day, count: covered, days })}
            </Banner>
          )}
          {uncounted.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('analytics.codeMode.uncounted', { kinds: uncounted.map((kind) => kind.label).join(t('analytics.codeMode.listSeparator')) })}
            </p>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        answer.first_day === null ? (
          <EmptyState title={t('analytics.codeMode.empty.noHistoryTitle')} message={t('analytics.codeMode.empty.noHistoryMessage')} />
        ) : (
          <EmptyState title={t('analytics.codeMode.empty.title', { days })} message={t('analytics.codeMode.empty.message')} />
        )
      ) : (
        <>
          <CodeModeCompare kinds={kinds} groups={groups} rollups={rollups} />
          <CodeModeOutcomes kinds={kinds} rollups={rollups.filter((row) => row.code_mode && row.model === null)} days={days} />
          <CodeModeCauses causes={causes} faults={faults} kinds={kinds} />
          <CodeModeTrend series={series} kinds={kinds} firstDay={answer.first_day} today={answer.today} days={days} />
        </>
      )}
    </>
  );
}
