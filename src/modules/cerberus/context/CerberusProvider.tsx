import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CerberusContext, type CerberusValue } from '@/modules/cerberus/context/CerberusContext';
import { hm } from '@/modules/cerberus/utils/cerberusTime';
import { api, refusalSentence, REQUEST_TIMEOUT_MS } from '@/shared/api';
import type { CerberusOverview } from '@/shared/cerberus-types';
import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { CerberusLabelInput, CerberusMuteInput } from '@/shared/types';

/**
 * The least gap between two reads that `cerberus_changed` frames may start. Center already coalesces
 * its hint to one a second; this keeps a burst that slips past it from becoming a burst of reads,
 * and the trailing read below means the LAST frame of a burst is never left unread.
 */
const FRAME_READ_GAP_MS = 1_000;

/**
 * How often the overview is read with no frame at all. Time itself is the cause here, and nothing
 * announces it: the minute cells slide, "12 s ago" ages, and a check whose results stopped goes
 * stale without a single row being written for center to hint about.
 */
const CLOCK_READ_MS = 30_000;

/**
 * How long the overview held may go unanswered before a FAILED read calls it stale: three clock reads.
 * One dropped poll is noise; three in a row is a monitor that cannot see, and must stop looking live.
 * Every read here carries a 30 s deadline of its own (an abort timer in `refresh`, not the api layer's
 * `AbortSignal.timeout`, which older WebKit lacks), so one left hanging fails, and is judged, rather than
 * keeping the picture "fresh" forever.
 */
const STALE_AFTER_MS = 3 * CLOCK_READ_MS;

/**
 * The label a check goes by on screen — its plain name, or its key when it has none — read off the
 * overview the provider holds. `key` is the fallback when the check is not in it (retired between
 * the press and the answer), so a toast never prints a hole.
 */
function checkLabelIn(overview: CerberusOverview | null, node: string, key: string): string {
  for (const nodeView of overview?.nodes ?? []) {
    if (nodeView.id !== node) continue;
    for (const service of nodeView.services) {
      const found = service.checks.find((check) => check.key === key);
      if (found) return found.label ?? found.key;
    }
  }
  return key;
}

/** True when a body is the overview shape: the two fields every view dereferences are there. */
function isOverview(body: unknown): body is CerberusOverview {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as { nodes?: unknown; counts?: unknown };
  return Array.isArray(candidate.nodes) && candidate.counts !== null && typeof candidate.counts === 'object';
}

/**
 * THE FLEET'S ONE READER, AND THE THREE WRITES THE TAB PRESSES.
 *
 * Mounted once by App, inside the auth gate and below WebSocketProvider: `api.cerberus` is an
 * authenticated route and must never be asked against the login screen, and the frames that move
 * this picture — `cerberus_changed` and `websocket_reconnected` — arrive on the one socket above it.
 *
 * ONE READ, EVERY READER. The tab's Fleet view, its header and the workspace strip's count pill all
 * draw from the one overview, so a mute pressed in the sheet is already in the strip's number when
 * the sheet closes, and no reader can hold a copy of the fleet the others cannot see.
 *
 * THE READ IS THE PICTURE. A write answers the row it wrote and nothing reads that body: the screen
 * comes from the read that follows the write, so a card is never drawn from an answer center has
 * already moved past.
 *
 * A FRAME IS A HINT, NOT A PICTURE. `cerberus_changed` says what moved and the answer to it is
 * always "read the overview again" — and reads overlap (a frame's, a write's, the clock's, the
 * mount's), so each takes a ticket and answers are published in TICKET order, never arrival order.
 */
