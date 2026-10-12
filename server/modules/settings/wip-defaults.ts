import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppError, expandHome } from '@/shared/utils.js';

import { writeFlagText } from './deepseek-flash-switch.js';

/**
 * The dispatcher's two WIP DEFAULTS, as a file: how many of an epic's features may be in progress at
 * once, and how many tasks each of those features may run at once, for every epic that has no word of
 * its own. An epic's own numbers are set on its card; this is only what the rest start from.
 *
 * The dispatcher reads this exact path at every take-up (`hooks/dispatcher/wip.py`, `read_flag`), so a
 * press here reaches the next pass with nothing restarted on either side. It is deliberately not a row
 * in `auth.db`: the dispatcher is a separate daemon that must be able to read the defaults with no
 * database and no HTTP in the way. The settings row and the transport call under it live in
 * `src/modules/settings/hooks/useWipDefaults.ts` and `src/shared/api.ts`.
 *
 * The file holds TWO lines, and that is the whole contract between the two languages:
 *
 *   `features <N|all>`   feature WIP: features of one epic in progress at once
 *   `tasks <N|all>`      task WIP: tasks of one feature in flight at once
 *
 * `N` is a whole number from 1, and `all` is no limit. `read_flag` reads each line on its own: a line
 * that is not two tokens, or whose word is outside the grammar, is "that limit has no word" and reads
 * `DEFAULT_WORD`; a missing, unreadable, over-sized or non-text file reads two and two. This reader
 * answers the same for the same bytes, clause for clause (the decode, the line and word splits, the
 * first line for a key winning), so the row can never draw a number the dispatcher is not acting on.
 */
const DEFAULT_PATH = path.join(os.homedir(), '.claude', 'state', 'wip.flag');

/** What an absent or untrustworthy line reads, for either limit (`wip.DEFAULT_WORD`): two at a time. */
const DEFAULT_WORD = '2';

/** The word for no limit (`wip.ALL`). */
const NO_LIMIT_WORD = 'all';

/** The dispatcher's own bound on the file (`wip.MAX_BYTES`), kept identical so a file past it reads the defaults on both sides. */
const FLAG_MAX_BYTES = 256;

/**
 * The longest count token `spellWord` hands to `parseInt`: the digits of the largest count a word may
 * state (`wip.MAX_LIMIT`, 2**53 - 1, which is `Number.MAX_SAFE_INTEGER`). Past it this server's double
 * and the dispatcher's int stop agreeing about the number, and CloudCLI's own reader refuses the word.
 */
const MAX_COUNT_CHARS = String(Number.MAX_SAFE_INTEGER).length;

/**
 * Where Python's `str.split()` splits a line into words: exactly its `str.isspace()` set, spelled out
 * rather than written as `\s`. The two differ in both directions — Python takes the C0 separators
 * `\x1c`–`\x1f` and NEL as whitespace and JavaScript does not, and JavaScript's `\s` takes U+FEFF, which
 * Python does not (a stray BOM inside the file is part of a word there, so a line that begins with one
 * names a key the dispatcher does not know). Written as ESCAPES, because a literal control character in
 * a source file is invisible.
 */
