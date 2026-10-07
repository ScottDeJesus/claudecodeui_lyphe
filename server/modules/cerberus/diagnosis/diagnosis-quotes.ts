/**
 * Whether the words a diagnosis puts between quotation marks were ever read: what makes "quote the line" a rule
 * center can hold the agent to rather than hope for (spec §3 — "Evidence is what was found, not what was assumed").
 *
 * WHY. The first live diagnosis (2026-10-07) listed `'[xactanalysis-poller] POLL ERROR [hot]:[read 8 of 16: 8 left]'`
 * as a journal line. The journal said `POLL ERROR [hot]:` and stopped; `[read 8 of 16: 8 left …]` was center's own
 * budget note, appended to that very answer (`diagnosis-tools.ts`), which the model read as the rest of the line. A
 * quotation is a claim that those characters exist in a read, and center holds every read, so center can look.
 *
 * WHAT COUNTS. A quotation is text between matching quotes — `'…'`, `"…"`, `“…”`, `‘…’` or backticks — whose opening
 * mark does not follow a letter or digit and whose closing mark is not followed by one, so an apostrophe inside a word
 * ("Cerberus's") opens nothing. It is held to the text the agent was shown as DATA: every answer a read returned (not the
 * notes center adds under them) and the system prompt (the check's value, its recent results, what it measures). Case
 * and the width of whitespace are not held against it; an ellipsis (`…`, `...`) inside a quotation splits it into the
 * pieces on either side, each of which must be there. A piece under `MIN_PIECE` characters is a token (`'ok'`, `'detect'`),
 * not a line, and is let go: the check is for invented lines, not for every word.
 *
 * It judges what was QUOTED and nothing else: a summary that reasons badly from true quotations, or words that
 * are invented and not in quotation marks, are not caught here. That is the prompt's to prevent (`diagnosis-prompt.ts`,
 * EVIDENCE), and the operator's to judge on the sheet. The refusal therefore never offers "take the marks off" as the
 * way out — it would teach the gate's one blind spot — and says to copy exactly or leave the claim out.
 *
 * Consumers: `diagnosis-absence.ts` (`flatten`) and `diagnosis-deps.ts`, whose `submit` refuses a submission, and `note` a finding, with a quotation no read
 * holds, so the agent hears which and tries again.
 */

/** A quoted piece shorter than this is a word, not a line. */
const MIN_PIECE = 8;

/** The marks that open a quotation, and the one that closes it. */
const CLOSERS: Readonly<Record<string, string>> = { "'": "'", '"': '"', '“': '”', '‘': '’', '`': '`' };

const isWordCharacter = (character: string | undefined): boolean => character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** Lower-cased, every run of whitespace one space: how a quotation and a read are compared (and `diagnosis-absence.ts` compares a line to a phrase). */
export const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The text between quotes in `line`, in order of appearance. */
function quotationsIn(line: string): string[] {
  const found: string[] = [];
  for (let open = 0; open < line.length; open += 1) {
    const closer = CLOSERS[line[open]];
    if (closer === undefined || isWordCharacter(line[open - 1])) continue;
    for (let close = open + 1; close < line.length; close += 1) {
      if (line[close] !== closer || isWordCharacter(line[close + 1])) continue;
      found.push(line.slice(open + 1, close));
      open = close;
      break;
    }
  }
  return found;
}

/** The pieces of a quotation that must each be in a read: split at an ellipsis, trimmed, the short ones dropped. */
function piecesOf(quotation: string): string[] {
  return quotation
    .split(/…|\.{3}/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= MIN_PIECE);
}

/**
 * The quoted pieces of `lines` that appear in none of `sources` — what the agent put in quotation marks that no read
 * returned. Empty when every quotation is real (or there are none).
 */
export function unreadQuotations(lines: readonly string[], sources: readonly string[]): string[] {
  const read = sources.map(flatten).join('\n');
  const unread: string[] = [];
  for (const line of lines) {
    for (const quotation of quotationsIn(line)) {
      for (const piece of piecesOf(quotation)) {
        if (!read.includes(flatten(piece)) && !unread.includes(piece)) unread.push(piece);
      }
    }
  }
  return unread;
}

/** The longest an unread quotation is spelled in the refusal: the agent needs to find it, not to read it twice. */
const SHOWN_LIMIT = 120;

/** The sentence the agent reads when `submit_diagnosis` is refused for `unread`, with what to do about it. */
export function unreadQuotationsSentence(unread: readonly string[]): string {
  const shown = unread.map((piece) => `“${piece.length > SHOWN_LIMIT ? `${piece.slice(0, SHOWN_LIMIT)}…` : piece}”`).join(', ');
  return (
    `these quoted words are in nothing a read returned: ${shown}. A quotation is copied character for character from ONE line of ONE answer — ` +
    'never two lines joined, never a note from Cerberus, never your own words in quotation marks. Copy it exactly from the answer, or leave that claim out'
  );
}
