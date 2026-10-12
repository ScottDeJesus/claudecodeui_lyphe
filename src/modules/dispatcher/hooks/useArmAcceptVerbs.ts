import { useCallback } from 'react';

import { api } from '@/shared/api';
import type { DispatcherVerb } from '@/shared/types';

/** What a plan card presses for "Accept when cut": the design stamp it drew goes with the press. */
export type ArmAcceptPlanVerbs = {
  /** Accept the design the card read ahead of its cut — refused by the dispatcher when the design has since moved. */
  armAccept(design: string): Promise<void>;
  /** Take the press back. */
  disarmAccept(): Promise<void>;
};

/** What an arc deck presses: every designed member of the arc, each on its own current design — no stamp travels. */
export type ArmAcceptArcVerbs = {
  armAccept(): Promise<void>;
  disarmAccept(): Promise<void>;
};

/**
 * `dispatcher arm-accept`'s exit code for a plan already armed (`store_armed.ALREADY_ARMED_EXIT`), apart
 * from every other refusal's 2: a double press, or the phone beside the card. The dispatcher's own
 * constant is the source; change one, change both.
 */
const ALREADY_ARMED_EXIT = 3;

/**
 * Is this answer a press that reached a plan ALREADY armed? That is an answer arriving second — the
 * state the operator asked for — so `useDispatcherVerbs` shows the dispatcher's sentence calmly and
 * does not warn, the way the ask path reports `already-answered`.
 */
export function alreadyArmed(verb: string, body: { exit?: unknown } | null): boolean {
  return verb === 'arm-accept' && body?.exit === ALREADY_ARMED_EXIT;
}

type Send = (verb: DispatcherVerb, call: () => Promise<Response>) => Promise<boolean>;

/**
 * The two "Accept when cut" presses of one plan's card or one arc's deck, relayed through the caller's
 * `send` (`useDispatcherVerbs`), so the busy flag, the toast and the refusal wording are the hook's own.
 * `scope` decides the door, as it does for every other press: a plan's carries the design stamp the card
 * drew; an arc's carries none, because the dispatcher reads each member's current one.
 */
export function useArmAcceptVerbs(name: string, scope: 'plan' | 'arc', send: Send) {
  const armAccept = useCallback(
    async (design?: string) => {
      await send('arm-accept', () => (scope === 'arc'
        ? api.dispatcher.arcArmAccept(name)
        : api.dispatcher.armAccept(name, design ?? '')));
    },
    [name, scope, send],
  );
  const disarmAccept = useCallback(
    async () => {
      await send('disarm-accept', () => (scope === 'arc'
        ? api.dispatcher.arcDisarmAccept(name)
        : api.dispatcher.disarmAccept(name)));
    },
    [name, scope, send],
  );
  return { armAccept, disarmAccept };
}
