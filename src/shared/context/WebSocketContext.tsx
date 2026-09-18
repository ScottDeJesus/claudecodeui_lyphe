import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/modules/auth';
import { IS_PLATFORM } from '@/shared/utils';
import { expireAuthSession, isAuthTokenExpired } from '@/shared/authToken';
import type { ServerEvent } from '@/shared/types';


type ServerEventListener = (event: ServerEvent) => void;

/** How long the socket may go without a frame from the server before a background send first proves it alive. */
const QUIET_BEFORE_PROBE_MS = 25_000;
/**
 * The same, for a frame a person pressed something for. A socket can die while the page is on screen
 * (a network switch raises no `offline`), and a send into it is lost for good, so a user's frame
 * trusts only a socket the server spoke on moments ago; otherwise it costs one ping round trip.
 */
const QUIET_BEFORE_PROBE_USER_MS = 3_000;
/**
 * How long a probe waits for any frame back before the socket is treated as dead and replaced.
 * Probes run on the send path too, so a live link whose round trip nears this loses its socket on a
 * press, and the frame waits out the reconnect instead of arriving late.
 */
const PROBE_TIMEOUT_MS = 4_000;
/** The most frames held for delivery; past it the oldest background frame is dropped first. */
const OUTBOX_MAX = 50;
/**
 * How long a frame the user acted for may wait before it is given up: long enough for a slow
 * recovery — a failed probe, a refused attempt, the retry, a handshake over cellular — to finish,
 * short enough that a server that is really gone is said so. While a send waits, its spinner is
 * held (`hasQueuedSend`, read by the running-sessions poll), so a second press takes the composer's
 * queue path rather than becoming a second `chat.send` the server would refuse.
 */
const USER_FRAME_TTL_MS = 30_000;
/** Frames a person pressed something for — the ones that must either go out or say they did not. */
const USER_FRAME_TYPES = new Set(['chat.send', 'chat.edit-send', 'chat.abort', 'chat.permission-response']);

type OutboxEntry = { body: string; type: string; sessionId: string | null; at: number };

