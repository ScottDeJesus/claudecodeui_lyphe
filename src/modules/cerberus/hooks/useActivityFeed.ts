import { useCallback, useEffect, useReducer, useRef } from 'react';

import { api } from '@/shared/api';
import type { CerberusActivity } from '@/shared/cerberus-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { CerberusFeedFoot } from '@/shared/types';

/**
 * How many lines a page asks for, the newest page and each earlier one. A page that answers fewer is
 * the record's start. The server never cuts in the middle of an instant (a health document stamps
 * every component with one `at`, so a mass flip is one instant), so a page may hold more than this.
 */
const PAGE_SIZE = 40;

/**
 * The least gap between two newest-page reads that `cerberus_changed` frames may start. Center already
 * coalesces its hint to one a second and the overview provider keeps this same gap, so a burst that
 * slips past center is not a burst of reads; the trailing read below means the LAST frame of a burst
 * is never left unread.
 */
const FRAME_READ_GAP_MS = 1_000;

type FeedState = {
  lines: CerberusActivity[] | null;
  failed: boolean;
  earlier: CerberusFeedFoot;
  openIndex: number | null;
};

type FeedAction =
  | { type: 'newest-reading' }
  | { type: 'newest-landed'; page: CerberusActivity[] }
  | { type: 'newest-failed' }
  | { type: 'earlier-reading' }
  | { type: 'earlier-landed'; before: number; page: CerberusActivity[] }
  | { type: 'earlier-failed'; before: number }
  | { type: 'toggled'; index: number };

const FEED_START: FeedState = { lines: null, failed: false, earlier: 'more', openIndex: null };

/** A page that came back short holds the record's start; a full one may have more behind it. */
const footAfter = (page: CerberusActivity[]): CerberusFeedFoot => (page.length < PAGE_SIZE ? 'none' : 'more');

/**
 * One line is another when every field is. A line has no id of its own and one instant can hold many
 * lines, so `at` alone cannot tell them apart; the `at` test just spares most stringifies.
 */
const sameLine = (a: CerberusActivity, b: CerberusActivity): boolean => a.at === b.at && JSON.stringify(a) === JSON.stringify(b);

/**
 * The feed's whole movement in one pure step, so the lines and the open row change together:
 * a re-read of the newest page keeps what was loaded BELOW it (the lines older than its oldest) and
 * puts the open row wherever its line now stands, or shuts it when the line is gone; an earlier page
 * only appends, so the open row stays where it was.
 *
 * The list is always one unbroken run of the record. A re-read joins the held lines only when its page
 * reaches down to the held head; when more than a page of lines landed since (a reconnect after a
 * long sleep), the lines between could never be shown, and a foot saying "Show earlier" could never
 * read them, so the held lines are let go and the foot says what the new page says. An earlier page
 * asked from a cursor the list no longer ends at is dropped for the same reason.
 */
function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'newest-reading':
      return state.lines === null ? { ...state, failed: false } : state;
    case 'newest-landed': {
      const { page } = action;
      if (state.lines === null) return { ...state, lines: page, failed: false, earlier: footAfter(page) };
      const oldest = page[page.length - 1];
      const head = state.lines[0];
      // A page that holds the held head's instant (its oldest is no newer than the head) joins them.
      const joined = oldest !== undefined && head !== undefined && oldest.at <= head.at;
      const tail = joined ? state.lines.filter((line) => line.at < oldest.at) : [];
      const lines = [...page, ...tail];
      const open = state.openIndex === null ? undefined : state.lines[state.openIndex];
      const moved = open === undefined ? -1 : lines.findIndex((line) => sameLine(line, open));
      // A tail that was kept still has its own foot. With none left, an earlier page already out will
      // land under these lines (it was asked from a cursor at or below the page's oldest), and
      // otherwise the foot is only what the newest page itself says.
      const earlier = joined && (tail.length > 0 || state.earlier === 'reading') ? state.earlier : footAfter(page);
      return { lines, failed: false, earlier, openIndex: moved < 0 ? null : moved };
    }
    case 'newest-failed':
      // A failed re-read over rows already on screen says nothing: the rows are still true.
      return state.lines === null ? { ...state, failed: true } : state;
    case 'earlier-reading':
      return state.lines === null ? state : { ...state, earlier: 'reading' };
    case 'earlier-landed': {
      if (state.lines === null) return state;
      const oldest = state.lines[state.lines.length - 1];
      // A page asked from a cursor older than the line the list now ends at would leave a hole.
      if (oldest !== undefined && action.before < oldest.at) return state;
      // Only what is older than the oldest line now held: a re-read may have reached past the cursor
      // this page was asked from.
      const older = oldest === undefined ? action.page : action.page.filter((line) => line.at < oldest.at);
      return { ...state, lines: [...state.lines, ...older], earlier: footAfter(action.page) };
    }
    case 'earlier-failed': {
      const oldest = state.lines === null ? undefined : state.lines[state.lines.length - 1];
      // The read that failed was for a list that has since been let go: its failure says nothing now.
      if (state.lines === null || (oldest !== undefined && action.before < oldest.at)) return state;
      return { ...state, earlier: 'failed' };
    }
    case 'toggled':
      return { ...state, openIndex: state.openIndex === action.index ? null : action.index };
  }
}

