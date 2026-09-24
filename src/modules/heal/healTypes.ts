/**
 * The Heal tab's vocabulary — two words, never one (heal-reflex plan §Interfaces).
 *
 * `kind` is THE DOOR'S OWN WORD for a piece of friction, written by whoever filed the row and never
 * a judgment: `rail-deny`, `script-nudge-blocked`, `tool-error`. A heal is scoped to a kind, the
 * triage counts a kind, the hold is taken on a kind.
 *
 * `klass` is THE CAUSE CLASS, null until judged — the heal doctrine's four. It is what a kind's chip
 * and the tallies' class breakdown read, and it is NOT what a heal claims: a claim is the set of
 * `signature` SHAPES a heal cured (`HealCard.signatures_claimed`), because a bucket is too coarse to
 * be a cause — a busy kind's rows carry all four, so a claim of the buckets marked every classified
 * row a regression (measured 2026-09-23: 109 rows). Only a shape can mark one.
 *
 * A CYCLE is the unit the operator asks about — "what did last night do?" — one nightly (or pressed)
 * pass in which Chiron ranks the live friction and heals walk his list. The tab renders the
 * worker's own words for it: `cycle_state.text`, `item.label`, the worker's rank. It chooses nothing.
 *
 * These shapes are the tab's reading of the worker's `--status` payload. Nothing here fetches.
 */

/** The door's own word. Free text: the set grows as doors are added, so it is never an enum. */
export type HealKind = string;

/** The four cause classes of `skills/heal/SKILL.md` § Classify. */
export type HealClass = 'one-off' | 'recurring' | 'definition-clarity' | 'design-flaw';

/** One row of the friction ledger, as much of it as the tab shows. */
export type HealItem = {
  id: number;
  /** Epoch seconds. */
  ts: number;
  kind: HealKind;
  klass: HealClass | null;
  /** Which door filed it: `rail`, `script_nudge`, `index`, `phase`, `chain`. */
  source: string;
  /** Filed by a soul child rather than the main session. */
  soul: boolean;
  tool: string | null;
  detail: string | null;
  /** Where to open it: the transcript path and the line the item was read at. Either may be absent. */
  transcript: string | null;
  transcript_line: number | null;
  ignored: boolean;
};

/** A landed heal cured this SHAPE, and a live row of that kind carries it again. */
export type HealRegression = {
  heal_id: string;
  /** The normalized failure shape that came back — the worker's own claim, printed as it wrote it. */
  signature: string;
  /** Epoch seconds of the row that marks it. */
  since: number;
};

/** Friction by kind — what a heal is scoped to, with what the tab needs to triage it. */
export type HealKindRow = {
  kind: HealKind;
  live: number;
  ignored: number;
  /** Against the previous window of the same length; null when there is no earlier window to compare. */
  trend: 'up' | 'down' | 'flat' | null;
  /** The cause class the kind's judged rows carry, or null when none is judged yet. Never fabricated. */
  klass: HealClass | null;
  regression: HealRegression | null;
  items: HealItem[];
};

export type HealStatus = 'running' | 'done' | 'blocked';

/** Athena's findings on the heal's chain, by severity. Null until she has reviewed. */
export type AthenaCounts = { blocking: number; high: number; medium: number; low: number };

/** One heal, whole — the run-card shape. */
export type HealCard = {
  id: string;
  kind: HealKind;
  status: HealStatus;
  /** What fired it: `session-end`, `compact`, `stop`, `manual`, `cycle:<cycle id>`. */
  reason: string;
  started_at: number;
  ended_at: number | null;
  /** Who built: the soul and the model it ran on. */
  builder: string;
  athena: AthenaCounts | null;
  /** Rows this heal claimed and closed. */
  closed: number;
  /**
   * The failure shapes this heal cured — what `read.regressions()` compares a returning row against.
   * A HEAD of the claim, never all of it: the worker sends `SIGNATURES_SHOWN` (12) and the count in
   * `shapes_claimed`, because one heal of a long-running kind can cure hundreds of shapes and this
   * payload rides every sixty seconds. The whole list is on the heal row and in its brief.
   */
  signatures_claimed: string[];
  /** How many shapes the heal claimed in total — `signatures_claimed.length` or more. */
  shapes_claimed: number;
  /** Rows filed after this heal landed that carry its id — the after-landing spike mark. */
  spikes: number;
  /**
   * Dollars this heal booked — WHOSE dollars depends on when it ended: a heal that landed before the
   * 2026-09-23 recipe change booked its chain's WHOLE bill, Claude stages included; one that landed
   * after books its DeepSeek share alone, which is what `spend_today` and the daily cap count. Read
   * `bookedBy` rather than the date, so no reader re-derives which of the two this is.
   */
  cost_usd: number;
  /**
   * The chain's tokens beside the dollars, THE CLAUDE HALF ALONE, and the same reading the run
   * cards use: `tokens_in` is what its CLAUDE souls READ (input + cache read + cache write),
   * `tokens_out` what they wrote, and `tokens` the total as the chain recorded it
   * (`chain_state.usage`, which zeroes a stage a vendor billed). Both parts read `0` against a real
   * total on a chain whose stages kept no split — a record older than the split — and the card then
   * states the total alone (`⛁ 2.6M tok`, `usageText`), never a fabricated `2.6M in · 0 out`.
   * A SPEND FIGURE IS DOLLARS
   * **OR** TOKENS, BY WHO WAS USED (operator rule, 2026-09-24): the dollar figure above is a
   * PAYING API's share alone, so a heal that only ever paid the vendor bills there and draws NO
   * tokens here — they are the vendor's own business — while one that rode the subscription
   * bills 0 and draws these and no `$`. `undefined` from a worker build older than the keys,
   * which reads as "not recorded" and never as zero.
   */
  tokens?: number;
  tokens_in?: number;
  tokens_out?: number;
  chain_id: string | null;
};

