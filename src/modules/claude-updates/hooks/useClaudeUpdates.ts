/**
 * The Claude updates client: the report the tab draws, and the three things it can be asked to do.
 *
 * ONE REPORT, ONE POLLER, N SUBSCRIBERS. The picture is held at module scope behind one shared
 * poller, because three screens read it — the Settings tab, the sidebar footer's row and the
 * collapsed rail's icon — and a hook that fetched on its own would put three requests on the wire
 * for one answer. It is `useCliVersion`'s idiom on purpose: one module-scope report and `lastBody`,
 * one timer, one in-flight read, and answers claimed in TOKEN order so an older read landing last
 * cannot overwrite a newer picture with the one it replaced.
 *
 * TWO CADENCES. Between jobs the report is re-read every 60 s; while a job is being carried out —
 * `installing`, `installed`, `restarting`, `rolling-back` — every 1.5 s, because those states are
 * minutes at most and this is the one screen a person is watching the answer change on. The timer is
 * re-armed the moment the picture says the cadence is not the one it is armed at.
 *
 * A FAILED READ KEEPS THE LAST PICTURE. The handover of this very server is the case that makes it
 * matter: the tab must ride out the gap between the old process retiring and the new one answering
 * rather than blank to a spinner — the job it is watching is the one causing the gap.
 *
 * ⚠ Module scope is per DOCUMENT: a reload or a second tab starts with nothing and asks again.
 * That is right here — the report is a reading of right now, never something to carry over.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { api, errorMessage } from '@/shared/api';
import type {
  ClaudeUpdateApplyRequest,
  ClaudeUpdateJob,
  ClaudeUpdatesReport,
} from '@/shared/claude-update-types';

/** How often the report is re-read between jobs. */
const POLL_MS = 60_000;

/** How often it is re-read while a job is being carried out. */
const BUSY_POLL_MS = 1_500;

/** The report as last published — what every consumer draws. */
let report: ClaudeUpdatesReport | null = null;

/**
 * The last body VERBATIM. A poll that answers the same JSON republishes nothing, so an idle app does
 * not re-render the footer row once a minute for a picture that did not move.
 */
let lastBody = '';

/** The shared poller, or null while nobody is subscribed. */
let timer: ReturnType<typeof setInterval> | null = null;

/** The period `timer` is armed at, so a cadence change can tell it is one. */
let timerMs = 0;

/** The read in flight, so a mount during one joins it instead of opening a second. */
let inFlight: Promise<boolean> | null = null;

/** Which read owns the slot above. A forced read takes it, so an older one cannot clear it. */
let newestRead = 0;

/** The newest token that has ANSWERED. An older answer landing after it is dropped, not published. */
let newestAnswer = 0;

/** Every mounted consumer. The poller starts for the first and stops for the last. */
const listeners = new Set<() => void>();

/** What an action answers with: it was taken, or the server's own words for why it was not. */
export type ClaudeUpdateActionResult = { ok: true } | { ok: false; message: string };

/**
 * Whether a job is one still being carried out.
 *
 * The report refreshes fast on exactly these four states and slowly on every other, so this is one
 * predicate rather than a list of state names repeated in the tab, the footer row and the poller.
 */
export function isUpdateJobActive(job: ClaudeUpdateJob | null): job is ClaudeUpdateJob {
  if (job === null) return false;
  return (
    job.state === 'installing' ||
    job.state === 'installed' ||
    job.state === 'restarting' ||
    job.state === 'rolling-back'
  );
}

/** The poll period the picture in hand calls for: fast while a job is being carried out. */
function cadenceMs(): number {
  return isUpdateJobActive(report?.job ?? null) ? BUSY_POLL_MS : POLL_MS;
}

/** Points the one timer at the period the picture now calls for. A no-op when it is already there. */
function rearm(): void {
  if (timer === null) return;
  const ms = cadenceMs();
  if (ms === timerMs) return;
  timerMs = ms;
  clearInterval(timer);
  timer = setInterval(() => void read(), ms);
}

/**
 * Reads the route and publishes it when it says something new.
 *
 * A failure publishes NOTHING and logs nothing: keeping the last picture is the honest reading of
 * "we could not ask", and a console error would put a transient network blip — a handover's own gap,
 * most of all — into a screen's evidence.
 *
 * `force` is what a CALLER waiting on the answer needs. Joining the poll already in flight would
 * hand it a picture taken before whatever it just did, so `refresh()` and every action open their
 * own request and resolve against a reading no older than the call.
 *
 * Resolves TRUE when a reading was obtained and FALSE when none was — a caller acting on the answer
 * must be able to tell "the route said the job is done" from "we could not ask".
 */
