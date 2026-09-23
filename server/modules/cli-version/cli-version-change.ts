/**
 * The moment the installed CLI's version CHANGES, and who wants to hear about it.
 *
 * `cli-version.service.ts` probes the binary; this module is the diff that turns two readings into
 * one event. It is separate for one reason: the observers of an install are not the route and not
 * the chat runtime — they are the keepalive's idle hosts, which that service knows nothing about,
 * and a service that grew a list of its consumers would be a service that knows the shape of the
 * server it runs in. The probe reports what it heard; whoever cares subscribes here.
 *
 * The rule, and why it is a CHANGE rather than a reading:
 * - Only two STRINGS can differ. `null` is "not heard" (`cli-version.service.ts`: the CLI is chosen
 *   when a run starts, or `--version` did not answer), and a null on either side of a pair is not a
 *   version change — a machine whose binary cannot be read has not been upgraded, and a first
 *   reading is not news.
 * - Two readings of the SAME string are not a change either, including the one that follows the
 *   fingerprint re-probe of the same file: the cache moves when the version moves, not when the
 *   process asks again.
 * - The same version READ BACKWARDS never happens here (a re-probe is a new reading, and nothing
 *   reorders them), so `from` is always the older answer in time. Which of the two is the OLDER
 *   BUILD is a different question, and the one consumer answers it with the ordered comparison the
 *   message path already uses (`chat-process.ts`'s `isBehindInstalled`) — a downgrade is a change,
 *   and no process ahead of the binary is retired for it.
 *
 * An observer runs inside the probe's own promise chain, so it must not throw and must not block
 * on the reading: each call is guarded, and the keepalive's sweep defers its own work
 * (`idle-version-sweep.ts`) rather than making a version poll wait on tmux.
 *
 * consumer: cli-version.service.ts (the caller), session-host/idle-version-sweep.ts (the observer)
 */

export type InstalledCliVersionChange = {
  /** The version the previous reading carried. */
  from: string;
  /** The version this reading carries. */
  to: string;
};

type Observer = (change: InstalledCliVersionChange) => void;

/** Registered once per process, from the boot that owns the keepalive. A Set because nothing here
 *  decides how many consumers the fact is allowed to have. */
const observers = new Set<Observer>();

/** Adds an observer of installed-version changes. Returns nothing: an observer lives as long as the
 *  process, exactly like the reading it watches. */
export function observeInstalledCliVersionChanges(observer: Observer): void {
  observers.add(observer);
}

/**
 * Publishes a transition, if the two readings are one. Called by the probe with the answer it just
 * took and the one it replaced — the previous reading as it was BEFORE this probe overwrote it,
 * which is the only place either number is still in hand.
 */
export function noteInstalledVersionReading(previous: string | null, next: string | null): void {
  if (typeof previous !== 'string' || typeof next !== 'string' || previous === next) return;
  for (const observer of observers) {
    try {
      observer({ from: previous, to: next });
    } catch (error) {
      // One observer's failure is not the probe's: the reading is already taken and must be
      // returned to whoever asked for it.
      console.warn(
        `[cli-version] an installed-version observer failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
