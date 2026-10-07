// The warden's session host: the node-side half of a Claude session that runs on this machine for a
// project center assigned here. It is the CLIENT of `session-host/host.js` that the API is on its own
// machine — one unix socket per host — and what the API's `bindSocket` does with that socket, this
// does over the link: each line the host writes goes up as one `session.frame`, each `session.frame`
// from center is written to the socket. The frames are `CerberusSession*Body` in `cerberus-types.ts`;
// the host protocol is `session-host/MANUAL.md`.
//
// ONE IMPLEMENTATION. Where hosts live, which are alive, how one is started, reached and retired is
// `host-registry.js` — the file the API runs too (`hosts.ts`), imported by the same relative path from
// the checkout and from the release (`server/...` sits beside `warden/` in both). Nothing of it, or of
// `host.js`, is copied here; this file only adds what is the warden's own: channels, and the link.
//
//   CHANNEL   center's `chan` names one holder of one host. `session.open` makes it (`spawn` starts a fresh
//             host in this warden's own tmux server, `attach` joins a running one), and the first line the
//             host hears is the open's `frame`. It ends four ways, and each is said once: the host's `exit`
//             frame (relayed, then the journal and meta removed — the warden was the attached client), a
//             `session.detach` (nothing is answered), the socket closing with no `exit`, which is
//             `session.closed` with a sentence, or a host line too big for one frame of the link, which is
//             `session.closed` naming the size — the host is detached, never ended, and the link stands.
//   DETACH    a client socket closing is a DETACH, never end-of-file (MAN-688): the warden writes `end_input`
//             only when center sends one, and when the LINK drops it ends every channel socket and nothing
//             more, so the CLI keeps working and center re-attaches when the link is back.
//   NOT THE OUTBOX  a session frame is never queued for resend: the host's journal and its cursor are the
//             replay (`hello { fromSeq }`), and a second one here would only disagree with it.
//   SECRETS   a `spawn` frame carries the CLI's whole environment. No line this file logs ever names a frame.
//   CLEANUP   `sweepDeadHosts` removes the files of hosts whose tmux session is gone. It runs when something
//             says a host may be gone — at start, when the link comes up, when an attach finds its host dead
//             and when a channel's socket closes with no `exit` — never on a timer.
import fs from 'node:fs';
import path from 'node:path';

import { createHostRegistry } from '../../server/modules/providers/list/claude/session-host/host-registry.js';
import { log } from './log.mjs';
import { oneLine } from './wire.mjs';

/** How long a fresh host gets to reach `listen` (tmux execs it), and a running one to answer. */
const SPAWN_CONNECT_MS = 5000;
const ATTACH_CONNECT_MS = 2000;

const SESSION_SERVER_DOWN = "The warden's session server is not running (cerberus-warden-sessions)";

// Center's gateway closes the WHOLE link on a frame past 8 MiB (`MAX_FRAME_BYTES`, warden-gateway.ts), and a host
// line is replayed from the journal at every attach — one that does not fit would close the link again and again.
// The 16 KiB leaves room for the envelope around the line.
const MAX_FRAME_MIB = 8;
const MAX_LINE_BYTES = MAX_FRAME_MIB * 1024 * 1024 - 16 * 1024;

/** Whether `line` is too big for one frame. A UTF-16 unit is at most 3 bytes, so the exact count is taken only when it could matter. */
const exceedsFrame = (line) => line.length > MAX_LINE_BYTES || (line.length * 3 > MAX_LINE_BYTES && Buffer.byteLength(line) > MAX_LINE_BYTES);

/** A host id is a file name and a tmux session name: letters, digits, `-` and `_`, which is every id the API makes. */
const HOST_ID = /^[A-Za-z0-9_-]{1,200}$/;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `frame` is a host protocol frame: an object with its discriminator. */
function isHostFrame(frame) {
  return isRecord(frame) && typeof frame.t === 'string' && frame.t !== '';
}

/** What a failed child process says: Node's message is the command line, then tmux's own words. The words are the reason. */
function failureDetail(message) {
  const lines = String(message).split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 1 ? lines.slice(1).join(' ') : (lines[0] ?? 'no reason given');
}

/** The sentence saying why a `session.open` body cannot be served, or null. */
function openProblem({ op, hostId, cwd, frame }) {
  if (op !== 'spawn' && op !== 'attach') return `Unknown session operation ${JSON.stringify(op)}`;
  if (typeof hostId !== 'string' || !HOST_ID.test(hostId)) return 'The host id is not a usable name';
  if (op === 'spawn' && (typeof cwd !== 'string' || !path.isAbsolute(cwd))) return 'A new session needs the absolute path to start in';
  if (!isHostFrame(frame)) return 'The open carries no first frame for the host';
  return null;
}

