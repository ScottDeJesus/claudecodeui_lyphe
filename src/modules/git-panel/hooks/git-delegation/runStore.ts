import type { GitDelegationState, ServerEvent } from '@/shared/types';
import type { FinishedRun } from '@/modules/git-panel/hooks/git-delegation/deriveOutcome';
import {
  readCommand,
  readResultText,
  stageOfCommand,
  STAGE_ORDER,
} from '@/modules/git-panel/hooks/git-delegation/runEvidence';
import { armProbeDeadline, armSilence, clearWatchdog } from '@/modules/git-panel/hooks/git-delegation/runWatchdog';

/**
 * The delegated run, kept OUTSIDE React.
 *
 * The workspace mounts the git panel with `{activeTab === 'git' && <GitPanel …/>}`, so leaving the
 * tab unmounts the panel and everything a component held with it — while the agent carries on
 * committing and pushing every repository in the checkpoint. The run's identity, its subscription,
 * its watchdog and the card's state therefore live here, at module scope.
 *
 * ⚠ Module scope is per DOCUMENT, so this is memory, not truth: a reload, a second tab and an HMR
 * update each get an empty one. `findLiveRun` asks the server instead, and `adoptRun` below is how
 * a document that missed the press picks the run up. Memory is the fast path; the server is the
 * guard.
 */

/** What the store needs from the websocket. Handed in at the press; both are stable app-wide. */
type Wire = {
  sendMessage: (message: unknown) => void;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
};

/** The run being followed, plus everything its frames have said so far. */
type ActiveRun = {
  projectId: string;
  sessionId: string;
  startedAt: number;
  aheadWhenStarted: number | null;
  lastSeq: number;
  agentError: boolean;
  lastResultText: string;
  lastPushResultText: string;
  pushToolIds: Set<string>;
  /** When the gateway was last asked whether this run is still going, else null. */
  probeSentAt: number | null;
  /**
   * The run stopped answering and was reported as such, but nothing proved it over. The guard
   * stays closed until the SERVER stops listing it, and a late `complete` still settles it.
   */
  unsettled: boolean;
};

/** What a mounted panel reads. One object, replaced only when something in it changes. */
export type RunSnapshot = { state: GitDelegationState; pending: FinishedRun | null };

/** One value, one identity: re-publishing it is a no-op render rather than a new object. */
const IDLE: GitDelegationState = { phase: 'idle', startError: null, blockedBySessionId: null };

let run: ActiveRun | null = null;
let wire: Wire | null = null;
let unsubscribe: (() => void) | null = null;
let snapshot: RunSnapshot = { state: IDLE, pending: null };

const listeners = new Set<() => void>();

