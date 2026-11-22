// ---------------------------
//----------------- ANALYTICS CONTRACTS ------------
// The shapes the Analytics area puts on a wire, in one home of their own.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the reason
// `app-types.ts` beside it is: that file is far past the house ceiling for a module.
//
// This is the client mirror of `server/shared/analytics-types.ts`, field for field. A change here
// without the same change there is an answer the screen cannot read, so the two are edited together, always.
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
