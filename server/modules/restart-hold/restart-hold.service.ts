import type { RestartHoldReason } from '@/shared/restart-hold-types.js';

/**
 * The server's one picture of "busy", for the dev supervisor's restart hold.
 *
 * A save under `server/` boots the edited server beside this one and retires this one. Doing that while Kaylee is
 * in a turn, or he is talking to her, cuts him off mid-sentence, so the supervisor holds a save until this server
 * says it is quiet (`deploy/dev-supervisor/README.md`). THE SERVER IS BUSY while any of these holds:
 *   - a Kaylee turn is in flight on either account, her own last turn (her compaction) included;
 *   - a chat run is streaming (this one yields: the supervisor stops counting it once a save has waited its ceiling);
 *   - a press of his is open on her panel (the talk button recording, her name opening a recording, or a clip out for
 *     transcription), or her voice is still sounding there. NOT the ears merely listening for her name: with the
 *     switch on that mic is open all day, and counting it would hold every save for ever;
 *   - less than the quiet tail has passed since anything was said or typed to her;
 *   - this boot is a handover successor that has not yet finished its takeover duties (re-adopting the chat runs, saying
 *     Kaylee's unanswered words again). Until then its picture is empty by omission, not by quiet.
 *
 * EVENTS ONLY. Each source tells this module when it changes; the tail is one timer, armed by his last word and
 * re-armed by the next, and the settle below is the only other clock. Nothing reads a source on a schedule.
 *
 * Consumed by `server/index.ts` (the sink, the chat-run feed), `modules/companion` (turns, his words),
 * `modules/websocket` (the panel's mic and voice) and `restart-hold.routes.ts` (the read).
 */

/**
 * How long after his last word to her the server still counts as busy. Measured 2026-11-04 from her CLI transcripts
 * (`.verify/restart-hold-tail.mjs`, 1,035 returns to an idle her inside a conversation): half of his returns come
 * within 9 s, 85% within 88 s, 90% within 124 s — 90 s covers 85.4% of them, and the next 30 s buys four points.
 */
const QUIET_TAIL_MS = 90_000;

/**
 * How long the picture must stay empty before the supervisor is told "quiet". The supervisor restarts on the first
 * quiet it hears, and work often hands on to more work in the instant it ends: a turn's end, then her context reading
 * and her last turn; a run's end, then the queued follow-up that starts on it. Busy is told at once; quiet only after
 * this much of it, cancelled by anything that turns busy meanwhile.
 */
const QUIET_SETTLE_MS = 3_000;

/** The reasons standing now, by source. A source holds at most one; setting it again replaces its reason. */
const standing = new Map<string, RestartHoldReason>();
/** The panels (websocket connections) that say their press is open or her voice is sounding. Cleared with the connection. */
const pressConnections = new Set<object>();
const voiceConnections = new Set<object>();
let tailTimer: NodeJS.Timeout | null = null;
let settleTimer: NodeJS.Timeout | null = null;

let sink: ((reasons: RestartHoldReason[]) => void) | null = null;
/** The reasons the sink was last told, as JSON; a report that finds the same words tells nothing. */
let lastTold: string | null = null;

function readReasons(): RestartHoldReason[] {
  return [...standing.values()].sort((a, b) => a.why.localeCompare(b.why));
}

function tellNow(): void {
  if (sink === null) return;
  const reasons = readReasons();
  const told = JSON.stringify(reasons);
  if (told === lastTold) return;
  lastTold = told;
  sink(reasons);
}

/** Something moved: busy is told at once, an empty picture only once it has held for the settle. */
function report(): void {
  if (sink === null) return;
  if (standing.size > 0) {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    tellNow();
    return;
  }
  if (settleTimer !== null || lastTold === '[]') return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    tellNow();
  }, QUIET_SETTLE_MS);
  // A breadcrumb timer must never be the reason the process stays alive.
  settleTimer.unref();
}

function setStanding(source: string, reason: RestartHoldReason | null): void {
  if (reason === null) standing.delete(source);
  else standing.set(source, reason);
  report();
}

