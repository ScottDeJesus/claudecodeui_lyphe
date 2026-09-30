import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { createAnchorStore } from '@/modules/chat-host/utils/anchorStore';
import { placeNode } from '@/modules/chat-host/utils/placeNode';
import type { AnchorStore, ChatPlacement, HostMove, HostWindowValue } from '@/shared/types';

/** What the rest of the app may ask of the chat's host: where the chat is drawn, and the three verbs that move it and tell it where the FAB is. */
type ChatHostValue = {
  placement: ChatPlacement;
  /** Floats the chat. MUST run inside the press. Does nothing while no chat is mounted. */
  open: () => void;
  /** Brings the chat home: takes the panel down. */
  collapse: () => void;
  /** The FAB's drawn rect, which the panel stands beside and follows; null when there is none. */
  reportAnchor: (rect: DOMRect | null) => void;
};

/** What `ChatHostSlot` tells the provider about the chat it holds. */
type ChatHostFacts = {
  sessionId: string | null;
  showing: boolean;
};

/**
 * What the slot and the hosts share and nothing else may touch: the node the chat lives in, the one
 * function that carries it between hosts, and the announcement every window-bound line of the chat
 * hears.
 */
type ChatHostMechanics = {
  /** The one `div` the chat is portalled into. Created once, moved between hosts, never recreated. */
  node: HTMLDivElement;
  /** Carries `node` into `target` as the last child; a no-op when it is already there. */
  moveTo: (target: HTMLElement, floating: boolean) => void;
  subscribeMove: (listener: (move: HostMove) => void) => () => void;
  /** What `HostWindowProvider` hands the chat: the window it stands in and the move subscription. */
  hostWindowValue: HostWindowValue;
  /** The chat tab's home element, registered by the slot on mount and cleared on unmount. */
  setHomeElement: (element: HTMLElement | null) => void;
  /** The slot's facts, or null when it unmounts — which takes a floating chat home, because a chat that is gone has nothing left to float. */
  publishFacts: (facts: ChatHostFacts | null) => void;
  /** The FAB's rect, read by the floating panel alone through `useSyncExternalStore`. */
  anchorStore: AnchorStore;
};

const ChatHostContext = createContext<ChatHostValue | null>(null);
const ChatHostMechanicsContext = createContext<ChatHostMechanics | null>(null);

/** Runs one listener without letting it stop the move: a throwing listener costs its own window-bound line, never the chat's carriage between hosts. */
function tellListener(listener: (move: HostMove) => void, move: HostMove): void {
  try {
    listener(move);
  } catch (error) {
    console.error('[chat-host] a move listener threw while the chat changed hosts', move, error);
  }
}

/**
 * Used by project-workspace's ProjectWorkspaceShell, above the whole workspace, so the slot in the chat tab and every floating host read one node and one placement.
 *
 * THE NODE IS THE CHAT'S ONLY PARENT. The live chat renders through a portal into one detached `div`
 * this provider creates once — even at home. Switching between rendering in place and portalling
 * would give ChatInterface a different parent fiber, and React would remount it; a chat that only
 * ever portals into the same node keeps its fiber, and moving the node moves the chat with its
 * composer draft, its scroll position and its stream intact.
 */