/**
 * The instant the cost recipe changed. A heal's `cost_usd` has meant two different things: before this
 * the ledger booked a chain's WHOLE bill, Claude stages included (the six rows of 2026-09-23 sum
 * $7.259154, of which $3.109996 is Claude — the operator's subscription, counted as if it were
 * DeepSeek); from it, a heal books its DeepSeek share alone. The payload carries no mark of which
 * recipe booked a row — no column of the ledger records it and the worker sends none — so the boundary
 * is carried here as the fact it is.
 *
 * ITS VALUE IS THE BUILD'S OWN CHAIN START (`chain-heal-deepseek-dollars-20260923-123256-c6ec`,
 * 2026-09-23 12:32:56 local). No row can hide in the gap above it: the day's last heal landed 12:02:48
 * and the $7.26 those six booked was already past the $5.00 cap, so the reflex launched nothing
 * between — every booking from here on is the new recipe, which from the next local midnight is every
 * card this tab can draw.
 */
const DEEPSEEK_SHARE_SINCE = 1790191976;

/** Which recipe booked a heal's `cost_usd` — the two readings a reader must be told apart, and nothing yet booked. */
export type HealBookedBy = 'deepseek-share' | 'chain-total' | 'unbooked';

/**
 * Whose figure a heal's `cost_usd` is. A heal books when it ENDS (`ended_at`), so the boundary is read
 * there and never off this screen's own clock: a walking row has booked nothing, an ended row before
 * the change carries its chain's whole bill, and later rows DeepSeek's share.
 */
export function bookedBy(heal: Pick<HealCard, 'ended_at'>): HealBookedBy {
  if (heal.ended_at === null) return 'unbooked';
  return heal.ended_at >= DEEPSEEK_SHARE_SINCE ? 'deepseek-share' : 'chain-total';
}

/**
 * Whether the day's figure is mixed — a card booked by the OLD recipe and ended inside the day's own
 * window (`sinceMidnight`, the cut `spend_today` is summed from) must be read for what it is. A card
 * older than the window is not in the figure and has nothing to say about it: this is what keeps the
 * answer from outliving the day, since the tab's card list is longer than its day.
 */
export function hasPreChangeRows(
  heals: readonly Pick<HealCard, 'ended_at'>[],
  sinceMidnight: number,
): boolean {
  return heals.some(
    (heal) => heal.ended_at !== null && heal.ended_at >= sinceMidnight && bookedBy(heal) === 'chain-total',
  );
}

/** The runner heal queue's own items — the second door, read here and never written. */
export type HealQueueItem = {
  id: string;
  plan: string;
  phase: string;
  cause: string;
  status: string;
  next: string | null;
  enqueued_at: number;
};

export type IgnoreRow = {
  id: number;
  tool: string;
  pattern: string;
  reason: string;
  added_by: 'operator' | 'heal';
  added_at: number;
};

/** Where a cycle stands: Chiron judging, heals walking his list, the last ones finishing, or over. */
export type HealCycleStage = 'judging' | 'healing' | 'closing' | 'done' | 'stopped';

/** Why an item ranks where it does — a cause that came back, a run that cannot finish, a kind that keeps happening, or once. */
export type HealCycleTier = 'regression' | 'blocked-run' | 'frequent' | 'one-off';

/** One line of a cycle's worklist, in the worker's rank, with Chiron's `why` and what became of it. */
export type HealCycleItem = {
  rank: number;
  /** `kind:<kind>` or `queue:<item id>`. */
  ref: string;
  tier: HealCycleTier;
  /** The kind name, or `run ⛔ <plan basename> phase <phase>` — printed as the worker wrote it. */
  label: string;
  why: string;
  state: 'pending' | 'launched' | 'landed' | 'skipped' | 'dropped' | 'ignored';
  heal_id: string | null;
  pid: number | null;
  note: string;
};

