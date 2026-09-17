import type { KanbanDecision } from '@/shared/kanban-types.js';

import { openAllCards } from './kanban-pm-board-reads.js';
import type { KanbanPmClient } from './kanban-pm-client.js';

/**
 * The two recall reads: what this board remembers.
 *
 * `search_history` asks "have we hit this before?" across the card text, the answers and the audit
 * log; `get_learned_selections` asks "what did the operator choose last time?" across the answered
 * decisions. Both are scans, both are ranked or ordered, and both answer with HOW MUCH they read —
 * a recall that saw part of a board and reported it as the board is the failure this module is
 * written against.
 *
 * Consumers: `kanban-pm-tools-board.ts` (the history search) and `kanban-pm-tools-detail.ts` (the
 * decision recall).
 */

/**
 * `lesson` is DECLARED and not SEARCHABLE, and the two lists are separate so the difference is
 * visible in the code rather than in a handler's memory.
 *
 * Descent's schema names four kinds and the ported brief may ask for any of them, so the enum keeps
 * all four — but this board has no lesson corpus, and a `lesson` search that returned `[]` would
 * answer "there is nothing to learn from" for the fourth time where the three lesson tools refuse
 * and name the alternative. The declared vocabulary is Descent's; the searchable vocabulary is this
 * board's.
 */
export const SEARCHABLE_KINDS = ['feature', 'decision', 'issue'] as const;
export const SEARCH_KINDS = [...SEARCHABLE_KINDS, 'lesson'] as const;

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
};

/** The window of text a hit quotes, collapsed to one line so a result stays readable. */
function snippetAround(text: string, query: string): string | null {
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) return null;
  const start = Math.max(0, index - 80);
  return text.slice(start, index + query.length + 80).replace(/\s+/g, ' ').trim();
}

/**
 * The ranked, snippeted hits: card text first, then the card's own decisions and issues, then the
 * audit log.
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

  return {
    hits: hits.sort((left, right) => right.score - left.score).slice(0, limit),
    scanned_cards: cards.length,
    events_read: events.events.length,
    more_events: events.events.length >= EVENT_READ_LIMIT,
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
