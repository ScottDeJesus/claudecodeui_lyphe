// ---------------------------
//----------------- ANALYTICS CONTRACTS ------------
// The shapes the Analytics area puts on a wire, in one home of their own.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the reason
// `app-types.ts` beside it is: that file is far past the house ceiling for a module.
//
// The client mirror is `src/shared/analytics-types.ts`, field for field. A change here without the same
// change there is an answer the screen cannot read, so the two are edited together, always.
//
// The Code Mode shapes are the house verb's object (`code-mode analytics`), key for key as it prints
// them: snake_case is kept, and "all" is spelled null, never "" — a launch with no model already
// reads as the model "". The server carries the rows as printed and computes nothing.

/** What GET /api/analytics answers: the sections the server holds a reader for, in its order. */
export type AnalyticsSectionList = { sections: { id: string }[] };

/** What GET /api/analytics/:section answers: the area's envelope around one section's data. */
export type AnalyticsAnswer<T> = { section: string; days: number; data: T };

/** One kind the verb knows, with the label the screen draws for it. */
export type CodeModeKind = { kind: string; label: string };

/**
 * The figures every Code Mode row carries. Medians are per launch; the `_total` keys and the
 * fault counts (the house's `faults.COUNT_FIELDS`) are sums over the row's launches.
 */
export type CodeModeFigures = {
  launches: number;
  ok: number;
  turns: number;
  tokens_in: number;
  tokens_out: number;
  tokens: number;
  seconds: number;
  turns_total: number;
  tokens_in_total: number;
  tokens_out_total: number;
  seconds_total: number;
  merges_asked: number;
  merges_merged: number;
  scripts: number;
  thrown: number;
  timed_out: number;
  refused: number;
  failed: number;
  declined: number;
  resent: number;
  /** Automatic saves the house refused, which no longer stop a script's other work. */
  saves_skipped: number;
};

/**
 * One (kind, code_mode, model) row of `groups`, or a rollup of `rollups`: across models
 * (`model` null), or across kinds as well (`kind` and `model` null).
 */
export type CodeModeGroup = CodeModeFigures & { kind: string | null; code_mode: boolean; model: string | null };

/** One (day, kind, code_mode) row of `series`; `kind` null is the day across kinds. `day` is YYYY-MM-DD, box-local. */
export type CodeModeDay = CodeModeFigures & { day: string; kind: string | null; code_mode: boolean };

/** One family of failures, ranked by count; `top` is its three commonest sentences. */
export type CodeModeCause = {
  fault: string;
  helper: string;
  hook: string;
  count: number;
  threw: number;
  launches: number;
  kinds: string[];
  top: { cause: string; count: number }[];
};

/** Every fault in the window: the total, and the count per fault as the journals name it. */
export type CodeModeFaultTotals = { total: number; by_fault: Record<string, number> };

/** The whole answer of `code-mode analytics --days N`. Dates are YYYY-MM-DD in the box's zone. */
export type CodeModeAnalytics = {
  days: number;
  generated_at: number;
  today: string;
  first_day: string | null;
  kinds: CodeModeKind[];
  uncounted: CodeModeKind[];
  groups: CodeModeGroup[];
  rollups: CodeModeGroup[];
  series: CodeModeDay[];
  faults: CodeModeFaultTotals;
  causes: CodeModeCause[];
};

/** The nudge's bars, as web_walk/settled.py holds them: what turns warning to refusing, and what turns it back. Shares are 0 to 1. */
export type WebWalkBars = {
  min_launches: number;
  share: number;
  min_walks: number;
  fault_share: number;
  release_min_walks: number;
  release_fault_share: number;
};

/** The nudge's verdict over its own window_days. since is epoch seconds, null while it has never refused; share is null with no launch. */
export type WebWalkSettled = {
  refusing: boolean;
  since: number | null;
  window_days: number;
  launches_walking: number;
  launches_by_hand: number;
  share: number | null;
  walks: number;
  faults: number;
  bars: WebWalkBars;
};

/** The window's sums. A launch is one owner: a soul's run or a chat. */
export type WebWalkTotals = {
  walks: number;
  launches_walking: number;
  launches_by_hand: number;
  custom_steps: number;
  walks_with_custom: number;
  checks_false: number;
  faults: number;
  unreached: number;
};

/** One day of series that held a walk or a launch by hand. day is YYYY-MM-DD, box-local. */
export type WebWalkDay = { day: string; walks: number; launches_walking: number; launches_by_hand: number; custom_steps: number; faults: number };

/** One premade check: how many times it ran, and how many of those it answered false. */
export type WebWalkCheck = { check: string; ran: number; false: number };

/** The walks by the door they came through: web() in a Code Mode script, or the command. */
export type WebWalkDoors = { execute: number; command: number };

/** One screen of an app: how many times it was opened, and how many times its landmark never showed. */
export type WebWalkScreen = { screen: string; opened: number; unreached: number };

/** One app the walks opened, with its screens. */
export type WebWalkApp = { app: string; walks: number; screens: WebWalkScreen[] };

/** The whole answer of web-walk reading --days N. Dates are YYYY-MM-DD in the box's zone. */
export type WebWalkAnalytics = {
  days: number;
  generated_at: number;
  today: string;
  first_day: string | null;
  settled: WebWalkSettled;
  totals: WebWalkTotals;
  series: WebWalkDay[];
  checks: WebWalkCheck[];
  doors: WebWalkDoors;
  apps: WebWalkApp[];
};

/** One day of the Repeats answer: the launches that wrote a program by hand, their programs and characters, and the characters a family holds. `day` is YYYY-MM-DD, box-local. */
export type RepeatsDay = { day: string; launches_writing: number; programs: number; chars: number; chars_in_families: number };

/** One day of one family. */
export type RepeatsFamilyDay = { day: string; launches: number; programs: number; chars: number };

/** What already does a family's work: a shared file on the shelf (`path`) or a built-in tool (`tool`), how alike it is (0 to 1), and how many of the family's launches used it. */
export type RepeatsExisting = { path?: string; tool?: string; likeness: number; used_by: number };

/**
 * One family: the same work written by hand in many launches. `raised` is the filing predicate (it is an item in the heal
 * tab); `cured_at` is when its newest landed heal ended, and `since_cure` what was written after it. A step family
 * (`tool` "step") counts `uses` and how many `worked`; every other family has both null.
 */
export type RepeatsFamily = {
  id: string;
  sentence: string;
  tool: 'program' | 'commands' | 'step';
  features: string[];
  first_seen: number;
  cured_at: number | null;
  raised: boolean;
  launches: number;
  programs: number;
  chars: number;
  uses: number | null;
  worked: number | null;
  since_cure: { launches: number; programs: number; chars: number } | null;
  names: { name: string; count: number }[];
  examples: { owner: string; path: string; chars: number }[];
  existing: RepeatsExisting[];
  series: RepeatsFamilyDay[];
};

/** The custom steps one shared helper sent. */
export type RepeatsStepHelper = { helper: string; uses: number; worked: number; launches: number };

/** The whole answer of `heal-repeats reading --days N`. Dates are YYYY-MM-DD in the box's zone; moments are epoch seconds. Families are ordered by characters. */
export type RepeatsAnalytics = {
  days: number;
  generated_at: number;
  today: string;
  first_day: string | null;
  window_days: number;
  thresholds: { launches: number; chars: number };
  totals: { launches: number; launches_writing: number; programs: number; chars: number; chars_in_families: number };
  steps: { uses: number; worked: number; launches: number; by_helper: RepeatsStepHelper[] };
  series: RepeatsDay[];
  families: RepeatsFamily[];
};
