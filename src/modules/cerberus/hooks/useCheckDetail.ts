import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { CerberusCheckDetail } from '@/shared/cerberus-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/** How often an open check is read again with no frame: the "Checked 17:52:10" and the cells age by themselves. */
const CLOCK_READ_MS = 30_000;

/**
 * Why a read of a check did not answer. `gone` is a 404 — the check is not an active one any more
 * (retired while its sheet was open) and no re-read will bring it back; `unreachable` is everything
 * else — this app's own network, a 5xx, a body that is not a check — and the next read may succeed.
 */
type CheckDetailFailure = 'gone' | 'unreachable';

/** True when a body is the check-detail shape: the three fields the sheet dereferences are there. */
function isCheckDetail(body: unknown): body is CerberusCheckDetail {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as { check?: unknown; cells?: unknown; lookup?: unknown };
  return candidate.check !== null && typeof candidate.check === 'object'
    && Array.isArray(candidate.cells) && candidate.lookup !== null && typeof candidate.lookup === 'object';
}

/**
 * True when a `cerberus_changed` frame names `checkPath` (`<node>/<service>/<id>`) among its checks.
 * Each entry of `checks` is `<node>/<key>` and a key itself holds a `/`, so the whole path is
 * compared as one string and never split.
 */
function frameNamesCheck(event: { kind?: string; checks?: unknown }, checkPath: string): boolean {
  return event.kind === 'cerberus_changed'
    && Array.isArray(event.checks)
    && event.checks.includes(checkPath);
}

/**
 * ONE CHECK'S SHEET READ: the check, its siblings, 60 one-minute cells, the recorded results and the
 * lookup at one moment — `GET /api/cerberus/checks/:node/:service/:id`.
 *
 * `lookupAt` is the instant the sentence is about and `end` is where the cells and recorded results
 * stand; both are epoch milliseconds and both default to now, which is the live sheet. A change to
 * either, or to the check, is a new read — and the previous answer stays on screen until the new one
 * lands, so typing a time never blanks the sheet.
 *
 * Re-read on a `cerberus_changed` frame that names THIS check (a mute, a label or a stored result
 * moved it), on a reconnect, and every 30 s while mounted — the cells slide and "Checked …" ages
 * with no event at all. Subscribed BEFORE the first read, as the providers are, so a frame landing
 * between the two starts its own read.
 *
 * `detail` is `null` until a read for THIS check has answered: an answer for another check is never
 * shown, so switching rows in the sheet never flashes the old row's cells. `loading` is that same
 * wait. `error` is set when the latest read failed, and `detail` keeps the last good answer for the
 * same check beside it, so a blip leaves the sheet readable. Reads overlap, so each takes a ticket
 * and only the newest one's answer is published.
 *
 * A caller holds `lookupAt` and `end` in state: a `Date.now()` passed from render is a new read on
 * every render.
 */
export function useCheckDetail({ node, service, id, lookupAt, end }: {
  node: string;
  service: string;
  id: string;
  lookupAt?: number;
  end?: number;
}): {
  detail: CerberusCheckDetail | null;
  loading: boolean;
  error: CheckDetailFailure | null;
  refresh: () => Promise<void>;
} {
  const { subscribe } = useWebSocket();
  const checkPath = `${node}/${service}/${id}`;

  // The newest answer a read applied, whatever check it was for. Essential: it is the only copy of
  // the sheet's data between reads. It is judged against the asked check below, never shown blind.
  const [answer, setAnswer] = useState<CerberusCheckDetail | null>(null);

  // The latest failed read and the check it was for. Essential: it is what the sheet draws its "gone"
  // or "can't be reached" from, and it carries its check so a failure of the row just left is never
  // shown over the row just opened.
  const [failure, setFailure] = useState<{ kind: CheckDetailFailure; checkPath: string } | null>(null);

  // Mount flag: an answer that lands after the sheet closed must not set state.
  const mountedRef = useRef(true);

  // Which read this is. Only the newest ticket's answer is published: an answer for a time the
  // person has already typed past must not land over the one for the time now on screen.
  const newestReadRef = useRef(0);

  /**
   * One read's outcome, published — or dropped. Only the newest read of a sheet that is still open
   * speaks; a read overtaken by a newer one (a time typed past, a row switched) says nothing.
   */
  const publish = useCallback((ticket: number, detail: CerberusCheckDetail | null, kind: CheckDetailFailure) => {
    if (!mountedRef.current || ticket !== newestReadRef.current) return;
    if (detail === null) {
      setFailure({ kind, checkPath });
      return;
    }
    setAnswer(detail);
    setFailure(null);
  }, [checkPath]);

  const refresh = useCallback(async () => {
    const ticket = ++newestReadRef.current;
    let detail: CerberusCheckDetail | null = null;
    let kind: CheckDetailFailure = 'unreachable';
    try {
      const response = await api.cerberus.check(node, service, id, { lookup: lookupAt, end });
      if (response.ok) {
        const body: unknown = await response.json();
        if (isCheckDetail(body)) detail = body;
      } else if (response.status === 404) {
        kind = 'gone';
      }
    } catch {
      // A throw here is this app's own network, or a body that is not JSON — "unreachable", as a
      // refusal that is not a 404 is.
    }
    publish(ticket, detail, kind);
  }, [node, service, id, lookupAt, end, publish]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribe((event) => {
      if (frameNamesCheck(event, checkPath) || event.kind === 'websocket_reconnected') void refresh();
    });
    void refresh();
    const clock = window.setInterval(() => void refresh(), CLOCK_READ_MS);
    return () => {
      mountedRef.current = false;
      unsubscribe();
      window.clearInterval(clock);
    };
  }, [refresh, subscribe, checkPath]);

  // An answer is for the check whose node and key it carries; any other is the row just left.
  const detail = answer !== null && answer.check.node === node && answer.check.key === `${service}/${id}` ? answer : null;
  const error = failure !== null && failure.checkPath === checkPath ? failure.kind : null;

  return { detail, loading: detail === null && error === null, error, refresh };
}
