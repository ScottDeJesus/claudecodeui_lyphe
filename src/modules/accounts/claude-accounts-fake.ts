import type { ClaudeAccountRow, ClaudeAccountsPicture } from '@/shared/types';

/**
 * The account section's fake states. Every entry is a WHOLE value the route will one day relay, so a
 * fixture can draw a state without standing up the door, the store or a server — and so a reviewer
 * sees the state the panel will really be handed, never a prop-shaped sketch of it.
 *
 * Used by the fixture under /tmp that photographs `ClaudeAccountRows` in each state, at three widths
 * and in both themes. Not imported by the app: nothing in `src/` outside this file's fixture is meant
 * to read it, and the bundle never includes it.
 */
export type FakeClaudeAccounts = ClaudeAccountsPicture | { reachable: false; reason: string };

/** The state names, one per picture below. */
export type FakeClaudeAccountsState =
  | 'in-use-by-hand'
  | 'in-use-auto'
  | 'real-why'
  | 'held-while-full'
  | 'checked-with-room'
  | 'checked-full'
  | 'no-token'
  | 'in-use-no-token'
  | 'refused'
  | 'checking'
  | 'old-reading'
  | 'no-reading'
  | 'candidate'
  | 'auto-off'
  | 'no-last-switch'
  | 'empty'
  | 'dense'
  | 'door-unreachable';

const DAY_SECONDS = 86_400;

/** The two accounts the brief names, with the digests the store's examples use. */
const SD = { slug: 'sdjesus89', digest: '8b907ae7' } as const;
const SCOTT = { slug: 'scottdejesus', digest: 'f9caa612' } as const;

/**
 * The rule phase's sentence for an automatic switch, verbatim
 * (`plans/usage-limits--account-switch.phases.toml`: the words name accounts by slug and windows in
 * points). This is what the live door sends, so it is what the fakes must draw.
 */
const AUTO_WHY =
  "sdjesus89's weekly is at its ceiling (96% used, 96% projected, ceiling 95%); scottdejesus has room (5-hour 2%, weekly 6%)";

/** The door's exact words for a hand pick — `use <slug>` logs `why "picked by hand"`. */
const HAND_PICK_WHY = 'picked by hand';

/** A saved token's expiry, epoch SECONDS like every stamp the door relays. */
function expiry(nowMs: number, days = 27): number {
  return Math.floor(nowMs / 1000) + days * DAY_SECONDS;
}

/** One filed reading: fractions 0..1, epoch-second stamps, the pacer's own source word. */
function reading(nowMs: number, five: number, week: number, ageMs = 60_000): NonNullable<ClaudeAccountRow['reading']> {
  const at = Math.floor((nowMs - ageMs) / 1000);
  return { five, five_resets: at + 3_600, week, week_resets: at + 4 * DAY_SECONDS, at, source: 'meter' };
}

/** The rule's points word: a fraction as `96%`, or `-` when no reading is there (`room.py`'s `_points`). */
function points(fraction: number | null | undefined): string {
  return fraction === null || fraction === undefined ? '-' : `${Math.round(fraction * 100)}%`;
}

/** The rule's room sentence, verbatim (`room.py`'s `_room_words`): `scottdejesus has room (5-hour 2%, weekly 6%)`. */
function roomWords(slug: string, accountReading: ClaudeAccountRow['reading']): string {
  return `${slug} has room (5-hour ${points(accountReading?.five)}, weekly ${points(accountReading?.week)})`;
}

/** The rule's ceiling sentence (`room.py`'s `_ceiling_words`), the fake's ceiling being 95%. */
function ceilingWords(slug: string, used: number | null | undefined, projected: number | null | undefined): string {
  return `${slug}'s weekly is at its ceiling (${points(used)} used, ${points(projected)} projected, ceiling 95%)`;
}

/** A whole row, with the token saved and room unless a state says otherwise. */
function row(overrides: Partial<ClaudeAccountRow> & { slug: string; digest: string }): ClaudeAccountRow {
  return {
    token: 'saved',
    expires_at: null,
    chosen: false,
    live: false,
    in_use: false,
    wall: null,
    reading: null,
    pace: null,
    room: true,
    why: '',
    ...overrides,
  };
}