/** A connection is in a set while it says so; the set holds one reason while any connection is in it. */
function joinOrLeave(connections: Set<object>, connection: object, active: boolean): void {
  if (active) connections.add(connection);
  else connections.delete(connection);
}

function restatePanelReasons(): void {
  setStanding('press', pressConnections.size > 0 ? { why: 'his press is open on her panel', yields: false } : null);
  setStanding('voice', voiceConnections.size > 0 ? { why: 'her voice is playing on her panel', yields: false } : null);
}

/** Consumed by `server/index.ts`, `modules/companion` and `modules/websocket`; the module's one surface. */
export const restartHold = {
  /** Kaylee's turn on one account is in flight or is not, her last turn included. Told by the companion session on every turn start and end. */
  kayleeTurn(userId: number, inFlight: boolean): void {
    setStanding(`kaylee-${userId}`, inFlight ? { why: `Kaylee is in a turn (account ${userId})`, yields: false } : null);
  },

  /** Whether any chat run is streaming. Told by the chat-run feed (`followChatRuns`) on a run's start and end. */
  chatRuns(streaming: boolean): void {
    setStanding('chat-runs', streaming ? { why: 'a chat run is streaming', yields: true } : null);
  },

  /** A handover boot has not finished its takeover duties (`true`, set while it boots) or has (`false`, in the duties' `finally`). Told by `server/index.ts`. */
  takingOver(active: boolean): void {
    setStanding('takeover', active ? { why: 'this server is still taking over from the previous one', yields: false } : null);
  },

  /** Words of his reached Kaylee — typed, spoken, or a press that carried none. Arms the quiet tail, or re-arms it from now. */
  spokenToKaylee(): void {
    if (tailTimer !== null) clearTimeout(tailTimer);
    setStanding('tail', { why: `he spoke or typed to Kaylee in the last ${QUIET_TAIL_MS / 1000} s`, yields: false });
    tailTimer = setTimeout(() => {
      tailTimer = null;
      setStanding('tail', null);
    }, QUIET_TAIL_MS);
    tailTimer.unref();
  },

  /** What one panel (one websocket) says of itself: his press open (recording, or a clip out), her voice sounding. Told on change only, by `chat-websocket.service.ts`. */
  panelSounding(connection: object, state: { press: boolean; voice: boolean }): void {
    joinOrLeave(pressConnections, connection, state.press);
    joinOrLeave(voiceConnections, connection, state.voice);
    restatePanelReasons();
  },

  /** A panel's socket closed: whatever it said about its press and her voice goes with it. */
  panelGone(connection: object): void {
    const hadPress = pressConnections.delete(connection);
    const hadVoice = voiceConnections.delete(connection);
    if (hadPress || hadVoice) restatePanelReasons();
  },

  /** What the server is busy with now; empty when quiet. */
  read(): RestartHoldReason[] {
    return readReasons();
  },

  /**
   * Starts telling the supervisor. Called once by the entrypoint right after READY, and tells the current picture at
   * once, quiet included: the supervisor treats a child that never reported as quiet, and one that reported as exactly
   * what it said.
   */
  tell(listener: (reasons: RestartHoldReason[]) => void): void {
    sink = listener;
    lastTold = null;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    tellNow();
  },
};

/** What `followChatRuns` needs of the run registry: its change feed and a count of the runs streaming. */
type ChatRunRegistryView = {
  onRunChanged(listener: (appSessionId: string, change: { states: boolean }) => void): () => void;
  listRunningRuns(): unknown[];
};

/**
 * Follows the chat runs: told when a run starts or ends (`states` changes — the registry also announces every streamed
 * line, which moves nothing here), it reads whether any is still streaming. Takes the registry as a shape rather than
 * importing it: the websocket module imports this one. Returns the unsubscribe. Consumed by `server/index.ts`.
 */
export function followChatRuns(registry: ChatRunRegistryView): () => void {
  const read = (): void => restartHold.chatRuns(registry.listRunningRuns().length > 0);
  read();
  return registry.onRunChanged((_appSessionId, { states }) => {
    if (states) read();
  });
}
