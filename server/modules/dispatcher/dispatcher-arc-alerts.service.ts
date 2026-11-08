import type { DispatcherArc, DispatcherArcAlertMark, DispatcherArcNoRun } from '@/shared/types.js';

/**
 * Which epics' `no-run` alerts are still to be told, and the mark that makes each one push once.
 *
 * AN EPIC'S OWN OUTING — its design before any feature of it exists, its whole-epic cut — is no plan's, so the house writes its
 * `no-run` record on the epic's own log (`arc_events`, `hooks/dispatcher/store_alerts.py`) and the document carries the newest open one
 * as `arc.no_run`. A record on a PLAN's log is a plan event and goes through the plan endings (`dispatcher-endings.service.ts`), whose
 * push mark it advances; this file is only the epic's.
 *
 * THE MARK IS A PAIR — the highest record `id` told and the latest record stamp `at` told — AND IT IS A MARK OF ITS OWN. `arc_events` ids
 * are a sequence of their own: the push mark is a plan-event id, and an arc-event id 40 says nothing about whether plan-event 40 was
 * announced, so sharing it would silence the epic's alert behind a plan event or push it twice. The id alone would climb only while no
 * row is ever removed: `arc_events.id` is a plain `INTEGER PRIMARY KEY` with no AUTOINCREMENT, a new row takes the largest id held plus
 * one, and removing the epic a record sits on (`dispatcher roadmap remove arc`, the natural reply to an alert) frees the top ids for the
 * next row, which an id-only mark would then swallow. So a record is due when its id is above the mark's OR its stamp is after the
 * mark's: the store's stamp only climbs, and each part of the mark keeps the highest it has seen, so a told record is never due again.
 * Two records in one stamped second, the later on a reused id, are the one pair the stamp cannot tell; the cure at the source is the
 * table rebuilt with AUTOINCREMENT, which would make the id enough. The caller holds the pair in durable storage, for the reason the
 * endings' head gives: the dev server restarts through a handover that runs the old and the new server side by side, so a mark kept in
 * memory would repeat the last alert on every boot, and read again just before anything is sent it keeps the two servers from pushing
 * one record twice.
 *
 * FIRST SIGHT SEEDS THE MARK, AS THE PUSH MARK IS SEEDED: a store whose alerts were never announced is history, so the first picture writes
 * the pair the open alerts stand for and announces nothing, and every record written after that moment is due. The pair is over the
 * epics handed in (a picture with no open alert seeds id `0` with no stamp, and any record is then newer).
 *
 * IT IS HANDED THE EPICS OF THE STORE, never the lane's cut of them: the lane keeps only the epics with a plan still on it
 * (`arcsOnLane`), and the epic whose own design never started has no plan at all — exactly the epic this alert exists for.
 *
 * ONE ALERT IS THE EPIC'S NEWEST OPEN RECORD: two records written between two pictures speak once, for the newer, which is the one
 * still open. A record that is cleared and written again later has a higher id — or, when the store handed the id out again, a later
 * stamp — and speaks again.
 */

/** Where the mark is kept — `dispatcher.module.ts` holds it in `app_config`. `read` is `null` while none was ever stored. */
type ArcAlertMarkStore = {
  read: () => DispatcherArcAlertMark | null;
  write: (mark: DispatcherArcAlertMark) => void;
};

/** What `createArcAlertWatch` answers: the one call a picture makes. */
type ArcAlertWatch = {
  /**
   * Reads the epics of one picture of the store and hands `announce` each open alert past the mark, oldest id first. The mark moves after
   * each announcement and never before, so a throw leaves the rest due on the next picture and never marks a push that did not go out.
   */
  observe(arcs: DispatcherArc[], announce: (arc: DispatcherArc, noRun: DispatcherArcNoRun) => void): void;
};

/**
 * The epics that carry an open alert, oldest record first: the order the pushes are read in, and the order the mark needs. A new row takes
 * the largest id held plus one, so among rows that exist together id order is time order, and telling them in it leaves every one still
 * due past the mark that `advanced` makes of the one before.
 */
function openAlerts(arcs: DispatcherArc[]): Array<{ arc: DispatcherArc; noRun: DispatcherArcNoRun }> {
  const open: Array<{ arc: DispatcherArc; noRun: DispatcherArcNoRun }> = [];
  for (const arc of arcs) {
    if (arc.no_run !== null) open.push({ arc, noRun: arc.no_run });
  }
  return open.sort((left, right) => left.noRun.id - right.noRun.id);
}

/**
 * Is this record still to be told, past `mark`? Its id is above the mark's — or its stamp is after the mark's, which is how a record that
 * took an id the store handed out again is told from the one that held it before. A mark with no stamp (`null`: stored before the stamp was
 * kept) compares ids alone, so an upgrade never tells a record that was already told.
 */
function isDue(noRun: DispatcherArcNoRun, mark: DispatcherArcAlertMark): boolean {
  return noRun.id > mark.id || (mark.at !== null && noRun.at > mark.at);
}

/** The mark once `noRun` is told: each part keeps the highest it has seen, so no record moves either part back. */
function advanced(mark: DispatcherArcAlertMark, noRun: DispatcherArcNoRun): DispatcherArcAlertMark {
  return { id: Math.max(mark.id, noRun.id), at: mark.at === null || noRun.at > mark.at ? noRun.at : mark.at };
}

/**
 * The watch the endings notifier holds for the epics' alerts. Used by `dispatcher-endings.service.ts`, which hands it each picture's epics
 * and turns what it announces into the `dispatcher.no_run` ending, keyed `epic-no-run:<epic>:<id>`.
 */
export function createArcAlertWatch(marks: ArcAlertMarkStore): ArcAlertWatch {
  /** The mark as this process last read or wrote it; `undefined` until the first picture loads it, `null` while no alert was ever seen. */
  let knownMark: DispatcherArcAlertMark | null | undefined;

  return {
    observe(arcs, announce) {
      const open = openAlerts(arcs);
      if (knownMark === undefined) knownMark = marks.read();
      if (knownMark === null) {
        // First sight: the alerts already open are HISTORY. Write the pair they stand for and announce nothing.
        const seed = open.reduce<DispatcherArcAlertMark>((mark, alert) => advanced(mark, alert.noRun), { id: 0, at: null });
        marks.write(seed);
        knownMark = seed;
        return;
      }

      const cached = knownMark;
      if (!open.some((alert) => isDue(alert.noRun, cached))) return;

      let mark = marks.read() ?? cached;
      knownMark = mark;
      for (const { arc, noRun } of open) {
        if (!isDue(noRun, mark)) continue;
        announce(arc, noRun);
        mark = advanced(mark, noRun);
        marks.write(mark);
        knownMark = mark;
      }
    },
  };
}
