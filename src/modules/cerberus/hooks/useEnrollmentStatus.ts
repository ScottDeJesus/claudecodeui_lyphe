import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { CerberusEnrollment, CerberusEnrollmentStatus } from '@/shared/cerberus-types';

/** How long after one read of an enrollment's progress the next is asked for. */
const POLL_MS = 2_000;

/** True when a body is the status shape the install step reads: a token state, an install time and a node or none. */
function isEnrollmentStatus(body: unknown): body is CerberusEnrollmentStatus {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as { token?: unknown; installRanAt?: unknown; node?: unknown };
  return typeof candidate.token === 'string'
    && (candidate.installRanAt === null || typeof candidate.installRanAt === 'number')
    && (candidate.node === null || typeof candidate.node === 'object');
}

/**
 * How far enrolling the node has got, read from `GET /api/cerberus/enrollments/:name` at once and then
 * every 2 s for as long as there is something left to learn. Nothing announces an install on the machine,
 * so the dialog asks; the reads stop at the first of three things — the token expired, the warden said
 * hello, or the dialog closed (the effect's cleanup) — and a read that fails keeps the last answer.
 *
 * `null` until the first answer lands, and again for a new command: an answer is held with the token it
 * was read for, so a command issued in place of an expired one starts from no answer with nothing to
 * reset. `null` also while no command is out (`issued` is null).
 *
 * Used by the cerberus module's `EnrollDialog` for its install step's three ticking lines.
 */
export function useEnrollmentStatus(issued: CerberusEnrollment | null): CerberusEnrollmentStatus | null {
  // The newest answer and the token it was read for. Essential: the poll is the only way to learn how far the
  // machine has got, and the token is what tells an answer about this command from one about an older one.
  const [answer, setAnswer] = useState<{ token: string; status: CerberusEnrollmentStatus } | null>(null);
  const status = answer !== null && answer.token === issued?.token ? answer.status : null;

  // Past these two nothing can change, and a read would only repeat what is on screen.
  const settled = status?.token === 'expired' || (status?.node?.firstHeartbeatAt ?? null) !== null;

  useEffect(() => {
    if (issued === null || settled) return undefined;
    const { name, token } = issued;
    let stopped = false;
    let timer: number | undefined;

    // The next read is asked for when this one has ended, so a slow answer never has another beside it.
    const read = async () => {
      try {
        const response = await api.cerberus.enrollment(name);
        const body: unknown = response.ok ? await response.json() : null;
        if (!stopped && isEnrollmentStatus(body)) setAnswer({ token, status: body });
      } catch {
        // No answer, or a body that is not JSON: the last answer stands and the next read is already due.
      }
      if (!stopped) timer = window.setTimeout(() => void read(), POLL_MS);
    };
    void read();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [issued, settled]);

  return status;
}
