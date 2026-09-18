import type { KanbanDecision, KanbanLesson, KanbanLessonLean } from '@/shared/kanban-types.js';

import { openAllCards } from './kanban-pm-board-reads.js';
import type { KanbanPmClient } from './kanban-pm-client.js';

/**
 * The two recall reads: what this board remembers.
 *
 * `search_history` asks "have we hit this before?" across the card text, the design decisions, the
 * issues, the audit log and the lesson corpus; `get_learned_selections` asks "what did the operator
 * choose last time?" across the answered decisions. Both are scans, both are ranked or ordered, and
 * both answer with HOW MUCH they read — a recall that saw part of a board and reported it as the
 * board is the failure this module is written against.
 *
 * Consumers: `kanban-pm-tools-board.ts` (the history search) and `kanban-pm-tools-detail.ts` (the
 * decision recall).
 */

/**
 * The corpus kinds one search covers — Descent's `store_search.KINDS`, the four the ported brief
 * already asks for.
 *
 * `lesson` was DECLARED here and not searchable while this board had no corpus to search. The
 * corpus is on the board now (a lesson tool stages into it, `learning.routes.ts` serves it), so the
 * declared vocabulary and the read vocabulary are one list rather than two that had to be kept in
 * step by hand.
 */
export const SEARCH_KINDS = ['feature', 'decision', 'issue', 'lesson'] as const;

export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 100;
export const SEARCH_QUERY_MAX = 500;

/**
 * How many audit rows one search reads, and how many answers one recall returns.
 *
 * The first is the board's own transport ceiling (`server/modules/kanban/routes/board.routes.ts`,
 * `EVENT_LIMIT_MAX`), duplicated here because this program may not import from `server/modules/`.
 * The second is Descent's `store.get_decisions` default — the port keeps the number so a brief
 * written against Descent is answered at the same width.
 */
export const EVENT_READ_LIMIT = 200;
export const SELECTION_LIMIT = 50;

/**
 * How many index rows one search will consider — the index route's own ceiling, the "full dedupe
 * sweep" width its schema documents (`learning.routes.ts:27`).
 *
 * The index is LEAN (no bodies), and the teaching a search must match is the body, so a row it
 * names has to be opened once. That is one request per row, paid only when `lesson` is among the
 * kinds asked for, so the number of bodies opened is capped at the caller's OWN hit limit: a search
 * that may return at most `limit` hits can never carry more than `limit` lesson hits, and opening
 * past that only spends round trips to re-rank rows the slice below would have dropped anyway.
 * What the cap costs is depth, and depth is not hidden — `lessons_read` reports how many bodies were
 * actually opened and `more_lessons` says the corpus held more than this search saw.
 */
export const LESSON_READ_LIMIT = 500;

export type SearchKind = (typeof SEARCH_KINDS)[number];

/** One ranked, snippeted hit. `score` is the ranking and travels so a session can see why it ranked. */
export type SearchHit = {
  kind: SearchKind;
  cardId: string | null;
  title: string;
  snippet: string;
  score: number;
};

/**
 * What one search read, and whether it read all of it.
 *
 * The hits alone were the shape this tool used to answer with, and they were a lie by omission on
 * a board bigger than one page: `scanned_cards` is the count actually read, and `more_events` says
 * the audit log holds more rows than the board's transport would hand over in one read. A caller
 * that sees a small `scanned_cards` or a `more_events: true` knows to narrow the question instead
 * of concluding the board has nothing to say.
 */
export type SearchHistoryResult = {
  hits: SearchHit[];
  scanned_cards: number;
  events_read: number;
  more_events: boolean;
  /** Lesson bodies actually opened — 0 when the search did not ask for the `lesson` kind. */
  lessons_read: number;
  /** Whether the corpus held more lessons than this search opened. */
  more_lessons: boolean;
};

/** The window of text a hit quotes, collapsed to one line so a result stays readable. */
function snippetAround(text: string, query: string): string | null {
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) return null;
  const start = Math.max(0, index - 80);
  return text.slice(start, index + query.length + 80).replace(/\s+/g, ' ').trim();
}

/**
 * The lesson hits, and how much of the corpus produced them.
 *
 * Descent indexed lessons into its full-text table alongside the cards, so a search over there
 * matched a lesson's NAME and its BODY, rejected rows included ("they're history"). This board's
 * index route is lean by design — it ships no bodies — so the body is read one row at a time, the
 * way every other read in this program reaches a body. The order is the index's own (newest first),
 * and `read`/`more` carry the depth rather than leaving a caller to assume it.
 *
 * TWO BOUNDS, both deliberate. `budget` is the caller's own hit limit: no search can return more
 * than that many hits, so no search needs to open more than that many bodies. And each row's read
 * stands alone — a row that vanished between the index and the open (a 404) or that failed one
 * request is SKIPPED, not thrown, because the alternative is losing the card, decision, issue and
 * audit hits this search has already ranked over one bad lesson. A skip is visible where it
 * matters: `read` counts the bodies that really opened, so a short read shows up in the depth the
 * caller reads back.
 */
async function searchLessons(
  client: KanbanPmClient,
  query: string,
  budget: number
): Promise<{ hits: SearchHit[]; read: number; more: boolean }> {
  const index = (
    await client.get<{ lessons: KanbanLessonLean[] }>(`/lessons?limit=${LESSON_READ_LIMIT}`)
  ).lessons;
  const opening = index.slice(0, Math.max(0, budget));

  const hits: SearchHit[] = [];
  let read = 0;
  for (const lean of opening) {
    let lesson: KanbanLesson;
    try {
      lesson = (await client.get<{ lesson: KanbanLesson }>(`/lessons/${lean.id}`)).lesson;
    } catch {
      continue;
    }
    if (lesson === undefined || lesson === null) continue;
    read += 1;

    const fields: Array<[string, number]> = [
      [lesson.name, 3],
      [lesson.summary, 3],
      [lesson.body, 2],
    ];
    for (const [text, score] of fields) {
      const snippet = snippetAround(text ?? '', query);
      if (snippet === null) continue;
      hits.push({ kind: 'lesson', cardId: lesson.cardId, title: lesson.name, snippet, score });
      break;
    }
  }

  return {
    hits,
    read,
    more: read < index.length || index.length >= LESSON_READ_LIMIT,
  };
}

