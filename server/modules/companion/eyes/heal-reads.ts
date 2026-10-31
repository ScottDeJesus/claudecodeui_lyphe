import { isRecord } from '@/shared/document-fields.js';
import { textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { LIST_ABOUT_NOTHING, NOTE_ABOUT_NOTHING } from './card-shapes.js';
import { answerRead } from './eyes-answer.js';
import { clipLine, counted, epochWords } from './line-words.js';

/**
 * `read_heal`: the heal list, the house's friction, read through the heal lane's own service (`deps.house.heal`: the
 * reflex's worker, asked as the Heal tab asks it). `scope` is:
 *   - `summary`: how many rows are live and how many were filed since the last heal ended (with its time), the ten kinds with
 *     the most live rows, and the heals open now, one line each;
 *   - `cycles`: the newest five cycles, one line each;
 *   - anything else is a friction KIND (`tool-error`): that kind's newest 60 rows, one line each, whole when short and a dactyl's
 *     digest when long.
 * A worker that does not answer is said with its own sentence. With `panel: true` the whole answer goes on his panel.
 *
 * NEVER SPEND (ruling 1). The worker's answer carries `spend_today`, `spend_reserved`, `switches.daily_cap`, each cycle's `spent`
 * and each heal's `cost_usd` and tokens: nothing here reads any of them. Each heal and cycle is said by the keys named below
 * and no other, so a key the worker adds later reaches her only when this file asks for it.
 *
 * Consumed by `panel-reads.ts`, which builds the tool.
 */

/** How many kinds `summary` names, and how many cycles `cycles` lists. */
const KINDS_SHOWN = 10;
const CYCLES_SHOWN = 5;

/** The longest detail a friction row's line carries, and how many of a kind's newest rows a kind read renders: the worker answers up to 200, which one dactyl takes a minute to read and a spoken answer has no use for. */
const DETAIL_MAX = 240;
const KIND_ROWS = 60;

/** What a dactyl is asked of a long kind: its rows, newest first (`NO_SPEND` is added by `wholeOrDigest`). */
const KIND_BRIEF = 'What does this kind of friction hold: what keeps happening, which rows are the same shape, and which are ignored? At most 12 lines; cite L<n>.';

/** What a dactyl is asked of a summary or a cycle list that came out past 2,000 characters. */
const SUMMARY_BRIEF = 'How much friction is live, which kinds lead, what is being healed now, and what did the newest cycles do? At most 10 lines; cite L<n>.';

/** A friction kind as the worker takes it: one argument that never starts with a dash, so it can never be read as an option. */
const KIND_WORD = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i;

type Row = Record<string, unknown>;

/** A number the worker printed under `key`, or `null` when it printed none. */
const numberAt = (row: Row, key: string): number | null => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] : null);

/** A text the worker printed under `key`, or `''`. */
const textAt = (row: Row, key: string): string => (typeof row[key] === 'string' ? row[key] : '');

/** The objects of an array the worker printed under `key`; `[]` when it printed none. */
const rowsAt = (row: Row, key: string): Row[] => (Array.isArray(row[key]) ? row[key].filter(isRecord) : []);

/** What fired a heal, in words: a cycle's own heals say "a cycle"; the others say the door's word as the worker wrote it. */
const firedBy = (reason: string): string => (reason.startsWith('cycle:') ? 'a cycle' : reason === '' ? 'an unknown door' : reason);

/** The `summary` scope: the counts, the biggest kinds, the open heals. */
function summaryText(summary: Row): string {
  const live = numberAt(summary, 'live') ?? 0;
  const since = numberAt(summary, 'live_since_last_heal') ?? 0;
  const last = isRecord(summary.last_heal) ? summary.last_heal : null;
  const lastEnded = last === null ? null : numberAt(last, 'ended_at');
  const sinceWords = last === null ? 'no heal has run yet' : lastEnded === null ? 'the running heal began' : `the last heal ended ${epochWords(lastEnded)}`;
  const kinds = rowsAt(summary, 'kinds')
    .map((row) => ({ kind: textAt(row, 'kind'), live: numberAt(row, 'live') ?? 0 }))
    .filter((row) => row.kind !== '' && row.live > 0)
    .sort((a, b) => b.live - a.live)
    .slice(0, KINDS_SHOWN);
  const open = rowsAt(summary, 'heals').filter((heal) => textAt(heal, 'status') === 'running');
  const openLines = open.map((heal) => `${textAt(heal, 'kind')} · started ${epochWords(numberAt(heal, 'started_at'))} · fired by ${firedBy(textAt(heal, 'reason'))} · heal ${textAt(heal, 'id')}`);
  return [
    `Heal list: ${counted(live, 'live friction row')}; ${since} of them filed since ${sinceWords}.`,
    kinds.length === 0 ? 'No kind has a live row.' : `Largest kinds: ${kinds.map((row) => `${row.kind} ${row.live}`).join(', ')}.`,
    open.length === 0 ? 'No heal is open.' : `${counted(open.length, 'heal')} open:\n${openLines.join('\n')}`,
  ].join('\n');
}

