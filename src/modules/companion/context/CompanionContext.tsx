import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useCompanionFab } from '@/modules/companion/hooks/useCompanionFab';
import { useCompanionVoice } from '@/modules/companion/hooks/useCompanionVoice';
import { useTalkBinding } from '@/modules/companion/hooks/useTalkBinding';
import { useTalkPress } from '@/modules/companion/hooks/useTalkPress';
import { isCompanionPicture, reduceCompanion } from '@/modules/companion/utils/companionReducer';
import { api, refusalSentence } from '@/shared/api';
import type { CompanionFrame, CompanionPicture, CompanionSettings } from '@/shared/companion-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { CompanionVoice, TalkPress } from '@/shared/types';
import type { DockableFabPosition } from '@/shared/ui';
import { companionClientId } from '@/shared/utils';

type CompanionContextValue = {
  /** Her picture as this page holds it; null until the first read lands (and after a read that failed, until the next event re-reads). */
  picture: CompanionPicture | null;
  /** Whether her panel is open on this page. */
  open: boolean;
  /** This page's name for itself to her: the floor is whichever page last typed or opened her panel. */
  clientId: string;
  /** Opens or closes her panel here; opening tells her this page is the one she acts on. */
  setOpen: (open: boolean) => void;
  sendText: (text: string) => Promise<void>;
  /** Saves a partial of her settings; `register: null` restores the original register. Rejects with the server's sentence. */
  saveSettings: (patch: Partial<CompanionSettings> | { register: null }) => Promise<void>;
  editDraft: (text: string) => Promise<void>;
  /**
   * Sends the draft as it stands: a turn, or folded into the turn the target chat is running now. Resolves with what
   * happened ('started' or 'folded'); rejects with the server's own sentence when the send is refused, which the card shows.
   */
  sendDraft: (mode: 'turn' | 'steer') => Promise<string>;
  clearDraft: () => Promise<void>;
  dismissNote: (id: number) => Promise<void>;
  /** Stops her own turn. */
  interrupt: () => Promise<void>;
  /** Wipes her conversation and everything she keeps. */
  clear: () => Promise<void>;
  /**
   * This page's ONE talk press: the panel's talk button and the bound key or mouse button read it here, and
   * `useCompanionPresence` reads its `state` into the one state her status line draws. `state` runs idle → listening → transcribing → idle; `toggle` is one press, which
   * cuts her off first when this page's player is sounding; `error` is what failed on the page itself (the mic refused, the
   * clip not sent).
   */
  talk: TalkPress;
  /**
   * This page's voice: `on` / `setOn` its switch (this device's, `companion-voice` in localStorage, on by default), `speaking`
   * the sentence its player is sounding, `cut` true for the 900 ms after a press cut her off. Only the page that holds the
   * floor plays, and only while the switch is on; `useCompanionPresence` reads `speaking` and `cut` with the press into her status line's state.
   */
  voice: CompanionVoice;
  /**
   * The id of the chat she sent a draft to in the last four seconds (counted from the `companion_open_chat` frame this page
   * heard), else null. `useAvatarTarget` points the button at that chat's composer while it is set.
   */
  recentSend: string | null;
  /**
   * Where her disc rests, as he left it (`companion-fab` in localStorage): docked in the rail's cell, or a point. On a phone,
   * where the rail is tucked away, docked rests in her corner. Read by `CompanionFab`, which draws the disc there, and by
   * `CompanionDock`, which seats the disc only while it is docked.
   */
  fabPosition: DockableFabPosition;
  /** Sets and stores her rest: the release of a drag, docked or the point where he let go. */
  moveFab: (next: DockableFabPosition) => void;
  /** The rail cell's rect while the rail is docked (md and up) and the rect is on screen, else null: the place the disc docks to. */
  dockRect: DOMRect | null;
  /** The cell's report of its rect (null as it leaves, or below md); believed only while the rect is on screen. Stable for the page's life. */
  registerDock: (rect: DOMRect | null) => void;
  /** Whether a look holds her disc away from its seat (gliding to a chat or the file tree, resting there, gliding home): the cell shows its mark. */
  fabAway: boolean;
  /** Set by `CompanionFab`, which knows the look; read by `CompanionDock`. Stable for the page's life. */
  setFabAway: (away: boolean) => void;
  /** The page player's `level()`, 0..1: what her face's mouth follows while she speaks. Stable for the page's life. */
  level: () => number;
};

