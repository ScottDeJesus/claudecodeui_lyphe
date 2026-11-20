import { useCallback, useEffect, useRef, useState } from 'react';

import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import { api } from '@/shared/api';
import type { BugProposal, ProposalsReading, ProposalsView } from '@/shared/types';

/** What the kanban panel is handed: the reading the Proposed features face draws, and the one act it can ask of the read. */
type Proposals = {
  reading: ProposalsReading;
  /** Ask again: the press of the face that says the proposals could not be read. */
  retry: () => void;
};

/**
 * THE PROPOSALS' ONE READ: `GET /api/kanban-dispatch/proposals?board=<scope>&state=<state>`. `scope` is a board's id,
 * `all` for every board, or `null` while no board is open (nothing is asked, and the reading stays `loading`).
 *
 * ONE READER, CALLED ONCE BY `KanbanPanel`: the tab's count and the face's rows are the same answer, so the strip
 * can never say four while the face draws three.
 *
 * THREE READINGS, AND THE FACE DRAWS EACH: `loading` before the first answer; `unreachable` when the route did not
 * answer; else the proposals in the server's order, with `stale` raised while a newer answer is fetched over them.
 * A newer answer replaces the drawn one whole: the face never blanks to a spinner between two answers.
 *
 * IT IS TOLD, IT NEVER ASKS ON A CLOCK. It reads on mount, on a change of scope or state, and again when a
 * dispatcher frame arrives on the live bus, coalesced as `useBugDashboard` coalesces. No timer.
 */
export function useProposals(scope: string | null, state: ProposalsView['state']): Proposals {
  const [reading, setReading] = useState<ProposalsReading>({ status: 'loading' });
  const asked = useRef({ scope, state }); // the question the panel asks now
  const inFlight = useRef(false);
  const owed = useRef(false); // a frame or a new question arrived while a read was out
  const mounted = useRef(true);

  // COALESCING: a burst of frames during one read is ONE more read, not many. An answer to a question no longer asked
  // is never drawn (the scope or state moved while it was out); the owed read asks the current one. A newer answer
  // replaces the drawn one whole, never a spinner between.
  const read = useCallback(async () => {
    // No board is open, so there is no question to ask: the reading stays as it is until one opens.
    if (asked.current.scope === null) return;
    if (inFlight.current) {
      owed.current = true;
      return;
    }
    inFlight.current = true;
    setReading((held) => (held.status === 'ready' ? { ...held, stale: true } : held));
    do {
      owed.current = false;
      const question = asked.current;
      // The board closed while a read was out: the owed read has no scope to ask for.
      if (question.scope === null) break;
      const proposals = await fetchProposals(question.scope, question.state);
      if (!mounted.current) {
        inFlight.current = false;
        return;
      }
      if (question === asked.current) {
        setReading(proposals === null ? { status: 'unreachable' } : { status: 'ready', proposals, stale: owed.current });
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

  // The mount read, and the read on a change of scope or state.
  useEffect(() => {
    asked.current = { scope, state };
    void read();
  }, [scope, state, read]);

  // Proposals are the dispatcher's rows, so only its frame is news: a board's write is not.
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

/** The face draws these fields directly, so a row that lacks one is no proposal. */
function isProposal(value: unknown): value is BugProposal {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.title === 'string' &&
    typeof value.state === 'string' &&
    typeof value.priority === 'string' &&
    Array.isArray(value.findings) &&
    Array.isArray(value.stopgaps)
  );
}

/**
 * The face draws these fields directly, so a body that lacks one (an envelope like `{success:false,error}` parses as
 * JSON too) is no answer.
 */
function isProposalsBody(body: unknown): body is { proposals: BugProposal[] } {
  return isRecord(body) && Array.isArray(body.proposals) && body.proposals.every(isProposal);
}

/** One read of the route: the proposals when it is the route's shape, else null. */
async function fetchProposals(scope: string, state: ProposalsView['state']): Promise<BugProposal[] | null> {
  try {
    const response = await api.kanban.proposals(scope, state);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isProposalsBody(body) ? body.proposals : null;
  } catch (error) {
    console.error('Error reading the proposed features:', error);
    return null;
  }
}
