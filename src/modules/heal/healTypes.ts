/**
 * The Heal tab's vocabulary — two words, never one (heal-reflex plan §Interfaces).
 *
 * `kind` is THE DOOR'S OWN WORD for a piece of friction, written by whoever filed the row and never
 * a judgment: `rail-deny`, `script-nudge-blocked`, `tool-error`. A heal is scoped to a kind, the
 * triage counts a kind, the hold is taken on a kind.
 *
 * `klass` is THE CAUSE CLASS, null until judged — the heal doctrine's four. Only a klass feeds a
 * heal's `classes_claimed`, and only a klass can mark a regression: rails refuse BY DESIGN, so a
 * regression measured on the door's word would fire within the hour, forever.
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

/** A landed heal claimed this class, and a live row of it is later than that heal's ending. */
export type HealRegression = {
  heal_id: string;
  klass: HealClass;
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
  classes_claimed: HealClass[];
  /** Rows filed after this heal landed that carry its id — the after-landing spike mark. */
  spikes: number;
  cost_usd: number;
  chain_id: string | null;
};

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
  /** DeepSeek dollars only. A cycle on Claude spends a subscription, and reads zero. */
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
  spend_today: number;
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
