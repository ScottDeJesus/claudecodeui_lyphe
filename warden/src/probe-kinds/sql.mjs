// `sql {dsn, query}` — run one query through `psql` and judge the answer. The password never
// passes through here: psql is run with `-w` (never prompt) and libpq reads `~/.pgpass`, as
// `docstore/bin/backup` does, so the dsn names a host, port, database and role and nothing secret —
// and a dsn that holds a password is refused outright (below). Metrics: `exit`, `value` (the first
// column of the first row, a number when it parses as one) and `took_ms`; default pass
// `exit == 0`. The sentence is "Answered in 6 ms" or psql's own first line of complaint.

import { clip, deadlineMs, elapsedMs, finishProbe, formatSeconds, missingField, runProcess, unrunnable } from '../probe-support.mjs';

const MAX_TEXT_CHARS = 200;

// libpq takes a password from `user:password@` right after `//`, or from a `password=` key, and
// when it cannot parse what follows it quotes the text back in its error line — bare, in no shape a
// pattern could find (`invalid percent-encoded token: "<the password>"`). So a dsn that holds one is
// refused before psql runs rather than scrubbed after: nothing is echoed, and the password is not
// on psql's command line for `ps` to show. Over-refusing is the safe side: a dsn without a password
// has at most one `@`, and nothing before it but the role (`postgresql://docstore@127.0.0.1:5433/db`).
function dsnHoldsPassword(dsn) {
  if (/(^|[\s?&])password\s*=/i.test(dsn)) return true;
  const afterSlashes = /^[a-z][a-z0-9+.-]*:\/\/(.*)$/is.exec(dsn)?.[1];
  if (afterSlashes === undefined) return false;
  const lastAt = afterSlashes.lastIndexOf('@');
  return lastAt >= 0 && /[:/]/.test(afterSlashes.slice(0, lastAt));
}

// psql -A -t prints rows as `col|col`; a text column holding `|` would be cut short, which only
// matters to a query returning text — the checks this exists for return a count or a one.
function firstColumnOfFirstRow(stdout) {
  const row = stdout.split('\n').find((line) => line.trim() !== '');
  if (row === undefined) return null;
  const column = row.split('|')[0].trim();
  const number = Number(column);
  return column !== '' && Number.isFinite(number) ? number : clip(column, MAX_TEXT_CHARS);
}

function firstStderrLine(stderr) {
  const line = stderr.split('\n').find((candidate) => candidate.trim() !== '');
  return line ? clip(line.trim(), MAX_TEXT_CHARS) : null;
}

export async function run(spec, _memory) {
  const missing = missingField(spec, ['dsn', 'query']);
  if (missing) return unrunnable(spec, missing);
  if (dsnHoldsPassword(spec.dsn)) {
    return unrunnable(spec, "The definition's dsn must not hold a password; it comes from ~/.pgpass");
  }

  const startedAt = performance.now();
  const args = ['-X', '-A', '-t', '-w', '-d', spec.dsn, '-c', spec.query];
  const result = await runProcess('psql', args, { timeoutMs: deadlineMs(spec), keepStderr: true });
  const tookMs = elapsedMs(startedAt);

  if (result.ended === 'timeout') {
    return finishProbe(spec, {
      completed: false,
      sentence: `Did not finish within ${formatSeconds(spec.timeout)}`,
      data: { error: 'timeout', took_ms: tookMs },
    }, tookMs);
  }
  if (result.ended === 'error') {
    const sentence = result.code === 'ENOENT' ? 'psql is not installed on this node' : `Could not start psql (${result.code})`;
    return finishProbe(spec, { completed: false, sentence, data: { error: result.code, took_ms: tookMs } }, tookMs);
  }

  const metrics = { exit: result.code, value: firstColumnOfFirstRow(result.stdout), took_ms: tookMs };
  const sentence = result.code === 0
    ? `Answered in ${tookMs} ms`
    : (firstStderrLine(result.stderr) ?? `Exited ${result.code ?? result.signal}`);
  return finishProbe(spec, { completed: true, sentence, metrics }, tookMs);
}
