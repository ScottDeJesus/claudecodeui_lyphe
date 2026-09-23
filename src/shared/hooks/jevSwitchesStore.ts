import { api } from '@/shared/api';
import type { JevSwitchState } from '@/shared/types';

/** The narrower opt-ins, in the order the surfaces draw them: the ONE list this store loops, mirroring
 * the server's table (`server/modules/settings/jev-switches.ts`), which holds the files and the live
 * rule. A scope added there is this entry plus a row in `JevContent.tsx`'s own table. */
export const JEV_SCOPES = ['prompts', 'toolOutput'] as const;
/** A narrower opt-in: the field it stores, and the field its effect is reported in. */
export type JevScopeName = (typeof JEV_SCOPES)[number];
/** Which switch a write in flight belongs to, so a row can tell its own press from its neighbour's. */
export type JevSwitchName = 'master' | JevScopeName;
/** The fields one write names — only the switches moved, never their neighbours. */
type JevSwitchPatch = Partial<Record<JevSwitchName, boolean>>;
/** The live field a scope's effect is reported in, which the server derives and this store predicts. */
const liveKeyOf = (scope: JevScopeName): `${JevScopeName}Live` => `${scope}Live`;

/** Everything about the switches that is not a way of being told about them: ONE object for the tab,
 * REPLACED rather than mutated, so a subscriber handed the old reference sees it change. */
export type JevSwitchesSnapshot = {
  state: JevSwitchState | null; // as the server last read them off disk; `null` until one answers
  unreadable: boolean; // a read failed: the position is unknown, which is not the same as off
  saving: JevSwitchName | null; // which write is crossing, so a row refuses a second flip
};

/** How long to wait before asking again: one lost packet is cheap next to a control with no position. */
const READ_RETRY_MS = 1200;
/** How long one answer stands for a NEWLY mounting surface: the tab's own poll period. A switch is a
 * flag file a human flips, not a stream, and a read here is one process's file-read. */
const FRESH_FOR_MS = 10_000;

/** A GET body as a position, or `null` when the server did not answer the contract at all. Every
 * scope's stored value AND its live field, each a real boolean: a body missing one of them is a server
 * this store does not understand, and half a row drawn from it would be a guess. */
function positionOf(body: unknown): JevSwitchState | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.master !== 'boolean') return null;
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

/** The switches as the server last answered them, held once for the whole tab. They are flag FILES on
 * this host, so every read is a request to the server — and a copy per surface is two positions that
 * can part company, which is what happened once Settings began drawing these rows. */
let snapshot: JevSwitchesSnapshot = { state: null, unreadable: false, saving: null };
/** Every surface drawing the switches right now. A flip tells them all; none of them owns the state. */
const subscribers = new Set<() => void>();

/** How many authoritative positions have been established — one as a write is issued, one when its
 * answer is published. MODULE level: the files are ONE set of files, so one order of answers is THE
 * order, and a per-surface counter cannot see what another surface established. */
let epoch = 0;
let reading = false; // a read is out to the server
let queued = false; // another ask arrived while one was out; it is the newer question
let writing = false; // a write is crossing the wire; held around the write and nothing else
let answeredAt = 0; // when a read last answered, whatever it answered; `0` until one ever has

/** The snapshot as it stands. Stable between changes, so a reader may compare references. */
export function getJevSwitchesSnapshot(): JevSwitchesSnapshot {
  return snapshot;
}

/** Take the changed fields into a NEW snapshot and hand it to every surface. */
function publish(patch: Partial<JevSwitchesSnapshot>): void {
  // Anything the server said about the position — including that it has none — dates the answer.
  if ('state' in patch || 'unreadable' in patch) answeredAt = Date.now();
  snapshot = { ...snapshot, ...patch };
  for (const listener of subscribers) listener();
}

async function readPosition(): Promise<JevSwitchState | null> {
  try {
    return positionOf(await (await api.settings.jev()).json());
  } catch (error) {
    console.error('Error loading the Jev switches:', error);
    return null;
  }
}

/** Ask the server where the switches are, and hand the answer to every surface. ONE read at a time for
 * the whole tab: a second surface asking the same question of the same files cannot say anything the
 * first will not, and two answers in flight is what lets arrival order decide what is shown. */
