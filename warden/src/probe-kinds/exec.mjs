// `exec {cmd}` — run a shell command and judge what it did. `/bin/sh -c cmd` from `$HOME`, killed
// (with everything it started) at `timeout`. Metrics: `exit`, `value` (the leading number of the
// last non-empty stdout line, absent when that line does not start with one) and `took_ms`; default
// pass `exit == 0`. The sentence is that last line — the command's own report of itself — or
// "Exited <code>" when it printed nothing, so a disk check reads "42% full" and judges on 42.
//
// With `ages` ('s', 'm', 'h' or 'd'; center accepts it only beside `watch`, the file the command
// reads) the leading number counts the time since something, in that unit: "5.0 h since the newest
// copy". The run then keeps `{ value, line, measuredAtMs, exit, tookMs }` in `memory.kept`, and the
// scheduler ages it to any instant without running the command (`aged`, `watched-probe.mjs`).

import { homedir } from 'node:os';

import { clip, deadlineMs, elapsedMs, finishProbe, formatSeconds, missingField, runProcess, unrunnable } from '../probe-support.mjs';

const MAX_SENTENCE_CHARS = 200;
const AGE_UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
// The leading number as the line prints it, the part `aged` rewrites. `parseFloat` reads more forms
// (`.5`, `1e3`); a line led by one of those is not kept, so it is never aged.
const PRINTED_NUMBER = /^-?\d+(?:\.\d+)?/;

function lastNonEmptyLine(stdout) {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

export async function run(spec, memory) {
  const missing = missingField(spec, ['cmd']);
  if (missing) {
    forget(memory);
    return unrunnable(spec, missing);
  }

  const startedAt = performance.now();
  const result = await runProcess('/bin/sh', ['-c', spec.cmd], { cwd: homedir(), timeoutMs: deadlineMs(spec) });
  const tookMs = elapsedMs(startedAt);
  if (result.ended !== 'done') forget(memory);

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
  keep(spec, memory, line, metrics);
  return finishProbe(spec, { completed: true, sentence, metrics }, tookMs);
}

/** The kept reading at `nowMs`: its value plus the time since it was measured, in `spec.ages` (unrounded), the line's leading number rewritten to match at its printed decimals. Consumer: `watched-probe.mjs`. */
export function aged(spec, kept, nowMs) {
  const { zeroAtMs, msPerUnit } = agingOf(spec, kept);
  const printed = PRINTED_NUMBER.exec(kept.line)[0];
  const decimals = printed.split('.')[1]?.length ?? 0;
  // The metric ages unrounded, so it crosses a bound at the instant flipAt names; only the line is printed as the command printed it.
  const value = (nowMs - zeroAtMs) / msPerUnit;
  const sentence = clip(`${value.toFixed(decimals)}${kept.line.slice(printed.length)}`, MAX_SENTENCE_CHARS);
  return finishProbe(spec, { completed: true, sentence, metrics: { exit: kept.exit, value, took_ms: kept.tookMs } }, 0);
}

/** The line the `value` metric grows on: one per `spec.ages` unit since it was measured. Consumer: `watched-probe.mjs`'s `flipAt`. */
export function agingOf(spec, kept) {
  const msPerUnit = AGE_UNIT_MS[spec.ages];
  return { metric: 'value', zeroAtMs: kept.measuredAtMs - kept.value * msPerUnit, msPerUnit };
}

function keep(spec, memory, line, metrics) {
  if (!memory) return;
  const ages = typeof spec.ages === 'string' && Object.hasOwn(AGE_UNIT_MS, spec.ages);
  if (!ages || !line || !PRINTED_NUMBER.test(line) || !Number.isFinite(metrics.value)) {
    forget(memory);
    return;
  }
  memory.kept = { value: metrics.value, line, measuredAtMs: Date.now(), exit: metrics.exit, tookMs: metrics.took_ms };
}

function forget(memory) {
  if (memory) delete memory.kept;
}
