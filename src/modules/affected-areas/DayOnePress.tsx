import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Budget, LayoutReadResult } from '@/shared/affected-areas-types';
import type { AffectedAreasTrouble, TourReaderProgress } from '@/shared/types';
import { Banner, Button, Meter } from '@/shared/ui';

type DayOnePressProps = {
  /** The dry run sent on open (one unarmed layout press, which buys nothing): its budget, or its refusal. Null while it is out, and when nothing is left to read. */
  dryRun: LayoutReadResult | null;
  /** The lane's fault when the dry run brought no answer at all. */
  trouble: AffectedAreasTrouble | null;
  /** The walk of the tour's panos whose room layout needs a read, one armed press each, in capture order. */
  walk: TourReaderProgress;
  /** Panos with a view whose room-layout read is missing or not current: what the press would read. Zero takes the press away. */
  unreadPanos: number;
  /** Those panos' views, six for a pano never read: what the press would spend, said before it does. */
  unreadViews: number;
  onRead: () => void;
  /** Ends the walk after the pano in hand; offered beside its meter while it runs. */
  onStop: () => void;
};

/** The layout read's own refusals, worded for it: its own switch, its own budget, its own model and the room list it is told. */
const OWN_REFUSALS = ['flag_off', 'budget', 'permanent', 'context_degraded'];

/** Refusals the layout read meets in the same words the reader's press says them in: the house's switch and key, the cut, the lane. */
const SHARED_REFUSALS = ['no_key', 'gemini_off', 'views_refused', 'unreachable', 'no_secret', 'unreadable', 'gone', 'failed'];

/** Refusals no retry clears today — a spent budget, or a switch or a key a person has to set — so while one stands the press is no longer the loudest control. */
const LASTING_REFUSALS = ['budget', 'flag_off', 'gemini_off', 'no_key'];

/** The module's words are English only, so its counts are set as English sets them: "1,000". */
const COUNT = new Intl.NumberFormat('en');

/** Every press is 44 px tall below `md`, Verve's touch minimum. */
const PRESS = 'max-md:h-11';

/** A count the budget's counter could not read, said as a dash rather than as zero. */
const counted = (value: number | null) => (value === null ? '—' : COUNT.format(value));

/**
 * Why the room layout was not read, in words. A spent budget names WHICH one when the answer carries the numbers: the
 * tour's day (360 views) before the fleet's (900 reads), since the tour's is the nearer wall.
 */
function refusalWords(reason: string, t: TFunction, budget?: Budget): string {
  if (reason === 'budget' && budget !== undefined) {
    if (budget.tourUsed !== null && budget.tourUsed >= budget.tourCap) {
      return t('affectedAreas.dayOne.refused.budgetTour', { used: COUNT.format(budget.tourUsed), cap: COUNT.format(budget.tourCap) });
    }
    if (budget.fleetUsed !== null) {
      return t('affectedAreas.dayOne.refused.budgetFleet', { used: COUNT.format(budget.fleetUsed), cap: COUNT.format(budget.fleetCap) });
    }
  }
  if (OWN_REFUSALS.includes(reason)) return t(`affectedAreas.dayOne.refused.${reason}`);
  if (SHARED_REFUSALS.includes(reason)) return t(`affectedAreas.read.refused.${reason}`);
  return t('affectedAreas.dayOne.refused.other', { reason });
}

/** A warn banner, heard when it mounts: a wall between the person and a read. */
function Wall({ words }: { words: string }) {
  return (
    <div role="alert">
      <Banner tone="warn"><p className="text-sm font-medium">{words}</p></Banner>
    </div>
  );
}

