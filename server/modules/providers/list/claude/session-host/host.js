/**
 * The per-session CLI host: owns one `claude` child inside the keepalive tmux server, journals
 * every stdout line under a single sequence, and brokers a unix socket to whichever API
 * process is currently attached.
 *
 * Two rules this file exists to keep:
 * - A client socket closing is a DETACH, never EOF (D-10). Only an explicit `end_input` frame
 *   ends the CLI's stdin, which is why an API restart cannot end the turn.
 * - The exit frame is the journal's last line AND must reach the attached socket before this
 *   process leaves: the D-3 cursor is worthless if the frame that closes the run is dropped
 *   on the floor by an exit() that raced the write.
 *
 * argv: node host.js <hostId> <sessionsDir>
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { createInitCache, handleConnection } from './host-conn.js';
import { createJournal, sweepStaleMetaTemps } from './host-journal.js';

const UNUSED_TIMEOUT_MS = 30_000;
const EXIT_FLUSH_TIMEOUT_MS = 2_000;
const STDOUT_DRAIN_TIMEOUT_MS = 5_000;

const hostId = process.argv[2];
const sessionsDir =
  process.argv[3] ||
  process.env.CLOUDCLI_SESSIONS_DIR ||
  path.join(os.homedir(), '.cloudcli', 'sessions');

if (!hostId) {
  console.error('[keepalive] usage: host.js <hostId> <sessionsDir>');
  process.exit(2);
}

fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
// mkdir's mode is umask-masked and does nothing at all when the directory already exists,
// and this directory holds every session's transcript (D-1: mode 0700).
try {
  fs.chmodSync(sessionsDir, 0o700);
} catch (err) {
  console.error(`[keepalive] host ${hostId}: could not chmod ${sessionsDir}: ${err.message}`);
}

const sockPath = path.join(sessionsDir, `${hostId}.sock`);
const journal = createJournal({ hostId, sessionsDir });
const initCache = createInitCache();

const reclaimed = sweepStaleMetaTemps(sessionsDir);
if (reclaimed > 0) console.log(`[keepalive] host ${hostId}: reclaimed ${reclaimed} stale meta temp(s)`);

let child = null;
let attachedConn = null;
let childExit = null;
let stdoutClosed = false;
let leaving = false;
let ownsSocket = false;
let unusedTimer = null;
let drainTimer = null;

function log(message) {
  console.log(`[keepalive] host ${hostId}: ${message}`);
}

function releaseOwnFiles() {
  if (!ownsSocket) return;
  ownsSocket = false;
  try {
    fs.rmSync(sockPath, { force: true });
  } catch (err) {
    console.error(`[keepalive] host ${hostId}: could not clean up: ${err.message}`);
  }
}

function deliver(frame) {
  if (!attachedConn || attachedConn.closed) return;
  attachedConn.send(frame);
  journal.markDelivered(frame);
}

function finishExit() {
  if (leaving) return;
  leaving = true;
  clearTimeout(drainTimer);
  const frame = journal.appendExit(childExit.code, childExit.signal);
  const conn = attachedConn;
  const leave = () => {
    releaseOwnFiles();
    process.exit(0);
  };
  if (!conn || conn.closed) {
    leave();
    return;
  }
  journal.markDelivered(frame);
  // socket.end(frame, cb): the callback is the proof the bytes left this process.
  const guard = setTimeout(leave, EXIT_FLUSH_TIMEOUT_MS);
  conn.endWith(frame, () => {
    clearTimeout(guard);
    leave();
  });
}

/** The exit frame waits for the CLI's last stdout line, so nothing is journaled after it. */
function maybeFinish() {
  if (leaving || !childExit || !stdoutClosed) return;
  finishExit();
}

function readCliStdout() {
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    initCache.observe(line);
    deliver(journal.appendOut(line));
  });
  lines.on('close', () => {
    stdoutClosed = true;
    maybeFinish();
  });
}