function publish(next: Partial<RunSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function stopListening(): void {
  clearWatchdog();
  unsubscribe?.();
  unsubscribe = null;
}

/**
 * Ends the run and publishes it for a panel to turn into a receipt.
 *
 * It does NOT read git itself: a store publish notifies `useSyncExternalStore` outside React's
 * batching, so a refresh awaited here can still be one render behind when the receipt is drawn —
 * measured, as a clean tree reported "not committed". The hook reads, then derives.
 *
 * `lostConnection` says only that we stopped hearing from it — never that it failed.
 */
function finish(ended: ActiveRun, lostConnection: boolean): void {
  clearWatchdog();
  if (lostConnection) {
    // The run may well still be going; we simply cannot see it. Keep the subscription so a late
    // frame can still settle this, and keep the guard closed until the card is dismissed.
    run = { ...ended, unsettled: true, probeSentAt: null };
  } else {
    run = null;
    stopListening();
  }

  publish({
    pending: {
      projectId: ended.projectId,
      sessionId: ended.sessionId,
      startedAt: ended.startedAt,
      aheadWhenStarted: ended.aheadWhenStarted,
      settledAt: Date.now(),
      agentError: ended.agentError,
      lostConnection,
      lastResultText: ended.lastPushResultText || ended.lastResultText,
    },
  });
}

/** Asks the gateway whether the run is still going. The answer arrives as `chat_subscribed`. */
function probeIsStillRunning(current: ActiveRun): void {
  current.probeSentAt = Date.now();
  wire?.sendMessage({
    type: 'chat.subscribe',
    sessions: [{ sessionId: current.sessionId, lastSeq: current.lastSeq }],
  });
  // No answer at all is the one thing that really does mean the socket is gone.
  armProbeDeadline(() => finish(current, true));
}

/** (Re)starts the silence watchdog. Every frame the run sends calls this. */
function armSilenceTimer(current: ActiveRun): void {
  armSilence(() => probeIsStillRunning(current));
}

/** Reduces one websocket frame for the run in flight. */
function handleFrame(event: ServerEvent): void {
  const current = run;
  if (!current) return;

  if (event.kind === 'websocket_reconnected') {
    // The gateway hands a run's live events to the sockets that asked for them, and nothing else
    // re-subscribes this session — the chat panel re-subscribes only the conversation it has open.
    // This frame carries no sessionId of its own, so it is read before the guard below.
    //
    // A run already reported as unheard-from is left alone: asking again only redraws the same
    // banner ten seconds later, and its receipt has already been read from git.
    if (!current.unsettled) probeIsStillRunning(current);
    return;
  }

  if (event.sessionId !== current.sessionId) return;

  if (typeof event.seq === 'number' && event.seq > current.lastSeq) current.lastSeq = event.seq;

  switch (event.kind) {
    case 'chat_subscribed': {
      // The answer to a question this store asked. `isProcessing` is the gateway's own word for
      // whether the run is alive, which is what separates a slow command from a dead socket.
      if (current.probeSentAt === null) return;
      current.probeSentAt = null;
      if (event.isProcessing === true) {
        // It was alive after all. The banner that said we had lost it is now the wrong screen —
        // and leaving it up puts an armed button over a run that every press will refuse.
        if (current.unsettled) {
          current.unsettled = false;
          publish({
            state: {
              phase: 'running',
              projectId: current.projectId,
              sessionId: current.sessionId,
              startedAt: current.startedAt,
              stage: 'starting',
            },
            pending: null,
          });
        }
        armSilenceTimer(current);
        return;
      }
      // Over, and we missed the end: a completed run is replayed to nobody. git can still say
      // what happened, so this ends as an ordinary outcome rather than as a lost connection.
      finish(current, false);
      return;
    }

    case 'tool_use': {
      armSilenceTimer(current);
      if (event.toolName !== 'Bash') return;
      const stage = stageOfCommand(readCommand(event.toolInput));
      if (!stage) return;
      if (stage === 'push' && typeof event.toolId === 'string') current.pushToolIds.add(event.toolId);
      const state = snapshot.state;
      if (state.phase === 'running' && STAGE_ORDER[stage] > STAGE_ORDER[state.stage]) {
        publish({ state: { ...state, stage } });
      }
      return;
    }

    case 'tool_result': {
      armSilenceTimer(current);
      const text = readResultText(event);
      current.lastResultText = text;
      // A checkpoint runs over several repositories, so the run's LAST word is rarely the push's.
      // Keeping the push's own result is what lets a rejection still name itself.
      if (typeof event.toolId === 'string' && current.pushToolIds.has(event.toolId)) {
        current.lastPushResultText = text;
      }
      return;
    }

    case 'error':
      armSilenceTimer(current);
      // The run broke. `complete` still follows it — that is the one terminal event every run ends
      // with — so the outcome is still taken from a refreshed read, not from here.
      current.agentError = true;
      return;

    case 'protocol_error':
      // A send the gateway REFUSED: no run started, so no `complete` will follow and this is the
      // terminal event. Logged verbatim — a refused field is a fact about the protocol.
      console.error('[GitDelegation] the gateway refused the send:', event.code, event.error);
      current.agentError = true;
      finish(current, false);
      return;

    case 'complete':
      finish(current, false);
      return;

    default:
      armSilenceTimer(current);
  }
}

/** Subscribes a mounted panel to the run. */
export function subscribeToRunStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const getRunSnapshot = (): RunSnapshot => snapshot;

/** The run in flight (or one that stopped answering), for the press guard. */
export const activeRun = (): { projectId: string; sessionId: string; unsettled: boolean } | null =>
  (run ? { projectId: run.projectId, sessionId: run.sessionId, unsettled: run.unsettled } : null);

/**
 * Starts following a run: subscribes, arms the watchdog and puts the card on it.
 *
 * Called by the press, and by `adoptRun` for a run this document did not start.
 */
export function beginRun(
  started: { projectId: string; sessionId: string; startedAt: number; aheadWhenStarted: number | null },
  nextWire: Wire,
): void {
  stopListening();
  wire = nextWire;
  run = {
    ...started,
    lastSeq: 0,
    agentError: false,
    lastResultText: '',
    lastPushResultText: '',
    pushToolIds: new Set(),
    probeSentAt: null,
    unsettled: false,
  };
  unsubscribe = nextWire.subscribe(handleFrame);
  armSilenceTimer(run);
  // A receipt still waiting to be drawn belongs to a run that is over; this one supersedes it.
  publish({
    state: { phase: 'running', projectId: started.projectId, sessionId: started.sessionId, startedAt: started.startedAt, stage: 'starting' },
    pending: null,
  });
}

/**
 * Picks up a run this document did not start — found on the server after a reload, in a second tab,
 * or after an HMR update orphaned the store that began it. It asks the gateway to put this socket
 * in the run's audience, which is what makes the steps tick here too.
 *
 * What it cannot know is how far ahead the branch was at the press, so the receipt carries no
 * "commits that were waiting" line rather than a guessed one.
 */
export function adoptRun(
  found: { projectId: string; sessionId: string; startedAt: number },
  nextWire: Wire,
): void {
  beginRun({ ...found, aheadWhenStarted: null }, nextWire);
  nextWire.sendMessage({ type: 'chat.subscribe', sessions: [{ sessionId: found.sessionId, lastSeq: 0 }] });
}

/**
 * Publishes the outcome a panel derived from its own refreshed git reads.
 *
 * A run that stopped answering is NOT released here — drawing its banner is not proof it is over,
 * so the guard stays closed and the socket stays subscribed. Only a dismiss the server agrees with.
 */
export function settleRun(state: GitDelegationState): void {
  publish({ state, pending: null });
}

/** Puts the receipt away. A run the server still lists keeps the guard — only `release` lets go. */
export function dismissRun(release = true): void {
  if (run?.unsettled && release) {
    run = null;
    stopListening();
  }
  publish({ state: IDLE, pending: null });
}
