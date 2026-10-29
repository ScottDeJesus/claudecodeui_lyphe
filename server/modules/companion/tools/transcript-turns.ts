import { describeToolCall } from '@/shared/tool-call-hint.js';
import type { NormalizedMessage } from '@/shared/types.js';

/**
 * How a chat's history rows become TURNS: one turn opens at his text message and holds every reply row until his next.
 * Split from `transcript-render.ts` by cohesion — this file knows what a turn is and which turns a question is about,
 * that one writes turns to a file and asks a dactyl about it. A window of turns (the last ten, the ones that mention a
 * phrase) is chosen here, numbered as the chat numbers them, and written by `renderTurnWindow`.
 * Consumers: `transcript-render.ts` (`renderTurns` groups and renders) and `read-tools.ts` (`read_session` picks the
 * turns a scope is about).
 */

/** The reply's parts in order: the words it wrote, and each tool call as the one line it is described by. */
type ReplyPart = { kind: 'text'; text: string } | { kind: 'call'; line: string };

/** One turn on its way to the file: his message, then what the reply said and did, in order. Consumed by `read-tools.ts`, which picks turns and has them rendered. */
export type Turn = {
  at: string | null;
  /** `null` when the rows begin mid-turn (a page of history cut before his message). */
  said: string | null;
  reply: ReplyPart[];
  calls: number;
};

/** A transcript's text as one safe block: CRLF folded to LF, NUL dropped (the dactyl refuses a file with one as binary). */
const cleanText = (text: string): string => text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();

/** A row's time as `YYYY-MM-DD HH:MM UTC`, or `null` when the row carries none that parses. */
function stampOf(timestamp: string | undefined): string | null {
  const parsed = timestamp ? new Date(timestamp) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC` : null;
}

/** The opening of the notice the CLI injects as a "user" row when a background command finishes: its words, not his. */
const BACKGROUND_NOTICE_PREFIX = '<task-notification>';

/**
 * Groups rows into turns: one opens at his text message and holds every reply row until the next (other kinds are
 * neither said nor done). A background-task notice is no message of his: it joins the turn it belongs to, labelled,
 * so the turns counted are his messages and a digest never reads it as his words.
 * Consumers: `transcript-render.ts` (`renderTurns`) and `read-tools.ts`.
 */
export function groupTurns(rows: NormalizedMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  const turnFor = (row: NormalizedMessage): Turn => {
    if (current === null) {
      current = { at: stampOf(row.timestamp), said: null, reply: [], calls: 0 };
      turns.push(current);
    }
    return current;
  };

  for (const row of rows) {
    const notice = row.kind === 'text' && row.role === 'user' && (row.content ?? '').trimStart().startsWith(BACKGROUND_NOTICE_PREFIX);
    if (row.kind === 'text' && row.role === 'user' && !notice) {
      current = { at: stampOf(row.timestamp), said: cleanText(row.content ?? ''), reply: [], calls: 0 };
      turns.push(current);
    } else if (row.kind === 'text' && (row.role === 'assistant' || notice)) {
      const text = cleanText(row.content ?? '');
      if (!text) continue;
      const label = notice ? '(a background task notice, not his words)\n' : row.isCompactSummary === true ? '(the conversation was compacted here; its summary)\n' : '';
      const turn = turnFor(row);
      turn.reply.push({ kind: 'text', text: label + text });
    } else if (row.kind === 'tool_use') {
      const turn = turnFor(row);
      turn.reply.push({ kind: 'call', line: describeToolCall(row.toolName ?? 'tool', row.toolInput) });
      turn.calls += 1;
    }
  }
  return turns;
}

/** The reply in order: a blank line between blocks of text, and a run of tool calls kept together, one per line. */
function replyBlocks(reply: ReplyPart[]): string {
  return reply.reduce((out, part, index) => {
    const joiner = index === 0 ? '' : part.kind === 'call' && reply[index - 1].kind === 'call' ? '\n' : '\n\n';
    return out + joiner + (part.kind === 'call' ? part.line : part.text);
  }, '');
}

/** One turn as markdown: a heading, what he said, the reply in order, and the count of tool calls. Consumer: `transcript-render.ts`. */
export function renderTurn(turn: Turn, number: number): string {
  const heading = turn.at ? `## Turn ${number} — ${turn.at}` : `## Turn ${number}`;
  const said = turn.said === null ? '(before this window)' : turn.said || '(no text — attachments only)';
  const reply = replyBlocks(turn.reply) || '(none)';
  return `${heading}\n\nHe said:\n${said}\n\nReply:\n${reply}\n\nTool calls: ${turn.calls}\n`;
}

