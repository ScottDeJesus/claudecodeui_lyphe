import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The plan runner's HOST-WIDE swarm switch, as a file.
 *
 * The runner's `swarm.read()` parses this exact path at every spawn that decides a phase
 * (`~/.claude/hooks/plan_runner/swarm.py`), so a flip here reaches the next phase boundary with
 * nothing restarted on either side. It is deliberately not a row in `auth.db`: the runner is a
 * separate daemon that must be able to read the switch from cron, with no database and no HTTP.
 *
 * The file holds ONE line and it is the whole contract between the two languages:
 *
 *   `off`      the swarm is off; the runner walks one phase at a time
 *   `on`       on, at NO CEILING: every phase the independence rule frees runs at once
 *   `on <N>`   on, with a ceiling of N lanes — any positive integer, honoured as written
 *
 * `swarm.read()` accepts the bare on word, or the on word and a positive decimal count separated
 * by whitespace, and reads everything else — absent, unreadable, `ON`, `off`, `on 0`, `on -1`,
 * `on x`, empty — as off at one lane. The two grammars are the same contract written twice in two
 * languages, which is why the parse below is written to agree with it clause for clause rather
 * than to be lenient: a reader that accepted `on3`, or a writer that emitted it, would leave the
 * operator pressing a switch the runner does not see move.
 *
 * NOTHING HERE CLAMPS. A count is a ceiling the operator chose, so it is read back exactly as
 * written and written exactly as given; the runner stopped narrowing against a house number on
 * 2026-09-21 (operator: "can we just have an uncapped phases as the default"), and a reader that
 * still clamped would draw a lane count the walk is not honouring.
 *
 * The runner's reader is the more lenient half on the SPACE between the two words — it is
 * `text.split()`, so `on  3`, `on\t3` and `on\x1c3` are three lanes to it. This side splits the
 * same way rather than insisting on the one space the writer emits, because the direction that
 * costs is a row drawn OFF for a swarm that is running. The one place the two still differ is a
 * count written in non-ASCII decimal digits; see `parse` below.
 */
const SWITCH_PATH = path.join(os.homedir(), '.claude', 'state', 'swarm.flag');

/**
 * The runner's own bound on the file (`swarm.MAX_BYTES`). Kept identical so both readers answer
 * the same question: a file past this is OFF here exactly as it is there, rather than being
 * truncated to a prefix that could read `on` when the whole file does not.
 */
const FLAG_MAX_BYTES = 256;

/**
 * The floor a written ceiling is held to: a switch that is on runs at least one phase, and
 * `on 0` is not on at all — so a count that is not positive is written as one lane rather than
 * as a line the runner would read as OFF. There is no ceiling above it: a count goes into the
 * file as the operator gave it.
 */
const LANES_MIN = 1;

/**
 * The trim `String.trim()` does not do, added so this reader and the runner's agree.
 *
 * `trim()` and Python's `str.strip()` are different sets, measured diverging in both directions:
 * `strip()` drops the C0 separators `\x1c`–`\x1f`, which `trim()` keeps (closed here); `trim()`
 * drops the UTF-8 BOM, which `strip()` keeps (closed there, by reading the file as `utf-8-sig`).
 * `\s` already covers the BOM, every ASCII space and NBSP, all of which the two sides already
 * agreed on. `\u0085` (NEL) is the one whitespace character the two sides disagree about —
 * Python's `str.strip()` and `str.split()` both take it for whitespace and JavaScript's `\s` does
 * not — so it is named here and in the split below. The separators are written as ESCAPES rather
 * than as the bytes themselves: a literal control character in a source file is invisible, and a
 * class that silently loses them reads a flag exactly as before right up until the byte is
 * dropped by an editor.
 */
const FLAG_TRIM = /^[\s\x1c-\x1f\u0085]+|[\s\x1c-\x1f\u0085]+$/g;

/**
 * Whitespace between the on word and the count, ONE OR MORE and not the ASCII space alone: the
 * runner splits the line on Python's `str.isspace()` set, so `on  3`, `on\t3` and `on\x1c3` are
 * three lanes to it. That set is `\s` plus the C0 separators plus NEL, which is exactly the class
 * `FLAG_TRIM` uses — the file is trimmed by the same rule that splits it. The writer emits exactly
 * one space; this is the reader agreeing with the runner rather than with the writer.
 */
const BETWEEN_WORDS = /[\s\x1c-\x1f\u0085]+/;

/**
 * A count, as Python's `str.isdecimal()` tests one: every Unicode decimal digit and nothing else,
 * which is why `+3`, `3.0` and `3 ` are not counts on either side. Written as the Unicode property
 * rather than as `\d`, which is ASCII alone.
 */
const DECIMAL_RUN = /^\p{Nd}+$/u;

/** The on word, whole: what a file says when it asks for a swarm at the runner's default count. */
const ON_WORD = 'on';

/** What the switch is set to: the predicate the runner acts on, and the ceiling it may run under. */
export type SwarmSwitch = { enabled: boolean; lanes: number | null };

/**
 * Off, and the count the runner uses when it is off: one lane, which is the serial walk. The
 * ceiling is `null`, not 1, because off is a file with no count in it at all — 1 is what the
 * runner DOES, not what the switch says, and a row that read the off word as "ceiling 1" would
 * write `on 1` on its next press and turn the operator's uncapped default into a swarm of one.
 */
function off(): SwarmSwitch {
  return { enabled: false, lanes: null };
}

