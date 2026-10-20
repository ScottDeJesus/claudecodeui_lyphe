import type { ClaudeApiCardView, ClaudeApiKeyPicture, ClaudeApiPicture } from '@/shared/types';

/**
 * THE DOOR'S PICTURE, FAKED — one whole `ClaudeApiPicture` per state, so the card can be drawn and
 * photographed before `useClaudeApiKeys` exists. This file is the scaffold's stand-in and is deleted
 * by card-fill, when the card's own read becomes the hook's.
 *
 * Every sentence a state carries in `rides.why` is the door's kind of data, not the card's copy: the
 * card interpolates it. The window state's sentence is the one the architecture promises while a key
 * spends its credit down — that new work still waits for the subscription's room, because the gate
 * admits starts by that room alone until usage-limits--key-carry lands.
 *
 * The fixtures pick a state with `showClaudeApiFixture` before mounting the card; the card's read
 * returns the chosen view unchanged. Nothing here reaches the live app: no module outside the
 * scaffold's card imports this file.
 */

/** Noon UTC, 20 October 2026 — every state's `checked_at`, and the hour a rate wall lifts after. */
const CHECKED_AT = Date.UTC(2026, 9, 20, 12, 0) / 1000;
/** 15 November 2026 — both keys renew on the 15th, so their cycle ends the same day. */
const CYCLE_END = Date.UTC(2026, 10, 15) / 1000;
/** 3 November 2026 — the hour key 1's window opens at the house's pace. */
const WINDOW_OPENS = Date.UTC(2026, 10, 3, 6, 0) / 1000;
/** 12 October 2026 — the day both keys were entered. */
const SAVED_AT = '2026-10-12T09:00:00Z';

/** A slot holding nothing: no key, no settings, no window. */
function unset(slot: number): ClaudeApiKeyPicture {
  return {
    slot,
    set: false,
    label: '',
    credit_usd: null,
    renews_day: null,
    saved_at: null,
    cycle_ends_at: null,
    spent_usd: 0,
    left_usd: null,
    window: { open: false, opens_at: null },
    wall: null,
  };
}

/** A slot holding a key, with only what this state changes. */
function set(slot: number, overrides: Partial<ClaudeApiKeyPicture> = {}): ClaudeApiKeyPicture {
  return {
    slot,
    set: true,
    label: slot === 1 ? 'Personal' : 'Client work',
    credit_usd: 200,
    renews_day: 15,
    saved_at: SAVED_AT,
    cycle_ends_at: CYCLE_END,
    spent_usd: slot === 1 ? 31.8 : 84.55,
    left_usd: slot === 1 ? 168.2 : 115.45,
    window: { open: false, opens_at: WINDOW_OPENS },
    wall: null,
    ...overrides,
  };
}

/** A whole picture, from the parts this state changes. */
function picture(
  rides: ClaudeApiPicture['rides'],
  keys: ClaudeApiKeyPicture[],
  subscriptionWall: ClaudeApiPicture['subscription']['wall'] = null,
): ClaudeApiPicture {
  return {
    rides,
    subscription: { wall: subscriptionWall },
    keys,
    pace_usd_per_hour: 23.1,
    unpriced: [],
    checked_at: CHECKED_AT,
  };
}

/** The three acts the card's read carries and card-fill replaces: a fixture save never lands. */
const NO_ACTS = {
  save: async () => false,
  remove: async () => {},
  refresh: async () => {},
};

/** One fixture state: the picture, plus the two write states the read also carries. */
function view(
  state: ClaudeApiPicture | { unreadable: true } | null,
  write: Pick<ClaudeApiCardView, 'savingSlot' | 'refusal'> = { savingSlot: null, refusal: null },
): ClaudeApiCardView {
  return { picture: state, ...write, ...NO_ACTS };
}

