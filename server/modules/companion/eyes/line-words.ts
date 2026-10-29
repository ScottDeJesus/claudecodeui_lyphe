import { INLINE_MAX_CHARACTERS, LIST_MAX, moreLine, whenWords } from './eyes-answer.js';

/**
 * The small words every panel read of this folder's `panel-reads.ts` family writes its lines with: a stored text made one
 * line, and an epoch time said as he would say it. Strings in, strings out, no I/O.
 *
 * Why a text is MASKED before it is cut or handed over: a heal row's `detail`, a cron job's command, a note and a card's
 * description are stored text, and any can carry the shell line, the environment or the paste a credential rode in on. What
 * reaches her is read aloud, summarised and quoted, so a value that looks like a credential is replaced where it stands, and
 * only then is a line cut, so the cut can never leave half a secret behind. The patterns are the common three (a named secret and its value, an `Authorization`
 * value, a vendor key's own prefix); a text that matches none is passed as it is.
 */

/** A secret's name and the value after its `=` or `:`: `PASSWORD=hunter2`, `"api_key": "x"`, `AWS_SECRET_ACCESS_KEY=…`. The name stays, the value goes. */
const NAMED_SECRET = /((?:password|passwd|passphrase|secret|api[_-]?key|access[_-]?key|private[_-]?key|token)s?[A-Za-z0-9_.-]{0,40}["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi;

/** A `Bearer` or `Basic` credential of 16 or more characters. */
const AUTHORIZATION = /\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]{16,}/gi;

/**
 * A vendor key by its own prefix (`sk-…` / `sk_live_…`, `ghp_…`, a Slack `xox…`, a Google `AIza…`), 16 or more characters after it.
 * The `sk` prefix is only a key's when a dash or underscore follows it at once: a word that merely starts `sk` (`skipped_bad_id`,
 * `sketch-keeper`, the `-sk` in a plan's slug) is a name she is meant to say, not a secret.
 */
const VENDOR_KEY = /\b(?:sk[-_]|ghp|gho|xox[abp]|AIza)[-_A-Za-z0-9]{16,}/g;

/** What a masked value is replaced with. */
const MASKED = '<masked>';

/**
 * `text` with every credential-looking value replaced by `<masked>` and nothing else changed (its lines and spacing are kept).
 * Consumed by `clipLine` here and by the reads that hand a stored text over whole: a note and a card's description are
 * his own writing, and one of his notes opens with an API key, which she must not read aloud or leave in a transcript.
 */
export function maskCredentials(text: string): string {
  return text.replace(NAMED_SECRET, `$1${MASKED}`).replace(AUTHORIZATION, `$1$2${MASKED}`).replace(VENDOR_KEY, MASKED);
}

/**
 * `text` as one line of at most `max` characters (as a person counts them): credential-looking values masked first
 * (`maskCredentials`), every run of whitespace folded to one space, the ends trimmed, and a line that was cut ending "…". `max` is
 * a whole number of 2 or more. Consumed by the heal, schedule, kanban and notes reads, for every stored text they put in a line.
 */
export function clipLine(text: string, max: number): string {
  const folded = maskCredentials(text).replace(/\s+/g, ' ').trim();
  const characters = Array.from(folded);
  return characters.length <= max ? folded : `${characters.slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * Epoch SECONDS (the heal worker's clock) as he would say the time (`whenWords`: "today 14:02", "yesterday 09:10", "Oct 27"),
 * or "at an unknown time" for a value that is not a time. Consumed by the heal reads.
 */
export function epochWords(seconds: unknown): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 'at an unknown time';
  return whenWords(new Date(seconds * 1000).toISOString());
}

/** `n` with its noun in the right number: "1 note", "3 notes". Consumed by the panel reads' headings. */
export function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** What a list's lines may add up to: the inline limit less room for the heading and closing line a read puts around them. */
const LIST_LINES_BUDGET = INLINE_MAX_CHARACTERS - 250;

/**
 * `lines` as a list that is read whole: the first lines that fit both the line cap (`max`, 20 unless a read gives its own) and the
 * inline limit of 2,000 characters (`LIST_LINES_BUDGET`), one per line, then "And <k> more; give a phrase to narrow." for the rest.
 * A list stays whole this way rather than being handed to a dactyl, whose digest would drop the very fields a line carries.
 * `total` is how many items there are when the caller holds only the first page of them (a Kanban lane); it defaults to
 * `lines.length`. The first line is always shown. Consumed by every panel read of this family that answers a list.
 */
export function fitLines(lines: string[], options: { total?: number; max?: number } = {}): string {
  const total = Math.max(options.total ?? lines.length, lines.length);
  const shown = lines.slice(0, linesThatFit(lines, options.max ?? LIST_MAX, LIST_LINES_BUDGET));
  const left = total - shown.length;
  return left > 0 ? [...shown, moreLine(left)].join('\n') : shown.join('\n');
}

/**
 * How many of `lines` a list shows: at most `max`, and as many as add up (each with its line break) to at most `budget`
 * characters; the first line is always shown. `fitLines` uses it with the whole list's budget; an answer made of several lists
 * (the Kanban `board` overview) hands each list what the lists before it left, so together they stay inside the inline limit.
 * Consumed by `fitLines` here and by `kanban-reads.ts`.
 */
export function linesThatFit(lines: string[], max: number, budget: number): number {
  let used = 0;
  let count = 0;
  for (const line of lines) {
    const next = used + Array.from(line).length + 1;
    if (count >= max || (count > 0 && next > budget)) break;
    count += 1;
    used = next;
  }
  return count;
}
