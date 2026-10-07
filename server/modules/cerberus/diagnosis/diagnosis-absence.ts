import { ABSENCE_PHRASES } from './diagnosis-prompt.js';
import { flatten } from './diagnosis-quotes.js';

/**
 * The evidence line that is not a line of a read: what the prompt tells the agent never to submit ("an empty read is not
 * evidence", spec §3) and what live runs still did: an empty answer filed as a finding, "zero approval-engine sweep entries
 * found", a paraphrase of a file, the check's own value, a line cut with `...` or with its time moved. MEASURED, not assumed:
 * INV-7177 holds the runs. A gate that measures a share of the line or a word list measures what the model avoids; an absence
 * has nothing to copy and an edited line is not a line of a read, so the gate asks what an evidence line IS.
 *
 * WHAT IS ACCEPTED. An evidence line IS one stretch of ONE line of ONE answer of a read that SUCCEEDED, copied verbatim (case
 * and the width of whitespace aside), at least `MIN_COPY` characters long, and nothing else: no label, no sentence of its own
 * before or after, no ellipsis in the middle. The punctuation at its two ends is let go (a quotation mark, a bracket, a dash, a
 * trailing `…` or `...` where the model cut a long line short): it carries no letter or digit. A line that is the quotation of
 * the prompt (the check's value, its recent results and the rules are Cerberus's words to the agent, not the node's), of a refusal,
 * of a splice of two lines, of a line with one figure moved, or of a read's line with a conclusion on the end, stands in no
 * answer line, and is refused. The same single rule holds an absence: "zero entries found" is in no read.
 *
 * WHAT IS NOT A SOURCE. The answers' own empty sentences are dropped before the line is compared (`EMPTY_ANSWERS`: the warden's
 * `(the file is empty)`, `(no line contains …)` and its two "(its first/last line runs past …)", the history's `Nothing recorded
 * since …` and its header over the lines, `0 loaded units listed`, `(no output)`) and any line that is only one of the prompt's own
 * `ABSENCE_PHRASES` (`-- No entries --`). The warden's strings live in `warden/src/diag-reads.mjs` and `diag-argv.mjs` and the
 * history's in `diagnosis-history.ts`; a read that gains a new empty sentence is added here.
 *
 * WHAT THE LINE MEANS is the operator's to judge on the sheet; this holds that it IS a line of a read. The quotation gate
 * (`diagnosis-quotes.ts`) still runs on the same submission and holds every quoted piece to the reads or the prompt, and the
 * summary is outside both (a semantic pass would hold it; no lexical gate does).
 *
 * Consumers: `diagnosis-deps.ts`, whose `submit` refuses a submission with such a line, so the agent hears which and
 * submits again with each line copied from a read or left out.
 */

/** The phrases as whole words: `no errors` is not found inside "piano errors". Global, because a line is stripped of every one. */
const ABSENCE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ABSENCE_PHRASES.join('|')})(?![\\p{L}\\p{N}])`, 'gu');

/** What a read, or Cerberus around it, answers for "nothing to show" or "nothing shown", as they stand once flattened (`flatten` lower-cases). */
const EMPTY_ANSWERS: readonly RegExp[] = [
  /^\(the file is empty\)/,
  /^\(no line contains /,
  /^\(its (?:first|last|first stderr) line runs past /,
  /^\(no output\)/,
  /^nothing recorded since /,
  /^\d+ line\(s\) since .*newest first/,
  /^0 loaded units listed/,
];

/** An answer line this short is a word or two, which many a read holds: it is no finding to cite. */
const MIN_COPY = 20;

/** How many letters and digits an answer line keeps, once the absence phrases go, to say something. */
const MIN_REMAINING = 8;

const saysNothing = (flatLine: string): boolean =>
  EMPTY_ANSWERS.some((empty) => empty.test(flatLine)) || flatLine.replace(ABSENCE, ' ').replace(/[^\p{L}\p{N}]+/gu, '').length < MIN_REMAINING;

/**
 * The lines of the reads' answers that say something, flattened and joined by newlines. An evidence line is flattened to ONE line
 * (every run of whitespace, a newline included, becomes a space), so a stretch of it that stands in this text stands inside one line.
 */
const sourceOf = (answers: readonly string[]): string =>
  answers
    .flatMap((answer) => answer.split('\n'))
    .map(flatten)
    .filter((flatLine) => !saysNothing(flatLine))
    .join('\n');

/** The line without the punctuation at its two ends: what is compared. */
const withoutEdgePunctuation = (line: string): string => flatten(line).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** The longest an unquoting line is spelled in the refusal. */
const SHOWN_LIMIT = 120;

/** The lines of `evidence` that are not one stretch of one line of an answer of a read that succeeded, in order. */
export function unquotedLines(evidence: readonly string[], answers: readonly string[]): string[] {
  const source = sourceOf(answers);
  return evidence.filter((line) => {
    const stretch = withoutEdgePunctuation(line);
    return stretch.length < MIN_COPY || !source.includes(stretch);
  });
}

/** The sentence the agent reads when `submit_diagnosis` is refused for `lines`, with what to do about it. */
export function unquotedSentence(lines: readonly string[]): string {
  const shown = lines.map((line) => `“${line.length > SHOWN_LIMIT ? `${line.slice(0, SHOWN_LIMIT)}…` : line}”`).join(', ');
  return (
    `these evidence lines are not a line of a read: ${shown}. An evidence line is ONE line of ONE answer (a journal line, a line of a file, a status line, a history line) ` +
    `copied character for character, at least ${MIN_COPY} characters of it, and NOTHING else: no label, no sentence of your own before or after, no "..." in the middle, no time or figure changed, two lines never joined. ` +
    'It may stop short of the end of a long line. The answer\'s own empty sentences ("-- No entries --", "Nothing recorded since…", "the file is empty", "no line contains…", "(no output)"), ' +
    'the check\'s value and anything in this prompt are not reads. A claim you can state only in your own words, or that something was not there, has nothing to copy: say it in the summary, not here. ' +
    'Copy the lines that show what is wrong, or leave the claim out; if nothing else explains the check, submit an empty evidence list with proposal: null'
  );
}
