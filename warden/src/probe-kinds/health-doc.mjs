// health_doc — the probe kind that reads a service's own health document and fans it out,
// one result per component ("One fetch, many results": design/cerberus/Cerberus Spec.dc.html §2).
//
// The document: { overall, checked_at, components: { <id>: { status, reason, … } } }.
// The service computes the verdicts; this kind only carries them. Nothing here probes what
// the document already reports (Ruling 3), and nothing here holds a credential: the one
// request is an unauthenticated GET, and only the document's own fields reach a result. A
// read that fails is worded from a closed table (READ_FAILURE_WORDS), never from a library's
// message, which can quote the whole url — userinfo and all — into a sentence the center stores.
//
// run(spec, memory) → { own, components? }
//   own         the probe's own check, <service>/health: { status, value, data, tookMs }
//   components  one result per readable component — present only when the document's
//               checked_at moved since the last read (a document read twice is not published twice)
//   memory      kept by the scheduler between runs of this probe; this kind keeps in it
//               lastCheckedAt (ms, the document's clock) and stillSince (ms, this clock: when
//               the warden first saw that checked_at).

// The check-id grammar the center enforces on every check key's second half.
const CHECK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

// `checked_at` is ISO-8601 with an offset (spec §2). Date.parse alone also reads a bare
// number as a year and an offset-less string in the warden's own zone — a stamp the service
// never meant — so the shape is checked first and Date.parse only reads the milliseconds.
const ISO_TIME_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

// How far past this clock a `checked_at` may sit. The center refuses a result further ahead
// (ingest.service.ts MAX_FUTURE_SKEW_MS), so a document stamped beyond it is named here instead
// of reading green while every one of its components is silently dropped downstream.
const MAX_FUTURE_SKEW_MS = 300_000;

// The document's four words, and nothing else — Cerberus never guesses (spec §2, Table 2).
// muted maps to null: the feature is off on the service's side, which the center derives as
// "not enabled"; it is not a status the warden stores. A Map so a hostile word such as
// "constructor" cannot find itself on a prototype.
const STATUS_OF_DOC_WORD = new Map([
  ['green', 'ok'],
  ['yellow', 'warn'],
  ['red', 'failing'], // a service saying it is failing lands amber, like any failure (spec §1)
  ['muted', null],
]);

// A service republishing on its own cadence is never accused between two publications; only a
// document that has stood still for this many cadences is a dead poller.
const STILL_CADENCES = 3;

// Words copied out of a document into a sentence are clipped, so one hostile id or status
// cannot swell a result.
const QUOTED_WORD_MAX = 80;

const clipWord = (word) => String(word).slice(0, QUOTED_WORD_MAX);

const pad2 = (number) => String(number).padStart(2, '0');

// Local HH:MM, the reading an operator uses against a log line.
function clockTime(epochMs) {
  const moment = new Date(epochMs);
  return `${pad2(moment.getHours())}:${pad2(moment.getMinutes())}`;
}

// "3.2 s" for a read that took seconds; milliseconds below one second, as every other kind
// words its timings ("HTTP 200 in 84 ms"), so a fast read never reads as "0.0 s".
function describeDuration(tookMs) {
  return tookMs < 1000 ? `${tookMs} ms` : `${(tookMs / 1000).toFixed(1)} s`;
}

// A status word as the sentence quotes it: strings as written, anything else as JSON, absent as "none".
function describeWord(word) {
  if (word === undefined) return 'none';
  return clipWord(typeof word === 'string' ? word : JSON.stringify(word));
}

// The reasons a read can fail, keyed by the code fetch's `cause` carries. This is the whole set:
// a code outside it, and every error without one, gets the one fixed phrase below, because the
// library's message is not ours to print (a url with userinfo is quoted whole in it). "no answer"
// carries no seconds where undici's own 10 s connect deadline fired before the probe's timeout.
const READ_FAILURE_WORDS = new Map([
  ['ECONNREFUSED', 'connection refused'],
  ['ECONNRESET', 'connection reset'],
  ['UND_ERR_SOCKET', 'connection closed'],
  ['ENOTFOUND', 'host name not found'],
  ['EAI_AGAIN', 'host name not found'],
  ['EHOSTUNREACH', 'host unreachable'],
  ['ENETUNREACH', 'host unreachable'],
  ['ETIMEDOUT', 'no answer'],
  ['UND_ERR_CONNECT_TIMEOUT', 'no answer'],
  ['UND_ERR_HEADERS_TIMEOUT', 'no answer'],
  ['UND_ERR_BODY_TIMEOUT', 'no answer'],
  ['ERR_INVALID_URL', 'the address cannot be used'],
]);

function describeReadFailure(error, timeoutSeconds) {
  if (error?.name === 'TimeoutError') return `no answer within ${timeoutSeconds} s`;
  const code = error?.cause?.code;
  const word = READ_FAILURE_WORDS.get(code);
  if (word) return word;
  // llhttp's parse errors: a service that answered, but not in HTTP.
  if (typeof code === 'string' && code.startsWith('HPE_')) return 'the answer was not valid HTTP';
  // fetch refuses an unusable address (userinfo in the url, say) before it touches the network,
  // with a TypeError whose text quotes the url. A network failure is always `fetch failed`.
  if (error?.name === 'TypeError' && error.message !== 'fetch failed') return 'the address cannot be used';
  return 'the connection failed';
}