async function ask(): Promise<void> {
  if (reading) {
    queued = true;
    return;
  }
  reading = true;
  do {
    queued = false;
    // The clock when this question was put: an answer counts only if no write has been issued since.
    const at = epoch;
    let next = await readPosition();
    if (next === null) {
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
      next = await readPosition();
    }
    // `null` is "could not ask", which is not OFF: the rows keep the last position they knew.
    if (at === epoch && !queued) {
      if (next === null) publish({ unreadable: true });
      else publish({ unreadable: false, state: next });
    }
  } while (queued);
  reading = false;
}

/** The position a press draws while its write is in flight: the last one known, the pressed switch
 * moved, and every scope's live field re-derived, since the press may have moved the switch each one's
 * liveness is multiplied by. `null` stays `null`: inventing a position is the lie `write` forbids. */
function optimisticOf(patch: JevSwitchPatch): JevSwitchState | null {
  const previous = snapshot.state;
  if (previous === null) return null;
  const optimistic: JevSwitchState = { ...previous };
  if (patch.master !== undefined) optimistic.master = patch.master;
  for (const scope of JEV_SCOPES) {
    const stored = patch[scope];
    if (stored !== undefined) optimistic[scope] = stored;
  }
  for (const scope of JEV_SCOPES) optimistic[liveKeyOf(scope)] = optimistic.master && optimistic[scope];
  return optimistic;
}

/** Flip one switch, and publish the position the server read back off the files. Only the switch named
 * is sent — they are separate files with separate blast radii, so an opt-in's stored value survives
 * its neighbour going off. The pressed position reaches every surface as the write is issued, so two
 * mounted surfaces never show two sides of one file; a write that ends nowhere RETRACTS it instead. */
async function write(which: JevSwitchName, patch: JevSwitchPatch): Promise<void> {
  // Dropped rather than queued, module-wide: two flips racing would let the last-landed answer decide.
  if (writing) return;
  writing = true;
  // Retire every read issued before this point, so one on the wire cannot land after this answer.
  epoch += 1;
  publish({ saving: which, unreadable: false, state: optimisticOf(patch) });

  let next: JevSwitchState | null = null;
  try {
    next = positionOf(await (await api.settings.saveJev(patch)).json());
  } catch (error) {
    console.error('Error saving the Jev switches:', error);
  }
  // Re-read on failure, never `!next`: inverting is a guess about files this process does not own.
  if (next === null) next = await readPosition();
  writing = false;

  epoch += 1;
  publish({ saving: null, state: next, unreadable: next === null });
}

/** Ask again: the way out of an unreadable set of rows, and the only press with no position to move. */
export async function refreshJevSwitches(): Promise<void> {
  await ask();
}

/** Move the master switch — the file that decides whether anything leaves this machine at all. */
export async function writeJevMaster(on: boolean): Promise<void> {
  await write('master', { master: on });
}

/** Move one narrower opt-in. Its stored value is kept and shown even while the master is off. */
export async function writeJevScope(scope: JevScopeName, on: boolean): Promise<void> {
  const patch: JevSwitchPatch = {};
  patch[scope] = on;
  await write(scope, patch);
}

/** Coming back to the page is the one moment either file can have moved under surfaces that would
 * otherwise never ask again — a switch flipped from a phone, or another window — and it is skipped
 * while a write is in flight, whose own answer is already on its way. `focus` alone is not this moment
 * on a phone (iOS Safari fires no reliable blur/focus on an app switch), so `visibilitychange` is it. */
function onReturn() {
  if (writing) return;
  void ask();
}

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  onReturn();
}

/** The listeners belong to the TAB, not to a surface: the first mount attaches, the last lets go. */
let listening = false;

/** Draw the shared switches from a surface, and be told when they change. The first subscriber starts
 * the asking: the mount read, and the focus/visibility re-read that belongs to the TAB rather than to
 * each surface, so two mounted surfaces cannot double every refresh. The last one leaving lets the
 * listeners go; the snapshot STAYS, because it is what the next surface draws before its own answer. */
export function subscribeJevSwitches(listener: () => void): () => void {
  const first = subscribers.size === 0;
  subscribers.add(listener);
  if (first) {
    listening = true;
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Only a position missing or older than the window is worth a read: the panel's spinner branch
    // unmounts every surface under it on each range change, and that must not cost a read per press.
    if (Date.now() - answeredAt >= FRESH_FOR_MS) void refreshJevSwitches();
  }
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && listening) {
      listening = false;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}