/**
 * READ THE ROOM LAYOUT, the day-one sketch's press, which spends: what a read would buy, what stands in its way, and the
 * press that buys it, drawn as the tour screen draws Read the rest (`ReadControl`).
 *
 * Top to bottom: what the press would read ("8 panos · 48 views need a room-layout read"), or "Every pano's room layout is
 * read."; under it, from the dry run sent on open, today's budget ("Budget today: 30 of 360 reads on this tour, 42 of 900
 * across all tours"), or "Working out what a read would cost…" while it is out; then each wall in words BEFORE the press it
 * refuses — the dry run refused (switched off, today's budget spent, no key, Gemini off), the lane's fault, where the walk
 * stopped, the panos it passed over; then Read the room layout. While it walks: "Reading the room layout…" on the press, and
 * "Reading 3 of 8" over a meter with Stop after this pano beside it. While a wall no retry clears today stands, the press
 * drops to outline. It stays in the tab order while busy (`busy`, never `disabled`).
 *
 * Used by the affected-areas module's `DayOneSketch`, at the top right of the section.
 */
export function DayOnePress({ dryRun, trouble, walk, unreadPanos, unreadViews, onRead, onStop }: DayOnePressProps) {
  const { t } = useTranslation();
  const dryRefusal = dryRun?.status === 'refused' ? dryRun.reason ?? 'failed' : null;
  const walkStop = walk.running ? null : walk.lastRefusal;
  // One wall met by both the dry run and the walk is said once, in the walk's sentence.
  const oneWall = walkStop !== null && walkStop === dryRefusal;
  const quiet = [dryRefusal, walkStop].some((reason) => reason !== null && LASTING_REFUSALS.includes(reason));
  const left = unreadPanos > 0;
  const need = t('affectedAreas.read.rest', {
    panos: t('affectedAreas.tour.panos', { count: unreadPanos }),
    views: t('affectedAreas.dayOne.press.viewsNeedRead', { count: unreadViews }),
  });

  let budgetLine = null;
  if (left && trouble === null && dryRefusal === null && !walk.running) {
    budgetLine = dryRun === null
      ? t('affectedAreas.dayOne.press.planning')
      : t('affectedAreas.dayOne.press.budget', {
        tourUsed: counted(dryRun.budget.tourUsed), tourCap: COUNT.format(dryRun.budget.tourCap),
        fleetUsed: counted(dryRun.budget.fleetUsed), fleetCap: COUNT.format(dryRun.budget.fleetCap),
      });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-day-one-press="">
      <p className="text-[13.5px] text-foreground">{left ? need : t('affectedAreas.dayOne.press.allRead')}</p>
      {budgetLine !== null && <p className="text-[12.5px] text-muted-foreground">{budgetLine}</p>}

      {trouble !== null && <Wall words={refusalWords(trouble, t)} />}
      {dryRefusal !== null && !oneWall && <Wall words={refusalWords(dryRefusal, t, dryRun?.budget)} />}
      {walkStop !== null && (
        <Wall words={t('affectedAreas.read.stopped', { index: walk.index, total: walk.total, reason: refusalWords(walkStop, t, oneWall ? dryRun?.budget : undefined) })} />
      )}
      {!walk.running && walk.skipped > 0 && <Wall words={t('affectedAreas.read.skipped', { count: walk.skipped })} />}

      {(left || walk.running) && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={quiet ? 'outline' : 'default'}
            className={PRESS}
            busy={walk.running}
            data-day-one-press-read=""
            // FILL: onReadLayout — the layout walk's start (`hooks/useLayoutWalk.ts`, shaped as `useTourReader`): each pano
            // whose views need a room-layout read, armed, one at a time in capture order; a refusal ends it in its words.
            onClick={onRead}
          >
            {walk.running ? t('affectedAreas.dayOne.press.reading') : t('affectedAreas.dayOne.press.read')}
          </Button>
        </div>
      )}

      {walk.running && (
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <Meter
              percent={walk.total === 0 ? null : ((walk.index - 1) / walk.total) * 100}
              label={t('affectedAreas.read.walking', { index: walk.index, total: walk.total })}
              value={t('affectedAreas.read.walkingShare', { percent: walk.total === 0 ? 0 : Math.round(((walk.index - 1) / walk.total) * 100) })}
            />
          </div>
          {/* FILL: onStopLayout — the walk ends after the pano in hand, which still lands. */}
          <Button size="sm" variant="outline" className={`flex-none ${PRESS}`} onClick={onStop}>
            {t('affectedAreas.read.stopRest')}
          </Button>
        </div>
      )}
    </div>
  );
}
