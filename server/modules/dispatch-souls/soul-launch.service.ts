import path from 'node:path';

import type { SoulLaunchSnapshot, SoulLaunchState } from '@/shared/types.js';

import { listLaunchDirs, readLaunchFiles, type SoulLaunchFiles } from './soul-launch.transport.js';

/**
 * What the launcher's files MEAN: which launches this lane carries, what each one is doing, and
 * which provider its pin paints.
 *
 * Nothing here touches a socket, an HTTP request or a launch. Given the bytes on disk and a clock
 * it answers with snapshots — which is what lets a hermetic fixture tree prove the whole
 * classification with no soul in existence.
 */

/** The launcher's own word for a soul that ended correctly (`solo/child.py:_write_result`). */
const STATUS_DONE = 'done';

/**
 * The endings that are a CAP rather than a fault: `souls._classify` names the wrapper's own hour
 * and its idle bound, and `orphan` is a child that outlived its pipe. Nothing went wrong with the
 * work, so they are painted as `stopped` — the same amber the pinned agents give the reader's own
 * Stop — and never as a failure.
 */
const STATUS_STOPPED: readonly string[] = ['idle', 'timeout', 'orphan'];

/** How long an ENDED launch stays on the lane after its receipt, when a caller names no window. */
const DEFAULT_ENDED_KEEP_S = 6 * 60 * 60;

/** A finite number, or the fallback. `typeof` alone admits `NaN`, which renders all the way to the DOM. */
function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A finite number, or `null` — for the fields where "not set" is a real answer (`ended_at`, `cost_usd`). */
function readNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A string, or `''`. Free text from the launcher: it reaches the DOM as a text node, never as markup. */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A record's field, without asserting the record is one. */
function field(record: unknown, name: string): unknown {
  return record !== null && typeof record === 'object' ? (record as Record<string, unknown>)[name] : undefined;
}

/**
 * How an ended soul reads on the pin, off its receipt's own `status`.
 *
 * `done` is the launcher's word for a soul that finished and carried words; the cap words are
 * `stopped`; everything else the launcher can write (`crash`, `api_error`, `incomplete`) is a
 * failure. An unrecognised word is a failure too — it is NOT `done`, and saying "finished" about a
 * launch this lane does not understand is the one answer that could mislead.
 */
function stateForStatus(status: string): SoulLaunchState {
  if (status === STATUS_DONE) return 'completed';
  return STATUS_STOPPED.includes(status) ? 'stopped' : 'failed';
}

/**
 * Which provider a launch's pin paints.
 *
 * THE RECEIPT OUTRANKS THE PIN WHEREVER IT SPEAKS. `spec.json` records what the switch settled at
 * launch time and `result.json` records the endpoint the child actually ran on, and the two
 * disagree exactly when a DeepSeek key was refused mid-flight — a case the launcher handles by
 * sending the soul back to Claude, deliberately, so the run finishes. So a live launch paints its
 * pin and an ended one paints what it ran on; the pin never claims DeepSeek for a soul Claude paid
 * for.
 *
 * WHEREVER IT SPEAKS is the part that has to be said out loud, because `result.json` is written by
 * several paths that never ran a child to an endpoint: the crash stub the launcher leaves when a
 * wrapper is killed outright, and the reaper's stub, both carry `status` and no `provider` at all.
 * Reading those as Claude painted six real crashes the Claude mark while the launcher's own
 * `launch.out` said `provider=deepseek` and their `child.log` was full of deepseek-flash models
 * (measured 2026-09-13, 7 of 49 launch directories). A stub with no provider says nothing about the
 * endpoint, so the launch-time pin — which the launcher ALWAYS wrote, before the fork — is what the
 * row reads, and only a launch that recorded no provider either falls back to Claude.
 */
function providerOf(spec: unknown, result: unknown, ended: boolean): 'deepseek' | 'claude' {
  const receipt = ended ? readString(field(result, 'provider')) : '';
  const word = receipt !== '' ? receipt : readString(field(spec, 'provider'));
  return word === 'deepseek' ? 'deepseek' : 'claude';
}

