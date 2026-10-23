/**
 * THE CAP'S READ, FAKED — one `{usd, unreadable, saving}` per state, so `RunnerGeminiBudgetRow` can be drawn
 * and photographed before `useGeminiPlanCap` exists. This file is the scaffold's stand-in and is deleted by
 * cap-fill, when the row's read becomes the hook's.
 *
 * The fixtures pick a state with `showGeminiPlanCapFake` before mounting the row; the row's read returns the
 * chosen state unchanged. Nothing here reaches the live app: no module but the scaffold's row imports this
 * file, and `RunnerModelContent` draws no row until cap-fill.
 */

/** What the row reads: the hook's three facts, without its two acts (`save`, `refresh`). */
type GeminiPlanCapState = {
  /** The cap in dollars as the server last read it off disk, or `null` while no read has succeeded. */
  usd: number | null;
  /** True once a read has failed: the amount is unknown, which is not the $5.00 default. */
  unreadable: boolean;
  /** True while a write is in flight. */
  saving: boolean;
};

/** The six states the row draws, in the order a reader meets them. */
const GEMINI_PLAN_CAP_FAKE_STATES = {
  /** The first read is still on the wire. */
  asking: { usd: null, unreadable: false, saving: false },
  /** The read failed: no amount at all, and never the default in its place. */
  unreadable: { usd: null, unreadable: true, saving: false },
  /** No cap file on the host, which the server reads as the shipped $5.00. */
  shipped: { usd: 5, unreadable: false, saving: false },
  /** The operator moved it; a half-dollar amount is drawn 12.50. */
  moved: { usd: 12.5, unreadable: false, saving: false },
  /** Zero, the cap every call has already met: it refuses every plan's Gemini calls. */
  zero: { usd: 0, unreadable: false, saving: false },
  /** A write in flight over the shipped amount. */
  saving: { usd: 5, unreadable: false, saving: true },
} satisfies Record<string, GeminiPlanCapState>;

/** The name of one fake state. */
type GeminiPlanCapFakeState = keyof typeof GEMINI_PLAN_CAP_FAKE_STATES;

/** The state every mount draws until a fixture chooses another. */
let current: GeminiPlanCapFakeState = 'shipped';

/** Choose the state the next mount of the row draws. Called by the scaffold's fixture before it mounts. */
export function showGeminiPlanCapFake(state: GeminiPlanCapFakeState): void {
  current = state;
}

/** The chosen state, as `RunnerGeminiBudgetRow`'s fake read returns it. */
export function geminiPlanCapFake(): GeminiPlanCapState {
  return GEMINI_PLAN_CAP_FAKE_STATES[current];
}