/** A whole picture, with every list and flag present and the per-row chosen flag derived. */
function picture(overrides: Partial<ClaudeAccountsPicture>): ClaudeAccountsPicture {
  const chosen = overrides.chosen ?? null;
  // The door's per-row `chosen` is true exactly on the chosen record's digest (`door_status.py`), so
  // derive it: no fake claims a chosen account the picture's own record does not name.
  const accounts = (overrides.accounts ?? []).map((account) => ({
    ...account,
    chosen: chosen !== null && account.digest === chosen.digest,
    // The door relays the rule's words for every account (`seen.words`), so a row with room says
    // so. A full row's ceiling or wall sentence is the state's to pass; nothing here invents one.
    why: account.why === '' && account.room ? roomWords(account.slug, account.reading) : account.why,
  }));
  return { candidates: [], auto: true, held: false, chosen: null, last_switch: null, ...overrides, accounts };
}

/**
 * The two rows most states start from: sdjesus89 in use as the box's live login, scottdejesus holding
 * a checked token with room. A state overrides only the row it is about.
 */
function pair(nowMs: number, sd: Partial<ClaudeAccountRow> = {}, scott: Partial<ClaudeAccountRow> = {}): ClaudeAccountRow[] {
  return [
    row({ ...SD, expires_at: expiry(nowMs), live: true, in_use: true, reading: reading(nowMs, 0.4, 0.6), ...sd }),
    row({ ...SCOTT, expires_at: expiry(nowMs), reading: reading(nowMs, 0.02, 0.06), ...scott }),
  ];
}

/** The chosen record for sdjesus89, picked by hand five minutes ago. */
function chosenByHand(nowSeconds: number) {
  return { ...SD, at: nowSeconds - 300, by: 'operator' as const, why: HAND_PICK_WHY };
}

/** The last switch that put sdjesus89 in use by hand. */
function switchedByHand(nowSeconds: number) {
  return {
    at: nowSeconds - 300,
    from: SCOTT.digest,
    from_slug: SCOTT.slug,
    to: SD.digest,
    to_slug: SD.slug,
    by: 'operator' as const,
    why: HAND_PICK_WHY,
  };
}

