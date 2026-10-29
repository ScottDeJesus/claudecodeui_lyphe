import type { MemoryCandidateFull, MemoryCandidateLean } from '@/shared/types.js';

import { whenWords } from './eyes-answer.js';
import { clipLine } from './line-words.js';

/**
 * The memory intake's words, for `read_memory` (`house-reads.ts`): a proposal as one line, and one proposal whole. PURE — the
 * candidates arrive as values and the chat's name arrives as a string (the caller looks it up), so nothing here reads a database.
 *
 * A PROPOSAL is a memory a session suggested for him to approve or reject (`memory_candidates`): `name` is its title, `target` the
 * place it would be filed (`memory`, `topic`, …), `project` the folder it belongs to, and `sessionId` the chat that proposed it —
 * `null` when a spill sweep staged it and recorded no chat.
 *
 * Consumer: `house-reads.ts` (`read_memory`).
 */

/** The longest a proposal's title and a chat's name run in a line: a session wrote the title, so it is folded to one line and cut (masking credential-looking values on the way). */
const TITLE_MAX = 90;

/** How far back `recent` looks for a review: seven days, as he asked for it. */
const RECENT_REVIEW_DAYS = 7;

/** A proposal's id as a scope: `mc-136`, `MC-136`, or the bare `136`. Answers the canonical `mc-136`, or `null` when the scope is not an id. */
export function proposalIdOf(scope: string): string | null {
  const digits = /^(?:mc-)?(\d+)$/i.exec(scope.trim())?.[1];
  return digits === undefined ? null : `mc-${digits}`;
}

/** Where a proposal came from, in words: the chat's name when one is recorded, else an honest "an unrecorded chat". */
export const sourceWords = (chatName: string | null): string => (chatName === null ? 'an unrecorded chat' : chatName);

/** `<target> · <title> · from <chat> · proposal <id>`: one waiting proposal. `from` is `sourceWords(...)`. */
export function pendingLine(candidate: MemoryCandidateLean, from: string): string {
  return `${candidate.target} · ${clipLine(candidate.name, TITLE_MAX)} · from ${clipLine(from, TITLE_MAX)} · proposal ${candidate.id}`;
}

/** `<target> · <title> · approved yesterday 09:10 · proposal <id>`: one reviewed proposal with its verdict. */
export function reviewedLine(candidate: MemoryCandidateLean): string {
  const when = candidate.reviewedAt === null ? 'at an unknown time' : whenWords(candidate.reviewedAt);
  return `${candidate.target} · ${clipLine(candidate.name, TITLE_MAX)} · ${candidate.status} ${when} · proposal ${candidate.id}`;
}

/** Whether a proposal was reviewed within the last seven days of `now`. A review with no stamp, or one that does not parse, is not. */
export function reviewedRecently(candidate: MemoryCandidateLean, now: Date = new Date()): boolean {
  if (candidate.reviewedAt === null) return false;
  const reviewed = Date.parse(candidate.reviewedAt);
  return !Number.isNaN(reviewed) && now.getTime() - reviewed <= RECENT_REVIEW_DAYS * 24 * 60 * 60 * 1000;
}

/** Whether a proposal's id, title, target or project holds `phrase` (case-insensitive): the phrase scope's match. */
export function proposalHolds(candidate: MemoryCandidateLean, phrase: string): boolean {
  const wanted = phrase.trim().toLowerCase();
  return [candidate.id, candidate.name, candidate.target, candidate.project ?? ''].some((field) => field.toLowerCase().includes(wanted));
}

/**
 * One proposal whole: its title and id, where it would be filed and its state, who proposed it and when, the refusal an approval
 * met (when one did), then its index line, its rationale and its body. A missing index line or rationale is left out, not
 * written as empty.
 */
export function proposalText(candidate: MemoryCandidateFull, from: string): string {
  const staged = candidate.createdAt === null ? '' : `, staged ${whenWords(candidate.createdAt)}`;
  const reviewed = candidate.reviewedAt === null ? '' : `, reviewed ${whenWords(candidate.reviewedAt)}`;
  const lines = [
    `${clipLine(candidate.name, 200)} — proposal ${candidate.id}, ${candidate.status}`,
    `For ${candidate.target}${candidate.project === null ? '' : ` in ${candidate.project}`}; from ${from}${staged}${reviewed}.`,
  ];
  if (candidate.refusal !== null) lines.push(`Its approval was refused: ${candidate.refusal}`);
  if (candidate.indexLine !== null) lines.push(`Index line: ${candidate.indexLine}`);
  if (candidate.rationale !== null) lines.push(`Why: ${candidate.rationale}`);
  lines.push('', candidate.body);
  return lines.join('\n');
}
