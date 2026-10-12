// One argv spawn of one named binary, for a diagnosis's read: never a shell, killed at 10 s, its output capped at 64 KB.
//
// The binary and its arguments come from the fixed menu in `diag-reads.mjs`; the only caller-supplied words in them
// (a unit name) were matched against a pattern first. `spawn(binary, args)` with no `shell` option hands the arguments
// to the program as they are, so a `;` or a backtick in one is a character, not a command.
//
// WHOLE LINES ONLY. Text that stops where this reader stopped — the 64 KB cap, the 4 KiB stderr cap, a kill at 10 s —
// ends on a line the program finished: its partial last line is dropped before the text leaves `outcome`. The mask
// (`diag-tools.mjs` `answer()`) then never meets half a secret, such as a `scheme://user:pw` whose `@host` was cut off.
// Text that stops where the program stopped keeps its last line, newline or not.
import { spawn } from 'node:child_process';

import { log } from './log.mjs';

export const CALL_TIMEOUT_MS = 10_000;
export const OUTPUT_CAP_BYTES = 64 * 1024;
/** What a failing program's stderr may add to its answer: the reason, never a flood. */
const STDERR_CAP_BYTES = 4 * 1024;

/**
 * `buffers` as text of at most `cap` bytes, and whether it had to be cut; a character the cut splits is dropped, not mangled.
 * This is the final word on size for text that is already masked (`answer()`): it may cut a line. A read's own output goes
 * through `capWholeLines` instead.
 */
export function capText(buffers, cap = OUTPUT_CAP_BYTES) {
  const whole = Buffer.concat(buffers);
  if (whole.length <= cap) return { text: whole.toString('utf8'), truncated: false };
  return { text: whole.subarray(0, cap).toString('utf8').replace(/�$/, ''), truncated: true };
}

/**
 * `buffers` as text of at most `cap` bytes made of whole lines, and whether the stream went on past it.
 * `more` says the stream went on past `buffers` (the child was killed, or bytes beyond the kept ones were never kept).
 * A stream that ended where the program ended is answered as it came, last line included. One that did not ends on its
 * last line the reader saw finished — through the line break, which is left out — so `''` when no line was finished.
 */
export function capWholeLines(buffers, cap, more) {
  const whole = Buffer.concat(buffers);
  if (whole.length <= cap && !more) return { text: whole.toString('utf8'), truncated: false };
  // One byte past the cap: a line break there is the end of a line that fits exactly.
  const seen = whole.subarray(0, Math.min(whole.length, cap + 1));
  const lastBreak = seen.lastIndexOf(10);
  return { text: lastBreak < 0 ? '' : seen.subarray(0, lastBreak).toString('utf8'), truncated: true };
}

/**
 * Starts `binary` with `args`. Answers `{ done, kill }`: `done` resolves, never rejects, with `{ ok, text, truncated }`
 * and `kill()` ends the child at once (a diagnosis that closes while its read is still going).
 *
 *   exit 0           ok, the stdout (or "(no output)")
 *   exit non-zero    ok only when it still printed something (`systemctl status` of an inactive unit exits 3 with its answer);
 *                    the text is the stdout, the stderr and `[exit N]`
 *   output past cap  the child is killed, the cap's worth of whole lines is the answer, `truncated: true`
 *                    (a first line past the cap is answered "(its first line runs past 65536 bytes)")
 *   past 10 s        killed, and answered at the kill; not ok, the whole lines it had printed and "[killed after 10 s]"
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
    let errBytes = 0; // the stderr bytes kept; `errSeen` also counts the ones past the cap
    let errSeen = 0;
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
      // A kill ends both streams where this reader stopped, not where the program did; so does a stream past its cap.
      const killed = killedFor !== null;
      const stdout = capWholeLines(out, OUTPUT_CAP_BYTES, killed);
      const printed = stdout.text === '' && killedFor === 'cap' ? `(its first line runs past ${OUTPUT_CAP_BYTES} bytes)` : stdout.text;
      const truncated = stdout.truncated;
      const stderr = capWholeLines(err, STDERR_CAP_BYTES, killed || errSeen > errBytes);
      // A reason that is one line past the cap is said so, as a first stdout line past its cap is: "printed nothing" it is not.
      const complained = (stderr.text === '' && stderr.truncated ? `(its first stderr line runs past ${STDERR_CAP_BYTES} bytes)` : stderr.text).trim();
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
      errSeen += chunk.length;
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
