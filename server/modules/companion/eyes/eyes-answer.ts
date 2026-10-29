import { writeFileSync } from 'node:fs';

import { textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { characterCount } from '../companion-input.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';
import { NOTE_TEXT_MAX, NOTE_TITLE_MAX } from '../tools/draft-tools.js';
import { companionScratchDir, nextScratchFile, pruneScratch, runDactylRead } from '../tools/transcript-render.js';
import { DACTYL_WINDOW_BUDGET, LINE_NUMBER_BYTES } from '../tools/transcript-turns.js';

import { parseStamp, shortDate } from './panel-words.js';

/**
 * THE EYES' SHARED SEAM. Every eyes tool (the roadmap, the runs, DocSpace, the alerts, the other panels and the
 * settings: `eyes/*-reads.ts`) answers through these functions, so every list is capped the same way, every
 * long answer is handed over the same way, and every time and door is said the same way.
 *
 * Her context does not hold the house until she looks (ruling 2: "use pointers and tools"), so an answer is small by
 * construction: a list is one line per item and capped; a read takes a scope; an answer of 2,000 characters or fewer
 * is handed over whole, and a longer one is rendered to the next numbered file of her scratch and answered by a
 * dactyl under the scope's fixed brief, with the file named so a sharper question can go to `ask_dactyl`. A dactyl
 * runs on Claude, never on Gemini. With `panel: true` the whole answer goes on his panel as a note instead.
 *
 * NEVER USAGE OR SPEND (ruling 1). These helpers take strings, never objects, so no renderer can dump a record into
 * them; every dactyl brief here ends `NO_SPEND`, and the callers cut cost lines out of what they render.
 *
 * The words are his panels' (`panel-words.ts`) and his clock's (`whenWords`: the box's local clock, in English only).
 * Consumers: the eyes' reads, each in its own phase: `roadmap-reads.ts`, `run-reads.ts`, `doc-reads.ts`,
 * `alert-reads.ts`, `panel-reads.ts` and `house-reads.ts` of this folder.
 */

//----------------- THE CAPS ------------

/** The most lines a list answers before it says how many it left out. Consumed by every eyes list (runs pass 15, pages 10 as their own `max`). */
export const LIST_MAX = 20;

/** An answer of this many characters or fewer is handed over whole; a longer one is digested. About 300 words: his "few hundred words". Consumed by `wholeOrDigest` and by the reads that decide how to render before they call it. */
export const INLINE_MAX_CHARACTERS = 2_000;

/** The sentence every dactyl brief of the eyes ends with: cost, tokens, usage and spend are never hers to say (ruling 1). Consumed by `wholeOrDigest`, which appends it to every brief. */
export const NO_SPEND = ' Say nothing of cost, tokens, usage or spend.';

// ---------------------------

//----------------- LISTS ------------

/**
 * `lines` as the answer of a list: the first `max` lines, one per line, then "And <k> more; give a phrase to narrow."
 * when any were cut. An empty list answers `''`, because "nothing here" is said in each tool's own sentence.
 * `max` is a whole number of 1 or more. Consumed by every eyes list.
 */
export function cappedLines(lines: string[], max: number = LIST_MAX): string {
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`cappedLines shows a whole number of lines, 1 or more; got ${max}.`);
  const shown = lines.slice(0, max);
  const left = lines.length - shown.length;
  return left > 0 ? [...shown, moreLine(left)].join('\n') : shown.join('\n');
}

/**
 * The closing line of a capped list, "And <k> more; give a phrase to narrow.", for `left` lines not shown (1 or more).
 * Consumed by `cappedLines` here, and by a list whose total is known without every line being held (a Kanban lane is read
 * one page at a time and counted by the board), which writes the same line for the number the board counted.
 */
export function moreLine(left: number): string {
  return `And ${left} more; give a phrase to narrow.`;
}

// ---------------------------

//----------------- WHOLE, OR A DACTYL'S DIGEST ------------

/** The longest file-name word a label becomes: the name is `0001-<word>.md` and a file name past 255 bytes cannot be written. */
const LABEL_WORD_MAX = 40;

/** A scratch label as a file-name word: lower case letters and digits, one dash between runs, at most 40 characters; never empty. */
const labelWord = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LABEL_WORD_MAX).replace(/-+$/, '') || 'read';