function spawnCli(frame) {
  if (child) return 'already spawned';
  if (typeof frame.command !== 'string' || !Array.isArray(frame.args)) {
    return 'spawn frame needs command and args';
  }
  try {
    child = spawn(frame.command, frame.args, {
      cwd: frame.cwd || undefined,
      env: frame.env && typeof frame.env === 'object' ? frame.env : process.env,
      stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch (err) {
    return `spawn failed: ${err.message}`;
  }
  // `env` is deliberately absent from the meta and the journal: it carries the API's whole
  // environment, tokens included.
  journal.start({
    appSessionId: frame.appSessionId ?? null,
    userId: frame.userId ?? null,
    cwd: frame.cwd ?? null,
    pid: child.pid,
    // What the CLI was launched with, so a re-adoption can diff the next message against it.
    profile: frame.profile && typeof frame.profile === 'object' ? frame.profile : null
  });
  // A CLI that has already gone means EPIPE on the next write; that is not a host crash.
  child.stdin.on('error', (err) => log(`stdin write failed: ${err.message}`));
  child.on('error', (err) => {
    log(`child error: ${err.message}`);
    childExit = childExit ?? { code: 127, signal: null };
    stdoutClosed = true;
    maybeFinish();
  });
  child.on('exit', (code, signal) => {
    childExit = { code, signal };
    drainTimer = setTimeout(() => {
      stdoutClosed = true;
      maybeFinish();
    }, STDOUT_DRAIN_TIMEOUT_MS);
    maybeFinish();
  });
  readCliStdout();
  log(`spawned pid ${child.pid} in ${frame.cwd ?? process.cwd()}`);
  return null;
}

const host = {
  journal,
  initCache,
  hasChild: () => child !== null && !leaving,
  spawnCli,
  writeStdin(bytes) {
    if (child?.stdin.writable) {
      child.stdin.write(bytes);
      return true;
    }
    log('dropped a stdin line: the CLI stdin is already closed');
    return false;
  },
  /** The ONLY path by which the CLI ever sees EOF. */
  endInput() {
    if (child?.stdin.writable) child.stdin.end();
  },
  kill(signal) {
    if (!child) return;
    try {
      child.kill(signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
    } catch (err) {
      log(`kill(${signal}) failed: ${err.message}`);
    }
  },
  note(frame) {
    journal.note(frame);
  },
  attach(conn) {
    clearTimeout(unusedTimer);
    const previous = attachedConn;
    attachedConn = conn;
    // The newer API wins: an older socket belongs to a process that has already been replaced.
    if (previous && previous !== conn) previous.end();
  },
  detach(conn) {
    if (attachedConn === conn) attachedConn = null;
  }
};

/** A .sock file whose owner is gone would make listen() fail with EADDRINUSE. */
async function claimSocketPath() {
  if (!fs.existsSync(sockPath)) return true;
  const outcome = await new Promise((resolve) => {
    const probe = net.connect(sockPath);
    probe.once('connect', () => {
      probe.destroy();
      resolve('LIVE');
    });
    probe.once('error', (err) => {
      probe.destroy();
      resolve(err.code || 'ERR');
    });
  });
  if (outcome === 'LIVE') return false;
  log(`unlinking stale socket (connect gave ${outcome})`);
  fs.rmSync(sockPath, { force: true });
  return true;
}

function shutdownOnSignal(signal) {
  log(`got ${signal}`);
  if (child) child.kill('SIGTERM');
  else {
    releaseOwnFiles();
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdownOnSignal('SIGTERM'));
process.on('SIGINT', () => shutdownOnSignal('SIGINT'));
// `systemctl stop` runs `tmux kill-server`, which SIGHUPs every pane. Without this handler
// Node's default disposition terminates the host without running any exit hook, orphaning
// the socket and losing the exit frame.
process.on('SIGHUP', () => shutdownOnSignal('SIGHUP'));
process.on('exit', () => releaseOwnFiles());

const server = net.createServer((socket) => handleConnection(socket, host));
server.on('error', (err) => {
  console.error(`[keepalive] host ${hostId}: server error: ${err.message}`);
  process.exit(1);
});

if (!(await claimSocketPath())) {
  console.error(`[keepalive] host ${hostId}: socket already served by a live host`);
  process.exit(1);
}

server.listen(sockPath, () => {
  ownsSocket = true;
  fs.chmodSync(sockPath, 0o600);
  log(`listening on ${sockPath}`);
  unusedTimer = setTimeout(() => {
    if (child) return;
    log('no spawn or hello within 30s, exiting');
    releaseOwnFiles();
    process.exit(0);
  }, UNUSED_TIMEOUT_MS);
});
