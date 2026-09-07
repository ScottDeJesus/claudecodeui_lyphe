import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { useCliVersion } from '@/shared/hooks/useCliVersion';
import type { SessionActivityMap } from '@/shared/types';

/**
 * The resume's prompt, verbatim. It carries no context on purpose: the SDK's `resume` option —
 * which every send already uses — hands the new process the whole transcript.
 */
const RESUME_PROMPT = 'Continue from where you stopped.';

/**
 * How long the stop is given to produce its terminal `complete` before the restart is abandoned.
 *
 * Not a guess at how long an abort takes — it is the guarantee that a press can never latch the
 * button for good, and the ONLY thing that ends a stop the gateway never answered.
 */
const STOP_TIMEOUT_MS = 15_000;

/**
 * How long the composer is given to reach its send before the restart is reported as not resumed.
 *
 * `handleSubmit` returns nothing and has silent early returns (no project, a failed upload, a
 * refused session-create), so "it was called" is not evidence that anything was sent.
 */
const RESUME_TIMEOUT_MS = 5_000;

/**
 * The backstop on the banner's suppression after a resume — NOT what normally ends it.
 *
 * The hold is released by a reading taken after the send (`refresh()` resolves on one), so the
 * screen returns to obeying the route within a round trip. This only covers the case where that
 * read never answers at all; without it the app would fall silent about a conversation that is
 * still stale, which is the one thing the banner exists to prevent.
 */
const RESUMED_HOLD_MS = 20_000;

/**
 * One restart, the conversation it belongs to, and the two facts it was decided on.
 *
 * The session id travels WITH the intent, and the intent is state rather than a ref, because a ref
 * cannot schedule the effect that acts on it and "the conversation I am looking at is idle" is not
 * "the run I aborted ended" — the composer is not remounted per conversation.
 *
 * `pressedAt` is what makes the stop's `complete` THIS restart's rather than an older one's, and
 * every phase carries the moment it began (`since`) because the deadlines below are anchored to
 * that rather than to when their effect last ran: an unrelated conversation's `complete`, or a
 * poll landing, re-runs the effect, and a timer re-armed there would push its own deadline out
 * indefinitely — leaving the ending it exists to speak unreachable.
 * `staleVersion` is what the report said this conversation was running when the press was made.
 */
type RestartIntent =
  | { phase: 'idle' }
  | { phase: 'stopping'; sessionId: string; staleVersion: string | null; pressedAt: number; since: number }
  | { phase: 'resuming'; sessionId: string; staleVersion: string | null; since: number }
  | { phase: 'resumed'; sessionId: string; staleVersion: string | null; since: number };

/** One value, one identity: returning to idle is a no-op render rather than a new object. */
const IDLE: RestartIntent = { phase: 'idle' };

type RestartArgs = {
  /** The conversation on screen — the one `submit` will send to. */
  sessionId: string | null;
  /** A live, interruptible run in that conversation, right now (never the polled report). */
  canAbort: boolean;
  /** Every session producing a response, so a submit can be told from a silent early return. */
  processingSessions: SessionActivityMap | undefined;
  /** The composer's existing abort. */
  abort: () => void;
  /** The composer's existing submit. */
  submit: (content: string) => void;
};

/**
 * Stop this conversation and resume it on the installed Claude CLI.
 *
 * Used by `useChatComposerState`, which owns the abort, the submit and the processing flag and
 * hands all three in. It lives in the chat module for that reason: a shared hook would have to
 * re-derive every one of them, and would then own a send it cannot see the result of.
 *
 * Every ending is decided on a fact this restart owns:
 *
 *  · The stop ends on the terminal `complete` for THIS conversation, read off the wire. The
 *    processing map is NOT that evidence — the server rewrites it every 5 s from its own list, so
 *    a sweep that merely stops listing the session would otherwise read as "the run I aborted
 *    ended", and the resume would go out for a stop that never happened.
 *  · The resume is only ATTEMPTED when the socket is OPEN — the exact predicate `sendMessage`
 *    applies — and only CLAIMED when the composer then reached its send. Neither alone is enough:
 *    the map is marked live one statement BEFORE the frame is written, so on a dropped socket it
 *    would say "running" for a turn that never left the browser.
 *
 * One restart runs at a time, and only while it is genuinely in flight: `restartPending` covers
 * every conversation, so a button elsewhere is disabled — with the reason — rather than enabled and
 * inert. A restart that has already resumed holds nothing but its own banner.
 */
