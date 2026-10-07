// One argv spawn of one named binary, for a diagnosis's read: never a shell, killed at 10 s, its output capped at 64 KB.
//
// The binary and its arguments come from the fixed menu in `diag-reads.mjs`; the only caller-supplied words in them
// (a unit name) were matched against a pattern first. `spawn(binary, args)` with no `shell` option hands the arguments
// to the program as they are, so a `;` or a backtick in one is a character, not a command.
import { spawn } from 'node:child_process';

import { log } from './log.mjs';

export const CALL_TIMEOUT_MS = 10_000;
export const OUTPUT_CAP_BYTES = 64 * 1024;
/** What a failing program's stderr may add to its answer: the reason, never a flood. */
const STDERR_CAP_BYTES = 4 * 1024;

/** `buffers` as text of at most `cap` bytes, and whether it had to be cut; a character the cut splits is dropped, not mangled. */
export function capText(buffers, cap = OUTPUT_CAP_BYTES) {
  const whole = Buffer.concat(buffers);
  if (whole.length <= cap) return { text: whole.toString('utf8'), truncated: false };
  return { text: whole.subarray(0, cap).toString('utf8').replace(/�$/, ''), truncated: true };
}

/**
 * Starts `binary` with `args`. Answers `{ done, kill }`: `done` resolves, never rejects, with `{ ok, text, truncated }`
 * and `kill()` ends the child at once (a diagnosis that closes while its read is still going).
 *
 *   exit 0           ok, the stdout (or "(no output)")
 *   exit non-zero    ok only when it still printed something (`systemctl status` of an inactive unit exits 3 with its answer);
 *                    the text is the stdout, the stderr and `[exit N]`
 *   output past cap  the child is killed, the cap's worth is the answer, `truncated: true`
 *   past 10 s        killed, and answered at the kill; not ok, what it had printed and "[killed after 10 s]"
 *   cannot start     not ok, "<binary> is not available on this node (ENOENT)"
 */
export function startArgv(binary, args) {
  let child = null;
  let killedFor = null; // 'timeout' | 'cap' | 'stopped' — why the child was killed, when it was
  let endChild = () => {}; // set below, once there is a child to end: the one place a kill is made and answered
  const done = new Promise((resolve) => {
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;
    let timer = null;
    const settle = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(answer);
    };
    /** The answer for how the child ended: `code` is its exit status, or null when it was killed or a signal ended it. */
    const outcome = (code) => {
      const { text: printed, truncated } = capText(out);
      const complained = capText(err, STDERR_CAP_BYTES).text.trim();
      if (killedFor === 'timeout') return { ok: false, text: `${printed}\n[killed after ${CALL_TIMEOUT_MS / 1000} s]`.trim(), truncated };
      if (killedFor === 'stopped') return { ok: false, text: 'The diagnosis ended before this read finished', truncated: false };
      if (killedFor === 'cap' || code === 0) return { ok: true, text: printed === '' ? '(no output)' : printed, truncated };
      const text = [printed, complained, code === null ? '[ended by a signal]' : `[exit ${code}]`].filter(Boolean).join('\n');
      return { ok: printed !== '', text, truncated };
    };

    try {
      child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      // spawn throws, rather than emitting 'error', for an argument it refuses (a NUL byte).
      settle({ ok: false, text: `${binary} could not be started (${error.code ?? error.name})`, truncated: false });
      return;
    }
    // A kill answers at once and lets go of the pipes: `close` waits for them, and a child the program forked would hold
    // them open (as would one stuck in the kernel), so an answer that waited would not be bounded by the kill.
    endChild = (reason) => {
      killedFor = reason;
      child.kill('SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      settle(outcome(null));
    };
    timer = setTimeout(() => endChild('timeout'), CALL_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      if (killedFor !== null) return;
      out.push(chunk);
      outBytes += chunk.length;
      if (outBytes > OUTPUT_CAP_BYTES) endChild('cap');
    });
    child.stderr.on('data', (chunk) => {
      if (errBytes >= STDERR_CAP_BYTES) return;
      err.push(chunk);
      errBytes += chunk.length;
    });
    child.stdout.on('error', () => {}); // a pipe that fails is the child's end below, through 'close'
    child.stderr.on('error', () => {});
    child.on('error', (error) => {
      settle({ ok: false, text: `${binary} is not available on this node (${error.code ?? error.name})`, truncated: false });
    });
    child.on('close', (code) => settle(outcome(code)));
  });
  return {
    done,
    kill() {
      if (child === null || child.exitCode !== null || child.signalCode !== null || killedFor !== null) return;
      try {
        endChild('stopped');
      } catch (error) {
        log(`could not stop a diagnosis read (${binary}): ${error.code ?? error.message}`);
      }
    },
  };
}
