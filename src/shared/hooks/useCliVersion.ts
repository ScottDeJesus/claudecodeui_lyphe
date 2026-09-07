import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import type { CliVersionReport } from '@/shared/types';

/**
 * How often the report is re-read. The server caches its own probe for 60 s, so a faster poll
 * would ask the same cached answer twice; a slower one would leave a finished run on screen.
 */
const POLL_MS = 60_000;

/**
 * The report is held at MODULE scope, behind one poller shared by every consumer.
 *
 * Not a per-component `useState`: the sidebar mounts this hook once per session row, and a
 * hook that fetched on its own would put one request per conversation on the wire every minute
 * — the same picture, N times. One store, one interval, N subscribers.
 *
 * ⚠ Module scope is per DOCUMENT: a reload or a second tab starts with nothing and asks again.
 * That is correct here — the report is a reading of right now, never something to carry over.
 */
let report: CliVersionReport | null = null;
/**
 * The last body VERBATIM. A poll that answers the same JSON republishes nothing, so an idle
 * app does not re-render every session row once a minute for a picture that did not move.
 */
let lastBody = '';
let timer: ReturnType<typeof setInterval> | null = null;
/** The read in flight, so a mount during one joins it instead of opening a second. */
let inFlight: Promise<boolean> | null = null;
/** Which read owns the slot above. A forced read takes it, so an older one cannot clear it. */
let newestRead = 0;
/** The newest token that has ANSWERED. An older answer landing after it is dropped, not published. */
let newestAnswer = 0;

const listeners = new Set<() => void>();

/**
 * Reads the route and publishes it when it says something new.
 *
 * A failure publishes NOTHING and logs nothing: the route answers 200 even when no version
 * could be read, so a throw here is this app's own network or a body that is not JSON. Keeping
 * the last picture is the honest reading of "we could not ask", and a console error would put
 * a transient network blip into a screen's evidence.
 *
 * `force` is what a CALLER waiting on the answer needs. Joining the poll already in flight would
 * hand it a picture taken before whatever it just did, so `refresh()` opens its own request and
 * its promise resolves on a reading no older than the call.
 *
 * Resolves TRUE when a reading was obtained and FALSE when none was — a caller acting on the
 * answer must be able to tell "the route said nothing is stale" from "we could not ask". Reads are
 * also published in TOKEN order, never arrival order: two requests can be open at once, and an
 * older one landing last would otherwise overwrite a newer picture with the one it replaced.
 */
function read(force = false): Promise<boolean> {
  if (inFlight && !force) return inFlight;
  const token = ++newestRead;
  inFlight = (async () => {
    try {
      const response = await api.cliVersion();
      const body = await response.text();
      if (!response.ok) return false;
      // A reading, but not the newest one: the screen already shows something later than this.
      if (token < newestAnswer) return true;
      // An unchanged answer IS a reading, and claims the token like any other — otherwise a body
      // that simply repeated itself would stop protecting the screen from an older one.
      if (body === lastBody) { newestAnswer = token; return true; }
      const parsed = JSON.parse(body) as CliVersionReport;
      if (!Array.isArray(parsed.running)) return false;
      // Claimed HERE, once the answer is known to be a report. Claimed any earlier, a 200 carrying
      // something else — an interstitial, a truncated body — would take the token, publish nothing,
      // and then discard a good older reading AND tell the caller waiting on it that one arrived.
      newestAnswer = token;
      lastBody = body;
      report = parsed;
      for (const listener of listeners) listener();
      return true;
    } catch {
      // Nothing to say: the picture that is already here is the best one available.
      return false;
    } finally {
      // Only if this is still the newest read: a forced one starting mid-poll takes the slot, and
      // clearing it unconditionally would drop the newer request a later joiner should get.
      if (newestRead === token) inFlight = null;
    }
  })();
  return inFlight;
}

/** Subscribes one consumer, starting the shared poller for the first and stopping it for the last. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    void read();
    timer = setInterval(() => void read(), POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => report;

/**
 * The installed Claude CLI, and which live conversations are running a different one.
 *
 * Used by the chat module (the banner above the transcript, and the composer's restart toast)
 * and the sidebar module (the footer's fact line and the session row's inert badge). It is the
 * ONE place the comparison is made — three screens reading three comparisons is three chances
 * for them to disagree about the same fact.
 *
 * `staleSessionIds` holds only sessions with a run alive right now: a finished conversation
 * that once ran an older CLI is not stale, it is simply over.
 *
 * `reason` is the route's OWN words for why `installed` is null, and it is what separates the two
 * states that would otherwise render the same sentence: before the first answer lands, `installed`
 * and `reason` are BOTH null — nothing has been read, so nothing may be explained.
 *
 * `refresh()` resolves on a reading no older than the call — TRUE when one was obtained — so a
 * caller may act on the answer and can tell it apart from having failed to ask.
 */
export function useCliVersion(): {
  installed: string | null;
  reason: string | null;
  staleSessionIds: Set<string>;
  staleVersionOf: (sessionId: string) => string | null;
  refresh: () => Promise<boolean>;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  const installed = current?.installed ?? null;

  // THE comparison, made once for the whole app. `installed` unknown (a bare `claude` on PATH,
  // resolved only when a run starts) means nothing can be called stale — Phase 14 answers null
  // rather than a stand-in version precisely so this branch exists. A run whose `cliVersion` is
  // still null has not announced itself yet, which is "not heard", not "different".
  const staleRuns = useMemo(() => {
    const runs = new Map<string, string>();
    if (typeof installed !== 'string') return runs;
    for (const run of current?.running ?? []) {
      if (typeof run.cliVersion === 'string' && run.cliVersion !== installed) {
        runs.set(run.sessionId, run.cliVersion);
      }
    }
    return runs;
  }, [current, installed]);

  const staleSessionIds = useMemo(() => new Set(staleRuns.keys()), [staleRuns]);
  const staleVersionOf = useCallback((sessionId: string) => staleRuns.get(sessionId) ?? null, [staleRuns]);
  const refresh = useCallback(() => read(true), []);

  return { installed, reason: current?.reason ?? null, staleSessionIds, staleVersionOf, refresh };
}