const frameField = (message: unknown, key: string): string | null => {
  const value = message && typeof message === 'object' ? (message as Record<string, unknown>)[key] : null;
  return typeof value === 'string' ? value : null;
};

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  /** Whether a `chat.send` or `chat.edit-send` for this session is still waiting for the connection. */
  hasQueuedSend: (sessionId: string) => boolean;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames cannot be coalesced or
   * dropped. Frames are deliberately not copied into React state; each
   * listener updates only the state owned by the feature that handles it.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  if (isAuthTokenExpired(token)) {
    expireAuthSession();
    return null;
  }
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  /**
   * Listener registry for the subscribe API. A ref (not state) because the
   * set must be readable synchronously inside `onmessage` and never trigger
   * re-renders of the provider tree.
   */
  const listenersRef = useRef(new Set<ServerEventListener>());
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { isLoading: isAuthLoading, token, user } = useAuth();
  /**
   * Frames waiting for a socket that is proven alive, in send order. A phone that slept, a network
   * that changed or a server restart leaves the socket closed or, worse, half-open: `readyState`
   * still reads OPEN while nothing reaches the server. Either way a send used to vanish until the
   * page was reloaded; here it waits and goes out the moment the connection is back.
   */
  const outboxRef = useRef<OutboxEntry[]>([]);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInboundAtRef = useRef(0);
  /** Set when the page was hidden or the network dropped: an OPEN socket is not believed until it answers. */
  const suspectRef = useRef(false);
  const probeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<() => void>(() => undefined);

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
  }, []);

  /**
   * Gives up the user frames that waited past their window. Each one is answered the way the server
   * answers a send it refuses — a `protocol_error` carrying the session — so the chat shows why the
   * message did not go and stops its spinner, and a fresh press sends it again with nothing queued.
   */
  const expireOutbox = useCallback(function expireOutbox() {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    const now = Date.now();
    const expired = outboxRef.current.filter((entry) => USER_FRAME_TYPES.has(entry.type) && now - entry.at >= USER_FRAME_TTL_MS);
    outboxRef.current = outboxRef.current.filter((entry) => !expired.includes(entry));
    // The next user frame still waiting sets the next check.
    const next = outboxRef.current.find((entry) => USER_FRAME_TYPES.has(entry.type));
    if (next) {
      expiryTimerRef.current = setTimeout(expireOutbox, Math.max(0, next.at + USER_FRAME_TTL_MS - now));
    }
    for (const entry of expired) {
      console.warn(`WebSocket: gave up a queued ${entry.type} after ${USER_FRAME_TTL_MS} ms without a connection`);
      // Without a session there is no conversation to tell, and a chat view would pin it on the
      // one on screen.
      if (!entry.sessionId) continue;
      dispatch({
        kind: 'protocol_error',
        code: 'NOT_DELIVERED',
        error: 'Not sent: the connection to the server did not come back in time. Send it again.',
        sessionId: entry.sessionId,
        timestamp: new Date().toISOString(),
      });
    }
  }, [dispatch]);

  const flushOutbox = useCallback((socket: WebSocket) => {
    expireOutbox();
    while (outboxRef.current.length > 0 && socket.readyState === WebSocket.OPEN) {
      socket.send(outboxRef.current[0].body);
      outboxRef.current.shift();
    }
  }, [expireOutbox]);

  const clearProbe = useCallback(() => {
    if (probeTimerRef.current) {
      clearTimeout(probeTimerRef.current);
      probeTimerRef.current = null;
    }
  }, []);

  // Named function expression so the reconnect timer below can call itself
  // without reading the `connect` binding while it is still initializing.
  const connect = useCallback(function connect() {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    if (!IS_PLATFORM && (isAuthLoading || !user)) return;
    try {
      // Construct WebSocket URL
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      const websocket = new WebSocket(wsUrl);
      // Store connecting sockets too, so a token refresh can close them before
      // their handshake completes with stale credentials.
      wsRef.current = websocket;

      websocket.onopen = () => {
        lastInboundAtRef.current = Date.now();
        suspectRef.current = false;
        clearProbe();
        setIsConnected(true);
        if (hasConnectedRef.current) {
          // Every subscriber re-subscribes on the reconnect below with its CURRENT cursor. A
          // subscribe queued while the socket was down carries the cursor from then, and the server
          // would replay the same window twice — streamed text has no id to dedupe it by.
          outboxRef.current = outboxRef.current.filter((entry) => entry.type !== 'chat.subscribe');
          // This is a reconnect — signal so components can catch up on missed messages
          dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
        }
        hasConnectedRef.current = true;
        flushOutbox(websocket);
      };

      websocket.onmessage = (event) => {
        // Any frame at all proves the socket alive, so it answers a pending probe too.
        lastInboundAtRef.current = Date.now();
        const probing = probeTimerRef.current !== null;
        if (probing) {
          clearProbe();
          suspectRef.current = false;
        }
        try {
          if (probing) {
            // The socket lived, but a subscribe waited long enough for its cursor to go stale, and
            // replaying from it would double streamed text. The same socket gets the reconnect
            // treatment instead: the stale ask is dropped and every subscriber asks again from now.
            const staleSubscribe = outboxRef.current.some((entry) => entry.type === 'chat.subscribe');
            outboxRef.current = outboxRef.current.filter((entry) => entry.type !== 'chat.subscribe');
            flushOutbox(websocket);
            if (staleSubscribe) dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
          }
          const data = JSON.parse(event.data) as ServerEvent;
          if (data.kind === 'pong') return; // the probe's answer; no feature reads it
          // A server older than the probe refuses `chat.ping` without a session, which a chat view
          // would pin on the conversation on screen. The refusal still proved the socket alive.
          if (data.kind === 'protocol_error' && data.code === 'UNKNOWN_MESSAGE_TYPE'
            && String(data.error).includes('chat.ping')) return;
          dispatch(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        if (wsRef.current !== websocket) {
          return;
        }
        clearProbe();
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return; // Prevent reconnection if unmounted
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [clearProbe, dispatch, flushOutbox, isAuthLoading, token, user]); // reconnect with current authentication state

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /** Drop whatever socket is held and open a new one now, instead of waiting out a retry timer. */
  const reconnectNow = useCallback(() => {
    if (unmountedRef.current) return;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    clearProbe();
    const stale = wsRef.current;
    if (stale) {
      stale.onopen = null;
      stale.onmessage = null;
      stale.onclose = null;
      stale.onerror = null;
      stale.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    connectRef.current();
  }, [clearProbe]);

  /**
   * Prove the socket alive: send a ping and wait for any frame back. No answer inside the window
   * means the socket is half-open, so it is replaced, and the outbox goes out on the new one.
   */
  const probe = useCallback(() => {
    if (probeTimerRef.current) return;
    const socket = wsRef.current;
    if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      reconnectNow();
      return;
    }
    if (socket.readyState === WebSocket.CONNECTING) return; // its onopen flushes the outbox
    socket.send(JSON.stringify({ type: 'chat.ping' }));
    probeTimerRef.current = setTimeout(() => {
      probeTimerRef.current = null;
      if (wsRef.current === socket) reconnectNow();
    }, PROBE_TIMEOUT_MS);
  }, [reconnectNow]);

  // Coming back to the page or the network is exactly when the socket may have died unseen, so it
  // is checked then — before the next send needs it, and so the reconnect's catch-up runs at once.
  useEffect(() => {
    const distrust = () => {
      suspectRef.current = true;
    };
    const recheck = () => {
      suspectRef.current = true;
      probe();
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? recheck() : distrust());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', recheck);
    window.addEventListener('offline', distrust);
    window.addEventListener('pageshow', recheck);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', recheck);
      window.removeEventListener('offline', distrust);
      window.removeEventListener('pageshow', recheck);
    };
  }, [probe]);

  // Declared after `connect` so the effect body does not reference it before
  // initialization. `connect` is memoized on [dispatch, isAuthLoading, token,
  // user] and `dispatch` is stable, so depending on it reconnects on exactly
  // the same transitions as the previous [isAuthLoading, token, user] list.
  useEffect(() => {
    // The cleanup below sets unmountedRef = true. Without this reset, every
    // re-run of the effect (e.g. on token refresh) would short-circuit connect()
    // at its unmounted guard and leave the socket permanently disconnected.
    unmountedRef.current = false;
    if (!IS_PLATFORM && (isAuthLoading || !user)) {
      return undefined;
    }
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clearProbe();
      const activeSocket = wsRef.current;
      if (activeSocket) {
        // Prevent the intentionally closed, old-token socket from scheduling
        // a reconnect after the refreshed-token effect has already started.
        activeSocket.onopen = null;
        activeSocket.onmessage = null;
        activeSocket.onclose = null;
        activeSocket.onerror = null;
        activeSocket.close();
        wsRef.current = null;
      }
    };
  }, [clearProbe, connect, isAuthLoading, user]); // reconnect after authentication or token refresh

  /**
   * Sends at once over a socket known to be alive. Otherwise the frame joins the outbox — behind
   * anything already waiting, so order holds — and the socket is proven or replaced first.
   */
  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    const type = frameField(message, 'type') ?? '';
    const quietLimit = USER_FRAME_TYPES.has(type) ? QUIET_BEFORE_PROBE_USER_MS : QUIET_BEFORE_PROBE_MS;
    const trusted = socket?.readyState === WebSocket.OPEN
      && !suspectRef.current
      && outboxRef.current.length === 0
      && Date.now() - lastInboundAtRef.current < quietLimit;
    if (socket && trusted) {
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        console.error('WebSocket: a frame could not be serialised and was not sent', error);
      }
      return;
    }
    let body: string;
    try {
      body = JSON.stringify(message);
    } catch (error) {
      console.error('WebSocket: a frame could not be serialised and was not sent', error);
      return;
    }
    const outbox = outboxRef.current;
    // Stop pressed over a message that has not left: the message is taken back, never delivered and
    // then killed. The abort goes nowhere — no run exists for it — and the chat says what happened.
    const stopSessionId = type === 'chat.abort' ? frameField(message, 'sessionId') : null;
    const unsent = stopSessionId
      ? outbox.filter((entry) => entry.sessionId === stopSessionId && (entry.type === 'chat.send' || entry.type === 'chat.edit-send'))
      : [];
    if (stopSessionId && unsent.length > 0) {
      outboxRef.current = outbox.filter((entry) => !unsent.includes(entry));
      dispatch({
        kind: 'protocol_error',
        code: 'NOT_DELIVERED',
        error: 'Stopped before it was sent: the message never reached the server.',
        sessionId: stopSessionId,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    // Asking twice for the same session state while offline gets the same answer twice.
    if (type === 'chat.subscribe' && outbox.some((entry) => entry.body === body)) {
      probe();
      return;
    }
    outbox.push({ body, type, sessionId: frameField(message, 'sessionId'), at: Date.now() });
    if (outbox.length > OUTBOX_MAX) {
      const background = outbox.findIndex((entry) => !USER_FRAME_TYPES.has(entry.type));
      const [dropped] = outbox.splice(background === -1 ? 0 : background, 1);
      console.warn(`WebSocket: outbox full, dropped a queued ${dropped.type}`);
    }
    if (USER_FRAME_TYPES.has(type) && !expiryTimerRef.current) {
      expiryTimerRef.current = setTimeout(expireOutbox, USER_FRAME_TTL_MS);
    }
    probe();
  }, [dispatch, expireOutbox, probe]);

  const hasQueuedSend = useCallback((sessionId: string) => outboxRef.current.some(
    (entry) => entry.sessionId === sessionId && (entry.type === 'chat.send' || entry.type === 'chat.edit-send'),
  ), []);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    hasQueuedSend,
    subscribe,
    isConnected
  }), [sendMessage, hasQueuedSend, subscribe, isConnected]);

  return value;
};

/** Mounted once by App; owns the single chat websocket that the chat, project-workspace and task-master modules subscribe to. */
export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
