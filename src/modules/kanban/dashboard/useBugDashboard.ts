import { useCallback, useEffect, useRef, useState } from 'react';

import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { BugDashboardAnswer, BugDashboardReading } from '@/shared/types';

/** What the Dashboard face is handed: the reading to draw, and the one act it can ask of the read. */
type BugDashboard = {
  reading: BugDashboardReading;
  /** Ask again: the press of the face that says the dashboard could not be read. */
  retry: () => void;
};

/**
 * THE DASHBOARD'S ONE READ: `GET /api/kanban-dispatch/dashboard?board=<scope>&days=<days>`, whose answer is the whole
 * face (`BugDashboardAnswer`). `scope` is a board's id, or `all` for every board not archived.
 *
 * ONE READER, CALLED ONCE BY `BugDashboard`. The sections below it are handed parts of one answer, so two of them can
 * never disagree about how many cards are open.
 *
 * THREE READINGS, AND THE FACE DRAWS EACH: `loading` before the first answer; `unreachable` when the route itself did
 * not answer; else the answer, with `stale` raised while a newer one is being fetched over it. A newer answer replaces
 * the one drawn whole: the face never blanks to a spinner between two answers.
 *
 * IT IS TOLD, IT NEVER ASKS ON A CLOCK. It reads on mount and on a change of scope or window, and again when a board
 * frame or a dispatcher frame arrives on the live bus. No timer.
 */
export function useBugDashboard(scope: string, days: number): BugDashboard {
  const [reading, setReading] = useState<BugDashboardReading>({ status: 'loading' });
  const asked = useRef({ scope, days }); // the question the face asks now
  const inFlight = useRef(false);
  const owed = useRef(false); // a frame or a new question arrived while a read was out
  const mounted = useRef(true);

  // COALESCING: a burst of frames during one read is ONE more read, not many. An answer to a question no longer asked
  // is never drawn (the scope or window moved while it was out); the owed read asks the current one. A newer answer
  // replaces the drawn one whole, never a spinner between.
  const read = useCallback(async () => {
    if (inFlight.current) {
      owed.current = true;
      return;
    }
    inFlight.current = true;
    setReading((held) => (held.status === 'ready' ? { ...held, stale: true } : held));
    do {
      owed.current = false;
      const question = asked.current;
      const answer = await fetchAnswer(question.scope, question.days);
      if (!mounted.current) {
        inFlight.current = false;
        return;
      }
      if (question === asked.current) {
        setReading(answer === null ? { status: 'unreachable' } : { status: 'ready', answer, stale: owed.current });
      } else {
        owed.current = true;
      }
    } while (owed.current);
    inFlight.current = false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The mount read, and the read on a change of scope or window.
  useEffect(() => {
    asked.current = { scope, days };
    void read();
  }, [scope, days, read]);

  // Any board's write: "All boards" and the house parts are not one board's.
  const { subscribe } = useWebSocket();
  useEffect(() => subscribe((event) => { if (event.kind === 'kanban_event') void read(); }), [subscribe, read]);

  // The frame already on the bus at mount is not news: the mount read covers it.
  const dispatcherFrame = useLiveTopic(DISPATCHER_ALL_TOPIC);
  const seenFrame = useRef(dispatcherFrame);
  useEffect(() => {
    if (seenFrame.current === dispatcherFrame) return;
    seenFrame.current = dispatcherFrame;
    void read();
  }, [dispatcherFrame, read]);

  const retry = useCallback(() => void read(), [read]);

  return { reading, retry };
}

/** A JSON object: not null, not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One part of the answer: `{ ok: true, value: record }` or `{ ok: false, error: string }`. */
function isPart(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.ok === true) return isRecord(value.value);
  return value.ok === false && typeof value.error === 'string';
}

/**
 * The face draws these fields directly, so a body that lacks one (an envelope like `{success:false,error}` parses as
 * JSON too) is no answer.
 */
function isDashboardAnswer(body: unknown): body is BugDashboardAnswer {
  if (!isRecord(body)) return false;
  const stats = body.stats;
  return (
    isRecord(stats) &&
    isRecord(stats.open) &&
    isRecord(stats.timeToFix) &&
    isRecord(stats.scope) &&
    Array.isArray(stats.byDay) &&
    Array.isArray(stats.oldestOpen) &&
    Array.isArray(stats.waysIn) &&
    Array.isArray(body.changelog) &&
    isPart(body.cases) &&
    isPart(body.tickets)
  );
}

/** One read of the route: the answer when it is the route's shape, else null. */
async function fetchAnswer(scope: string, days: number): Promise<BugDashboardAnswer | null> {
  try {
    const response = await api.kanban.dashboard(scope, days);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isDashboardAnswer(body) ? body : null;
  } catch (error) {
    console.error('Error reading the bug dashboard:', error);
    return null;
  }
}
