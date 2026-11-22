import { useCallback, useEffect, useRef, useState } from 'react';

import type { AnalyticsReading } from '@/modules/analytics/types';
import type { AnalyticsAnswer } from '@/shared/analytics-types';
import { api } from '@/shared/api';

/** What a section is handed: the reading to draw, and the one act it can ask of the read. */
type AnalyticsSectionRead<T> = {
  reading: AnalyticsReading<T>;
  /** Ask again: Try again's press when the route did not answer, Refresh's when it did. */
  refresh: () => void;
};

/** The question one read answers: which section, and how many days back. */
type Question = { id: string; days: number };

/**
 * ONE SECTION'S ONE READ: `GET /api/analytics/<id>?days=<days>` (`api.analytics.section`). The envelope is checked here; its
 * `data` goes through the caller's `narrow`, and data `narrow` refuses (null) is no answer, as a route that did not answer is.
 *
 * THREE READINGS (`AnalyticsReading`), drawn by `AnalyticsSectionFrame`: `loading` before the first answer; `unreachable` when
 * there is no answer; else the answer, with `stale` raised while a newer one is out. A newer answer replaces the drawn one whole,
 * never a spinner between; an answer to a question no longer asked (the id or the window moved while it was out) is never drawn,
 * and the owed read asks the current one. A burst of asks during one read is ONE more read.
 *
 * IT IS TOLD, IT NEVER ASKS ON A CLOCK. It reads on mount, on a change of id or days, on `refresh`, and when the page becomes
 * visible again (the house kept working while it was hidden). No timer.
 *
 * `narrow` is the one read when an answer lands, so an inline function is safe; a module-level one is the habit. The pattern is
 * `useBugDashboard`'s (kanban/dashboard).
 */
export function useAnalyticsSection<T>(id: string, days: number, narrow: (data: unknown) => T | null): AnalyticsSectionRead<T> {
  const [reading, setReading] = useState<AnalyticsReading<T>>({ status: 'loading' });
  const asked = useRef<Question>({ id, days }); // the question the section asks now
  const narrowing = useRef(narrow);
  const inFlight = useRef(false);
  const owed = useRef(false); // an ask arrived while a read was out
  const mounted = useRef(true);

  useEffect(() => {
    narrowing.current = narrow;
  }, [narrow]);

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
      const answer = await fetchSectionData(question);
      if (!mounted.current) {
        inFlight.current = false;
        return;
      }
      if (question === asked.current) {
        const data = answer === null ? null : narrowing.current(answer.data);
        setReading(data === null ? { status: 'unreachable' } : { status: 'ready', data, stale: owed.current });
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

  // The mount read, and the read on a change of section or window.
  useEffect(() => {
    asked.current = { id, days };
    void read();
  }, [id, days, read]);

  // Back from another tab or a locked phone: the numbers may have moved meanwhile.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void read();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [read]);

  const refresh = useCallback(() => void read(), [read]);

  return { reading, refresh };
}

/** A JSON object: not null, not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The area's envelope, answering the section asked: an envelope for another section is no answer. */
function isAnswerTo(body: unknown, question: Question): body is AnalyticsAnswer<unknown> {
  return isRecord(body) && body.section === question.id && typeof body.days === 'number' && 'data' in body;
}

/** One read of the route: the envelope's data when the route answered its shape, else null. */
async function fetchSectionData(question: Question): Promise<{ data: unknown } | null> {
  try {
    const response = await api.analytics.section(question.id, question.days);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isAnswerTo(body, question) ? { data: body.data } : null;
  } catch (error) {
    console.error(`Error reading the analytics section ${question.id} over ${question.days} days:`, error);
    return null;
  }
}
