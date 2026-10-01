import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

import type { ServerEvent,MarkSessionIdle,MarkSessionProcessing,PendingPermissionRequest,ProjectSession,LLMProvider,NormalizedMessage,StreamFlushTimer } from '@/shared/types';
import { showCompletionTitleIndicator } from '@/modules/chat/utils/pageTitleNotification';
import { useHostMove, useHostWindow } from '@/shared/context/HostWindowContext';
import { playChatCompletionSound, playNotificationSound } from '@/shared/utils';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { markPermissionSettled } from '@/modules/chat/tools/toolOutcome';
import { armStreamFlush, clearStreamFlush, flushStreamNow } from '@/modules/chat/utils/streamFlushTimer';

const isActionablePermissionRequest = (request: { toolName?: unknown } | null | undefined): boolean => {
  return request?.toolName !== 'ExitPlanMode' && request?.toolName !== 'exit_plan_mode';
};

/**
 * The identity a bell is owed to.
 *
 * A question is asked under TWO names. The `requestId` is the ATTEMPT's: `promptForToolDecision`
 * mints a fresh one every time a process raises the ask, so a re-issue carries a new id. The
 * `promptKey` is the ASK's own, and it survives the handover that hands the question to a successor
 * — the very reason `promptKeyFor` exists, learned on the phone's push (12 pushes for one question,
 * one per dev-server handover, measured 2026-09-22). Frame and subscribe-ack both carry it.
 *
 * So the bell reads the ask's name first, and falls back to the attempt's id for a producer that
 * stamps none: a frame with no key still rings, once per attempt — the only identity it carries.
 */
function announcementKeyOf(entry: Record<string, unknown>): string {
  if (typeof entry.promptKey === 'string' && entry.promptKey) return entry.promptKey;
  return typeof entry.requestId === 'string' ? entry.requestId : '';
}

/**
 * How many announcements one tab remembers.
 *
 * A key names one ask and is never reused for a second one: a new tool call is stamped a new tool
 * use id — hence a new `promptKey` — while the parked prompt a handover re-issues keeps the key it
 * was born with. So "this tab has rung for this ask" is a fact that stays true, and the list needs
 * no pruning — only a bound, so a tab left open for weeks does not hold every key it ever saw. The
 * oldest is forgotten first; the worst that costs is one repeat bell for a prompt pending since
 * before two hundred others arrived, which is a bell the operator was due anyway.
 */
const ANNOUNCED_PERMISSION_LIMIT = 200;

/**
 * Whether this tab is hearing about one ask for the first time — and, if so, remembers it.
 *
 * A prompt is a QUESTION, and the tab owes the operator one bell per question, not one per delivery.
 * The same question arrives more than once: a handover re-adopts the CLI host, the successor replays
 * the parked tool request, and the question is put back on the chat's wire under a FRESH request id
 * (measured 2026-09-28 across two handovers of one parked `AskUserQuestion`: a new id each time).
 * Keyed on the attempt, every handover was a new bell — the "done noise" a restart makes; keyed on
 * the ask, the question rings once.
 *
 * Both ring paths ask THIS question instead, and a question rung once is silent however many times
 * its frame or its ack arrives.
 */
function announceOnce(announced: Set<string>, key: string): boolean {
  if (announced.has(key)) return false;
  announced.add(key);
  if (announced.size > ANNOUNCED_PERMISSION_LIMIT) {
    // Insertion order is iteration order for a Set, so the first key is the oldest announcement.
    const oldest = announced.values().next().value;
    if (oldest !== undefined) announced.delete(oldest);
  }
  return true;
}

