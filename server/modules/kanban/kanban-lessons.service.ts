import fs from 'node:fs';
import path from 'node:path';

import { kanbanCardsDb, kanbanIdsDb, kanbanLearningDb } from '@/modules/database/index.js';
import type { KanbanCardRow } from '@/modules/database/index.js';
import type {
  KanbanLesson,
  KanbanLessonLean,
  KanbanWriteContext,
} from '@/shared/kanban-types.js';
import { AppError, expandHome } from '@/shared/utils.js';

import { writeKanban } from './kanban-write.service.js';

/**
 * The lessons lane: a note worth carrying into a future session, staged for a person's review.
 *
 * The lifecycle is one-way and its two ends have OPPOSITE actors. A build (or the spill sweep)
 * STAGES; only a person reviews, and only an approved lesson ever reaches a session again. That
 * split is why `stageLesson` and `reviewLesson` are not symmetrical: staging is ungated and names
 * its own actor through `source`, while a review is a person's act — refused at the door on the
 * `kanban-pm` mount (`kanban-metis.routes.ts`'s `REVIEW_PATH`), so a Metis can file a lesson but
 * can never promote her own.
 *
 * A lesson belongs to the ESTATE, not to a board: `cardId` is provenance and is nullable, and a
 * lesson with no card writes an event row whose `board_id` is NULL — which is what the write seam's
 * nullable `boardId` was widened for. A lesson that DOES name a card writes into that card's board,
 * so the note lands in the lane of the board it was learned on.
 *
 * The five verbs are exported as FUNCTIONS rather than gathered into an object, because that is the
 * contract the MCP catalog and the routes both name; `kanbanLessonsService` below is the same five
 * in the one-object shape the route package's dependency bag takes.
 *
 * Ported from `~/.claude/descent/store_lessons.py`, whose `_project_lesson_full` /
 * `_project_lesson_lean` are the two projections the repository already carries.
 */

/** What a caller hands `stageLesson`: the note, its provenance, and nothing about its id. */
export type KanbanLessonInput = {
  name: string;
  summary: string;
  trigger: string;
  body?: string;
  tags?: string[];
  cardId?: string | null;
  kind?: 'note' | 'skill_draft';
  source?: string;
};

/**
 * The three states a lesson's `status` column holds — the review queue's vocabulary.
 *
 * `staged` is the only state a review may leave; `approved` and `rejected` are terminal. It lives
 * here, beside the verbs that write it, so the list route's `?status=` filter and the review's own
 * refusal check one set of words rather than two that drift apart.
 */
export const KANBAN_LESSON_STATUSES = ['staged', 'approved', 'rejected'] as const;

/** The index read's own default, as `store_lessons.py:288` spells it. */
const LESSON_INDEX_LIMIT = 100;

/**
 * The approved index's ceiling: `store_actionable.py:170-171`'s top-50, unscored.
 *
 * Recency is the WHOLE order — there is no lesson scoring anywhere in Descent and none is invented
 * here, so this is a slice of the newest approved lessons and never a relevance ranking.
 */
const APPROVED_INDEX_LIMIT = 50;

/** The board a lesson belongs to through its card, or null for a lesson that has no card. */
function boardOfCard(card: KanbanCardRow | null): string | null {
  return card === null ? null : card.board_id;
}

/**
 * A lesson that is not there is a 404, and this is the one place that sentence is written.
 *
 * Exported because the by-id read answers `null` by contract and the ROUTE is what turns that into
 * a response: one refusal, one code and one sentence for every caller, rather than a route's own
 * paraphrase of the store's words.
 */
export function lessonNotFound(lessonId: string): AppError {
  return new AppError(`No kanban lesson with id "${lessonId}".`, {
    code: 'KANBAN_LESSON_NOT_FOUND',
    statusCode: 404,
  });
}

/**
 * The card a lesson names as its provenance, or a 404 when no such card exists.
 *
 * `kanban_lessons.card_id` carries a foreign key with `ON DELETE SET NULL`, but that only fires on
 * a LATER delete of the card: inserting a lesson against an id that does not exist right now trips
 * the constraint at INSERT time and would surface as SQLite's own sentence rendered as a 500.
 * Descent validates up front for exactly this reason (`store_lessons.py:189-192`) and so does this.
 */