export function CerberusProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { subscribe } = useWebSocket();

  // The translator of the LATEST render, read through a ref: the three verbs below keep one
  // identity for the app's life, and a verb closing over `t` directly would be rebuilt on every
  // language switch. Read at the press, this speaks whatever language the app is in then.
  const tRef = useRef(t);
  useLayoutEffect(() => {
    tRef.current = t;
  }, [t]);

  // The last overview a read applied, or `null` until one answers. Essential rather than derived:
  // it is the only copy of the fleet between reads, and `null` ("never read") has to look different
  // on screen from a fleet with nothing in it.
  const [overview, setOverview] = useState<CerberusOverview | null>(null);

  // True while NO read has ever answered and the last one failed. Essential: it is what turns the
  // loading state into the "can't be reached" box with its Try again; a failed read after a good
  // one keeps the fleet on screen, so this never turns true over one.
  const [unreachable, setUnreachable] = useState(false);

  // True once a read fails while the overview held was answered over STALE_AFTER_MS before. Essential:
  // it is what stops the header's pill saying Live and puts the "last answer" banner over a fleet that
  // may no longer be true. Set only by a failed read and cleared only by a good answer, so it never
  // needs a timer of its own.
  const [stale, setStale] = useState(false);

  // When the overview held was last answered (epoch ms), 0 before any answer. A ref beside the state:
  // a failed read judges against it, and a read that never changes the picture must not re-render.
  const lastAnswerAtRef = useRef(0);

  // Mount flag: a read or a write that lands after this provider is gone must not set state or
  // raise a toast about a fleet nobody is looking at any more.
  const mountedRef = useRef(true);

  // The overview as the last read left it, mirrored so `refresh` can tell "never answered" from
  // "answered once" — and a toast can name a check — without depending on the state it publishes: a
  // `refresh` rebuilt on every published overview would re-subscribe the socket below.
  const overviewRef = useRef<CerberusOverview | null>(null);

  // Which read this is. Reads overlap, so each takes a ticket.
  const newestReadRef = useRef(0);
  // The newest ticket whose GOOD answer has been applied; a failed read never moves it. An older
  // answer landing after a newer one is dropped rather than published: a read that left BEFORE a
  // write's re-read must not land after it and put the pre-write fleet back on screen.
  const newestAnswerRef = useRef(0);

  // The write in flight per target (a check's mute, a mute's lift, a label). A second press on a
  // target that is already writing answers this promise and starts no second write — a double click
  // on Mute must not append two mutes; the entry leaves when the promise settles, which is after
  // the re-read that follows a write that landed.
  const writesInFlightRef = useRef(new Map<string, Promise<boolean>>());

  /**
   * A good answer, applied wholesale: the overview IS the answer, so it replaces what was held. A
   * provider that is already gone publishes nothing.
   */
  const apply = useCallback((next: CerberusOverview) => {
    if (!mountedRef.current) return;
    overviewRef.current = next;
    lastAnswerAtRef.current = Date.now();
    setOverview(next);
    setUnreachable(false);
    setStale(false);
  }, []);

  /**
   * The overview, re-read. The answer is published in ticket order, and only a good answer — a 200
   * whose body has the overview's shape — replaces it; anything else, or a throw, leaves it as it
   * was and says "could not be read" only while there is none yet.
   */
  const refresh = useCallback(async () => {
    const ticket = ++newestReadRef.current;
    let answer: CerberusOverview | null = null;
    // The read's own deadline, over the headers AND the body: a half-open connection never fails by
    // itself, and `stale` is judged only at a failed read. The timer outlives `response.json()`.
    const deadline = new AbortController();
    const deadlineTimer = window.setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await api.cerberus.overview({ signal: deadline.signal });
      if (response.ok) {
        const body: unknown = await response.json();
        if (isOverview(body)) answer = body;
      }
    } catch {
      // A throw here is this app's own network, the deadline above, or a body that is not JSON — the
      // same "no answer" a refusal leaves behind.
    } finally {
      window.clearTimeout(deadlineTimer);
    }
    if (answer === null) {
      // A failure judges BEFORE the ticket mark and never moves it: it published nothing, so an
      // older read still in flight whose answer is good must still be allowed to land. The last
      // good reading is worth more than a box about this minute's network, so only a fleet that has
      // never been answered says it could not be read, and one held for over STALE_AFTER_MS says it
      // is the last answer — both taken down by whichever good answer lands next. The next frame,
      // the clock, or Try again reads again.
      if (mountedRef.current) {
        if (overviewRef.current === null) setUnreachable(true);
        else if (Date.now() - lastAnswerAtRef.current > STALE_AFTER_MS) setStale(true);
      }
      return;
    }
    // A good reading, but not the newest one applied: something newer is already on screen, and the
    // fleet must not go backwards.
    if (ticket < newestAnswerRef.current) return;
    newestAnswerRef.current = ticket;
    apply(answer);
  }, [apply]);

  /** ONE WRITE PER TARGET: the promise is on the map before a second press can see it. */
  const writeOnce = useCallback((target: string, write: () => Promise<boolean>): Promise<boolean> => {
    const held = writesInFlightRef.current.get(target);
    if (held) return held;
    const promise = write().finally(() => {
      writesInFlightRef.current.delete(target);
    });
    writesInFlightRef.current.set(target, promise);
    return promise;
  }, []);

  /**
   * One write, and the one place a refused write becomes a sentence. The verdict is `response.ok`
   * alone — the body is not read, because the screen comes from the re-read — and a landed write is
   * followed by that re-read BEFORE this answers, so the card has already left Needs you when the
   * caller's toast speaks. A refusal's body is read for the SERVER'S OWN WORDS ("until must be
   * within the next 24 hours"), which go under the toast when it carried any.
   */
  const sendWrite = useCallback(async (request: () => Promise<Response>): Promise<boolean> => {
    let sentence: string | null = null;
    try {
      const response = await request();
      if (response.ok) {
        await refresh();
        return true;
      }
      sentence = await refusalSentence(response);
    } catch {
      // No answer at all — this app's own network — so there is no server sentence to carry; the
      // toast still says the write did not land.
    }
    // Raised only while this provider is still mounted: a write that failed after the app moved on
    // is nobody's to read.
    if (mountedRef.current) {
      toast({
        tone: 'warn',
        title: tRef.current('cerberus.errors.writeFailed'),
        ...(sentence === null ? {} : { message: sentence }),
      });
    }
    return false;
  }, [refresh, toast]);

  /**
   * A mute. The one write that speaks when it lands — "Muted until 08:00 · <label> keeps running and
   * recording." — because nothing on screen says the check is still being watched; a lift and a
   * label are their own proof, the card leaves Muted and the name appears.
   */
  const mute = useCallback((input: CerberusMuteInput): Promise<boolean> => writeOnce(
    `mute:${input.node}/${input.key}`,
    async () => {
      const landed = await sendWrite(() => api.cerberus.mute(input));
      if (landed && mountedRef.current) {
        toast({
          tone: 'positive',
          title: tRef.current('cerberus.mute.toast.title', { time: hm(input.until) }),
          message: tRef.current('cerberus.mute.toast.message', {
            label: checkLabelIn(overviewRef.current, input.node, input.key),
          }),
        });
      }
      return landed;
    },
  ), [writeOnce, sendWrite, toast]);

  /** A mute lifted early. Silent when it lands: the card is back in Needs you, or gone from Muted. */
  const liftMute = useCallback((id: string): Promise<boolean> => writeOnce(
    `lift:${id}`,
    () => sendWrite(() => api.cerberus.liftMute(id)),
  ), [writeOnce, sendWrite]);

  /** A plain name written for a check or a service. Silent when it lands: the name is on screen. */
  const setLabel = useCallback((input: CerberusLabelInput): Promise<boolean> => writeOnce(
    `label:${input.node}/${input.key ?? input.service ?? ''}`,
    () => sendWrite(() => api.cerberus.setLabel(input)),
  ), [writeOnce, sendWrite]);

  useEffect(() => {
    mountedRef.current = true;

    // Frame-driven reads: the first one goes at once, and one that arrives inside the gap waits for
    // the gap to end — a single queued read stands for every frame that lands before it fires.
    let lastFrameReadAt = 0;
    let queuedRead: number | null = null;
    const readForFrame = () => {
      if (queuedRead !== null) return;
      const wait = lastFrameReadAt + FRAME_READ_GAP_MS - Date.now();
      if (wait <= 0) {
        lastFrameReadAt = Date.now();
        void refresh();
        return;
      }
      queuedRead = window.setTimeout(() => {
        queuedRead = null;
        lastFrameReadAt = Date.now();
        void refresh();
      }, wait);
    };

    // Subscribed BEFORE the first read: a `cerberus_changed` frame that lands between the two must
    // start its own read rather than be missed, and the tickets above keep the order honest. A
    // reconnect reads at once and unthrottled — frames were missed while the socket was down.
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'cerberus_changed') readForFrame();
      else if (event.kind === 'websocket_reconnected') void refresh();
    });
    void refresh();
    const clock = window.setInterval(() => void refresh(), CLOCK_READ_MS);

    return () => {
      mountedRef.current = false;
      unsubscribe();
      window.clearInterval(clock);
      if (queuedRead !== null) window.clearTimeout(queuedRead);
    };
  }, [refresh, subscribe]);

  // Anything that reads the fleet re-draws when a read lands. The four verbs keep one identity, so
  // in practice only `overview`, `unreachable` and `stale` ever make a new value here.
  const value = useMemo<CerberusValue>(() => ({
    overview,
    unreachable,
    stale,
    refresh,
    mute,
    liftMute,
    setLabel,
  }), [overview, unreachable, stale, refresh, mute, liftMute, setLabel]);

  return <CerberusContext.Provider value={value}>{children}</CerberusContext.Provider>;
}