/**
 * @param {{
 *   link: {
 *     on(type: string, handler: (body: object, envelope: object) => void): unknown,
 *     send(type: string, body: object, options?: { reliable?: boolean }): unknown,
 *   },
 *   home: string,
 * }} options `link` is the warden's link, or anything with `on` and `send`; it also announces `link.down`
 * (see `link.mjs`). `home` is the warden's home: the sessions live in `<home>/sessions`, mode 0700.
 */
export function createSessions({ link, home }) {
  const sessionsDir = path.join(home, 'sessions');
  try {
    fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
    // mkdir's mode is masked by the umask and ignored for a directory that exists, and this one holds transcripts.
    fs.chmodSync(sessionsDir, 0o700);
  } catch (error) {
    // Not the end of the warden: its checks do not need this directory, and an open that cannot use it fails with a sentence.
    log(`could not prepare ${sessionsDir}: ${error.message}`);
  }
  const registry = createHostRegistry({ tmuxSocketName: 'cerberus-warden', keepaliveSession: '_keepalive', sessionsDir });

  /** @type {Map<string, { hostId: string, socket: import('node:net').Socket | null, waiting: object[] }>} `socket` is null while the open is still connecting; `waiting` holds what center sent meanwhile. */
  const channels = new Map();

  /** A frame to center. Never reliable: a channel dies with its link. Never throws: it is called from socket events. */
  function say(type, body) {
    try {
      link.send(type, body);
    } catch (error) {
      log(`could not send a "${type}" frame: ${error?.message ?? error}`);
    }
  }

  const refuse = (chan, reason) => say('session.closed', { chan, reason: oneLine(reason, 300) });

  function sweep(why) {
    try {
      const swept = registry.sweepDeadHosts();
      if (swept > 0) log(`removed the files of ${swept} ended session host(s) (${why})`);
    } catch (error) {
      log(`could not sweep ended session hosts: ${error?.message ?? error}`);
    }
  }

  function writeFrame(socket, frame) {
    if (socket.writable) socket.write(`${JSON.stringify(frame)}\n`);
  }

  /** The socket of a host, started first when the open is a spawn. Throws the sentence for a person. */
  async function reach(op, hostId, cwd) {
    if (op === 'spawn') {
      if (!registry.isServerUp()) throw new Error(SESSION_SERVER_DOWN);
      try {
        registry.spawnHostSession(hostId, cwd);
      } catch (error) {
        throw new Error(`The session host could not be started: ${failureDetail(error.message)}`);
      }
      return registry.connectToHost(hostId, SPAWN_CONNECT_MS);
    }
    if (!registry.isTmuxSessionAlive(hostId)) {
      sweep(`host ${hostId} is gone`);
      throw new Error(`host ${hostId} is no longer running`);
    }
    return registry.connectToHost(hostId, ATTACH_CONNECT_MS);
  }

  /**
   * Ends a channel whose host line cannot cross the link: the host is DETACHED (never ended) and center is told the size,
   * so the link stands and the other channels with it. `bytes` is what was held when the line was refused, so it may be a floor.
   */
  function dropOversize(chan, entry, bytes) {
    if (channels.get(chan) !== entry) return;
    channels.delete(chan);
    entry.socket.end();
    const mib = (bytes / (1024 * 1024)).toFixed(1);
    log(`host ${entry.hostId} wrote a line of ${mib} MiB or more; the channel is closed`);
    refuse(chan, `A line from host ${entry.hostId} is ${mib} MiB or more, past the ${MAX_FRAME_MIB} MiB one frame of this link carries — the session cannot go on here`);
  }

  /** Sends one host line up. Answers true when the channel is over: the host's `exit`, or a line too big to send. */
  function relayLine(chan, entry, raw) {
    if (exceedsFrame(raw)) {
      dropOversize(chan, entry, Buffer.byteLength(raw));
      return true;
    }
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      log(`host ${entry.hostId} sent a line that is not JSON; dropped`);
      return false;
    }
    if (!isHostFrame(frame)) {
      log(`host ${entry.hostId} sent a frame without a type; dropped`);
      return false;
    }
    say('session.frame', { chan, frame });
    if (frame.t !== 'exit') return false;
    // The host unlinks its own socket on the way out; its journal and meta belong to whoever was attached.
    registry.removeHostJournal(entry.hostId);
    channels.delete(chan);
    entry.socket.end();
    return true;
  }

  /** Wires a connected socket to its channel and writes the open's frame, then whatever center sent while it connected. */
  function relay(chan, entry, socket, firstFrame) {
    entry.socket = socket;
    socket.setNoDelay(true);
    socket.setEncoding('utf8'); // a multi-byte character split across two chunks is not two broken ones
    let partial = '';
    socket.on('data', (text) => {
      if (channels.get(chan) !== entry) return; // ended while the host's last bytes were still on the way
      const lines = (partial + text).split('\n');
      partial = lines.pop();
      for (const raw of lines) {
        if (raw.trim() !== '' && relayLine(chan, entry, raw)) {
          partial = '';
          return;
        }
      }
      // A line still unfinished past the ceiling cannot fit however it ends: stop holding it.
      if (partial.length > MAX_LINE_BYTES) {
        dropOversize(chan, entry, partial.length);
        partial = '';
      }
    });
    socket.on('error', () => {}); // a host that vanishes is `close`'s business
    socket.on('close', () => {
      if (channels.get(chan) !== entry) return; // detached, exited or lost with the link: already settled
      channels.delete(chan);
      refuse(chan, `The connection to host ${entry.hostId} closed`);
      sweep(`host ${entry.hostId} closed its connection`);
    });
    writeFrame(socket, firstFrame);
    for (const frame of entry.waiting.splice(0)) writeFrame(socket, frame);
  }

  async function open(body) {
    const { chan, op, hostId, cwd, frame } = body;
    if (typeof chan !== 'string' || chan === '') {
      log('ignoring a session.open without a chan');
      return;
    }
    const problem = openProblem(body);
    if (problem) {
      log(`refused session.open on ${chan}: ${problem}`);
      refuse(chan, problem);
      return;
    }
    if (channels.has(chan)) {
      // Answering would close the live channel at center, which is the one thing that must not happen.
      log(`ignoring a second session.open on channel ${chan}`);
      return;
    }
    // Claimed before the first await: a detach, a frame or a lost link during the connect finds it.
    const entry = { hostId, socket: null, waiting: [] };
    channels.set(chan, entry);
    let socket;
    try {
      socket = await reach(op, hostId, cwd);
    } catch (error) {
      log(`session.open ${op} ${hostId} failed: ${oneLine(error.message)}`);
      if (channels.get(chan) === entry) {
        channels.delete(chan);
        refuse(chan, error.message);
      }
      return;
    }
    if (channels.get(chan) !== entry) {
      socket.end(); // detached or cut off with the link while it connected
      return;
    }
    relay(chan, entry, socket, frame);
  }

  /** Center's frame for the host. One for a channel that is gone is dropped: center learns of the end from `session.closed`. */
  function frameDown({ chan, frame }) {
    const entry = channels.get(chan);
    if (!entry || !isHostFrame(frame)) return;
    if (entry.socket) writeFrame(entry.socket, frame);
    else entry.waiting.push(frame);
  }

  function detach({ chan }) {
    const entry = channels.get(chan);
    if (!entry) return;
    channels.delete(chan);
    entry.socket?.end(); // a connect still under way ends its socket when it lands
  }

  /** Ends every channel's socket: a DETACH. `end_input` is never written here, so a CLI goes on working. */
  function detachAll() {
    const held = [...channels.values()];
    channels.clear();
    for (const entry of held) entry.socket?.end();
  }

  function list(_body, envelope) {
    const hosts = registry.listLiveHosts().map((host) => ({ ...host, lastTurnFinishedAt: registry.lastTurnFinishedAt(host.hostId) }));
    say('sessions.listed', { re: envelope?.id, hosts });
  }

  function retire({ hostId }) {
    if (typeof hostId !== 'string' || !HOST_ID.test(hostId)) {
      log('ignoring a session.retire without a usable host id');
      return;
    }
    registry.retireHost(hostId);
  }

  link.on('session.open', open);
  link.on('session.frame', frameDown);
  link.on('session.detach', detach);
  link.on('sessions.list', list);
  link.on('session.retire', retire);
  link.on('link.down', () => {
    if (channels.size > 0) log(`link lost; detaching ${channels.size} session channel(s)`);
    detachAll();
  });
  link.on('welcome', () => sweep('the link came up'));

  sweep('the warden started');

  return {
    /** The warden is stopping: every channel is detached; the hosts keep running. */
    stop: detachAll,
  };
}
