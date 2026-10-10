import { createContext, useContext } from 'react';

/**
 * One reading of the Dactyls for the main session row: the shape `useMainSessionDactylsSwitch` hands it once
 * phase `row-fill` lands (design I9). `enabled` is the flag file's position, `null` until a read answers;
 * `unreadable` is set once a read has failed. The other five are `dactyl --session-status`'s details, and each
 * is `null` when that call failed. That means could not ask. It never means off, and never not ready.
 *
 * `hand` is the status's `place.hand_fold(7)`: the dactyls launched by hand (under no plan's launch) over the
 * last `days` days, `reads` and `edits` of them, and `spend` the verb's own token rendering
 * (`212.4k in · 9.8k out`), "" when no token was counted. Never dollars.
 */
type MainSessionDactylsFakeState = {
  enabled: boolean | null;
  unreadable: boolean;
  model: string | null;
  effort: string | null;
  ready: boolean | null;
  why: string | null;
  hand: { days: number; count: number; reads: number; edits: number; spend: string } | null;
};

/** The launch table's `[dactyl]` words today (`launch-table resolve`, 2026-10-10). */
const MODEL = 'claude-haiku-5-5';
const EFFORT = 'xhigh';

/** The readiness sentence the plan quotes: what the status prints for a CLI that does not know the dactyl's model. */
const WHY = 'the installed Claude Code 2.1.296 does not know claude-haiku-5-5';

/** A week with no hand dactyl: the fold of an empty ledger. It draws no spend line. */
const QUIET_WEEK = { days: 7, count: 0, reads: 0, edits: 0, spend: '' };

/** No reading yet, or the status call failed: every detail is "could not ask". */
const NO_DETAILS = { model: null, effort: null, ready: null, why: null, hand: null };

/**
 * The states the row draws, one per entry, named for the fixture that photographs each. The plan's eight come
 * first. A position whose status call failed is drawn ON: the switch is armed, and whether a dactyl can serve it
 * is unknown. The ninth draws the spend line's other branch, a week of hand dactyls with no token counted, so the
 * line ends at the edits. It is drawn OFF because the line is said in either position: a hand dactyl needs no
 * switch.
 */
export const MAIN_SESSION_DACTYLS_FAKE_STATES = {
  asking: { enabled: null, unreadable: false, ...NO_DETAILS },
  unreadable: { enabled: null, unreadable: true, ...NO_DETAILS },
  offReady: { enabled: false, unreadable: false, model: MODEL, effort: EFFORT, ready: true, why: '', hand: QUIET_WEEK },
  onReady: { enabled: true, unreadable: false, model: MODEL, effort: EFFORT, ready: true, why: '', hand: QUIET_WEEK },
  offWaiting: { enabled: false, unreadable: false, model: MODEL, effort: EFFORT, ready: false, why: WHY, hand: QUIET_WEEK },
  onWaiting: { enabled: true, unreadable: false, model: MODEL, effort: EFFORT, ready: false, why: WHY, hand: QUIET_WEEK },
  statusUnread: { enabled: true, unreadable: false, ...NO_DETAILS },
  onReadySpend: {
    enabled: true, unreadable: false, model: MODEL, effort: EFFORT, ready: true, why: '',
    hand: { days: 7, count: 14, reads: 9, edits: 5, spend: '212.4k in · 9.8k out' },
  },
  offReadyNoTokens: {
    enabled: false, unreadable: false, model: MODEL, effort: EFFORT, ready: true, why: '',
    hand: { days: 7, count: 3, reads: 1, edits: 2, spend: '' },
  },
} satisfies Record<string, MainSessionDactylsFakeState>;

/**
 * Which state a mounted row draws: the scaffold's fixture wraps each row it mounts in a provider. With none, the
 * row draws what a row holding no reading draws, no position and still asking.
 */
export const MainSessionDactylsFakeContext = createContext<MainSessionDactylsFakeState>(MAIN_SESSION_DACTYLS_FAKE_STATES.asking);

/**
 * THE SCAFFOLD'S STAND-IN FOR `useMainSessionDactylsSwitch`, read on `RunnerMainSessionDactylsRow`'s state wire
 * and by nothing else. Phase `row-fill` swaps that line for the real hook and deletes this file.
 */
export function useMainSessionDactylsFake(): MainSessionDactylsFakeState {
  return useContext(MainSessionDactylsFakeContext);
}
