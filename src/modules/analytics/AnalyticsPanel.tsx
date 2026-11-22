import { Suspense, useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ANALYTICS_SECTIONS } from '@/modules/analytics/sections/registry';
import type { AnalyticsChoice } from '@/modules/analytics/types';
import { SCREEN_FRAME } from '@/shared/constants';
import { Rule, SegmentedControl, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * THE ANALYTICS AREA'S PANE: the house's numbers, one section at a time.
 *
 * THE HEAD IS TWO QUESTIONS, AND IT STAYS PUT. Which section (the strip, drawn from `ANALYTICS_SECTIONS`, one option per
 * row from the first day) and how far back (the chosen section's own windows), each the kit's segmented control, under
 * the area's Rule. They stand at the head in every state, a section still downloading, still reading or unreachable
 * included, so the way to ask a different question never moves.
 *
 * THE BODY IS THE CHOSEN SECTION'S, under the head in a Suspense: a section's code is its own chunk. While it downloads
 * the pane draws the ring with the words the section's own read draws next, in the same place, so opening a section is
 * one wait to the eye and not two.
 *
 * IT COMPOSES, IT DOES NOT BUILD, and it reads nothing: every piece is the kit's, and the numbers are each section's.
 *
 * THE CHOICE IS KEPT: `{ section, days }` under `analytics-view` in localStorage, written at each press. A stored id the registry
 * does not hold, or a window its section does not offer, falls to the first row and its default.
 *
 * Mounted by project-workspace (`WorkspaceMain`) through the barrel's lazy export, under the screen's own head.
 */
export function AnalyticsPanel() {
  const { t } = useTranslation('common');
  const titleId = useId();

  const [choice, setChoice] = useState<AnalyticsChoice | null>(readKeptChoice);
  const choose = useCallback((next: AnalyticsChoice) => {
    setChoice(next);
    keepChoice(next);
  }, []);

  const chosen = ANALYTICS_SECTIONS.find((row) => row.id === choice?.section);
  if (choice === null || chosen === undefined) return null;

  // A pressed section opens on its own default window; pressing the open one again changes nothing.
  const openSection = (id: string) => {
    const row = ANALYTICS_SECTIONS.find((each) => each.id === id);
    if (row === undefined || row.id === chosen.id) return;
    choose({ section: row.id, days: row.defaultDays });
  };
  const openWindow = (value: string) => {
    const days = Number(value);
    if (!chosen.windows.includes(days)) return;
    choose({ section: chosen.id, days });
  };

  return (
    <section className="h-full overflow-y-auto" aria-labelledby={titleId} data-analytics-panel={chosen.id}>
      {/* The page's frame, the one its head keeps to: at a wide desk the dashboard is as wide as the head over it. */}
      <div className={cn(SCREEN_FRAME, 'flex flex-col gap-4 pb-6 pt-2 finger:pt-4')}>
        <header className="flex flex-col gap-3">
          <Rule level={2} id={titleId}>
            {t('analytics.title')}
          </Rule>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label={t('analytics.head.sections')}
              options={ANALYTICS_SECTIONS.map((row) => ({ value: row.id, label: t(row.titleKey) }))}
              value={chosen.id}
              onChange={openSection}
            />
            {/* Three windows, all worth seeing at once, so a segmented control and not a list to open. */}
            <SegmentedControl
              label={t('analytics.head.window')}
              options={chosen.windows.map((days) => ({ value: String(days), label: t('analytics.head.days', { days }) }))}
              value={String(choice.days)}
              onChange={openWindow}
            />
          </div>
        </header>

        <Suspense
          fallback={
            <div className="flex justify-center py-12" data-analytics-frame="opening">
              <Spinner label={t('analytics.frame.reading')} />
            </div>
          }
        >
          <chosen.Body key={chosen.id} days={choice.days} />
        </Suspense>
      </div>
    </section>
  );
}

/** Where the panel keeps its choice between visits. */
const VIEW_KEY = 'analytics-view';

/** A JSON object: not null, not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored choice the registry can open as it is, else the first row on its default; null only for an empty registry. */
function settledChoice(stored: unknown): AnalyticsChoice | null {
  const first = ANALYTICS_SECTIONS[0];
  if (first === undefined) return null;
  const fallback = { section: first.id, days: first.defaultDays };
  if (!isRecord(stored)) return fallback;
  const row = ANALYTICS_SECTIONS.find((each) => each.id === stored.section);
  if (row === undefined || typeof stored.days !== 'number' || !row.windows.includes(stored.days)) return fallback;
  return { section: row.id, days: stored.days };
}

/** The choice kept from the last visit, settled against the registry. Storage that refuses (a private window) is no choice. */
function readKeptChoice(): AnalyticsChoice | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(VIEW_KEY);
  } catch (error) {
    console.warn('The Analytics choice could not be read from storage:', error);
    return settledChoice(null);
  }
  if (raw === null) return settledChoice(null);
  try {
    return settledChoice(JSON.parse(raw));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return settledChoice(null);
  }
}

/** Keeps the choice for the next visit. Storage that refuses costs only the memory, never the press. */
function keepChoice(choice: AnalyticsChoice) {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(choice));
  } catch (error) {
    console.warn('The Analytics choice could not be kept in storage:', error);
  }
}