/** A cycle's stage as a word: the three open stages are "open", the two ended ones are as the worker says them. */
const stageWord = (stage: string): string => (stage === 'judging' || stage === 'healing' || stage === 'closing' ? `open, ${stage}` : stage);

/** The `cycles` scope: the newest five cycles, one line each (never a cycle's `spent`, its judge's notes or its worklist). */
function cyclesText(summary: Row): string {
  const cycles = rowsAt(summary, 'cycles')
    .sort((a, b) => (numberAt(b, 'started_at') ?? 0) - (numberAt(a, 'started_at') ?? 0))
    .slice(0, CYCLES_SHOWN);
  if (cycles.length === 0) return 'The heal list has run no cycle yet.';
  const lines = cycles.map((cycle) => {
    const ended = numberAt(cycle, 'ended_at');
    const endReason = textAt(cycle, 'end_reason');
    const door = textAt(cycle, 'door') === 'press' ? 'pressed' : 'scheduled';
    const stage = textAt(cycle, 'stage');
    return [
      `${epochWords(numberAt(cycle, 'started_at'))} · ${door} · ${stageWord(stage)}`,
      `gathered ${numberAt(cycle, 'gathered') ?? 0}, ignored ${numberAt(cycle, 'ignored') ?? 0}, healed ${numberAt(cycle, 'healed') ?? 0}`,
      ...(ended === null ? [] : [`ended ${epochWords(ended)}`]),
      ...(endReason !== '' && endReason !== stage ? [endReason] : []),
    ].join(' · ');
  });
  return `The newest ${counted(cycles.length, 'cycle')}:\n${lines.join('\n')}`;
}

/** Whether the worker marked a row ignored (`1` on its wire; the kind door prints ignored rows too). */
const isIgnored = (item: Row): boolean => numberAt(item, 'ignored') === 1 || item.ignored === true;

/** One friction row as one line: when, which tool or door, whether it is ignored, and the start of its detail. */
function itemLine(item: Row): string {
  const tool = textAt(item, 'tool') || textAt(item, 'source') || 'unknown';
  return `${epochWords(numberAt(item, 'ts'))} · ${tool}${isIgnored(item) ? ' · ignored' : ''} · ${clipLine(textAt(item, 'detail'), DETAIL_MAX)}`;
}

/** `read_heal`: see the file's head. */
export async function readHeal(
  deps: CompanionToolDeps,
  args: { scope: string; panel?: boolean },
  signal: AbortSignal | undefined
): Promise<ToolTextResult> {
  const panel = args.panel === true;
  const scope = args.scope.trim();
  const keyword = scope.toLowerCase();

  if (keyword === 'summary' || keyword === 'cycles') {
    const answer = await deps.house.heal.summary();
    if (!answer.ok) return deps.refuse(`The heal list could not be read: ${answer.message}. Say so, and try again in a moment.`);
    const text = keyword === 'summary' ? summaryText(answer.value) : cyclesText(answer.value);
    return answerRead(deps, { panel, title: `Heal: ${keyword}`, text, label: 'heal', brief: SUMMARY_BRIEF, intro: '', shape: LIST_ABOUT_NOTHING }, signal);
  }

  if (!KIND_WORD.test(scope)) return deps.refuse('read_heal takes summary, cycles, or one friction kind such as tool-error; read_heal summary names the kinds.');
  // The worker's kinds are all lower case, and it matches a kind exactly, so "Tool-Error" is asked for as the kind it means.
  const answer = await deps.house.heal.kind(keyword);
  if (!answer.ok) return deps.refuse(`The heal list could not be read: ${answer.message}. Say so, and try again in a moment.`);
  const items = isRecord(answer.value) ? rowsAt(answer.value, 'items') : [];
  if (items.length === 0) return textResult(`The heal list holds no friction rows of kind ${keyword}. read_heal summary names the kinds that have some.`);
  // The worker answers its newest rows (200 at most, ignored ones too), which is a window on the kind and not its count: the
  // summary's live figure for the kind is the number of rows still open, so the two are never written as one.
  const ignored = items.filter(isIgnored).length;
  const read = items.length > KIND_ROWS ? `; the newest ${KIND_ROWS} are read` : '';
  const intro = `The ledger's newest ${items.length} rows of kind ${keyword} (${items.length - ignored} live, ${ignored} ignored)${read}, newest first:`;
  const text = items.slice(0, KIND_ROWS).map(itemLine).join('\n');
  return answerRead(deps, { panel, title: `Heal: ${keyword}`, text, label: `heal-${keyword}`, brief: KIND_BRIEF, intro, shape: NOTE_ABOUT_NOTHING }, signal);
}
