import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { CelebrationActive, Moment } from '@/modules/roadmap/celebrationContext';
import {
  catchUpMoments,
  isLater,
  liveMoments,
  momentKey,
  newestCompletion,
  sortMoments,
} from '@/modules/roadmap/utils/celebrationMoments';
import type { MomentWords } from '@/modules/roadmap/utils/celebrationMoments';
import { currentSeenStamp, rememberSeen } from '@/modules/roadmap/utils/seenStamp';
import type { Roadmap } from '@/shared/roadmap-types';
import { hasHydratedUserPreferences, subscribeToUserPreferences } from '@/shared/userSettings';

// ----------------- THE TUNING: every threshold and timing the celebrations run on -----------------
// The design's reversal is changing these numbers, here and nowhere else.

/**
 * How many features shipped while the reader was away stop being a list and become ONE moment, whose
 * banner counts them. Replaying 37 shipped features on a return would bury the one moment that
 * matters; three is still a few separate, readable ships. Raise it to play more of them one by one.
 */
const FEATURE_SUMMARY_MIN = 4;

/** The beat between one moment and the next, in ms: long enough that two moments never read as one. */
const GAP_MS = 300;

/**
 * How long each size holds, in ms: the length of the motion it plays, so a bigger moment is longer
 * (the design's "about 0.4, 1.2, 2 and 3.5 seconds"). A milestone must hold at least as long as
 * `CelebrationLayer`'s own timeline, which is 900 ms of entrance, 2200 ms of hold and 300 ms of leave.
 */
const MOMENT_MS: Record<Moment['level'], number> = { task: 400, feature: 1200, epic: 2000, milestone: 3500 };

/**
 * Under `prefers-reduced-motion: reduce` every moment is still. A row or a card holds a wash for this
 * long, in ms, whatever its size; the milestone's banner keeps its own timeline, since it only fades.
 */
const STILL_WASH_MS = 1500;

/**
 * A feature moment that stands for a run of features carries a line ("6 features shipped while you were
 * away") the reader must have time to read, so it holds this long, in ms, in either motion mode.
 */
const SUMMARY_MS = 2400;

// ---------------------------

/**
 * Every moment any surface of this page has claimed, keyed `<roadmap>:<level>:<name>:<at>`. The Roadmap
 * tab and the chat gutter's widget can both be mounted (the chat stays mounted behind `hidden` while
 * another tab shows) and both read the same picture, so both derive the same moments; the one that
 * reaches a moment first claims it and plays it, and the other finds it claimed and drops it. A reload
 * empties it, which is right: what was played is then the stored stamp's to say.
 */
const CLAIMED_MOMENTS = new Set<string>();

const NOTHING_ACTIVE: CelebrationActive = { tasks: new Set(), features: new Set(), epics: new Set(), milestone: null };

/** What a surface hands its face: the moment playing now, the press that ends it early, and who is moving (see `CelebrationActive`). */
type Celebrations = { moment: Moment | null; skip(): void; active: CelebrationActive };

/** The moment on stage. `playing` is false through the beat between it and the next, while the stage holds still on it. */
type Stage = { moment: Moment; playing: boolean };

/** The moment in play, with the claim it holds (released if the surface stops under it) and the roadmap whose stamp it advances. */
type InPlay = { moment: Moment; key: string; roadmap: string };

/** The names `moment` sets moving. A task is named by its feature, whose meter it is. */
function activeOf(moment: Moment | null): CelebrationActive {
  if (moment === null) return NOTHING_ACTIVE;
  const named = new Set([moment.name]);
  return {
    tasks: moment.level === 'task' ? named : new Set(),
    features: moment.level === 'feature' ? named : new Set(),
    epics: moment.level === 'epic' ? named : new Set(),
    milestone: moment.level === 'milestone' ? moment.name : null,
  };
}

