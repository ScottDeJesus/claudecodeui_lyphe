import type { CompanionMemoryLine, CompanionMemoryLines } from '@/shared/companion-types.js';

import { BANK_PAGE_ID, bankDoor, type BankRow } from './bank-door.js';
import { firstQuote, quotesOf } from './memory-words.js';

/**
 * HER MEMORY AS THE STATION'S CORNER DRAWS IT: each memory's kind, title, the moment he said it and his first words. It is read through
 * her door and through her words and nowhere else: `bankDoor.list` and `bankDoor.get` (MAN-9191) for the rows, `quotesOf` and `firstQuote`
 * (`memory-words.ts`) for what a body quotes. The page has no door to the docstore and parses no body, so this is the one place a body is
 * read for the corner.
 *
 * NOTHING OF HERS STANDS AS A QUOTE OF HIS (INV-10122). The moment (`saidAt`), the account and his words (`quote`) come from the body's
 * first `He said (<account>, <at>): “…”` line, parsed by `quotesOf`, and from nowhere else: her context line and her reason line are
 * not quotes and never reach a line. A memory whose body quotes no one has `null` for all three, and the view says so.
 *
 * ONE UNREADABLE MEMORY MAKES THE READING FAIL, WITH ITS SENTENCE. A list with a hole would show seven as six; so a `list` or a `get`
 * that is refused answers `count: null` and the door's own sentence as `reason`, as the full page does, and the view draws "—" with that
 * sentence beside it. Her door never throws, so a refusal is a sentence to carry. Nothing is cached: every call reads the bank.
 */

/** How many characters of his first words a line carries (`firstQuote` cuts after it and ends "…"); the view shows them whole. */
const QUOTE_CUT = 200;

/** A moment in a body is the log row's ISO time. A moment that does not parse (a row edited by hand) is no moment, so the contract's "ISO or `null`" holds. */
const parseableMoment = (at: string): boolean => Number.isFinite(Date.parse(at));

/** One memory as a line: its row's own title and kind, then the moment, the account and the words of its first quote, or `null` for all three when it quotes no one. */
function lineOf(row: BankRow): CompanionMemoryLine {
  const first = quotesOf(row.body)[0];
  if (first === undefined) return { token: row.token, title: row.title, kind: row.kind, saidAt: null, account: null, quote: null };
  return {
    token: row.token,
    title: row.title,
    kind: row.kind,
    saidAt: parseableMoment(first.at) ? first.at : null,
    account: first.account,
    quote: firstQuote(row.body, QUOTE_CUT),
  };
}

/** The time of a line's moment for ordering; a line with no moment sorts as the oldest possible, so it falls last. */
const momentOf = (line: CompanionMemoryLine): number => (line.saidAt === null ? Number.NEGATIVE_INFINITY : Date.parse(line.saidAt));

/** Newest said first, a memory with no moment last. `Array.prototype.sort` is stable, so equal moments keep the door's own order. */
function newestFirst(lines: CompanionMemoryLine[]): CompanionMemoryLine[] {
  return [...lines].sort((a, b) => {
    const [left, right] = [momentOf(a), momentOf(b)];
    return left === right ? 0 : right > left ? 1 : -1;
  });
}

/** A reading that could not be made: no count, the door's sentence, no lines. */
const unreadable = (sentence: string): CompanionMemoryLines => ({ count: null, pageId: BANK_PAGE_ID, reason: sentence, lines: [] });

/**
 * Her memory as lines, newest said first: the bank listed once, then every memory read whole at once (her door bounds each call at 10 s,
 * and her bank is small by design). A bank not made yet is `count: 0` and no lines; a refused `list` or `get` is `count: null` with the
 * sentence of the first refusal, in the bank's order. A memory forgotten between the `list` and its `get` is a change, not an unreadable
 * bank (a read that starts as a forget or Settings' clear is running): when a `get` is refused the bank is listed once more, and a refused
 * memory it no longer lists is dropped, while one it still lists stays a refusal. Never throws, and writes nothing: this is a read of her
 * bank, not one of her three verbs, so it runs outside `onBank`. Consumed by `memory.routes.ts`, behind `GET /api/companion/memory/lines`.
 */
export async function readMemoryLines(): Promise<CompanionMemoryLines> {
  const listed = await bankDoor.list();
  if (!listed.ok) return unreadable(listed.sentence);

  let read = await Promise.all(listed.value.map(async ({ token }) => ({ token, answer: await bankDoor.get(token) })));
  if (read.some(({ answer }) => !answer.ok)) {
    const again = await bankDoor.list();
    if (!again.ok) return unreadable(again.sentence);
    const stillListed = new Set(again.value.map((memory) => memory.token));
    read = read.filter(({ token, answer }) => answer.ok || stillListed.has(token));
  }
  const lines: CompanionMemoryLine[] = [];
  for (const { answer } of read) {
    if (!answer.ok) return unreadable(answer.sentence);
    lines.push(lineOf(answer.value));
  }
  return { count: lines.length, pageId: BANK_PAGE_ID, reason: null, lines: newestFirst(lines) };
}