/**
 * One launch directory's snapshot, or `null` when this lane does not carry that launch.
 *
 * A launch is carried while it is OUT, and for {@link DEFAULT_ENDED_KEEP_S} after its receipt.
 * With no receipt it is `running` while either the wrapper that owes the receipt or the child
 * itself is still alive, and `failed` once both are gone and nothing was ever written — the
 * SIGKILLed wrapper the launcher reaps on its next pass. That state is short-lived by design
 * (the reap writes the stub receipt), but it must not read as `running` in the meantime: a pinned
 * row that never finishes is worse than one that says it died.
 *
 * `now` is epoch SECONDS, like every timestamp the launcher's Python wrote with `time.time()`.
 */
export function classifyLaunch(
  files: SoulLaunchFiles,
  now: number,
  keepS: number = DEFAULT_ENDED_KEEP_S,
): SoulLaunchSnapshot | null {
  const { spec, result } = files;
  const startedAt = readNumberOrNull(field(spec, 'started_at'));
  // No spec, or a spec with no start: this directory is not a launch, or not one anything honest
  // could be said about. A `null` drops it rather than putting a phantom on the wall.
  if (spec === null || startedAt === null) return null;

  const ended = result !== null;
  const status = readString(field(result, 'status'));
  const state: SoulLaunchState = ended
    ? stateForStatus(status)
    : files.launcherAlive || files.childAlive
      ? 'running'
      : 'failed';

  const endedAt = ended ? readNumber(field(result, 'ended_at'), startedAt) : null;
  // An ended launch is carried for `keepS` from its OWN end; a launch that died with no receipt
  // has nothing but its start to age against, and is carried from there. Past the window it is
  // omitted whether or not it was dismissed: the state root holds a fortnight of launches and
  // this lane is a pin list, not an archive.
  if (now - (endedAt ?? startedAt) >= keepS) return null;

  return {
    launch_id: files.launchId,
    role: readString(field(spec, 'role')),
    agent: readString(field(spec, 'agent')),
    // The task the soul was handed, as its brief's first line. `''` when it could not be read —
    // absent is honest, and the row simply carries no description.
    brief: files.briefLine,
    provider: providerOf(spec, result, ended),
    // DeepSeek refused this soul or never answered it: the receipt says why, and nothing ran on
    // Claude instead (the launcher never re-routes a soul).
    blocked: readString(field(result, 'provider_blocked')) !== '',
    state,
    status,
    cause: readString(field(result, 'cause')),
    started_at: startedAt,
    ended_at: endedAt,
    // The receipt's own figures, and NOTHING while it is out: a live soul's spend is not knowable
    // from this side, and a zero would read as "free" rather than as "not yet".
    duration_s: ended ? readNumberOrNull(field(result, 'duration_s')) : null,
    cost_usd: ended ? readNumberOrNull(field(result, 'cost_usd')) : null,
    tokens: ended ? readNumberOrNull(field(result, 'tokens')) : null,
  };
}

/**
 * Every launch this lane carries, oldest first.
 *
 * `started_at` ascending is the order the pin strip reads in, and the listing is already sorted by
 * name — which is a timestamp for the ids the launcher mints — so two launches of the same second
 * keep a stable order between ticks rather than swapping places and broadcasting a change that is
 * not one.
 *
 * `keepS` bounds the walk twice: the directory listing skips what nothing has written to since the
 * window opened, and the classification drops what ended before it.
 */
export function snapshotLaunches(
  stateDir: string,
  now: number,
  keepS: number = DEFAULT_ENDED_KEEP_S,
  onLaunchError?: (dir: string, message: string) => void,
): SoulLaunchSnapshot[] {
  const launches: SoulLaunchSnapshot[] = [];
  for (const name of listLaunchDirs(stateDir, (now - keepS) * 1000)) {
    const dir = path.join(stateDir, name);
    try {
      const snapshot = classifyLaunch(readLaunchFiles(dir, name), now, keepS);
      if (snapshot !== null) launches.push(snapshot);
    } catch (error) {
      // ONE unreadable launch never costs the others their reading — but it must not vanish in
      // silence either, since a launch missing from both the list and the frame is
      // indistinguishable from one that never existed. The composition root owns the saying of
      // it, so it hands a door down; this only decides that there is something to say.
      onLaunchError?.(dir, error instanceof Error ? error.message : String(error));
    }
  }
  return launches.sort((left, right) => left.started_at - right.started_at);
}
