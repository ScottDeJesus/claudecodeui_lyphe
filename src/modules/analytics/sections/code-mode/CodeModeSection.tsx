import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeAnalytics, CodeModeCause, CodeModeDay, CodeModeFaultTotals, CodeModeGroup, CodeModeKind } from '@/shared/analytics-types';
import { Banner, EmptyState, SegmentedControl } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { AnalyticsSectionFrame } from '@/modules/analytics/AnalyticsSectionFrame';
import { useAnalyticsSection } from '@/modules/analytics/hooks/useAnalyticsSection';
import { CodeModeCauses } from '@/modules/analytics/sections/code-mode/CodeModeCauses';
import { CodeModeCompare } from '@/modules/analytics/sections/code-mode/CodeModeCompare';
import { CodeModeGlance } from '@/modules/analytics/sections/code-mode/CodeModeGlance';
import { CodeModeOutcomes } from '@/modules/analytics/sections/code-mode/CodeModeOutcomes';
import { CodeModeTrend } from '@/modules/analytics/sections/code-mode/CodeModeTrend';
import { daysCovered } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * CODE MODE, the Analytics area's first section: is a launch better off with Code Mode than without it.
 *
 * ONE READ, DRAWN IN THE AREA'S FRAME. The frame owns reading, not answering, how old the numbers are and Refresh;
 * this folder owns what the answer says.
 *
 * ONE ANSWER, ONE KIND AT A TIME, FIVE PARTS, in the order a reader asks: the glance (the median launch with Code Mode
 * against without), the days, the comparison (per kind and per model), how the scripts fared, and what went wrong. The
 * kind is the page's one filter, the kit's segmented control over the answer's own kinds, every kind on arrival and held
 * for the visit; every part that can be read for one kind is. Each part stands under its own `Rule`, is handed its slice
 * of the one answer, and fetches nothing.
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
  const { reading, refresh } = useAnalyticsSection<CodeModeAnalytics>('code-mode', days, narrow);

  return (
    <AnalyticsSectionFrame reading={reading} refresh={refresh} takenAt={(answer) => answer.generated_at}>
      {(answer) => <CodeModeAnswer answer={answer} />}
    </AnalyticsSectionFrame>
  );
}

/** The kind filter's value for every kind together. The wire spells that null; a segmented control holds strings. */
const ALL_KINDS = '*';

/** The section as drawn from one answer: the frame's children, spaced by the frame. Rendered by the Body above, and by nothing else. */
function CodeModeAnswer({ answer }: { answer: CodeModeAnalytics }) {
  const { t } = useTranslation('common');
  // The kind the page shows, every kind on arrival. Held here for the visit, so a Refresh's newer answer keeps it.
  const [chosenKind, setChosenKind] = useState(ALL_KINDS);
  const { days, kinds, uncounted, groups, rollups, series, faults, causes } = answer;
  const span = { firstDay: answer.first_day, today: answer.today, days };
  const covered = daysCovered(span);
  const young = covered !== null && answer.first_day !== null;
  // A kind a newer answer no longer carries falls back to every kind.
  const shown = kinds.find((entry) => entry.kind === chosenKind) ?? null;
  const kind = shown?.kind ?? null;
  const kindLabel = shown?.label ?? t('analytics.codeMode.allKinds');

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
          {kinds.length > 0 && (
            // A block of its own, so the control keeps its own width in the section's column.
            <div data-code-mode-kind>
              <SegmentedControl
                label={t('analytics.codeMode.kind')}
                options={[{ value: ALL_KINDS, label: t('analytics.codeMode.allKinds') }, ...kinds.map((entry) => ({ value: entry.kind, label: entry.label }))]}
                value={kind ?? ALL_KINDS}
                onChange={setChosenKind}
              />
            </div>
          )}
          <CodeModeGlance kind={kind} kindLabel={kindLabel} groups={groups} rollups={rollups} series={series} span={span} />
          <CodeModeTrend series={series} kind={kind} kindLabel={kindLabel} span={span} />
          <CodeModeCompare kinds={kinds} groups={groups} rollups={rollups} kind={kind} />
          <CodeModeOutcomes kinds={kinds} rollups={rollups.filter((row) => row.code_mode && row.model === null)} days={days} />
          <CodeModeCauses causes={causes} faults={faults} kinds={kinds} />
        </>
      )}
    </>
  );
}

/**
 * The answer as the route carried it, checked key by key at the top: a key missing or of another type is no answer.
 * The rows are carried as the verb printed them: the server's reader narrowed the same keys, and the verb is the one
 * writer of their shape.
 */
function narrow(data: unknown): CodeModeAnalytics | null {
  if (!isRecord(data)) return null;
  const { days, generated_at, today, first_day, kinds, uncounted, groups, rollups, series, faults, causes } = data;
  if (typeof days !== 'number' || typeof generated_at !== 'number' || typeof today !== 'string') return null;
  const firstDay = typeof first_day === 'string' ? first_day : null;
  if (first_day !== null && firstDay === null) return null;
  if (!isList<CodeModeKind>(kinds) || !isList<CodeModeKind>(uncounted)) return null;
  if (!isList<CodeModeGroup>(groups) || !isList<CodeModeGroup>(rollups) || !isList<CodeModeDay>(series)) return null;
  if (!isList<CodeModeCause>(causes) || !isFaultTotals(faults)) return null;
  return { days, generated_at, today, first_day: firstDay, kinds, uncounted, groups, rollups, series, faults, causes };
}

/** A JSON object: not null, not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A list, its rows taken as the verb printed them (see `narrow`). */
function isList<Row>(value: unknown): value is Row[] {
  return Array.isArray(value);
}

function isFaultTotals(value: unknown): value is CodeModeFaultTotals {
  if (!isRecord(value)) return false;
  const { total, by_fault: byFault } = value;
  return typeof total === 'number' && isRecord(byFault);
}