/** The words a reply wrote, tool calls left out (they are counted, not read): the text of a short last reply, and what a length is measured on. Consumer: `read-tools.ts`. */
export function replyText(turn: Turn): string {
  return turn.reply.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('\n\n');
}

/** The most turns the `recent` scope renders. Consumer: `read-tools.ts`. */
export const RECENT_TURN_COUNT = 10;

/** Text folded for a phrase search: case and runs of whitespace carry no meaning in what someone typed or a model wrote. */
const foldedForSearch = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** What a turn says and does, for a phrase to be looked for in: his words, the reply's words and its tool-call lines — never the file's own headings. */
function searchableText(turn: Turn): string {
  return foldedForSearch([turn.said ?? '', ...turn.reply.map((part) => (part.kind === 'text' ? part.text : part.line))].join('\n'));
}

/**
 * The turns a phrase is about: every turn whose text holds it (case-insensitive, whitespace folded), with one turn
 * either side, in the order they were said, each once. Empty when no turn holds it, so the caller can say the
 * transcript does not mention it. Consumer: `read-tools.ts`, for the phrase scope of `read_session`.
 */
export function turnsAround(turns: Turn[], phrase: string): Turn[] {
  const wanted = foldedForSearch(phrase);
  if (wanted === '') return [];
  const keep = new Set<number>();
  turns.forEach((turn, index) => {
    if (!searchableText(turn).includes(wanted)) return;
    for (let near = Math.max(0, index - 1); near <= Math.min(turns.length - 1, index + 1); near += 1) keep.add(near);
  });
  return turns.filter((_, index) => keep.has(index));
}

/** One turn chosen for a window, with its place in the chat (1-based). Consumed by `transcript-render.ts` (`renderTurnWindow`) and `read-tools.ts`. */
export type NumberedTurn = { turn: Turn; number: number };

/** `picked` turns (a subset of `all`, in order) with the numbers the chat gives them, found by identity. Consumer: `read-tools.ts`. */
export function numberTurns(all: Turn[], picked: Turn[]): NumberedTurn[] {
  return picked.map((turn) => ({ turn, number: all.indexOf(turn) + 1 }));
}

/**
 * What one dactyl takes of a file, as `dactyl` weighs it (`refuse.PROMPT_MAX_BYTES`, 320 KiB): its UTF-8 bytes plus
 * 7 bytes of line number on every line. The budget here is under that gate with room for the brief and for the title and
 * gap lines, so a render that fits this is never refused for size. Consumers: `newestThatFit` here and `eyes/eyes-answer.ts`
 * (`wholeOrDigest`), which weighs a text the same way before it renders one to her scratch.
 */
export const DACTYL_WINDOW_BUDGET = 300_000;
/** The bytes the dactyl adds to every line it is handed (its line number). Consumers: `newestThatFit` here and `eyes/eyes-answer.ts`. */
export const LINE_NUMBER_BYTES = 7;

/**
 * The newest turns of `picked` that one dactyl can read together, and the turns too long for any reader. Turns are
 * taken from the newest back: one that is over the budget ALONE is set aside as `tooLong` (and the older ones are still
 * looked at), the others are added until the next would pass the budget, where it stops — whatever is older than that is
 * left out for room. `fitted` is empty only when every turn of `picked` is too long alone; the caller then says there
 * is no digest to give. A window that fits whole comes back whole. Both lists are in the chat's order.
 * Consumer: `read-tools.ts`.
 */
export function newestThatFit(picked: NumberedTurn[]): { fitted: NumberedTurn[]; tooLong: NumberedTurn[] } {
  const fitted: NumberedTurn[] = [];
  const tooLong: NumberedTurn[] = [];
  let weight = 0;
  for (let at = picked.length - 1; at >= 0; at -= 1) {
    const text = renderTurn(picked[at].turn, picked[at].number);
    const own = Buffer.byteLength(text, 'utf8') + LINE_NUMBER_BYTES * text.split('\n').length;
    if (own > DACTYL_WINDOW_BUDGET) {
      tooLong.unshift(picked[at]);
    } else if (weight + own <= DACTYL_WINDOW_BUDGET) {
      weight += own;
      fitted.unshift(picked[at]);
    } else {
      break;
    }
  }
  return { fitted, tooLong };
}
