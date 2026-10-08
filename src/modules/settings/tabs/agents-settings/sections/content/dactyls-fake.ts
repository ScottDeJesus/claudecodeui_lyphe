import { createContext, useContext } from 'react';

/**
 * One position of the Dactyls row: the shape `useDactylsSwitch` hands it once phase `row-fill` lands
 * (design I11). `enabled` is the flag file's position, `null` until a read answers; `unreadable` is set
 * once a read has failed. The other four are `dactyl --status`'s details, and each is `null` when that
 * call failed. That means could not ask. It never means off, and never not ready.
 */
type DactylsFakeState = {
  enabled: boolean | null;
  unreadable: boolean;
  model: string | null;
  effort: string | null;
  ready: boolean | null;
  why: string | null;
};

/** The readiness sentence the plan quotes: what `dactyl --status` printed on Claude Code 2.1.292, before 2.1.293 knew the id. */
const WHY = 'the installed Claude Code 2.1.292 does not know claude-haiku-5-5';

/** The table's `[dactyl]` words as shipped. */
const MODEL = 'claude-haiku-5-5';
const EFFORT = 'medium';

/**
 * The seven states the row draws, one per entry, named for the fixture that photographs each. A
 * position whose status call failed is drawn ON: the switch is armed, and whether it can be served
 * is unknown.
 */
export const DACTYLS_FAKE_STATES: Record<string, DactylsFakeState> = {
  asking: { enabled: null, unreadable: false, model: null, effort: null, ready: null, why: null },
  unreadable: { enabled: null, unreadable: true, model: null, effort: null, ready: null, why: null },
  offReady: { enabled: false, unreadable: false, model: MODEL, effort: EFFORT, ready: true, why: null },
  onReady: { enabled: true, unreadable: false, model: MODEL, effort: EFFORT, ready: true, why: null },
  offWaiting: { enabled: false, unreadable: false, model: MODEL, effort: EFFORT, ready: false, why: WHY },
  onWaiting: { enabled: true, unreadable: false, model: MODEL, effort: EFFORT, ready: false, why: WHY },
  statusUnread: { enabled: true, unreadable: false, model: null, effort: null, ready: null, why: null },
};

/**
 * Which state a mounted row draws. A fixture wraps each row it mounts in a provider. With no provider,
 * the row draws off and waiting, the state that draws the most of it.
 */
export const DactylsFakeContext = createContext<DactylsFakeState>(DACTYLS_FAKE_STATES.offWaiting);

/**
 * THE SCAFFOLD'S STAND-IN FOR `useDactylsSwitch`, read on `RunnerDactylsRow`'s state wire and by
 * nothing else. Phase `row-fill` swaps that line for the real hook and deletes this file.
 */
export function useDactylsFake(): DactylsFakeState {
  return useContext(DactylsFakeContext);
}
