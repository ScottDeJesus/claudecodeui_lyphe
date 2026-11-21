import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

/**
 * One Code Mode switch as `code-mode --status` names it: which launches it covers (`kind`), its name, the
 * sentence that says what on means, and the week's one-line report ("" when there is nothing to count).
 * `enabled` is the flag's position, or `null` when the card holds the kind but not where its switch stands.
 */
export type CodeModeKind = { kind: string; label: string; says: string; enabled: boolean | null; report: string };

/**
 * What the card draws from. `kinds` is the verb's list in the verb's order, or `null` while it has not been
 * read; `unreadable` tells a read that failed from one still on the wire. `ready` and `why` are the box's
 * readiness (node, the packages, the sandbox), each `null` when it could not be asked, which is neither
 * ready nor not ready.
 */
export type CodeModeReading = { kinds: CodeModeKind[] | null; unreadable: boolean; ready: boolean | null; why: string | null };

/** The reading the card draws, plus its write state and the two presses it can make. */
export type CodeModeSwitches = CodeModeReading & {
  /** True while a write is in flight, so the card can refuse a second flip until the server answers. */
  saving: boolean;
  /** Flip one kind's switch. Resolves once the server has answered, or once a failed write has been re-read. */
  setEnabled: (kind: string, next: boolean) => Promise<void>;
  /** Ask the server again: the way out of an unreadable card, and the press a card with no position can honour. */
  refresh: () => Promise<void>;
};

/** The server's answer, with every switch whole: `kinds` is never `null` here, that is a read that failed. */
type ServerReading = {
  kinds: { kind: string; label: string; says: string; enabled: boolean; report: string }[];
  ready: boolean | null;
  why: string | null;
};

/** Nothing read yet: every field is "could not ask", and nothing is drawn as off or as not ready. */
const UNREAD: CodeModeReading = { kinds: null, unreadable: false, ready: null, why: null };

/**
 * The body as a reading, or `null` when it is not one. A reading is trusted only whole: each switch must
 * carry its name, sentence, report and a real boolean position, because a row drawn from a half-read entry
 * would put a position on screen that the server never gave. An error ANSWER (`{success:false,error:{…}}`)
 * parses as JSON happily, and `Boolean(undefined)` is `false` — switches drawn OFF for settings that may be
 * on. A server that could not ask the verb (`kinds: null`) is the same "could not read", never a card of
 * off switches.
 */
function toReading(ok: boolean, body: Record<string, unknown> | null): ServerReading | null {
  if (!ok || body === null) return null;
  const raw: unknown = body.kinds;
  if (!Array.isArray(raw)) return null;
  const list: unknown[] = raw;

  const kinds: ServerReading['kinds'] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { kind, label, says, enabled, report } = entry as Record<string, unknown>;
    if (
      typeof kind !== 'string' ||
      typeof label !== 'string' ||
      typeof says !== 'string' ||
      typeof report !== 'string' ||
      typeof enabled !== 'boolean'
    ) {
      return null;
    }
    kinds.push({ kind, label, says, enabled, report });
  }

  return {
    kinds,
    ready: typeof body.ready === 'boolean' ? body.ready : null,
    why: typeof body.why === 'string' ? body.why : null,
  };
}

/** The reading as the server gives it, or `null` when it could not be asked. A caller keeps what it last knew. */
async function readCodeMode(): Promise<ServerReading | null> {
  try {
    const response = await api.settings.codeMode();
    return toReading(response.ok, (await response.json()) as Record<string, unknown> | null);
  } catch (error) {
    console.error('Error loading the Code Mode switches:', error);
    return null;
  }
}

/** The write, returning the reading the server gave back after it, or `null` if it failed. */
async function writeCodeMode(kind: string, next: boolean): Promise<ServerReading | null> {
  try {
    const response = await api.settings.saveCodeMode({ kind, enabled: next });
    // A refused write is not a position either, and this is the direction that PERSISTS an invented
    // side: null here is what reaches `forgetPosition`.
    return toReading(response.ok, (await response.json()) as Record<string, unknown> | null);
  } catch (error) {
    console.error('Error saving the Code Mode switch:', error);
    return null;
  }
}

