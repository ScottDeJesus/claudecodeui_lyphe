import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

/**
 * The floor a ceiling is held to, mirrored from the runner's own grammar: a switch that is on runs
 * at least one phase, and `on 0` is not on at all. Nothing is narrowed above it — the count the
 * operator sets is the count the file holds.
 */
export const LANES_MIN = 1;

/** What the server read off the flag file: the switch, and the ceiling it runs under. */
type SwarmPosition = { enabled: boolean; lanes: number | null };

/**
 * Every field a `GET` or `PUT` answer must carry to be a position rather than an error envelope.
 *
 * `lanes` is `null` for NO CEILING — the uncapped default a bare `on` means — and that is a
 * POSITION, not a missing one: it passes here, and only an absent key is refused.
 */
function positionOf(body: unknown): SwarmPosition | null {
  if (typeof body !== 'object' || body === null) return null;
  const { enabled, lanes } = body as { enabled?: unknown; lanes?: unknown };
  // A body missing either field is "could not ask", never a default: the API's own envelope for a
  // restart, a proxy's 502 or an expired token's 401 is `{success:false,error:{…}}`, which `.json()`
  // parses happily, and a row that read that as `{enabled:false}` would draw the switch off for a
  // switch that is on — the one thing this control must never do.
  if (typeof enabled !== 'boolean') return null;
  if (lanes !== null && (typeof lanes !== 'number' || !Number.isInteger(lanes))) return null;
  return { enabled, lanes };
}

type SwarmSwitch = {
  /** The switch as the server last read it off disk, or `null` while no read has succeeded. */
  enabled: boolean | null;
  /** The ceiling on how many phases run at once, or `null` for NO ceiling. While the switch is on
   * this is the file's own reading; while it is off it is what the next ON press will write. */
  lanes: number | null;
  /** True once a read has failed: the position is unknown, which is not the same as off. */
  unreadable: boolean;
  /** True while a write is in flight, so a caller can refuse a second flip until the server answers. */
  saving: boolean;
  /** Flip the switch. Resolves once the server has answered, or once a failed write has been re-read. */
  setEnabled: (next: boolean) => Promise<void>;
  /** Move the ceiling. Written at once while the switch is on; remembered for the next ON press
   * while it is off, because the file has no room for a ceiling that is not being run. */
  setLanes: (next: number | null) => Promise<void>;
  /** Ask the server again — the way out of an unreadable switch, and the only press a control with
   * no position can honour. */
  refresh: () => Promise<void>;
};

/**
 * A ceiling as the file may hold it: `null` for none, else a whole number of at least one lane.
 * `NaN` and `Infinity` have no digits to write, and the server's writer answers them the same way
 * this does — the uncapped default — so a count the row cannot make sense of lands on the switch's
 * own default rather than on a second, invented one.
 */
function clampLanes(next: number | null): number | null {
  if (next === null || !Number.isFinite(next)) return null;
  return Math.max(LANES_MIN, Math.trunc(next));
}

/**
 * The switch's position as the server reads it off disk, or `null` when it could not be read.
 *
 * A transport call that RETURNS the value rather than setting state: every caller here needs the
 * same read, and a component-scoped setter shared between an effect and an event handler is the
 * shape that reads as a synchronous setState-in-effect.
 */
async function readSwitch(): Promise<SwarmPosition | null> {
  try {
    const response = await api.settings.swarmSwitch();
    if (!response.ok) return null;
    return positionOf(await response.json());
  } catch (error) {
    console.error('Error loading the swarm switch:', error);
    return null;
  }
}

/** The write, returning the position the server read back off the file, or `null` if it failed. */
async function writeSwitch(next: SwarmPosition): Promise<SwarmPosition | null> {
  try {
    const response = await api.settings.saveSwarmSwitch(next);
    // A refused write is not a position either, and this is the direction that PERSISTS the invented
    // side: read as off, a 500 on the PUT would publish OFF and the next press would send the switch
    // back on as though the row had read the file.
    if (!response.ok) return null;
    return positionOf(await response.json());
  } catch (error) {
    console.error('Error saving the swarm switch:', error);
    return null;
  }
}

/** Every surface showing the switch right now, each entry a way of being told a position. */
const readers = new Set<(position: SwarmPosition | null, forget?: boolean) => void>();

/** The last position the server gave back — the newest thing anyone here knows, drawn by a surface
 * that mounts before its own ask can be answered. */
let known: SwarmPosition | null = null;

/**
 * How many authoritative positions have been established: one as a write is issued, one when its
 * answer is published.
 *
 * MODULE level, and that is the whole of it — the flag is ONE file, so the order of answers about it
 * is ONE order, and a counter kept per hook instance cannot see what another surface established. A
 * read issued before a flip and landing after it would otherwise draw the side the file has already
 * left.
 */
let epoch = 0;
/** A question is out to the server. */
let inFlight = false;
/** Another ask arrived while that question was out; it is asked for real once that one lands. */
let waiting = false;
/** A write is crossing the wire — module-wide for the reason `epoch` is. */
let writing = false;