/** Every state, as one whole value, measured from `nowMs` (epoch MILLISECONDS) so no stamp goes stale. */
export function claudeAccountFakes(nowMs: number): Record<FakeClaudeAccountsState, FakeClaudeAccounts> {
  const nowSeconds = Math.floor(nowMs / 1000);

  return {
    // The account in use was picked by hand; the other has no token yet, so it offers Set up.
    'in-use-by-hand': picture({
      accounts: pair(nowMs, {}, { token: 'none', expires_at: null, reading: null }),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // The rule moved the chat to scottdejesus because sdjesus89's weekly filled.
    'in-use-auto': picture({
      accounts: pair(
        nowMs,
        {
          in_use: false,
          reading: reading(nowMs, 0.96, 0.96),
          room: false,
          why: ceilingWords(SD.slug, 0.96, 0.96),
        },
        { chosen: true, in_use: true },
      ),
      chosen: { ...SCOTT, at: nowSeconds - 120, by: 'auto', why: AUTO_WHY },
      last_switch: {
        at: nowSeconds - 120,
        from: SD.digest,
        from_slug: SD.slug,
        to: SCOTT.digest,
        to_slug: SCOTT.slug,
        by: 'auto',
        why: AUTO_WHY,
      },
    }),

    // The rule's own long sentence under the in-use row, with no last switch to repeat it: the
    // heaviest state of the row's why at the narrowest width.
    'real-why': picture({
      accounts: pair(
        nowMs,
        {
          in_use: false,
          live: false,
          reading: reading(nowMs, 0.96, 0.96),
          room: false,
          why: ceilingWords(SD.slug, 0.96, 0.96),
        },
        { in_use: true, chosen: true, live: true },
      ),
      chosen: { ...SCOTT, at: nowSeconds - 120, by: 'auto', why: AUTO_WHY },
    }),

    // A hand pick that has no room: it stays chosen until one of the two windows reopens.
    'held-while-full': picture({
      held: true,
      accounts: pair(
        nowMs,
        { reading: reading(nowMs, 0.4, 0.96), room: false, why: ceilingWords(SD.slug, 0.96, 0.96) },
        { reading: reading(nowMs, 0.02, 0.98), room: false, why: ceilingWords(SCOTT.slug, 0.02, 0.98) },
      ),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // The row that is one click from being in use: a checked token with room.
    'checked-with-room': picture({
      accounts: pair(nowMs),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // A checked token whose account has no room: pressing it chooses an account that waits.
    'checked-full': picture({
      accounts: pair(nowMs, {}, {
        reading: reading(nowMs, 0.02, 0.98),
        room: false,
        why: ceilingWords(SCOTT.slug, 0.02, 0.98),
      }),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // Nothing set up on the second account: one Set up row, no figures, no date.
    'no-token': picture({
      accounts: pair(nowMs, {}, { token: 'none', expires_at: null, reading: null }),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // The design's first live picture — the box after `adopt sdjesus89 scottdejesus`: sdjesus89 is
    // in use with no token, so its own row offers Set up, and scottdejesus is a second Set up row.
    // No chosen record and no switch yet.
    'in-use-no-token': picture({
      accounts: pair(
        nowMs,
        { token: 'none', expires_at: null, reading: null },
        { token: 'none', expires_at: null, reading: null },
      ),
    }),

    // Claude would not accept the saved token: the row says so and offers Set up again.
    refused: picture({
      accounts: pair(nowMs, {}, {
        wall: { kind: 'refused', until: null },
        room: false,
        why: "scottdejesus's sign-in token was refused",
      }),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // A freshly saved token is being checked by one Haiku turn; it is not usable yet.
    checking: picture({
      accounts: pair(nowMs, {}, { token: 'checking', reading: null }),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // Figures old enough that the row owes the reader their age.
    'old-reading': picture({
      accounts: pair(nowMs, {}, { reading: reading(nowMs, 0.02, 0.06, 2 * 60 * 60_000) }),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // A checked token nobody has measured yet: both windows read as em-dashes.
    'no-reading': picture({
      accounts: pair(nowMs, {}, { reading: null }),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // The box is signed in as an identity the store does not hold. No store row is live or in use,
    // nothing wears the in-use wash, and the candidate is the only row that can be set up.
    candidate: picture({
      accounts: pair(nowMs, { live: false, in_use: false }, { live: false }),
      candidates: [{ slug: 'scottdejesus.dev', digest: 'ef43a9e9' }],
    }),

    // The rule may not switch on its own; the switch reads off and the section says what that means.
    'auto-off': picture({
      auto: false,
      accounts: pair(nowMs),
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // A chosen account with no switch recorded yet.
    'no-last-switch': picture({
      accounts: pair(nowMs),
      chosen: chosenByHand(nowSeconds),
    }),

    // Nothing set up and nobody signed in: the section's own empty state.
    empty: picture({}),

    // Five accounts and one candidate — the height the panel scrolls at, at its densest. The chosen
    // record names sdjesus89, so it is the account in use; the candidate is the box's login.
    dense: picture({
      accounts: [
        row({ ...SD, expires_at: expiry(nowMs), live: false, in_use: true, reading: reading(nowMs, 0.4, 0.6) }),
        row({ ...SCOTT, expires_at: expiry(nowMs), live: false, in_use: false, reading: reading(nowMs, 0.86, 0.91) }),
        row({ slug: 'marisol', digest: '1f4c8a20', expires_at: expiry(nowMs), live: false, in_use: false, reading: reading(nowMs, 0.2, 0.34) }),
        row({ slug: 'okonkwo', digest: '77b21d05', expires_at: expiry(nowMs), live: false, in_use: false, reading: reading(nowMs, 0.55, 0.72) }),
        row({ slug: 'takeda', digest: 'c9e03b71', expires_at: expiry(nowMs), live: false, in_use: false, reading: reading(nowMs, 0.12, 0.28) }),
      ],
      candidates: [{ slug: 'scottdejesus.dev', digest: 'ef43a9e9' }],
      chosen: chosenByHand(nowSeconds),
      last_switch: switchedByHand(nowSeconds),
    }),

    // The door could not answer: one calm line, and nothing else.
    'door-unreachable': { reachable: false, reason: 'unreachable' },
  };
}
