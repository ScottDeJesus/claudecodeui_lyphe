import { useEffect, useRef, useState } from 'react';

import type { DayOneFloor, LayoutPlanResult, LayoutStatus, TourDetail } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { AffectedAreasTrouble } from '@/shared/types';
import { troubleOfFailure, troubleOfResponse } from '@/shared/utils';

/**
 * A newer word than the tour's own about its plan, and the tour's detail it was learnt against: it holds only while that
 * detail is the one on screen. A detail read again (a quiet reload) is newer than anything held before it, so it replaces it.
 * `floors` is null until a rebuild has answered, and the tour's own plan stands until then.
 */
type Drawn = { against: TourDetail; layout: LayoutStatus; floors: DayOneFloor[] | null };

/** What the section holds of one tour: its rebuild's progress and fault, and the newer word about its plan, if any. */
type Held = { rebuilding: boolean; trouble: AffectedAreasTrouble | null; drawn: Drawn | null };

const BLANK: Held = { rebuilding: false, trouble: null, drawn: null };

/** The state update that changes what the section holds of one tour. A late answer writes to its own tour's record, never another's. */
const holding = (tourId: string, change: (held: Held) => Held) => (all: Record<string, Held>): Record<string, Held> => ({
  ...all,
  [tourId]: change(all[tourId] ?? BLANK),
});

/**
 * THE PLAN IN FORCE OF THE OPEN TOUR, as the day-one sketch draws it: the tour's own `layout` and `dayOne`, unless a newer
 * answer of this hook's own stands over them. Two answers do:
 * - the open's REBUILD. When the tour opens on a `stale` plan (its inputs moved since it was drawn, or reads exist and no plan
 *   is in force yet) the hook sends `buildPlan` ONCE, with no model and nothing bought, and `rebuilding` is true while it is
 *   out; its answer's status and floors are then the section's. A rebuild that brings no answer says its fault in `trouble`
 *   and the section stays as it was. It waits for the view to be shown, so a hidden view sends nothing; it never repeats for
 *   a tour while that tour stays open.
 * - `adopt`: the status a layout press answered with, which replaces the status only, until the tour is read again (the
 *   view root does that after each answer that moved the plan, `useDayOne`'s `onPlanMoved`) and brings the floors.
 *
 * Used by the affected-areas module's `useDayOne`.
 */
export function useLayoutPlan(tourId: string | null, detail: TourDetail | null, shown: boolean) {
  // What is held of each tour opened, by tour: an answer that lands after the person went to another tour writes to ITS
  // tour, so it can neither be lost nor drawn over the open one.
  const [held, setHeld] = useState<Record<string, Held>>({});
  // The latest detail, for an answer that lands after the render that asked: it is held against the detail on screen then.
  const detailRef = useRef(detail);
  useEffect(() => {
    detailRef.current = detail;
  });
  // The tour whose stale plan the open already sent a rebuild for. A ref: it is read when the tour or its status changes,
  // and nothing draws from it. Cleared when the tour is left, so opening it again may rebuild again.
  const rebuiltRef = useRef<string | null>(null);

  const stale = shown && detail?.layout?.status === 'stale';
  useEffect(() => {
    if (tourId === null) {
      rebuiltRef.current = null;
      return;
    }
    if (!stale || rebuiltRef.current === tourId) return;
    rebuiltRef.current = tourId;
    setHeld(holding(tourId, (previous) => ({ ...previous, rebuilding: true, trouble: null })));
    const fail = (trouble: AffectedAreasTrouble) => setHeld(holding(tourId, (previous) => ({ ...previous, rebuilding: false, trouble })));
    void (async () => {
      try {
        const response = await api.affectedAreas.buildPlan(tourId);
        if (!response.ok) {
          fail(await troubleOfResponse(response));
          return;
        }
        const plan = (await response.json()) as LayoutPlanResult;
        const against = detailRef.current;
        setHeld(holding(tourId, (previous) => ({
          rebuilding: false,
          trouble: null,
          drawn: against === null ? previous.drawn : { against, layout: plan.layout, floors: plan.dayOne },
        })));
      } catch (failure) {
        fail(troubleOfFailure(failure));
      }
    })();
  }, [tourId, stale]);

  /** A layout press's status replaces the section's, for the tour it concerned and only while that tour's detail is the one on screen. */
  const adopt = (forTour: string, layout: LayoutStatus) => {
    if (detail === null || detail.tour.tourId !== forTour) return;
    setHeld(holding(forTour, (previous) => ({
      ...previous,
      drawn: { against: detail, layout, floors: previous.drawn?.against === detail ? previous.drawn.floors : null },
    })));
  };

  const mine = tourId === null ? BLANK : held[tourId] ?? BLANK;
  const drawn = mine.drawn !== null && mine.drawn.against === detail ? mine.drawn : null;
  return {
    layout: drawn?.layout ?? detail?.layout ?? null,
    floors: drawn?.floors ?? detail?.dayOne ?? [],
    rebuilding: mine.rebuilding,
    trouble: mine.trouble,
    adopt,
  };
}