/**
 * Used by `RoadmapPath` (the Roadmap tab's face) and the chat gutter's roadmap widget, each handing it
 * the roadmap on its screen and the ref of the box the reader sees (an element that stays mounted with
 * the surface: the hook observes it once, on mount). It returns what to draw: `moment`
 * and `skip` for `CelebrationLayer`, `active` for `CelebrationContext` (read by `FeatureRow`,
 * `EpicCard` and `MilestonePath`, which play their own part of a moment).
 *
 * MOMENTS ARE READ OFF THE PICTURE'S OWN DATES, never stored: every completion already carries its date.
 * Live, each new picture of the SAME roadmap is diffed against the one before it (a task, a feature, an
 * epic or a milestone that just finished). On a return — mount, a roadmap switch, the surface coming
 * back on screen — every completion later than this roadmap's seen stamp plays, so a night's work is
 * said once when the reader looks. A roadmap with no stamp yet (a first visit) takes its newest
 * completion as the stamp and plays nothing. The stamp is the user's own and follows them between
 * devices (`roadmapSeen`); it moves to the newest date played by a feature, epic or milestone moment,
 * but only once no moment still waiting is dated at or before it. The dispatcher dates an epic and its
 * milestone by their newest feature, so a stamp moved past a feature's date would swallow the epic and
 * the milestone queued behind it for good if the reader left in between. An interruption therefore
 * replays what was not yet stamped, whole, and loses nothing. Returns and writes both measure against
 * the SERVER's stamp as well as this device's (`utils/seenStamp.ts`), which was read at sign-in and may
 * be hours old. A task moment leaves the stamp alone: a task is never replayed, so it never has to
 * account for one.
 *
 * ONE PLAYER PER MOMENT. A moment plays only while `rootRef`'s element is on screen (an
 * `IntersectionObserver` ratio above 0, which a `hidden` ancestor reads as 0, and a page in a
 * background browser tab is not on screen either), and is first claimed in `CLAIMED_MOMENTS`. A surface
 * that is not on screen holds nothing: coming back on screen re-derives from the stamp what no surface
 * played, so a moment waits for a visible surface without anything queued while nobody looks. One that
 * stops under a moment (off screen, another roadmap, unmounted) lets go of its claim, so it is not lost.
 *
 * ONE AT A TIME, smallest first: by size (task, feature, epic, milestone), then by date, with `GAP_MS`
 * between. The stage holds on a moment through that beat when another follows, so the face does not
 * jump to the default milestone and back; it lets go the instant the queue is empty. Two task moments
 * of one feature in a row therefore read as one (its row's motion never leaves between them).
 */