function read(force = false): Promise<boolean> {
  if (inFlight && !force) return inFlight;
  const token = ++newestRead;
  inFlight = (async () => {
    try {
      const response = await api.claudeUpdates.report();
      const body = await response.text();
      if (!response.ok) return false;
      // A reading, but not the newest one: the screen already shows something later than this.
      if (token < newestAnswer) return true;
      // An unchanged answer IS a reading, and claims the token like any other — otherwise a body
      // that simply repeated itself would stop protecting the screen from an older one.
      if (body === lastBody) { newestAnswer = token; return true; }
      const parsed = JSON.parse(body) as ClaudeUpdatesReport;
      if (!Array.isArray(parsed.packages)) return false;
      // Claimed HERE, once the answer is known to be a report. Claimed any earlier, a 200 carrying
      // something else — an interstitial, a truncated body — would take the token, publish nothing,
      // and then discard a good older reading AND tell the caller waiting on it that one arrived.
      newestAnswer = token;
      lastBody = body;
      report = parsed;
      // The picture may have just moved into (or out of) a job's four states, and the cadence is
      // read off the picture: the timer has to be pointed at what is true now.
      rearm();
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

/**
 * The sentence a refusal is shown with.
 *
 * A route refusing by hand answers a `ClaudeUpdateRefusal` — `{ error, message }` — and its `message`
 * is the sentence for the person's eyes. Anything else on a failed status is the error middleware's
 * envelope, whose words live under `error.message`. A body that is not JSON at all leaves only the
 * status, and a sentence about the request beats a parse error about the answer.
 */
async function refusalMessage(response: Response): Promise<string> {
  const fallback = `the server refused the request (${response.status})`;
  try {
    const body = (await response.json()) as { message?: unknown; error?: unknown };
    return errorMessage(body.message) ?? errorMessage(body.error) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * One action: send it, then read the report again.
 *
 * The route's status IS the verdict — a 2xx is `{ ok: true }`, a 400/409 carries the refusal whose
 * message the tab shows under the button that asked. The read afterwards is FORCED and awaited, so a
 * caller that just changed what the server is doing resolves against a picture no older than its own
 * press: the job it started is already on screen when the promise lands. On a refusal it is just as
 * wanted — "the versions on screen are no longer the newest" is a sentence that asks to be re-read.
 */
async function act(send: () => Promise<Response>): Promise<ClaudeUpdateActionResult> {
  let response: Response;
  try {
    response = await send();
  } catch {
    // The request never arrived — the network, or this server mid-handover. Nothing was refused, and
    // the read is still worth a try: the new process may already be answering.
    await read(true);
    return { ok: false, message: 'the request did not reach the server' };
  }
  const result: ClaudeUpdateActionResult = response.ok
    ? { ok: true }
    : { ok: false, message: await refusalMessage(response) };
  await read(true);
  return result;
}

/** Subscribes one consumer, starting the shared poller for the first and stopping it for the last. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    void read();
    timerMs = cadenceMs();
    timer = setInterval(() => void read(), timerMs);
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
 * The update report, the three presses the tab offers, and the automatic-install switch.
 *
 * `report` is null until the first reading lands and stays at the last good one through a failed
 * read; `refresh()` resolves on a reading no older than the call — TRUE when one was obtained — so a
 * caller can tell an answer from having failed to ask.
 *
 * The switch has no state here: its position is the report's `autoInstall.enabled`, and `setAutoInstall`
 * is a write followed by the same forced read every action does.
 *
 * Every action resolves `{ ok: true }` or `{ ok: false, message }`, and never rejects: the tab calls
 * them without awaiting, and an unhandled rejection is not how a refusal should arrive.
 */
export function useClaudeUpdates(): {
  report: ClaudeUpdatesReport | null;
  refresh(): Promise<boolean>;
  check(): Promise<ClaudeUpdateActionResult>;
  apply(request: ClaudeUpdateApplyRequest): Promise<ClaudeUpdateActionResult>;
  restart(): Promise<ClaudeUpdateActionResult>;
  setAutoInstall(enabled: boolean): Promise<ClaudeUpdateActionResult>;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot);

  /** Reads the report again — the manual half of the poll. Answers whether the read landed. */
  const refresh = useCallback(() => read(true), []);

  /** Asks npm now instead of waiting for the next tick. */
  const check = useCallback(() => act(() => api.claudeUpdates.check()), []);

  /** Starts an update of the packages named, at the versions named. */
  const apply = useCallback(
    (request: ClaudeUpdateApplyRequest) => act(() => api.claudeUpdates.apply(request)),
    [],
  );

  /** Hands this process over to the supervisor so the SDK on disk is the one that loads. */
  const restart = useCallback(() => act(() => api.claudeUpdates.restart()), []);

  /** Turns the app's own installing of updates on or off; the server keeps the position. */
  const setAutoInstall = useCallback((enabled: boolean) => act(() => api.claudeUpdates.setAutoInstall(enabled)), []);

  return { report: current, refresh, check, apply, restart, setAutoInstall };
}