/** One page of `GET /api/cerberus/activity`, or `null` when it did not answer with one. */
async function readPage(query: { before?: number; limit: number }): Promise<CerberusActivity[] | null> {
  try {
    const response = await api.cerberus.activity(query);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return Array.isArray(body) ? (body as CerberusActivity[]) : null;
  } catch {
    // No answer at all, or a body that is not JSON: this app's own network. The feed says it could not
    // be read and offers Try again.
    return null;
  }
}

/**
 * HISTORY'S FEED, every line that happened, newest first and paged: `GET /api/cerberus/activity`.
 *
 * The newest 40 are read when the view opens, and read AGAIN on `cerberus_changed` frames (at most one
 * read a second, the last frame of a burst always read) and at once on a reconnect, which missed
 * frames — a frame names what moved, never a line, so the answer to it is always the newest page
 * again. Each Show earlier reads the page before the oldest line held
 * (`before` is exclusive) and appends it. Subscribed BEFORE the first read, as the providers are, so a
 * frame landing between the two starts its own read.
 *
 * `lines` is `null` until the first page answers, and `failed` says that first page did not. `earlier`
 * is the foot of the list. `openIndex` is the open row's position, held here because a re-read puts
 * rows at the head: the list and the open row move in one step, so the row that stays open is always
 * the line the person opened.
 *
 * Used by History's `HistoryView`, which hands it to `EventsCard`; the Fleet's What happened reads the
 * overview's seven lines instead.
 */
export function useActivityFeed(): {
  lines: CerberusActivity[] | null;
  failed: boolean;
  earlier: CerberusFeedFoot;
  openIndex: number | null;
  toggle: (index: number) => void;
  loadEarlier: () => Promise<void>;
  retry: () => void;
} {
  const { subscribe } = useWebSocket();

  // The lines held, the foot under them and the open row, as one value: a re-read has to move the
  // lines and the open row together, which two separate states could not do in one step.
  const [state, dispatch] = useReducer(feedReducer, FEED_START);

  // Mount flag: a page that lands after the view closed must not dispatch.
  const mountedRef = useRef(true);

  // Which read of the newest page this is. Reads overlap (the mount's, a frame's, a Try again), so
  // each takes a ticket.
  const newestReadRef = useRef(0);

  // The newest ticket whose GOOD page has been published, as the providers keep it. A good page older
  // than one already published is dropped, so the feed never goes back to an older head; a read that
  // FAILED moves no mark, so a good page still in flight when a newer read fails can still land.
  const newestAnswerRef = useRef(0);

  const readNewest = useCallback(async () => {
    const ticket = ++newestReadRef.current;
    const page = await readPage({ limit: PAGE_SIZE });
    if (!mountedRef.current) return;
    if (page === null) {
      dispatch({ type: 'newest-failed' });
      return;
    }
    if (ticket < newestAnswerRef.current) return;
    newestAnswerRef.current = ticket;
    dispatch({ type: 'newest-landed', page });
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Frame-driven reads: the first goes at once, and one that arrives inside the gap waits for the gap
    // to end — a single queued read stands for every frame that lands before it fires.
    let lastFrameReadAt = 0;
    let queuedRead: number | null = null;
    const readForFrame = () => {
      if (queuedRead !== null) return;
      const wait = lastFrameReadAt + FRAME_READ_GAP_MS - Date.now();
      if (wait <= 0) {
        lastFrameReadAt = Date.now();
        void readNewest();
        return;
      }
      queuedRead = window.setTimeout(() => {
        queuedRead = null;
        lastFrameReadAt = Date.now();
        void readNewest();
      }, wait);
    };

    // A reconnect missed frames, so it reads at once and unthrottled.
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'cerberus_changed') readForFrame();
      else if (event.kind === 'websocket_reconnected') void readNewest();
    });
    void readNewest();
    return () => {
      mountedRef.current = false;
      unsubscribe();
      if (queuedRead !== null) window.clearTimeout(queuedRead);
    };
  }, [readNewest, subscribe]);

  const loadEarlier = async () => {
    const oldest = state.lines?.[state.lines.length - 1];
    // One earlier page at a time: the press that finds one out does nothing.
    if (oldest === undefined || state.earlier === 'reading') return;
    const before = oldest.at;
    dispatch({ type: 'earlier-reading' });
    const page = await readPage({ before, limit: PAGE_SIZE });
    if (!mountedRef.current) return;
    dispatch(page === null ? { type: 'earlier-failed', before } : { type: 'earlier-landed', before, page });
  };

  /** Try again on a first page that did not answer: the placeholder is back while it reads. */
  const retry = () => {
    dispatch({ type: 'newest-reading' });
    void readNewest();
  };

  const toggle = (index: number) => dispatch({ type: 'toggled', index });

  return { lines: state.lines, failed: state.failed, earlier: state.earlier, openIndex: state.openIndex, toggle, loadEarlier, retry };
}
