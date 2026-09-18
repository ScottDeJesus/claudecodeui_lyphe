import type { ClaudeUsageWindow } from '@/shared/types.js';

/**
 * Reading Anthropic's UNDOCUMENTED usage payload without ever being surprised by it.
 *
 * The SHAPE half of the fuel gauge: this file knows what the payload looks like and nothing about how
 * it was fetched, cached or served. It holds NO CREDENTIAL, opens NO SOCKET and touches no shared
 * state — every function here is pure. The seam, the cache and the clock live in `usage.service.ts`,
 * which imports `parseWindows` and `markRolled` and is their only caller.
 *
 * ⚠ THE DEPENDENCY RUNS ONE WAY AND MUST STAY THAT WAY. That one-way edge is the whole reason the
 * split exists: it is what lets the payload's shape change without a reviewer — or an editor — going
 * anywhere near the token. Ported from `~/.claude/descent/usage_windows.py`, which had the same seam
 * for the same reason, and which the deleted proxy was the only caller of.
 *
 * `GET /api/oauth/usage` is not a published API. It grew several window names between two
 * measurements on the same day (`seven_day_sonnet`, `seven_day_cowork` and four more arrived as
 * nulls, and one day's payload carried eleven), so this parser is written to the only two facts worth
 * relying on: the shape MIGHT change, and a meter must never take anything down with it.
 *
 * THREE PARSE RULES, in order of how much they matter:
 *
 *   1. A missing or null window is ABSENT, never 0 %. `seven_day_opus` is null on this account; a
 *      fabricated 0 % Opus bar beside two real ones is worse than no bar, so the gauge simply has one
 *      fewer row.
 *   2. A 200 nobody can parse is still REACHED. Empty rows, `degraded` stays FALSE — the meter got an
 *      answer it could not read, which is a different fact from a meter that could not ask, and only
 *      the second one means the numbers on screen are stale.
 *   3. `limits[]` is a FALLBACK for the NUMBER, never an override: it fills a window the top level
 *      did not supply and never replaces one it did. Its `severity` ALWAYS crosses, because an alarm
 *      is not a number and it belongs to the WINDOW the vendor named rather than to the entry that
 *      happened to carry the figure — a window the vendor flags while the percentage still reads
 *      comfortable escalates the ink, never softens it, and discarding the entry whole is how the
 *      warn-floor went inert for the two rows the panel actually draws. An unknown `kind` is DRAWN,
 *      in the payload's own words: dropping it is what renders a green gauge beside a window sitting
 *      at 98 %.
 *
 * ⚠ SCALE. This endpoint reports `utilization` as a PERCENT (measured: 14.0 for a 14 % window). The
 * CLI's own rate-limit events report the same quantity as a FRACTION (0.14). Two feeds, two scales,
 * one word — anything that ever merges them must convert; this file reads only the endpoint.
 *
 * ⚠ `weekly_scoped` keeps its OWN labelled row and is never folded into another window. Its
 * `scope.model.display_name` was "Fable" when measured — printing one model's number under another
 * model's label is the one way this panel can lie.
 */

/** Top-level payload key → the row's label. This tuple is also the RENDER ORDER. */
const WINDOW_ORDER: ReadonlyArray<readonly [string, string]> = [
  ['five_hour', '5-hour'],
  ['seven_day', 'weekly'],
  ['seven_day_opus', 'weekly · Opus'],
  ['seven_day_sonnet', 'weekly · Sonnet'],
];
const WINDOW_LABELS = new Map(WINDOW_ORDER);

/** Severity words that mean "nothing to say". Everything else escalates the ink.
 *  ⚠ `info` is deliberately NOT here. In every severity enum this resembles it means "heads up,
 *  something about your account changed" — a reduced limit, a plan change, an overage notice — which
 *  is signal, not silence. The five below are synonyms for nothing. */
const BENIGN_SEVERITY = new Set(['', 'normal', 'none', 'ok', 'null']);

