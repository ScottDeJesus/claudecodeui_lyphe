import type { DispatcherArc, DispatcherArcNoRun } from '@/shared/types.js';

/**
 * Which epics' `no-run` alerts are still to be told, and the mark that makes each one push once.
 *
 * AN EPIC'S OWN OUTING — its design before any feature of it exists, its whole-epic cut — is no plan's, so the house writes its
 * `no-run` record on the epic's own log (`arc_events`, `hooks/dispatcher/store_alerts.py`) and the document carries the newest open one
 * as `arc.no_run`. A record on a PLAN's log is a plan event and goes through the plan endings (`dispatcher-endings.service.ts`), whose
 * push mark it advances; this file is only the epic's.
 *
 * THE MARK IS ON THE RECORD'S `id`, AND IT IS A MARK OF ITS OWN. `arc_events` ids are a sequence of their own: the push mark is a plan-event
 * id, and an arc-event id 40 says nothing about whether plan-event 40 was announced, so sharing it would silence the epic's alert behind a
 * plan event or push it twice. The caller holds it in durable storage, for the reason the endings' head gives: the dev server restarts
 * through a handover that runs the old and the new server side by side, so a mark kept in memory would repeat the last alert on every boot,
 * and read again just before anything is sent it keeps the two servers from pushing one record twice.
 *
 * FIRST SIGHT SEEDS THE MARK, AS THE PUSH MARK IS SEEDED: a store whose alerts were never announced is history, so the first picture writes
 * the highest id it holds and announces nothing, and every record written after that moment is due. The highest is over the epics handed
 * in (a picture with no open alert seeds `0`, and any record is then newer).
 *
 * IT IS HANDED THE EPICS OF THE STORE, never the lane's cut of them: the lane keeps only the epics with a plan still on it
 * (`arcsOnLane`), and the epic whose own design never started has no plan at all — exactly the epic this alert exists for.
 *
 * ONE ALERT IS THE EPIC'S NEWEST OPEN RECORD: two records written between two pictures speak once, for the newer, which is the one
 * still open. A record that is cleared and written again later has a higher id, and speaks again.
 */

/** Where the mark is kept — `dispatcher.module.ts` holds it in `app_config`. `read` is `null` while none was ever stored. */
type ArcAlertMarkStore = {
  read: () => number | null;
  write: (arcEventId: number) => void;
};

/** What `createArcAlertWatch` answers: the one call a picture makes. */
type ArcAlertWatch = {
  /**
   * Reads the epics of one picture of the store and hands `announce` each open alert past the mark, oldest id first. The mark moves after
   * each announcement and never before, so a throw leaves the rest due on the next picture and never marks a push that did not go out.
   */
  observe(arcs: DispatcherArc[], announce: (arc: DispatcherArc, noRun: DispatcherArcNoRun) => void): void;
};

/** The epics that carry an open alert, oldest record first: the order the pushes are read in. */
function openAlerts(arcs: DispatcherArc[]): Array<{ arc: DispatcherArc; noRun: DispatcherArcNoRun }> {
  const open: Array<{ arc: DispatcherArc; noRun: DispatcherArcNoRun }> = [];
  for (const arc of arcs) {
    if (arc.no_run !== null) open.push({ arc, noRun: arc.no_run });
  }
  return open.sort((left, right) => left.noRun.id - right.noRun.id);
}

/**
 * The watch the endings notifier holds for the epics' alerts. Used by `dispatcher-endings.service.ts`, which hands it each picture's epics
 * and turns what it announces into the `dispatcher.no_run` ending, keyed `epic-no-run:<epic>:<id>`.
 */
export function createArcAlertWatch(marks: ArcAlertMarkStore): ArcAlertWatch {
  /** The mark as this process last read or wrote it; `undefined` until the first picture loads it, `null` while no alert was ever seen. */
  let knownMark: number | null | undefined;

  return {
    observe(arcs, announce) {
      const open = openAlerts(arcs);
      if (knownMark === undefined) knownMark = marks.read();
      if (knownMark === null) {
        // First sight: the alerts already open are HISTORY. Write the highest id and announce nothing.
        const highest = open.reduce((top, alert) => Math.max(top, alert.noRun.id), 0);
        marks.write(highest);
        knownMark = highest;
        return;
      }

      const cached = knownMark;
      if (!open.some((alert) => alert.noRun.id > cached)) return;

      let mark = marks.read() ?? cached;
      knownMark = mark;
      for (const { arc, noRun } of open) {
        if (noRun.id <= mark) continue;
        announce(arc, noRun);
        marks.write(noRun.id);
        mark = noRun.id;
        knownMark = mark;
      }
    },
  };
}
