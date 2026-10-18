import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { FACES, listWords } from '@/modules/affected-areas/utils/tourModel';
import type { Budget, ReadResult, ViewEntry } from '@/shared/affected-areas-types';
import type { PanoPress, TourReaderProgress } from '@/shared/types';
import { Banner, Button, Meter } from '@/shared/ui';

type ReadControlProps = {
  /** The open pano's press and what it stands on; null on the tour screen, where only Read the rest is offered. */
  pano: {
    press: PanoPress;
    /** The pano's views: whose reads Read again answers, and which faces are still unread. */
    views: ViewEntry[];
    /** The contract the codebook reads under now; null until the codebook answers, which offers no contract reason. */
    contract: string | null;
    onRead: () => void;
    onReadAgain: () => void;
  } | null;
  walk: TourReaderProgress;
  /** Panos of the tour with a face not yet read: what Read the rest would read. Zero takes the press away. */
  unreadPanos: number;
  /** Those panos' unread views, six for a pano never cut: what Read the rest would spend, said before it does. */
  unreadViews: number;
  onReadRest: () => void;
  /** Ends the walk after the pano in hand; offered beside its meter while it runs. */
  onStopRest: () => void;
};

/** The reason codes with words of their own; any other code is said as it is, inside a sentence. */
const KNOWN_REFUSALS = [
  'budget', 'flag_off', 'restorly_ai_off', 'gemini_off', 'no_key', 'permanent', 'views_refused',
  'unreachable', 'no_secret', 'unreadable', 'gone', 'failed',
];

/** Refusals no retry clears today — a spent budget, or a switch or a key a person has to set — so while one stands, the press it refused stops being the loudest control. */
const LASTING_REFUSALS = ['budget', 'flag_off', 'restorly_ai_off', 'gemini_off', 'no_key'];

/** The module's words are English only, so its counts are set as English sets them: "2,000". */
const COUNT = new Intl.NumberFormat('en');

/** Every press is 44 px tall below `md`, Verve's touch minimum: the presses that spend are never the smallest targets. */
const PRESS = 'max-md:h-11';

/**
 * Why a read was refused, in words. A spent budget names WHICH one when the answer carries the numbers: the
 * tour's own day (600 reads) before the fleet's (2,000), since the tour's is the nearer wall.
 */
function refusalWords(reason: string, t: TFunction, budget?: Budget): string {
  if (reason === 'budget' && budget !== undefined) {
    if (budget.tourUsed !== null && budget.tourUsed >= budget.tourCap) {
      return t('affectedAreas.read.refused.budgetTour', { used: COUNT.format(budget.tourUsed), cap: COUNT.format(budget.tourCap) });
    }
    if (budget.fleetUsed !== null) {
      return t('affectedAreas.read.refused.budgetFleet', { used: COUNT.format(budget.fleetUsed), cap: COUNT.format(budget.fleetCap) });
    }
  }
  return KNOWN_REFUSALS.includes(reason) ? t(`affectedAreas.read.refused.${reason}`) : t('affectedAreas.read.refused.other', { reason });
}

/**
 * Why Read again is offered, or null: the job's context changed since a face was read (the reader would be told
 * something new), or a face was read under a contract older than the codebook's.
 */
function againReason(views: ViewEntry[], contract: string | null, t: TFunction): string | null {
  if (views.some((view) => view.read?.contextChanged === true)) return t('affectedAreas.read.againContext');
  const older = views.find((view) => view.read?.status === 'read' && contract !== null && view.read.contractVersion !== contract);
  return older?.read ? t('affectedAreas.read.againContract', { old: older.read.contractVersion, current: contract }) : null;
}

/**
 * What a read would buy, from the dry run's answer: "6 views · none read yet", "6 views · all read", or, part read,
 * the faces still unread by name — "Floor not read yet · 5 of 6 read" — since the face strip draws an unread face and
 * an empty one alike. The names come from the views' own reads, and are said only when they count what the plan
 * counts (a face read under an older contract is one the plan buys again but the strip shows read).
 */