function requireLessonCard(cardId: string): KanbanCardRow {
  const card = kanbanCardsDb.getCardRow(cardId);
  if (card === null) {
    throw new AppError(`No kanban card with id "${cardId}".`, {
      code: 'KANBAN_CARD_NOT_FOUND',
      statusCode: 404,
    });
  }
  return card;
}

/**
 * A filesystem-safe slug of a lesson's name — the load-bearing SECURITY shape of the draft path.
 *
 * Every run of non-`[a-z0-9]` characters collapses to a single hyphen and the ends are stripped, so
 * no `/`, `..`, NUL or other path metacharacter survives from a caller's `name` into a filename: a
 * lesson can never name a file outside the draft directory. Bounded to sixty characters so a
 * pathological name cannot mint an absurd filename. `store_lessons.py:120-130`'s `_kebab`, which
 * returns `''` for an all-punctuation name so the caller can fall back to the id.
 */
function kebab(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * Where a `skill_draft`'s body lands for the operator to promote into a real skill.
 *
 * Read at CALL time and redirected by one variable (Interfaces §10), so a probe writes into its own
 * scratch tree and the operator's `~/.cloudcli/pending-skills/` is untouched. The path is composed
 * from the MINTED id (always filesystem-safe) plus the sanitized slug — never from raw caller
 * input — and the id prefix keeps two same-named lessons apart.
 */
function skillDraftPath(lessonId: string, name: string): string {
  const root = expandHome(process.env.CLOUDCLI_SPILL_ROOT || '~/.cloudcli');
  const slug = kebab(name);
  const stem = slug === '' ? lessonId : `${lessonId}-${slug}`;
  return path.join(root, 'pending-skills', `${stem}.SKILL.md`);
}

/**
 * Stages one lesson at status `staged`, in the write seam's transaction. Event `lesson.staged`.
 *
 * The card reference is validated BEFORE the transaction opens, because a 404 belongs to the caller
 * and nothing should be minted for a write that cannot land. Inside the transaction the `ls-<n>` id
 * is minted (so a rollback leaves the counter where it was rather than burning an id) and the row is
 * inserted. For a `skill_draft`, the body reaches disk in the seam's `afterEvent` step — once the
 * audit row is in and still inside the transaction — so a failed append leaves no `.SKILL.md` behind
 * it, a failed write rolls the row and its event back, and a lesson never points at a draft that
 * failed to land. That is `store_lessons.py:216-224`'s ordering exactly.
 *
 * The event names its subject: `lesson_id` is the key the source's own spine already uses
 * (`store_lessons.py:216-217`), and for a lesson with no card it is the ONLY identifier there is.
 * It is resolved from the mutation rather than written by hand, because the id does not exist until
 * the transaction has minted it.
 */
export function stageLesson(input: KanbanLessonInput, context?: KanbanWriteContext): KanbanLesson {
  const kind = input.kind ?? 'note';
  const source = input.source ?? 'metis';
  const body = input.body ?? '';
  const card = input.cardId === undefined || input.cardId === null ? null : requireLessonCard(input.cardId);

  return writeKanban(
    {
      kind: 'lesson.staged',
      cardId: card === null ? null : card.id,
      boardId: boardOfCard(card),
      // The stager IS the actor, which is what `source` names: a lesson staged by a build reads
      // `metis` in the activity spine, and a caller that knows better passes a context.
      actor: context?.actor ?? source,
      // A function of the mutation, because the id is minted inside the transaction.
      payload: (lesson) => ({ lesson_id: lesson.id, name: input.name, kind }),
      // The draft file lands after the audit row — the source's ordering — so an append that
      // fails rolls the row back with no orphan `.SKILL.md` left in the spill root.
      afterEvent: (lesson) => {
        if (lesson.draftPath === null) return;
        fs.mkdirSync(path.dirname(lesson.draftPath), { recursive: true });
        fs.writeFileSync(lesson.draftPath, body, 'utf8');
      },
    },
    () => {
      const id = kanbanIdsDb.mintId('ls');
      return kanbanLearningDb.insertLesson({
        id,
        cardId: card === null ? null : card.id,
        name: input.name,
        summary: input.summary,
        body,
        trigger: input.trigger,
        kind,
        tags: input.tags ?? [],
        status: 'staged',
        source,
        draftPath: kind === 'skill_draft' ? skillDraftPath(id, input.name) : null,
      });
    }
  );
}

/**
 * The lesson index — LEAN rows, newest first, optionally narrowed to one status.
 *
 * No `body` and no `draftPath` cross the wire: an index of fifty lessons carrying fifty bodies would
 * ship the whole corpus so a panel could draw fifty titles. The order is `created_at DESC, id DESC`
 * — the id breaks ties between two lessons staged in the same second, so the order is stable.
 */
export function listLessons(query: { status?: string; limit?: number }): KanbanLessonLean[] {
  return kanbanLearningDb.listLessons({
    status: query.status,
    limit: query.limit ?? LESSON_INDEX_LIMIT,
  });
}

/** One lesson read whole — body and draft path included — or null when no such lesson exists. */
export function getLesson(lessonId: string): KanbanLesson | null {
  return kanbanLearningDb.getLesson(lessonId);
}

/**
 * Approves or rejects a STAGED lesson. Event `lesson.reviewed`, actor `operator` by default.
 *
 * Returns null for an id that names no lesson (the caller's 404), and THROWS a 422 for a lesson
 * already out of `staged`. The pre-read is what tells those two apart — it is not the gate: the
 * gate is the compare-and-set inside the transaction (`AND status = 'staged'`), so two reviewers
 * racing the same lesson cannot both win and a lesson can never carry both an approval and a
 * rejection. A lost race lands in the same 422, re-read so the words name the state that won.
 */
export function reviewLesson(
  lessonId: string,
  approve: boolean,
  context?: KanbanWriteContext
): KanbanLesson | null {
  const lesson = kanbanLearningDb.getLesson(lessonId);
  if (lesson === null) return null;

  const status = approve ? 'approved' : 'rejected';
  const card = lesson.cardId === null ? null : kanbanCardsDb.getCardRow(lesson.cardId);

  return writeKanban(
    {
      kind: 'lesson.reviewed',
      cardId: lesson.cardId,
      boardId: boardOfCard(card),
      actor: context?.actor,
      // `lesson_id`, the key the staged event and the source's own spine already use — one event
      // kind, one payload shape, and never a camelCase twin of the same field.
      payload: { lesson_id: lessonId, status },
    },
    () => {
      const reviewed = kanbanLearningDb.reviewLesson({ id: lessonId, status });
      // The compare-and-set matched nothing: the row was reviewed — by an earlier call, or by a
      // racer that won the flip a moment ago. Re-read so the sentence names the REAL terminal
      // state, and answer 404 if the row went away between the two statements.
      if (reviewed === null) {
        const current = kanbanLearningDb.getLesson(lessonId);
        if (current === null) throw lessonNotFound(lessonId);
        throw new AppError(
          `can only review a 'staged' lesson; ${lessonId} is '${current.status}'`,
          { code: 'KANBAN_LESSON_NOT_STAGED', statusCode: 422 }
        );
      }
      return reviewed;
    }
  );
}

/**
 * The APPROVED lessons a future session scans — the newest fifty, lean, unscored.
 *
 * Staged lessons are inert and never appear here: the corpus a session reads is exactly what a
 * person approved. `store_actionable.py:170-171`'s index, which is where the orient read takes it.
 */
export function approvedIndex(limit: number = APPROVED_INDEX_LIMIT): KanbanLessonLean[] {
  return listLessons({ status: 'approved', limit });
}

/** The five verbs in the one-object shape `kanban.module.ts` hands the route package. */
export type KanbanLessonsService = {
  stageLesson: typeof stageLesson;
  listLessons: typeof listLessons;
  getLesson: typeof getLesson;
  reviewLesson: typeof reviewLesson;
  approvedIndex: typeof approvedIndex;
};

export const kanbanLessonsService: KanbanLessonsService = {
  stageLesson,
  listLessons,
  getLesson,
  reviewLesson,
  approvedIndex,
};