/** What the judge seam applied and what it refused, with the reason each entry was refused. */
export type HealCycleNotes = {
  ignored: { tool: string; pattern: string; reason: string; swept: number }[];
  refused: { entry: unknown; why: string }[];
};

/** One cycle, whole — the row plus its worklist and the judge's notes. */
export type HealCycle = {
  id: string;
  door: 'schedule' | 'press';
  stage: HealCycleStage;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  gathered: number;
  ignored: number;
  healed: number;
  /**
   * DeepSeek dollars only. A cycle on Claude spends a subscription, and reads zero. A heal booked
   * before the 2026-09-23 recipe change counts its chain's whole bill here (see `bookedBy`), so a cycle
   * that spans that date — the night of the change, and no other — reads high by the Claude stages its
   * heals rode.
   */
  spent: number;
  /** Chiron's launch id, `fallback: <why>`, `none — nothing to judge`, or null before he is launched. */
  judge: string | null;
  /** The last reason nothing launched, null after a launch. */
  wait: string | null;
  items: HealCycleItem[];
  notes: HealCycleNotes;
};

/** The worker's one sentence on the cycle: the tab renders `text` and colours it by `word`. */
export type HealCycleState = { word: 'open' | 'waiting' | 'next' | 'off'; text: string; at: number | null };

/** The nightly schedule (`state/heal_cycle.flag`): on or off, and the UTC hour it opens at. */
export type HealCycleSwitch = { on: boolean; hour: number };

/** The reflex's flag files, as the worker reads them — `decide.switches()` whole, which is what the launch gate weighs. */
export type HealSwitches = {
  /**
   * The master switch (`state/heal.flag`), whose ONLY home in this payload is here — the tab's own door
   * to it stays `GET /api/settings/heal-master`, so one fact never has two. Absent means ON: this is
   * the one switch of the family that fails open.
   */
  master: boolean;
  /** Null is NO CEILING, the switch's shipped state. */
  daily_cap: number | null;
  /**
   * WHICH MODEL THIS HEAL'S SOULS WILL REALLY RUN ON — the heal's OWN model switch
   * (`state/heal_model.flag`) as the worker resolved it, through the same function its parks, its
   * ledger column and its chain read. It is always one of the two words: an absent file means
   * `deepseek`, and the chat composer's switch (`state/deepseek_flash.flag`) is a different file that
   * has nothing to say about it. The tab draws the chip's mark, the pills and the cap's tone off THIS
   * and never off a rule of its own, so no screen in this app can show a model the next ending will
   * not use.
   */
  model: 'deepseek' | 'claude';
  cycle: HealCycleSwitch;
};

/** The whole `--status` payload as the tab reads it. */
export type HealSummary = {
  /** Live rows in the WHOLE ledger — the tab's badge, and the number the reflex's launch gate counts. */
  live: number;
  /**
   * The live rows filed since the last heal ENDED (`started_at` while it is still walking), which is
   * what the Friction pill reads and what its own marker postponed itself for. Not the same number as
   * `live`: `live` is everything still open, this is what hurt since anything was done about any of it,
   * and they are equal only while no heal has ended.
   */
  live_since_last_heal: number;
  ignored: number;
  last_heal: { id: string; kind: HealKind; status: HealStatus; ended_at: number | null } | null;
  /** DeepSeek dollars LANDED today — a heal books its cost when it ends, so this is what has closed. */
  spend_today: number;
  /**
   * DeepSeek dollars the heals still WALKING have yet to book: the ones in flight, priced at the mean
   * of the last five landed heals (0 when none has landed). The daily cap weighs `spend_today` plus
   * this — a cap read off the landed half alone lets the launches already open close past it.
   */
  spend_reserved: number;
  /** kind → heal id, for every kind a running heal holds. */
  held: Record<HealKind, string>;
  kinds: HealKindRow[];
  heals: HealCard[];
  queue: HealQueueItem[];
  ignore: IgnoreRow[];
  switches: HealSwitches;
  /** Up to ten, newest first. */
  cycles: HealCycle[];
  /** The open cycle's id, or null when none is open. */
  cycle_open: string | null;
  cycle_state: HealCycleState;
};

/** What the screen is showing: the three facts a reader can be told, never conflated. */
export type HealScreenState =
  | { phase: 'loading' }
  | { phase: 'error'; reason: string }
  | { phase: 'ready'; summary: HealSummary };

/** The five pills, in the operator's own order. */
export type HealPillKey = 'friction' | 'ignored' | 'lastHeal' | 'spend' | 'cycle';
