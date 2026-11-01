import { spawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, open, unlink, type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

/**
 * Runs Rhubarb Lip Sync on one piece of her audio and answers its JSON. The process work of her mouth; the cutting and the
 * reading of the answer are `mouth-pieces.ts` and `mouth-cues.ts`.
 *
 * THE ARGUMENTS, measured on this box (2026-10-31): `-r phonetic` (the default PocketSphinx with the sentence as a dialog hint
 * ran 1.3 to 1.8 times SLOWER than her speech; the phonetic recognizer takes about 0.9 s plus 0.13 s per second of speech and
 * ignores a dialog file), no dialog, `--extendedShapes X` (Rhubarb picks its own stand-ins for G and H: f and v become A, l
 * becomes C), `--threads 1` (one piece is one utterance: more threads changed nothing). The piece is read from a WAV file,
 * `os.tmpdir()/kaylee-mouth-<pid>-<n>.wav` (a 44-byte header and the PCM), created exclusively with owner-only rights and
 * unlinked in `finally` by the name it was written under; no folder is made and nothing else is ever deleted.
 *
 * THE POOL is server-wide: at most four runs at once (one is about a core-second, 62 MB), the rest wait first come first
 * served, and `signal` cancels a run that waits or runs, through its own `spawn` handle (never a pid read from anywhere).
 * Each run is bounded at 10 s; a child still there 2 s after that is killed through its handle.
 *
 * A binary that is not there answers `missing` without spawning, checked at every call so an install that lands while the
 * server runs is found at once. Rhubarb only ever reads her own synthesized audio.
 *
 * Consumer: `mouth-follow.ts` (and `.verify/kaylee-mouth-replay.ts`, which runs it on whole sentences for its reference).
 */

const DEFAULT_RHUBARB_DIR = '/opt/rhubarb';

/** How many runs may be live at once, server-wide. */
const MAX_RUNS = 4;

/** How long one run may take, in ms, and how long past that its process is given to go before it is killed. */
const RUN_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 2_000;

/** How much of Rhubarb's stderr is kept for a failure's sentence. */
const STDERR_KEPT_BYTES = 400;

const RHUBARB_ARGUMENTS = ['-q', '-r', 'phonetic', '--extendedShapes', 'X', '--threads', '1', '-f', 'json'];

const WAV_HEADER_BYTES = 44;
const SAMPLE_RATE = 24_000;

/** COMPANION_RHUBARB_DIR, else /opt/rhubarb: the binary is `<dir>/rhubarb`, beside the models it reads from `<dir>/res`. Read on each call, so a probe may point it elsewhere. Consumed by `mouth-follow.ts` (the "not installed" line) and the showing. */
export function rhubarbBinary(): string {
  return path.join(path.resolve(process.env.COMPANION_RHUBARB_DIR || DEFAULT_RHUBARB_DIR), 'rhubarb');
}

/** What `runRhubarb` answers: Rhubarb's parsed JSON and the ms the run took, or why there is none and a sentence for the log. Consumed by `mouth-follow.ts`. */
export type RhubarbAnswer = { ok: true; answer: unknown; ms: number } | { ok: false; reason: 'missing' | 'failed' | 'timeout' | 'stopped'; sentence: string };

const failure = (reason: 'missing' | 'failed' | 'timeout' | 'stopped', sentence: string): RhubarbAnswer => ({ ok: false, reason, sentence });
const stopped = (): RhubarbAnswer => failure('stopped', 'The run was stopped before it ended.');
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The pool: runs live now, and the waiters for a slot in the order they came.
let liveRuns = 0;
const slotWaiters: Array<() => void> = [];

// Numbers the piece files of this process; with the pid it makes each name its own.
let nextFileNumber = 0;

/** Takes a slot of the pool; true once held, false when `signal` aborted first (the waiter is gone from the queue then). */
function takeSlot(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (liveRuns < MAX_RUNS) {
    liveRuns += 1;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const grant = (): void => {
      signal.removeEventListener('abort', giveUp);
      liveRuns += 1;
      resolve(true);
    };
    const giveUp = (): void => {
      const position = slotWaiters.indexOf(grant);
      if (position >= 0) slotWaiters.splice(position, 1);
      resolve(false);
    };
    slotWaiters.push(grant);
    signal.addEventListener('abort', giveUp, { once: true });
  });
}

/** Gives a slot back and hands it to the one that has waited longest. */
function giveSlot(): void {
  liveRuns -= 1;
  slotWaiters.shift()?.();
}