const BETWEEN_WORDS = /[\t-\r \x1c-\x1f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

/** Where Python's `str.splitlines()` breaks the file into lines, which is wider than `\n`. */
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/;

/** What the two defaults are set to: each limit's canonical word, `'<N>'` or `'all'`. */
type WipDefaults = { features: string; tasks: string };

/**
 * The file's path, this call: `DISPATCHER_WIP_FLAG_PATH` when it is set, else the default — the
 * dispatcher's own seam (`wip.FLAG_ENV`), made absolute as its reader makes it, so a probe that points
 * the seam at a scratch file reaches the next read and a relative override names one file for the
 * daemon and this server alike.
 */
function wipFlagPath(): string {
  const override = process.env.DISPATCHER_WIP_FLAG_PATH;
  if (override) return path.resolve(expandHome(override));
  return DEFAULT_PATH;
}

/**
 * One word's canonical spelling — `all`, or a whole number from 1 to `Number.MAX_SAFE_INTEGER` with no
 * leading zeros — or `null` for anything else (`wip.spell`). ASCII digits alone, so the dispatcher, which
 * counts other scripts' digits as digits, and this server cannot disagree about a number; the raw length
 * is checked before the parse so a huge run is refused without being measured.
 */
function spellWord(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  if (text === NO_LIMIT_WORD) return NO_LIMIT_WORD;
  if (text.length > MAX_COUNT_CHARS || !/^[0-9]+$/.test(text)) return null;
  const count = Number.parseInt(text, 10);
  return count >= 1 && count <= Number.MAX_SAFE_INTEGER ? String(count) : null;
}

/**
 * The file's text as the dispatcher reads it, or `null` when it reads nothing: absent, unreadable,
 * past `FLAG_MAX_BYTES`, or not UTF-8. The decode is `fatal` because Python's raises on a bad byte and
 * reads the WHOLE file as empty, where a lenient decode would keep the lines before it. A leading BOM
 * is dropped by the decoder, as `utf-8-sig` drops it there.
 */
async function readFlagText(filePath: string): Promise<string | null> {
  try {
    if ((await stat(filePath)).size > FLAG_MAX_BYTES) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filePath));
  } catch {
    return null;
  }
}

/**
 * The defaults, read. Two in every case the file cannot be trusted, per limit; an absent file is two
 * and two, never a throw — a caller asking where the defaults stand gets an answer, not an exception.
 * A `Map`, not an object: a line may name any key, and `constructor` is a word an object already has.
 *
 * Used by `settings.service.ts` (`getWipDefaults`, behind `GET /wip`); `setWipDefaultsState` reads it
 * back after a write.
 */
export async function readWipDefaults(): Promise<WipDefaults> {
  const words = new Map<string, string>();
  const text = await readFlagText(wipFlagPath());
  for (const line of (text ?? '').split(LINE_BREAK)) {
    const tokens = line.split(BETWEEN_WORDS).filter((token) => token !== '');
    if (tokens.length !== 2) continue;
    const word = spellWord(tokens[1]);
    // The first line for a key wins, as in `read_flag`; a line that says nothing readable is skipped.
    if (word !== null && !words.has(tokens[0])) words.set(tokens[0], word);
  }
  return { features: words.get('features') ?? DEFAULT_WORD, tasks: words.get('tasks') ?? DEFAULT_WORD };
}

/**
 * Set both defaults, and answer with what the file reads back — never with the input, for the reason
 * every switch here does: this is a file another daemon reads, and the numbers the steppers draw
 * should be the ones on disk.
 *
 * REFUSED AT THE DOOR, before anything is written: either word missing, not a string, or outside the
 * grammar `spellWord` states. The 400 is the API's usual envelope (`AppError`). Both lines go out in
 * ONE write (`writeFlagText`, scratch file and rename), so a reader never sees one default new and the
 * other old, and the file is replaced whole — a line the dispatcher's reader would ignore does not
 * survive a press.
 *
 * Used by `settings.service.ts` (`setWipDefaults`, behind `PUT /wip`), which kicks the dispatcher
 * once this has written.
 */
export async function setWipDefaultsState(featuresInput: unknown, tasksInput: unknown): Promise<WipDefaults> {
  const features = spellWord(featuresInput);
  const tasks = spellWord(tasksInput);
  if (features === null || tasks === null) {
    throw new AppError(
      `features and tasks must each be "${NO_LIMIT_WORD}" or a whole number from 1 to ${Number.MAX_SAFE_INTEGER}`,
      { code: 'INVALID_WIP_DEFAULTS', statusCode: 400 },
    );
  }
  await writeFlagText(wipFlagPath(), `features ${features}\ntasks ${tasks}\n`);
  return readWipDefaults();
}
