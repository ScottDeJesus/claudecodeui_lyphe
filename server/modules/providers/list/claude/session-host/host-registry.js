// @ts-check
/**
 * The host registry: where a host's files live, which hosts are still alive, how a host is
 * started and reached, and how a host that lost its claim on an app session is wound down.
 *
 * Plain JavaScript on node builtins alone, with no `@/` import, so a process other than the API
 * can import it by relative path as it stands (the Cerberus warden — design/cerberus/ARC_BRIEF.md,
 * ruling 2). Each process makes its own instance with its own tmux server, keepalive session and
 * sessions directory; the API's is `hosts.ts`.
 *
 * Two rules this file exists to keep:
 * - Liveness is the tmux session, never the meta file. A meta says what a host believed when
 *   it last wrote; only tmux says whether anything is still running. Every ask carries a
 *   timeout so a wedged tmux server cannot block the caller's event loop, and the boot path asks
 *   once for all hosts rather than once per host.
 * - Retiring a host goes through its socket, never a signal. `end_input` is the only thing
 *   that gives the CLI EOF (D-10), and a SIGTERM that skipped it would drop whatever the CLI
 *   was still writing.
 *
 * consumer: hosts.ts (the API's instance; spawner.ts, readopt.ts and idle-version-sweep.ts use it there)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What a host writes to its own meta file (`host.js`). `pendingControl` is absent on a meta from
 * before the field.
 * @typedef {{
 *   hostId: string, appSessionId: string | null, userId: string | number | null, cwd: string | null,
 *   startedAt: number, pid: number | null, turnCompleteSent: boolean, heldForBackgroundWork: boolean,
 *   deferredTools?: string[], profile?: Record<string, unknown> | null, deliveredSeq: number,
 *   pendingResults: number[], pendingControl?: { seq: number, requestId: string }[],
 *   exited: { code: number | null, signal: string | null, at: number } | null
 * }} HostMeta
 */

/**
 * A host whose CLI is still running, as `listLiveHosts` reads it: the meta's fields, plus
 * `cliVersion` out of the host's own journal (`lastReportedCliVersion`) and `cliPid`, the CLI the
 * host owns (`child.pid` in `host.js`) — null for a meta that holds none.
 * @typedef {{
 *   hostId: string, appSessionId: string, userId: string | number | null, cwd: string | null,
 *   startedAt: number, turnCompleteSent: boolean, heldForBackgroundWork: boolean,
 *   deferredTools: string[], profile: Record<string, unknown> | null,
 *   cliVersion: string | null, cliPid: number | null
 * }} LiveHost
 */

/** @typedef {{ ok: boolean, stdout: string, error: string | null }} TmuxResult */

const TMUX_TIMEOUT_MS = 3_000;
// Long enough for a CLI to finish flushing what `end_input` let it write, short enough that a
// boot does not carry a retired host for a minute.
const RETIRE_KILL_DELAY_MS = 5_000;
// The backstop for a host that never reports its `exit`: the retire socket is unref'd, so this
// only decides when to stop listening for the frame, never when the boot may continue.
const RETIRE_GIVE_UP_MS = 120_000;
/** How far back, per read, the journal is scanned for what a boot wants out of its tail. */
const JOURNAL_SCAN_CHUNK_BYTES = 256 * 1024;
const CONNECT_RETRY_MS = 50;

/** The host process tmux execs for every session: this directory's `host.js`. */
export const HOST_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'host.js');

/**
 * The `claude_code_version` of one journal entry when it is CLI output carrying an init, else null.
 * @param {string} raw
 * @returns {string | null}
 */
function readInitVersion(raw) {
  // Cheapest test first: almost every line is an assistant delta, and neither `JSON.parse` may run
  // for it.
  if (!raw.includes('claude_code_version')) return null;
  try {
    const entry = JSON.parse(raw);
    if (entry.t !== 'out' || typeof entry.line !== 'string') return null;
    const output = JSON.parse(entry.line);
    return typeof output.claude_code_version === 'string' ? output.claude_code_version : null;
  } catch {
    return null;
  }
}

