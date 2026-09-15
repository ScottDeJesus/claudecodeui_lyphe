import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

type DeepSeekFlashResponse = { enabled?: boolean };

type DeepSeekFlashSwitch = {
  /** The switch as the server last read it off disk, or `null` while no read has succeeded. */
  enabled: boolean | null;
  /** True once a read has failed: the position is unknown, which is not the same as off. */
  unreadable: boolean;
  /** True while a write is in flight, so a caller can refuse a second flip until the server answers. */
  saving: boolean;
  /** Flip the switch. Resolves once the server has answered, or once a failed write has been re-read. */
  setEnabled: (next: boolean) => Promise<void>;
  /** Ask the server again — the way out of an unreadable switch, and the only press a control with
   * no position can honour. */
  refresh: () => Promise<void>;
};

/**
 * The switch's position as the server reads it off disk, or `null` when it could not be read.
 *
 * A transport call that RETURNS the value rather than setting state: every caller here needs the
 * same read, and a component-scoped setter shared between an effect and an event handler is the
 * shape that reads as a synchronous setState-in-effect. Null is "could not ask", which is never
 * the same as OFF — the caller keeps whatever it last knew.
 */
async function readSwitch(): Promise<boolean | null> {
  try {
    const body = (await (await api.settings.deepseekFlash()).json()) as DeepSeekFlashResponse;
    return Boolean(body.enabled);
  } catch (error) {
    console.error('Error loading the DeepSeek runner switch:', error);
    return null;
  }
}

/** The write, returning the position the server read back off the file, or `null` if it failed. */
async function writeSwitch(next: boolean): Promise<boolean | null> {
  try {
    const body = (await (await api.settings.saveDeepseekFlash(next)).json()) as DeepSeekFlashResponse;
    return Boolean(body.enabled);
  } catch (error) {
    console.error('Error saving the DeepSeek runner switch:', error);
    return null;
  }
}

/**
 * Every surface showing the switch right now, each entry a way of being told a position. A flip made
 * on one tells the others, so an open Settings page and the composer cannot show two different
 * positions — and it is a handful of lines rather than a store, because the file on disk is the only
 * truth and this carries nothing but the last answer from it. Readers in a SECOND tab are out of its
 * reach; the focus re-read below is what closes that gap.
 */
const readers = new Set<(position: boolean | null) => void>();

/**
 * The last position the server gave back — the newest thing anyone here knows.
 *
 * A reader that MOUNTS takes it at once, and it is drawn before the answer it is asking for can
 * arrive. That is not a shortcut around the ask: it is the same position the surfaces already on
 * screen are showing, and a surface opening while a question is already out would otherwise sit
 * unknown for the whole length of that question — the one cost of letting one request serve every
 * reader, and a real one when the thing that is slow is the request.
 */
let known: boolean | null = null;

/**
 * How many authoritative positions have been established: one as a write is issued, one when its
 * answer is published.
 *
 * MODULE level, and that is the whole of it. The flag is ONE file, so the order of answers about it
 * is ONE order, and a counter kept per hook instance cannot see what another surface established.
 * That was a live defect, not a tidiness question: the composer's focus re-read is issued, the
 * operator flips the switch on the Settings row, the write answers and is announced to the composer
 * — and the composer's read, already on the wire carrying the position from BEFORE the flip, landed
 * after it, passed its own instance's gate (its serial was still the newest that instance had asked
 * for, its queue empty) and put the chip back on. Measured before this: the chip read ON for seven
 * consecutive samples while the file read `off`. One clock for every reader, read by the surface
 * that asks and by the surface that writes alike.
 */
let epoch = 0;

/** A question is out to the server. */
let inFlight = false;
/**
 * Another ask arrived while that question was out.
 *
 * That question is NOT dropped. It is the newer one, and the answer already on its way cannot be
 * newer than it — so it is remembered, and asked for real the moment the one in flight lands.
 * Dropping it is precisely how a slow answer gets to decide: the mount read is the oldest question
 * and the last to be answered, and with nothing left to ask, its stale answer is final.
 */
let waiting = false;
/**
 * A write is crossing the wire. Module-wide for the reason `epoch` is: the file is one file, and a
 * surface that re-reads while another surface writes asks a question whose answer is already on its
 * way back. Held around the write and nothing else.
 */
let writing = false;

/** Hand a position to every surface on screen. */
function deliver(position: boolean | null) {
  // `null` is "could not ask", which does not un-know the last position the server gave: it is the
  // reader that forgets, and now there is one of them instead of a copy each.
  if (position !== null) known = position;
  for (const reader of readers) reader(position);
}

/**
 * Publish the position the server gave back — a write's answer, or the read that stood in for a
 * failed write — to every reader, and retire every question asked before it existed.
 *
 * The retirement is what makes the ordering hold ACROSS surfaces rather than only within whichever
 * one happened to write: from here on, an answer to a question put before this moment is older than
 * the position on screen, whatever it says, and drawing it is the revert this clock exists to stop.
 */
function announce(enabled: boolean) {
  epoch += 1;
  // A question still queued behind an in-flight read was asked before this answer existed, and this
  // answer is the thing it was asking for. Retired here, so the loop below does not spend a request
  // re-asking a question nobody is waiting on any more.
  waiting = false;
  deliver(enabled);
}

/**
 * How long to wait before asking a second time. A read is a request to a server that has already
 * answered this same question on the write path, so a single failure is far more often a lost
 * packet than a missing file — and the cost of not retrying is a control with no position, which
 * cannot be used at all. Short enough that nobody presses twice first.
 */
const READ_RETRY_MS = 1200;

