/**
 * THE WORDS A MEMORY IS MADE OF, pure: no I/O, no import. `memory-verbs.ts` (her three tools and `clearMemory`) and `hands/action-doors.ts`
 * (the hands' `clear_memory`) build her bank's rows on these names.
 *
 * RULING 4: A MEMORY IS NEVER HER PARAPHRASE OF HIM. The server writes a memory's body from his log lines; she writes only its title and,
 * marked as hers, one line of context. So the body below is built here from lines of his, quoted whole, and nothing of hers can stand
 * as a quote of his: her context is folded onto one line behind its own label, so it can never begin a `He said (…)` or `He typed (…)` line.
 *
 * HIS WORDS ARE HIS LOGGED LINES, SPOKEN OR TYPED. A memory carries only a line of his: a `companion_log` row with role `operator` and via
 * `spoken` (a talk press, `companion-press.ts`) or `typed` (a line he typed on her panel, `companion.service.ts`), found by its exact text
 * with whitespace folded (`findHisLine`). Its quote names the channel: `He said (…)` for a press, `He typed (…)` for a typed line. A row of
 * hers, and a row with no `via`, is never his.
 *
 * `spoken` IS THE LOG'S WORD FOR A TALK PRESS AND ITS TRANSCRIPT, NOT PROOF OF SPEECH. The press door logs any clip longer than
 * `EMPTY_PRESS_UNDER_MS` as `spoken` with whatever the transcriber wrote: measured 2026-10-29, two seconds of digital silence came
 * back as "No.", and so would be found here as his line. So a spoken memory is "what his press was heard to say"; no doc or sentence built on
 * this module claims it proves he said it. A typed line is exactly what he typed.
 *
 * THE SAME SUBJECT is `SAME_SUBJECT_LOGIT`'s measurement, below: a net for a correction, not a guarantee. A memory whose quotes are
 * exactly the new one's is never kept twice (`quotesAlike`).
 */

/**
 * One line of his that a memory carries: the log row's id, its own ISO time, the channel it came by (`spoken`: a talk press's transcript;
 * `typed`: a line he typed on her panel) and its text as the log keeps it. Consumed by `memory-verbs.ts` and `hands/action-doors.ts`.
 */
export type HisLine = { id: number; at: string; via: 'spoken' | 'typed'; text: string };

/**
 * Why she keeps a memory: `asked` (he told her to), else her own judgment of a standing `ruling` or preference, a `name` he gives
 * something, something he told her is `stale`, or how he likes a `brief` written. Consumed by `memory-tools.ts` (the `why` argument) and `memory-verbs.ts`.
 */
export type KeptWhy = 'asked' | 'ruling' | 'name' | 'stale' | 'brief';

/**
 * The most characters a memory's body holds. Every memory reads whole in one answer, so none ever needs a dactyl (ruling 3). Her
 * remember refuses a longer body ("Too long to keep whole"); `memoryBody` writes what it is given. Consumed by `memory-verbs.ts`.
 */
export const MEMORY_BODY_MAX = 2_000;

/**
 * A held memory scoring this much or more against a new one is about the same thing (measured 2026-10-28: same 3.39-9.50, the nearest
 * different -0.23). The score is the reranker's logit, the one search applies to its rows (`bankDoor.search`'s `score`).
 *
 * WHY THE RERANKER AND NOT A COSINE. The docstore's own near-duplicate line (cosine 0.95, `docstore/neardup.py`) catches only a
 * restatement (0.995). A correction scores 0.74 to 0.90 by cosine, and no cosine line separates a correction (0.74) from a different
 * memory (0.705). On the pairs measured the reranker does separate them: the same memory corrected or restated scored 3.39 to 9.50, the
 * nearest different memory -0.23 and an unrelated one about -11. 1.5 stands in that gap.
 *
 * WHAT THE LINE CATCHES, AND WHAT IT DOES NOT. Those pairs shared the held memory's title and most of its words. The score is read on
 * the text `remember` searches with (`title` then his words), against the held body, so it falls with the title she picks: re-measured
 * 2026-10-29 on that shape, one correction ("Actually, no line limit on briefs, just keep them tight.") scored 4.25 under the held
 * title "Brief length" but 2.31, 1.59, 0.40 and -0.44 under four other titles, against -0.19 for the nearest different memory ("Brief
 * tone"); a terse correction ("Make it five lines instead.") scored -4.17. So a correction under another title, or in other words,
 * can score under the line and be kept beside the stale memory. The line is a net, not a guarantee: `corrects` (her prompt line) is
 * the cure, and no sentence built on this constant may say a correction is always stopped. Consumed by `memory-verbs.ts` (`remember`).
 */
export const SAME_SUBJECT_LOGIT = 1.5;

const ABSENT_REFUSAL = 'That is not a line of his. Give his whole line exactly as he said or typed it, start to finish, not a sentence out of it.';

/** The words of each judgment, after "Kept on her own judgment: ". */
const JUDGMENT: Record<Exclude<KeptWhy, 'asked'>, string> = {
  ruling: 'a standing ruling or preference of his',
  name: 'a name he gives something',
  stale: 'something he told her is stale',
  brief: 'how he likes a brief written',
};

/** A line as every comparison here reads it: trimmed, every run of whitespace one space It is also what keeps one quote on one line. */
const folded = (text: string): string => text.trim().replace(/\s+/g, ' ');

/**
 * His log line, spoken or typed, whose text equals `said` (whitespace folded); or the sentence refusing it. The match is the WHOLE row:
 * a talk press is logged as one row whose text is the whole transcript (`companion-press.ts`) and a typed line as one row of what he typed
 * (`companion.service.ts`), so `said` is a whole line and a sentence cut out of one is refused, which is why the refusal and her tool's
 * words say so. Rows are in the log's own shape and any order. When several rows match, across both channels, the newest (the greatest id)
 * is the line. A row of hers, a row with `via` null and a text matching no row of his are the one refusal, and so is a blank `said`, which
 * would otherwise equal the empty press's `''`. Consumed by `memory-verbs.ts` (remember, forget).
 */