/**
 * The `at` of one journal entry when it is CLI output carrying a `result`, else null.
 * @param {string} raw
 * @returns {number | null}
 */
function readResultAt(raw) {
  if (!raw.includes('"t":"out"') || !raw.includes('result')) return null;
  try {
    const entry = JSON.parse(raw);
    if (entry.t !== 'out' || typeof entry.at !== 'number' || typeof entry.line !== 'string') return null;
    const output = JSON.parse(entry.line);
    return output.type === 'result' ? entry.at : null;
  } catch {
    return null;
  }
}

/**
 * One registry over one tmux server and one sessions directory.
 *
 * @param {object} config
 * @param {string} config.tmuxSocketName The private tmux server that outlives its owner (`tmux -L <name>`).
 * @param {string} config.keepaliveSession The do-nothing session whose presence means that tmux server is up.
 * @param {string} config.sessionsDir Where every host's socket, journal and meta live (D-1: on disk, not tmpfs).
 */
export function createHostRegistry({ tmuxSocketName, keepaliveSession, sessionsDir }) {
  /** @type {(hostId: string) => string} */
  const hostSocketPath = (hostId) => path.join(sessionsDir, `${hostId}.sock`);
  /** @type {(hostId: string) => string} */
  const hostJournalPath = (hostId) => path.join(sessionsDir, `${hostId}.ndjson`);
  /** @type {(hostId: string) => string} */
  const hostMetaPath = (hostId) => path.join(sessionsDir, `${hostId}.json`);

  /**
   * Every tmux call in this registry. The timeout is the point: `execFileSync` with no timeout
   * against a wedged tmux server would block the whole caller, and this runs on the spawn path.
   * @param {string[]} args
   * @returns {TmuxResult}
   */
  function tmuxCommand(args) {
    try {
      const stdout = execFileSync('tmux', ['-L', tmuxSocketName, ...args], {
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

  /** @type {(name: string) => boolean} */
  const isTmuxSessionAlive = (name) => tmuxCommand(['has-session', '-t', name]).ok;

  /**
   * The unit's own session: its absence means the whole keepalive server is down.
   * @returns {boolean}
   */
  function isServerUp() {
    return isTmuxSessionAlive(keepaliveSession);
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
   * @returns {Set<string> | null}
   */
  function liveSessionNames() {
    const listed = tmuxCommand(['list-sessions', '-F', '#{session_name}']);
    if (!listed.ok) return null;
    return new Set(listed.stdout.split('\n').map((name) => name.trim()).filter(Boolean));
  }

  /**
   * @param {string} hostId
   * @returns {HostMeta | null}
   */
  function readHostMeta(hostId) {
    try {
      const parsed = JSON.parse(fs.readFileSync(hostMetaPath(hostId), 'utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      // Absent, half-written or not JSON: a host without a readable meta is a host we cannot
      // re-adopt, and the sweep will collect its files once its tmux session is gone.
      return null;
    }
  }

  /**
   * Every host id with a file under `sessionsDir`, including ones that never wrote a meta.
   * @returns {string[]}
   */
  function listHostIds() {
    /** @type {string[]} */
    let entries;
    try {
      entries = fs.readdirSync(sessionsDir);
    } catch {
      return [];
    }
    const ids = new Set();
    for (const name of entries) {
      for (const suffix of ['.sock', '.ndjson', '.json']) {
        if (name.endsWith(suffix)) ids.add(name.slice(0, -suffix.length));
      }
    }
    return [...ids];
  }

  /**
   * Hosts whose tmux session is still up and whose CLI has not exited.
   * @returns {LiveHost[]}
   */
  function listLiveHosts() {
    const alive = liveSessionNames();
    // Nothing can be re-adopted against an unanswered tmux; the next boot asks again.
    if (!alive) return [];
    /** @type {LiveHost[]} */
    const live = [];
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
          ? meta.deferredTools.filter((id) => typeof id === 'string')
          : [],
        profile: meta.profile && typeof meta.profile === 'object' ? meta.profile : null,
        // Out of the journal, not the meta: what the CLI said about itself, at the one moment it said
        // it. A host spawned before this field existed answers just the same.
        cliVersion: lastReportedCliVersion(hostId),
        cliPid: Number.isInteger(meta.pid) && /** @type {number} */ (meta.pid) > 0 ? /** @type {number} */ (meta.pid) : null
      });
    }
    return live;
  }

  /**
   * Walks the journal's lines NEWEST first and stops at the first one `visit` claims.
   *
   * Backwards in chunks, so a multi-megabyte journal costs one chunk when the line wanted is at the
   * tail. Whether an answer is worth a deeper read is the caller's business, never this walk's.
   * @param {string} hostId
   * @param {(raw: string) => boolean} visit
   * @returns {boolean}
   */
  function journalLineNewestFirst(hostId, visit) {
    /** @type {number} */
    let fd;
    try {
      fd = fs.openSync(hostJournalPath(hostId), 'r');
    } catch {
      return false;
    }
    try {
      let position = fs.fstatSync(fd).size;
      let carry = '';
      while (position > 0) {
        const length = Math.min(JOURNAL_SCAN_CHUNK_BYTES, position);
        position -= length;
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, position);
        const lines = (buffer.toString('utf8') + carry).split('\n');
        // The first piece may be the tail of a line that starts in the previous chunk.
        carry = position > 0 ? (lines.shift() ?? '') : '';
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (visit(lines[i])) return true;
        }
      }
      return visit(carry);
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * When the host's CLI last ended a turn — the `at` of the newest `result` line in its journal — or
   * null when it never has.
   *
   * Re-adoption asks it to tell a turn whose end the previous server already recorded from one that
   * ended without a recorded completion (a follow-up turn a background task pushed): only the second
   * is news for the unread dot.
   * @param {string} hostId
   * @returns {number | null}
   */
  function lastTurnFinishedAt(hostId) {
    /** @type {number | null} */
    let found = null;
    journalLineNewestFirst(hostId, (raw) => {
      found = readResultAt(raw);
      return found !== null;
    });
    return found;
  }

  /**
   * The Claude CLI version the host's CLI announced at its own init — the newest such line in its
   * journal — or null when the journal holds none.
   *
   * The journal IS the run's own record of what its process said, written by the host as that line
   * passed through it, so a server that adopts this host later reads the version from the process it
   * is adopting rather than from the installed binary: those are two different processes, and the
   * second can be a newer build. That is the whole comparison — a live host on an older version is
   * retired at its next message (chat-process.ts, `planLiveChanges`).
   *
   * A version is a property of the PROCESS, not of a turn, so the newest such line answers for the
   * whole host — including a host that has run no turn since it was spawned, if its own start ever
   * printed one. Null is "not heard", which is never a reason to replace anything.
   * @param {string} hostId
   * @returns {string | null}
   */
  function lastReportedCliVersion(hostId) {
    /** @type {string | null} */
    let version = null;
    journalLineNewestFirst(hostId, (raw) => {
      version = readInitVersion(raw);
      return version !== null;
    });
    return version;
  }

  /**
   * Removes the two files the attached adapter owns; the host unlinks its own socket.
   * @param {string} hostId
   */
  function removeHostJournal(hostId) {
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
   * @param {string} hostId
   * @param {() => void} [onEnded] Called once, from the socket's `close`, when the retire is over: the
   *   host said `exit` and its journal and meta are removed, it was already gone, or the give-up
   *   timer ended the wait. It must not throw. The warden tells center with it (`sessions.changed`).
   */
  function retireHost(hostId, onEnded) {
    const socket = net.connect(hostSocketPath(hostId));
    // A host already gone needs no winding down, and its files are the sweep's business.
    socket.on('error', () => {});
    if (onEnded) socket.once('close', () => onEnded());
    socket.once('connect', () => {
      /** @param {Record<string, unknown>} frame */
      const send = (frame) => {
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
      socket.on('data', (/** @type {Buffer} */ chunk) => {
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
      // Neither the socket nor the timers may hold the caller's event loop open.
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
   * it at runtime: newest wins. Returns the keepers; retires everything older through `retire`
   * (this registry's own `retireHost` unless the caller reaches the host another way).
   * @param {LiveHost[]} hosts
   * @param {(hostId: string) => void} [retire]
   * @returns {LiveHost[]}
   */
  function retireOlderHosts(hosts, retire = retireHost) {
    /** @type {Map<string, LiveHost>} */
    const newestPerSession = new Map();
    for (const host of hosts) {
      const held = newestPerSession.get(host.appSessionId);
      if (!held || host.startedAt > held.startedAt) newestPerSession.set(host.appSessionId, host);
    }
    const keepers = [...newestPerSession.values()];
    const kept = new Set(keepers.map((host) => host.hostId));
    for (const host of hosts) {
      if (kept.has(host.hostId)) continue;
      console.log(`[keepalive] retiring superseded host ${host.hostId}`);
      retire(host.hostId);
    }
    return keepers;
  }

  /**
   * Boot housekeeping: a host whose tmux session is gone owns nothing worth keeping.
   * @returns {number}
   */
  function sweepDeadHosts() {
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

  /**
   * Starts `host.js` as its own tmux session and returns once tmux has accepted it; the host
   * still has to reach `listen`, which is what `connectToHost`'s retry window is for. Throws
   * when tmux refuses: a duplicate session name, or no server — `error.code` is then
   * `HOST_SERVER_DOWN`. `-f /dev/null` keeps the operator's tmux.conf out of a server it was
   * never written for.
   *
   * THE SERVER IS ASKED FOR IN THE SAME COMMAND LINE: `has-session -t <keepalive> ; new-session …`
   * is one tmux invocation, so a server that is not up refuses the spawn instead of `new-session`
   * starting a server of its own inside the CALLER's process group — a warden's host would then
   * die with the warden's service, the very thing the keepalive unit exists to prevent. Callers'
   * own `isServerUp` checks are only for saying so early; nothing depends on them.
   * @param {string} hostId
   * @param {string} cwd
   */
  function spawnHostSession(hostId, cwd) {
    const created = tmuxCommand([
      '-f',
      '/dev/null',
      'has-session',
      '-t',
      keepaliveSession,
      ';',
      'new-session',
      '-d',
      '-s',
      hostId,
      '-c',
      cwd,
      process.execPath,
      HOST_SCRIPT,
      hostId,
      sessionsDir
    ]);
    if (created.ok) return;
    // Told apart AFTER the refusal and only to word it: the refusal was tmux's own, whichever it was.
    if (!isServerUp()) {
      throw Object.assign(new Error(`the keepalive tmux server is not running (${keepaliveSession})`), { code: 'HOST_SERVER_DOWN' });
    }
    throw new Error(`tmux new-session failed: ${created.error}`);
  }

  /**
   * Retries because the host is exec'd by tmux: ENOENT before the deadline means "not yet".
   * @param {string} hostId
   * @param {number} timeoutMs
   * @returns {Promise<import('node:net').Socket>}
   */
  function connectToHost(hostId, timeoutMs) {
    const sockPath = hostSocketPath(hostId);
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const socket = net.connect(sockPath);
        socket.once('connect', () => {
          socket.removeAllListeners('error');
          resolve(socket);
        });
        socket.once('error', (/** @type {NodeJS.ErrnoException} */ err) => {
          socket.destroy();
          if (Date.now() >= deadline) {
            reject(new Error(`socket ${path.basename(sockPath)}: ${err.message}`));
            return;
          }
          setTimeout(attempt, CONNECT_RETRY_MS).unref();
        });
      };
      attempt();
    });
  }

  return {
    sessionsDir,
    hostSocketPath,
    hostJournalPath,
    hostMetaPath,
    tmuxCommand,
    isTmuxSessionAlive,
    isServerUp,
    liveSessionNames,
    readHostMeta,
    listHostIds,
    listLiveHosts,
    lastTurnFinishedAt,
    lastReportedCliVersion,
    removeHostJournal,
    retireHost,
    retireOlderHosts,
    sweepDeadHosts,
    spawnHostSession,
    connectToHost
  };
}
