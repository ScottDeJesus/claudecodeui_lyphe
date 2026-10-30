import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { FaceBakeRefusal, sentences } from './face-refusal.js';

/**
 * ONE BAKE AT A TIME, BOX-WIDE.
 *
 * The lock is an ABSTRACT UNIX SOCKET, one name per faces root: whoever binds it owns the box's bake, and the kernel
 * frees the name the moment its owner's process ends — however it ends, SIGKILL and the OOM killer included. So the lock
 * is never stale and there is no takeover to race: two bakers starting together cannot both bind one name.
 *
 * The holder answers every connection with its pid and keeps the line open. A second baker connects: the CLI reads the
 * pid and refuses at once, naming it; the API waits, and the CLOSE of that connection — the holder releasing or dying — is
 * the event that wakes it to bind again. Nothing polls.
 *
 * `bake.lock` in the root also holds the baker's pid, for the operator's `cat`. It decides nothing: the next holder
 * overwrites one a killed baker left behind.
 */

const LOCK_NAME = 'bake.lock';

/** How long a holder gets to say its pid before the refusal is worded without it. A deadline, not a poll. */
const ANSWER_DEADLINE_MS = 2000;

/** The lock a baker holds; `release` frees the socket and the note and is safe to call twice. */
type BakeLock = { release(): void };

/** The abstract socket's name: a leading NUL puts it in Linux's abstract namespace, where it is a name and never a file. */
function socketNameOf(root: string): string {
  return `\0companion-face-bake-${createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16)}`;
}

/** The pid a note names: a plain number above 1 (no sign, no leading zero, nothing else), else null. */
function plainPid(text: string): number | null {
  const trimmed = text.trim();
  return /^[1-9][0-9]*$/.test(trimmed) && Number(trimmed) > 1 ? Number(trimmed) : null;
}

/** Binds the lock: the held socket, or null when another process (or this one) already holds the name. */
function tryBind(name: string): Promise<{ server: net.Server; waiters: Set<net.Socket> } | null> {
  return new Promise((resolve, reject) => {
    const waiters = new Set<net.Socket>();
    const server = net.createServer((client) => {
      waiters.add(client);
      client.on('close', () => waiters.delete(client));
      // A peer that vanished mid-answer: its `close` follows and is the only thing that matters here.
      client.on('error', () => undefined);
      client.write(`${process.pid}\n`);
    });
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(null);
      else reject(error);
    });
    server.listen(name, () => {
      server.on('error', (error) => console.error('[Companion] the face bake lock socket failed', error));
      resolve({ server, waiters });
    });
  });
}

type Holder = { pid: number | null; closed: Promise<void>; hangUp(): void };

/**
 * Connects to whoever holds the lock and reads its pid. Null when nobody listens after all (the holder left between our
 * bind and our connect: bind again). `closed` settles when the holder releases or dies.
 */
function askHolder(name: string): Promise<Holder | null> {
  return new Promise((resolve, reject) => {
    const line = net.connect(name);
    let answered = false;
    let heard = '';
    const closed = new Promise<void>((done) => line.once('close', () => done()));
    const answer = (pid: number | null) => {
      if (answered) return;
      answered = true;
      clearTimeout(deadline);
      resolve({ pid, closed, hangUp: () => line.destroy() });
    };
    const deadline = setTimeout(() => answer(null), ANSWER_DEADLINE_MS);

    line.on('data', (chunk) => {
      heard += chunk.toString('utf8');
      if (heard.includes('\n')) answer(plainPid(heard));
    });
    line.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(deadline);
      if (answered) return;
      answered = true;
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve(null);
      else reject(error);
    });
  });
}

/** Parks until the holder's line closes; rejects with the signal's reason on abort, hanging up first. */
function parkUntilClosed(holder: Holder, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      holder.hangUp();
      reject(signal.reason);
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    void holder.closed.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

/** Writes the pid note and makes the release: frees the socket (so the next baker can bind) and removes the note only while it still holds our pid. */
function hold(bound: { server: net.Server; waiters: Set<net.Socket> }, notePath: string): BakeLock {
  try {
    fs.writeFileSync(notePath, `${process.pid}\n`);
  } catch (error) {
    bound.server.close();
    throw error;
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.off('exit', release);
    bound.server.close();
    for (const waiter of bound.waiters) waiter.destroy();
    try {
      if (plainPid(fs.readFileSync(notePath, 'utf8')) === process.pid) fs.rmSync(notePath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[Companion] the face bake lock note could not be removed', error);
    }
  };
  process.once('exit', release);
  return { release };
}

/**
 * Takes the box's bake lock. `refuse` throws a `FaceBakeRefusal` naming the holder's pid at once; `wait` parks until the
 * holder's line closes and binds again. Consumed by `face-bake.ts`, which releases it in `finally`.
 */
export async function takeBakeLock(root: string, whenBusy: 'wait' | 'refuse', signal: AbortSignal): Promise<BakeLock> {
  fs.mkdirSync(root, { recursive: true });
  const name = socketNameOf(root);
  let vanished = 0;
  for (;;) {
    signal.throwIfAborted();
    const bound = await tryBind(name);
    if (bound) return hold(bound, path.join(root, LOCK_NAME));

    const holder = await askHolder(name);
    if (holder === null) {
      // Refused to bind, then refused to connect: the holder left between the two. Twice is a chance; many is a fault.
      vanished += 1;
      if (vanished >= 5) throw new Error(`the bake lock of ${root} is neither free nor answering`);
      continue;
    }
    vanished = 0;
    if (whenBusy === 'refuse') {
      holder.hangUp();
      throw new FaceBakeRefusal(sentences.busy(holder.pid));
    }
    await parkUntilClosed(holder, signal);
  }
}