/** The WAV a piece is read from: a 44-byte header (mono, 24 kHz, signed 16-bit) and the PCM. */
function wavOf(pcm: Buffer): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Runs the binary on `file` and answers its stdout parsed. Ends only when the child has gone, whatever ended it. */
function runChild(binary: string, file: string, signal: AbortSignal): Promise<RhubarbAnswer> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let child: ChildProcess;
    try {
      child = spawn(binary, [...RHUBARB_ARGUMENTS, file], { stdio: ['ignore', 'pipe', 'pipe'], signal, timeout: RUN_TIMEOUT_MS });
    } catch (error) {
      resolve(failure('failed', `Rhubarb could not be started: ${reasonOf(error)}`));
      return;
    }

    const stdout: Buffer[] = [];
    let stderrTail = '';
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    // The backstop: `spawn`'s timeout and abort both send SIGTERM; a child that ignores it is killed, through this handle.
    const armKill = (afterMs: number): void => {
      clearTimeout(killTimer);
      killTimer = setTimeout(() => child.kill('SIGKILL'), afterMs);
    };
    const finish = (answer: RhubarbAnswer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      signal.removeEventListener('abort', onAbort);
      resolve(answer);
    };
    const onAbort = (): void => armKill(KILL_GRACE_MS);
    armKill(RUN_TIMEOUT_MS + KILL_GRACE_MS);
    signal.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_KEPT_BYTES);
    });
    child.on('error', (error) => {
      // An abort ends in an AbortError once the kill is sent; the exit still comes, and is what `close` waits for.
      if (!signal.aborted) finish(failure('failed', `Rhubarb could not be started: ${error.message}`));
    });
    child.on('close', (code, killedBy) => {
      if (signal.aborted) return finish(stopped());
      const ms = Math.round(performance.now() - startedAt);
      if (killedBy !== null) {
        // Only the bound's own kill reaches a child the request did not abort.
        return finish(ms >= RUN_TIMEOUT_MS ? failure('timeout', `Rhubarb took longer than ${RUN_TIMEOUT_MS / 1000} s and was stopped.`) : failure('failed', `Rhubarb was killed by ${killedBy}.`));
      }
      if (code !== 0) return finish(failure('failed', `Rhubarb exited with ${code}: ${stderrTail.trim() || 'it said nothing'}`));
      try {
        finish({ ok: true, answer: JSON.parse(Buffer.concat(stdout).toString('utf8')), ms });
      } catch (error) {
        finish(failure('failed', `Rhubarb's answer was not JSON: ${reasonOf(error)}`));
      }
    });
  });
}

/** Writes the piece's WAV, runs Rhubarb on it and removes the file, by the name it was written under. */
async function analysePiece(binary: string, pcm: Buffer, signal: AbortSignal): Promise<RhubarbAnswer> {
  const file = path.join(os.tmpdir(), `kaylee-mouth-${process.pid}-${nextFileNumber++}.wav`);
  // `wx`: a name that is already there (a stale file, a planted link) is never written through and never removed.
  let handle: FileHandle;
  try {
    handle = await open(file, 'wx', 0o600);
  } catch (error) {
    return failure('failed', `The piece could not be written for Rhubarb: ${reasonOf(error)}`);
  }
  try {
    await handle.writeFile(wavOf(pcm));
    await handle.close();
    return signal.aborted ? stopped() : await runChild(binary, file, signal);
  } catch (error) {
    return failure('failed', `The piece could not be analysed: ${reasonOf(error)}`);
  } finally {
    // Closing twice is harmless; this one only matters when the write failed before the close above.
    await handle.close().catch(() => undefined);
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') console.error(`[companion] mouth: the piece file ${file} could not be removed: ${error.message}`);
    });
  }
}

/** Runs Rhubarb on one piece's audio. At most four run at once, server-wide; the rest wait, first come first served. `signal` cancels a run that is waiting or running. Consumed by `mouth-follow.ts`. */
export async function runRhubarb(pcm: Buffer, signal: AbortSignal): Promise<RhubarbAnswer> {
  // The place in the queue is taken first, in the order of the calls: the check below awaits the thread pool, which finishes
  // calls made in one tick in any order, so checking first would shuffle the queue. A missing binary holds a slot for that check alone.
  if (!(await takeSlot(signal))) return stopped();
  try {
    const binary = rhubarbBinary();
    try {
      await access(binary, fsConstants.X_OK);
    } catch {
      return failure('missing', `Rhubarb is not installed at ${binary}.`);
    }
    return signal.aborted ? stopped() : await analysePiece(binary, pcm, signal);
  } finally {
    giveSlot();
  }
}
