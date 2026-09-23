import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

type HealMasterResponse = { enabled?: boolean };

type HealMasterSwitch = {
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
 * A transport call that RETURNS the value rather than setting state: every caller here needs the same
 * read, and a component-scoped setter shared between an effect and an event handler is the shape that
 * reads as a synchronous setState-in-effect. Null is "could not ask", which is never the same as OFF —
 * the caller keeps whatever it last knew.
 */
async function readSwitch(): Promise<boolean | null> {
  try {
    const response = await api.settings.healMaster();
    const body = (await response.json()) as HealMasterResponse;
    // An error ANSWER is not a position. The API's own envelope for a restart, a proxy's 502 or an
    // expired token's 401 is `{success:false,error:{…}}`, which `.json()` parses happily — and
    // `Boolean(undefined)` is `false`, a master switch drawn OFF for a reflex that is launching, with
    // nothing thrown so the unknown state is never reached. A body without a real boolean is therefore
    // "could not ask", exactly what a thrown call returns.
    if (!response.ok || typeof body.enabled !== 'boolean') return null;
    return body.enabled;
  } catch (error) {
    console.error('Error loading the heal reflex master switch:', error);
    return null;
  }
}

/** The write, returning the position the server read back off the file, or `null` if it failed. */
async function writeSwitch(next: boolean): Promise<boolean | null> {
  try {
    const response = await api.settings.saveHealMaster(next);
    const body = (await response.json()) as HealMasterResponse;
    // A refused write is not a position either, and this is the direction that PERSISTS the invented
    // side: read as `false`, a 500 on the PUT would publish OFF and the row would then send `true`
    // back as though it had read the file. Null here is what reaches `forgetPosition`.
    if (!response.ok || typeof body.enabled !== 'boolean') return null;
    return body.enabled;
  } catch (error) {
    console.error('Error saving the heal reflex master switch:', error);
    return null;
  }
}

/**
 * Every surface showing the switch right now, each entry a way of being told a position. One surface
 * composes this hook today (the settings row); a second one added later — the heal panel's own
 * controls, say — is told a flip made here the moment it is announced, rather than a copy it has to
 * keep in step.
 */
const readers = new Set<(position: boolean | null, forget?: boolean) => void>();

/**
 * The last position the server gave back — the newest thing anyone here knows. A reader that MOUNTS
 * takes it at once, before the answer it is asking for can arrive, so a surface opening while a
 * question is already out does not sit unknown for the whole length of that question.
 */
let known: boolean | null = null;

/**
 * How many authoritative positions have been established: one as a write is issued, one when its
 * answer is published. MODULE level, and that is the whole of it — the flag is ONE file, so the order
 * of answers about it is ONE order. This is not tidiness: on the neighbouring DeepSeek switch a read
 * issued before a flip and landing after it drew the side the file had already left, measured as seven
 * consecutive samples on screen while the file read the opposite. One clock for every reader.
 */
let epoch = 0;

/** A question is out to the server. */
let inFlight = false;
/** Another ask arrived while that question was out; the newer one, asked for real once it lands. */
let waiting = false;
/** A write is crossing the wire — module-wide for the reason `epoch` is. */
let writing = false;

/** Hand a position to every surface on screen. */
function deliver(position: boolean | null) {
  // `null` is "could not ask", which does not un-know the last position the server gave: it is the
  // reader that forgets, and now there is one of them instead of a copy each.
  if (position !== null) known = position;
  for (const reader of readers) reader(position);
}

/** Publish the position the server gave back, and retire every question asked before it existed. */
function announce(enabled: boolean) {
  epoch += 1;
  waiting = false;
  deliver(enabled);
}

/**
 * Tell every surface the position is UNKNOWN, and mean it: what is on screen was never read off the
 * file, so it is dropped rather than kept. Unread, not off — and for THIS switch the difference is the
 * whole point, because the row must never be able to say `off` for a reflex that is running.
 */
function forgetPosition() {
  epoch += 1;
  waiting = false;
  known = null;
  for (const reader of readers) reader(null, true);
}

/** How long to wait before asking a second time: a lost packet is far likelier than a missing file,
 * and the cost of not retrying is a control with no position, which cannot be used at all. */
const READ_RETRY_MS = 1200;

/**
 * Ask the server where the switch is, and hand the answer to every surface.
 *
 * ONE read at a time for the whole tab rather than one per instance: two surfaces asking the same
 * question of the same file is a second request that cannot say anything the first will not, and it is
 * what puts two answers in flight whose arrival order decides the position.
 */
async function ask(): Promise<void> {
  if (inFlight) {
    waiting = true;
    return;
  }

  inFlight = true;
  do {
    waiting = false;
    // The clock as it stood when this question was put: an answer is worth drawing only if nothing
    // authoritative has been established since.
    const at = epoch;

    let position = await readSwitch();
    if (position === null) {
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
      position = await readSwitch();
    }

    // Silence is the answer here: a question put before the switch moved has no business drawing the
    // side it was on, and an answer also holds back while a newer question is already queued.
    if (at === epoch && !waiting) deliver(position);
  } while (waiting);

  inFlight = false;
}

/**
 * Write the switch, and publish the position the server read back off the file.
 *
 * Nothing here touches a component: the position reaches every surface, the writer's included,
 * through `announce`, so there is one delivery path and no second setState able to disagree with it.
 */
async function write(next: boolean): Promise<void> {
  // Dropped rather than queued, module-wide because the file is one file: two flips racing onto it
  // would leave whichever answer lands last to decide.
  if (writing) return;
  writing = true;
  // Every read issued before this point is older than the write about to land, and is retired — done
  // as the write is ISSUED, so a read landing mid-write cannot draw the side the file is leaving.
  epoch += 1;

  const settled = await writeSwitch(next);
  // Re-READ on failure, never `!next`: the switch is host-wide, so a failed write can perfectly well
  // land on a file another operator just set to `next` anyway. And when that question goes unanswered
  // too, the positions on screen are RETRACTED rather than kept — there is nothing left here that was
  // ever read off the file, and the one thing this control must never do is draw a side it invented.
  const truth = settled !== null ? settled : await readSwitch();
  if (truth !== null) announce(truth);
  else forgetPosition();

  writing = false;
}

/**
 * The one reader and writer of the heal reflex's master switch in `src/`. It is the switch the
 * operator asked for in as many words ("theyre running crazy, theres suppose to be a toggle for it
 * right?") — the thing that stops the reflex LAUNCHING, over and above the daily cap, which is the
 * panel's own control and not this one.
 *
 * The position is NOT a client preference and so is not `readUserPreference`: it is a file on this
 * host that the reflex's worker re-reads at every ending, which is why every read here is a request to
 * the server rather than a value the browser already holds.
 */
export function useHealMasterSwitch(): HealMasterSwitch {
  // The switch lives on disk in another process's world; until it answers there is no honest position
  // to draw, and `null` is what keeps the control from flickering through a wrong one.
  const [enabled, setPosition] = useState<boolean | null>(null);
  // Set when a read comes back with nothing, so the row can say the position is unknown rather than
  // drawing the one it does not have. Cleared by the first read that answers.
  const [unreadable, setUnreadable] = useState(false);
  // Held only while a write is in flight, so this surface refuses its own repeated press. The guard
  // that actually stops a second write is the module's `writing`; this is what the button draws.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const reader = (position: boolean | null, forget = false) => {
      if (!live) return;
      if (forget) {
        // Not "keep the last position and admit it is unread": the last position here was drawn by
        // this very press and never confirmed against the file. Dropped, so the row shows the unknown
        // state instead of the side it guessed.
        setPosition(null);
        setUnreadable(true);
        return;
      }
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

    // Coming back to the page is the one moment the position can have moved under a surface that is
    // already mounted — the operator flips it from their phone. Skipped while a write is in flight:
    // that write's own answer is already on its way. `visibilitychange` is listened for beside `focus`
    // because iOS Safari fires no reliable blur/focus on an app switch.
    const onFocus = () => { if (!writing) void ask(); };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      live = false;
      // Dropped, so an answer arriving after this surface is gone cannot land on the run that replaced
      // it. The ask itself is deliberately NOT cancelled: the question was put to the server, and
      // `ask` still owes its answer to every reader still on screen.
      readers.delete(reader);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

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
