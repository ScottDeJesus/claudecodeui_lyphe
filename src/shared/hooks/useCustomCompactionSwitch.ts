import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

/**
 * One answer of the server about the Custom compaction switch. `enabled` is the flag file's position. The
 * other four are `summarize --status`'s details, and each is `null` when that call failed or left the field
 * out — "could not ask", which is never off and never not ready.
 */
type CustomCompactionReading = {
  enabled: boolean;
  model: string | null;
  effort: string | null;
  ready: boolean | null;
  why: string | null;
};

/** What a surface holds: a reading, or nothing yet. `UNREAD` is the nothing — every field "could not ask". */
type HeldReading = Omit<CustomCompactionReading, 'enabled'> & { enabled: boolean | null };
const UNREAD: HeldReading = { enabled: null, model: null, effort: null, ready: null, why: null };

type CustomCompactionSwitch = {
  /** The switch as the server last read it off disk, or `null` while no read has succeeded. */
  enabled: boolean | null;
  /** True once a read has failed: the position is unknown, which is not the same as off. */
  unreadable: boolean;
  /** The model that would write the next compaction (the launch table's `[summarizer]`), or `null`: could not ask. */
  model: string | null;
  /** That summarizer's effort, or `null`: could not ask. */
  effort: string | null;
  /** Whether the installed Claude Code can serve that model, or `null`: could not ask. Never read `null` as false. */
  ready: boolean | null;
  /** The sentence behind a `ready: false` (empty when ready), or `null`: could not ask. */
  why: string | null;
  /** True while a write is in flight, so a caller can refuse a second flip until the server answers. */
  saving: boolean;
  /** Flip the switch. Resolves once the server has answered, or once a failed write has been re-read. */
  setEnabled: (next: boolean) => Promise<void>;
  /** Ask the server again — the way out of an unreadable switch, and the only press a control with
   * no position can honour. */
  refresh: () => Promise<void>;
};

/**
 * The body as a reading, or `null` when it is not one. The position must be a real boolean: an error
 * ANSWER (a restart, a proxy's 502, an expired token's 401) is `{success:false,error:{…}}`, which
 * `.json()` parses happily, and `Boolean(undefined)` is `false` — a switch drawn OFF for a setting that
 * may be on. Each detail is judged by itself: a missing or mistyped one is `null`, which the row says in
 * words rather than drawing as off or as not ready.
 */
function toReading(ok: boolean, body: Record<string, unknown> | null): CustomCompactionReading | null {
  if (!ok || body === null || typeof body.enabled !== 'boolean') return null;
  return {
    enabled: body.enabled,
    model: typeof body.model === 'string' ? body.model : null,
    effort: typeof body.effort === 'string' ? body.effort : null,
    ready: typeof body.ready === 'boolean' ? body.ready : null,
    why: typeof body.why === 'string' ? body.why : null,
  };
}

/** The reading as the server gives it, or `null` when it could not be asked. A caller keeps what it last knew. */
async function readSwitch(): Promise<CustomCompactionReading | null> {
  try {
    const response = await api.settings.customCompactionSwitch();
    return toReading(response.ok, (await response.json()) as Record<string, unknown> | null);
  } catch (error) {
    console.error('Error loading the Custom compaction switch:', error);
    return null;
  }
}

/** The write, returning the reading the server gave back after it, or `null` if it failed. */
async function writeSwitch(next: boolean): Promise<CustomCompactionReading | null> {
  try {
    const response = await api.settings.saveCustomCompactionSwitch({ enabled: next });
    // A refused write is not a position either, and this is the direction that PERSISTS an invented
    // side: null here is what reaches `forgetPosition`.
    return toReading(response.ok, (await response.json()) as Record<string, unknown> | null);
  } catch (error) {
    console.error('Error saving the Custom compaction switch:', error);
    return null;
  }
}

/**
 * Every surface showing the switch right now, each entry a way of being told a reading. One surface
 * composes this hook today (the settings row); a second added later is told a flip made here the
 * moment it is announced, rather than a copy it has to keep in step.
 */
const readers = new Set<(reading: CustomCompactionReading | null, forget?: boolean) => void>();

/**
 * The last reading the server gave back — the newest thing anyone here knows. A reader that MOUNTS takes
 * it at once, before the answer it is asking for can arrive.
 */
let known: CustomCompactionReading | null = null;

/**
 * How many authoritative readings have been established: one as a write is issued, one when its answer
 * is published. MODULE level — the flag is ONE file, so the order of answers about it is ONE order. On the
 * neighbouring DeepSeek switch a read issued before a flip and landing after it drew the side the file had
 * already left. One clock for every reader.
 */
let epoch = 0;

/** A question is out to the server. */
let inFlight = false;
/** Another ask arrived while that question was out; the newer one, asked for real once it lands. */
let waiting = false;
/** A write is crossing the wire — module-wide for the reason `epoch` is. */
let writing = false;

/** Hand a reading to every surface on screen. */
function deliver(reading: CustomCompactionReading | null) {
  // `null` is "could not ask", which does not un-know the last reading the server gave.
  if (reading !== null) known = reading;
  for (const reader of readers) reader(reading);
}