/**
 * The one parse of the file's trimmed content, agreeing clause for clause with `swarm.read()`.
 *
 * `on 0` is deliberately NOT on: the runner reads a zero count as malformed and stays serial, and a
 * reader here that treated it as on would draw the switch on for the whole walk it does not move.
 * A count is otherwise taken as written, at ANY size — the runner clamps nothing, so neither does
 * this, and a file that asks for nine lanes reads back as nine lanes.
 */
function parse(content: string): SwarmSwitch {
  // A bare `on`: on, and NO ceiling — every phase the independence rule frees runs at once.
  if (content === ON_WORD) return { enabled: true, lanes: null };
  const parts = content.split(BETWEEN_WORDS);
  // Not two words, or not the on word first, or a second word that is not a count — `on3` is ONE
  // word to the runner and off to it, so the split is what decides, not a prefix match.
  if (parts.length !== 2 || parts[0] !== ON_WORD || !DECIMAL_RUN.test(parts[1])) return off();
  const digits = parts[1];
  // Digits outside ASCII are a count the runner reads as its own value and this reader cannot
  // decode — there is no Unicode digit table here, and writing one for a file no writer in this
  // house can produce is not worth the code. The SWITCH still must not be read wrong (the runner
  // answers on, so this answers on), but the COUNT is answered FAIL-CLOSED, at one lane: it is the
  // direction the runner's own parse takes for a flag it cannot read (`swarm.py`), and the row's
  // next write would otherwise raise a hand-edited file's real count to a ceiling it never said.
  if (!/^\d+$/.test(digits)) return { enabled: true, lanes: LANES_MIN };
  const lanes = Number.parseInt(digits, 10);
  // A long digit run parses to Infinity here as it parses to an arbitrary-precision int in Python;
  // the runner honours that int exactly, and this reader answers the ceiling it can prove — the
  // SWITCH is still on either way, and `Number.isSafeInteger` is the line where the two stop
  // agreeing about the number. A count that is not positive is off on both sides.
  if (lanes < LANES_MIN) return off();
  return { enabled: true, lanes: Number.isSafeInteger(lanes) ? lanes : LANES_MIN };
}

/**
 * The switch, read. OFF in every case the file cannot be trusted: not there, larger than the bound,
 * or holding anything but the two words above. An absent file is `false`, never a throw — a caller
 * asking whether the switch is set gets an answer, not an exception it has to invent a meaning for.
 */
export async function readSwarmSwitch(): Promise<SwarmSwitch> {
  try {
    if ((await stat(SWITCH_PATH)).size > FLAG_MAX_BYTES) return off();
    return parse((await readFile(SWITCH_PATH, 'utf8')).replace(FLAG_TRIM, ''));
  } catch {
    return off();                 // absent or unreadable is OFF, never an error to the caller
  }
}

/**
 * The one line the file gets, from the position this server was asked to set.
 *
 * `null` is NO CEILING and writes the bare on word — the uncapped default, and the whole reason
 * `lanes` is optional at the API. A number writes `on <N>`, floored at one lane so a zero or a
 * negative can never become `on 0`, which the runner reads as OFF: a switch the operator turned
 * ON must never leave this function as a file that says off. A count that is not a finite number
 * has no digits to write at all and falls to the same uncapped default the absent case uses.
 */
function content(enabled: boolean, lanes: number | null): string {
  if (!enabled) return 'off\n';
  if (lanes === null || !Number.isFinite(lanes)) return 'on\n';
  return `on ${Math.max(LANES_MIN, Math.trunc(lanes))}\n`;
}

/**
 * The switch, written, through a scratch file and a rename.
 *
 * Another process reads this file while this one writes it, and a plain `writeFile` is a truncate
 * followed by a write — a reader landing between the two sees an empty file, which reads OFF, a
 * phantom flip in the log of a run nobody flipped anything on. `rename` inside one directory is
 * atomic, so a reader sees only the old content or the new.
 *
 * The scratch name carries a UUID, not just the pid: `writeFile` yields, so two concurrent PUTs in
 * ONE node process interleave on a single per-process scratch path — A writes it, B writes it, A
 * renames it away, and B's rename finds nothing. The rename is atomic with respect to its
 * DESTINATION; it is the source that has to be unique.
 *
 * The destination is resolved through any symlink first: `rename` onto a symlink REPLACES the link
 * with a regular file, so a flag the operator had symlinked elsewhere would silently stop being
 * shared after the first toggle. And a scratch file outlives a failed rename unless something
 * removes it, so the `finally` does.
 *
 * Turning the switch off writes the OFF WORD rather than deleting the file or truncating it: the
 * runner reads an absent file as off too, but a file that is there and says so is the one an
 * operator can look at, and a reader arriving mid-write never sees the missing-file case.
 */
export async function writeSwarmSwitch(enabled: boolean, lanes: number | null): Promise<void> {
  const body = content(enabled, lanes);
  await mkdir(path.dirname(SWITCH_PATH), { recursive: true });
  // `realpath` throws when the flag does not exist yet, which is not an error: there is no link to
  // follow, and the literal path is the right destination.
  const destination = await realpath(SWITCH_PATH).catch(() => SWITCH_PATH);
  const scratch = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(scratch, body, 'utf8');
    await rename(scratch, destination);
  } finally {
    // Only still in place when the rename failed; a successful rename moved it, and that ENOENT
    // is swallowed.
    await unlink(scratch).catch(() => undefined);
  }
}