/**
 * Ask the server where the switch is, and hand the answer to every surface.
 *
 * ONE read at a time for the whole tab rather than one per instance: two surfaces asking the same
 * question of the same file is a second request that cannot say anything the first will not, and it
 * is what put two answers in flight whose arrival order decided the position. Here there is never
 * more than one question out, so an answer cannot overtake a newer one — there is no newer one out
 * yet to overtake, and a question asked meanwhile is answered after it, in order.
 */
async function ask(): Promise<void> {
  if (inFlight) {
    waiting = true;
    return;
  }

  inFlight = true;
  // A loop rather than the function calling itself: every question asked while one was out is
  // answered here, in order, each with a request of its own.
  do {
    waiting = false;
    // The clock as it stood when this question was put. An answer is worth drawing only if nothing
    // authoritative has been established since — a write issued while this was on the wire, or an
    // answer published while it was, both mean the position has already moved past this.
    const at = epoch;

    let position = await readSwitch();
    if (position === null) {
      // One retry. A read is a request to a server that has already answered this same question on
      // the write path, so a single failure is far more often a lost packet than a missing file, and
      // the cost of not retrying is a control with no position, which cannot be used.
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
      position = await readSwitch();
    }

    // Silence is the answer here, and it is the fix: a question put before the switch moved has no
    // business drawing the side it was on. An answer also holds back while a newer question is
    // already queued — that one will be asked for real in a moment and its answer is the one that
    // stands, so drawing this one first would be the same lie, only shorter.
    if (at === epoch && !waiting) deliver(position);
  } while (waiting);

  inFlight = false;
}

/**
 * Flip the switch, and publish the position the server read back off the file.
 *
 * Nothing here touches a component: the position reaches every surface, the writer's included,
 * through `announce`, so there is one delivery path and no second setState able to disagree with it.
 */
async function write(next: boolean): Promise<void> {
  // Dropped rather than queued, module-wide because the file is one file: two flips racing onto it
  // would leave whichever answer lands last to decide, and the loser's optimistic position to be
  // corrected by it.
  if (writing) return;
  writing = true;
  // Every read issued before this point is older than the write about to land, and is retired —
  // otherwise a read still in flight could arrive after the write's answer and undo it. Done as the
  // write is ISSUED, not only when it answers, so a read landing mid-write cannot draw the side the
  // file is in the middle of leaving.
  epoch += 1;

  const settled = await writeSwitch(next);
  // Re-READ on failure, never `!next`. Inverting is a guess about a file this process does not own:
  // the switch is host-wide, so a failed write can perfectly well land on a file another operator
  // just set to `next` anyway, and the control would then contradict disk until it remounted. Asking
  // is the only way to know, and a failed re-read publishes nothing rather than inventing a worse
  // position — every surface keeps the last one it knew.
  const truth = settled !== null ? settled : await readSwitch();
  if (truth !== null) announce(truth);

  writing = false;
}

/**
 * The one reader and writer of the DeepSeek Flash switch in `src/`. The settings row
 * (`RunnerModelContent`) and the composer's chip both compose it, so either surface can flip it,
 * both show the same answer, and the fetch/save/re-read/error logic exists once.
 *
 * The position is NOT a client preference and so is not `readUserPreference`: it is a file on this
 * host that the plan runner's own process re-reads at every spawn, which is why every read here is
 * a request to the server rather than a value the browser already holds.
 */
export function useDeepSeekFlashSwitch(): DeepSeekFlashSwitch {
  // The switch lives on disk in another process's world; until it answers there is no honest
  // position to draw, and `null` is what keeps the control from flickering through a wrong one.
  const [enabled, setPosition] = useState<boolean | null>(null);
  // Set when a read comes back with nothing, so a surface can say the position is unknown rather
  // than drawing the one it does not have. Cleared by the first read that answers.
  const [unreadable, setUnreadable] = useState(false);
  // Held only while a write is in flight, so this surface refuses its own repeated press. The guard
  // that actually stops a second write is the module's `writing`; this is what the button draws.
  const [saving, setSaving] = useState(false);

  // Mount only: the file belongs to another process, so the position has to be ASKED for, and a
  // re-read on every render would fight the write in flight. The guard here is a per-run local
  // rather than something shared, because StrictMode mounts, unmounts and re-mounts in development:
  // this run's cleanup must not be able to silence the run that replaces it.
  useEffect(() => {
    let live = true;
    const reader = (position: boolean | null) => {
      if (!live) return;
      if (position === null) {
        setUnreadable(true);
        return;
      }
      setUnreadable(false);
      setPosition(position);
    };
    readers.add(reader);
    // Drawn at once, before the ask below can be answered — see `known`.
    if (known !== null) reader(known);
    void ask();

    // Coming back to the tab is the one moment the position can have moved under a surface that is
    // already mounted and would otherwise never ask again — the operator flips it from their phone
    // and the desktop window, which has been open the whole time, must not go on showing the old
    // side. Skipped while a write is in flight: that write's own answer is already on its way, and a
    // read racing it could land first and be corrected by nothing.
    const onFocus = () => { if (!writing) void ask(); };
    window.addEventListener('focus', onFocus);

    return () => {
      live = false;
      // Dropped, so an answer arriving after this surface is gone cannot land on the run that
      // replaced it. The ask itself is deliberately NOT cancelled: the question was put to the
      // server, and `ask` still owes its answer to every reader still on screen.
      readers.delete(reader);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Asking again is the only press a chip with no position can honour, and the only thing that
  // ends an unreadable state short of a remount.
  const refresh = useCallback(async () => {
    await ask();
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    if (writing) return;
    setSaving(true);
    // Optimistic, then corrected: the server answers with what it read back off the file, so a write
    // that lands differently than asked still ends with the control telling the truth.
    setPosition(next);
    setUnreadable(false);
    await write(next);
    setSaving(false);
  }, []);

  return { enabled, unreadable, saving, setEnabled, refresh };
}
