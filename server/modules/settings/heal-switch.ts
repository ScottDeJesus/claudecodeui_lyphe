import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The heal reflex's own two switches, as files: the MASTER, and the daily CAP.
 *
 * The reflex's worker parses these exact paths at every ending (`scripts/heal_switches.py`, which
 * `scripts/heal_reflex_decide.py` reads through), so a flip here reaches the next ending with nothing
 * restarted on either side. They are deliberately not rows in `auth.db`: the worker runs detached from
 * a hook, with no database and no HTTP.
 *
 *   `heal.flag`            THE MASTER, one word: `off` stops the reflex LAUNCHING anything — an ending
 *                          still indexes, and the typed `/heal` door is the operator's own hand and is
 *                          never gated by it. Absent, `on`, or anything else is ON, which is what the
 *                          file shipping absent means: today's behaviour, unchanged. Ships absent.
 *   `heal_daily_cap.flag`  a plain decimal dollar amount. Absent, unreadable or non-finite is NO
 *                          CEILING, which is what the file shipping absent means. Ships absent.
 *                          THE CAP COUNTS DEEPSEEK DOLLARS ONLY: Claude is the operator's own
 *                          subscription (no cap, no dollar figure, no warning), so the worker sums
 *                          the day's heals that ran on DeepSeek and nothing else.
 *
 * The reflex's other two switches are flag files too, and live in modules of their own because they
 * are not about the reflex's own behaviour — they change for different reasons: `heal_model.flag`
 * (`heal-model-switch.ts`) names the model a heal's souls run on, a routing fact about the chain it
 * forks, and `heal_cycle.flag` (`heal-cycle-switch.ts`) is the CLOCK the maintenance cycle opens on.
 * All four read and write through the two primitives below.
 *
 * The grammars here are contracts written twice in two languages, which is why the parses below
 * are written to agree with the Python clause for clause rather than to be lenient: a reader that
 * accepted `1_000`, or a writer that emitted it, would leave the operator pressing a switch the
 * worker does not see move. THE MASTER FAILS THE OTHER WAY FROM ITS NEIGHBOURS, deliberately —
 * only its exact word `off` stops anything, because its default IS the shipped behaviour, while a
 * cap whose reader cannot trust a file must never be invented as a ceiling. A flag that cannot be
 * read must never be the thing that disarms a reflex that is running.
 *
 * NOTHING HERE CLAMPS a cap the operator could mean. It is a ceiling he chose, so it is read back
 * exactly as written, zero included — and zero is a ceiling that BITES: the worker parks on
 * `spend >= cap`, so a cap of zero is already reached and bars every heal until local midnight,
 * which is why the reader below takes an empty flag for no-ceiling rather than for zero.
 * The one amount the writer will not put in the file is a negative, which the worker's own gate
 * (`cap >= 0`) reads as NO CEILING — so it is written as the no-ceiling line rather than as a zero the
 * operator never asked for.
 */
const MASTER_PATH = path.join(os.homedir(), '.claude', 'state', 'heal.flag');
const CAP_PATH = path.join(os.homedir(), '.claude', 'state', 'heal_daily_cap.flag');

/**
 * The worker's own bound on a flag file (`decide.MAX_FLAG_BYTES`). Kept identical so both readers
 * answer the same question: a file past this is not a flag on either side, rather than being
 * truncated to a prefix that could read `on` when the whole file does not.
 */
const FLAG_MAX_BYTES = 256;

/**
 * The ONE whitespace class Python has, spelled out rather than written as `\s`.
 *
 * `\s` is neither side's set: it is MISSING the C0 separators `\x1c`-`\x1f` and NEL `\u0085`,
 * which `str.strip()` and `str.split()` both take, and it CARRIES `\uFEFF`, which they do not —
 * Python keeps a BOM except the SINGLE LEADING one its `utf-8-sig` decode takes off first (the
 * reader below does that too). Measured on both real readers before this was spelled out: a flag
 * holding `off\uFEFF` read OFF here and ON in the worker, which is the row drawing the reflex off
 * while the reflex launched — the one failure this contract exists to prevent, on the switch whose
 * whole job is stopping one. A class built from `\s` cannot express that difference, so the code
 * points are named: tab, LF, VT, FF, CR, the four C0 separators, space, NEL, NBSP, OGHAM SPACE
 * MARK, the EN QUAD-HAIR SPACE run, LINE and PARAGRAPH SEPARATOR, NARROW NO-BREAK SPACE, MEDIUM
 * MATHEMATICAL SPACE, IDEOGRAPHIC SPACE — Python's `str.isspace()` set and nothing else.
 *
 * The separators are escapes rather than the bytes themselves: a literal control character in a
 * source file is invisible, and a class that silently loses them reads a flag exactly as before
 * right up until the byte is dropped by an editor.
 *
 * Exported for the family's clock (`heal-cycle-switch.ts`), whose split and trim are this same set:
 * a second copy of the class is a second thing to keep in step with the Python twin that shares it.
 */
export const PY_SPACE =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

/** Python's `str.strip()`, both ends — the class above and nothing added to it. */
const FLAG_TRIM = new RegExp(`^(?:[${PY_SPACE}]+)|(?:[${PY_SPACE}]+)$`, 'g');

/** The ONE leading BOM a `utf-8-sig` decode takes off on the Python side, taken off here too so a
 * file an editor glued one to reads the same on both sides of the contract. */
const LEADING_BOM = /^\uFEFF/;

