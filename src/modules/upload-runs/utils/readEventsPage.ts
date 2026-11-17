import { api } from '@/shared/api';
import type { AffectedAreasTrouble } from '@/shared/types';
import type { UploadRunEventsPage } from '@/shared/upload-runs-types';
import { troubleOfFailure, troubleOfResponse } from '@/shared/utils';

/** A read of a run's events that did not answer, carrying the lane's own reading of why (`useLaneRead` reads a failure the same way). */
export class EventsReadFault extends Error {
  trouble: AffectedAreasTrouble;
  /** The error that was thrown under it (a refused connection, a body that would not parse), where there was one. */
  underlying: unknown;

  constructor(trouble: AffectedAreasTrouble, message: string, underlying?: unknown) {
    super(message);
    this.trouble = trouble;
    this.underlying = underlying;
  }
}

/**
 * One page of a run's events, or an `EventsReadFault` naming what went wrong: the lane's refusal, no answer, or an answer
 * that is not a page. `after` is the last `seq` held (0 for the first page) and the page holds at most `limit` events with a
 * `seq` above it, oldest first; `next` is where the page after it starts, or null on the last.
 *
 * Used by this module's `useRunEvents`.
 */
export async function readEventsPage(sid: string, after: number, limit: number): Promise<UploadRunEventsPage> {
  const context = `events of run ${sid} after ${after}`;
  let body: unknown;
  try {
    const response = await api.uploadRuns.events(sid, { after, limit });
    if (!response.ok) throw new EventsReadFault(await troubleOfResponse(response), `the lane answered ${response.status} for the ${context}`);
    body = await response.json();
  } catch (failure) {
    if (failure instanceof EventsReadFault) throw failure;
    throw new EventsReadFault(troubleOfFailure(failure), `the ${context} could not be read`, failure);
  }
  if (typeof body !== 'object' || body === null || !('events' in body) || !Array.isArray(body.events) || !('next' in body)) {
    throw new EventsReadFault('unreadable', `the ${context} did not come back as a page`);
  }
  return { events: body.events, next: typeof body.next === 'number' ? body.next : null };
}