/** Publish the reading the server gave back, and retire every question asked before it existed. */
function announce(reading: CustomCompactionReading) {
  epoch += 1;
  waiting = false;
  deliver(reading);
}

/**
 * Tell every surface the position is UNKNOWN, and mean it: what is on screen was never read off the
 * file, so it is dropped rather than kept. Unread, not off — drawn off while on, the row promises chats
 * compacted by their own model; drawn on while off, a summarizer that is not coming.
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

    let reading = await readSwitch();
    if (reading === null) {
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
      reading = await readSwitch();
    }

    // Silence is the answer here: a question put before the switch moved has no business drawing the
    // side it was on, and an answer also holds back while a newer question is already queued.
    //
    // And while a write is out. A tab return fires `focus` AND `visibilitychange`, so a second read is
    // queued behind the first; a press landing meanwhile retires the first (`at !== epoch`), and the
    // queued one is then stamped with the NEW epoch with the write still unanswered — the file still
    // reads the old side, and drawing it would snap the toggle back for the whole latency of the PUT
    // (which carries its own `summarize --status` call). The write's `announce` always follows, so
    // nothing is lost by holding this one back.
    if (at === epoch && !waiting && !writing) deliver(reading);
  } while (waiting);

  inFlight = false;
}

/**
 * Write the switch, and publish the reading the server gave back after it.
 *
 * Nothing here touches a component: the reading reaches every surface, the writer's included, through
 * `announce`, so there is one delivery path and no second setState able to disagree with it.
 */
async function write(next: boolean): Promise<void> {
  // Dropped rather than queued, module-wide because the file is one file: two flips racing onto it
  // would leave whichever answer lands last to decide.
  if (writing) return;
  writing = true;
  // Every read issued before this point is older than the write about to land, and is retired — done
  // as the write is ISSUED. A read issued after it and landing before the write is answered is held
  // back by `ask` while `writing` is set. Between them, no read can draw the side the file is leaving.
  epoch += 1;

  const settled = await writeSwitch(next);
  // Re-READ on failure, never `!next`: the switch is host-wide, so a failed write can perfectly well
  // land on a file another operator just set to `next` anyway. And when that question goes unanswered
  // too, the positions on screen are RETRACTED rather than kept.
  const truth = settled !== null ? settled : await readSwitch();
  if (truth !== null) announce(truth);
  else forgetPosition();

  writing = false;
}

/**
 * The one reader and writer of the Custom compaction switch in `src/`. The settings row composes it, and
 * any later surface showing the setting composes the same hook, so either can flip it, both show the
 * same answer, and the fetch/save/re-read/error logic exists once.
 *
 * The position is NOT a client preference: it is a file on this host that the server re-reads at every
 * chat message, and the readiness beside it is the installed Claude Code's, derived by the server from
 * its binary at every ask. Both reach the browser as requests, never as values it already holds.
 *
 * THE UPDATE LANDS WHILE SETTINGS IS CLOSED. The operator updates Claude Code on a shell, and nothing in
 * this tab is told. The re-ask on `focus` and `visibilitychange`, and the read on mount, are how the row
 * learns that "Waiting" is over; there is no timer and no poll.
 *
 * Used by `RunnerCompactionRow` in the settings module, which draws it under the DeepSeek row.
 */
export function useCustomCompactionSwitch(): CustomCompactionSwitch {
  // The reading lives on disk and in the CLI, in another process's world; until it answers there is no
  // honest position to draw, and all-`null` is what keeps the control from flickering through a wrong one.
  const [reading, setReading] = useState<HeldReading>(UNREAD);
  // Set when a read comes back with nothing, so the row can say the position is unknown rather than
  // drawing the one it does not have. Cleared by the first read that answers.
  const [unreadable, setUnreadable] = useState(false);
  // Held only while a write is in flight, so this surface refuses its own repeated press. The guard
  // that actually stops a second write is the module's `writing`; this is what the button draws.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const reader = (next: CustomCompactionReading | null, forget = false) => {
      if (!live) return;
      if (forget) {
        // Not "keep the last reading and admit it is unread": it was drawn by a press and never
        // confirmed against the file. Dropped, so the row shows the unknown state.
        setReading(UNREAD);
        setUnreadable(true);
        return;
      }
      if (next === null) {
        setUnreadable(true);
        return;
      }
      setUnreadable(false);
      setReading(next);
    };
    readers.add(reader);
    // Drawn at once, before the ask below can be answered — see `known`.
    if (known !== null) reader(known);
    void ask();

    // Coming back to the page is the one moment the reading can have moved under a surface that is
    // already mounted — the operator flips it from their phone, or updates Claude Code in a shell.
    // Skipped while a write is in flight: that write's own answer is already on its way.
    // `visibilitychange` is listened for beside `focus` because iOS Safari fires no reliable
    // blur/focus on an app switch.
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
      // it. The ask itself is deliberately NOT cancelled: `ask` still owes its answer to every reader
      // still on screen.
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
    // that lands differently than asked still ends with the control telling the truth. Only the
    // position moves here; the details are the status call's and are left as last read.
    setReading((last) => ({ ...last, enabled: next }));
    setUnreadable(false);
    await write(next);
    setSaving(false);
  }, []);

  return { ...reading, unreadable, saving, setEnabled, refresh };
}