/** Total rendered rows (the payload is a curated list, 3 entries when measured), and the width an
 *  unknown kind is drawn at. */
const MAX_ROWS = 12;
const MAX_LABEL = 24;

/** `limits[].kind` → the top-level key it may FILL IN (rule 3: fill, never override).
 *  `weekly_scoped` is deliberately absent — it is per-MODEL and gets its own row. */
const LIMIT_KINDS: Record<string, string> = {
  session: 'five_hour',
  five_hour: 'five_hour',
  weekly_all: 'seven_day',
  weekly_opus: 'seven_day_opus',
  weekly_sonnet: 'seven_day_sonnet',
};

/** One window's figures, before it is placed in the render order. */
type WindowRow = { percent: number; resetsAt: string | null; severity?: string };

/**
 * A plain object, or false for anything else — arrays included. Exported because the seam half asks
 * the same question of a credentials file, and one definition of "plain object" beats two.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A usable figure. ⚠ JSON has no exclusive int/float split, so the Python guard's `isinstance(...,
 *  bool)` leg has no counterpart — but `true` is still not a percentage, and this is what says so. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The one rounding this module does, so the figure, the tone, the fill and `aria` agree. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** One window node → its figures, or `null`. Rule 1 lives here: null is ABSENT. */
function windowRow(value: unknown): WindowRow | null {
  if (!isRecord(value)) return null;
  const percent = value.utilization;
  if (!isFiniteNumber(percent)) return null;
  return {
    percent: round1(percent),
    resetsAt: typeof value.resets_at === 'string' ? value.resets_at : null,
  };
}

/**
 * The payload → the render-ordered rows. An absent window is simply a missing row.
 *
 * `severity` is a coarse enum tuned for Anthropic's UI, so it never sets the ink — but a window it
 * calls non-normal while the percentage still reads comfortable knows something the percentage does
 * not (an account lock, an overage stop), and drawing that kelp-green is the failure this panel
 * exists to prevent. It may escalate the ink, never soften it.
 */
