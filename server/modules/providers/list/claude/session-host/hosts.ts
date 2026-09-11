/**
 * The host registry: where a host's files live, which hosts are still alive, and how a host
 * that lost its claim on an app session is wound down.
 *
 * Two rules this file exists to keep:
 * - Liveness is the tmux session, never the meta file. A meta says what a host believed when
 *   it last wrote; only tmux says whether anything is still running. Every ask carries a
 *   timeout so a wedged tmux server cannot block the API's event loop, and the boot path asks
 *   once for all hosts rather than once per host.
 * - Retiring a host goes through its socket, never a signal. `end_input` is the only thing
 *   that gives the CLI EOF (D-10), and a SIGTERM that skipped it would drop whatever the CLI
 *   was still writing.
 *
 * Package-internal: nothing here is re-exported from index.ts.
 * consumer: spawner.ts, readopt.ts
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** The tmux server that outlives the API. Its `_keepalive` session is what keeps it up. */
export const TMUX_SOCKET_NAME = 'cloudcli-sessions';
export const KEEPALIVE_SESSION = '_keepalive';

const TMUX_TIMEOUT_MS = 3_000;
// Long enough for a CLI to finish flushing what `end_input` let it write, short enough that a
// boot does not carry a retired host for a minute.
const RETIRE_KILL_DELAY_MS = 5_000;
// The backstop for a host that never reports its `exit`: the retire socket is unref'd, so this
// only decides when to stop listening for the frame, never when the boot may continue.
const RETIRE_GIVE_UP_MS = 120_000;

/** D-1: on disk, not tmpfs — a long turn's journal must not live in RAM. */
export const sessionsDir =
  process.env.CLOUDCLI_SESSIONS_DIR || path.join(os.homedir(), '.cloudcli', 'sessions');

export const hostSocketPath = (hostId: string): string => path.join(sessionsDir, `${hostId}.sock`);
export const hostJournalPath = (hostId: string): string =>
  path.join(sessionsDir, `${hostId}.ndjson`);
export const hostMetaPath = (hostId: string): string => path.join(sessionsDir, `${hostId}.json`);

export type HostMeta = {
  hostId: string;
  appSessionId: string | null;
  userId: string | number | null;
  cwd: string | null;
  startedAt: number;
  pid: number | null;
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
  deferredTools?: string[];
  profile?: Record<string, unknown> | null;
  deliveredSeq: number;
  pendingResults: number[];
  exited: { code: number | null; signal: string | null; at: number } | null;
};

export type LiveHost = {
  hostId: string;
  appSessionId: string;
  userId: string | number | null;
  cwd: string | null;
  startedAt: number;
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
  deferredTools: string[];
  profile: Record<string, unknown> | null;
};

export type TmuxResult = { ok: boolean; stdout: string; error: string | null };

/**
 * Every tmux call in this package. The timeout is the point: `execFileSync` with no timeout
 * against a wedged tmux server would block the whole API, and this runs on the spawn path.
 */
