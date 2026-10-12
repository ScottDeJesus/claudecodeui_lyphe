// The one comparison a check is judged by, and the status rule built on it. A check's `pass` and
// `warn` are each a single `<metric> <op> <number>[unit]` — `age < 26h`, `value >= 80` — so the
// whole grammar fits one regular expression and nothing here is a parser to maintain. Anything a
// comparison cannot say belongs in the command being run, not in this file.

// What a unit converts to, per metric: seconds for `age`, milliseconds for `took_ms`. The other
// metrics (`status`, `exit`, `value`) have no time base, so a unit after them is a typo, not a
// conversion — parseExpr refuses it rather than guessing what `value < 5m` meant.
const UNIT_FACTORS = {
  took_ms: { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 },
  age: { ms: 0.001, s: 1, m: 60, h: 3600, d: 86_400 },
};

// One `\s*` between any two tokens, never two in a row: with the unit optional, `\s*(unit)?\s*`
// can split a run of spaces two ways and backtracks quadratically on a long run that then fails.
const COMPARISON = /^\s*(status|took_ms|exit|value|age)\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)(?:\s*(ms|s|m|h|d))?\s*$/;

const COMPARATORS = {
  '<': (measured, limit) => measured < limit,
  '<=': (measured, limit) => measured <= limit,
  '>': (measured, limit) => measured > limit,
  '>=': (measured, limit) => measured >= limit,
  '==': (measured, limit) => measured === limit,
  '!=': (measured, limit) => measured !== limit,
};

// The metrics each kind measures. An expression naming another is unreadable for that kind: `age`
// on an `http` check can never be true or false, and saying so beats a check that is always red.
const KIND_METRICS = {
  http: ['status', 'took_ms'],
  tcp: ['took_ms'],
  exec: ['exit', 'value', 'took_ms'],
  file_age: ['age'],
  sql: ['exit', 'value', 'took_ms'],
};

// What "healthy" means when the definition names no `pass`. `file_age` has none on purpose —
// center refuses a definition without one, and a file's age means nothing until someone says how
// old is too old. A tcp probe that connected has a took_ms, so `took_ms >= 0` reads "connected".
const DEFAULT_PASS = {
  http: 'status == 200',
  tcp: 'took_ms >= 0',
  exec: 'exit == 0',
  sql: 'exit == 0',
};

const DENIED_STATUSES = new Set([401, 403]);

/**
 * Reads one comparison. Returns `{ metric, op, value }` with `value` already in the metric's base
 * unit, or null when the text is not exactly one comparison.
 */
export function parseExpr(text) {
  const match = typeof text === 'string' ? COMPARISON.exec(text) : null;
  if (!match) return null;
  const [, metric, op, digits, unit] = match;
  let value = Number(digits);
  if (unit) {
    const factors = UNIT_FACTORS[metric];
    if (!factors) return null;
    // toPrecision strips the float dust a conversion leaves (1.1 s × 1000 = 1100.0000000000002).
    value = Number((value * factors[unit]).toPrecision(12));
  }
  return { metric, op, value };
}

/**
 * Applies a parsed comparison to what a run measured. A metric the run did not produce — `value`
 * when the command printed no number, `status` when nothing answered — fails every comparison,
 * `!=` included: "no reading" never counts as a reading that differs.
 */
export function evaluate(expr, metrics) {
  const measured = metrics[expr.metric];
  if (typeof measured !== 'number' || !Number.isFinite(measured)) return false;
  return COMPARATORS[expr.op](measured, expr.value);
}

function readForKind(kind, text) {
  const expr = parseExpr(text);
  return expr && KIND_METRICS[kind]?.includes(expr.metric) ? expr : null;
}

function isBlank(text) {
  return typeof text !== 'string' || text.trim() === '';
}

function unreadable(role, text) {
  return { status: 'failing', value: `The ${role} expression '${text ?? ''}' can't be read` };
}

/**
 * Turns one run into the check's status and its sentence. `outcome` is what the kind saw:
 * `{ completed, sentence, metrics }` — `completed` is false for a run that could not finish
 * (timeout, refused, unreadable), `sentence` is the kind's own words for it, `metrics` is what the
 * expressions may read. The rule, in order: a run that could not complete is `failing`; HTTP 401
 * or 403 from `http` is `denied`; a false `pass` is `failing`; a true `pass` with a true `warn`
 * is `warn`; a true `pass` is `ok`. Returns `{ status, value }`.
 */
export function judge(spec, outcome) {
  const { sentence, metrics } = outcome;
  if (!outcome.completed) return { status: 'failing', value: sentence };
  if (spec.kind === 'http' && DENIED_STATUSES.has(metrics.status)) {
    return { status: 'denied', value: sentence };
  }

  const passText = isBlank(spec.pass) ? (DEFAULT_PASS[spec.kind] ?? '') : spec.pass;
  const pass = readForKind(spec.kind, passText);
  if (!pass) return unreadable('pass', passText);
  if (!evaluate(pass, metrics)) return { status: 'failing', value: sentence };

  if (isBlank(spec.warn)) return { status: 'ok', value: sentence };
  const warn = readForKind(spec.kind, spec.warn);
  if (!warn) return unreadable('warn', spec.warn);
  return { status: evaluate(warn, metrics) ? 'warn' : 'ok', value: sentence };
}
