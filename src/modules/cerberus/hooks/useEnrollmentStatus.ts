import { useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { CerberusEnrollment, CerberusEnrollmentStatus } from '@/shared/cerberus-types';
import { useServerFrame } from '@/shared/hooks/useServerFrame';

/** The frame an enrollment's progress moves on: center hints it when a warden spends the token or says hello. */
const ENROLLMENT_FRAME_KINDS = ['cerberus_changed'] as const;

/**
 * How long past the token's `expiresAt` the read that shows it expired is asked: center judges expiry by its own
 * clock, and a browser a little ahead of it must not ask a moment early and hear "waiting" for the last time.
 */
const EXPIRY_READ_LAG_MS = 1_000;

/** The longest delay a browser timer holds; a later one would fire at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** True when a body is the status shape the install step reads: a token state, an install time and a node or none. */
function isEnrollmentStatus(body: unknown): body is CerberusEnrollmentStatus {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as { token?: unknown; installRanAt?: unknown; node?: unknown };
  return typeof candidate.token === 'string'
    && (candidate.installRanAt === null || typeof candidate.installRanAt === 'number')
    && (candidate.node === null || typeof candidate.node === 'object');
}

/**
 * How far enrolling the node has got, read from `GET /api/cerberus/enrollments/:name` on mount, on every
 * `cerberus_changed` frame and on a reconnect, for as long as there is something left to learn. The token's
 * expiry writes nothing, so its one deadline (`expiresAt`) reads once more to show it expired. The reads stop at
 * the first of three things — the token expired, the warden said hello, or the dialog closed (the effect's
 * cleanup) — and a read that fails keeps the last answer until the next frame or reconnect reads again.
 *
 * `null` until the first answer lands, and again for a new command: an answer is held with the token it
 * was read for, so a command issued in place of an expired one starts from no answer with nothing to
 * reset. `null` also while no command is out (`issued` is null).
 *
 * Used by the cerberus module's `EnrollDialog` for its install step's three ticking lines.
 */
export function useEnrollmentStatus(issued: CerberusEnrollment | null): CerberusEnrollmentStatus | null {
  // The newest answer and the token it was read for. Essential: a read is the only way to learn how far the
  // machine has got, and the token is what tells an answer about this command from one about an older one.
  const [answer, setAnswer] = useState<{ token: string; status: CerberusEnrollmentStatus } | null>(null);
  const status = answer !== null && answer.token === issued?.token ? answer.status : null;

  // Past these two nothing can change, and a read would only repeat what is on screen.
  const settled = status?.token === 'expired' || (status?.node?.firstHeartbeatAt ?? null) !== null;

  // The read of the command out now, or nothing while none is (or nothing is left to learn). A ref, so the frame
  // subscription is made once for the hook's life and always asks about the current command.
  const readRef = useRef<() => void>(() => undefined);
  useServerFrame(ENROLLMENT_FRAME_KINDS, () => readRef.current());

  useEffect(() => {
    if (issued === null || settled) return undefined;
    const { name, token, expiresAt } = issued;
    let stopped = false;
    let reading = false;
    let readAgain = false;

    // One read at a time: a frame that lands while one is out asks for exactly one more when it answers.
    const read = async () => {
      if (reading) {
        readAgain = true;
        return;
      }
      reading = true;
      try {
        const response = await api.cerberus.enrollment(name);
        const body: unknown = response.ok ? await response.json() : null;
        if (!stopped && isEnrollmentStatus(body)) setAnswer({ token, status: body });
      } catch {
        // No answer, or a body that is not JSON: the last answer stands until the next frame or reconnect.
      }
      reading = false;
      if (!stopped && readAgain) {
        readAgain = false;
        void read();
      }
    };
    readRef.current = () => void read();
    void read();

    const expiry = window.setTimeout(
      () => void read(),
      Math.min(MAX_TIMER_MS, Math.max(0, expiresAt - Date.now()) + EXPIRY_READ_LAG_MS)
    );

    return () => {
      stopped = true;
      readRef.current = () => undefined;
      window.clearTimeout(expiry);
    };
  }, [issued, settled]);

  return status;
}
