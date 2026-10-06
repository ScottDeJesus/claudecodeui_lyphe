// `exec {cmd}` — run a shell command and judge what it did. `/bin/sh -c cmd` from `$HOME`, killed
// (with everything it started) at `timeout`. Metrics: `exit`, `value` (the leading number of the
// last non-empty stdout line, absent when that line does not start with one) and `took_ms`; default
// pass `exit == 0`. The sentence is that last line — the command's own report of itself — or
// "Exited <code>" when it printed nothing, so a disk check reads "42% full" and judges on 42.

import { homedir } from 'node:os';

import { clip, deadlineMs, elapsedMs, finishProbe, formatSeconds, missingField, runProcess, unrunnable } from '../probe-support.mjs';

const MAX_SENTENCE_CHARS = 200;

function lastNonEmptyLine(stdout) {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

export async function run(spec, _memory) {
  const missing = missingField(spec, ['cmd']);
  if (missing) return unrunnable(spec, missing);

  const startedAt = performance.now();
  const result = await runProcess('/bin/sh', ['-c', spec.cmd], { cwd: homedir(), timeoutMs: deadlineMs(spec) });
  const tookMs = elapsedMs(startedAt);

  if (result.ended === 'timeout') {
    return finishProbe(spec, {
      completed: false,
      sentence: `Did not finish within ${formatSeconds(spec.timeout)}`,
      data: { error: 'timeout', took_ms: tookMs },
    }, tookMs);
  }
  if (result.ended === 'error') {
    return finishProbe(spec, {
      completed: false,
      sentence: `Could not start the command (${result.code})`,
      data: { error: result.code, took_ms: tookMs },
    }, tookMs);
  }

  const line = lastNonEmptyLine(result.stdout);
  const leading = Number.parseFloat(line ?? '');
  const metrics = {
    exit: result.code,
    value: Number.isFinite(leading) ? leading : null,
    took_ms: tookMs,
  };
  const sentence = line ? clip(line, MAX_SENTENCE_CHARS) : `Exited ${result.code ?? result.signal}`;
  return finishProbe(spec, { completed: true, sentence, metrics }, tookMs);
}
