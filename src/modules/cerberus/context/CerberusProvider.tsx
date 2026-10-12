import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CerberusContext, type CerberusValue } from '@/modules/cerberus/context/CerberusContext';
import { useCatalogRead } from '@/modules/cerberus/hooks/useCatalogRead';
import { useDiagnosisVerbs } from '@/modules/cerberus/hooks/useDiagnosisVerbs';
import { useWardensRead } from '@/modules/cerberus/hooks/useWardensRead';
import { hm } from '@/modules/cerberus/utils/cerberusTime';
import { api, refusalCode, refusalSentence, REQUEST_TIMEOUT_MS } from '@/shared/api';
import type { CerberusNodeProject, CerberusNodeView, CerberusOverview, CerberusStartedBatch } from '@/shared/cerberus-types';
import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { CerberusLabelInput, CerberusMuteInput, CerberusProjectMove } from '@/shared/types';

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
 * How long after a landed write's failed re-read the overview is read again, in order: a blip that failed the
 * read is usually over within the first, and the second is for one that was not. After the last the clock's
 * own read (`CLOCK_READ_MS`) is the next chance.
 */
const REREAD_RETRY_PAUSES_MS = [1_000, 4_000];

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

/**
 * The warden link of a node, read off the overview the provider holds, or `null` when the node is not in
 * it. A toast about a project that moved onto a node says whether its warden is reporting, and the
 * answer is the one the re-read just brought in, not the one at the press.
 */
function nodeLinkIn(overview: CerberusOverview | null, node: string): CerberusNodeView['link'] | null {
  return overview?.nodes.find((nodeView) => nodeView.id === node)?.link ?? null;
}

/**
 * The refusal a project move answers in words of its own, in the section's banner: the server's 409
 * `PROJECT_NODE_NOT_COLOCATED` ("not enrolled" and "not on this machine" are one answer to the person:
 * the project stays on this server). Anything else is a failed write, and the toast says it.
 */
async function isNotColocatedRefusal(response: Response): Promise<boolean> {
  return response.status === 409 && (await refusalCode(response)) === 'PROJECT_NODE_NOT_COLOCATED';
}

/** How one write came out: it landed (and the overview was re-read), it was refused in words the caller says, or it failed (and the toast has said so). */
type WriteVerdict = 'landed' | 'refused' | 'failed';

/** True when a body is the overview shape: the two fields every view dereferences are there. */
function isOverview(body: unknown): body is CerberusOverview {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as { nodes?: unknown; counts?: unknown };
  return Array.isArray(candidate.nodes) && candidate.counts !== null && typeof candidate.counts === 'object';
}

/**
 * The overview with the fixes and diagnosis plans' fields filled in where an older server left them out (an older
 * API answering a newer client): `running` as none, each need's `fix`, `run` and `diagnosis` as null. Every view
 * dereferences them, and one missing field must not stand the error boundary in place of the whole panel.
 */
function withFixFields(body: CerberusOverview): CerberusOverview {
  return {
    ...body,
    running: body.running ?? [],
    needsYou: body.needsYou.map((need) => ({ ...need, fix: need.fix ?? null, run: need.run ?? null, diagnosis: need.diagnosis ?? null })),
  };
}