export function parseWindows(payload: unknown): ClaudeUsageWindow[] {
  const top = isRecord(payload) ? payload : {};
  const found = new Map<string, ClaudeUsageWindow>();
  const filled = new Map<string, string>(); // which `limits[]` kind supplied a FILLED window
  const severity = new Map<string, string>(); // the vendor's alarm, a floor on the colour ramp
  const scoped = new Map<string, ClaudeUsageWindow>(); // namespaced by model/kind; a repeat overwrites

  for (const [key, label] of WINDOW_ORDER) {
    const row = windowRow(top[key]);
    if (row) found.set(key, { key, label, ...row });
  }

  const limits = top.limits;
  if (Array.isArray(limits)) {
    for (const item of limits) {
      // Bounded by the rows that EXIST, read off the collections themselves — never a counter.
      // Counting items consumed let twelve junk entries eat the budget; counting assignments let
      // twelve DUPLICATES eat it, since a repeat overwrites and adds no row. Both pushed a real
      // window at 98 % off the list, which is the disappearance the unknown-kind branch below exists
      // to stop. A count cannot drift from what is rendered.
      if (found.size + scoped.size >= MAX_ROWS) break;
      if (!isRecord(item)) continue;
      const percent = item.percent;
      if (!isFiniteNumber(percent)) continue;
      const row: WindowRow = {
        percent: round1(percent),
        resetsAt: typeof item.resets_at === 'string' ? item.resets_at : null,
      };
      const word = item.severity;
      if (typeof word === 'string' && !BENIGN_SEVERITY.has(word.toLowerCase())) {
        // Escalate-by-DEFAULT rather than by allowlist: an unrecognised severity is far more likely
        // to be a new alarm than a new way of saying "fine", and a false amber costs a glance where a
        // missed alarm costs the wheel.
        row.severity = word;
      }
      const kind = typeof item.kind === 'string' ? item.kind : '';
      const target = LIMIT_KINDS[kind];
      if (target) {
        // ⚠ The alarm must follow the NUMBER. Recording it before the precedence rule below picked a
        // winner took the badge from the entry the code REJECTED and pinned it on the entry it chose.
        if (!found.has(target)) {
          found.set(target, { key: target, label: WINDOW_LABELS.get(target) ?? target, ...row });
          filled.set(target, kind);
          noteSeverity(severity, target, row);
        } else if (filled.has(target) && kind === target && filled.get(target) !== target) {
          // `session` and `five_hour` both name the same window. When BOTH appear, the exactly-named
          // one wins rather than whichever the vendor listed first — otherwise the number on screen
          // depends on array order. A window the TOP LEVEL supplied is never touched (it is not in
          // `filled`).
          found.set(target, { key: target, label: WINDOW_LABELS.get(target) ?? target, ...row });
          filled.set(target, kind);
          severity.delete(target); // the previous entry's alarm loses with its number
          noteSeverity(severity, target, row);
        } else {
          // ⚠ The entry names a window we ALREADY draw, so rule 3 discards its number — but an alarm
          // is not a number. It belongs to the window the vendor flagged, not to the entry that lost
          // the precedence contest, and this leg is the ordinary case rather than an exotic one: the
          // top level supplies `five_hour` and `seven_day` on every live payload, so BOTH rows the
          // footer and the panel render land here whenever `limits[]` flags them. Measured
          // 2026-09-18: `weekly_all` at 86 % with `severity: 'warning'` beside a non-null top-level
          // `seven_day: 86.0` served a `seven_day` row carrying NO severity, while a limits-only
          // `weekly_scoped` row kept its `critical` — so the warn-floor was inert exactly where it
          // matters, and a flagged window below the 80 % threshold would have drawn comfortable
          // green. Record the alarm; leave the figure alone.
          noteSeverity(severity, target, row);
        }
        continue;
      }
      if (kind === 'weekly_scoped') {
        const scope = isRecord(item.scope) ? item.scope : {};
        const model = isRecord(scope.model) ? scope.model : {};
        const name = model.display_name;
        if (typeof name === 'string' && name) {
          // Keyed so a repeat OVERWRITES instead of drawing twice — the same rule as the unknown
          // branch below. The key is namespaced because a model's display name and a kind string
          // share one dictionary.
          scoped.set(`m:${name}`, {
            key: `weekly_scoped:${name}`,
            label: `weekly · ${name}`,
            ...row,
          });
        }
        continue;
      }
      if (kind) {
        // ⚠ AN UNKNOWN KIND IS THE DANGEROUS ONE. `limits[]` is the vendor's own curated display
        // list, not a scrap heap — dropping an entry this table has not been taught renders a
        // comfortable green gauge beside a window sitting at 98 %, which is the exact surprise this
        // panel exists to prevent. An ugly label beats a missing bar, so it is drawn in the payload's
        // own words.
        scoped.set(`k:${kind}`, {
          key: `limit:${kind}`,
          label: kind.replace(/_/g, ' ').slice(0, MAX_LABEL),
          ...row,
        });
      }
    }
  }

  const rows: ClaudeUsageWindow[] = [];
  for (const [key] of WINDOW_ORDER) {
    const window = found.get(key);
    if (!window) continue;
    const word = severity.get(key);
    rows.push(word === undefined ? window : { ...window, severity: word });
  }
  rows.push(...scoped.values());
  return rows;
}

/** Carry an entry's alarm onto the window it named. Top-level windows carry no severity of their
 *  own, so `limits[]` is the only place one can come from — and it comes from every entry that
 *  named a window we draw, the ones that lost the number included, because `row.severity` is set
 *  only for a NON-benign word, so every call here is an escalation and none can soften. */
function noteSeverity(severity: Map<string, string>, target: string, row: WindowRow): void {
  if (row.severity !== undefined) severity.set(target, row.severity);
}

