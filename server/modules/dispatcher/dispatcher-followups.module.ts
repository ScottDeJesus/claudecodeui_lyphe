import fs from 'node:fs';

import { appConfigDb, sessionsDb } from '@/modules/database/index.js';
import { closeFollowupsForCompletions, fileFollowupGapsForChat } from '@/modules/followups/index.js';

import { createBuildGapsFiler } from './dispatcher-build-gaps.service.js';
import type { DispatcherStore } from './dispatcher-state.service.js';

/**
 * What the dispatcher's store does to the follow-ups lane, composed in one place: it SETTLES the items a finished feature, task
 * or epic names (`followups.service.ts` `closeForCompletions`), and it FILES what a finished feature's builders flagged as gaps on
 * the feature's chat (`dispatcher-build-gaps.service.ts`).
 *
 * BOTH READ THE STORE WHOLE, NEVER THE LANE'S PICTURE. The picture forgets a plan a day after it ends and an epic with no plan
 * left, which is right for a card and wrong for a settlement: the server that was down for two days, or whose first read of the
 * store came after the window, would leave every item of what finished meanwhile open for good. A finish has no age here.
 *
 * THE SWEEP RUNS WHEN THE STAMPS MOVE. Its answer is a function of the plans' and epics' stamps and of the items already filed, and
 * an item filed (or unticked) after a stamp is never closed by it (`followups-completion-rule.service.ts`), so a sweep over stamps
 * it has already swept closes nothing. The first read after a boot has no memory and sweeps the whole store; after that a
 * sweep runs only when a stamp differs. A sweep that throws is not remembered, so the next read tries it again. One journal line
 * says what a sweep did, the first after a boot and any that closed something.
 *
 * ORDER. Settle first, file second, and both before the poll's frame is built (the watcher's snapshot calls `settle`), so the
 * "feature finished" alert the endings notifier raises next lists neither an item the completion just closed nor misses a gap the
 * finish just filed. A fault in either is journaled once (`logError`) and never costs the tabs their picture.
 *
 * Consumed by `dispatcher.module.ts`, which calls `settle` with each store the watcher reads.
 */

/** The `app_config` key holding the highest event id whose finished feature already had its build gaps filed — durable, like the endings' marks, so a restart never files twice. */
const BUILD_GAPS_THROUGH_KEY = 'dispatcher_build_gaps_through';

export type DispatcherFollowups = {
  /** Settles and files for one read of the store. Never throws. */
  settle(store: DispatcherStore): void;
};

/** The stamps a sweep depends on, as one string: equal strings mean a sweep would settle nothing the last one did not. */
function stampsOf(store: DispatcherStore): string {
  return JSON.stringify([
    store.plans.map((plan) => [plan.name, plan.completed_at, plan.phases.map((phase) => [phase.key, phase.status, phase.done_at])]),
    store.arcs.map((arc) => [arc.name, arc.status, arc.completed_at, arc.plans]),
  ]);
}

/** A stage report's text, or `null` when the file is gone (the souls directory is pruned); any other failure is said once and reads as no report. */
function readReportFile(path: string, journal: (line: string) => void): string | null {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      journal(`[Dispatcher] could not read the build report ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}

export function createDispatcherFollowups(logError: (message: string) => void): DispatcherFollowups {
  const journal = (line: string): void => console.log(line);

  const buildGaps = createBuildGapsFiler({
    readMark: () => {
      const stored = appConfigDb.get(BUILD_GAPS_THROUGH_KEY);
      const mark = stored === null ? Number.NaN : Number(stored);
      return Number.isFinite(mark) ? mark : null;
    },
    writeMark: (eventId) => appConfigDb.set(BUILD_GAPS_THROUGH_KEY, String(eventId)),
    readReport: (path) => readReportFile(path, journal),
    // A plan's `session` is a provider id or an app id; the chat is there only while the house still holds its row.
    chatOf: (session) => {
      const appSessionId = sessionsDb.resolveAppSessionId(session);
      return sessionsDb.getSessionById(appSessionId) ? appSessionId : null;
    },
    fileGaps: (appSessionId, lines) => fileFollowupGapsForChat(appSessionId, lines)?.length ?? null,
    journal,
  });

  /** The stamps of the last sweep that landed; `null` until one has, so the first read after a boot sweeps everything. */
  let sweptStamps: string | null = null;

  return {
    settle(store) {
      try {
        const stamps = stampsOf(store);
        if (stamps !== sweptStamps) {
          const firstSweep = sweptStamps === null;
          const closed = closeFollowupsForCompletions(store.plans, store.arcs);
          sweptStamps = stamps;
          // Said on the first sweep after a boot (it proves the whole store was read) and whenever a sweep closed something; a stamp
          // moves tens of times a day, and a line per move that closed nothing is not news (the service logs each item it closes).
          if (firstSweep || closed.length > 0) {
            journal(`[Dispatcher] swept the follow-ups over ${store.plans.length} plans and ${store.arcs.length} epics: closed ${closed.length}`);
          }
        }
      } catch (error) {
        logError(`[Dispatcher] could not close follow-ups for a completion: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        buildGaps.observe(store.plans);
      } catch (error) {
        logError(`[Dispatcher] could not file the build gaps of a finished feature: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