/** Every state the card must draw, each a whole picture. Key order is the plan's own list. */
export const CLAUDE_API_FIXTURE_STATES = {
  asking: view(null),
  unreadable: view({ unreadable: true }),
  noKey: view(picture(
    { slot: 0, why: 'Your subscription has room, so every launch rides it.' },
    [unset(1), unset(2)],
  )),
  key1Set: view(picture(
    { slot: 0, why: 'Key 1 has credit left, but its window is not open yet, so plan runs ride your subscription.' },
    [set(1), unset(2)],
  )),
  bothSet: view(picture(
    { slot: 0, why: 'Both keys have credit left, but neither is in its spend-down window yet, so plan runs ride your subscription.' },
    [set(1), set(2)],
  )),
  window: view(picture(
    {
      slot: 1,
      why: 'Key 1 is spending down the $168.20 left before it renews on 15 Nov. New work still waits for your subscription’s room: the gate admits starts by that room alone until key-carry lands.',
    },
    [set(1, { window: { open: true, opens_at: WINDOW_OPENS } }), set(2)],
  )),
  subscriptionWalled: view(picture(
    {
      slot: 1,
      why: 'Your subscription stands on its usage limit until 17:00, so key 1 carries plan runs. New starts still wait for your subscription’s room.',
    },
    [set(1), set(2)],
    { kind: 'usage', until: Date.UTC(2026, 9, 20, 17, 0) / 1000, detail: 'Claude usage limit until 17:00' },
  )),
  key1OutOfCredit: view(picture(
    { slot: 2, why: 'Key 1 is out of credit until 15 Nov, so key 2 carries plan runs.' },
    [set(1, { left_usd: 0, spent_usd: 200, wall: { kind: 'credit', until: CYCLE_END, detail: 'Credit balance is too low' } }), set(2)],
  )),
  spendLimit: view(picture(
    { slot: 2, why: 'Key 1 is at its spend limit until 15 Nov, so key 2 carries plan runs.' },
    [set(1, { wall: { kind: 'spend', until: CYCLE_END, detail: 'usage limits regained 15 Nov' } }), set(2)],
  )),
  rateLimited: view(picture(
    { slot: 2, why: 'Key 1 is rate-limited until 13:30, so key 2 carries plan runs.' },
    [set(1, { wall: { kind: 'rate', until: Date.UTC(2026, 9, 20, 13, 30) / 1000, detail: 'Rate limited; retry at 13:30' } }), set(2)],
  )),
  refused: view(picture(
    { slot: 2, why: 'Key 1 was refused, so key 2 carries plan runs until key 1 is saved again.' },
    [set(1, { wall: { kind: 'refused', until: null, detail: 'invalid x-api-key' } }), set(2)],
  )),
  everyPayerWalled: view(picture(
    { slot: null, why: 'Every payer stands on a wall, so plan runs try your subscription and are held at its lift.' },
    [
      set(1, { wall: { kind: 'credit', until: CYCLE_END, detail: 'Credit balance is too low' } }),
      set(2, { wall: { kind: 'credit', until: CYCLE_END, detail: 'Credit balance is too low' } }),
    ],
    { kind: 'usage', until: Date.UTC(2026, 9, 20, 17, 0) / 1000, detail: 'Claude usage limit until 17:00' },
  )),
  saveInFlight: view(
    picture(
      { slot: 0, why: 'Both keys have credit left, but neither is in its spend-down window yet, so plan runs ride your subscription.' },
      [set(1), set(2)],
    ),
    { savingSlot: 1, refusal: null },
  ),
  saveRefused: view(
    picture(
      { slot: 0, why: 'Both keys have credit left, but neither is in its spend-down window yet, so plan runs ride your subscription.' },
      [set(1), set(2)],
    ),
    {
      savingSlot: null,
      refusal: {
        slot: 1,
        words: 'REFUSED key 1: that is an admin key (sk-ant-admin…), not an API key — enter a key that starts with sk-ant-api.',
      },
    },
  ),
  noRenewalDay: view(picture(
    { slot: 0, why: 'Key 1 has no renewal day, so it has no spend-down window; plan runs ride your subscription.' },
    [set(1, { renews_day: null, cycle_ends_at: null, window: { open: false, opens_at: null } }), set(2)],
  )),
} satisfies Record<string, ClaudeApiCardView>;

/** The name of one fake state. */
export type ClaudeApiFixtureState = keyof typeof CLAUDE_API_FIXTURE_STATES;

/** The state every mount starts on. */
let current: ClaudeApiFixtureState = 'bothSet';

/** Choose the state the next mount of the card draws. Called by the fixture before mounting. */
export function showClaudeApiFixture(state: ClaudeApiFixtureState): void {
  current = state;
}

/** The chosen state, as the card's read returns it. */
export function claudeApiFixtureView(): ClaudeApiCardView {
  return CLAUDE_API_FIXTURE_STATES[current];
}