/** `Z` or a numeric offset at the end of an ISO stamp — the difference between a UTC instant and one
 *  `Date` would read as local time. */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** One `resetsAt` string → a UTC epoch in MILLISECONDS, or `null` if there is no usable instant.
 *
 *  ⚠ A timestamp with NO offset is read as UTC, the same rule the panel's `resetInstant()` applies
 *  (`src/modules/accounts/utils/usageWindows.ts`). The two MUST agree: this function decides
 *  `markRolled`'s flag from the same string the panel counts down to, so a second reading of it
 *  would put "was 88 % used" beside a countdown to a different instant. `Date` does the opposite by
 *  default — it reads a zoneless stamp as LOCAL, which on this box would move a reset by seven
 *  hours, so a payload that ever drops its `+00:00` buys that divergence silently. The appended `Z`
 *  is the whole guard, and it is the same one on both sides of the wire. */
export function resetEpoch(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const at = new Date(HAS_ZONE.test(value) ? value : `${value}Z`);
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

/**
 * Flag any window whose reset instant fell AFTER its figure was read and before now.
 *
 * ⚠ THE WINDOW IS ANCHORED TO FIRST USE, NOT TO A WALL-CLOCK GRID, so THE NEXT BOUNDARY IS NOT
 * KNOWABLE FROM THIS ONE. Three `five_hour` resets in the CLI's own history land on three different
 * phases mod 5 h (12000 / 10200 / 1200 s); a fixed grid would put every one on a single phase.
 * Continuous use chains one block into the next and preserves the phase, an idle gap re-anchors it,
 * and while the account is idle there may be no next window at all. NEVER compute a following reset
 * as `resetsAt + 5h`, and never print a countdown to one: watching a window from inside it cannot
 * tell you where the next one starts.
 *
 * THE RESET INSTANT IS STABLE FOR THE LIFE OF ITS OWN WINDOW — measured 2026-09-01: held to ±0.4 s
 * across seven polls over twenty minutes (weekly included), and held at 07:20:00 across ~2.5 hours
 * while utilisation climbed 14 % → 25 %. It does not SLIDE, so a reading the instant overtook is not
 * merely old: it describes a block that is over. That, and only that, is what this function claims.
 *
 * ⚠ ROLLED IS NOT ZERO, and the difference is the whole point. At the instant of reset the usage IS
 * 0, but anything running starts climbing immediately, and the case this exists for is precisely the
 * one where nobody can see it (a stale reading spanning a rollover while the token is expired or the
 * endpoint is refusing). Writing 0 % there would put a number on screen that nobody read — the one
 * thing this panel does not do. `rolled` says exactly what is known: the figure is HISTORICAL, and
 * how much of the current block is gone is unread. The UI keeps the last-known bar at low opacity and
 * labels the figure `was`. It neither drains the bar — that draws the full tank this refuses to
 * claim, and renders pixel-identical to a genuine measured 0 % — nor asserts that a new window exists
 * and is new, because under first-use anchoring there may not be one.
 *
 * Pure, and applied at SERVE time rather than at parse time: the same cached reading is correct
 * before its reset and rolled after it, without being re-read.
 *
 * ⚠ THE WINDOW OF INTEREST IS `readAt < resetsAt <= now`, NOT simply `now >= resetsAt`. If the
 * reading itself was taken AFTER the instant and the endpoint still reported it, the endpoint is
 * authoritative for the moment it answered and this clock must not overrule it. Comparing against
 * `now` alone marked FRESH readings: five minutes of clock skew on this box — a suspended VM, a
 * resuming container, a drifting RTC — drained an 88 %-used bar to "rolled", which is the false-SAFE
 * direction on the one decision this panel informs.
 */
export function markRolled(
  windows: ClaudeUsageWindow[],
  now: number,
  readAt: number,
): ClaudeUsageWindow[] {
  return windows.map((window) => {
    const at = resetEpoch(window.resetsAt);
    return at !== null && readAt < at && at <= now ? { ...window, rolled: true } : window;
  });
}