export function useRestartOnInstalledCli({
  sessionId,
  canAbort,
  processingSessions,
  abort,
  submit,
}: RestartArgs): {
  handleRestartOnInstalledCli: () => void;
  restartPending: boolean;
  restartingSessionId: string | null;
  restartedSessionId: string | null;
} {
  const pushToast = useToast();
  const { ws, subscribe } = useWebSocket();
  const { installed, staleVersionOf, refresh } = useCliVersion();

  // The restart in flight. State, so that setting it schedules the effects that carry it forward.
  const [intent, setIntent] = useState<RestartIntent>(IDLE);
  // The same value read synchronously, so a second press in the SAME tick is refused before any
  // render could disable the button. Written only through `moveTo`, never during render.
  const intentRef = useRef<RestartIntent>(IDLE);

  const moveTo = useCallback((next: RestartIntent) => {
    intentRef.current = next;
    setIntent(next);
  }, []);

  /** What is left of a phase's deadline, so re-arming the timer cannot extend it. */
  const remainingOf = (since: number, budget: number) => Math.max(0, budget - (Date.now() - since));

  // The last terminal `complete` seen on the wire, and a tick so an effect can react to it. Held
  // as a ref plus a counter rather than as state carrying the frame: what matters is only which
  // conversation ended and when, and a re-render per unrelated `complete` would be noise.
  const lastCompleteRef = useRef<{ sessionId: string; at: number } | null>(null);
  const [completeTick, setCompleteTick] = useState(0);

  useEffect(() => subscribe((event) => {
    if (event?.kind !== 'complete' || typeof event.sessionId !== 'string') return;
    lastCompleteRef.current = { sessionId: event.sessionId, at: Date.now() };
    setCompleteTick((seen) => seen + 1);
  }), [subscribe]);

  // Did the conversation this restart belongs to reach its send? Derived to a BOOLEAN on purpose:
  // the activity map gets a new identity on every status tick, and the effects must not re-arm
  // their timers each time a status line changes.
  const pendingSessionId = intent.phase === 'idle' ? null : intent.sessionId;
  const pendingSessionIsLive = Boolean(pendingSessionId && processingSessions?.get(pendingSessionId));

  const handleRestartOnInstalledCli = useCallback(() => {
    // One restart runs at a time. A SETTLED one (`resumed`) is only holding a banner down while the
    // report catches up — it is not in flight, so it may not refuse a different conversation. The
    // button is disabled for the duration of a real one, so this line is the same-tick backstop
    // rather than the thing a person meets.
    const alreadyRestarting = intentRef.current.phase === 'stopping' || intentRef.current.phase === 'resuming';
    if (alreadyRestarting || !sessionId) return;

    // The report is up to 60 s old, so the banner can still be on screen for a run that has
    // already finished — and an abort for a finished run sends nothing at all. Say so and re-read
    // the report, rather than arming a restart on a press that did nothing.
    if (!canAbort) {
      pushToast({
        tone: 'warn',
        title: 'Nothing to restart',
        message: 'This conversation has already finished, so nothing was stopped.',
      });
      void refresh();
      return;
    }

    const now = Date.now();
    moveTo({ phase: 'stopping', sessionId, staleVersion: staleVersionOf(sessionId), pressedAt: now, since: now });
    abort();
  }, [abort, canAbort, moveTo, pushToast, refresh, sessionId, staleVersionOf]);

  // ---------------------------------------------------------------- stopping → resuming
  useEffect(() => {
    if (intent.phase !== 'stopping') return undefined;

    // `submit` sends to the conversation ON SCREEN. A restart whose conversation is no longer the
    // one on screen is abandoned here — never redirected, and never silently: the stop did happen.
    if (intent.sessionId !== sessionId) {
      moveTo(IDLE);
      pushToast({
        tone: 'warn',
        title: 'Stopped, but not resumed',
        message: 'You opened another conversation while this one was stopping. Open it again and press Restart to continue.',
      });
      return undefined;
    }

    // The abort's own ending, for THIS conversation and no older than the press.
    const ended = lastCompleteRef.current;
    if (!ended || ended.sessionId !== intent.sessionId || ended.at < intent.pressedAt) {
      const timer = window.setTimeout(() => {
        moveTo(IDLE);
        pushToast({
          tone: 'warn',
          title: 'Could not stop the conversation',
          message: 'It never confirmed that it stopped, so nothing was resumed.',
        });
      }, remainingOf(intent.since, STOP_TIMEOUT_MS));
      return () => window.clearTimeout(timer);
    }

    // The run has ended. This is the only moment the resume can go through the normal send: while
    // the flag was up, `handleSubmit` would have stashed it for the server's 30 s dispatcher.
    //
    // `sendMessage` writes the frame if and only if the socket is OPEN, and when it is not it says
    // so to the console and nowhere else. So the socket is asked FIRST — read here rather than
    // after, where a 3 s reconnect would make a dropped frame look like a delivered one — and a
    // send that cannot land is refused instead of made, which is what keeps an optimistic user row
    // and a spinner that will never end off the screen.
    if (ws?.readyState !== WebSocket.OPEN) {
      moveTo(IDLE);
      pushToast({
        tone: 'warn',
        title: 'Could not resume',
        message: 'The connection dropped, so nothing was sent. The conversation is still here.',
      });
      return undefined;
    }

    submit(RESUME_PROMPT);
    moveTo({ phase: 'resuming', sessionId: intent.sessionId, staleVersion: intent.staleVersion, since: Date.now() });
    return undefined;
  }, [completeTick, intent, moveTo, pushToast, sessionId, submit, ws]);

  // ---------------------------------------------------------------- resuming → resumed, or not
  useEffect(() => {
    if (intent.phase !== 'resuming') return undefined;

    if (pendingSessionIsLive) {
      const restarted = intent.sessionId;
      const settledAt = Date.now();
      moveTo({ phase: 'resumed', sessionId: restarted, staleVersion: intent.staleVersion, since: settledAt });
      pushToast({
        tone: 'positive',
        title: `Resumed on Claude CLI ${installed ?? '—'}`,
        message: 'The conversation was stopped and resumed — every message is still here.',
      });
      // Hold the banner down only until a reading taken AFTER this send ARRIVES — then obey it,
      // whatever it says. Released on the clock, or on a request that merely settled, the hold
      // would end on the picture from before the abort: the banner would come back describing the
      // run this restart replaced, and its button would stop the healthy turn it just started. A
      // read that failed releases nothing; the backstop above is what ends that hold.
      //
      // `since` identifies the intent, not just the conversation: a second restart of the SAME
      // conversation can reach `resumed` inside one round trip, and the first read must not
      // release the second's hold.
      void refresh().then((wasRead) => {
        const settled = intentRef.current;
        if (!wasRead || settled.phase !== 'resumed') return;
        if (settled.sessionId === restarted && settled.since === settledAt) moveTo(IDLE);
      });
      return undefined;
    }

    // The socket was open, so the frame would have left had `handleSubmit` reached its send. It
    // has silent early returns that do not; the composer marks the conversation live one statement
    // before the frame is written, so that mark is what separates the two.
    const timer = window.setTimeout(() => {
      moveTo(IDLE);
      pushToast({ tone: 'warn', title: 'Could not resume', message: 'The conversation is still here.' });
    }, remainingOf(intent.since, RESUME_TIMEOUT_MS));
    return () => window.clearTimeout(timer);
  }, [installed, intent, moveTo, pendingSessionIsLive, pushToast, refresh]);

  // ---------------------------------------------------------------- resumed → idle
  useEffect(() => {
    if (intent.phase !== 'resumed') return undefined;

    // Hold the banner down until the report stops saying what it said at the press — or until the
    // deadline, whichever comes first. A report that keeps repeating itself is the one case where
    // the restart did NOT take, and it is the last case the app should fall silent in.
    if (staleVersionOf(intent.sessionId) !== intent.staleVersion) {
      moveTo(IDLE);
      return undefined;
    }
    const timer = window.setTimeout(() => moveTo(IDLE), remainingOf(intent.since, RESUMED_HOLD_MS));
    return () => window.clearTimeout(timer);
  }, [intent, moveTo, staleVersionOf]);

  const restartInFlight = intent.phase === 'stopping' || intent.phase === 'resuming';

  return {
    handleRestartOnInstalledCli,
    // Every conversation's button, not just this one's: while a restart is in flight, one elsewhere
    // would be refused, and a button that is enabled while the press would be refused is a button
    // that lies. It ends WITH the restart, not with the banner's hold — sixteen seconds of "another
    // conversation is being restarted" after that conversation has resumed is a sentence that is
    // simply untrue.
    restartPending: restartInFlight,
    restartingSessionId: restartInFlight ? intent.sessionId : null,
    // The conversation whose banner is held down: from the send until the report catches up.
    restartedSessionId: intent.phase === 'idle' || intent.phase === 'stopping' ? null : intent.sessionId,
  };
}
