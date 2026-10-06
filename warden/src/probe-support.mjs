// What more than one probe kind needs, kept out of the kinds so each reads as only its own
// measurement: shaping a run into the `{ status, value, data, tookMs }` the scheduler sends, the
// words for a failed connection, a process run under a deadline, and the one conversion of a
// probe's `timeout` into a timer delay.

import { spawn } from 'node:child_process';

import { judge } from './expr.mjs';

const NETWORK_SENTENCES = {
  ECONNREFUSED: 'Connection refused',
  ENOTFOUND: 'Host not found',
  EAI_AGAIN: 'Host not found',
  ECONNRESET: 'Connection reset',
  EHOSTUNREACH: 'Host unreachable',
  ENETUNREACH: 'Network unreachable',
};

// A command's output is kept only as its tail — the last non-empty line is all a probe reads, and
// a command that prints without end must not grow the warden's memory.
const OUTPUT_TAIL_CHARS = 64 * 1024;

// setTimeout stores its delay in 32 bits: past this, Node warns and fires after 1 ms, so a
// definition with a very long `timeout` (center allows 30 days) would fail at once. The
// scheduler's `every` can be as long and is waited out in steps of this size (`probes.mjs`).
export const MAX_TIMER_MS = 2_147_483_647;

export const TIMED_OUT = Symbol('timed out');

export function elapsedMs(startedAt) {
  return Math.round(performance.now() - startedAt);
}

/** The probe's `timeout` in milliseconds, the one conversion every kind's deadline goes through. */
export function deadlineMs(spec) {
  return Math.min(spec.timeout * 1000, MAX_TIMER_MS);
}

/** Cuts `text` to at most `maxChars` UTF-16 units without leaving half of a surrogate pair at the end. */
export function clip(text, maxChars) {
  if (text.length <= maxChars) return text;
  const lastKept = text.charCodeAt(maxChars - 1);
  const splitsPair = lastKept >= 0xd800 && lastKept <= 0xdbff;
  return text.slice(0, splitsPair ? maxChars - 1 : maxChars);
}

export function formatSeconds(seconds) {
  return `${seconds} s`;
}

/** Shapes a finished run for the scheduler: the status comes from `judge`, `data` is what was measured. */
export function finishProbe(spec, outcome, tookMs) {
  const { status, value } = judge(spec, { ...outcome, metrics: outcome.metrics ?? {} });
  return { status, value, data: outcome.data ?? outcome.metrics ?? {}, tookMs };
}

/** A definition the kind cannot act on (a field missing): failing, with the missing field named. */
export function unrunnable(spec, sentence) {
  return finishProbe(spec, { completed: false, sentence, data: { error: 'definition' } }, 0);
}

/** Names the first of `fields` the spec leaves out, as a sentence, or null when all are present. */
export function missingField(spec, fields) {
  const absent = fields.find((field) => spec[field] === undefined || spec[field] === null || spec[field] === '');
  return absent ? `The definition has no ${absent}` : null;
}

/** The code (`ECONNREFUSED`) and the words for a connection that failed outright, never a message that could carry a URL. */
export function describeNetworkError(error) {
  const code = error?.code ?? error?.cause?.code ?? error?.name ?? 'unknown';
  return { code, sentence: NETWORK_SENTENCES[code] ?? `Connection failed (${code})` };
}

/** Resolves with `work`'s result, or `TIMED_OUT` when `timeoutMs` passes first. A filesystem call cannot be aborted, only abandoned. */
export async function withDeadline(work, timeoutMs) {
  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function collectTail(stream) {
  let text = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    text += chunk;
    if (text.length > OUTPUT_TAIL_CHARS * 2) text = text.slice(-OUTPUT_TAIL_CHARS);
  });
  return () => text;
}

// The child leads its own process group, so one signal reaches a pipeline's every stage — `df | awk`
// would otherwise outlive its shell and keep the output pipe open. The pid is checked before it is
// negated: a group signal sent to a bad number reaches processes this warden never started.
function killProcessGroup(child) {
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') console.log(`[warden] could not stop probe process ${pid}: ${error.code ?? error.message}`);
  }
}

// Every child a probe has started and not yet seen end, so a stopping warden can take them with it.
const liveChildren = new Set();

/** Kills the process group of every probe command still going; the scheduler calls it as it stops, so no probe's `sleep` outlives its warden. */
export function killLiveProcesses() {
  for (const child of liveChildren) killProcessGroup(child);
  liveChildren.clear();
}

/**
 * Runs `file` with `args` and never longer than `timeoutMs`. Resolves, never rejects, with one of
 * `{ ended: 'done', code, signal, stdout, stderr }`, `{ ended: 'timeout' }` or
 * `{ ended: 'error', code }` (the spawn itself failed — `ENOENT` when the program is not there).
 * `stderr` is collected only when `keepStderr` is set.
 */
export function runProcess(file, args, { cwd, timeoutMs, keepStderr = false }) {
  return new Promise((resolve) => {
    let timer;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveChildren.delete(child);
      resolve(result);
    };

    // spawn throws, rather than emitting 'error', for an argument it refuses (a NUL byte in a
    // command or dsn); that must still resolve, since this function's promise never rejects.
    let child;
    try {
      child = spawn(file, args, { cwd, detached: true, stdio: ['ignore', 'pipe', keepStderr ? 'pipe' : 'ignore'] });
    } catch (error) {
      settle({ ended: 'error', code: error.code ?? error.name });
      return;
    }
    liveChildren.add(child);
    const readStdout = collectTail(child.stdout);
    const readStderr = keepStderr ? collectTail(child.stderr) : () => '';

    timer = setTimeout(() => {
      killProcessGroup(child);
      settle({ ended: 'timeout' });
    }, timeoutMs);
    child.on('error', (error) => settle({ ended: 'error', code: error.code ?? error.name }));
    child.on('close', (code, signal) => {
      settle({ ended: 'done', code, signal, stdout: readStdout(), stderr: readStderr() });
    });
  });
}
