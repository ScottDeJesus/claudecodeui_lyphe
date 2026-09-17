import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ChatMessage, SoulLaunchSnapshot } from '@/shared/types';
import { useSoulLaunches } from '@/modules/dispatch-souls';
import {
  describeLatestActivity,
  isRefusedLaunch,
  readSubagentSummary,
  subagentMarkProvider,
  type SubagentMarkProvider,
  type SubagentSummary,
} from '@/modules/chat/utils/subagentSummary';
import { dismissPin, useDismissedPins } from '@/modules/chat/utils/pinnedDismissals';

/**
 * The rows a conversation pins: the agents and launcher souls working for it right now, and the
 * ones that finished until the reader dismisses them — sorted into ONE list, because the reader is
 * asking one question of it (what is working for me right now) and the answer would be a lie if
 * half of it were somewhere else.
 *
 * Moved verbatim out of the strip that drew them (`transcript/PinnedSubagents.tsx`) when a second
 * surface — the desktop gutters' Subagents widget — needed the same rows. The derivation is a pure
 * move: same entries, same windows, same ordering, so anything reading either surface sees the
 * rows it saw before. The one deliberate change is where dismissals come from: the shared store
 * (`utils/pinnedDismissals.ts`) instead of a private `useState`, because the two surfaces draw the
 * same rows at the same time and a dismissal in one must reach the other.
 *
 * The strip's own docblock holds the reasoning for the windows and the two kinds of pin; this file
 * holds the arithmetic.
 */

/**
 * How long a "running" agent is still believed. A backgrounded agent is only ever declared
 * finished by its task-notification, and that notification can be compacted out of a transcript
 * — leaving a stored row that says `running` forever and would otherwise re-pin a long-dead
 * agent every time the conversation is opened. Well past any real run; short of a day.
 *
 * A SOUL NEEDS NO SUCH DISCOUNT, and that is the difference between the two kinds in one line: an
 * agent's `running` is a flag stored in a file that nothing ever clears, while a soul's is a live
 * reading of `/proc` taken by the server two seconds ago — a soul whose process is gone is already
 * reported finished. The only window a soul shares with an agent is the one below.
 */
const RUNNING_BELIEVED_FOR_MS = 4 * 60 * 60 * 1000;

/**
 * How long a FINISHED pin stays offered for dismissal. Not a substitute for the reader's
 * dismissal — it bounds a reopened conversation, whose every agent of the last week would
 * otherwise pile into the strip at once.
 */
const FINISHED_SHOWN_FOR_MS = 2 * 60 * 60 * 1000;

/** One row of the pinned list, whichever kind it is: what to draw, and what to sort it by. */
type AgentEntry = {
  kind: 'agent';
  key: string;
  startedAtMs: number;
  endedAtMs: number;
  running: boolean;
  id: string;
  /**
   * What a dismissal of this row is remembered under: the id, or the id and the resume for an
   * agent resumed since — so a pin dismissed after one run comes back when the agent is resumed.
   */
  dismissKey: string;
  provider?: SubagentMarkProvider;
  latest: string;
  summary: SubagentSummary;
};

type SoulEntry = {
  kind: 'soul';
  key: string;
  startedAtMs: number;
  endedAtMs: number;
  running: boolean;
  launch: SoulLaunchSnapshot;
};

/**
 * A row the surfaces draw. Exported because two components outside this hook discriminate on it —
 * `transcript/PinnedSubagents.tsx` and the gutters' Subagents widget — and it stays module-local
 * because its element type references the module-local `SubagentSummary`, the same precedent that
 * type follows.
 */
export type PinnedSubagentRow = AgentEntry | SoulEntry;

/** Running first, oldest launch on top; then the finished, newest finish on top. */
function byRunningThenTime(a: PinnedSubagentRow, b: PinnedSubagentRow): number {
  if (a.running !== b.running) return a.running ? -1 : 1;
  if (a.running) return a.startedAtMs - b.startedAtMs;
  return b.endedAtMs - a.endedAtMs;
}

/**
 * When a row's own window closes and the list must repaint without it, in epoch ms — or `null` for
 * a row that has no deadline at all.
 *
 * The two kinds answer differently, and for a reason: an agent's `running` is a stored flag with
 * nothing to end it, so even a live one is only BELIEVED for four hours; a soul's is the server's
 * reading of `/proc` taken two seconds ago, so a soul that is out has no clock on it anywhere and
 * ends when it ends. A row whose stamp is not a number is exempt by the filters above, and is
 * exempt here too rather than being given a deadline it was never judged against.
 */
function expiryOf(entry: PinnedSubagentRow): number | null {
  if (entry.kind === 'soul') {
    return entry.running ? null : entry.endedAtMs + FINISHED_SHOWN_FOR_MS;
  }
  if (entry.running) {
    return Number.isFinite(entry.startedAtMs) ? entry.startedAtMs + RUNNING_BELIEVED_FOR_MS : null;
  }
  return Number.isFinite(entry.endedAtMs) ? entry.endedAtMs + FINISHED_SHOWN_FOR_MS : null;
}

/**
 * The pinned rows of one conversation, and the reader's act on them.
 *
 * `soulLaunchIds` is passed in rather than scanned here: the scan has to be memoized against a
 * transcript that changes on every streamed token, and the caller's own memo key is the messages
 * it already holds.
 */
