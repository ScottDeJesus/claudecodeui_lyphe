import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useCompanionFab } from '@/modules/companion/hooks/useCompanionFab';
import { useCompanionVoice } from '@/modules/companion/hooks/useCompanionVoice';
import { useTalkBinding } from '@/modules/companion/hooks/useTalkBinding';
import { useTalkPress } from '@/modules/companion/hooks/useTalkPress';
import { isCompanionPicture, isOpenTarget, reduceCompanion } from '@/modules/companion/utils/companionReducer';
import type { PcmPlayer } from '@/modules/companion/utils/pcmPlayer';
import { api, refusalSentence } from '@/shared/api';
import type { CompanionFrame, CompanionOpenTarget, CompanionPicture, CompanionSettings } from '@/shared/companion-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { CompanionVoice, TalkPress } from '@/shared/types';
import type { DockableFabPosition } from '@/shared/ui';
import { companionClientId } from '@/shared/utils';

type CompanionContextValue = {
  /** Her picture as this page holds it; null until the first read lands (and after a read that failed, until the next event re-reads). */
  picture: CompanionPicture | null;
  /**
   * Why the last read failed (the server's own sentence when it gave one), while this page holds no picture; null once a picture
   * is held and while a read is out. The panel says so instead of waiting for ever, and offers `reread`.
   */
  readFailure: string | null;
  /** The panel's Try again after a failed read: the failure gives way to the waiting row while the read is out. */
  reread: () => void;
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
  /**
   * His × on the card of the action `actionId`, the one the card shows: the action comes off his panel, withdrawn. On the
   * server's 2xx the page folds the withdrawal itself, so the card does not stay up while its own frame is in flight, and
   * only while the page still holds `actionId` (a newer prepare that arrived while the call was out is not erased). A refusal
   * rejects with the server's sentence, or with an EMPTY message when it sent none or never answered, so the card says its
   * own plain line instead of a status or a transport error.
   */
  cancelAction: (actionId: string) => Promise<void>;
  dismissNote: (id: number) => Promise<void>;
  /**
   * His Pin (`pinned` true) or Unpin on the card `id`: a pinned card is his keep, which Clear leaves and she cannot take down. On the
   * server's 2xx the page folds `companion_note_pinned` itself, unless the socket has delivered one since the press began (that frame is the
   * newer word), so the button does not show the old state while its frame is in flight. Rejects with the server's sentence (a 404 for a card already taken down).
   */
  pinNote: (id: number, pinned: boolean) => Promise<void>;
  /**
   * His Back or Next on the walk: the one held walk's cursor goes to item `at` (from 1), the same cursor her `walk` tool moves. On the
   * 2xx the page folds the walk at `at`, unless a `companion_walk` reached the socket since the press began; she is told nothing now, and the shell's `<view kind="walk">` carries it with his next word.
   * Rejects with the server's own sentence when it refuses (no walk held, or `at` past the last item).
   */
  moveWalk: (at: number) => Promise<void>;
  /** His × on the walk: it ends, and the page folds `companion_walk` null on the 2xx unless a `companion_walk` reached the socket since the press began (a walk already ended is no error). */
  endWalk: () => Promise<void>;
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
   * The id of the chat she opened in the last four seconds — the chat a send went to, or one she was told to open (counted from
   * the `companion_open` frame for a chat target that this page heard) — else null. `useAvatarTarget` points the button at that chat's
   * composer while it is set.
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
  /** The page player's `progress()`: the sounding sentence's seconds elapsed and, once its body has ended, its length — what picks the vowel of her mouth. Stable for the page's life. */
  progress: PcmPlayer['progress'];
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
 * is to open a chat, a card, a page or a check, and she does it through `onOpen`, which the composition root answers with its own navigation.
 *
 * THE PICTURE IS SEEDED, THEN KEPT. It is read once with `GET /api/companion` and from then on folded, frame by frame, from
 * the one socket (`companion_*` frames) through the pure reducer. It is read again whenever the frames can no longer be
 * trusted to have told the whole story: after the socket reconnects (frames were missed while it was down), after a
 * clear (the server's own word on what is left), and when the panel opens on a page whose first read failed. Every one of
 * those is an event; nothing here polls. A read that failed while the page holds no picture is `readFailure`, which the panel
 * shows with a Try again (`reread`); the picture stays null until a read lands.
 *
 * FRAMES AND THE READ ARE NOT ORDERED. While a read is out, each frame is also queued, and folded over the answer when it
 * lands, so a frame the answer predates is not lost; the reducer folds a frame twice without harm. A clear is the exception:
 * it drops the queue and discards a read that was out, because the read that follows it is the one that counts.
 *
 * AN OPEN IS ANSWERED ONLY BY THE PAGE THAT HOLDS THE FLOOR. `companion_open` carries a target (a chat, a card, a page or a check), the
 * `floor` it is addressed to and the spoken `label` the door resolved for it; `onOpen(target, label)` is called only when that is
 * this page's client id (the workspace ignores the label; the station's stage names what she opened by it). Every other page of the
 * account hears the frame too and does nothing with it, so she opens a thing where he is, not on every screen he has open;
 * every page does note a chat open (`recentSend`), which is what the button's look reads, and a card's or a page's open is
 * noted by no one.
 *
 * HIS × ON THE ACTION CARD is `cancelAction(actionId)`: the server's `DELETE /api/companion/action`, and on its 2xx the page
 * clears that action from its picture itself, as `editDraft` folds its answer, so the card never stays up while its frame is in
 * flight. The request names no action, so the server withdraws whichever one stands when it is handled: an action that replaced
 * the card meanwhile is withdrawn with it (the page's echo skips it, and the route's `companion_pending: null` frame removes it).
 *
 * THE PAGE'S ONE TALK PRESS lives here: `useTalkPress` is called once, and `useTalkBinding` beside it binds the account's
 * `talkBinding` (from the picture's settings, so a re-bind on any page reaches every page by its settings frame) to that press.
 * A press never opens her panel; the press route takes the floor itself.
 *
 * THE PAGE'S ONE VOICE lives here too (`useCompanionVoice`): the player, the switch, and the pull that plays her sentences while
 * the picture's `floor` is this page's client id. The press is handed the voice, so it can cut her off. The player is unlocked in
 * the first gesture: opening her panel, typing to her, or a talk press. A Stop and a Clear silence the page's voice as well as her turn.
 */
export function CompanionProvider({ onOpen, children }: { onOpen: (target: CompanionOpenTarget, label: string) => void; children: ReactNode }) {
  const { subscribe } = useWebSocket();
  // The picture this page draws. State, not a ref: the panel, the door and the palette all render from it.
  const [picture, setPicture] = useState<CompanionPicture | null>(null);
  // Why the last read failed; cleared when a read lands and when Try again starts one. Meaningful only while `picture` is null.
  const [readFailure, setReadFailure] = useState<string | null>(null);
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
  // How many frames of each kind the socket has delivered. A press's echo reads the count of its kind before it asks and again when the
  // answer lands: a frame that came in between is the server's newer word, and the echo then stands down instead of stepping the page back.
  const heardRef = useRef<Partial<Record<CompanionFrame['kind'], number>>>({});
  // The latest `onOpen`, read when a frame arrives, so a new callback each render does not resubscribe the socket.
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

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
          if (aliveRef.current) {
            setPicture(queued.reduce(reduceCompanion, read));
            setReadFailure(null);
          }
        } catch (error) {
          // The socket's next reconnect, opening the panel, or the panel's Try again reads again; there is no retry loop to run here.
          console.warn('[Companion] Could not read her picture:', error);
          if (aliveRef.current) setReadFailure((error instanceof Error && error.message) || 'Request failed');
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
    if (frame.kind === 'companion_open') {
      const { target } = frame;
      // A target of a kind this build does not know, or cut short of its name or id, is not acted on.
      if (!isOpenTarget(target)) return;
      // Every page notes a chat open, floor or not: her activity is the account's, so the button on every page follows the
      // open. The window's end is a deadline this frame sets, not a clock that checks.
      if (target.kind === 'chat') {
        setRecentSend(target.sessionId);
        window.clearTimeout(recentSendTimerRef.current);
        recentSendTimerRef.current = window.setTimeout(() => setRecentSend(null), RECENT_SEND_MS);
      }
      // Only the page that holds the floor acts: the host answers each target.
      // A server a moment older than this page sends no label; the open still lands, named by nothing.
      if (frame.floor === clientId) onOpenRef.current(target, typeof frame.label === 'string' ? frame.label : '');
      return;
    }
    heardRef.current[frame.kind] = (heardRef.current[frame.kind] ?? 0) + 1;
    fold(frame);
  }), [subscribe, seed, fold, clientId]);

  // A page whose first read failed reads again the moment she is opened: the one place a person is waiting on her.
  useEffect(() => {
    if (open && picture === null) void seed();
  }, [open, picture, seed]);

  const reread = useCallback(() => {
    setReadFailure(null);
    void seed();
  }, [seed]);

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
  // `companion_open`), in the same tick as the send.
  const sendDraft = useCallback(async (mode: 'turn' | 'steer'): Promise<string> => {
    const response = await ensureOk(await api.companion.sendDraft(mode));
    const sent = await response.json().catch(() => null);
    return typeof sent?.outcome === 'string' ? sent.outcome : 'started';
  }, []);

  const clearDraft = useCallback(async () => {
    await ensureOk(await api.companion.clearDraft());
  }, []);

  // The server answers 204 whether or not an action was standing. The page's own echo of it is conditional on the action the
  // card showed. The route names no action: it withdraws whichever one stands, and its frame (sent in the same tick) is the
  // guarantee, so a prepare that crossed the call is withdrawn by that frame (nothing fires; the safe direction).
  const cancelAction = useCallback(async (actionId: string) => {
    const response = await api.companion.cancelAction().catch(() => null);
    if (response === null) throw new Error('');
    if (!response.ok) throw new Error((await refusalSentence(response)) ?? '');
    setPicture((held) => (held?.pending?.id === actionId ? { ...held, pending: null } : held));
  }, []);

  const dismissNote = useCallback(async (id: number) => {
    await ensureOk(await api.companion.dismissNote(id));
  }, []);

  // The three presses of the stage answer 204, so each folds the frame its route sent as a fallback for a socket that has not spoken: a
  // press does not look unanswered for as long as its frame is in flight, or for good while the socket is down. If a frame of its kind
  // reached the socket while the request was out, that frame is the newer word (his own press, or another page's) and the echo stands
  // down: folded after it, the press's value would step the page back, and nothing would correct it.
  const pinNote = useCallback(async (id: number, pinned: boolean) => {
    const heard = heardRef.current.companion_note_pinned ?? 0;
    await ensureOk(await api.companion.notes.pin(id, pinned));
    if ((heardRef.current.companion_note_pinned ?? 0) === heard) fold({ kind: 'companion_note_pinned', id, pinned });
  }, [fold]);

  // Only the cursor is the press's own: the rest of the walk (its chat and its items) is read from the picture when the answer lands, not when the press began.
  const moveWalk = useCallback(async (at: number) => {
    const heard = heardRef.current.companion_walk ?? 0;
    await ensureOk(await api.companion.walk.move(at));
    if ((heardRef.current.companion_walk ?? 0) !== heard) return;
    setPicture((held) => (held?.walk ? reduceCompanion(held, { kind: 'companion_walk', walk: { ...held.walk, at } }) : held));
  }, []);

  const endWalk = useCallback(async () => {
    const heard = heardRef.current.companion_walk ?? 0;
    await ensureOk(await api.companion.walk.end());
    if ((heardRef.current.companion_walk ?? 0) === heard) fold({ kind: 'companion_walk', walk: null });
  }, [fold]);

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
      picture, readFailure: picture === null ? readFailure : null, reread, open, clientId, setOpen, sendText, saveSettings, editDraft, sendDraft,
      clearDraft, cancelAction, dismissNote, pinNote, moveWalk, endWalk, interrupt, clear, talk,
      voice: speech.voice, recentSend, fabPosition, moveFab, dockRect, registerDock, fabAway, setFabAway, level: speech.level,
      progress: speech.progress,
    }),
    [
      picture, readFailure, reread, open, clientId, setOpen, sendText, saveSettings, editDraft, sendDraft, clearDraft, cancelAction, dismissNote, pinNote, moveWalk, endWalk, interrupt, clear,
      talk, speech.voice, recentSend, fabPosition, moveFab, dockRect, registerDock, fabAway, setFabAway, speech.level, speech.progress,
    ],
  );

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}