/**
 * What a decimal dollar amount looks like, in the ASCII form Python's `float()` accepts too. The
 * Python is the more lenient half on two inputs a writer in this house cannot produce —
 * digit-grouping underscores (`1_000`, which it reads as a thousand) and the case-insensitive
 * `inf` / `nan` words (which its finite check then refuses) — so a hand-typed outlier can read as a
 * ceiling there and as no-ceiling here. The writer below never emits either, and anything else that
 * is not a decimal reads as no ceiling on both sides.
 */
const DOLLARS = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** The master's one word: the whole of what stops the reflex launching. */
const MASTER_OFF = 'off';

/**
 * The master switch, read: MAY the reflex LAUNCH from the next ending onwards?
 *
 * `true` in every case but the exact word `off` — absent, unreadable, oversized, `on`, `ON`, a typo.
 * That is the shipped behaviour (the file ships absent, and absent has always meant on), and it is the
 * reason the master is the one switch here that does not fail closed: a file this reader cannot trust
 * must not be the thing that silently stops the reflex, and the operator's word for stopping it is one
 * he types deliberately.
 */
export async function readHealMaster(): Promise<boolean> {
  const text = await readFlagText(MASTER_PATH);
  return text === null || text !== MASTER_OFF;
}

/**
 * The ceiling, read. `null` in every case it cannot be trusted — absent, unreadable, oversized, not
 * a decimal, or not a finite number — because `null` is NO CEILING on both sides of this contract,
 * and a budget that cannot be read must never be the reason a control looks like it works while
 * doing nothing.
 */
export async function readHealCap(): Promise<number | null> {
  const text = await readFlagText(CAP_PATH);
  // Emptiness is checked first, and by hand: `Number('')` is 0, and the worker parks on
  // `spend >= cap` — so a zero read out of an empty flag would bar every heal until the next local
  // midnight. It is the one reading of an empty flag that would hurt.
  if (text === null || !text || !DOLLARS.test(text)) return null;
  const usd = Number(text);
  return Number.isFinite(usd) ? usd : null;
}

/**
 * A flag file's own text, as BOTH languages take it: at most `FLAG_MAX_BYTES` of it, ONE leading
 * BOM off — exactly what a `utf-8-sig` decode takes off on the Python side before its `strip()`
 * runs — then trimmed with `FLAG_TRIM`, which is that side's own `str.strip()` set and nothing else.
 *
 * `null` is "not this reader's to trust": not there, unreadable, or past the bound. Each caller
 * answers it in its own direction — the master ON, the cap NO CEILING — which is why this reads and
 * decides nothing. Exported because the family's other two switches read through it too
 * (`heal-model-switch.ts`, `heal-cycle-switch.ts`): one bound, one BOM rule, one Python-space class
 * for every flag file here.
 */
export async function readFlagText(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > FLAG_MAX_BYTES) return null;
    return (await readFile(path, 'utf8')).replace(LEADING_BOM, '').replace(FLAG_TRIM, '');
  } catch {
    return null;                  // absent or unreadable is not an error to the caller
  }
}

/**
 * The one line the cap file gets. `null` is NO CEILING and writes the empty line rather than deleting
 * the file or truncating it: the worker reads an absent file as no ceiling too, but a file that is
 * there and says so is the one an operator can look at, and a reader arriving mid-write never sees
 * the missing-file case.
 *
 * A negative or non-finite amount takes that same line, because that is what the worker makes of one:
 * its gate is `cap >= 0`, so a negative file parks nothing at all. Writing a zero in its place — the
 * tighter of the two readings — would be the ONE value that bites: zero is a ceiling the day's spend
 * has already reached, and it bars every heal until local midnight. The door above refuses a negative
 * anyway, so this is the second fence under a path no caller in this house can reach.
 */
function capContent(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd) || usd < 0) return '\n';
  return `${usd}\n`;
}

/**
 * Write a flag file through a scratch file and a rename.
 *
 * Another process reads these files while this one writes them, and a plain `writeFile` is a
 * truncate followed by a write — a reader landing between the two sees an empty file, which reads as
 * the shipped default on every side (the master ON, no ceiling) and, for the two switches whose
 * grammar turns on a word, as a side nobody pressed: a phantom flip in the record of a reflex nobody
 * flipped anything on. `rename` inside one directory is atomic, so a reader sees only the old content
 * or the new.
 *
 * The scratch name carries a UUID, not just the pid: `writeFile` yields, so two concurrent PUTs in
 * ONE node process interleave on a single per-process scratch path — A writes it, B writes it, A
 * renames it away, and B's rename finds nothing. The rename is atomic with respect to its
 * DESTINATION; it is the source that has to be unique.
 *
 * The destination is resolved through any symlink first: `rename` onto a symlink REPLACES the link
 * with a regular file, so a flag the operator had symlinked elsewhere would silently stop being
 * shared after the first toggle. And a scratch file outlives a failed rename unless something
 * removes it, so the `finally` does. Exported for the same reason `readFlagText` is.
 */
export async function writeFlag(destinationPath: string, body: string): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  // `realpath` throws when the flag does not exist yet, which is not an error: there is no link to
  // follow, and the literal path is the right destination.
  const destination = await realpath(destinationPath).catch(() => destinationPath);
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

/**
 * The master, written: the one word `off`, or the `on` the reflex runs by default. Two words and no
 * count, which is why the toggle's own press is the whole write.
 */
export async function writeHealMaster(enabled: boolean): Promise<void> {
  await writeFlag(MASTER_PATH, enabled ? 'on\n' : 'off\n');
}

/** The cap, written. `null` clears it. */
export async function writeHealCap(usd: number | null): Promise<void> {
  await writeFlag(CAP_PATH, capContent(usd));
}
