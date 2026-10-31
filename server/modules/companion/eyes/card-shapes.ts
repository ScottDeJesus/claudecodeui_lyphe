import type { CompanionNoteKind, CompanionNoteRef } from '@/shared/companion-types.js';

/**
 * WHAT A CARD IS AND WHAT IT IS ABOUT, said by the tool that puts it up. The reader knows what it read (a diff, a list of runs, a
 * plan's design), so it names the card's `kind` and its `ref` where the whole text is; the page never guesses either from the
 * words. A reader passes its shape to `answerRead` / `toPanel` (`eyes-answer.ts`); a panel read with no shape is a `note` about
 * nothing.
 *
 * THE TABLE (MAN-9151) is decided by the readers below and by nothing else:
 *   list, about nothing   list_roadmap, list_runs, list_alerts, read_schedules, read_kanban (every scope), read_heal summary and cycles,
 *                         read_cerberus, read_memory lists, recall, read_notes lists, search_docs
 *   list, a project       read_git status
 *   diff, a project       read_git diff, and read_git of one file
 *   plan, a card          read_card design, and read_card of a phrase
 *   list, a card          read_card questions, phases, history
 *   note, a card          read_card summary, prompt
 *   note, a card          read_run of a dispatcher run (the plan it belongs to)
 *   note, a chat          read_run of a run a chat launched by hand (that chat); a run with neither is a note about nothing
 *   page, a page          read_doc (a page, one of its blocks, a phrase, its outline)
 *   note, about nothing   read_heal of a kind, read_memory of one proposal, read_notes of one note
 * `show_note` is her own card: her `kind` (`note` or `list`), about nothing (`tools/draft-tools.ts`).
 *
 * Consumers: `eyes-answer.ts` (the default shape and the type `toPanel` and `answerRead` take), and every reader above:
 * `eyes/*-reads.ts`, `eyes/run-scopes.ts` and `memory/memory-verbs.ts` (`recall`).
 */

/** A card's kind and what it is about, as `store.addNote` takes them. Consumed by `eyes-answer.ts` (`toPanel`, `answerRead`) and by every reader that passes one. */
export type CardShape = { kind: CompanionNoteKind; ref: CompanionNoteRef | null };

/** A plain note about nothing: what a panel read is when it passes no shape of its own. Consumed by `eyes-answer.ts` and the readers whose answer is one thing read whole. */
export const NOTE_ABOUT_NOTHING: CardShape = { kind: 'note', ref: null };

/** A list about nothing: the shape of every reader that answers a list of the house's things. Consumed by the list readers of `eyes/` and `recall`. */
export const LIST_ABOUT_NOTHING: CardShape = { kind: 'list', ref: null };

/** A card about the project at `path` (`read_git`): its status is a `list`, its diffs are a `diff`. Consumed by `git-reads.ts`. */
export const aboutProject = (kind: 'list' | 'diff', path: string): CardShape => ({ kind, ref: { kind: 'project', path } });

/** A card about the roadmap card `plan`, by its dispatcher name (an epic's too: the stage opens it by the same name). Consumed by `roadmap-reads.ts`, and by `runShape` below. */
export const aboutCard = (kind: 'plan' | 'list' | 'note', plan: string): CardShape => ({ kind, ref: { kind: 'card', plan } });

/** A `page` card about the DocSpace page `pageId`, and about one of its blocks when `blockId` is given. Consumed by `doc-reads.ts`. */
export const aboutPage = (pageId: string, blockId: string | null): CardShape => ({ kind: 'page', ref: { kind: 'page', pageId, blockId } });

/**
 * The shape of one run read (`read_run`): a `note` about the dispatcher plan the run belongs to, else about the chat that launched it,
 * else about nothing. A dispatcher run's plan is where the stage lands, a chat's run's chat is (`ResolvedRun`, `run-resolve.ts`).
 * Consumed by `run-scopes.ts`.
 */
export function runShape(run: { plan: string | null; chatSessionId: string | null }): CardShape {
  if (run.plan !== null) return aboutCard('note', run.plan);
  if (run.chatSessionId !== null) return { kind: 'note', ref: { kind: 'chat', sessionId: run.chatSessionId } };
  return NOTE_ABOUT_NOTHING;
}
