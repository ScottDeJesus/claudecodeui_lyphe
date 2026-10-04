import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useUnreadReply } from '@/modules/chat-host/hooks/useUnreadReply';
import { createAnchorStore } from '@/modules/chat-host/utils/anchorStore';
import { placeNode } from '@/modules/chat-host/utils/placeNode';
import type { AnchorStore, ChatPlacement, HostMove, HostWindowValue } from '@/shared/types';

/** What the rest of the app may ask of the chat's host: where the chat is drawn, whether a reply is waiting out of sight, and the verbs that move it and tell it what the FAB and the main region are doing. */
type ChatHostValue = {
  placement: ChatPlacement;
  /** The open picture-in-picture window, or null — for the hotkey, which must hear keys pressed in it. */
  pipWindow: Window | null;
  /** A reply landed in the chat's conversation while the chat was out of sight (the unread rule). */
  unread: boolean;
  /** Floats the chat. MUST run inside the press. A press while a window is being opened does nothing, and neither does one while no chat is mounted. */
  open: () => void;
  /** Brings the chat home: closes the window, whose `pagehide` moves the chat home, or takes the panel down. */
  collapse: () => void;
  /** The FAB's drawn rect, which the panel stands beside and follows; null when there is none. */
  reportAnchor: (rect: DOMRect | null) => void;
  /** Whether an application covers the main region — a fact of the unread rule. */
  reportCovered: (covered: boolean) => void;
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
  /** Carries the node to the chat tab and settles the placement at home. The picture-in-picture window's `pagehide` runs it, and `collapse` runs it from the panel. */
  comeHome: () => void;
  /** The FAB's rect, read by the floating panel alone through `useSyncExternalStore`. */
  anchorStore: AnchorStore;
};

/** The first-open size of the picture-in-picture window, in CSS pixels; the browser remembers the size the reader gives it after that, and code never positions the window. */
const PIP_FIRST_WIDTH_PX = 420;
const PIP_FIRST_HEIGHT_PX = 680;

