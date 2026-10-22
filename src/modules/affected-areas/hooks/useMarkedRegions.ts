import { useCallback, useMemo, useState } from 'react';

import type { Mark, PanoDetail, Region, ViewDetail } from '@/shared/affected-areas-types';

/** What the operator did on one pano this visit: the regions the engine answered, and the ones he drew. */
type Judged = {
  /** The answered region of each area marked, by region id: the engine's own answer, with its `mark` and `standing`. */
  answered: Record<string, Region>;
  /** The human regions drawn, by the sha of the view they were drawn on, in the order they were drawn. */
  drawn: Record<string, Region[]>;
};

/** The pano's key, as the view root reads it: `tourId/panoId`. */
const panoKey = (pano: PanoDetail): string => `${pano.tourId}/${pano.panoId}`;

/** A mark's time, for ordering: the engine writes ISO text, and an unreadable one sorts as the oldest. */
const markedMs = (mark: Mark): number => {
  const ms = Date.parse(mark.markedAt);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * The mark that stands between a press's answer and the mark a read of the pano carries: the later of the two, and the
 * read's own when they are the same mark. A read that began before the press and landed after it carries the older mark
 * (the answer stands); a read made after it carries the same one, or another session's newer one (the read stands).
 *
 * Used by `UnderstandingMark`, for the judgment of a read's whole account.
 */
export function standingMark(answered: Mark | null, read: Mark | null): Mark | null {
  if (answered === null || read === null) return answered ?? read;
  if (answered.markId === read.markId) return read;
  return markedMs(answered) > markedMs(read) ? answered : read;
}

/**
 * Whether the engine's answer to a press outranks the region a read brought. A read that began before the press and
 * landed after it carries the region unjudged, or under an older mark: the answer outranks it, so a judged area is never
 * redrawn unjudged. The same mark in a read (the read is later, and may carry a line the operator moved since) or a newer
 * one (another session's) outranks the answer: the read is the engine's current word.
 *
 * Used by this file's `laidOver`, and by `useQueue` for the neighbours the Mark screen dims around its area.
 */
export function answerOutranks(answered: Region, read: Region): boolean {
  if (answered.mark === null) return false;
  if (read.mark === null) return true;
  if (answered.mark.markId === read.mark.markId) return false;
  return markedMs(answered.mark) > markedMs(read.mark);
}

/** The pano as it stands once the operator's presses are laid over the read: answers in place, drawn areas appended. */
function laidOver(pano: PanoDetail, judged: Judged): PanoDetail {
  const views = pano.views.map((view): ViewDetail => {
    const regions = view.regions.map((read) => {
      const answered = judged.answered[read.regionId];
      return answered !== undefined && answerOutranks(answered, read) ? answered : read;
    });
    // A drawn area the read does not carry yet (it began before the box was saved, or the pano was not read again) stays
    // on the photo, as the engine last answered it: the copy saved at Missed one is only the first of its marks, and the one
    // press the bar offers on it, Not a change, is answered like any other.
    const missing = (judged.drawn[view.sha256] ?? [])
      .filter((drawn) => !regions.some((region) => region.regionId === drawn.regionId))
      .map((drawn) => judged.answered[drawn.regionId] ?? drawn);
    return missing.length === 0 && regions.every((region, at) => region === view.regions[at]) ? view : { ...view, regions: [...regions, ...missing] };
  });
  return views.every((view, at) => view === pano.views[at]) ? pano : { ...pano, views };
}

/**
 * THE PANO'S REGIONS, WITH THE OPERATOR'S PRESSES LAID OVER THEM. A mark's answer is the judged region (its `mark`,
 * `standing` and the line it was judged against); it replaces that one region where it stands, and a drawn area is
 * appended to its view, so one press redraws one outline and the pano is never fetched again (six faces redrawn to show
 * one change, and the photo flickering). The Missed one answer is the new human region, which `Region` carries whole.
 *
 * The answers are kept beside the pano, not written into it, because the pano is read again on a person's press (the
 * Tours · Mark · Tables switch coming back to Tours, a read of the pano) and a read that began before a press can land
 * after it. The laid-over pano takes each answer over a read of the same region unless the read carries the same mark
 * or a newer one (`answerOutranks`), so a quiet reload landing late never redraws a judged area unjudged (MAN-8577), and
 * a read that carries the press takes over from the answer, with its current `standing`. `replace` and `append` write
 * under the pano the answer is FOR, which need not be the one on screen when it lands.
 *
 * Used by the affected-areas module's view root, which hands the laid-over pano to `PanoScreen`.
 */
export function useMarkedRegions(pano: PanoDetail | null): {
  pano: PanoDetail | null;
  replace: (tourId: string, panoId: string, region: Region) => void;
  append: (tourId: string, panoId: string, viewSha: string, region: Region) => void;
} {
  // What the operator judged on each pano this visit, by pano key. It is state, not derived: the engine's answer to a press
  // exists nowhere else until the pano is read again, and it must outlive a read that lands without it. It holds only the
  // presses made here (a few regions), and is never emptied: an answer for a pano the person has left waits for their return.
  const [judgedByPano, setJudgedByPano] = useState<Record<string, Judged>>({});

  const replace = useCallback((tourId: string, panoId: string, region: Region) => {
    const key = `${tourId}/${panoId}`;
    setJudgedByPano((all) => {
      const judged = all[key] ?? { answered: {}, drawn: {} };
      return { ...all, [key]: { ...judged, answered: { ...judged.answered, [region.regionId]: region } } };
    });
  }, []);

  const append = useCallback((tourId: string, panoId: string, viewSha: string, region: Region) => {
    const key = `${tourId}/${panoId}`;
    setJudgedByPano((all) => {
      const judged = all[key] ?? { answered: {}, drawn: {} };
      return { ...all, [key]: { ...judged, drawn: { ...judged.drawn, [viewSha]: [...(judged.drawn[viewSha] ?? []), region] } } };
    });
  }, []);

  const judged = pano === null ? undefined : judgedByPano[panoKey(pano)];
  const held = useMemo(() => (pano === null || judged === undefined ? pano : laidOver(pano, judged)), [pano, judged]);
  return { pano: held, replace, append };
}
