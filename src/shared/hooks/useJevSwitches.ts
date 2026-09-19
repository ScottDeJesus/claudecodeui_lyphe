import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { JevConsumerNet, JevLedgerStats, JevSwitchState } from '@/shared/types';

/**
 * The narrower opt-ins, in the order the panel draws them, and the ONE list this hook loops.
 *
 * They mirror the server's table (`server/modules/settings/jev-switches.ts`), which is where the
 * files and the live rule live: a scope added there arrives as two more fields, and adding it here
 * is this entry plus a row in `JevContent.tsx`'s own table. That panel is the second consumer, which
 * is why the list is exported: it draws one row per scope, in this order.
 */
export const JEV_SCOPES = ['prompts', 'toolOutput'] as const;

/** A narrower opt-in: the field it stores, and the field its effect is reported in. */
export type JevScopeName = (typeof JEV_SCOPES)[number];

/** Which switch a write in flight belongs to, so a row can tell its own press from its neighbour's. */
type JevSwitchName = 'master' | JevScopeName;

/** The fields one write names — only the switches moved, never their neighbours. */
type JevSwitchPatch = Partial<Record<JevSwitchName, boolean>>;

/** The live field a scope's effect is reported in, which the server derives and this hook predicts. */
const liveKeyOf = (scope: JevScopeName): `${JevScopeName}Live` => `${scope}Live`;

type JevSwitches = {
  /** The switches as the server last read them off disk, or `null` while no read has succeeded. */
  state: JevSwitchState | null;
  /** The ledger totals, or `null` until a read has answered. Optional furniture: it never blocks a row. */
  stats: JevLedgerStats | null;
  /** True once a read has failed: the position is unknown, which is not the same as off. */
  unreadable: boolean;
  /** The switch whose write is crossing the wire, so every row can refuse a second flip until it lands. */
  saving: JevSwitchName | null;
  /** Move the master switch — the file that decides whether anything leaves this machine at all. */
  setMaster: (next: boolean) => Promise<void>;
  /** Move one narrower opt-in. Its stored value is kept and shown even while the master is off. */
  setScope: (scope: JevScopeName, next: boolean) => Promise<void>;
  /** Ask the server again — the way out of an unreadable set of rows, and the only press a control
   * with no position can honour. */
  refresh: () => Promise<void>;
};

/**
 * How long to wait before asking a second time. A read is a request to a server that has already
 * answered this same question on the write path, so a single failure is far more often a lost packet
 * than a missing file — and the cost of not retrying is a set of controls with no position, which
 * cannot be used at all. Short enough that nobody presses twice first.
 */
const READ_RETRY_MS = 1200;

/** A GET body as a position, or `null` when the server did not answer the contract at all. */
function positionOf(body: unknown): JevSwitchState | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.master !== 'boolean') return null;

  // Every scope's stored value AND its live field, each a real boolean: a body missing one of them
  // is a server this hook does not understand, and half a row drawn from it would be a guess.
  const position: Record<string, boolean> = { master: record.master };
  for (const scope of JEV_SCOPES) {
    const stored = record[scope];
    const live = record[liveKeyOf(scope)];
    if (typeof stored !== 'boolean' || typeof live !== 'boolean') return null;
    position[scope] = stored;
    position[liveKeyOf(scope)] = live;
  }
  return position as JevSwitchState;
}

/** A consumer's net as the panel draws it, or `null` when the field is not the shape it claims. */
function consumerNetOf(value: unknown): JevConsumerNet | null {
  if (typeof value !== 'object' || value === null) return null;
  const { caller, chars } = value as Record<string, unknown>;
  if (typeof caller !== 'string' || typeof chars !== 'number') return null;
  return { caller, chars };
}

/** A stats body as totals, or `null` when it is not the shape the panel draws. */
function ledgerOf(body: unknown): JevLedgerStats | null {
  if (typeof body !== 'object' || body === null) return null;
  const { present, calls, tokens, linesIn, linesKept, netChars, byCaller } = body as Record<string, unknown>;
  if (
    typeof present !== 'boolean' || typeof calls !== 'number' || typeof tokens !== 'number'
    || typeof linesIn !== 'number' || typeof linesKept !== 'number' || typeof netChars !== 'number'
    || !Array.isArray(byCaller)
  ) {
    return null;
  }
  // One malformed consumer is the whole line refused: a list drawn from half-parsed rows would show
  // a total the ledger does not hold.
  const consumers: JevConsumerNet[] = [];
  for (const entry of byCaller) {
    const consumer = consumerNetOf(entry);
    if (consumer === null) return null;
    consumers.push(consumer);
  }
  // The balance is the accounts row's reading (`useJevBalance`); here it is carried, not judged.
  const raw = (body as { balance?: JevLedgerStats['balance'] }).balance;
  const balance = raw && typeof raw.leftUsd === 'number' ? raw : null;
  return { present, calls, tokens, linesIn, linesKept, netChars, byCaller: consumers, balance };
}