/** The Document Picture-in-Picture API, or undefined where the browser has none (Firefox, Safari, an insecure address). */
function documentPictureInPictureApi() {
  return 'documentPictureInPicture' in window ? window.documentPictureInPicture : undefined;
}

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
 *
 * THE UNREAD RULE lives here because the provider is the one place that knows where the chat is, which
 * conversation it shows and whether that tab is showing: `useUnreadReply` lights `unread` when a reply
 * lands while the chat is out of sight and clears it when the chat is seen. The one fact from outside is
 * whether an application covers the main region, which the workspace reports (`reportCovered`).
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

  // The facts the slot publishes, or null while no slot is mounted. State because the unread rule reads
  // them to know whether the chat is on screen and which conversation it shows, and a change (a new
  // session, the tab switching) must be able to clear the dot; only this provider re-renders on it — its
  // `children` element is the same one, and the context value below does not carry them.
  const [facts, setFacts] = useState<ChatHostFacts | null>(null);

  // Whether an application covers the main region, as WorkspaceFrame reports it. State because the unread
  // rule reads it: a chat tab under an application is out of sight though it is the selected tab.
  const [covered, setCovered] = useState(false);

  // The open picture-in-picture window, or null. State because the hotkey binds to it and the window host
  // draws in it; written together with `placement` ('window' exactly while this is set), never apart.
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  // What `collapse` and `open` read at the moment of a press, kept in refs: nothing draws from them. The
  // home element is where a floating chat goes home to; `mountedRef` is whether a chat exists to float,
  // held apart from `facts` so `open` keeps one identity for the provider's life. `placementRef` and
  // `pipRef` are `placement` and `pipWindow` as of the last WRITE, not the last render: a press lands in
  // the gap between a window arriving and React drawing it, and must see the window.
  const homeElementRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(false);
  const placementRef = useRef<ChatPlacement>('home');
  const pipRef = useRef<Window | null>(null);
  // The window request in flight, or null. `abandoned` is set by a `collapse` (or a chat that unmounts)
  // that arrives before the window does, and the window is closed the moment it arrives.
  const openingRef = useRef<{ abandoned: boolean } | null>(null);

  const changePlacement = useCallback((next: ChatPlacement) => {
    placementRef.current = next;
    setPlacement(next);
  }, []);

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

  const publishFacts = useCallback((published: ChatHostFacts | null) => {
    setFacts(published);
    mountedRef.current = published !== null;
    if (published !== null) return;
    // A floating host whose chat unmounts collapses. A window still being opened is closed the moment
    // it arrives; one that is open is closed now, and its `pagehide` settles the placement like any
    // other way the window goes. From the panel the slot's home goes down in the same commit, so there
    // is nowhere to carry the node to and the placement alone comes home; the node leaves with the
    // panel, and the next slot adopts it.
    if (openingRef.current) openingRef.current.abandoned = true;
    if (pipRef.current) pipRef.current.close();
    else if (placementRef.current !== 'home') changePlacement('home');
  }, [changePlacement]);

  const comeHome = useCallback(() => {
    // The node moves home NOW, while the host it leaves is still mounted: the widget frames keep running
    // through `moveBefore` (and `placeNode` gives a focused composer its focus and caret back), where
    // React removing the panel first would detach the node with it. With no home element (the slot has
    // unmounted) there is nowhere to go and only the placement changes.
    const home = homeElementRef.current;
    if (home) moveTo(home, false);
    pipRef.current = null;
    setPipWindow(null);
    changePlacement('home');
  }, [moveTo, changePlacement]);

  const open = useCallback(() => {
    // A chat that is not mounted has nothing to float: the host would be a header over an empty body.
    // Already floating, or a window on its way, means the press has nothing to add.
    if (!mountedRef.current || placementRef.current !== 'home' || openingRef.current) return;

    // THE REQUEST IS THE FIRST THING THIS PRESS DOES, and it is made synchronously: it spends the press's
    // user activation, which nothing awaited ahead of it would still have.
    const pictureInPicture = documentPictureInPictureApi();
    if (!pictureInPicture) {
      changePlacement('panel');
      return;
    }
    const request = { abandoned: false };
    openingRef.current = request;

    // A refusal (no user activation left, a browser policy, an extension's request that throws) still gives
    // the press its answer: the panel. It always clears `openingRef`, or every later press would find a
    // window "on its way" and do nothing for the life of the page.
    const refuse = (refusal: unknown) => {
      openingRef.current = null;
      console.warn('[chat-host] the picture-in-picture window was refused; the chat floats in the panel instead', refusal);
      if (!request.abandoned) changePlacement('panel');
    };

    // `Promise.resolve` because the request is a promise in the browser and whatever an extension or polyfill
    // makes of it elsewhere; a throw is caught for the same reason.
    let arrival: Promise<Window | undefined>;
    try {
      arrival = Promise.resolve(pictureInPicture.requestWindow({ width: PIP_FIRST_WIDTH_PX, height: PIP_FIRST_HEIGHT_PX }));
    } catch (thrown) {
      refuse(thrown);
      return;
    }
    arrival.then(
      (arrived) => {
        if (!arrived) {
          refuse(new TypeError('requestWindow resolved without a window'));
          return;
        }
        openingRef.current = null;
        // A window closed out of band (another tab's window replacing it, the window manager) before it
        // reached us has no `pagehide` left to tell us, so it is not adopted: the chat stays home.
        if (request.abandoned || !mountedRef.current || arrived.closed) {
          arrived.close();
          return;
        }
        pipRef.current = arrived;
        setPipWindow(arrived);
        changePlacement('window');
      },
      refuse,
    );
  }, [changePlacement]);

  const collapse = useCallback(() => {
    if (openingRef.current) {
      openingRef.current.abandoned = true;
      return;
    }
    // Every way a window goes is its `pagehide`: collapse only closes it, and the window host's listener
    // carries the chat home, so this press, the window's own close button and "back to tab" are one path.
    // A window that is already closed will never fire it (it went before the listener was attached, or the
    // event was missed), and closing it again would do nothing for ever: the chat comes home here instead.
    if (pipRef.current && !pipRef.current.closed) {
      pipRef.current.close();
      return;
    }
    comeHome();
  }, [comeHome]);

  // A provider that goes down takes the window with it; one still opening is closed when it arrives.
  useEffect(() => () => {
    if (openingRef.current) openingRef.current.abandoned = true;
    pipRef.current?.close();
  }, []);

  const hostWindowValue = useMemo<HostWindowValue>(
    () => ({ hostWindow, subscribeMove }),
    [hostWindow, subscribeMove],
  );

  const reportAnchor = anchorStore.set;

  // On screen: floating, or home on the chat tab with no application over the main region. Derived, never
  // stored — it is the one question the unread rule asks of the placement, the slot and the cover.
  const onScreen = placement !== 'home' || ((facts?.showing ?? false) && !covered);
  const unread = useUnreadReply({ sessionId: facts?.sessionId ?? null, onScreen });

  const value = useMemo<ChatHostValue>(
    () => ({ placement, pipWindow, unread, open, collapse, reportAnchor, reportCovered: setCovered }),
    [placement, pipWindow, unread, open, collapse, reportAnchor],
  );

  const mechanics = useMemo<ChatHostMechanics>(
    () => ({ node, moveTo, subscribeMove, hostWindowValue, setHomeElement, publishFacts, comeHome, anchorStore }),
    [node, moveTo, subscribeMove, hostWindowValue, setHomeElement, publishFacts, comeHome, anchorStore],
  );

  return (
    <ChatHostContext.Provider value={value}>
      <ChatHostMechanicsContext.Provider value={mechanics}>{children}</ChatHostMechanicsContext.Provider>
    </ChatHostContext.Provider>
  );
}

/** Used by this module's slot and floating host, and through the barrel by project-workspace: WorkspaceMain reads where the chat is drawn (the gutters stand down while it floats), WorkspaceFrame hands the FAB's rect to `reportAnchor` and whether an application covers the main region to `reportCovered`, and `useChatDoor` builds the chat's one door from `open`, `collapse` and `unread`. */
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