const CompanionContext = createContext<CompanionContextValue | null>(null);

/**
 * Used by this module's panel, dock, disc and `useAvatarTarget`, and through the barrel by the project-workspace module's command
 * palette: what Kaylee's provider holds for this page. Throws outside CompanionProvider, so a consumer placed wrong fails at once.
 */
export function useCompanion(): CompanionContextValue {
  const context = useContext(CompanionContext);
  if (!context) throw new Error('useCompanion must be used within a CompanionProvider');
  return context;
}

/** A response that is a refusal becomes a thrown Error carrying the server's own sentence, so the panel can show why. */
async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  throw new Error((await refusalSentence(response)) ?? `Request failed (${response.status})`);
}

/** How long after a send the page counts it as recent: the time her button keeps looking at the composer the send went to. */
const RECENT_SEND_MS = 4000;

/** Whether a frame off the socket is one of hers. */
const isCompanionFrame = (event: { kind?: string }): boolean => typeof event.kind === 'string' && event.kind.startsWith('companion_');

/**
 * Used by the project-workspace module's shell, which holds it above the whole workspace, so her disc, her cell in the rail, her panel and the command palette's
 * "Talk to Kaylee" share one picture. She is box-wide, tied to no chat, route or project: the one thing she asks of the page
 * is to open a chat, and she does it through `onOpenChat`, which the composition root answers with its own navigation.
 *
 * THE PICTURE IS SEEDED, THEN KEPT. It is read once with `GET /api/companion` and from then on folded, frame by frame, from
 * the one socket (`companion_*` frames) through the pure reducer. It is read again whenever the frames can no longer be
 * trusted to have told the whole story: after the socket reconnects (frames were missed while it was down), after a
 * clear (the server's own word on what is left), and when the panel opens on a page whose first read failed. Every one of
 * those is an event; nothing here polls.
 *
 * FRAMES AND THE READ ARE NOT ORDERED. While a read is out, each frame is also queued, and folded over the answer when it
 * lands, so a frame the answer predates is not lost; the reducer folds a frame twice without harm. A clear is the exception:
 * it drops the queue and discards a read that was out, because the read that follows it is the one that counts.
 *
 * A chat is opened only on a `companion_open_chat` whose `floor` is this page's client id. Every other page of the account
 * hears the frame too and does not open it, so she opens a chat where he is, not on every screen he has open; every page
 * does note the send (`recentSend`), which is what the button's look reads.
 *
 * THE PAGE'S ONE TALK PRESS lives here: `useTalkPress` is called once, and `useTalkBinding` beside it binds the account's
 * `talkBinding` (from the picture's settings, so a re-bind on any page reaches every page by its settings frame) to that press.
 * A press never opens her panel; the press route takes the floor itself.
 *
 * THE PAGE'S ONE VOICE lives here too (`useCompanionVoice`): the player, the switch, and the pull that plays her sentences while
 * the picture's `floor` is this page's client id. The press is handed the voice, so it can cut her off. The player is unlocked in
 * the first gesture: opening her panel, typing to her, or a talk press. A Stop and a Clear silence the page's voice as well as her turn.
 */