type UseChatRealtimeHandlersArgs = {
  isActive: boolean;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  provider: LLMProvider;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  pendingPermissionRequests: PendingPermissionRequest[];
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  streamTimerRef: MutableRefObject<StreamFlushTimer | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  /** The transcript's scroller: its own document names the window the chat stands in the moment a move lands. */
  scrollContainerRef: RefObject<HTMLElement | null>;
  /**
   * Highest live `seq` observed per session. Essential for reconnect catch-up:
   * `chat.subscribe` sends this value as `lastSeq` so the server replays only
   * the events this client actually missed. Written here on every sequenced
   * frame; read wherever a `chat.subscribe` is sent (session open, reconnect).
   */
  lastSeqRef: MutableRefObject<Map<string, number>>;
  /** When each session's `chat.subscribe` was last sent; guards stale idle acks. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  onWebSocketReconnect?: () => void;
  requestLatestMessages: (sessionId: string, allowNetwork?: boolean) => Promise<void>;
  sessionStore: SessionStore;
};

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

/**
 * Routes server events into the session store and processing-state map.
 *
 * This is intentionally a thin reducer over the unified `kind`-based
 * protocol: every frame is keyed by the stable app session id, so there is
 * no session-id handoff, no provider branching, and no navigation here.
 * Sidebar events (`session_upserted`, `loading_progress`) are handled by
 * `useProjectsState`, not in this hook.
 */
export function useChatRealtimeHandlers({
  isActive,
  subscribe,
  provider,
  selectedSession,
  currentSessionId,
  setTokenBudget,
  pendingPermissionRequests,
  setPendingPermissionRequests,
  streamTimerRef,
  accumulatedStreamRef,
  scrollContainerRef,
  lastSeqRef,
  statusCheckSentAtRef,
  onSessionProcessing,
  onSessionIdle,
  onWebSocketReconnect,
  requestLatestMessages,
  sessionStore,
}: UseChatRealtimeHandlersArgs) {
  // The window the next stream flush is armed on. A ref rather than state because the socket
  // listener reads it at arm time, nothing renders from it, and the context's `hostWindow` changes
  // on the render AFTER a move: a delta landing between the move and that render would otherwise
  // arm on the window the chat just left. The 'after' listener sets it from the transcript's own
  // element (the truth the instant the node lands); the layout effect keeps it in step with the
  // context whenever that changes.
  const hostWindow = useHostWindow();
  const armingWindowRef = useRef<Window>(hostWindow);
  useLayoutEffect(() => {
    armingWindowRef.current = hostWindow;
  }, [hostWindow]);
  useHostMove(({ phase }) => {
    if (phase === 'before') {
      // A flush pending on the window being left is run now, so a timer armed on a closing window
      // is never lost with it.
      flushStreamNow(streamTimerRef);
      return;
    }
    armingWindowRef.current = scrollContainerRef.current?.ownerDocument.defaultView ?? armingWindowRef.current;
  });

  // Session switches can send `chat.subscribe` before this effect has a chance
  // to rebind the websocket listener. Read the visible session id from a ref
  // so a fast `chat_subscribed` ack is matched against the current view, not
  // the previous render's closed-over selection.
  const activeViewSessionIdRef = useRef<string | null>(selectedSession?.id || currentSessionId || null);
  activeViewSessionIdRef.current = selectedSession?.id || currentSessionId || null;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // Keep the latest pending-permission snapshot available to the websocket
  // listener so back-to-back permission events can dedupe and re-arm the
  // notification sound before React finishes a rerender.
  const pendingPermissionRequestsRef = useRef(pendingPermissionRequests);

  useEffect(() => {
    pendingPermissionRequestsRef.current = pendingPermissionRequests;
  }, [pendingPermissionRequests]);

  /**
   * The asks this tab has already rung for (`announceOnce`). A ref and not state: it is read and
   * written inside the socket listener, and nothing renders from it.
   */
  const announcedPermissionRequestsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleEvent = (msg: ServerEvent) => {
      if (!msg.kind) {
        return;
      }

      const activeViewSessionId = activeViewSessionIdRef.current;
      const sid = (typeof msg.sessionId === 'string' && msg.sessionId) || activeViewSessionId;

      // Record replay progress for every sequenced live event.
      if (sid && typeof msg.seq === 'number') {
        const known = lastSeqRef.current.get(sid) ?? 0;
        if (msg.seq > known) {
          lastSeqRef.current.set(sid, msg.seq);
        }
      }

      switch (msg.kind) {
        case 'websocket_reconnected':
          onWebSocketReconnect?.();
          return;

        case 'history_truncated': {
          // An already-sent message was replaced. Every client watching this
          // session drops the superseded turns before the replacement streams
          // in, so a second tab does not end up showing the question twice.
          if (sid && typeof msg.anchorId === 'string') {
            sessionStore.truncateAt(sid, msg.anchorId);
          }
          return;
        }

        case 'chat_subscribed': {
          // Ack for chat.subscribe: authoritative processing state plus any
          // pending tool-permission prompts for the run.
          if (!sid) return;

          if (msg.isProcessing) {
            onSessionProcessing?.(sid);
          } else {
            // Idle ack: ignore it if a newer request started after the
            // subscribe was sent — the ack describes the older state.
            onSessionIdle?.(sid, {
              ifStartedBefore: statusCheckSentAtRef.current.get(sid),
            });
          }

          const isViewedSession = sid === activeViewSessionId;
          if (isViewedSession && Array.isArray(msg.pendingPermissions)) {
            const nextPendingPermissionRequests = msg.pendingPermissions as PendingPermissionRequest[];

            pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
            setPendingPermissionRequests(nextPendingPermissionRequests);

            // ONE BELL PER QUESTION on this path too. The ack's list is a fresh catalogue of what is
            // still awaiting the operator, and after a handover it names the prompt this tab was
            // already told about — under the fresh request id the successor re-raised it on, which
            // is exactly why the bell reads the ask's own key (`announcementKeyOf`).
            const announced = announcedPermissionRequestsRef.current;
            const freshlyAnnounced = nextPendingPermissionRequests.filter((request) => {
              const key = announcementKeyOf(request);
              return key !== '' && isActionablePermissionRequest(request) && announceOnce(announced, key);
            });
            if (freshlyAnnounced.length > 0) {
              void playNotificationSound();
            }
          }
          return;
        }

        case 'protocol_error': {
          console.error('[Chat] Protocol error:', msg.code, msg.error);
          if (sid) {
            // Surface the failure in the conversation and stop the spinner —
            // the run never started (or was rejected), so no `complete` follows.
            onSessionIdle?.(sid);
            sessionStore.appendRealtime(sid, {
              // Random suffix: the store replaces a row held under the same id, so two errors in
              // one millisecond must not share one.
              id: `protocol_error_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              sessionId: sid,
              timestamp: new Date().toISOString(),
              provider,
              kind: 'error',
              content: String(msg.error || 'Request failed'),
            } as NormalizedMessage);
          }
          return;
        }

        // Sidebar/global events — owned by useProjectsState.
        case 'session_upserted':
        case 'loading_progress':
          return;

        // A box-wide frame owned by the live bus, never a chat row: each RETURNs rather than
        // breaking, to say so and to stay off the provider path below.
        //
        // This list is a NAMING, not the fence. What keeps a box-wide frame out of the transcript
        // is the run stamp the append below checks, so a lane that lands tomorrow needs no edit
        // here — it carries no run stamp and never becomes a row. `universe_activity` is the case
        // that shows why the list alone was never enough: it is the estate's activity coalesced
        // and sent up to ten times a second for as long as anything in the estate is busy.
        case 'soul_launch_state':
        case 'universe_map':
        case 'universe_activity':
          return;

        default:
          break;
      }

      /* -------------------------------------------------------------- */
      /*  Provider NormalizedMessage handling                            */
      /* -------------------------------------------------------------- */

      // --- Streaming: buffer for performance ---
      if (msg.kind === 'stream_delta') {
        const text = (msg.content as string) || '';
        if (!text) return;
        accumulatedStreamRef.current += text;
        if (!streamTimerRef.current) {
          armStreamFlush(streamTimerRef, armingWindowRef.current, () => {
            if (sid) {
              sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
            }
          });
        }
        // Also route to store for non-active sessions
        if (sid && sid !== activeViewSessionId) {
          sessionStore.appendRealtime(sid, msg as unknown as NormalizedMessage);
        }
        return;
      }

      if (msg.kind === 'stream_end') {
        clearStreamFlush(streamTimerRef);
        if (sid) {
          if (accumulatedStreamRef.current) {
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
          }
          sessionStore.finalizeStreaming(sid);
        }
        accumulatedStreamRef.current = '';
        return;
      }

      // --- All other messages: route to store ---
      // A row joins the transcript only if the RUN WROTE IT. `ChatSessionWriter` hands every
      // provider frame to `ChatRunRegistry.decorateAndRecordEvent`, which stamps the run's
      // monotonic `seq` before the frame goes on the wire; a box-wide lane frame — `dispatcher_state`,
      // `kanban_metis_state`, `kanban_event`, `universe_*` — belongs to no run and carries none.
      //
      // Asking the stamp rather than the kind is the point, and the kind list above is why: a lane
      // reaches production before anyone remembers to add it there, and the frame that slips
      // through inherits the viewed session's id, is appended as a `NormalizedMessage` with no
      // `id`, and makes the store's merge read `id.startsWith` off `undefined`. That throw happens
      // inside the websocket listener, where the gateway's per-listener catch swallows it — so the
      // frame is lost, every frame after it is lost, and the open chat never moves again until a
      // reload rebuilds the store.
      const writtenByRun = typeof msg.seq === 'number';
      const shouldPersist =
        writtenByRun
        && msg.kind !== 'complete'
        && msg.kind !== 'status'
        && msg.kind !== 'permission_request'
        && msg.kind !== 'permission_resolved'
        && msg.kind !== 'permission_cancelled';

      if (sid && shouldPersist) {
        sessionStore.appendRealtime(sid, msg as unknown as NormalizedMessage);
      }

      // --- UI side effects for specific kinds ---
      switch (msg.kind) {
        case 'complete': {
          // Flush any remaining streaming state
          clearStreamFlush(streamTimerRef);
          if (sid && accumulatedStreamRef.current) {
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
            sessionStore.finalizeStreaming(sid);
          }
          accumulatedStreamRef.current = '';

          // `complete` is the unified terminal event — every provider run ends
          // with exactly one, regardless of success, failure, or abort. The
          // indicator derives from the processing map, so deleting the entry
          // hides it immediately and atomically.
          onSessionIdle?.(sid);
          if (sid === activeViewSessionId) {
            // Every ask on the composer is the run's own, and they end with it.
            pendingPermissionRequestsRef.current = [];
            setPendingPermissionRequests([]);
          }

          if (msg.aborted) {
            // Abort was requested — the complete event confirms it. No
            // further UI action is needed beyond clearing the entry above.
            break;
          }

          // Celebrate only successful runs (failed runs end with success: false). No announcement
          // bookkeeping here, unlike the two permission paths: a finished run's terminal frame
          // cannot be handed over a second time the way a parked prompt's can. The registry is not
          // what stops it — a completed run stays in it for five minutes
          // (`COMPLETED_RUN_RETENTION_MS`) and `replayEvents` has no status gate at all; the gate is
          // the caller's, `handleChatSubscribe`'s `if (isProcessing)`
          // (`chat-websocket.service.ts`), so only a RUNNING run's buffer is ever replayed.
          if (msg.success !== false) {
            showCompletionTitleIndicator();
            void playChatCompletionSound();
          }

          // The session id is stable for the whole conversation (allocated
          // before the first send), so the only follow-up is syncing the
          // viewed conversation with the now-persisted transcript.
          if (sid && sid === activeViewSessionId) {
            void requestLatestMessages(sid, isActiveRef.current);
          }

          break;
        }

        // 'error' is an informational message row, not a terminal event —
        // providers emit it for mid-run stderr output too. Run teardown is
        // always signalled by the unified 'complete' that follows.

        case 'permission_request': {
          if (!msg.requestId) break;
          // One bell per question (`announceOnce`): a re-issued frame for a prompt this tab has
          // already announced arrives on a fresh request id but carries the same ask, and stays
          // silent.
          const announcementKey = announcementKeyOf(msg);
          if (
            announcementKey !== ''
            && isActionablePermissionRequest({ toolName: msg.toolName })
            && announceOnce(announcedPermissionRequestsRef.current, announcementKey)
          ) {
            void playNotificationSound();
          }

          if (sid === activeViewSessionId) {
            const previousPendingPermissionRequests = pendingPermissionRequestsRef.current;
            if (!previousPendingPermissionRequests.some((request) => request.requestId === msg.requestId)) {
              const nextPendingPermissionRequests = [...previousPendingPermissionRequests, {
                requestId: msg.requestId as string,
                promptKey: typeof msg.promptKey === 'string' ? msg.promptKey : undefined,
                toolName: (msg.toolName as string) || 'UnknownTool',
                input: msg.input,
                context: msg.context,
                sessionId: sid || null,
                receivedAt: new Date(),
              }];

              pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
              setPendingPermissionRequests(nextPendingPermissionRequests);
            }
          }
          // A run's ask means its run is waiting.
          if (sid) {
            onSessionProcessing?.(sid);
          }
          break;
        }

        // `permission_resolved` arrives when any client answers the prompt: it
        // retracts a replayed `permission_request` after a mid-run refresh and
        // clears the prompt in other tabs watching the same run.
        case 'permission_resolved':
        case 'permission_cancelled': {
          // A fact about the run, recorded whichever session is on screen: the card that sent
          // the answer asks for it when a re-issued prompt arrives (`QuestionAnswerContent`).
          // Cancelled counts as settled — the server is done with the id either way.
          if (typeof msg.requestId === 'string') markPermissionSettled(msg.requestId);
          if (msg.requestId && sid === activeViewSessionId) {
            const nextPendingPermissionRequests = pendingPermissionRequestsRef.current.filter(
              (request: PendingPermissionRequest) => request.requestId !== msg.requestId,
            );

            pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
            setPendingPermissionRequests(nextPendingPermissionRequests);
          }
          break;
        }

        case 'status': {
          if (msg.text === 'token_budget' && msg.tokenBudget) {
            // The counter shows the viewed session's context; budgets from
            // other concurrently running sessions must not overwrite it.
            if (sid === activeViewSessionId) {
              setTokenBudget(msg.tokenBudget as Record<string, unknown>);
            }
          } else if (msg.text && sid) {
            onSessionProcessing?.(sid, {
              statusText: msg.text as string,
              canInterrupt: msg.canInterrupt !== false,
            });
          }
          break;
        }

        // text, tool_use, tool_result, thinking, task_notification
        // → already routed to store above, no UI side effects needed
        default:
          break;
      }
    };

    return subscribe(handleEvent);
  }, [
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onWebSocketReconnect,
    requestLatestMessages,
    sessionStore,
  ]);
}