/**
 * Every surface showing the switches right now, each entry a way of being told a reading. One surface
 * composes this hook today (the Code Mode row); a second added later is told a flip made here the moment
 * it is announced, rather than a copy it has to keep in step.
 */
const readers = new Set<(reading: ServerReading | null, forget?: boolean) => void>();

/**
 * The last reading the server gave back — the newest thing anyone here knows. A reader that MOUNTS takes
 * it at once, before the answer it is asking for can arrive.
 */
let known: ServerReading | null = null;

/**
 * How many authoritative readings have been established: one as a write is issued, one when its answer
 * is published. MODULE level — the switches are files on one host, so the order of answers about them is
 * ONE order. One clock for every reader: a read issued before a flip and landing after it must not draw
 * the sides the files have already left.
 */
let epoch = 0;

/** A question is out to the server. */
let inFlight = false;
/** Another ask arrived while that question was out; the newer one, asked for real once it lands. */
let waiting = false;
/** A write is crossing the wire — module-wide for the reason `epoch` is. */
let writing = false;

/** Hand a reading to every surface on screen. */
function deliver(reading: ServerReading | null) {
  // `null` is "could not ask", which does not un-know the last reading the server gave.
  if (reading !== null) known = reading;
  for (const reader of readers) reader(reading);
}

/** Publish the reading the server gave back, and retire every question asked before it existed. */
function announce(reading: ServerReading) {
  epoch += 1;
  waiting = false;
  deliver(reading);
}

/**
 * Tell every surface the positions are UNKNOWN, and mean it: what is on screen was never read off the
 * files, so it is dropped rather than kept. Unread, not off — a switch drawn off while it is on, or on
 * while it is off, tells the operator the opposite of what the files hold.
 *
 * Every kind goes at once, never one alone. The card's one sentence for unknown speaks of all the
 * switches, so a kind with no position beside one that still has a position would make that sentence false.
 */
function forgetPosition() {
  epoch += 1;
  waiting = false;
  known = null;
  for (const reader of readers) reader(null, true);
}

/** How long to wait before asking a second time: a lost packet is far likelier than a missing file, and the
 * cost of not retrying is a card with no position, which cannot be used at all. */
const READ_RETRY_MS = 1200;

/**
 * Ask the server where the switches are, and hand the answer to every surface.
 *
 * ONE read at a time for the whole tab rather than one per instance: two surfaces asking the same question
 * of the same host is a second request that cannot say anything the first will not, and it is what puts
 * two answers in flight whose arrival order decides the position.
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

    let reading = await readCodeMode();
    if (reading === null) {
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
      reading = await readCodeMode();
    }

    // Silence is the answer here: a question put before a switch moved has no business drawing the side it
    // was on, and an answer also holds back while a newer question is already queued.
    //
    // And while a write is out. A tab return fires `focus` AND `visibilitychange`, so a second read is queued
    // behind the first; a press landing meanwhile retires the first (`at !== epoch`), and the queued one is
    // then stamped with the NEW epoch with the write still unanswered — the files still read the old sides,
    // and drawing them would snap the card back for the whole latency of the PUT. The write's `announce`
    // always follows, so nothing is lost by holding this one back.
    if (at === epoch && !waiting && !writing) deliver(reading);
  } while (waiting);

  inFlight = false;
}

/**
 * Write one kind's switch, and publish the reading the server gave back after it.
 *
 * Nothing here touches a component: the reading reaches every surface, the writer's included, through
 * `announce`, so there is one delivery path and no second setState able to disagree with it.
 */