export function useCelebrations(roadmap: Roadmap | null, rootRef: RefObject<HTMLElement>): Celebrations {
  const { t } = useTranslation();
  // Whether the stored preferences have settled: before that the stamp reads its default, and a return
  // measured against it would replay everything.
  const settled = useSyncExternalStore(subscribeToUserPreferences, hasHydratedUserPreferences);
  // Whether the surface's box is on screen right now; every moment waits on it.
  const [onScreen, setOnScreen] = useState(false);
  // The moment on stage, or null once nothing is queued: `moment` and `active` are both read off it.
  const [stage, setStage] = useState<Stage | null>(null);
  // Moments waiting their turn, in play order. A ref: it changes with no render of its own.
  const queue = useRef<Moment[]>([]);
  // The hold of the moment in play, or the beat after it; non-null exactly while the player is busy.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The moment in play and the claim it holds, so a stop can release it and a finish can stamp it.
  const inPlay = useRef<InPlay | null>(null);
  // The newest date played since the stamp last moved, held back while a moment still waiting is dated
  // at or before it (see `settleStamp`); dropped when the surface stops, so what it covered replays.
  const unstamped = useRef<{ roadmap: string; at: string } | null>(null);
  // The last picture of this roadmap seen, which the next one is diffed against.
  const previous = useRef<Roadmap | null>(null);
  // The newest roadmap and words, for the timers and effects below that must not close over an old render.
  const latest = useRef<{ roadmap: Roadmap | null; words: MomentWords }>({ roadmap, words: { catchUp: () => '', alsoReached: () => '' } });
  // The player's four moves, rebuilt each render and called through this ref, so a timer set an hour ago calls the current ones.
  const controls = useRef<{ pump(): void; finish(): void; enqueue(moments: Moment[]): void; stop(): void }>({ pump() {}, finish() {}, enqueue() {}, stop() {} });
  const roadmapName = roadmap?.name ?? null;

  useEffect(() => {
    latest.current = {
      roadmap,
      words: {
        catchUp: (count) => t('roadmap.celebrate.catchUp', { count }),
        alsoReached: (titles) => t('roadmap.celebrate.alsoReached', { count: titles.length, titles: titles.join(', ') }),
      },
    };

    // Moves the stamp to the newest date played, once no moment still waiting would fall at or before it:
    // a waiting moment that is not LATER than the stamp could never be found by a return again.
    const settleStamp = () => {
      const held = unstamped.current;
      if (!held) return;
      if (queue.current.some((moment) => moment.level !== 'task' && !isLater(moment.at, held.at))) return;
      unstamped.current = null;
      rememberSeen(held.roadmap, held.at);
    };

    // Plays the next moment no other surface has claimed; with none left, the stage empties.
    const pump = () => {
      if (timer.current !== null) return;
      const name = latest.current.roadmap?.name;
      for (let next = queue.current.shift(); name && next; next = queue.current.shift()) {
        const key = momentKey(name, next);
        if (CLAIMED_MOMENTS.has(key)) continue;
        CLAIMED_MOMENTS.add(key);
        inPlay.current = { moment: next, key, roadmap: name };
        setStage({ moment: next, playing: true });
        // Matched live, since the reader can flip the setting while the page is open.
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches && next.level !== 'milestone';
        const holdMs = next.summary && next.level === 'feature' ? SUMMARY_MS : still ? STILL_WASH_MS : MOMENT_MS[next.level];
        timer.current = setTimeout(() => controls.current.finish(), holdMs);
        return;
      }
      settleStamp();
      setStage(null);
    };

    // Ends the moment in play, naturally or by a skip: its date joins the newest played, the stamp moves
    // if nothing waiting would be swallowed by it, and the beat before the next begins.
    const finish = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      const done = inPlay.current;
      inPlay.current = null;
      if (done && done.moment.level !== 'task' && !Number.isNaN(Date.parse(done.moment.at))) {
        const held = unstamped.current;
        const newest = held && held.roadmap === done.roadmap && !isLater(done.moment.at, held.at) ? held.at : done.moment.at;
        unstamped.current = { roadmap: done.roadmap, at: newest };
      }
      settleStamp();
      if (queue.current.length === 0) {
        setStage(null);
        return;
      }
      setStage((held) => (held ? { ...held, playing: false } : held));
      timer.current = setTimeout(() => {
        timer.current = null;
        controls.current.pump();
      }, GAP_MS);
    };

    const enqueue = (moments: Moment[]) => {
      const name = latest.current.roadmap?.name;
      if (!name || moments.length === 0) return;
      const waiting = new Set(queue.current.map((moment) => momentKey(name, moment)));
      queue.current = sortMoments([...queue.current, ...moments.filter((moment) => !waiting.has(momentKey(name, moment)))]);
      pump();
    };

    // Lets go of everything: what was waiting, and the claim on a moment cut off mid-play, which another surface (or this one, back on screen) may then play whole.
    const stop = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (inPlay.current) CLAIMED_MOMENTS.delete(inPlay.current.key);
      inPlay.current = null;
      unstamped.current = null;
      queue.current = [];
      setStage(null);
    };

    controls.current = { pump, finish, enqueue, stop };
  });

  // Whether the box is on screen: its intersection ratio above 0 and the page itself showing.
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;
    let boxShowing = false;
    const settle = () => setOnScreen(boxShowing && document.visibilityState === 'visible');
    const observer = new IntersectionObserver((entries) => {
      boxShowing = entries[entries.length - 1].intersectionRatio > 0;
      settle();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', settle);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', settle);
    };
  }, [rootRef]);

  // A first visit: no stamp yet, on this device or the server, so the newest completion becomes it (a
  // roadmap that has completed nothing is stamped at its creation) and nothing plays. Written whether or
  // not the box is on screen. The return below finds no stamp in that same first visit and plays nothing.
  useEffect(() => {
    const current = latest.current.roadmap;
    if (!current || !settled) return undefined;
    let cancelled = false;
    void currentSeenStamp(current.name).then((stamp) => {
      if (!cancelled && stamp === null) rememberSeen(current.name, newestCompletion(current) ?? current.created_at);
    });
    return () => {
      cancelled = true;
    };
  }, [roadmapName, settled]);

  // The return: on mount, on a roadmap switch and whenever the box comes back on screen, every
  // completion later than the stamp plays. The stamp is the newer of this device's and the server's,
  // asked for before anything plays. Stopping lets go of whatever this run queued or claimed.
  useEffect(() => {
    const current = latest.current.roadmap;
    if (!current || !settled || !onScreen) return undefined;
    let cancelled = false;
    void currentSeenStamp(current.name).then((stamp) => {
      // The picture may have moved on while the server answered: the newest of this roadmap is measured.
      const now = latest.current.roadmap;
      if (cancelled || stamp === null || now?.name !== current.name) return;
      controls.current.enqueue(catchUpMoments(now, stamp, FEATURE_SUMMARY_MIN, latest.current.words));
    });
    return () => {
      cancelled = true;
      controls.current.stop();
    };
  }, [roadmapName, settled, onScreen]);

  // Live: each new picture of the same roadmap, against the one before. One that lands while the box
  // is off screen only moves `previous` on: the return above says what was missed. It queues only
  // where the return above is standing (on screen, settled), so that effect's cleanup owns the queue.
  useEffect(() => {
    const before = previous.current;
    previous.current = roadmap;
    if (!roadmap || !before || before.name !== roadmap.name || !onScreen || !settled) return;
    controls.current.enqueue(liveMoments(before, roadmap, FEATURE_SUMMARY_MIN, latest.current.words));
  }, [roadmap, onScreen, settled]);

  const skip = useCallback(() => {
    if (inPlay.current) controls.current.finish();
  }, []);

  const active = useMemo(() => activeOf(stage?.moment ?? null), [stage?.moment]);
  return { moment: stage?.playing ? stage.moment : null, skip, active };
}