export function tmuxCommand(args: string[]): TmuxResult {
  try {
    const stdout = execFileSync('tmux', ['-L', TMUX_SOCKET_NAME, ...args], {
      encoding: 'utf8',
      timeout: TMUX_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, stdout: stdout ?? '', error: null };
  } catch (err) {
    // A non-zero exit (no such session) and a killed-on-timeout tmux both land here; the
    // caller only ever wants "did this work", plus a reason to log.
    return { ok: false, stdout: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export function isTmuxSessionAlive(name: string): boolean {
  return tmuxCommand(['has-session', '-t', name]).ok;
}

/** The unit's own session: its absence means the whole keepalive server is down. */
export function isKeepaliveServerUp(): boolean {
  return isTmuxSessionAlive(KEEPALIVE_SESSION);
}

/**
 * Every live session name in ONE call.
 *
 * The boot path (D-11) runs ahead of `server.listen`, so asking `has-session` per host id would
 * stall the whole boot by up to the tmux timeout PER stale id, with no ceiling on how many
 * there are.
 *
 * `null` means the question could not be answered, which is NOT the same as "nothing is alive":
 * both callers below decide nothing at all rather than act on an unanswered question.
 */
export function liveSessionNames(): Set<string> | null {
  const listed = tmuxCommand(['list-sessions', '-F', '#{session_name}']);
  if (!listed.ok) return null;
  return new Set(listed.stdout.split('\n').map((name) => name.trim()).filter(Boolean));
}

export function readHostMeta(hostId: string): HostMeta | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(hostMetaPath(hostId), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as HostMeta;
  } catch {
    // Absent, half-written or not JSON: a host without a readable meta is a host we cannot
    // re-adopt, and the sweep will collect its files once its tmux session is gone.
    return null;
  }
}

/** Every host id with a file under `sessionsDir`, including ones that never wrote a meta. */
export function listHostIds(): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const ids = new Set<string>();
  for (const name of entries) {
    for (const suffix of ['.sock', '.ndjson', '.json']) {
      if (name.endsWith(suffix)) ids.add(name.slice(0, -suffix.length));
    }
  }
  return [...ids];
}

/** Hosts whose tmux session is still up and whose CLI has not exited. */
export function listLiveHosts(): LiveHost[] {
  const alive = liveSessionNames();
  // Nothing can be re-adopted against an unanswered tmux; the next boot asks again.
  if (!alive) return [];
  const live: LiveHost[] = [];
  for (const hostId of listHostIds()) {
    const meta = readHostMeta(hostId);
    if (!meta || meta.exited !== null || typeof meta.appSessionId !== 'string') continue;
    if (!alive.has(hostId)) continue;
    live.push({
      hostId,
      appSessionId: meta.appSessionId,
      userId: meta.userId ?? null,
      cwd: meta.cwd ?? null,
      startedAt: typeof meta.startedAt === 'number' ? meta.startedAt : 0,
      turnCompleteSent: meta.turnCompleteSent === true,
      heldForBackgroundWork: meta.heldForBackgroundWork === true,
      deferredTools: Array.isArray(meta.deferredTools)
        ? meta.deferredTools.filter((id): id is string => typeof id === 'string')
        : [],
      profile: meta.profile && typeof meta.profile === 'object' ? meta.profile : null
    });
  }
  return live;
}

/** Removes the two files the attached adapter owns; the host unlinks its own socket. */
export function removeHostJournal(hostId: string): void {
  for (const target of [hostJournalPath(hostId), hostMetaPath(hostId)]) {
    try {
      fs.rmSync(target, { force: true });
    } catch (err) {
      console.warn(
        `[keepalive] could not remove ${path.basename(target)}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * Winds one host down over its own socket: EOF first, then SIGTERM if the CLI is still there.
 * Fire-and-forget by design — a boot must not wait on a CLI it has already decided to drop.
 */
export function retireHost(hostId: string): void {
  const socket = net.connect(hostSocketPath(hostId));
  // A host already gone needs no winding down, and its files are the sweep's business.
  socket.on('error', () => {});
  socket.once('connect', () => {
    const send = (frame: Record<string, unknown>): void => {
      if (socket.writable) socket.write(`${JSON.stringify(frame)}\n`);
    };
    // A cursor past the journal's end replays nothing: this connection exists to end the
    // CLI's stdin, not to read a transcript no one is listening to.
    send({ t: 'hello', fromSeq: Number.MAX_SAFE_INTEGER });
    send({ t: 'end_input' });
    // Whoever is attached when the `exit` frame lands owns the journal and the meta. On this
    // path that is this socket; without it a retired host's files sit on disk until the NEXT
    // boot's sweep. `hello` asked for no replay, so only a few short frames pass through here.
    let tail = '';
    socket.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-2_000);
      if (!tail.includes('"t":"exit"')) return;
      tail = '';
      removeHostJournal(hostId);
      socket.end();
    });
    const killTimer = setTimeout(() => send({ t: 'kill', signal: 'SIGTERM' }), RETIRE_KILL_DELAY_MS);
    // The socket has to OUTLIVE the kill. Ending it with the kill (as this once did) loses the
    // `exit` frame that licenses the cleanup above, because a CLI in the middle of a tool call
    // takes far longer than the kill delay to actually go — measured 3 files left behind.
    const giveUpTimer = setTimeout(() => socket.end(), RETIRE_GIVE_UP_MS);
    // Neither the socket nor the timers may hold the API's event loop open.
    killTimer.unref();
    giveUpTimer.unref();
    socket.once('close', () => {
      clearTimeout(killTimer);
      clearTimeout(giveUpTimer);
    });
  });
  socket.unref();
}

/**
 * One live CLI per app session, decided the same way the provider's supersede branch decides
 * it at runtime: newest wins. Returns the keepers; retires everything older.
 */
export function retireOlderHosts(hosts: LiveHost[]): LiveHost[] {
  const newestPerSession = new Map<string, LiveHost>();
  for (const host of hosts) {
    const held = newestPerSession.get(host.appSessionId);
    if (!held || host.startedAt > held.startedAt) newestPerSession.set(host.appSessionId, host);
  }
  const keepers = [...newestPerSession.values()];
  const kept = new Set(keepers.map((host) => host.hostId));
  for (const host of hosts) {
    if (kept.has(host.hostId)) continue;
    console.log(`[keepalive] retiring superseded host ${host.hostId}`);
    retireHost(host.hostId);
  }
  return keepers;
}

/** Boot housekeeping: a host whose tmux session is gone owns nothing worth keeping. */
export function sweepDeadHosts(): number {
  const alive = liveSessionNames();
  // Sweeping on an unanswered question would destroy a LIVE host's journal the one time the
  // tmux server is merely wedged rather than gone.
  if (!alive) return 0;
  let swept = 0;
  for (const hostId of listHostIds()) {
    if (alive.has(hostId)) continue;
    removeHostJournal(hostId);
    try {
      fs.rmSync(hostSocketPath(hostId), { force: true });
    } catch {
      // Already gone, or never existed; either way this host leaves nothing behind.
    }
    swept += 1;
  }
  return swept;
}