export function findHisLine(
  said: string,
  rows: Array<{ id: number; at: string; role: string; via: string | null; text: string }>,
): { ok: true; line: HisLine } | { ok: false; sentence: string } {
  const wanted = folded(said);
  if (wanted === '') return { ok: false, sentence: ABSENT_REFUSAL };

  let newest: HisLine | null = null;
  for (const row of rows) {
    if (row.role !== 'operator' || (row.via !== 'spoken' && row.via !== 'typed') || folded(row.text) !== wanted) continue;
    if (newest === null || row.id > newest.id) newest = { id: row.id, at: row.at, via: row.via, text: row.text };
  }
  return newest === null ? { ok: false, sentence: ABSENT_REFUSAL } : { ok: true, line: newest };
}

/** The verb a quote names its channel by: a press is said, a typed line is typed. */
const QUOTE_VERB: Record<HisLine['via'], string> = { spoken: 'said', typed: 'typed' };

/**
 * One line of his as a memory quotes it: `He said (<account>, <at>): “<text>”` for a press, `He typed (<account>, <at>): “<text>”` for a typed
 * line, `<at>` the log row's own time and `<text>` his words with every run of whitespace folded to one space, so the quote is one line and
 * no word of his changes. It is a memory's quote in `memoryBody` and the reason a forget or a clear on his word gives the docstore.
 * Consumed by `memoryBody` below and by `memory-verbs.ts` (the reason of a retire).
 */
export function quoteLine(account: string, line: HisLine): string {
  return `He ${QUOTE_VERB[line.via]} (${account}, ${line.at}): “${folded(line.text)}”`;
}

/**
 * The body of a memory, its lines joined by newlines: one `He said (<account>, <at>): “<text>”` (`He typed (…)` for a typed line) per carried
 * line (`<at>` the log row's own time, `<text>` his words with every run of whitespace folded to one space, so each quote is one line and no
 * word of his changes),
 * `Context, in her words: <context>` when she gave one (folded to one line as well), then the reason line. Writes what it is given:
 * the length limit is the caller's (`MEMORY_BODY_MAX`). Consumed by `memory-verbs.ts` (remember).
 */
export function memoryBody(input: { account: string; lines: HisLine[]; why: KeptWhy; context: string | null }): string {
  const quotes = input.lines.map((line) => quoteLine(input.account, line));
  const context = input.context === null ? '' : folded(input.context);
  const reason = input.why === 'asked' ? 'Kept because he asked.' : `Kept on her own judgment: ${JUDGMENT[input.why]}.`;
  return [...quotes, ...(context === '' ? [] : [`Context, in her words: ${context}`]), reason].join('\n');
}

/**
 * A quote's line: `said` or `typed`, lazy account and time (a time holds no space), then the text from the first “ after `): ` to the line's last ”.
 * `quotesOf` trims the line and tests its last character before this runs, so a line that cannot be a quote is dropped in one step: without
 * that, a long line of `, x): “` runs and no closing mark made this regex rescan the line from every run (quadratic).
 */
const QUOTE_LINE = /^He (said|typed) \((.*?), (\S+?)\): “(.*)”$/;

/**
 * Every quote of a body, in order: the one parse of the `He said (…): “…”` and `He typed (…): “…”` lines that `firstQuote` and `quotesAlike`
 * read. A line that is not a quote (the context, the reason) is passed over. `via` is the channel the verb names (`said` is `spoken`,
 * `typed` is `typed`); `text` is as the body holds it. Consumed by `memory-verbs.ts` (recall reads the first quote's `via` and `at` for
 * `said <when>` or `typed <when>`) and by `bank-lines.ts`.
 */
export function quotesOf(body: string): Array<{ account: string; at: string; via: HisLine['via']; text: string }> {
  const quotes: Array<{ account: string; at: string; via: HisLine['via']; text: string }> = [];
  for (const rawLine of body.split('\n')) {
    // A body that came back with CRLF endings, or a space outside the closing mark, still holds its quotes.
    const line = rawLine.trim();
    if (!line.endsWith('”')) continue;
    const found = QUOTE_LINE.exec(line);
    if (found) quotes.push({ account: found[2], at: found[3], via: found[1] === 'typed' ? 'typed' : 'spoken', text: found[4] });
  }
  return quotes;
}

/**
 * The words of the body's first quote, cut after `max` characters (never inside a surrogate pair) and ending "…" when it cut; whole when
 * `max` is not given. `null` for a body with no quote. Consumed by `memory-verbs.ts` (recall's lines and remember's answers).
 */
export function firstQuote(body: string, max?: number): string | null {
  const first = quotesOf(body)[0];
  if (first === undefined) return null;
  const characters = Array.from(first.text);
  if (max === undefined || characters.length <= max) return first.text;
  return `${characters.slice(0, max).join('').trimEnd()}…`;
}

/**
 * Whether two bodies quote the same words: the same quotes, as many, in the same order, each pair equal with whitespace folded (the
 * account, the time and the channel are not compared: the same words said twice, or once said and once typed, are the same words). A body with no quote has no words to be alike,
 * so it is alike to nothing. Two memories of the same words are never kept, so this is exact, never near. Consumed by `memory-verbs.ts` (remember).
 */
export function quotesAlike(a: string, b: string): boolean {
  const first = quotesOf(a);
  const second = quotesOf(b);
  if (first.length === 0 || first.length !== second.length) return false;
  return first.every((quote, index) => folded(quote.text) === folded(second[index].text));
}
