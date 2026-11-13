import { useReducer } from 'react';

import { useFeedEvents } from '@/modules/upload-runs/hooks/useRunsFeed';
import type { RunsFeed } from '@/modules/upload-runs/hooks/useRunsFeed';
import { useRunStream } from '@/modules/upload-runs/hooks/useRunStream';
import { lastSeqOf } from '@/modules/upload-runs/utils/lastSeq';
import type { LiveStep } from '@/modules/upload-runs/utils/uploadsModel';
import { AWAITING } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadRunEvent, UploadRunSummary } from '@/shared/upload-runs-types';
import { firstLine } from '@/shared/utils';

/** How many events behind the row's newest the live stream is opened, so its first replay holds the newest tool call or words. */
const REPLAY_BACK = 50;

/** The longest newest step the card holds: it clamps to two lines, and a whole turn of the agent's words need not be kept. */
const WORDS_MAX = 400;

/** What the live run's stream has said since it was opened, for one run. Counts are kept as the `seq`s seen, so the row's own counts can be added to the ones it has not counted. */
type Tracked = {
  sid: string;
  words: string | null;
  /** Whether the run works or waits on a person, as its newest `state` bubble said; null until one has. */
  working: boolean | null;
  walkStep: string | null;
  toolCallSeqs: number[];
  turnSeqs: number[];
};

type TrackedAction =
  | { type: 'bubble'; sid: string; event: UploadRunEvent }
  | { type: 'walk'; sid: string; stepCursor: string | null };

const fresh = (sid: string): Tracked => ({ sid, words: null, working: null, walkStep: null, toolCallSeqs: [], turnSeqs: [] });

/** The first line of the agent's words, cut to what the card keeps; null when it said nothing. */
function wordsOf(text: string | undefined): string | null {
  const line = firstLine(text);
  return line === '' ? null : line.slice(0, WORDS_MAX);
}

/** The `seq`s with one more, once: a stream opened again after the view was hidden replays events already seen, and an event is never counted twice. */
const withSeq = (seqs: number[], seq: number): number[] => (seqs.includes(seq) ? seqs : [...seqs, seq]);

function reduceBubble(base: Tracked, event: UploadRunEvent): Tracked {
  switch (event.kind) {
    case 'tool_use':
      return { ...base, words: event.tool?.summary || base.words, toolCallSeqs: withSeq(base.toolCallSeqs, event.seq) };
    case 'assistant_text':
      return { ...base, words: wordsOf(event.text) ?? base.words };
    case 'turn_end':
      return { ...base, turnSeqs: withSeq(base.turnSeqs, event.seq) };
    case 'state':
      return { ...base, working: event.meta?.to !== AWAITING };
    default:
      return base;
  }
}

/** A run that is not the one tracked starts the record afresh: another run's words never stand under this one's name. */
function reduceTracked(state: Tracked | null, action: TrackedAction): Tracked | null {
  const base = state !== null && state.sid === action.sid ? state : fresh(action.sid);
  return action.type === 'walk' ? { ...base, walkStep: action.stepCursor } : reduceBubble(base, action.event);
}

const countPast = (seqs: readonly number[], floor: number): number => seqs.filter((seq) => seq > floor).length;

/**
 * What the live run is doing right now. The run is the registry's live one from the overview (`null` while there is none and
 * while the view is hidden: nothing is opened for it). Its own stream gives the newest step, the newest tool call's one-line
 * summary or what the agent last said; the feed's walk frames for it give the step its flow walk stands at; the stream's
 * `state` bubbles say whether it works or waits on a person.
 *
 * TURNS AND TOOL CALLS are the row's counts plus the `turn_end` and `tool_use` bubbles the stream has shown whose `seq` is
 * past the row's `last_seq`: the row is written behind the events, so the bubbles it has not counted yet are exactly those.
 * When the row is read again (on a frame) its counts catch up and the same sum stays right.
 *
 * The stream is made once for the run and closed when the run ends or the view hides; the run's end reaches the view as the
 * feed's `ended` frame, which re-reads the overview and clears the live run.
 *
 * Used by this module's `useUploadsRead`, which hands the result to the root as `read.live`.
 */
export function useLiveRun(live: UploadRunSummary | null, feed: RunsFeed): LiveStep | null {
  const sid = live?.session_id ?? null;
  const rowLastSeq = live === null ? 0 : lastSeqOf(live);
  // What the stream and the feed have said of the live run. Essential and not derivable: it accumulates from events.
  const [tracked, track] = useReducer(reduceTracked, null);

  useRunStream(sid, {
    from: () => Math.max(0, rowLastSeq - REPLAY_BACK),
    onBubble: (event) => {
      if (sid !== null) track({ type: 'bubble', sid, event });
    },
  });

  useFeedEvents(feed, (event) => {
    if (sid === null || event.kind !== 'frame' || event.frame.type !== 'walk' || event.frame.session_id !== sid) return;
    track({ type: 'walk', sid, stepCursor: event.frame.step_cursor });
  });

  if (live === null) return null;
  const mine = tracked !== null && tracked.sid === live.session_id ? tracked : null;
  return {
    words: mine?.words ?? null,
    walkStep: mine?.walkStep ?? null,
    working: mine?.working ?? live.state !== AWAITING,
    turns: live.counts.turns + countPast(mine?.turnSeqs ?? [], rowLastSeq),
    toolCalls: live.counts.tool_calls + countPast(mine?.toolCallSeqs ?? [], rowLastSeq),
  };
}