async function write(kind: string, next: boolean): Promise<void> {
  // Dropped rather than queued, module-wide: the verb is one writer over one folder, and two flips racing
  // onto it would leave whichever answer lands last to decide.
  if (writing) return;
  writing = true;
  // Every read issued before this point is older than the write about to land, and is retired — done as
  // the write is ISSUED. A read issued after it and landing before the write is answered is held back by
  // `ask` while `writing` is set. Between them, no read can draw the side the file is leaving.
  epoch += 1;

  const settled = await writeCodeMode(kind, next);
  // Re-READ on failure, never a guessed position: the switches are host-wide, so a failed write can perfectly
  // well land on a file another operator just set to `next` anyway. And when that question goes unanswered
  // too, the positions on screen are RETRACTED rather than kept.
  const truth = settled !== null ? settled : await readCodeMode();
  if (truth !== null) announce(truth);
  else forgetPosition();

  writing = false;
}

/**
 * The one reader and writer of the Code Mode switches in `src/`. The screen holds no list of kinds and draws
 * what the verb answers; any surface showing them composes this hook, so either can flip a switch, both show
 * the same answer, and the fetch/save/re-read/error logic exists once.
 *
 * The positions are flag files on this host, moved only by `code-mode set`. The readiness beside them (node,
 * the packages, the sandbox) is the box's, derived by the verb at every ask. Both reach the browser as
 * requests, never as values it already holds.
 *
 * THE UPDATE LANDS WHILE SETTINGS IS CLOSED. An `npm ci` or a flip from a terminal happens on a shell, and
 * nothing in this tab is told. The re-ask on `focus` and `visibilitychange`, and the read on mount, are how
 * the card learns that it has changed; there is no timer and no poll.
 *
 * Used by `RunnerCodeModeRow` in Settings → Agents.
 */
export function useCodeMode(): CodeModeSwitches {
  // The reading lives on disk and in the CLI, in another process's world; until it answers there is no honest
  // position to draw, and `kinds: null` is what keeps the card from drawing a list it does not have.
  const [reading, setReading] = useState<CodeModeReading>(UNREAD);
  // Held only while a write is in flight, so this surface refuses its own repeated press. The guard that
  // actually stops a second write is the module's `writing`; this is what the button draws.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const reader = (next: ServerReading | null, forget = false) => {
      if (!live) return;
      if (forget) {
        // Every position goes together (see `forgetPosition`). Labels and sentences stay, so the card keeps
        // the names and draws no switch where a position is not known.
        setReading((last) => ({
          kinds: last.kinds === null ? null : last.kinds.map((held) => ({ ...held, enabled: null })),
          unreadable: true,
          ready: null,
          why: null,
        }));
        return;
      }
      if (next === null) {
        setReading((last) => ({ ...last, unreadable: true }));
        return;
      }
      setReading({ kinds: next.kinds, unreadable: false, ready: next.ready, why: next.why });
    };
    readers.add(reader);
    // Drawn at once, before the ask below can be answered — see `known`.
    if (known !== null) reader(known);
    void ask();

    // Coming back to the page is the one moment the readings can have moved under a surface that is already
    // mounted — a flip from another device, or an update run in a shell. Skipped while a write is in flight:
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
      // Dropped, so an answer arriving after this surface is gone cannot land on the run that replaced it.
      // The ask itself is deliberately NOT cancelled: `ask` still owes its answer to every reader still on screen.
      readers.delete(reader);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const refresh = useCallback(async () => {
    await ask();
  }, []);

  const setEnabled = useCallback(async (kind: string, next: boolean) => {
    if (writing) return;
    setSaving(true);
    // Optimistic, then corrected: the server answers with what it read back off the files, so a write that
    // lands differently than asked still ends with the card telling the truth. Only the one kind's position
    // moves here; the others, and the readiness, are left as last read.
    setReading((last) => ({
      ...last,
      kinds: last.kinds === null
        ? null
        : last.kinds.map((held) => (held.kind === kind ? { ...held, enabled: next } : held)),
      unreadable: false,
    }));
    await write(kind, next);
    setSaving(false);
  }, []);

  return { ...reading, saving, setEnabled, refresh };
}