/**
 * The house Jev switches and their ledger, read and written from one place.
 *
 * They are flag FILES on this host, read by Python at call time, which is why every read here is a
 * request to the server rather than a value the browser already holds — and why the write
 * RE-READS instead of echoing what was asked for.
 *
 * One instance per surface and no module-wide registry, unlike `useDeepSeekFlashSwitch`: that one
 * is drawn in two places at once (the settings row and the composer's chip) and needs a shared
 * clock to stop them disagreeing, while these rows exist once. The ordering that matters here is
 * within the instance — a mount read in flight while the operator flips a switch — and the epoch
 * below closes it. A SECOND surface would need the registry, not a copy of this.
 */
export function useJevSwitches(): JevSwitches {
  // The switches live in another process's files; until the server answers there is no honest
  // position to draw, and `null` is what keeps the rows from flickering through a wrong one.
  const [state, setState] = useState<JevSwitchState | null>(null);
  // Kept beside the switch position because it is the same question asked of the same host: what is
  // on disk right now. `null` means no ledger read has answered yet, and the line is simply absent.
  const [stats, setStats] = useState<JevLedgerStats | null>(null);
  // Set when a read comes back with nothing, so a row can say the position is unknown rather than
  // drawing one it does not have. Cleared by the first read that answers.
  const [unreadable, setUnreadable] = useState(false);
  // Which row's write is in flight, so that row can refuse its own repeated press. The guard that
  // actually stops a second write is `writingRef`; this is what the row draws.
  const [saving, setSaving] = useState<JevSwitchName | null>(null);

  // False once this instance is gone, so an answer arriving after unmount is not drawn on a run
  // that replaced it. A ref rather than state: it is read inside async continuations, never rendered.
  const liveRef = useRef(true);
  // How many authoritative positions have been established — one as a write is issued, one when its
  // answer is published. An answer whose epoch has moved on is older than what is on screen.
  const epochRef = useRef(0);
  /** A read is out to the server. */
  const readingRef = useRef(false);
  /** Another ask arrived while one was out; it is the newer question and is answered after it. */
  const queuedRef = useRef(false);
  /** A write is crossing the wire. Held around the write and nothing else. */
  const writingRef = useRef(false);

  const readPosition = useCallback(async (): Promise<JevSwitchState | null> => {
    try {
      return positionOf(await (await api.settings.jev()).json());
    } catch (error) {
      console.error('Error loading the Jev switches:', error);
      return null;
    }
  }, []);

  const readLedger = useCallback(async (): Promise<void> => {
    try {
      const totals = ledgerOf(await (await api.settings.jevStats()).json());
      if (liveRef.current && totals !== null) setStats(totals);
    } catch (error) {
      // The line is furniture, not the setting: a failed stats read leaves the last totals in place
      // rather than taking the switches down with it.
      console.error('Error loading the Jev ledger:', error);
    }
  }, []);

  /**
   * Ask the server where the switches are, and draw the answer.
   *
   * One read at a time: a second row asking the same question of the same files is a request that
   * cannot say anything the first will not, and it is what puts two answers in flight whose arrival
   * order would decide what is shown. A question asked while one is out is remembered and asked for
   * real the moment the one in flight lands — dropping it is how a slow answer gets to decide.
   */
  const ask = useCallback(async (): Promise<void> => {
    if (readingRef.current) {
      queuedRef.current = true;
      return;
    }

    readingRef.current = true;
    do {
      queuedRef.current = false;
      // The clock as it stood when this question was put: an answer is worth drawing only if no
      // write has been issued since, because that write is already moving the file past this.
      const at = epochRef.current;

      let next = await readPosition();
      if (next === null) {
        await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
        next = await readPosition();
      }

      if (liveRef.current && at === epochRef.current && !queuedRef.current) {
        if (next === null) {
          // Silence is the answer: "could not ask" is not OFF, so the rows keep the position they
          // last knew and say it is unknown.
          setUnreadable(true);
        } else {
          setUnreadable(false);
          setState(next);
        }
      }
    } while (queuedRef.current);

    readingRef.current = false;
  }, [readPosition]);

  /**
   * Flip one switch, and draw the position the server read back off the files.
   *
   * Only the switch named is sent, so moving one row can never move another as a side effect — they
   * are separate files with separate blast radii, and an opt-in's stored value has to survive its
   * neighbour being turned off.
   */
  const write = useCallback(async (
    which: JevSwitchName,
    patch: JevSwitchPatch,
  ): Promise<void> => {
    // Dropped rather than queued: two flips racing onto the same file would leave whichever answer
    // landed last to decide, and the loser's optimistic position to be corrected by it.
    if (writingRef.current) return;
    writingRef.current = true;
    // Retire every read issued before this point, so one still on the wire cannot arrive after this
    // write's answer and put the row back on the side the file is in the middle of leaving.
    epochRef.current += 1;
    setSaving(which);
    // Optimistic, then corrected: the server answers with what it read back off disk. Each live
    // field is re-derived here rather than carried over, because the press that just happened may
    // have moved the switch every scope's liveness is multiplied by.
    setState((previous) => {
      if (previous === null) return previous;
      const optimistic: JevSwitchState = { ...previous };
      if (patch.master !== undefined) optimistic.master = patch.master;
      for (const scope of JEV_SCOPES) {
        const stored = patch[scope];
        if (stored !== undefined) optimistic[scope] = stored;
      }
      // Derived after every stored value is placed, and for every scope: a press on the master alone
      // changes what each stored opt-in adds up to.
      for (const scope of JEV_SCOPES) {
        optimistic[liveKeyOf(scope)] = optimistic.master && optimistic[scope];
      }
      return optimistic;
    });
    setUnreadable(false);

    let next: JevSwitchState | null = null;
    try {
      next = positionOf(await (await api.settings.saveJev(patch)).json());
    } catch (error) {
      console.error('Error saving the Jev switches:', error);
    }
    // Re-read on failure, never `!next`. Inverting is a guess about files this process does not own:
    // they are host-wide, so a failed write can perfectly well land on a file another operator just
    // set the way this one meant to, and asking is the only way to know.
    if (next === null) next = await readPosition();

    // Cleared even when the instance is gone — these are resets of in-flight flags, not claims about
    // a position, and a remount (StrictMode runs one) inherits the refs and must not find them stuck.
    writingRef.current = false;
    setSaving(null);

    // Nothing below may be published on an instance that is gone: the position would be drawn by a
    // run this one no longer owns. The read path obeys the same rule (`ask`).
    if (!liveRef.current) return;

    if (next === null) {
      // The write failed AND the server cannot be asked, so the position on screen is the optimistic
      // one this hook invented — never read off disk. Drawing it as known is the "switch drawn off
      // for a switch that is on" failure: the write may well have landed, and the operator would go
      // on believing nothing leaves the box. Unknown is drawn as unknown, and the row's Retry press
      // is the way back.
      epochRef.current += 1;
      setState(null);
      setUnreadable(true);
      return;
    }

    epochRef.current += 1;
    setUnreadable(false);
    setState(next);
  }, [readPosition]);

  // Mount only: these files belong to another process, so the position has to be ASKED for, and a
  // re-read on every render would fight the write in flight.
  useEffect(() => {
    liveRef.current = true;
    void ask();
    void readLedger();

    // Coming back to the page is the one moment either file can have moved under a surface that would
    // otherwise never ask again — the operator flips a switch from a phone, or from another window,
    // and this one must not go on showing the old side. Skipped while a write is in flight: that
    // write's own answer is already on its way.
    const onFocus = () => {
      if (writingRef.current) return;
      void ask();
      void readLedger();
    };
    // `focus` alone is not this moment on a phone: iOS Safari fires no reliable window blur/focus on
    // an app switch, which is the very case the re-read exists for. `visibilitychange` is the event
    // that fires there, so both are listened for.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      liveRef.current = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [ask, readLedger]);

  const refresh = useCallback(async (): Promise<void> => {
    await ask();
    await readLedger();
  }, [ask, readLedger]);

  const setMaster = useCallback(
    (next: boolean) => write('master', { master: next }),
    [write],
  );
  // One setter for every scope rather than one per scope: the patch names the scope it moves, and a
  // scope added to the list above needs nothing here.
  const setScope = useCallback(
    (scope: JevScopeName, next: boolean) => {
      const patch: JevSwitchPatch = {};
      patch[scope] = next;
      return write(scope, patch);
    },
    [write],
  );

  return { state, stats, unreadable, saving, setMaster, setScope, refresh };
}