export function usePinnedSubagentRows(
  messages: ChatMessage[],
  soulLaunchIds: string[],
): { rows: PinnedSubagentRow[]; dismiss: (id: string) => void } {
  const dismissed = useDismissedPins();

  const launchesById = useSoulLaunches();
  const now = Date.now();

  const agentEntries: PinnedSubagentRow[] = messages
    .filter((message) => message.isSubagentContainer)
    // A launch the harness refused before any agent existed (a hook denial or an operator
    // rejection, with no agent metadata) never worked for this conversation and is not pinned;
    // the transcript's own tool row shows the refusal. An agent that ran and then errored keeps
    // its row.
    .filter((message) => !(isRefusedLaunch(message.toolResult) && !message.subagent))
    .map((message): AgentEntry => {
      const id = String(message.toolId ?? '');
      // A resumed agent started again when its resume landed: the four-hour belief window and the
      // running sort run from there, not from a launch that may be hours old.
      const startedAtMs = new Date(message.subagent?.resume?.at ?? message.timestamp).getTime();
      const summary = readSubagentSummary({
        toolInput: message.toolInput,
        toolResult: message.toolResult,
        toolResultAt: message.toolResultAt as string | number | Date | undefined,
        subagent: message.subagent,
        activity: message.subagentActivity,
        usage: message.subagentUsage,
      });
      return {
        kind: 'agent',
        // Prefixed so the two kinds can never collide in one keyed list, whatever their ids are.
        key: `agent:${id}`,
        startedAtMs,
        endedAtMs: summary.finishedAt ? new Date(summary.finishedAt).getTime() : startedAtMs,
        running: summary.status === 'running',
        id,
        dismissKey: message.subagent?.resume ? `${id}@${message.subagent.resume.toolUseId}` : id,
        provider: subagentMarkProvider(message.subagentProvider, message.subagentModel),
        latest: describeLatestActivity(message.subagentActivity),
        summary,
      };
    })
    .filter((entry) => !dismissed.has(entry.dismissKey))
    .filter((entry) => {
      if (entry.running) {
        return !Number.isFinite(entry.startedAtMs) || now - entry.startedAtMs < RUNNING_BELIEVED_FOR_MS;
      }
      return !Number.isFinite(entry.endedAtMs) || now - entry.endedAtMs < FINISHED_SHOWN_FOR_MS;
    });

  // Not memoized, deliberately: the window below is measured against the clock at RENDER time, so
  // a memo keyed on that clock would either recompute on every render anyway or key on a stale
  // reading. The caller is the memo boundary (`memo` on the strip) and it only re-renders when a
  // lane push, the transcript, or the one timer above actually moves it, which is where the cost
  // of walking a handful of ids belongs.
  const soulEntries: PinnedSubagentRow[] = [];
  for (const id of soulLaunchIds) {
    const launch = launchesById.get(id);
    // An id the lane knows nothing about draws nothing: the transcript's receipt says a soul was
    // launched, and the lane is the only thing that can say it is still there. This is also what
    // ages a pin out for good — the lane drops a launch six hours after it ends, and the row goes
    // with it even though the receipt is still in the transcript.
    if (!launch) continue;
    if (dismissed.has(launch.launch_id)) continue;
    const startedAtMs = launch.started_at * 1000;
    const endedAtMs = launch.ended_at === null ? startedAtMs : launch.ended_at * 1000;
    if (launch.state !== 'running' && now - endedAtMs >= FINISHED_SHOWN_FOR_MS) continue;
    soulEntries.push({
      kind: 'soul',
      key: `soul:${launch.launch_id}`,
      startedAtMs,
      endedAtMs,
      running: launch.state === 'running',
      launch,
    });
  }

  const rows = [...agentEntries, ...soulEntries].sort(byRunningThenTime);

  const nextExpiryMs = rows.reduce<number>((soonest, entry) => {
    const expiry = expiryOf(entry);
    return expiry === null ? soonest : Math.min(soonest, expiry);
  }, Number.POSITIVE_INFINITY);

  // The windows above are measured against a clock read at RENDER, and nothing else would re-render
  // a list with nothing happening in it — the lane broadcasts on a change only, and a finished row
  // holds no timer of its own. So one timeout is armed for the moment the next row crosses its own
  // window, off that same render clock so the deadline and the test that judges it are one reading;
  // the render it wakes recomputes the deadline and arms the one after it. Whatever the render
  // cadence, the timer's absolute moment is `nextExpiryMs` — re-arming only shortens the wait.
  // Without this a finished row sat there until an unrelated repaint, up to four hours past its window.
  const msUntilExpiry = Number.isFinite(nextExpiryMs) ? Math.max(0, nextExpiryMs - now) : null;
  // A repaint counter, not a value: the render it orders exists only to re-read the clock above.
  const [, recheckWindows] = useState(0);
  useEffect(() => {
    if (msUntilExpiry === null) return;
    const timer = window.setTimeout(() => recheckWindows((tick) => tick + 1), msUntilExpiry);
    return () => window.clearTimeout(timer);
  }, [msUntilExpiry]);

  // The rows hand back the id they were drawn with; the dismissal is filed under the row's key.
  // Read through a ref so `dismiss` keeps one identity and the memoized rows stay memoized.
  const dismissKeyByIdRef = useRef(new Map<string, string>());
  const dismissKeys = agentEntries.map((entry) => (entry.kind === 'agent' ? `${entry.id}\u0000${entry.dismissKey}` : '')).join('\u0001');
  // Layout effect: filled before paint, so no click can reach `dismiss` ahead of it.
  useLayoutEffect(() => {
    dismissKeyByIdRef.current = new Map(
      dismissKeys.split('\u0001').filter(Boolean).map((pair) => pair.split('\u0000') as [string, string]),
    );
  }, [dismissKeys]);
  const dismiss = useCallback((id: string) => {
    dismissPin(dismissKeyByIdRef.current.get(id) ?? id);
  }, []);

  return { rows, dismiss };
}