/** What one dactyl is handed of `content`, as it weighs it: its UTF-8 bytes plus a line number on every line (the same weighing `newestThatFit` does for a chat's turns). */
const dactylWeight = (content: string): number => Buffer.byteLength(content, 'utf8') + LINE_NUMBER_BYTES * content.split('\n').length;

/** The last words of every digest and of a failed one: where the full text is, so a sharper question can go to a dactyl. */
const renderedAt = (file: string): string => `The full text is rendered at ${file}; ask_dactyl can read that file for a sharper question.`;

/**
 * The answer `text` as it is: after `intro`, whole when it is at most `INLINE_MAX_CHARACTERS` (counted as a person counts
 * them, `characterCount`). A longer one is written, with a closing newline, to the next numbered file of her scratch folder
 * (`0007-<label>.md`) and the folder is pruned to its newest 20; the answer is then `intro`, one dactyl's digest of the file under
 * `brief` + `NO_SPEND` (its `L<n>` are lines of that file), and the file named last. A dactyl that fails answers its own
 * sentence as a refusal, with the file still named: the render is not lost. `signal` stops the dactyl with the call.
 * A text past what one dactyl takes (`DACTYL_WINDOW_BUDGET`) is never rendered or sent: the answer is one refusal that says it is
 * more than one reader takes and to give a phrase or a narrower scope, because the dactyl's own size refusal speaks of tokens and
 * `ask_dactyl` on that file would meet the same gate.
 * `label` is a plain word naming the kind of read; it is made a safe file-name word here. Consumed by every eyes read that
 * can answer more than a few lines.
 */
export async function wholeOrDigest(
  deps: CompanionToolDeps,
  input: { text: string; label: string; brief: string; intro: string },
  signal?: AbortSignal
): Promise<ToolTextResult> {
  const { text, label, brief, intro } = input;
  if (characterCount(text) <= INLINE_MAX_CHARACTERS) return textResult([intro, text].filter((part) => part !== '').join('\n'));

  const content = text.endsWith('\n') ? text : `${text}\n`;
  if (dactylWeight(content) > DACTYL_WINDOW_BUDGET) {
    return deps.refuse('That is more than one reader takes at once. Give a phrase or a narrower scope to get a part of it, or tell him it is too long to go through aloud.');
  }
  const folder = companionScratchDir(deps.userId);
  const file = nextScratchFile(folder, labelWord(label));
  writeFileSync(file, content, 'utf8');
  // The file just written is the newest, so the prune never takes it.
  pruneScratch(folder);

  const digest = await runDactylRead([file], `${brief}${NO_SPEND}`, undefined, signal);
  if (!digest.ok) return deps.refuse(`${digest.error} ${renderedAt(file)}`);
  if (digest.text === '') return deps.refuse(`The reader printed nothing. ${renderedAt(file)}`);
  return textResult([intro, digest.text, renderedAt(file)].filter((part) => part !== '').join('\n'));
}

// ---------------------------

//----------------- HIS PANEL ------------

/** `text` cut to at most `max` characters, as a person counts them, ending `ending` when it was cut; never splits a character. */
function cutTo(text: string, max: number, ending: string): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  return characters.slice(0, max - Array.from(ending).length).join('') + ending;
}

/**
 * `panel: true`: the answer goes on his panel as a note card, the way `show_note` does, and she is told only that it is
 * there ("On his panel: <title>."): the answer never enters her context. The title is cut to 80 characters and the
 * text to 4,000, ending "… narrow it to see the rest" when cut. An `isError` answer is a refusal she must read, so it
 * goes back to her untouched and no card is made. A panel read hands this the WHOLE text (`textResult(text)`), never the
 * answer of `wholeOrDigest`, which would spend a dactyl and put a digest and her scratch path on his panel. Consumed by every
 * eyes tool that takes `panel`.
 */
export function toPanel(deps: CompanionToolDeps, title: string, answer: ToolTextResult): ToolTextResult {
  if (answer.isError) return answer;
  const heading = cutTo(title.replace(/\s+/g, ' ').trim() || 'From the house', NOTE_TITLE_MAX, '…');
  const text = cutTo(answer.content.map((block) => block.text).join('\n'), NOTE_TEXT_MAX, '… narrow it to see the rest');
  deps.store.addNote({ title: heading, text });
  return textResult(`On his panel: ${heading}.`);
}