export function CompanionProvider({ onOpenChat, children }: { onOpenChat: (sessionId: string) => void; children: ReactNode }) {
  const { subscribe } = useWebSocket();
  // The picture this page draws. State, not a ref: the panel, the door and the palette all render from it.
  const [picture, setPicture] = useState<CompanionPicture | null>(null);
  // Whether her panel is open on THIS page. The page's own: another tab of the same account opens and closes her on its own.
  const [open, setOpenState] = useState(false);
  // This page's name for itself, read once so it cannot change under a conversation; the floor and every frame addressed to a page use it.
  const [clientId] = useState(companionClientId);
  // The chat she sent to inside the last four seconds. State, not a ref: the button's look starts from it, and the window's end must render the button again.
  const [recentSend, setRecentSend] = useState<string | null>(null);
  // The timer that ends the window above, so a second send restarts the four seconds instead of being cut short by the first's.
  const recentSendTimerRef = useRef(0);
  // The page's one voice: it plays her sentences while the picture says this page holds the floor, and its switch is on.
  const speech = useCompanionVoice({ picture, clientId });
  // Her disc and her rail cell meet here: where she rests, the cell's rect, and whether a look holds her off the seat.
  const { fabPosition, moveFab, dockRect, registerDock, fabAway, setFabAway } = useCompanionFab();
  // Stable for the page's life (unlike `speech`, which moves with every sentence), so the callbacks below keep their identity.
  const { unlock: unlockVoice, silence: silenceVoice } = speech;
  // The page's one press, and the key or mouse button he bound to it. The press is not state of the picture: it is this page's mic.
  const talk = useTalkPress(speech);
  useTalkBinding(picture?.settings.talkBinding ?? null, talk.toggle);

  // Whether a read of the picture is out, so a second request waits for it rather than racing it.
  const seedingRef = useRef(false);
  // A read was asked for while one was out: the one out may predate what was asked for, so it is discarded and read again.
  const seedAgainRef = useRef(false);
  // Frames heard while a read is out, folded over its answer when it lands.
  const queuedRef = useRef<CompanionFrame[]>([]);
  // False once the provider unmounted: a read that lands then sets nothing.
  const aliveRef = useRef(false);
  // The latest `onOpenChat`, read when a frame arrives, so a new callback each render does not resubscribe the socket.
  const onOpenChatRef = useRef(onOpenChat);

  useEffect(() => {
    onOpenChatRef.current = onOpenChat;
  }, [onOpenChat]);

  const seed = useCallback(async () => {
    if (seedingRef.current) {
      seedAgainRef.current = true;
      return;
    }
    seedingRef.current = true;
    try {
      do {
        seedAgainRef.current = false;
        try {
          const response = await ensureOk(await api.companion.picture());
          const read: unknown = await response.json();
          // A picture this page cannot draw is a failed read, not a picture: held, it would blank every consumer above the workspace.
          if (!isCompanionPicture(read)) throw new Error('the picture it answered is not in the shape this page draws');
          // Asked again while this one was out: it may predate what was asked for. Read again instead of drawing it.
          if (seedAgainRef.current) continue;
          const queued = queuedRef.current;
          queuedRef.current = [];
          if (aliveRef.current) setPicture(queued.reduce(reduceCompanion, read));
        } catch (error) {
          // The socket's next reconnect, or opening the panel, reads again; there is no retry loop to run here.
          console.warn('[Companion] Could not read her picture:', error);
        }
      } while (seedAgainRef.current);
    } finally {
      seedingRef.current = false;
      queuedRef.current = [];
    }
  }, []);

  /**
   * Folds one frame of hers into the picture. The reducer runs while React renders, so a throw in it would reach the app's
   * root boundary: it leaves the picture as it was, and says so, instead.
   */
  const applyFrame = useCallback((frame: CompanionFrame) => {
    setPicture((held) => {
      if (held === null) return held;
      try {
        return reduceCompanion(held, frame);
      } catch (error) {
        console.warn('[Companion] A frame could not be folded into her picture:', frame.kind, error);
        return held;
      }
    });
  }, []);

  /** Folds one frame of hers into the picture, and queues it too while a read is out. */
  const fold = useCallback((frame: CompanionFrame) => {
    if (frame.kind === 'companion_cleared') {
      // Never replayed over a fresh read: what was queued predates the clear, and the read that follows it is the one that counts.
      queuedRef.current = [];
      applyFrame(frame);
      // Her conversation is gone: what she was saying goes with it.
      silenceVoice();
      void seed();
      return;
    }
    if (seedingRef.current) queuedRef.current.push(frame);
    applyFrame(frame);
  }, [seed, applyFrame, silenceVoice]);

  useEffect(() => {
    aliveRef.current = true;
    void seed();
    return () => {
      aliveRef.current = false;
    };
  }, [seed]);

  // A window still open when the provider goes would set state on nothing.
  useEffect(() => () => window.clearTimeout(recentSendTimerRef.current), []);

  useEffect(() => subscribe((event) => {
    if (event.kind === 'websocket_reconnected') {
      void seed();
      return;
    }
    if (!isCompanionFrame(event)) return;
    const frame = event as unknown as CompanionFrame;
    if (frame.kind === 'companion_open_chat') {
      // Every page notes the send, floor or not: her activity is the account's and the button on every page follows it, so the
      // button on every page follows the send too. Only the floor's page opens the chat. The window's end is a deadline this
      // frame sets, not a clock that checks.
      setRecentSend(frame.sessionId);
      window.clearTimeout(recentSendTimerRef.current);
      recentSendTimerRef.current = window.setTimeout(() => setRecentSend(null), RECENT_SEND_MS);
      if (frame.floor === clientId) onOpenChatRef.current(frame.sessionId);
      return;
    }
    fold(frame);
  }), [subscribe, seed, fold, clientId]);

  // A page whose first read failed reads again the moment she is opened: the one place a person is waiting on her.
  useEffect(() => {
    if (open && picture === null) void seed();
  }, [open, picture, seed]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) return;
    // Opening her is a gesture: the page's audio is unlocked now, so her first sentence can sound.
    unlockVoice();
    // Opening her is the page saying "act on me": the floor moves here.
    api.companion.floor().then(ensureOk).catch((error: unknown) => {
      console.warn('[Companion] Could not take the floor:', error);
    });
  }, [unlockVoice]);

  const sendText = useCallback(async (text: string) => {
    // Typing to her is a gesture too, and unlocking comes before the first await.
    unlockVoice();
    await ensureOk(await api.companion.sendText(text));
  }, [unlockVoice]);

  // Every write is announced to this page by the frame its route sends, in the same tick as the write. The two writes that
  // ANSWER with the thing itself (the settings, the draft) fold that answer in as well, so a control never shows the old value
  // for as long as its frame is in flight, or for good while the socket is down; the frame that follows folds the same value
  // again, which the reducer allows. The writes that answer nothing wait for their frame, and a page whose socket is down
  // reads the picture again when it reconnects.
  const saveSettings = useCallback(async (patch: Partial<CompanionSettings> | { register: null }) => {
    const response = await ensureOk(await api.companion.saveSettings(patch));
    const settings = await response.json().catch(() => null);
    if (settings !== null) fold({ kind: 'companion_settings', settings: settings as CompanionSettings });
  }, [fold]);

  const editDraft = useCallback(async (text: string) => {
    const response = await ensureOk(await api.companion.editDraft(text));
    const draft = await response.json().catch(() => null);
    if (draft !== null) fold({ kind: 'companion_draft', draft: draft as CompanionPicture['draft'] });
  }, [fold]);

  // A send answers only what happened; the draft clears and the chat opens by their own frames (`companion_draft`,
  // `companion_open_chat`), in the same tick as the send.
  const sendDraft = useCallback(async (mode: 'turn' | 'steer'): Promise<string> => {
    const response = await ensureOk(await api.companion.sendDraft(mode));
    const sent = await response.json().catch(() => null);
    return typeof sent?.outcome === 'string' ? sent.outcome : 'started';
  }, []);

  const clearDraft = useCallback(async () => {
    await ensureOk(await api.companion.clearDraft());
  }, []);

  const dismissNote = useCallback(async (id: number) => {
    await ensureOk(await api.companion.dismissNote(id));
  }, []);

  // Stop stops her turn, and her voice with it: a sentence already queued in the player would otherwise finish after the word.
  const interrupt = useCallback(async () => {
    silenceVoice();
    await ensureOk(await api.companion.interrupt());
  }, [silenceVoice]);

  const clear = useCallback(async () => {
    await ensureOk(await api.companion.clear());
  }, []);

  const value = useMemo<CompanionContextValue>(
    () => ({
      picture, open, clientId, setOpen, sendText, saveSettings, editDraft, sendDraft, clearDraft, dismissNote, interrupt, clear, talk,
      voice: speech.voice, recentSend, fabPosition, moveFab, dockRect, registerDock, fabAway, setFabAway, level: speech.level,
    }),
    [
      picture, open, clientId, setOpen, sendText, saveSettings, editDraft, sendDraft, clearDraft, dismissNote, interrupt, clear, talk,
      speech.voice, recentSend, fabPosition, moveFab, dockRect, registerDock, fabAway, setFabAway, speech.level,
    ],
  );

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}