function planWords(plan: ReadResult, views: ViewEntry[], t: TFunction): string {
  const count = plan.viewsToRead + plan.viewsCached;
  if (plan.viewsCached === 0) return t('affectedAreas.read.planNone', { count });
  if (plan.viewsToRead === 0) return t('affectedAreas.read.planAll', { count });
  const unread = views.filter((view) => view.read?.status !== 'read').map((view) => t(`affectedAreas.faces.${view.face}`));
  return unread.length === plan.viewsToRead
    ? t('affectedAreas.read.planFaces', { faces: listWords(unread, t), cached: plan.viewsCached, count })
    : t('affectedAreas.read.plan', { count, cached: plan.viewsCached });
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
 * THE READ PRESS, which spends: what a read would buy, what stands in its way, and the presses that buy it.
 *
 * On the pano screen, top to bottom: what a read of the pano would buy ("Floor not read yet · 5 of 6 read", from the
 * dry run; "Working out what a read would cost…" while it is out, "Cutting this pano into its six views…" for a pano
 * never cut, since the dry run is what cuts it), what the rest of the tour would buy ("Rest of this tour: 5 panos ·
 * 30 views not read yet"), why Read again is offered when it is; then each wall in words, BEFORE the presses it
 * refuses — the lane's fault, a dry run refused, the last press refused or part read, where the walk stopped, a walk
 * and a press stopped by the same wall said once; then the presses — Read this pano while any view is left to buy,
 * Read again (forced) when the context changed or an older contract read it, Read the rest of this tour while any
 * pano is left. While a wall no retry clears today stands (a spent budget, a switch, a missing key), the presses drop
 * to outline. A press that is out holds both pano presses busy and says how long it takes.
 *
 * On the tour screen the walk alone: "45 panos · 270 views not read yet" and Read the rest; while it runs, "Reading
 * 3 of 45" over a meter with Stop after this pano beside it; where it stopped, why; and how many panos it passed over
 * because their views could not be cut.
 *
 * Every press stays in the tab order while busy (`busy`, never `disabled`). Used by the affected-areas module's
 * `TourScreen` and `PanoScreen`.
 */
export function ReadControl({ pano, walk, unreadPanos, unreadViews, onReadRest, onStopRest }: ReadControlProps) {
  const { t } = useTranslation();
  const press = pano?.press ?? null;
  const plan = press?.plan ?? null;
  const planRefusal = plan?.status === 'refused' ? plan.reason ?? 'views_refused' : null;
  const again = pano === null ? null : againReason(pano.views, pano.contract, t);
  const left = plan === null || planRefusal !== null || plan.viewsToRead > 0;
  const rest = t(pano === null ? 'affectedAreas.read.rest' : 'affectedAreas.read.restOfTour', {
    panos: t('affectedAreas.tour.panos', { count: unreadPanos }),
    views: t('affectedAreas.read.viewCount', { count: unreadViews }),
  });
  // The last press's answer once it is back, and the wall it met; the walk's wall once it has stopped. One wall met
  // by both is said once, in the walk's sentence with the press's numbers.
  const last = press !== null && press.pressing === null ? press.last : null;
  const lastRefusal = last?.status === 'refused' ? last.reason ?? 'failed' : null;
  const walkStop = walk.running ? null : walk.lastRefusal;
  const oneWall = walkStop !== null && walkStop === lastRefusal;
  const quiet = [lastRefusal, walkStop].some((reason) => reason !== null && LASTING_REFUSALS.includes(reason));
  const loud = quiet ? 'outline' : 'default';

  let planLine = null;
  if (press !== null && press.trouble === null && planRefusal === null) {
    if (plan !== null) planLine = planWords(plan, pano?.views ?? [], t);
    else planLine = t(pano !== null && pano.views.length === 0 ? 'affectedAreas.read.cutting' : 'affectedAreas.read.planning');
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {planLine !== null && <p className="text-[13.5px] text-foreground">{planLine}</p>}
      {pano === null && (
        <p className="text-[13.5px] text-foreground">{unreadPanos > 0 ? rest : t('affectedAreas.read.allRead')}</p>
      )}
      {pano !== null && unreadPanos > 0 && <p className="text-[12.5px] text-muted-foreground">{rest}</p>}
      {again !== null && <p className="text-[12.5px] text-muted-foreground">{again}</p>}

      {press !== null && press.trouble !== null && <Wall words={refusalWords(press.trouble, t)} />}
      {planRefusal !== null && <Wall words={refusalWords(planRefusal, t, plan?.budget)} />}
      {last?.status === 'cached' && <p className="text-[12.5px] text-muted-foreground">{t('affectedAreas.read.cached')}</p>}
      {last?.status === 'partial' && (
        <Wall words={t('affectedAreas.read.partial', { failed: last.viewsFailed, count: last.viewsToRead, reason: refusalWords(last.reason ?? 'failed', t, last.budget) })} />
      )}
      {lastRefusal !== null && !oneWall && <Wall words={refusalWords(lastRefusal, t, last?.budget)} />}
      {walkStop !== null && (
        <Wall words={t('affectedAreas.read.stopped', { index: walk.index, total: walk.total, reason: refusalWords(walkStop, t, oneWall ? last?.budget : undefined) })} />
      )}
      {!walk.running && walk.skipped > 0 && <Wall words={t('affectedAreas.read.skipped', { count: walk.skipped })} />}

      <div className="flex flex-wrap gap-2">
        {pano !== null && left && (
          <Button size="sm" variant={loud} className={PRESS} busy={pano.press.pressing !== null} onClick={pano.onRead}>
            {pano.press.pressing === 'read' ? t('affectedAreas.read.readingPano') : t('affectedAreas.read.readPano')}
          </Button>
        )}
        {pano !== null && again !== null && (
          <Button size="sm" variant={left ? 'outline' : loud} className={PRESS} busy={pano.press.pressing !== null} onClick={pano.onReadAgain}>
            {pano.press.pressing === 'again' ? t('affectedAreas.read.readingAgain') : t('affectedAreas.read.readAgain')}
          </Button>
        )}
        {(unreadPanos > 0 || walk.running) && (
          <Button size="sm" variant={pano === null ? loud : 'outline'} className={PRESS} busy={walk.running} onClick={onReadRest}>
            {walk.running ? t('affectedAreas.read.readingRest') : t('affectedAreas.read.readRest')}
          </Button>
        )}
      </div>

      {pano !== null && pano.press.pressing !== null && (
        <p role="status" className="text-[12.5px] text-muted-foreground">
          {t('affectedAreas.read.readingViews', { count: pano.press.pressing === 'again' ? pano.views.length : plan?.viewsToRead ?? FACES.length })}
        </p>
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
          <Button size="sm" variant="outline" className={`flex-none ${PRESS}`} onClick={onStopRest}>
            {t('affectedAreas.read.stopRest')}
          </Button>
        </div>
      )}
    </div>
  );
}