/**
 * THE FLEET'S ONE READER, AND THE WRITES THE TAB PRESSES.
 *
 * Mounted once by App, inside the auth gate and below WebSocketProvider: `api.cerberus` is an
 * authenticated route and must never be asked against the login screen, and the frames that move
 * this picture — `cerberus_changed` and `websocket_reconnected` — arrive on the one socket above it.
 *
 * ONE READ, EVERY READER. The tab's Fleet view, its header and the workspace strip's count pill all
 * draw from the one overview, so a mute pressed in the sheet is already in the strip's number when
 * the sheet closes, and no reader can hold a copy of the fleet the others cannot see. The catalog is read
 * with it, in the same `refresh`, so a run's press and an auto-run switch bring the entry and the run
 * back together; so are the wardens (`GET /wardens`: the release on offer and the batch running), which the
 * header's update button and the Update wardens dialog both read.
 *
 * THE READ IS THE PICTURE. A write answers the row it wrote and nothing reads that body: the screen
 * comes from the read that follows the write, so a card is never drawn from an answer center has
 * already moved past.
 *
 * A FRAME IS A HINT, NOT A PICTURE. `cerberus_changed` says what moved and the answer to it is
 * always "read the overview again" — and reads overlap (a frame's, a write's, the clock's, the
 * mount's), so each takes a ticket and answers are published in TICKET order, never arrival order. A frame
 * of a warden update (`updates: true`) is the one kind read at once instead of held to the frame gap.
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

  // The catalog beside the overview, and the one read that brings it.
  const { catalog, catalogFailed, readCatalog } = useCatalogRead();

  // The fleet's wardens beside the overview, and the one read that brings them.
  const { wardens, readWardens } = useWardensRead();

  // The entries whose Run press is out: center answers once the warden has accepted the run, which can take
  // up to 10 s, and every Run now of those entries reads "Running…" for the wait. A list, since a press on
  // another entry inside that wait must not take the first one's label back.
  const [starting, setStarting] = useState<string[]>([]);

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

  // The write in flight per target (a check's mute, a mute's lift, a label, a project's node). A second
  // press on a target that is already writing answers this promise and starts no second write — a double
  // click on Mute must not append two mutes; the entry leaves when the promise settles, which is after
  // the re-read that follows a write that landed. Each target's writes answer one kind of value.
  const writesInFlightRef = useRef(new Map<string, Promise<unknown>>());

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
  const readOverview = useCallback(async (): Promise<boolean> => {
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
        if (isOverview(body)) answer = withFixFields(body);
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
      return false;
    }
    // A good reading, but not the newest one applied: something newer is already on screen, and the
    // fleet must not go backwards.
    if (ticket > newestAnswerRef.current) {
      newestAnswerRef.current = ticket;
      apply(answer);
    }
    return true;
  }, [apply]);

  /**
   * The overview, the catalog and the wardens, read together; answers when the OVERVIEW has, with whether its
   * read was answered. The catalog and the wardens are secondary data and follow on their own: a write's verdict
   * waits for the picture it moved, never for a read that hangs for its 30 s deadline.
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    void readCatalog();
    void readWardens();
    return readOverview();
  }, [readOverview, readCatalog, readWardens]);

  /**
   * The re-read after a landed write failed: read again, on `REREAD_RETRY_PAUSES_MS`, until an answer to a read
   * taken after the write (`after` is the newest ticket then) has been applied — this one's, or a frame's or the
   * clock's. The write's verdict does not wait for it: a toast saying the write landed would otherwise sit over a
   * screen that still shows the old fleet for as long as the next read takes to come on its own.
   */
  const rereadAfterWrite = useCallback(async (after: number) => {
    for (const pause of REREAD_RETRY_PAUSES_MS) {
      await new Promise((resolve) => window.setTimeout(resolve, pause));
      if (!mountedRef.current || newestAnswerRef.current > after) return;
      if (await refresh()) return;
    }
  }, [refresh]);

  /** ONE WRITE PER TARGET: the promise is on the map before a second press can see it. */
  const writeOnce = useCallback(<Answer,>(target: string, write: () => Promise<Answer>): Promise<Answer> => {
    const held = writesInFlightRef.current.get(target) as Promise<Answer> | undefined;
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
   * caller's toast speaks. A re-read that failed is tried again in the background (`rereadAfterWrite`), so
   * the screen catches up in seconds, not at the next clock read. A refusal's body is read for the SERVER'S OWN WORDS ("until must be
   * within the next 24 hours"), which go under the toast when it carried any.
   *
   * A caller whose screen says one particular refusal in words of its own passes `saysOwnRefusal`: that
   * refusal is `refused`, with no toast, and every other one is `failed` as before.
   */
  const settleWrite = useCallback(async (
    request: () => Promise<Response>,
    saysOwnRefusal?: (response: Response) => Promise<boolean>,
  ): Promise<WriteVerdict> => {
    let sentence: string | null = null;
    try {
      const response = await request();
      if (response.ok) {
        const after = newestReadRef.current;
        if (!(await refresh())) void rereadAfterWrite(after);
        return 'landed';
      }
      if (saysOwnRefusal && (await saysOwnRefusal(response))) return 'refused';
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
    return 'failed';
  }, [refresh, rereadAfterWrite, toast]);

  /** A write whose only answers are "it landed" and "it did not": `settleWrite`, flattened. */
  const sendWrite = useCallback(
    async (request: () => Promise<Response>): Promise<boolean> => (await settleWrite(request)) === 'landed',
    [settleWrite],
  );

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

  /**
   * A project's chats moved onto a node's warden, or back to this server (`node` null). It speaks when it
   * lands, since the chat itself looks the same wherever its CLI runs: "<project> runs on eis1 now" (with
   * the message that its messages are refused until eis1's warden reports, while it is not reporting),
   * "<project> runs on this server again". The server's 409 `PROJECT_NODE_NOT_COLOCATED` is `refused` and
   * silent: the section's banner says it. A project takes one write at a time, so a second press answers
   * the first's verdict.
   */
  const setProjectNode = useCallback((project: CerberusNodeProject, node: string | null): Promise<CerberusProjectMove> => writeOnce(
    `project-node:${project.projectId}`,
    async () => {
      const verdict = await settleWrite(() => api.projects.setNode(project.projectId, node), isNotColocatedRefusal);
      // `refused` and `failed` are already said (by the banner, by the toast): they pass through.
      if (verdict !== 'landed') return verdict;
      if (mountedRef.current) {
        if (node === null) {
          toast({ tone: 'positive', title: tRef.current('cerberus.node.projects.toast.back', { name: project.name }) });
        } else {
          const reporting = nodeLinkIn(overviewRef.current, node) === 'reporting';
          toast({
            tone: 'positive',
            title: tRef.current('cerberus.node.projects.toast.here', { name: project.name, node }),
            ...(reporting ? {} : { message: tRef.current('cerberus.node.projects.toast.hereWaiting', { node }) }),
          });
        }
      }
      return 'moved';
    },
  ), [writeOnce, settleWrite, toast]);

  /**
   * A catalog entry run now, by you. The press waits for the warden's ack (up to 10 s) and for the re-read
   * that follows, so by the time it answers the overview holds the run and the card's strip is there. Silent
   * when it lands, since the strip is the proof; a refusal (a run already going on the check, the node's
   * warden not linked) raises the write's own toast with the server's sentence. A second press of the same
   * entry answers the first's verdict. `onStarted` is handed the id of the run the press started, as soon as
   * the answer names it and before the re-read; a landed press whose answer cannot be read never calls it,
   * and a second press that joins the first's write never does either.
   */
  const runEntry = useCallback((id: string, onStarted?: (runId: string) => void): Promise<boolean> => writeOnce(
    `run:${id}`,
    async () => {
      setStarting((current) => [...current, id]);
      try {
        return await sendWrite(async () => {
          const response = await api.cerberus.runEntry(id);
          if (response.ok && onStarted) {
            try {
              const body = (await response.json()) as { runId?: unknown } | null;
              if (typeof body?.runId === 'string') onStarted(body.runId);
            } catch {
              // The run started (`response.ok` is the verdict) and only its answer is unreadable: no id to hand on.
            }
          }
          return response;
        });
      } finally {
        // Only this entry leaves: a press on another entry meanwhile is still out.
        if (mountedRef.current) setStarting((current) => current.filter((held) => held !== id));
      }
    },
  ), [writeOnce, sendWrite]);

  /** An entry's auto-run switched. Silent when it lands: the switch and its line are the proof; a capped entry is refused with the server's sentence in the toast. */
  const setAuto = useCallback((id: string, on: boolean): Promise<boolean> => writeOnce(
    `auto:${id}`,
    () => sendWrite(() => api.cerberus.setAuto(id, on)),
  ), [writeOnce, sendWrite]);

  /**
   * A batch of warden updates started: answers the batch and its updates as they stood, which the dialog follows
   * (the screen itself comes from the re-read, where `wardens.running` holds them). A refusal (409 `CERBERUS_UPDATE_RUNNING`, a batch already
   * going, perhaps from another window) raises the write's own toast and reads the wardens again, so the dialog
   * can follow the batch that is running. A start that landed whose answer cannot be read (a 200 whose body is not
   * JSON) is still a landed start: it answers `null`, with no toast, and the dialog follows the batch through
   * `wardens.running`, which the re-read after every landed write brings. A second press answers the first's verdict.
   */
  const startUpdate = useCallback((nodes: string[]): Promise<CerberusStartedBatch | null> => writeOnce(
    'update:start',
    async () => {
      let started: CerberusStartedBatch | null = null;
      const verdict = await settleWrite(async () => {
        const response = await api.cerberus.startUpdate(nodes);
        // Read only from a landed start: a refusal's body is `settleWrite`'s to read for its sentence.
        if (response.ok) {
          try {
            const body = (await response.json()) as Partial<CerberusStartedBatch> | null;
            // A body that parses but is not a batch is as unreadable as one that does not parse.
            if (typeof body?.batch === 'string' && Array.isArray(body.updates)) started = { batch: body.batch, updates: body.updates };
          } catch {
            // The start landed (`response.ok` is its verdict) and only its answer is unreadable; the dialog follows the batch the wardens read holds.
          }
        }
        return response;
      });
      if (verdict !== 'landed') void refresh();
      return verdict === 'landed' ? started : null;
    },
  ), [writeOnce, settleWrite, refresh]);

  // The diagnosis's three writes, riding the same guards and the same toast as the verbs above.
  const { diagnose, runProposal, promote } = useDiagnosisVerbs({ writeOnce, settleWrite, toast, tRef, mountedRef });

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

    // A warden update's frames (`updates: true`) are read at once, never held to the gap above: an update is over
    // in under half a second, so a read held for the gap would find it ended and the screen could never draw
    // its step, the restart's pill or the paused minute. One read at a time, and a frame that lands while one is
    // out asks for exactly one more when it answers, so a burst of steps costs two reads, never one per step. Only
    // the overview and the wardens are read: they are all an update moves.
    let updateReadOut = false;
    let updateReadAgain = false;
    const readForUpdateFrame = () => {
      if (updateReadOut) {
        updateReadAgain = true;
        return;
      }
      updateReadOut = true;
      void Promise.all([readOverview(), readWardens()]).finally(() => {
        updateReadOut = false;
        if (updateReadAgain && mountedRef.current) {
          updateReadAgain = false;
          readForUpdateFrame();
        }
      });
    };

    // Subscribed BEFORE the first read: a `cerberus_changed` frame that lands between the two must
    // start its own read rather than be missed, and the tickets above keep the order honest. A
    // reconnect reads at once and unthrottled — frames were missed while the socket was down.
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'cerberus_changed') {
        if (event.updates === true) readForUpdateFrame();
        else readForFrame();
      } else if (event.kind === 'websocket_reconnected') void refresh();
    });
    void refresh();
    const clock = window.setInterval(() => void refresh(), CLOCK_READ_MS);

    return () => {
      mountedRef.current = false;
      unsubscribe();
      window.clearInterval(clock);
      if (queuedRead !== null) window.clearTimeout(queuedRead);
    };
  }, [refresh, readOverview, readWardens, subscribe]);

  // Anything that reads the fleet re-draws when a read lands. The verbs keep one identity, so
  // in practice only `overview`, `unreachable`, `stale`, `catalog`, `wardens` and `starting` ever make a new value here.
  const value = useMemo<CerberusValue>(() => ({
    overview,
    unreachable,
    stale,
    catalog,
    catalogFailed,
    refresh,
    mute,
    liftMute,
    setLabel,
    setProjectNode,
    starting,
    runEntry,
    setAuto,
    wardens,
    startUpdate,
    diagnose,
    runProposal,
    promote,
  }), [overview, unreachable, stale, catalog, catalogFailed, refresh, mute, liftMute, setLabel, setProjectNode, starting, runEntry, setAuto, wardens, startUpdate, diagnose, runProposal, promote]);

  return <CerberusContext.Provider value={value}>{children}</CerberusContext.Provider>;
}