/**
 * The one ending of a read that answers a body of text: with `panel` the WHOLE of `intro` and `text` goes on his panel
 * under `title` (`toPanel`, never through a dactyl); without it the answer is `wholeOrDigest`'s, whole when it is short and a
 * dactyl's digest under `brief` when it is long. `label` names the kind of read in the scratch file. The two are one function
 * so no read can hand `toPanel` a digest, which would put a dactyl's lines and her scratch path on his panel. Consumed by the
 * reads that take `panel` and answer more than a few lines (`panel-reads.ts` and its panel files).
 */
export function answerRead(
  deps: CompanionToolDeps,
  input: { panel: boolean; title: string; text: string; label: string; brief: string; intro: string },
  signal?: AbortSignal
): Promise<ToolTextResult> | ToolTextResult {
  const { panel, title, text, label, brief, intro } = input;
  if (panel) return toPanel(deps, title, textResult([intro, text].filter((part) => part !== '').join('\n')));
  return wholeOrDigest(deps, { text, label, brief, intro }, signal);
}

// ---------------------------

//----------------- HIS CLOCK AND HIS DOORS ------------

/** The hour and minute of `moment` on the box's own clock, `14:02`. */
const clockOf = (moment: Date): string => `${String(moment.getHours()).padStart(2, '0')}:${String(moment.getMinutes()).padStart(2, '0')}`;

/** Whether two moments fall on the same calendar day of the box's own clock. */
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * A time as he would say it, on the box's local clock (PDT here): "today 14:02", "yesterday 09:10", else the date as the
 * panels write it, "Oct 27" (with the year, "Oct 27, 2025", when it is not this year). A shipping stamp of 02:34 UTC on
 * the 28th is therefore Oct 27, as he calls it. A stamp that does not parse is "at an unknown time"; a caller holding
 * epoch seconds converts them first. `now` is the moment "today" is judged against (the clock unless a showing sets it).
 * Consumed by every eyes read that says when.
 */
export function whenWords(iso: string, now: Date = new Date()): string {
  const moment = parseStamp(iso);
  if (moment === null) return 'at an unknown time';
  // A bare calendar day has no clock to say: it is the date, as the panels write it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return shortDate(iso, now) ?? 'at an unknown time';
  if (sameDay(moment, now)) return `today ${clockOf(moment)}`;
  // Yesterday by calendar, not by 24 hours: a day with a clock change is 23 or 25 hours long.
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(moment, yesterday)) return `yesterday ${clockOf(moment)}`;
  return shortDate(iso, now) ?? 'at an unknown time';
}

/** The card's door names: `app:card`, its older name `app:panel`, and the Accept-when-cut press (`app:card · Accept when cut, pressed <ISO>`). */
const CARD_DOOR = /^app:(?:card|panel)(?:\s|$)/;

/** A chat's session id, which is what an approval from a chat records. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who pressed, by the door's own name (a Map, so a name like `constructor` finds nothing). */
const DOOR_WORDS: ReadonlyMap<string, string> = new Map([
  ['app:card', 'on the card'],
  ['app:phone', 'on your phone'],
  ['app:kaylee', 'through Kaylee on your word'],
  ['cli', 'at the terminal'],
]);

/**
 * Who pressed, in words: `app:card` "on the card", `app:phone` "on your phone", `app:kaylee` "through Kaylee on your word",
 * `cli` "at the terminal", a session id "in a chat". The card's other spellings (`app:panel`, `app:card · Accept when cut, pressed
 * …`) are "on the card". A value that is none of these (the arc's own `arc's Accept (judgment)`) is said as the dispatcher wrote
 * it, "by <as written>", never guessed to be a chat; a blank or missing one is "by an unknown door". Consumed by the roadmap and
 * run reads (an approval, a history line).
 */
export function doorWords(by: string): string {
  const door = typeof by === 'string' ? by.trim() : '';
  if (door === '') return 'by an unknown door';
  const named = DOOR_WORDS.get(door);
  if (named !== undefined) return named;
  if (CARD_DOOR.test(door)) return 'on the card';
  return SESSION_ID.test(door) ? 'in a chat' : `by ${door}`;
}
