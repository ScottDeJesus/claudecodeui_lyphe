import os from 'node:os';
import path from 'node:path';

import { PY_SPACE, readFlagText, writeFlag } from './heal-switch.js';

/**
 * `heal_cycle.flag` — when the maintenance cycle opens, and the hour it opens at.
 *
 *   `heal_cycle.flag`  `off` · `on` · `on <N>`, N the UTC hour. `off` stops the SCHEDULE and nothing
 *                      else: a pressed cycle is the operator's own hand and is never gated by this
 *                      file, exactly as the typed heal door is never gated by the master switch.
 *                      Anything else — absent, unreadable, past the family's flag bound (256 bytes,
 *                      `heal-switch.ts`'s `FLAG_MAX_BYTES`), `ON`, `on 24`, a typo — is ON at 10,
 *                      because the schedule ships ON and 10 is the hour it ships at. Ships absent.
 *
 * It lives in a module of its own, beside `heal-switch.ts` rather than inside it, for the reason
 * `heal-model-switch.ts` does: the switches there are the reflex's OWN behaviour — whether it may
 * launch, what the day may cost — while this one is a clock ON that behaviour. They change for
 * different reasons. The read and write below go through `heal-switch.ts`'s own
 * `readFlagText`/`writeFlag`, so this file is parsed and written by the SAME code as its siblings:
 * one bound, one leading-BOM rule, one Python-space class, one atomic rename. Nothing is
 * re-implemented here.
 *
 * The grammar is a contract written twice in two languages, and the Python twin is
 * `scripts/heal_switches.py`'s `read_cycle_switch`, which states these same five clauses in this
 * same order. THE FAIL-OPEN IS THE SHIPPED DEFAULT'S, and it sits on the other side from the cap's:
 * a malformed cap is NO CEILING, a malformed cycle flag is ON at 10 — the state the file shipping
 * absent already means — so nothing but the operator's own typed word `off` ever stops the clock.
 */
export const HEAL_CYCLE_PATH = path.join(os.homedir(), '.claude', 'state', 'heal_cycle.flag');

/** The hour the schedule ships at, and the hour of a bare `on` — UTC, the hour both readers answer
 * for every clause the file cannot be trusted on. Other readers of it: `heal_switches.py`'s own
 * `CYCLE_HOUR_DEFAULT`, and the panel, which renders `hour` in local time and nothing else. */
export const HEAL_CYCLE_DEFAULT_HOUR = 10;

/**
 * The schedule's whole word: a side, and the UTC hour it fires at — ALWAYS both, in every state the
 * file can be in, so a caller is never handed a flag missing half its answer.
 */
export type HealCycle = { enabled: boolean; hour: number };

/** The one whitespace class Python splits on, shared with `heal-switch.ts` rather than restated:
 * `str.split()` and `str.strip()` take the same set, and a second copy of it is a second thing to
 * keep in step with the Python twin. */
const WORDS = new RegExp(`[${PY_SPACE}]+`);

/** An hour as the Python clause matches one: ASCII digits and nothing else. `\d` is not the class
 * (it takes other scripts' digits), and neither is `Number()` (it takes `3.5`, `0x10`, `1e1`). */
const DIGITS = /^[0-9]+$/;

/** The last hour of the day. `on 24` is not a time, and lands on the shipped default. */
const HOUR_MAX = 23;

const OFF_WORD = 'off';
const ON_WORD = 'on';

/**
 * The one parse of the flag's content, agreeing clause for clause with `read_cycle_switch`, in the
 * same order:
 *
 *   1. split the content on whitespace runs;
 *   2. exactly `["off"]` → off at the shipped hour;
 *   3. exactly `["on"]` → on at the shipped hour;
 *   4. `["on", N]` with N all digits and N ≤ 23 → on at N;
 *   5. anything else → on at the shipped hour.
 *
 * The split is what decides, not a prefix match: `off .` and `off 3` are not the word, and `ON` is
 * not `on` — all three land on clause 5, exactly as they do in the worker. Empty tokens are dropped
 * (`.filter(Boolean)`) because that is what Python's argument-less `str.split()` does with a run at
 * either end: without it, a trailing newline no reader has trimmed would make `off` two words and
 * draw the schedule on. `null` — the absent or unreadable file `readFlagText` answers — is the empty
 * string here, and so clause 5.
 */
export function parseHealCycle(content: string | null): HealCycle {
  const words = (content ?? '').split(WORDS).filter(Boolean);
  if (words.length === 1 && words[0] === OFF_WORD) {
    return { enabled: false, hour: HEAL_CYCLE_DEFAULT_HOUR };
  }
  if (words.length === 2 && words[0] === ON_WORD && DIGITS.test(words[1])) {
    const hour = Number.parseInt(words[1], 10);
    if (hour <= HOUR_MAX) return { enabled: true, hour };
  }
  return { enabled: true, hour: HEAL_CYCLE_DEFAULT_HOUR };
}

/**
 * The schedule, read. ON at 10 in every case the file cannot be trusted — not there, oversized, or
 * holding anything but the clauses above — never a throw: a caller asking where the clock stands
 * gets an answer, not an exception it has to invent a meaning for.
 */
export async function readHealCycle(): Promise<HealCycle> {
  return parseHealCycle(await readFlagText(HEAL_CYCLE_PATH));
}

/**
 * The one line the flag gets, from the position the server was asked to set: `off`, or `on <hour>`.
 * The hour is written EXACTLY as given — nothing here clamps it — because the door
 * (`settings.service.ts`) is what refuses an hour outside 0..23, and a writer that quietly rounded
 * one would put a time in the file nobody pressed.
 */
export function formatHealCycle(state: HealCycle): string {
  return state.enabled ? `${ON_WORD} ${state.hour}` : OFF_WORD;
}

/** The schedule, written: one line, atomically, through the family's own writer. */
export async function writeHealCycle(state: HealCycle): Promise<void> {
  await writeFlag(HEAL_CYCLE_PATH, `${formatHealCycle(state)}\n`);
}