/** Hand a position to every surface on screen. */
function deliver(position: SwarmPosition | null) {
  // `null` is "could not ask", which does not un-know the last position the server gave: it is the
  // reader that forgets, and now there is one of them instead of a copy each.
  if (position !== null) known = position;
  for (const reader of readers) reader(position);
}

/** Publish the position the server gave back, and retire every question asked before it existed. */
function announce(position: SwarmPosition) {
  epoch += 1;
  waiting = false;
  deliver(position);
}

/** Tell every surface the position is UNKNOWN, and mean it: what is on screen was never read off
 * the file, so it is dropped rather than kept. Unread, not off. */
function forgetPosition() {
  epoch += 1;
  waiting = false;
  known = null;
  for (const reader of readers) reader(null, true);
}

/** How long to wait before asking a second time. One failure is far more often a lost packet than a
 * missing file, and the cost of not retrying is a control with no position, which cannot be used. */
const READ_RETRY_MS = 1200;

/**
 * Ask the server where the switch is, and hand the answer to every surface.
 *
 * ONE read at a time for the whole tab rather than one per instance: two surfaces asking the same
 * question of the same file is a second request that cannot say anything the first will not, and it
 * is what puts two answers in flight whose arrival order decides the position.
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
async function write(next: SwarmPosition): Promise<void> {
  // Dropped rather than queued, module-wide because the file is one file: two writes racing onto it
  // would leave whichever answer lands last to decide.
  if (writing) return;
  writing = true;
  // Every read issued before this point is older than the write about to land, and is retired.
  epoch += 1;

  const settled = await writeSwitch(next);
  // Re-READ on failure, never a guess about a file this process does not own: the switch is
  // host-wide, so a failed write can perfectly well land on a file another operator just set. And
  // when that question goes unanswered too, the positions on screen are RETRACTED rather than kept.
  const truth = settled !== null ? settled : await readSwitch();
  if (truth !== null) announce(truth);
  else forgetPosition();

  writing = false;
}

/**
 * The one reader and writer of the plan runner's swarm switch in `src/`. The settings row composes
 * it, and any later surface showing the lanes composes the same hook, so either can flip it, both
 * show the same answer, and the fetch/save/re-read/error logic exists once.
 *
 * The position is NOT a client preference and so is not `readUserPreference`: it is a file on this
 * host that the runner's own process re-reads at every boundary, which is why every read here is a
 * request to the server rather than a value the browser already holds.
 */
export function useSwarmSwitch(): SwarmSwitch {
  // The switch lives on disk in another process's world; until it answers there is no honest
  // position to draw, and `null` is what keeps the control from flickering through a wrong one.
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  /** NO CEILING until the server says otherwise: what a bare `on` means, and what the row draws
   * before the first read lands. Drawing 1 would be drawing a walk nobody asked for. */
  const [lanes, setLanesState] = useState<number | null>(null);
  // Set when a read comes back with nothing, so a surface can say the position is unknown rather
  // than drawing the one it does not have. Cleared by the first read that answers.
  const [unreadable, setUnreadable] = useState(false);
  // Held only while a write is in flight, so this surface refuses its own repeated press.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const reader = (position: SwarmPosition | null, forget = false) => {
      if (!live) return;
      if (forget) {
        setEnabledState(null);
        setUnreadable(true);
        return;
      }
      if (position === null) {
        setUnreadable(true);
        return;
      }
      setUnreadable(false);
      setEnabledState(position.enabled);
      // The file carries a ceiling ONLY while the switch is on — `off` is the whole line — so a read
      // that says off leaves this alone: adopting the off-read's `null` would be harmless, but the
      // rule is the count's own, and the row's next ON press is what writes it.
      if (position.enabled) setLanesState(position.lanes);
    };
    readers.add(reader);
    // Drawn at once, before the ask below can be answered — see `known`.
    if (known !== null) reader(known);
    void ask();

    // Coming back to the page is the one moment the position can have moved under a surface that is
    // already mounted — the operator flips the switch from their phone. Skipped while a write is in
    // flight: that write's own answer is already on its way. `visibilitychange` is listened for
    // beside `focus` because iOS Safari fires no reliable blur/focus on an app switch.
    const onFocus = () => { if (!writing) void ask(); };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      live = false;
      // The ask itself is deliberately NOT cancelled: the question was put to the server, and `ask`
      // still owes its answer to every reader still on screen.
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
    // Optimistic, then corrected: the server answers with what it read back off the file.
    setEnabledState(next);
    setUnreadable(false);
    // The ceiling rides with the flip: the file holds one line, so turning the switch on uncapped —
    // the default — or at a ceiling chosen while it was on is one write.
    await write({ enabled: next, lanes });
    setSaving(false);
  }, [lanes]);

  const setLanes = useCallback(async (next: number | null) => {
    const ceiling = clampLanes(next);
    setLanesState(ceiling);
    // A ceiling with the switch off is stored NOWHERE — `off` is the whole of the file — so it is
    // remembered here and written by the next ON press. Writing `on <N>` from a press that only
    // touched the ceiling would start work nobody asked for.
    if (enabled !== true || writing) return;
    setSaving(true);
    await write({ enabled: true, lanes: ceiling });
    setSaving(false);
  }, [enabled]);

  return { enabled, lanes, unreadable, saving, setEnabled, setLanes, refresh };
}