/**
 * The ranked, snippeted hits: card text first, then the card's own decisions and issues, then the
 * audit log, then the lesson corpus.
 *
 * The audit log is not decoration — every lane read excludes archived cards, so an event row is
 * the only surviving trace of a card the operator archived months ago, and "have we hit this
 * before?" is exactly the question that archive would otherwise swallow. It is read at the board's
 * own ceiling and not at the transport's default, because 50 of a twelve-thousand-row log is a
 * scan that stopped before it started; `more_events` carries the bound the read could not cross.
 */
export async function searchHistory(
  client: KanbanPmClient,
  query: string,
  kinds: ReadonlySet<SearchKind>,
  limit: number
): Promise<SearchHistoryResult> {
  const hits: SearchHit[] = [];
  const cards = await openAllCards(client, client.boardId);

  for (const card of cards) {
    if (kinds.has('feature')) {
      const fields: Array<[string, number]> = [
        [card.title, 3],
        [card.description, 2],
        [card.body, 2],
        [card.closingRemarks, 2],
      ];
      for (const [text, score] of fields) {
        const snippet = snippetAround(text ?? '', query);
        if (snippet === null) continue;
        hits.push({ kind: 'feature', cardId: card.id, title: card.title, snippet, score });
        break;
      }
    }

    if (kinds.has('decision')) {
      for (const decision of card.decisions) {
        const snippet = snippetAround(decision.question, query);
        if (snippet !== null) {
          hits.push({ kind: 'decision', cardId: card.id, title: card.title, snippet, score: 2 });
        }
      }
    }

    if (kinds.has('issue')) {
      for (const issue of card.issues) {
        const snippet = snippetAround(issue.text, query);
        if (snippet !== null) {
          hits.push({ kind: 'issue', cardId: card.id, title: card.title, snippet, score: 2 });
        }
      }
    }
  }

  const events = await client.get<
    { events: Array<{ kind: string; cardId: string | null; payload: unknown }> }
  >(`/events?boardId=${client.boardId}&limit=${EVENT_READ_LIMIT}`);

  if (kinds.has('feature')) {
    for (const event of events.events) {
      const snippet = snippetAround(`${event.kind} ${JSON.stringify(event.payload)}`, query);
      if (snippet !== null) {
        hits.push({ kind: 'feature', cardId: event.cardId, title: event.kind, snippet, score: 1 });
      }
    }
  }

  const lessons = kinds.has('lesson')
    ? await searchLessons(client, query, limit)
    : { hits: [] as SearchHit[], read: 0, more: false };
  hits.push(...lessons.hits);

  return {
    hits: hits.sort((left, right) => right.score - left.score).slice(0, limit),
    scanned_cards: cards.length,
    events_read: events.events.length,
    more_events: events.events.length >= EVENT_READ_LIMIT,
    lessons_read: lessons.read,
    more_lessons: lessons.more,
  };
}

/** One recalled answer, with the two facts that say why it matched a tag filter. */
export type LearnedSelection = KanbanDecision & {
  cardTitle: string;
  /** The card's tags AS THEY STAND — see `getLearnedSelections` for why these are the filter's basis. */
  cardTags: string[];
};

export type LearnedSelectionsResult = {
  selections: LearnedSelection[];
  scanned_cards: number;
  /** Whether more answers matched than `SELECTION_LIMIT` returned. */
  more: boolean;
};

/**
 * The operator's past design-question answers, most recent first, filtered by tag overlap and/or a
 * substring of the question.
 *
 * The tag basis is the subtle part. Descent stamps a decision with the feature's tags AT ANSWER
 * TIME; this board's own answer path writes the column empty (`kanban-questions.service.ts`'s
 * `insertDecision` passes `tags: []`), and the MCP cannot fill it in because the answer route takes
 * no tags. A filter that read only the decision's own tags would therefore report every answer made
 * through this server — including the ones Metis itself just recorded — as absent, and would match
 * only rows imported from Descent. So a decision matches when EITHER its own snapshot or the tags
 * its card carries today intersect the wanted set: the snapshot is the historical truth where it
 * exists, and the card's current tags are the same signal for every answer this board wrote itself.
 */
export async function getLearnedSelections(
  client: KanbanPmClient,
  wantedTags: ReadonlySet<string>,
  query: string | undefined
): Promise<LearnedSelectionsResult> {
  const matches: LearnedSelection[] = [];
  const cards = await openAllCards(client, client.boardId);

  for (const card of cards) {
    const cardTags = card.tags.map((tag) => tag.trim().toLowerCase());
    for (const decision of card.decisions) {
      if (query !== undefined && !decision.question.toLowerCase().includes(query)) continue;

      if (wantedTags.size > 0) {
        const carried = [...decision.tags, ...cardTags].map((tag) => tag.toLowerCase());
        if (!carried.some((tag) => wantedTags.has(tag))) continue;
      }

      matches.push({ ...decision, cardTitle: card.title, cardTags: card.tags });
    }
  }

  matches.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    selections: matches.slice(0, SELECTION_LIMIT),
    scanned_cards: cards.length,
    more: matches.length > SELECTION_LIMIT,
  };
}