export function ChatHostProvider({ children }: { children: ReactNode }) {
  // Where the chat is drawn. State because the shell, the slot and the floating host all draw by it;
  // `open` and `collapse` (and a slot that unmounts) are its only writers. Never stored: every load
  // opens with the chat home.
  const [placement, setPlacement] = useState<ChatPlacement>('home');

  // The window the chat's node stands in. State because the chat's window-bound code re-binds when it
  // changes (it reaches them through `HostWindowProvider`). Set in `moveTo`, from the target's document.
  const [hostWindow, setHostWindow] = useState<Window>(() => window);

  // The chat's one node, created once and never recreated; state only as a lazy initialiser that never
  // changes. `flex h-full min-h-0 flex-col` makes it fill whatever host it stands in as a column.
  const [node] = useState(() => {
    const div = document.createElement('div');
    div.className = 'flex h-full min-h-0 flex-col';
    div.dataset.chatHostNode = '';
    return div;
  });

  // Everyone who hears moves; state only as a lazy initialiser that never changes, so a subscription
  // made in one render is the one a move emits to in the next.
  const [moveListeners] = useState(() => new Set<(move: HostMove) => void>());

  // The FAB's rect, in an external store that only the panel reads (`useSyncExternalStore`). State
  // because a drag of the FAB moves it many times a second and the panel must follow every move; a
  // React state here would re-render everything under the provider on each one. A lazy initialiser
  // that never changes, so the store the panel subscribed to is the one `reportAnchor` writes.
  const [anchorStore] = useState(createAnchorStore);

  // What the slot publishes, kept in refs: nothing draws from them, so a change must not re-render the
  // workspace. `collapse` reads the home element and `open` reads the mounted fact; `sessionId` and
  // `showing` wait for the readers that arrive with the unread rule.
  const homeElementRef = useRef<HTMLElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const showingRef = useRef(false);
  const mountedRef = useRef(false);

  const subscribeMove = useCallback((listener: (move: HostMove) => void) => {
    moveListeners.add(listener);
    return () => {
      moveListeners.delete(listener);
    };
  }, [moveListeners]);

  const emit = useCallback((move: HostMove) => {
    // A copy, so a listener that unsubscribes while it hears the move cannot skip the next one.
    for (const listener of [...moveListeners]) tellListener(listener, move);
  }, [moveListeners]);

  const moveTo = useCallback((target: HTMLElement, floating: boolean) => {
    if (node.parentElement === target) return;
    // ONE SYNCHRONOUS STEP: the window-bound code hears 'before' while the node still stands in the
    // host it is leaving (it flushes what a closing window would lose, and records the reader's
    // place), then the node moves, then 'after' lands. No frame paints between the two. The context's
    // `hostWindow` follows on the next render, so an 'after' listener that needs the new window
    // right now reads it off its own element's document.
    emit({ phase: 'before', floating });
    placeNode(node, target);
    const targetWindow = target.ownerDocument.defaultView;
    if (targetWindow) setHostWindow(targetWindow);
    emit({ phase: 'after', floating });
  }, [node, emit]);

  const setHomeElement = useCallback((element: HTMLElement | null) => {
    homeElementRef.current = element;
  }, []);

  const publishFacts = useCallback((facts: ChatHostFacts | null) => {
    sessionIdRef.current = facts?.sessionId ?? null;
    showingRef.current = facts?.showing ?? false;
    mountedRef.current = facts !== null;
    // A floating host whose chat unmounts collapses. The slot's home goes down in the same commit, so
    // there is nowhere to carry the node to and the placement alone comes home; the node leaves with
    // the panel, and the next slot adopts it. The updater form because this runs in a cleanup that
    // holds no placement of its own.
    if (facts === null) setPlacement((current) => (current === 'home' ? current : 'home'));
  }, []);

  const open = useCallback(() => {
    // A chat that is not mounted has nothing to float: the panel would be a header over an empty body.
    if (!mountedRef.current) return;
    setPlacement('panel');
  }, []);

  const collapse = useCallback(() => {
    // From the panel, the node moves home NOW, while the panel is still mounted: `moveBefore` then keeps
    // the composer's caret and the widget frames alive, where React removing the panel first would
    // detach the node with it. With no home element (the slot has unmounted) there is nowhere to go and
    // only the placement changes.
    const home = homeElementRef.current;
    if (home) moveTo(home, false);
    setPlacement('home');
  }, [moveTo]);

  const hostWindowValue = useMemo<HostWindowValue>(
    () => ({ hostWindow, subscribeMove }),
    [hostWindow, subscribeMove],
  );

  const reportAnchor = anchorStore.set;

  const value = useMemo<ChatHostValue>(
    () => ({ placement, open, collapse, reportAnchor }),
    [placement, open, collapse, reportAnchor],
  );

  const mechanics = useMemo<ChatHostMechanics>(
    () => ({ node, moveTo, subscribeMove, hostWindowValue, setHomeElement, publishFacts, anchorStore }),
    [node, moveTo, subscribeMove, hostWindowValue, setHomeElement, publishFacts, anchorStore],
  );

  return (
    <ChatHostContext.Provider value={value}>
      <ChatHostMechanicsContext.Provider value={mechanics}>{children}</ChatHostMechanicsContext.Provider>
    </ChatHostContext.Provider>
  );
}

/** Used by this module's slot and floating host, and through the barrel by project-workspace: WorkspaceMain reads where the chat is drawn (the gutters stand down while it floats), WorkspaceFrame hands the FAB's rect to `reportAnchor`, and `useChatDoor` builds the chat's one door from `open` and `collapse`. */
export function useChatHost(): ChatHostValue {
  const context = useContext(ChatHostContext);
  if (!context) throw new Error('useChatHost must be used within <ChatHostProvider>');
  return context;
}

/** Module-internal (kept out of the barrel): the slot and the floating host read the node, its carriage and the anchor store through it. */
export function useChatHostMechanics(): ChatHostMechanics {
  const context = useContext(ChatHostMechanicsContext);
  if (!context) throw new Error('useChatHostMechanics must be used within <ChatHostProvider>');
  return context;
}