const ownResult = (status, value, data, tookMs) => ({ status, value, data, tookMs });

const failingOwn = (value, data, tookMs) => ownResult('failing', value, data, tookMs);

// One GET, the timeout covering the body as well as the headers. Never throws: a read that
// cannot complete comes back as { failure } so the caller words it once.
async function readDocument(url, timeoutSeconds) {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
    const text = await response.text();
    return { http: response.status, text, tookMs: elapsed() };
  } catch (error) {
    return { failure: describeReadFailure(error, timeoutSeconds), tookMs: elapsed() };
  }
}

// Every component becomes a result or — when its id or status is outside the grammar — a
// single `problem` sentence (the first in document order), never a guess. Runs on every read,
// not only when checked_at moved, so the probe's own check stays steady between publications.
function fanOutComponents(service, ownKey, components, checkedAt, fetchedAt) {
  const results = [];
  let problem = null;
  for (const [id, component] of Object.entries(components)) {
    // A component whose key is the probe's own (`<service>/health`) would be a second writer of
    // that check: the center takes a key that is a probe's own from the probe alone, and cannot
    // tell this result from the probe's. It is not a name Cerberus can give the component.
    if (!CHECK_ID.test(id) || `${service}/${id}` === ownKey) {
      problem ??= `The health document has a component Cerberus can't name: ${clipWord(id)}`;
      continue;
    }
    const docStatus = component?.status;
    if (!STATUS_OF_DOC_WORD.has(docStatus)) {
      problem ??= `The health document has a status Cerberus can't read: ${id} = ${describeWord(docStatus)}`;
      continue;
    }
    // Everything the service sent beyond its verdict and sentence is kept and never shown.
    const { status: _status, reason, ...data } = component;
    results.push({
      check: `${service}/${id}`,
      at: checkedAt, // the service's clock: staleness is judged on it (spec §2, Time)
      fetchedAt,
      docStatus,
      status: STATUS_OF_DOC_WORD.get(docStatus),
      value: typeof reason === 'string' ? reason : null,
      data,
    });
  }
  return { results, problem };
}

export async function run(spec, memory = {}) {
  const read = await readDocument(spec.url, spec.timeout);
  const { http, tookMs } = read;

  if (read.failure) {
    return { own: failingOwn(`The health document could not be read: ${read.failure}`, null, tookMs) };
  }
  // The one red a probe can produce: something said no, and retrying will not change its answer.
  if (http === 401 || http === 403) {
    const value = `The health endpoint refused the warden: HTTP ${http}`;
    return { own: ownResult('denied', value, { http }, tookMs) };
  }
  if (http < 200 || http >= 300) {
    return { own: failingOwn(`The health document could not be read: HTTP ${http}`, { http }, tookMs) };
  }

  let document;
  try {
    document = JSON.parse(read.text);
  } catch {
    return { own: failingOwn('The health document is not JSON', { http }, tookMs) };
  }

  const fetchedAt = Date.now();
  const stamp = document?.checked_at;
  const checkedAt = typeof stamp === 'string' && ISO_TIME_WITH_OFFSET.test(stamp) ? Date.parse(stamp) : NaN;
  const components = document?.components;
  if (Number.isNaN(checkedAt)) {
    return { own: failingOwn('The health document could not be read: checked_at is not a time with an offset', { http }, tookMs) };
  }
  if (checkedAt > fetchedAt + MAX_FUTURE_SKEW_MS) {
    return { own: failingOwn('The health document could not be read: checked_at is ahead of this clock', { http }, tookMs) };
  }
  if (components === null || typeof components !== 'object' || Array.isArray(components)) {
    return { own: failingOwn('The health document could not be read: it has no components', { http }, tookMs) };
  }

  const moved = checkedAt !== memory.lastCheckedAt;
  if (moved) {
    memory.lastCheckedAt = checkedAt;
    memory.stillSince = fetchedAt;
  }

  const { results, problem } = fanOutComponents(spec.service, spec.key, components, checkedAt, fetchedAt);
  const componentCount = Object.keys(components).length;
  const data = {
    overall: typeof document.overall === 'string' ? document.overall : null,
    components: componentCount,
    http,
  };

  const cadenceSeconds = spec.cadence ?? spec.every;
  const standingStill = !moved && fetchedAt - memory.stillSince > STILL_CADENCES * cadenceSeconds * 1000;

  let own;
  if (standingStill) {
    // The document's own time, so this sentence and the components' `at` tell one story.
    own = failingOwn(`The health document hasn't changed since ${clockTime(checkedAt)}`, data, tookMs);
  } else if (problem) {
    own = failingOwn(problem, data, tookMs);
  } else {
    const noun = componentCount === 1 ? 'component' : 'components';
    own = ownResult('ok', `Read ${componentCount} ${noun} in ${describeDuration(tookMs)}`, data, tookMs);
  }
  return moved ? { own, components: results } : { own };
}
